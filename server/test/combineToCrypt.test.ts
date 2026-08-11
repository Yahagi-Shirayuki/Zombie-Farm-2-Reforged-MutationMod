// Collecting a finished Zombie Pot job must advance a "collect N from the Pot"
// objective whatever happens — the child's destination is a placement choice, and
// whether it promoted to a new species is a property of the parents, not of the act of
// collecting. Both used to suppress the count: the only event the Pot emitted at
// collection time was the PROMOTION one, so an ordinary combine advanced nothing, and
// the symptom showed up on the Mausoleum because a full farm is exactly when a player
// is combining hardest.
import { describe, it, expect } from "vitest";
import { applyCommandBatch, freshGameplayState } from "../src/v3/engine";
import type { GameplayCommand } from "../../src/net/protocol";
import type { MutableGameplayState } from "../src/v3/engine";

const NOW = Date.UTC(2026, 7, 9, 12);
const commands = (...list: GameplayCommand[]) =>
  list.map((command, index) => ({ sequence: index + 1, command }));

/** A matched pair climbs the colour ladder to a species neither parent was. */
const PROMOTING: [string, string] = ["ZombieActorRegularTier1", "ZombieActorRegularTier1"];
/** A mismatched pair hands back slot 1's own species — the ordinary case. */
const PLAIN: [string, string] = ["ZombieActorRegularTier1Carrots", "ZombieActorRegularTier1Tomatoes"];

function farmWithParents([keyA, keyB]: [string, string]): MutableGameplayState {
  const state = freshGameplayState();
  state.balance.gold = 500_000;
  state.balance.xp = 20_500; // level 25 — past Master Combiner's level-20 gate
  state.objects.objects = [
    { instanceId: "pot-1", catalogKey: "zombieCombiner", status: "placed" },
    { instanceId: "crypt-1", catalogKey: "mausoleum3", status: "placed" },
    // The colour ladder is grave-gated: a matched pair only climbs into a class the
    // farm owns the grave for.
    { instanceId: "g-blue", catalogKey: "gravestoneBlue", status: "placed" },
    { instanceId: "g-red", catalogKey: "gravestoneRed", status: "placed" },
    { instanceId: "g-silver", catalogKey: "gravestoneSilver", status: "placed" },
  ];
  state.roster = [
    { id: "pa", key: keyA, mutation: 0, invasions: 0, stored: false },
    { id: "pb", key: keyB, mutation: 0, invasions: 0, stored: false },
  ];
  return state;
}

function collect(stored: boolean, parents: [string, string] = PROMOTING) {
  const started = applyCommandBatch(farmWithParents(parents), commands(
    { type: "roster.combine_start", potId: "pot-1", parentAId: "pa", parentBId: "pb", playerLevel: 25 },
  ), { now: NOW, accountId: "acct" });
  expect(started.results[0].status).toBe("applied");
  return applyCommandBatch(started.state, commands(
    { type: "roster.combine", potId: "pot-1", parentAId: "pa", parentBId: "pb", playerLevel: 25, stored },
  ), { now: NOW + 3_600_000, accountId: "acct" });
}

const breederCount = (result: ReturnType<typeof collect>) =>
  result.questChanges.find((c) => c.questId === "20004")?.counts[0];

/** Run one more combine on a CARRIED state: seed two fresh parents, start, collect.
 *  Master Combiner counts collections, not parents, so restocking between cycles is
 *  the honest way to ask "does the tenth one still count". */
function collectAgain(
  state: MutableGameplayState, cycle: number, stored: boolean, [keyA, keyB]: [string, string]
) {
  const seeded: MutableGameplayState = {
    ...state,
    roster: [
      ...state.roster,
      { id: `a${cycle}`, key: keyA, mutation: 0, invasions: 0, stored: false },
      { id: `b${cycle}`, key: keyB, mutation: 0, invasions: 0, stored: false },
    ],
  };
  const started = applyCommandBatch(seeded, commands(
    { type: "roster.combine_start", potId: "pot-1", parentAId: `a${cycle}`, parentBId: `b${cycle}`, playerLevel: 25 },
  ), { now: NOW + cycle * 7_200_000, accountId: "acct" });
  expect(started.results[0].status, `cycle ${cycle} start`).toBe("applied");
  return applyCommandBatch(started.state, commands(
    { type: "roster.combine", potId: "pot-1", parentAId: `a${cycle}`, parentBId: `b${cycle}`, playerLevel: 25, stored },
  ), { now: NOW + cycle * 7_200_000 + 3_600_000, accountId: "acct" });
}

describe("collecting a combine from the Zombie Pot", () => {
  it("lands the child in the crypt when asked", () => {
    const result = collect(true);
    expect(result.results[0].status).toBe("applied");
    const child = result.state.roster.find((u) => u.id !== "pa" && u.id !== "pb");
    expect(child?.stored).toBe(true);
  });

  // The reported bug.
  it("counts toward Master Combiner when collected into the Mausoleum", () => {
    expect(breederCount(collect(true))).toBe(1);
  });

  it("counts the same collected onto the farm", () => {
    expect(breederCount(collect(false))).toBe(1);
  });

  // The other half: an ordinary, non-promoting combine is still a collection.
  it("counts an ordinary combine that promoted to nothing, to either destination", () => {
    expect(breederCount(collect(false, PLAIN))).toBe(1);
    expect(breederCount(collect(true, PLAIN))).toBe(1);
  });

  // "Counts ALL zombies collected from the Pot": every collection in a row, whatever
  // the parents were and wherever the child went.
  it("accumulates across a run of mixed collections", () => {
    let state = farmWithParents(PROMOTING);
    state.roster = []; // collectAgain seeds its own parents each cycle
    const mix: [boolean, [string, string]][] = [
      [false, PROMOTING], [true, PLAIN], [true, PROMOTING], [false, PLAIN],
      [false, PROMOTING], [true, PLAIN],
    ];
    mix.forEach(([stored, parents], index) => {
      const result = collectAgain(state, index + 1, stored, parents);
      expect(result.results[0].status, `cycle ${index + 1}`).toBe("applied");
      expect(breederCount(result), `after ${index + 1} collections`).toBe(index + 1);
      state = result.state;
    });
  });

  it("produces identical quest progress whichever destination is chosen", () => {
    const ids = (r: ReturnType<typeof collect>) => r.questChanges.map((c) => c.questId).sort();
    expect(ids(collect(true))).toEqual(ids(collect(false)));
    expect(ids(collect(true, PLAIN))).toEqual(ids(collect(false, PLAIN)));
  });

  // Regression guard for the imported catalog. Every catalog quest on the promotion
  // event names a SPECIFIC species ("Cook Up Some Zombies" wants a Robo Zombie), so
  // neither pair here can trip one — which is the point: the new collection event must
  // not have widened into them. A plain combine touches the collection quest and
  // nothing else.
  it("advances the collection quest without dragging in the promotion-gated ones", () => {
    for (const parents of [PROMOTING, PLAIN]) {
      for (const stored of [false, true]) {
        const result = collect(stored, parents);
        expect(result.questChanges.map((c) => c.questId)).toEqual(["20004"]);
      }
    }
  });
});
