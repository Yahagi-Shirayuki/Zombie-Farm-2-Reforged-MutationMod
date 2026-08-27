// How many items the shed holds — DERIVED from the shed standing on the farm, never
// carried in the save.
//
// The number used to be raised in place by every path that put a bigger shed down
// (`upgradeStorage`, which only ever raised it) and otherwise read straight back out
// of `storage.itemCap`. That made the cap a second, independent record of something
// the farm already states — and the two could disagree:
//
//   - The online bootstrap projection had no shed capacity to project (the server
//     derives it), so it wrote a flat 8. The live cap was corrected later by the
//     object reconcile, but anything serialised before that reconcile — most
//     visibly the closedown export-only handoff, which exports at boot — carried 8.
//   - Import takes the file at its word. So a farm with a McDonnell's Barn came back
//     with a shed panel showing 8 slots, hiding everything above the eighth item,
//     while the Market (which asks the placed object) still offered the NEXT tier up.
//
// Derived, the capacity is a function of the placed shed, so no save, import, or
// placement path can be wrong about it for longer than it takes to recompute.
// Same lesson, same shape, as armyCapacity.ts.

/** Slots a farm has with no shed on it at all. Also the Shabby Shed's own capacity,
 *  which is why a farm that has lost track of its shed still shows eight. */
export const BASE_SHED_SLOTS = 8;

/** The largest `storageSlots` among the placed objects, floored at the base. Only one
 *  shed can stand on a farm (placementLimit.ts), and a shed can be neither sold nor
 *  packed away, so in practice this reads that one shed's tier. `slotsOf` resolves a
 *  catalog key to its capacity (undefined for anything that is not a shed). */
export function shedCapacityOf(
  placedKeys: Iterable<string>,
  slotsOf: (key: string) => number | undefined,
): number {
  let cap = BASE_SHED_SLOTS;
  for (const key of placedKeys) cap = Math.max(cap, slotsOf(key) ?? 0);
  return cap;
}
