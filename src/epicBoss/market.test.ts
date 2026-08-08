import { describe, expect, it } from "vitest";
import questRows from "../../public/assets/quests.json";
import {
  EPIC_BOSSES,
  SKUNKARELLA,
  epicBossUnlockLevel,
} from "./catalog";
import { epicZombieRewardNotes, visibleEpicBosses } from "./market";
import type { QuestDef } from "../quest/types";

describe("Epic Boss market", () => {
  it("shows every boss until an event is active, then only shows that boss", () => {
    expect(visibleEpicBosses(EPIC_BOSSES, null)).toHaveLength(8);
    expect(visibleEpicBosses(EPIC_BOSSES, "foul-owl").map((boss) => boss.id)).toEqual(["foul-owl"]);
  });

  it("gates each Epic Boss by how strong its prize zombies are", () => {
    // Weakest prizes first, so the level that unlocks an event tracks what it pays out.
    expect(EPIC_BOSSES.map((boss) => [boss.id, epicBossUnlockLevel(boss)] as const)
      .sort((a, b) => a[1] - b[1])).toEqual([
      ["dr-groundhog", 24],
      ["bully-frog", 28],
      ["rocky-rhino", 30],
      ["general-larvaelus", 32],
      ["mystical-mamba", 34],
      ["foul-owl", 38],
      ["skunkarella", 40],
      ["loco-locust", 42],
    ]);
  });

  it("keeps every unlock reachable and strictly ordered", () => {
    const levels = EPIC_BOSSES.map((boss) => epicBossUnlockLevel(boss));
    expect(new Set(levels).size).toBe(levels.length); // no two events share a rung
    expect(Math.max(...levels)).toBeLessThanOrEqual(45); // the player level cap
  });

  it("describes special zombie rewards at their quest milestones", () => {
    const quests = questRows as Record<string, QuestDef>;
    const notes = epicZombieRewardNotes(SKUNKARELLA, quests);
    expect(notes).toEqual([
      "Levels 3, 5, 8, 10: Diva Zombie",
      "Level 20: Madame Zombie",
    ]);
    expect(EPIC_BOSSES.flatMap((boss) => epicZombieRewardNotes(boss, quests))).toHaveLength(15);
  });

  it("keeps every prize quest on a rung its ladder actually has", () => {
    const quests = questRows as Record<string, QuestDef>;
    for (const boss of EPIC_BOSSES) {
      const levels = boss.questIds
        .flatMap((id) => quests[id]?.requirements ?? [])
        .filter((r) => r.notificationID === "kEpicStageEnemyDefeatedNotification")
        .map((r) => Number(r.notificationObject));
      for (const level of levels) {
        expect(level).toBeGreaterThanOrEqual(1);
        expect(level).toBeLessThanOrEqual(boss.maxLevel);
      }
      // Every ladder's loot has to be reachable too.
      for (const item of boss.loot) expect(item.level).toBeLessThanOrEqual(boss.maxLevel);
    }
  });
});
