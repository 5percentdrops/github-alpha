#!/usr/bin/env node
/**
 * Main scanner orchestrator (per Project Alpha PRD v1.0).
 * Fetches developer activity via GraphQL, runs the filter pipeline,
 * stores results in SQLite. Output consumed by Action Control UI via API.
 *
 * Usage:
 *   node src/scanner/run-scan.js                  # full scan
 *   node src/scanner/run-scan.js --hot-only       # re-scan HOT targets only
 *   node src/scanner/run-scan.js --test 5         # test with 5 developers
 */
import { execSync } from 'child_process';
import {
  getAllDevelopers, getHotTargets, insertScanResult,
  closeDb, getDeveloperCount,
} from '../db/database.js';
import { scanDevelopers } from './graphql.js';
import { classifySignal } from './pipeline.js';

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const hotOnly = args.includes('--hot-only');
  const testCount = args.includes('--test') ? parseInt(args[args.indexOf('--test') + 1], 10) : 0;

  const token = getToken();
  if (!token) {
    console.error('❌ No GitHub token. Set GITHUB_TOKEN or install gh CLI.');
    process.exit(1);
  }

  console.log(`\n🔍 Project Alpha Scanner`);
  console.log(`   Mode: ${hotOnly ? 'HOT re-scan' : 'Full scan'}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  // Get target list
  let logins;
  if (hotOnly) {
    logins = getHotTargets();
    console.log(`   HOT targets: ${logins.length}`);
  } else if (testCount) {
    const devs = getAllDevelopers();
    logins = devs.slice(0, testCount).map(d => d.login);
    console.log(`   Test mode: ${logins.length} developers`);
  } else {
    const devs = getAllDevelopers();
    logins = devs.map(d => d.login);
    console.log(`   Targets: ${logins.length}`);
  }

  if (logins.length === 0) {
    console.log('   No targets to scan.');
    closeDb();
    return;
  }

  // Stream-process: classify + insert per batch (no in-memory accumulation)
  const totals = { stored: 0, alpha: 0, hot: 0, watching: 0, dormant: 0 };

  await scanDevelopers(logins, token, async (rawBatch) => {
    for (const raw of rawBatch) {
      const sig = classifySignal(raw);
      insertScanResult(sig);
      totals.stored++;
      totals[sig.signal.toLowerCase()]++;
      if (sig.signal === 'ALPHA' || sig.signal === 'HOT') {
        console.log(`   ${sig.signal === 'ALPHA' ? '⚡' : '🔥'} ${sig.signal}: ${sig.login}/${sig.repo} (${sig.commits48h}/48h)`);
      }
    }
  });

  console.log(`\n📊 Pipeline Results:`);
  console.log(`   Total repos scanned: ${totals.stored}`);
  console.log(`   ⚡ ALPHA: ${totals.alpha}`);
  console.log(`   🔥 HOT:   ${totals.hot}`);
  console.log(`   👁 WATCH:  ${totals.watching}`);
  console.log(`   — DORMANT: ${totals.dormant}`);
  console.log(`\n✅ Scan complete. ${totals.stored} results stored.`);
  closeDb();
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  closeDb();
  process.exit(1);
});
