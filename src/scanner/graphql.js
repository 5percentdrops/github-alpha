/**
 * GraphQL-based GitHub scanner.
 * Batches 50 developers per query to maximize efficiency.
 * Fetches recent repos + commit activity in a single call.
 */

const GRAPHQL_URL = 'https://api.github.com/graphql';
const BATCH_SIZE = 5; // GitHub GraphQL 502s above ~8 users with nested commit history
const RATE_PAUSE_MS = 1000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Build a GraphQL query that fetches recent repos for a batch of developers.
 * For each dev, gets repos created in the last 30 days + their commit activity.
 */
function buildBatchQuery(logins) {
  const fragments = logins.map((login, i) => {
    const alias = `u${i}`;
    return `
      ${alias}: user(login: "${login}") {
        login
        repositories(
          first: 5
          orderBy: { field: CREATED_AT, direction: DESC }
          ownerAffiliations: OWNER
          isFork: false
        ) {
          nodes {
            name
            owner { login type: __typename }
            createdAt
            stargazerCount
            watchers: watchers { totalCount }
            forkCount
            isFork
            description
            languages(first: 5) { nodes { name } }
            defaultBranchRef {
              target {
                ... on Commit {
                  history(since: "${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}") {
                    totalCount
                    nodes {
                      committedDate
                    }
                  }
                }
              }
            }
            pushedAt
          }
        }
      }`;
  });

  return `query { ${fragments.join('\n')} }`;
}

/**
 * Execute a GraphQL query against GitHub API.
 */
async function executeQuery(query, token) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'project-alpha-scanner',
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(60000),
      });

      if (res.status === 403 || res.status === 429) {
        const reset = res.headers.get('x-ratelimit-reset');
        const waitSec = reset ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000)) + 2 : 60;
        console.log(`  ⏳ Rate limited — waiting ${waitSec}s...`);
        await sleep(waitSec * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub GraphQL ${res.status}: ${text}`);
      }

      const json = await res.json();

      if (json.errors) {
        // Partial errors are OK — some users may not exist
        const fatal = json.errors.filter(e => !e.type || e.type !== 'NOT_FOUND');
        if (fatal.length > 0 && !json.data) {
          throw new Error(`GraphQL errors: ${JSON.stringify(fatal)}`);
        }
      }

      return json.data || {};
    } catch (err) {
      if (err.name === 'TimeoutError' || err.message === 'fetch failed') {
        if (attempt < 4) {
          console.log(`  ⚠️ Network error (attempt ${attempt + 1}/5): ${err.message}`);
          await sleep(5000 * (attempt + 1));
          continue;
        }
      }
      throw err;
    }
  }
  return {};
}

/**
 * Parse GraphQL response into normalized repo data.
 */
function parseResponse(data) {
  const results = [];
  const now = Date.now();

  for (const key of Object.keys(data)) {
    const user = data[key];
    if (!user || !user.repositories) continue;

    for (const repo of user.repositories.nodes) {
      if (!repo) continue;

      const createdAt = new Date(repo.createdAt);
      const repoAge = Math.floor((now - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      const isOrg = repo.owner.type === 'Organization';

      // Count commits in time windows
      const commits = repo.defaultBranchRef?.target?.history?.nodes || [];
      const totalCommits7d = repo.defaultBranchRef?.target?.history?.totalCount || 0;

      let commits24h = 0;
      let commits48h = 0;
      const now_ms = Date.now();

      for (const c of commits) {
        const age = now_ms - new Date(c.committedDate).getTime();
        if (age <= 24 * 60 * 60 * 1000) commits24h++;
        if (age <= 48 * 60 * 60 * 1000) commits48h++;
      }

      // languages
      const languages = (repo.languages?.nodes || []).map(l => l.name);

      // last push relative
      const pushedAt = repo.pushedAt ? new Date(repo.pushedAt) : null;
      let lastPush = null;
      if (pushedAt) {
        const mins = Math.floor((now - pushedAt.getTime()) / 60000);
        if (mins < 60) lastPush = `${mins}m ago`;
        else if (mins < 1440) lastPush = `${Math.floor(mins / 60)}h ago`;
        else lastPush = `${Math.floor(mins / 1440)}d ago`;
      }

      results.push({
        login: user.login,
        repo: repo.name,
        repoOwner: repo.owner.login,
        repoAge,
        stars: repo.stargazerCount,
        watchers: repo.watchers?.totalCount || 0,
        isFork: repo.isFork ? 1 : 0,
        isOrg: isOrg ? 1 : 0,
        languages: JSON.stringify(languages),
        description: (repo.description || '').slice(0, 250),
        commits24h,
        commits48h,
        commits7d: totalCommits7d,
        lastPush,
        pushedAt: repo.pushedAt,
      });
    }
  }

  return results;
}

/**
 * Scan a list of developer logins via GraphQL.
 * Returns normalized repo data for all developers.
 */
export async function scanDevelopers(logins, token, onProgress) {
  const allResults = [];
  const batches = [];

  for (let i = 0; i < logins.length; i += BATCH_SIZE) {
    batches.push(logins.slice(i, i + BATCH_SIZE));
  }

  console.log(`📡 Scanning ${logins.length} developers in ${batches.length} batches (${BATCH_SIZE}/batch)...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    await sleep(RATE_PAUSE_MS);

    try {
      const query = buildBatchQuery(batch);
      const data = await executeQuery(query, token);
      const parsed = parseResponse(data);
      allResults.push(...parsed);

      if ((i + 1) % 10 === 0 || i === batches.length - 1) {
        const pct = Math.round(((i + 1) / batches.length) * 100);
        console.log(`   Batch ${i + 1}/${batches.length} (${pct}%) — ${allResults.length} repos found`);
        if (onProgress) onProgress(i + 1, batches.length, allResults.length);
      }
    } catch (err) {
      console.error(`   ❌ Batch ${i + 1} failed: ${err.message}`);
      // Continue with next batch
    }
  }

  return allResults;
}
