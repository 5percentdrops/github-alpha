/**
 * 6-stage filter pipeline + signal classifier.
 *
 * Stage 1: Target list (handled by database)
 * Stage 2: Daily event ping (handled by GraphQL scanner)
 * Stage 3: Action filters — only CreateEvent + PushEvent (implicitly handled by GraphQL repo query)
 * Stage 4: Velocity trigger — 150/48h = ALPHA, 75-149 = HOT
 * Stage 5: Obscurity constraints — repo < 30d, stars < 10, watchers >= 3 AND > stars
 * Stage 6: Day job exclusions — not org, not fork, personal namespace
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

  // Gate 4: Velocity threshold (150/48h = ALPHA, 75-149 = HOT)
  const gateVelocity = repo.commits48h >= 75 ? 1 : 0;

  // Gate 5: Repo age < 30 days
  const gateRepoAge = repo.repoAge < 30 ? 1 : 0;

  // Gate 6: Stars < 10
  const gateStars = repo.stars < 10 ? 1 : 0;

  // Gate 7: Watchers >= 3 AND watchers > stars
  const gateWatchers = (repo.watchers >= 3 && repo.watchers > repo.stars) ? 1 : 0;

  // All structural gates (everything except velocity)
  const structuralGatesPassed = gateNotOrg && gateNotFork && gatePersonalNs &&
    gateRepoAge && gateStars;

  // Signal classification
  let signal = 'DORMANT';

  if (repo.commits48h === 0) {
    signal = 'DORMANT';
  } else if (structuralGatesPassed && repo.commits48h >= 150) {
    signal = 'ALPHA';
  } else if (structuralGatesPassed && repo.commits48h >= 75) {
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
