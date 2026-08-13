// Two mutations in the SAME SLOT can never both be worn, and the Zombie Pot resolves
// the conflict by bit — the one later in CATALOG wins outright (combineMasks). That
// makes a slot a strict tier ladder, and gives two failure modes worth catching:
//
//   IDENTICAL — same slot, same stat line. The lower-bit one is dead weight: it loses
//     every Pot conflict and gains nothing when it wins one. It is also the shape of
//     the Eyebiscus/Heartichoke defect (a dear, late crop granting a cheap, early
//     crop's bonus), which is what this file exists to stop recurring.
//   INVERTED — a LOWER-bit mutation that beats a higher one on every stat. The Pot
//     would throw the better one away. Nothing shipped does this, and nothing should:
//     it is unconditionally a bug, so it has no exemption list.
//
// A trade-off (more of one stat, less of another) is fine and deliberate — Coffeehead
// and Garlichead share the head slot and neither dominates.
import { describe, expect, it } from "vitest";
import { MUTATION_LIST, SLOTS, type MutationDef, type Stat } from "./mutations";

const STATS: Stat[] = ["str", "dex", "con"];
const statsOf = (d: MutationDef) => STATS.map((s) => d.stats[s] ?? 0);
const identical = (a: MutationDef, b: MutationDef) =>
  statsOf(a).every((v, i) => v === statsOf(b)[i]);
/** `a` is at least as good as `b` on every stat, and strictly better on one. */
const dominates = (a: MutationDef, b: MutationDef) =>
  statsOf(a).every((v, i) => v >= statsOf(b)[i]) && !identical(a, b);

/** Same-slot pairs, LOWER bit first — which is the one the Pot discards. */
function slotPairs(): [MutationDef, MutationDef][] {
  const pairs: [MutationDef, MutationDef][] = [];
  for (const slot of SLOTS) {
    const inSlot = MUTATION_LIST.filter((def) => def.slot === slot);
    for (let i = 0; i < inSlot.length; i++) {
      for (let j = i + 1; j < inSlot.length; j++) pairs.push([inSlot[i], inSlot[j]]);
    }
  }
  return pairs;
}

// Redundant pairs that shipped and have not been resolved yet, LOWER bit first.
//
// EMPTY, and meant to stay that way. Two pairs used to be here — Broccohair (broccoli,
// L23) == Cauli-hair (cauliflower, L29) and Garlichead (garlic, L25) == Pumpking
// (pumpking, L39) — both the same shape as the Eyebiscus/Heartichoke defect: a later,
// dearer crop granting an earlier, cheaper one's bonus. Cauli-hair went to +4 con and
// Pumpking to +4 str, so the ladders climb again. SHRINK THIS LIST, never add to it.
const KNOWN_IDENTICAL: readonly [string, string][] = [];

const exempt = (a: MutationDef, b: MutationDef) =>
  KNOWN_IDENTICAL.some(([lo, hi]) => lo === a.key && hi === b.key);

describe("no two mutations share a slot and a stat line", () => {
  it("adds no NEW redundant mutation", () => {
    const redundant = slotPairs()
      .filter(([lo, hi]) => identical(lo, hi) && !exempt(lo, hi))
      .map(([lo, hi]) =>
        `${lo.name} (${lo.key}) and ${hi.name} (${hi.key}) are both ${lo.slot} with the ` +
        `same bonus — ${lo.name} can never be worth having`);
    expect(redundant).toEqual([]);
  });

  it("keeps every exemption honest, so the list shrinks as they are fixed", () => {
    // A pair listed here that is no longer identical means somebody fixed it and left
    // the exemption behind, which would hide the next one to appear in its place.
    const stale = KNOWN_IDENTICAL.filter(([lo, hi]) =>
      !slotPairs().some(([a, b]) => a.key === lo && b.key === hi && identical(a, b)));
    expect(stale).toEqual([]);
  });

  it("never lets the Pot discard the better mutation", () => {
    const inverted = slotPairs()
      .filter(([lo, hi]) => dominates(lo, hi))
      .map(([lo, hi]) =>
        `${lo.name} beats ${hi.name} on every stat but sits LOWER in CATALOG, so the ` +
        `Zombie Pot would throw ${lo.name} away for it`);
    expect(inverted).toEqual([]);
  });
});
