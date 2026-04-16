#!/usr/bin/env node
/**
 * Simple HTTP API server for Action Control UI.
 * Serves signal data from SQLite.
 */
import http from 'http';
import { getLatestSignals, getDeveloperCount, closeDb, getDb } from '../db/database.js';

const PORT = process.env.PORT || 3847;

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/signals') {
    const signals = getLatestSignals();
    const mapped = signals.map(s => ({
      id: s.id,
      login: s.login,
      name: null, // join with developers table below
      followers: null,
      repo: s.repo,
      repoOwner: s.repo_owner,
      repoAge: s.repo_age,
      stars: s.stars,
      watchers: s.watchers,
      isFork: !!s.is_fork,
      isOrg: !!s.is_org,
      events: JSON.parse(s.events || '{}'),
      commits: {
        '24h': s.commits_24h,
        '48h': s.commits_48h,
        '7d': s.commits_7d,
      },
      languages: JSON.parse(s.languages || '[]'),
      lastPush: s.last_push,
      signal: s.signal,
      description: s.description,
      gates: {
        notOrg: !!s.gate_not_org,
        notFork: !!s.gate_not_fork,
        personalNs: !!s.gate_personal_ns,
        velocity: !!s.gate_velocity,
        repoAge: !!s.gate_repo_age,
        stars: !!s.gate_stars,
        watchers: !!s.gate_watchers,
      },
    }));

    // Enrich with developer info
    const db = getDb();
    for (const sig of mapped) {
      const dev = db.prepare('SELECT name, followers FROM developers WHERE login = ?').get(sig.login);
      if (dev) {
        sig.name = dev.name;
        sig.followers = dev.followers;
      }
    }

    return json(res, mapped);
  }

  if (url.pathname === '/api/stats') {
    const db = getDb();
    const targets = getDeveloperCount();
    const scanCount = db.prepare(`SELECT COUNT(*) as c FROM scan_results WHERE scanned_at > datetime('now', '-24 hours')`).get().c;
    const alphaCount = db.prepare(`SELECT COUNT(DISTINCT login || repo) as c FROM scan_results WHERE signal = 'ALPHA' AND scanned_at > datetime('now', '-24 hours')`).get().c;
    const hotCount = db.prepare(`SELECT COUNT(DISTINCT login || repo) as c FROM scan_results WHERE signal = 'HOT' AND scanned_at > datetime('now', '-24 hours')`).get().c;

    return json(res, {
      targets,
      apiCallsPerDay: Math.ceil(targets / 10), // GraphQL batches at BATCH_SIZE=10
      filtered: alphaCount + hotCount,
      rateLimitPct: ((Math.ceil(targets / 20) / 5000) * 100).toFixed(1),
      cost: '$0',
      alpha: alphaCount,
      hot: hotCount,
    });
  }

  if (url.pathname === '/api/health') {
    return json(res, { status: 'ok', time: new Date().toISOString() });
  }

  json(res, { error: 'Not found' }, 404);
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`🚀 Project Alpha API running on http://localhost:${PORT}`);
  console.log(`   GET /api/signals  — latest signal data`);
  console.log(`   GET /api/stats    — dashboard stats`);
  console.log(`   GET /api/health   — health check`);
});

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});
