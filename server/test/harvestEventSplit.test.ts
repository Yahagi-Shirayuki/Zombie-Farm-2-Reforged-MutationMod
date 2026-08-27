// Which harvest event a plot emits, and therefore which quests it can advance.
//
// The two are MUTUALLY EXCLUSIVE: a vegetable plot emits kCropHarvestedNotification and
// a zombie crop emits kCropHarvestedZombieNotification, never both. That is the
// imported behaviour and it is fine — what is not fine is a quest whose wording implies
// otherwise, which is how "Collect N from the Zombie Pot" went wrong. Pinned here so
// the next "harvest" objective is written against what actually fires.
import { describe, it, expect } from "vitest";
import { applyCommandBatch, freshGameplayState } from "../src/v3/engine";
import type { GameplayCommand } from "../../src/net/protocol";
import type { MutableGameplayState } from "../src/v3/engine";

const NOW = Date.UTC(2026, 7, 9, 12);
const commands = (...list: GameplayCommand[]) =>
  list.map((command, index) => ({ sequence: index + 1, command }));

function farm(): MutableGameplayState {
  const state = freshGameplayState();
  state.balance.gold = 500_000;
  state.balance.brains = 500;
  state.balance.xp = 20_500; // level 25
  return state;
}

/** Plow, plant `cropKey`, wait it out, harvest. Returns the quest progress it moved. */
function harvest(cropKey: string) {
  const planted = applyCommandBatch(farm(), commands(
    { type: "farm.plow", oc: 0, or: 0 },
    { type: "farm.plant", oc: 0, or: 0, cropKey },
  ), { now: NOW, accountId: "acct" });
  expect(planted.results.every((r) => r.status === "applied"), cropKey).toBe(true);
  const reaped = applyCommandBatch(planted.state, commands(
    { type: "farm.harvest", oc: 0, or: 0 },
  ), { now: NOW + 3 * 86_400_000, accountId: "acct" });
  expect(reaped.results[0].status, cropKey).toBe("applied");
  return reaped.questChanges.map((c) => c.questId);
}

describe("harvest events are split by crop kind", () => {
  // "Green Fingers" (20002) is the wildcard kCropHarvestedNotification quest.
  it("advances the crop-harvest quest for a vegetable", () => {
    expect(harvest("carrot")).toContain("20002");
  });

  it("does NOT advance it for a zombie crop", () => {
    expect(harvest("ZombieActorRegularTier1")).not.toContain("20002");
  });

  it("is the reason a 'harvest crops' objective must not promise zombie crops", () => {
    const veg = harvest("carrot");
    const zombie = harvest("ZombieActorRegularTier1");
    expect(veg).not.toEqual(zombie);
  });
});
