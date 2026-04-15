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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const PER_PAGE = 100; // max GitHub allows
const MAX_PAGES = 10; // 10 pages × 100 = 1000 (API hard cap per query)
const RATE_PAUSE_MS = 3000; // stay under 30 req/min search limit + DNS breathing room

// Follower range segments — bypasses the 1000-result cap per query
// Fine-grained splits for 1000-1499 where API cap was hit
const SEGMENTS = [
  [1000, 1049],
  [1050, 1099],
  [1100, 1149],
  [1150, 1199],
  [1200, 1249],
  [1250, 1349],
  [1350, 1499],
  [1500, 1749],
  [1750, 1999],
  [2000, 2499],
  [2500, 2999],
  [3000, 3999],
  [4000, 4999],
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
    out: path.join(__dirname, '..', 'data', 'developers-1k-followers.json'),
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

async function searchUsers(query, page, token, attempt = 0) {
  const url = `https://api.github.com/search/users?q=${encodeURIComponent(query)}&sort=followers&order=desc&per_page=${PER_PAGE}&page=${page}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-1k-followers-collector',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
  } catch (err) {
    if (attempt < 7) {
      const wait = 5000 * (attempt + 1);
      console.log(`  ⚠️ Network error (attempt ${attempt + 1}/7): ${err.message} — retrying in ${wait / 1000}s...`);
      await sleep(wait);
      return searchUsers(query, page, token, attempt + 1);
    }
    throw err;
  }

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

async function fetchUserDetails(login, token, attempt = 0) {
  const url = `https://api.github.com/users/${login}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-1k-followers-collector',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
  } catch (err) {
    if (attempt < 3) {
      await sleep(3000 * (attempt + 1));
      return fetchUserDetails(login, token, attempt + 1);
    }
    return null;
  }
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

  // Load existing dataset for incremental merge
  const dataDir = path.join(__dirname, '..', 'data');
  const existingFile = path.join(dataDir, 'developers-1k-followers.json');
  let existingData = [];
  if (fs.existsSync(existingFile)) {
    existingData = JSON.parse(fs.readFileSync(existingFile, 'utf8'));
    for (const u of existingData) {
      seen.set(u.login, u); // pre-seed with existing accounts
    }
    console.log(`📂 Loaded ${existingData.length} existing accounts (will skip these)\n`);
  }

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

  // Separate new accounts (need enrichment) from existing (already enriched)
  const existingLogins = new Set(existingData.map(u => u.login));
  const newAccounts = [...seen.values()].filter(u => !existingLogins.has(u.login));

  console.log(`\n📊 Total unique accounts: ${seen.size} (${newAccounts.length} new, ${existingData.length} existing)`);

  if (newAccounts.length === 0) {
    console.log('✅ No new accounts to enrich. Dataset is up to date.');
    return;
  }

  console.log(`🔎 Fetching full profiles for ${newAccounts.length} new accounts...\n`);

  const newEnriched = [];
  const outFile = existingFile;

  function saveProgress() {
    const merged = [...existingData, ...newEnriched]
      .filter(u => u.name || u.bio)
      .sort((a, b) => (b.followers || 0) - (a.followers || 0));
    fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));
    return merged.length;
  }

  for (let i = 0; i < newAccounts.length; i++) {
    const u = newAccounts[i];
    await sleep(100);

    let detail = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        detail = await fetchUserDetails(u.login, opts.token);
        break;
      } catch (err) {
        console.log(`  ⚠️ Fetch failed for ${u.login} (attempt ${attempt + 1}/3): ${err.message}`);
        await sleep(5000 * (attempt + 1));
      }
    }

    if (detail) {
      newEnriched.push({
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
      newEnriched.push({ login: u.login, url: u.url, followers: null });
    }

    if ((i + 1) % 50 === 0) {
      console.log(`   Enriched ${i + 1}/${newAccounts.length}...`);
    }
    // Save progress every 200 accounts
    if ((i + 1) % 200 === 0) {
      const total = saveProgress();
      console.log(`   💾 Progress saved (${total} total accounts)`);
    }
  }

  // Final save
  const totalSaved = saveProgress();
  console.log(`\n✅ Saved ${totalSaved} accounts to ${outFile} (+${newEnriched.length} new)`);

  // Print top 20
  console.log(`\n🏆 Top 20:`);
  const final = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  final.slice(0, 20).forEach((u, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${(u.login || '').padEnd(25)} ${String(u.followers || '?').padStart(8)} followers  ${u.name || ''}`);
  });
}

main().catch((err) => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
