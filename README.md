<p align="center">
  <img src="docs/assets/logo.svg" width="140" alt="GitHub Alpha logo"/>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22d3ee?style=flat-square" alt="license"/></a>
  <img src="https://img.shields.io/badge/runtime-Node.js%2020%2B-7c5cff?style=flat-square" alt="node"/>
  <img src="https://img.shields.io/badge/dep-better--sqlite3-f59e0b?style=flat-square" alt="dep"/>
  <img src="https://img.shields.io/badge/process%20manager-PM2-22c55e?style=flat-square" alt="pm2"/>
  <img src="https://img.shields.io/badge/API-:%203847-94a3b8?style=flat-square" alt="port"/>
  <img src="https://img.shields.io/badge/PRs-welcome-f472b6?style=flat-square" alt="prs"/>
</p>

<p align="center">
  <sub>GitHub developer intelligence — burst-commit signals on 7,719 high-follower devs.</sub>
</p>

---

![Hero](docs/assets/hero.svg)

---

> **Finds the obscure personal repos 1k+ follower devs ship in 48 hours — before anyone else is watching.**

## Table of Contents

- [Quick Start](#quick-start)
- [What It Does](#what-it-does)
- [Signal Tiers](#signal-tiers)
- [API Endpoints](#api-endpoints)
- [Schedule (PM2)](#schedule-pm2)
- [Configuration](#configuration)
- [Mission Control Integration](#mission-control-integration)
- [Repo Layout](#repo-layout)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Quick Start

```bash
# env (or rely on `gh auth token`)
export GITHUB_TOKEN=ghp_...

# one-off scans
npm run scan          # full scan of all 7,719 devs (~75 min @ batch 10)
npm run scan:hot      # re-scan only WATCHING-tagged devs from last 24h
npm run scan:test     # 20-dev sanity check
npm run api           # start API on :3847

# production via PM2
pm2 start ecosystem.config.cjs    # api + cron-scheduled scans
pm2 save                          # persist for resurrect
# Windows boot: install pm2-windows-startup, or schedule `pm2 resurrect` via Task Scheduler
```

## What It Does

`github-alpha` is the **GitHub Alpha card** backend inside Action Control UI's Mission Control. It scans a curated list of 7,719 developers with ≥1k followers via the GitHub GraphQL API, walks their recent personal repos, and surfaces the ones exploding with commit activity that the rest of the world hasn't noticed yet.

The pipeline is a 6-stage filter over raw GraphQL responses:

1. **Namespace gate** — `repo.owner.login === target.login` (personal, not org).
2. **Fork gate** — drop forks.
3. **Age gate** — repo age < 30 days.
4. **Velocity gate** — `commits / 48h ≥ tier`.
5. **Obscurity gate** — `watchers > stars` (sole obscurity check; no fixed star ceiling).

Anything that passes all five is fed back to Action Control over `GET /api/signals`.

## Signal Tiers

| Tier        | commits / 48h | Meaning                                |
|-------------|---------------|----------------------------------------|
| `ALPHA`     | ≥ 75          | All 5 hard gates passed — pre-launch.  |
| `WATCHING`  | 1 – 74        | Activity but below velocity threshold. |
| `DORMANT`   | 0             | No qualifying activity.                |

> Per user spec — overrides PRD v1.0 §5.4 / §6 thresholds (50 / 30) and the `stars < 10` gate.
> Star count is still surfaced in the UI for context but does not gate classification.
> There is **no HOT tier**; only `ALPHA` matters for the Mission Control card.

## API Endpoints

| Method | Path             | Response                                                       |
|--------|------------------|----------------------------------------------------------------|
| GET    | `/api/health`    | `{ ok: true, uptimeMs, dbOk }`                                 |
| GET    | `/api/stats`     | `{ targets, apiCallsPerDay, filtered, alpha, watching }`       |
| GET    | `/api/signals`   | latest signal data per repo with gate results + commit windows |

Default port: `3847` (override via `PORT` env). Backing store: `better-sqlite3` at `data/alpha.db`.

## Schedule (PM2)

`ecosystem.config.cjs` ships three apps:

| Service             | Cron            | Purpose                                    |
|---------------------|-----------------|--------------------------------------------|
| `alpha-api`         | always on       | HTTP API on `:3847` for Action Control.    |
| `alpha-daily-scan`  | `0 11 * * *`    | Full scan of all 7,719 developers.         |
| `alpha-hot-rescan`  | `0 */6 * * *`   | Re-scan repos tagged WATCHING in last 24h. |

All three run via `pm2 start ecosystem.config.cjs`; persist with `pm2 save`.

## Configuration

Defaults live in `config/default.json`:

```json
{
  "collection": {
    "minFollowers": 1000,
    "ratePauseMs": 2200,
    "perPage": 100
  },
  "missionControl": {
    "cardId": "github-alpha",
    "refreshInterval": "6h"
  }
}
```

| Key                          | Default | Notes                                                    |
|------------------------------|---------|----------------------------------------------------------|
| `collection.minFollowers`    | `1000`  | Lower bound for `data/developers-1k-followers.json`.     |
| `collection.ratePauseMs`     | `2200`  | Sleep between GraphQL calls — stay below secondary limit.|
| `collection.perPage`         | `100`   | Cursor page size for the watcher/star lookups.           |
| `missionControl.refreshInterval` | `6h` | UI poll cadence — match the `alpha-hot-rescan` cron.    |

Tier thresholds live in `src/scanner/` (current values: ALPHA ≥ 75, WATCHING ≥ 1).

## Mission Control Integration

This is the **GitHub Alpha card** source for Action Control UI. The card consumes `/api/signals` and renders:

- Top developers by recent commit velocity.
- ALPHA-tagged obscure new repos (the pre-launch pre-traction window).
- Cross-reference against wiki entities for trading / tech signal scoring.

The card's `cardId` is `github-alpha`; refresh cadence is 6h to match `alpha-hot-rescan`.

## Repo Layout

```
config/                    — default.json (tier thresholds, rate limits)
data/                      — SQLite db (alpha.db) + curated 1k-follower dev list
scripts/                   — one-off jobs (collect-1k-followers, seed-developers)
src/
  collectors/              — GraphQL fetchers + cursor walkers
  analyzers/               — 6-stage filter pipeline + tier classification
  scanner/                 — run-scan orchestrator (--hot-only mode supported)
  api/                     — HTTP server for Action Control integration
  db/                      — schema + better-sqlite3 wrapper
ecosystem.config.cjs       — PM2 process manifest (api + 2 cron scanners)
```

## Troubleshooting

| Symptom                                              | Likely cause                                  | Fix                                                                  |
|------------------------------------------------------|-----------------------------------------------|----------------------------------------------------------------------|
| `429 rate limit exceeded` mid-scan                   | `ratePauseMs` too tight                       | Raise `collection.ratePauseMs` in `config/default.json`.            |
| `dbOk: false` in `/api/health`                       | `data/alpha.db` missing / permissions         | Ensure `node src/db/init.js` ran and `data/` is writable by `pm2`.   |
| Scans finish but no ALPHA rows appear                | Thresholds shifted or dev list stale          | `npm run scan:test` to validate; reseed via `npm run seed`.         |
| `alpha-api` keeps restarting on Windows              | `pm2 resurrect` not on boot                   | Install `pm2-windows-startup` or schedule `pm2 resurrect` in Task Scheduler. |
| Stars > Watchers for a repo you expected ALPHA on    | Hard gate intentionally rejects               | Confirm `watchers > stars`; UI will still surface stars, not gate.   |

## License

[MIT](LICENSE). © TR3-AI.