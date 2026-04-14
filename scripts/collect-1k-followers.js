#!/usr/bin/env node
/**
 * Collects GitHub developer accounts with 1k+ followers.
 *
 * GitHub Search API caps at 1000 results per query, so we segment
 * by follower ranges to capture as many accounts as possible.
 *
 * Usage:
 *   node github-1k-followers.js                  # uses GITHUB_TOKEN env
 *   node github-1k-followers.js --token ghp_xxx  # explicit token
 *   node github-1k-followers.js --min 5000       # only 5k+ followers
 *   node github-1k-followers.js --out results.json
 */

const fs = require('fs');
const path = require('path');

// --- Config ---
const PER_PAGE = 100; // max GitHub allows
const MAX_PAGES = 10; // 10 pages × 100 = 1000 (API hard cap per query)
const RATE_PAUSE_MS = 2200; // stay under 30 req/min search limit

// Follower range segments — bypasses the 1000-result cap per query
const SEGMENTS = [
  [1000, 1499],
  [1500, 1999],
  [2000, 2999],
  [3000, 4999],
  [5000, 9999],
  [10000, 19999],
  [20000, 49999],
  [50000, 99999],
  [100000, 999999],
  [1000000, Infinity],
];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    token: process.env.GITHUB_TOKEN || '',
    min: 1000,
    out: path.join(__dirname, 'github-1k-followers.json'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && args[i + 1]) opts.token = args[++i];
    if (args[i] === '--min' && args[i + 1]) opts.min = parseInt(args[++i], 10);
    if (args[i] === '--out' && args[i + 1]) opts.out = args[++i];
  }
  return opts;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchUsers(query, page, token) {
  const url = `https://api.github.com/search/users?q=${encodeURIComponent(query)}&sort=followers&order=desc&per_page=${PER_PAGE}&page=${page}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-1k-followers-collector',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });

  // Handle rate limit
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const waitSec = reset ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000)) + 2 : 60;
    console.log(`  ⏳ Rate limited — waiting ${waitSec}s...`);
    await sleep(waitSec * 1000);
    return searchUsers(query, page, token); // retry
  }

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function fetchUserDetails(login, token) {
  const url = `https://api.github.com/users/${login}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-1k-followers-collector',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const waitSec = reset ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000)) + 2 : 60;
    console.log(`  ⏳ Rate limited on user detail — waiting ${waitSec}s...`);
    await sleep(waitSec * 1000);
    return fetchUserDetails(login, token);
  }
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  const opts = parseArgs();

  if (!opts.token) {
    console.log('⚠️  No GITHUB_TOKEN — rate limits will be tight (10 req/min unauthenticated).');
    console.log('   Set GITHUB_TOKEN env or pass --token ghp_xxx\n');
  }

  const seen = new Map(); // login -> user obj (dedup)
  const activeSegments = SEGMENTS.filter(([lo]) => lo >= opts.min || SEGMENTS.find(([l, h]) => l <= opts.min && h >= opts.min));

  console.log(`🔍 Collecting GitHub accounts with ${opts.min}+ followers...\n`);

  for (const [lo, hi] of SEGMENTS) {
    if (hi < opts.min) continue;
    const effectiveLo = Math.max(lo, opts.min);
    const rangeStr = hi === Infinity ? `${effectiveLo}+` : `${effectiveLo}..${hi}`;
    const query = `type:user followers:${hi === Infinity ? `>=${effectiveLo}` : `${effectiveLo}..${hi}`}`;

    console.log(`📦 Segment: ${rangeStr} followers`);

    let page = 1;
    let segmentCount = 0;

    while (page <= MAX_PAGES) {
      await sleep(RATE_PAUSE_MS);
      const data = await searchUsers(query, page, opts.token);
      const items = data.items || [];

      if (items.length === 0) break;

      for (const u of items) {
        if (!seen.has(u.login)) {
          seen.set(u.login, {
            login: u.login,
            id: u.id,
            url: u.html_url,
            avatar: u.avatar_url,
            type: u.type,
            score: u.score,
          });
          segmentCount++;
        }
      }

      console.log(`   Page ${page}: +${items.length} users (${segmentCount} new in segment)`);

      if (items.length < PER_PAGE) break;
      page++;
    }
  }

  console.log(`\n📊 Total unique accounts found: ${seen.size}`);
  console.log(`🔎 Fetching full profiles (followers count, bio, repos)...\n`);

  // Enrich with full user details (followers count isn't in search results)
  const users = [...seen.values()];
  const enriched = [];

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    await sleep(100); // gentler rate for user endpoint (5000/hr authenticated)
    const detail = await fetchUserDetails(u.login, opts.token);

    if (detail) {
      enriched.push({
        login: detail.login,
        name: detail.name,
        bio: detail.bio,
        followers: detail.followers,
        following: detail.following,
        public_repos: detail.public_repos,
        company: detail.company,
        location: detail.location,
        blog: detail.blog,
        twitter: detail.twitter_username,
        url: detail.html_url,
        created: detail.created_at,
      });
    } else {
      enriched.push({ login: u.login, url: u.url, followers: null });
    }

    if ((i + 1) % 50 === 0) {
      console.log(`   Enriched ${i + 1}/${users.length}...`);
    }
  }

  // Sort by followers descending
  enriched.sort((a, b) => (b.followers || 0) - (a.followers || 0));

  // Save JSON
  fs.writeFileSync(opts.out, JSON.stringify(enriched, null, 2));
  console.log(`\n✅ Saved ${enriched.length} accounts to ${opts.out}`);

  // Print top 20
  console.log(`\n🏆 Top 20:`);
  enriched.slice(0, 20).forEach((u, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${(u.login || '').padEnd(25)} ${String(u.followers || '?').padStart(8)} followers  ${u.name || ''}`);
  });
}

main().catch((err) => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
