// Recolour families for quest matching.
//
// 17 pieces of decor art are sold in several colours — one Hedge sprite is six
// market cards, one crate is seven (see docs/DECOR_RESTORATION_PLAN.md D1). Each
// colour is its own catalog key, so a quest asking to "buy a Fence" would not count
// the Blue Fence the player actually bought.
//
// The source data shows this was never the intent: quest 27 reads "Buy 2 Red
// Balloons" but its requirement matches the bare name "Balloon", and quest 9 reads
// "Buy 4 White Fences" against "Fence". The objective names a colour and matches the
// family. So every member of a family answers to its siblings' names, and a
// requirement naming ANY of them is satisfied by ANY of them.
//
// Carried on the event as `aliases` rather than emitted as extra events, because a
// requirement with an empty (wildcard) subject counts every event it sees — a second
// event would double-count. Same mechanism the mutant species use (mutantSubjects).

/** The fields this needs from a catalog row (client `PlaceableDef`, server `ObjectRule`). */
export interface VariantRow {
  key: string;
  name: string;
  /** Base tile this row recolours. Absent on ordinary items and on the base itself. */
  variantOf?: string;
}

/**
 * Map each recoloured key to the OTHER names in its family. Keys with no siblings
 * are absent, so the common case allocates nothing and callers can pass the result
 * of `get` straight through as the event's aliases.
 */
export function objectQuestAliases(
  rows: readonly VariantRow[]
): ReadonlyMap<string, readonly string[]> {
  const families = new Map<string, VariantRow[]>();
  for (const row of rows) {
    const family = row.variantOf ?? row.key;
    const members = families.get(family);
    if (members) members.push(row);
    else families.set(family, [row]);
  }

  const aliases = new Map<string, readonly string[]>();
  for (const members of families.values()) {
    if (members.length < 2) continue; // not a family — nothing to answer to
    for (const member of members) {
      // A family can repeat a name (the two Fence Gate states are both "Fence
      // Gate"); dedupe, and never alias a row to the name it already posts.
      const others = [...new Set(
        members.map((other) => other.name).filter((name) => name !== member.name)
      )];
      if (others.length) aliases.set(member.key, others);
    }
  }
  return aliases;
}
