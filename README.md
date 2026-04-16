# GitHub Alpha

GitHub developer intelligence pipeline for Action Control UI's GitHub Alpha card
(per Project Alpha PRD v1.0). Scans 7,719 high-follower devs, detects burst-commit
activity on obscure new personal repos. Output consumed by Action Control via HTTP API.

## Quick Start

```bash
# env
export GITHUB_TOKEN=...   # or rely on `gh auth token`

# one-off scans
npm run scan          # full scan of all 7719 devs (~75min @ batch 10)
npm run scan:hot      # re-scan only HOT-tagged devs from last 24h
npm run scan:test     # 20-dev sanity check
npm run api           # start API on :3847

# production via PM2
pm2 start ecosystem.config.cjs    # api + cron-scheduled scans
pm2 save                          # persist for resurrect
# Windows boot: install pm2-windows-startup, or schedule `pm2 resurrect` via Task Scheduler
```

## Schedule (PM2 cron_restart)

| Service           | Cron        | Purpose                              |
|-------------------|-------------|--------------------------------------|
| alpha-api         | (always on) | HTTP API on :3847 for Action Control |
| alpha-daily-scan  | 02:00 UTC   | Full scan of all 7719 developers     |
| alpha-hot-rescan  | every 6h    | Re-scan repos tagged HOT in last 24h |

## Signal Tiers (PRD §6)

| Signal   | commits/48h | Description                                    |
|----------|-------------|------------------------------------------------|
| ⚡ ALPHA  | ≥ 50        | All 6 filter gates passed — pre-launch signal  |
| 🔥 HOT    | 30 – 49     | Approaching velocity threshold                 |
| 👁 WATCHING | 1 – 29      | Activity but below velocity threshold          |
| — DORMANT | 0           | No qualifying activity                         |

ALPHA / HOT require structural gates: not org, not fork, personal namespace,
repo age < 30d, stars < 10. Watcher gate (watchers > stars) reported but informational.

## API Endpoints

- `GET /api/health` — liveness
- `GET /api/stats` — `{ targets, apiCallsPerDay, filtered, alpha, hot }`
- `GET /api/signals` — latest signal data per repo with gates + commit windows

## Structure

```
data/              — SQLite db (alpha.db) + raw dev dataset
scripts/           — one-off jobs (collect, seed)
src/
  scanner/         — GraphQL fetcher + 6-stage filter pipeline + run-scan orchestrator
  api/             — HTTP server for MCU integration
  db/              — schema + better-sqlite3 wrapper
ecosystem.config.cjs — PM2 process manifest
```

## Mission Control Integration

This feeds the **GitHub Alpha card** in Action Control UI:
- Top developers by recent commit velocity
- HOT/ALPHA-tagged obscure new repos
- Cross-reference with wiki entities for trading/tech signals
