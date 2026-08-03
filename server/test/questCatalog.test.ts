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
      expect(r.rewardValue, id).toBeLessThanOrEqual(1000); // catalog max is 700
      expect([0, 1, 2, 3, 5], id).toContain(r.rewardType);
    }
  });
  it("resolves known quest rewards and rejects unknown ids", () => {
    expect(questReward("0")).toEqual({ rewardType: QUEST_REWARD.Xp, rewardValue: 30, rewardItemKey: "" });
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
