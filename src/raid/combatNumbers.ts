// The arithmetic behind the optional battlefield numbers (Settings → Display →
// "Health Bar Numbers" / "Damage Numbers"). Pixi lives in RaidScene; what is worth
// testing is when a number is due and what it reads, so that part lives here.
//
// Nothing in this file may influence the fight. Every value is derived from state the
// simulation has already decided — a raid plays out tick-for-tick identically with
// the numbers on, which is what lets them ride a deterministic, server-verified
// replay at all (see raid/replay.ts).
//
// A damage number reports the ATTACK, not the health it removed. The scene feeds this
// from `SimUnit.damageFxTaken`, the sim's running total of post-mitigation damage aimed
// at a unit, rather than from an HP delta. The two differ wherever the fight clamps a
// hit — a blow larger than the target's remaining health, and the one-shot protection
// latch that snaps a doomed zombie to 1 HP — and it was the clamped figure, not the
// blow, that a player was reading off the screen. Armor, damage reduction and attack
// multipliers are all applied BEFORE the total is fed, so a mitigated hit still reads
// as mitigated and a fully blocked one produces no number at all.

/** A hit smaller than this is held back rather than shown as its own number. The
 *  `pixelFire` burn removes 5 % of max HP a SECOND, spread over 20 sim ticks — a
 *  number per tick would be a column of "0"s up the screen. */
export const DAMAGE_NUMBER_MIN = 1;

/** Minimum gap between two numbers for the SAME unit. A zombie surrounded by three
 *  enemies still shows every hit; a burning one shows a running total five times a
 *  second instead of twenty. */
export const DAMAGE_NUMBER_GAP_SEC = 0.2;

/** Per-unit damage held back since that unit's last number. */
export interface DamageTally {
  /** Damage seen but not yet shown. */
  pending: number;
  /** Seconds before this unit may show another number. */
  cooldown: number;
}

export function newDamageTally(): DamageTally {
  return { pending: 0, cooldown: 0 };
}

/**
 * Fold one tick's damage into `tally` and decide whether a number is due now.
 * Returns the whole number to show, or null to keep accumulating.
 *
 * `final` (the unit just died) flushes whatever is pending regardless of the size
 * and gap rules: the killing blow is the one hit a player most wants to see, and a
 * dead unit will never come back for a later flush.
 */
export function tallyDamage(
  tally: DamageTally, damage: number, dtSec: number, final = false
): number | null {
  if (damage > 0) tally.pending += damage;
  tally.cooldown = Math.max(0, tally.cooldown - Math.max(0, dtSec));
  if (tally.pending <= 0) return null;
  if (!final && (tally.cooldown > 0 || tally.pending < DAMAGE_NUMBER_MIN)) return null;
  // Rounded, but never to nothing: a real hit that lands reads as at least 1, or a
  // burn tick would report that it did nothing at all.
  const shown = Math.max(1, Math.round(tally.pending));
  tally.pending = 0;
  tally.cooldown = DAMAGE_NUMBER_GAP_SEC;
  return shown;
}

/** What a health bar's number reads: HP left over the maximum that bar represents.
 *
 *  HP is rounded UP so a unit still standing on a sliver never advertises 0 — the
 *  bar is drawn from the same fraction, and a bar with a hair of colour left in it
 *  saying "0/40" is the one reading a player would call a bug. */
export function formatHealthNumbers(hp: number, maxHp: number): string {
  const max = Math.max(0, Math.round(maxHp));
  const left = Math.max(0, Math.min(max, Math.ceil(hp)));
  return `${left}/${max}`;
}
