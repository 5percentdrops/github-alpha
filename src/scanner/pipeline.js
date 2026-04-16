/**
 * Filter pipeline + signal classifier.
 *
 * USER SPEC (2026-04-16) — supersedes PRD v1.0 §5.4/§6:
 *   ALPHA only — no HOT tier.
 *   ≥150 commits/48h on a personal repo with watchers > stars and age < 30d.
 *
 * Hard gates for ALPHA:
 *   - Not org repo
 *   - Not a fork
 *   - Personal namespace
 *   - Repo < 30 days old
 *   - Watchers > Stars  (replaces stars<10 — true obscurity is watchers/stars ratio)
 *
 * Stars-count is reported but no longer gated.
 *
 * WATCHING = any commit activity below 150/48h
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

  // Gate 4: Velocity threshold (user spec: ≥150/48h)
  const gateVelocity = repo.commits48h >= 150 ? 1 : 0;

  // Gate 5: Repo age < 30 days
  const gateRepoAge = repo.repoAge < 30 ? 1 : 0;

  // Gate 6: Watchers > Stars (only obscurity gate — replaces stars<10)
  const gateWatchers = repo.watchers > repo.stars ? 1 : 0;

  // gate_stars retained as informational (star count still surfaced) but no longer blocks
  const gateStars = repo.stars < 10 ? 1 : 0;

  // Structural gates required for ALPHA (everything except velocity)
  const structuralGatesPassed = gateNotOrg && gateNotFork && gatePersonalNs &&
    gateRepoAge && gateWatchers;

  // Signal classification — ALPHA only, no HOT tier per user spec
  let signal = 'DORMANT';

  if (repo.commits48h === 0) {
    signal = 'DORMANT';
  } else if (structuralGatesPassed && repo.commits48h >= 150) {
    signal = 'ALPHA';
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
