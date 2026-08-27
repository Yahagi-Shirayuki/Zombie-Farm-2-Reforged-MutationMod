// Period arithmetic for daily / weekly quests.
//
// Both clocks are UTC and derived purely from epoch milliseconds. That is deliberate:
// the server has to be able to decide, on its own, which period a claim belongs to,
// and a local-timezone reset would make that undecidable (the client could name any
// offset it liked). A fixed global reset is also the only way two devices on one
// account agree about when the day rolled over.

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

/** UTC day index — the number of whole days since the epoch. */
export function dayIndex(now: number): number {
  return Math.floor(now / DAY_MS);
}

/** Monday-aligned week index.
 *
 *  Epoch day 0 (1970-01-01) was a THURSDAY, so shifting by 3 days puts a Monday on
 *  every multiple of seven: day 4 (Mon 1970-01-05) → week 1, day 10 (Sun) → week 1,
 *  day 11 (Mon) → week 2. */
export function weekIndex(now: number): number {
  return Math.floor((dayIndex(now) + 3) / 7);
}

/** Epoch ms at which the current UTC day ends (00:00 UTC tomorrow). */
export function dayEndsAt(now: number): number {
  return (dayIndex(now) + 1) * DAY_MS;
}

/** Epoch ms at which the current week ends (00:00 UTC next Monday). */
export function weekEndsAt(now: number): number {
  return ((weekIndex(now) + 1) * 7 - 3) * DAY_MS;
}

export function periodIndex(scope: "daily" | "weekly", now: number): number {
  return scope === "daily" ? dayIndex(now) : weekIndex(now);
}

export function periodEndsAt(scope: "daily" | "weekly", now: number): number {
  return scope === "daily" ? dayEndsAt(now) : weekEndsAt(now);
}
