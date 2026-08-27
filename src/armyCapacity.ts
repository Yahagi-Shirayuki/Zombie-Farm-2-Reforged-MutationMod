// How many zombies the farm can hold — DERIVED from what is standing on it, never
// accumulated.
//
// The cap used to be a running total: every path that put a Zombie Monolith down
// added its +4 and every path that took one away subtracted it, across six call
// sites. Online that was harmless, because the object reconcile re-derived the cap
// from the field on every authoritative response and healed any drift. Offline
// there is no reconcile, so a single unpaired branch desynced the number for good
// — and once the farm held a Monolith whose +4 had never been counted, storing it
// subtracted four slots the cap had never been given, and the player dropped to 12.
// (A reload floored them back to 16, so they could hit 12 again and again.)
//
// Deriving it makes that class of bug unrepresentable: the cap is a function of the
// placed objects, so a placement path that forgets to announce itself can no longer
// be wrong about anything except when the answer is recomputed.

/** Army slots a farm has before any object adds to them. Mirrors the server's
 *  DEFAULT_ARMY_SIZE; online the server sends its own base, which wins. */
export const BASE_ARMY_MAX = 16;

/** `base` plus every placed object's `armyMax`. `armyMaxOf` resolves a catalog key
 *  to its bonus (0 for anything that grants none, including unknown keys). */
export function armyCapacityOf(
  base: number,
  placedKeys: Iterable<string>,
  armyMaxOf: (key: string) => number | undefined,
): number {
  let cap = base;
  for (const key of placedKeys) cap += Math.max(0, armyMaxOf(key) ?? 0);
  return cap;
}
