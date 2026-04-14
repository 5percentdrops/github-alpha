# GitHub Alpha

GitHub developer intelligence pipeline for Mission Control UI's GitHub Alpha card.

## Structure

```
data/              — collected datasets (JSON)
scripts/           — standalone CLI scripts (collectors, one-off jobs)
src/
  collectors/      — data collection modules (followers, repos, activity)
  analyzers/       — signal detection (trending devs, rising stars, new repos)
  api/             — API layer for Mission Control UI integration
config/            — configuration files
.github/workflows/ — automated collection via GitHub Actions
```

## Data Sources

- **GitHub Search API** — developer accounts with 1k+ followers
- **GitHub Events API** — activity tracking (commits, stars, forks)
- **TrendShift** — trending repo alerts (via existing Telegram webhook)

## Mission Control Integration

This feeds the **GitHub Alpha card** in Mission Control UI:
- Top developers by follower growth
- Rising star accounts (fast follower gain)
- New repos from tracked developers
- Cross-reference with wiki entities for trading/tech signals
