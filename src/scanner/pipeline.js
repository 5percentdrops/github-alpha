/**
 * 7-gate filter pipeline + signal classifier.
 *
 * USER OVERRIDE (2026-04-16) — supersedes PRD v1.0 §5.4/§6 thresholds:
 *   ALPHA = ≥150 commits/48h (PRD said 50)
 *   HOT   = 100–149 commits/48h (PRD said 30–49)
 *
 * Hard gates for ALPHA/HOT classification:
 *   - Not org repo
 *   - Not a fork
 *   - Personal namespace
 *   - Repo < 30 days old
 *   - Stars < 10
 *   - Watchers > Stars  (now blocking — was informational)
 *
 * WATCHING = any commit activity below 100/48h
 * DORMANT  = no activity
 */

/**
 * Run all 7 filter gates on a repo scan result.
 * Returns the result annotated with gate pass/fail and signal tier.
 */
export function classifySignal(repo) {
  // Gate 1: Not an org repo
  const gateNotOrg = repo.isOrg === 0 ? 1 : 0;

  // Gate 2: Not a fork
  const gateNotFork = repo.isFork === 0 ? 1 : 0;

  // Gate 3: Personal namespace (repo owner matches developer login)
  const gatePersonalNs = repo.repoOwner === repo.login ? 1 : 0;

  // Gate 4: Velocity threshold (user override: ≥150/48h = ALPHA, 100-149 = HOT)
  const gateVelocity = repo.commits48h >= 100 ? 1 : 0;

  // Gate 5: Repo age < 30 days
  const gateRepoAge = repo.repoAge < 30 ? 1 : 0;

  // Gate 6: Stars < 10
  const gateStars = repo.stars < 10 ? 1 : 0;

  // Gate 7: Watchers > Stars (now blocking gate, not informational)
  const gateWatchers = repo.watchers > repo.stars ? 1 : 0;

  // Structural gates required for ALPHA/HOT (everything except velocity)
  const structuralGatesPassed = gateNotOrg && gateNotFork && gatePersonalNs &&
    gateRepoAge && gateStars && gateWatchers;

  // Signal classification (user thresholds)
  let signal = 'DORMANT';

  if (repo.commits48h === 0) {
    signal = 'DORMANT';
  } else if (structuralGatesPassed && repo.commits48h >= 150) {
    signal = 'ALPHA';
  } else if (structuralGatesPassed && repo.commits48h >= 100) {
    signal = 'HOT';
  } else if (repo.commits48h > 0) {
    signal = 'WATCHING';
  }

  return {
    ...repo,
    signal,
    gateNotOrg,
    gateNotFork,
    gatePersonalNs,
    gateVelocity,
    gateRepoAge,
    gateStars,
    gateWatchers,
    events: JSON.stringify({ CreateEvent: 0, PushEvent: repo.commits7d }),
  };
}

/**
 * Run the full pipeline on an array of raw scan results.
 * Returns classified results, sorted by signal priority.
 */
export function runPipeline(rawResults) {
  const classified = rawResults.map(classifySignal);

  // Sort: ALPHA first, then HOT, WATCHING, DORMANT. Within tier, by commits48h desc.
  const priority = { ALPHA: 0, HOT: 1, WATCHING: 2, DORMANT: 3 };
  classified.sort((a, b) => {
    const p = priority[a.signal] - priority[b.signal];
    if (p !== 0) return p;
    return b.commits48h - a.commits48h;
  });

  // Stats
  const stats = {
    total: classified.length,
    alpha: classified.filter(r => r.signal === 'ALPHA').length,
    hot: classified.filter(r => r.signal === 'HOT').length,
    watching: classified.filter(r => r.signal === 'WATCHING').length,
    dormant: classified.filter(r => r.signal === 'DORMANT').length,
  };

  return { signals: classified, stats };
}
