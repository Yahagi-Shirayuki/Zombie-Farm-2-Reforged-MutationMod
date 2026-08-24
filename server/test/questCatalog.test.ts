import { describe, it, expect } from "vitest";
import { QUEST_REWARDS, questReward, QUEST_REWARD } from "../src/questCatalog";
import questRows from "../../public/assets/quests.json";

describe("questCatalog — mirror of quests.json rewards", () => {
  it("has every source quest with sane, bounded reward values", () => {
    const ids = Object.keys(QUEST_REWARDS);
    expect(ids).toHaveLength(Object.keys(questRows).length);
    for (const [id, r] of Object.entries(QUEST_REWARDS)) {
      expect(Number.isInteger(r.rewardValue), id).toBe(true);
      expect(r.rewardValue, id).toBeGreaterThanOrEqual(0);
      // Repriced against the level curve (tools/quest_xp_rebalance.py): the top of
      // the catalog is now the 40% invasion band at level 36.
      expect(r.rewardValue, id).toBeLessThanOrEqual(5000);
      expect([0, 1, 2, 3, 5], id).toContain(r.rewardType);
    }
  });
  // The mirror is hand-maintained while quests.json is GENERATED, so the two drift
  // silently: nothing here used to compare the actual payouts, and the server grants
  // from this table. A stale entry underpays every player who finishes that quest
  // and looks like a client bug from the outside.
  it("pays exactly what quests.json says, for every quest", () => {
    for (const [id, quest] of Object.entries(questRows as Record<string, {
      rewardType: number; rewardValue: number;
    }>)) {
      const mirrored = QUEST_REWARDS[id];
      expect(mirrored, `quests.json ${id} is missing from the mirror`).toBeDefined();
      expect(mirrored.rewardType, `mirror ${id} rewardType`).toBe(quest.rewardType);
      expect(mirrored.rewardValue, `mirror ${id} rewardValue`).toBe(quest.rewardValue);
    }
  });

  it("resolves known quest rewards and rejects unknown ids", () => {
    expect(questReward("0")).toEqual({ rewardType: QUEST_REWARD.Xp, rewardValue: 20, rewardItemKey: "" });
    expect(questReward("54")).toMatchObject({ rewardType: QUEST_REWARD.Gold, rewardValue: 20 });
    expect(questReward("99999")).toBeUndefined();
    expect(questReward("")).toBeUndefined();
  });
});

describe("questCatalog — item reward keys", () => {
  it("carries a rewardItemKey for every item reward that names an item", () => {
    for (const [id, quest] of Object.entries(questRows as Record<string, {
      rewardType: number; rewardItem?: string; rewardItemKey?: string;
    }>)) {
      if (quest.rewardType !== QUEST_REWARD.Item || !quest.rewardItem) continue;
      // An empty key silently drops the reward: every grant path guards on the KEY.
      expect(quest.rewardItemKey, `quests.json ${id} (${quest.rewardItem})`).toBe(quest.rewardItem);
      expect(QUEST_REWARDS[id]?.rewardItemKey, `mirror ${id}`).toBe(quest.rewardItem);
    }
  });
});
