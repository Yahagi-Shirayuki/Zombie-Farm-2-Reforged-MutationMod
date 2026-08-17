// A FREE placement waiting for its tap.
//
// Two of them exist: taking a copy back out of the shed, and putting down a
// Received reward. Both are armed by entering placement mode for one particular
// def, and both are spent — irreversibly — by the next valid tap: the shed copy
// (or the reward) is consumed, and whatever the HUD is currently placing goes
// down in its place, for free and under the stored item's identity.
//
// That makes the arming only as good as its def. Leaving placement mode is not
// the only way to abandon one: choosing a DIFFERENT item from the Market calls
// setPlacing again without ever leaving "place" mode. An arming that survived
// that was spent on the wrong object — a Zombie Monolith taken out of the shed
// and then swapped for a daisy was destroyed by the tap that placed the daisy,
// which paid nothing and carried none of the Monolith's +4 army slots. Storing
// the Monolith cost four slots and taking it back out never returned them.

/** Whether a pending retrieve / Received placement still describes what is about
 *  to be placed. `armedKey` is the catalog key the arming was made for; a missing
 *  one means nothing is armed. */
export function armingSurvives(
  mode: string,
  placingKey: string | undefined,
  armedKey: string | undefined,
): boolean {
  return mode === "place" && !!armedKey && placingKey === armedKey;
}
