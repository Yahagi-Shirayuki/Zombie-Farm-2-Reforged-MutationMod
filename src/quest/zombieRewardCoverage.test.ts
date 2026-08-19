// A quest whose reward is a ZOMBIE is not paid by the quest engine — neither the
// client's `dispatchReward` nor the Worker's `completeQuest` grants a unit for reward
// type 5. That is safe for exactly one reason: every such quest today is an Epic Boss
// prize quest, and the boss's own settlement pays it through `epicQuestZombieReward`
// into the authoritative roster (or Received, when the army is full).
//
// It is safe only for as long as that stays true. Add one zombie-reward quest outside
// the Epic Boss chains and it completes, celebrates, and hands over nothing — online
// AND offline, with no error anywhere. The README asserted for a while that this was
// already happening; it wasn't, but nothing in the build was checking either way.
import { describe, expect, it } from "vitest";
import imported from "../../public/assets/quests.json";
import reforged from "../../public/assets/quests_reforged.json";
import { EPIC_QUEST_ZOMBIE_REWARDS, epicQuestZombieReward } from "../epicBoss/rewards";
import { RewardType } from "./types";

const CATALOGS: [string, Record<string, { rewardType?: number; rewardItemKey?: string; epicEvent?: boolean }>][] = [
  ["quests.json", imported as never],
  ["quests_reforged.json", reforged as never],
];

const zombieRewardQuests = () => CATALOGS.flatMap(([catalog, quests]) =>
  Object.entries(quests)
    .filter(([, def]) => def.rewardType === RewardType.Zombie)
    .map(([id, def]) => ({ catalog, id, def })));

describe("every zombie-reward quest is actually paid by something", () => {
  it("is an Epic Boss quest with a mapped prize", () => {
    const rows = zombieRewardQuests();
    expect(rows.length).toBeGreaterThan(0); // the check is worthless if it matches nothing

    for (const { catalog, id, def } of rows) {
      expect(def.epicEvent, `${catalog}:${id} pays a zombie but is not an epic quest`).toBe(true);
      expect(epicQuestZombieReward(id), `${catalog}:${id} has no entry in EPIC_QUEST_ZOMBIE_REWARDS`)
        .not.toBeNull();
    }
  });

  it("agrees with the catalog about WHICH zombie", () => {
    for (const { catalog, id, def } of zombieRewardQuests()) {
      // The prize map is the authority (several source quests point at generic actor
      // classes), but where the catalog names a key too, the two must not disagree —
      // that is the pair of values a player compares when they say they got the wrong
      // zombie.
      if (def.rewardItemKey) {
        expect(epicQuestZombieReward(id), `${catalog}:${id}`).toBe(def.rewardItemKey);
      }
    }
  });

  it("maps no prize for a quest that does not exist", () => {
    const known = new Set(CATALOGS.flatMap(([, quests]) => Object.keys(quests)));
    for (const id of Object.keys(EPIC_QUEST_ZOMBIE_REWARDS)) {
      expect(known.has(id), `EPIC_QUEST_ZOMBIE_REWARDS has ${id}, which no catalog defines`).toBe(true);
    }
  });
});
