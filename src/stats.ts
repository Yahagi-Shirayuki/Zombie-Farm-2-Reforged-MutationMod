// Lifetime farm statistics — the numbers behind the Statistics panel (Account menu).
//
// These are a KEPT TALLY, not a derivation. Almost nothing here can be recovered
// from a save after the fact: the farm holds the crops standing in it, not the ten
// thousand it has harvested; the graveyard is trimmed; and gold spent leaves no
// trace at all once it is spent. So each figure is counted at the moment it happens
// (GameState.record*) and carried in the save.
//
// It is display data and nothing reads it back as truth: no reward, price, gate or
// unlock consults a counter here, which is exactly why it can be client-authored and
// ride the presentation blob online beside the Almanac.

/** Lifetime counters for one farm (one save / one account). */
export interface FarmStats {
  /** Epoch ms this tally began — the farm's "keeping count since". */
  startedAt: number;
  /** Lifetime harvests per crop key, veggie and zombie crops alike. The per-key map
   *  is what makes a favourite crop answerable; the totals below are derived. */
  harvested: Record<string, number>;
  /** Crops planted, and plots plowed, over the farm's life. */
  planted: number;
  plowed: number;
  /** Fruit trees picked (a placed object, not a plot — counted separately). */
  treesHarvested: number;
  /** Currency that has passed through the farm, in and out. Both sides are kept:
   *  "you have 4,000 gold" says nothing about whether you have earned a million. */
  goldEarned: number;
  goldSpent: number;
  brainsEarned: number;
  brainsSpent: number;
  /** Zombies by how they were obtained, and how they left. */
  zombiesGrown: number;
  zombiesCombined: number;
  zombiesSold: number;
  zombiesLost: number;
  /** Invasions settled, either way. */
  raidsWon: number;
  raidsLost: number;
}

/** How many distinct crop keys a tally will remember. Well past the catalog's size;
 *  the cap exists so a damaged or hostile blob cannot grow without bound. */
const MAX_CROP_KEYS = 512;
/** Ceiling for any one counter. Above a safe integer the arithmetic stops being
 *  arithmetic, and no real farm approaches this. */
const MAX_COUNT = 1_000_000_000_000;

export function newFarmStats(startedAt: number): FarmStats {
  return {
    startedAt,
    harvested: {},
    planted: 0,
    plowed: 0,
    treesHarvested: 0,
    goldEarned: 0,
    goldSpent: 0,
    brainsEarned: 0,
    brainsSpent: 0,
    zombiesGrown: 0,
    zombiesCombined: 0,
    zombiesSold: 0,
    zombiesLost: 0,
    raidsWon: 0,
    raidsLost: 0,
  };
}

const count = (value: unknown): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_COUNT, n)) : 0;
};

/** Read a persisted tally back, whatever shape the blob turned out to be. A missing
 *  or damaged field is a zero, never a crash and never a NaN that would then poison
 *  every later increment. `now` seeds `startedAt` for a save that has no tally yet. */
export function sanitizeFarmStats(raw: unknown, now: number): FarmStats {
  const stats = newFarmStats(now);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return stats;
  const src = raw as Record<string, unknown>;
  const started = Math.trunc(Number(src.startedAt));
  // A future timestamp is a clock that was wrong, not a farm started tomorrow.
  if (Number.isFinite(started) && started > 0) stats.startedAt = Math.min(started, now);
  for (const key of [
    "planted", "plowed", "treesHarvested", "goldEarned", "goldSpent", "brainsEarned",
    "brainsSpent", "zombiesGrown", "zombiesCombined", "zombiesSold", "zombiesLost",
    "raidsWon", "raidsLost",
  ] as const) {
    stats[key] = count(src[key]);
  }
  const harvested = src.harvested;
  if (harvested && typeof harvested === "object" && !Array.isArray(harvested)) {
    for (const [key, value] of Object.entries(harvested as Record<string, unknown>)) {
      if (Object.keys(stats.harvested).length >= MAX_CROP_KEYS) break;
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) continue;
      const n = count(value);
      if (n > 0) stats.harvested[key] = n;
    }
  }
  return stats;
}

/** Total crops harvested, of every kind. */
export function totalHarvested(stats: FarmStats): number {
  let total = 0;
  for (const n of Object.values(stats.harvested)) total += n;
  return total;
}

/** The crop harvested most, or null on a farm that has not harvested anything.
 *  Ties break on the key so the answer is stable between two openings of the panel
 *  rather than following object-insertion order. */
export function favouriteCrop(stats: FarmStats): { key: string; count: number } | null {
  let best: { key: string; count: number } | null = null;
  for (const [key, n] of Object.entries(stats.harvested)) {
    if (n <= 0) continue;
    if (!best || n > best.count || (n === best.count && key < best.key)) best = { key, count: n };
  }
  return best;
}

/**
 * Fold two tallies of the SAME farm together, keeping the higher of each counter.
 *
 * The presentation blob is written wholesale, so whichever client writes last decides
 * what the account's tally says. That is fine while one device is playing — but a
 * client whose write loses the version CAS, or one that booted from a stale cached
 * snapshot, would otherwise push counts that are BEHIND what another device already
 * recorded and silently roll the account back.
 *
 * Taking the higher of each is enough because these counters only climb. It is not a
 * true merge and does not try to be: two devices playing at once would add up to more
 * than the max, but the writer lock means only one of them is ever counting. What this
 * guarantees is the property that matters — a tally can never go DOWN because of which
 * device happened to write last.
 *
 * `startedAt` goes the other way (the earlier of the two): it is the moment counting
 * began, so the older claim is the true one.
 */
export function mergeFarmStats(mine: FarmStats, theirs: FarmStats): FarmStats {
  const merged = newFarmStats(Math.min(mine.startedAt, theirs.startedAt));
  for (const key of [
    "planted", "plowed", "treesHarvested", "goldEarned", "goldSpent", "brainsEarned",
    "brainsSpent", "zombiesGrown", "zombiesCombined", "zombiesSold", "zombiesLost",
    "raidsWon", "raidsLost",
  ] as const) {
    merged[key] = Math.max(mine[key], theirs[key]);
  }
  merged.harvested = { ...mine.harvested };
  for (const [key, count] of Object.entries(theirs.harvested)) {
    merged.harvested[key] = Math.max(merged.harvested[key] ?? 0, count);
  }
  return merged;
}
