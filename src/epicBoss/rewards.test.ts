import { describe, expect, it } from "vitest";
import zombieRows from "../../public/assets/zombies.json";
import questRows from "../../public/assets/quests.json";
import { purchasableZombies, type ZombieDef } from "../assets";
import { EPIC_BOSSES, epicBossUnlockLevel } from "./catalog";
import {
  EPIC_QUEST_ZOMBIE_REWARDS,
  epicBossCurrencyReward,
  epicQuestZombieReward,
  shouldStoreEpicReward,
} from "./rewards";

describe("Epic Boss zombie rewards", () => {
  it("maps every recovered zombie quest to a dedicated reward-only actor", () => {
    const zombies = zombieRows as ZombieDef[];
    const byKey = new Map(zombies.map((zombie) => [zombie.key, zombie]));
    const purchasable = new Set(purchasableZombies(zombies).map((zombie) => zombie.key));
    expect(Object.keys(EPIC_QUEST_ZOMBIE_REWARDS)).toHaveLength(15);
    for (const [questId, key] of Object.entries(EPIC_QUEST_ZOMBIE_REWARDS)) {
      const quest = questRows[questId as keyof typeof questRows];
      const zombie = byKey.get(key);
      expect(quest.rewardType).toBe(5);
      expect(quest.rewardItemKey).toBe(key);
      expect(zombie?.rewardOnly).toBe(true);
      expect(zombie?.specialSprite).toMatch(/\.png$/);
      expect(purchasable.has(key)).toBe(false);
      expect(epicQuestZombieReward(questId)).toBe(key);
    }
  });

  it("delivers to the farm until its cap is full, then uses storage", () => {
    expect(shouldStoreEpicReward(15, 16)).toBe(false);
    expect(shouldStoreEpicReward(16, 16)).toBe(true);
  });
});

describe("Epic Boss currency rewards", () => {
  it("awards brains only on every 5th level, with a bonus on the final one", () => {
    // Non-milestone levels grant no brains (post-brainflation revert).
    expect(epicBossCurrencyReward(1).brains).toBe(0);
    expect(epicBossCurrencyReward(6).brains).toBe(0);
    expect(epicBossCurrencyReward(19).brains).toBe(0);
    // Every 5th level grants one brain.
    expect(epicBossCurrencyReward(5).brains).toBe(1);
    expect(epicBossCurrencyReward(10).brains).toBe(1);
    expect(epicBossCurrencyReward(15).brains).toBe(1);
    // The last rung of the ladder grants a bonus brain: 5 for a full clear.
    expect(epicBossCurrencyReward(20).brains).toBe(2);
  });

  it("pays the bonus at each boss's own top, not a hardcoded level", () => {
    expect(epicBossCurrencyReward(20, 20).brains).toBe(2);
    expect(epicBossCurrencyReward(15, 20).brains).toBe(1);
    // A hypothetical longer event pays its bonus at its own final rung instead.
    expect(epicBossCurrencyReward(20, 30).brains).toBe(1);
    expect(epicBossCurrencyReward(30, 30).brains).toBe(2);
  });

  it("pays every ladder the same 5 brains for a full clear", () => {
    for (const boss of EPIC_BOSSES) {
      let brains = 0;
      for (let level = 1; level <= boss.maxLevel; level++) {
        brains += epicBossCurrencyReward(level, boss.maxLevel).brains;
      }
      expect(brains).toBe(5);
    }
  });

  it("leaves the gold reward at its pre-revert per-level curve", () => {
    expect(epicBossCurrencyReward(1).gold).toBe(100);
    expect(epicBossCurrencyReward(5).gold).toBe(100);
    expect(epicBossCurrencyReward(6).gold).toBe(200);
    expect(epicBossCurrencyReward(20).gold).toBe(500);
  });
});

describe("Epic Boss damage ramp", () => {
  // Boss damage = str x 10 per swing, one swing every 1/dex seconds (enemy clock).
  const bossDps = (boss: (typeof EPIC_BOSSES)[number]) =>
    boss.unitStats.str * 10 * boss.unitStats.dex;

  it("ramps damage with the unlock level, weakest event first", () => {
    const byUnlock = [...EPIC_BOSSES].sort(
      (a, b) => epicBossUnlockLevel(a) - epicBossUnlockLevel(b)
    );
    expect(byUnlock.map((b) => [b.id, Math.round(bossDps(b))])).toEqual([
      ["dr-groundhog", 40],
      ["bully-frog", 48],
      ["rocky-rhino", 56],
      ["general-larvaelus", 64],
      ["mystical-mamba", 72],
      ["foul-owl", 80],
      ["skunkarella", 90],
      ["loco-locust", 100],
    ]);
  });

  it("never lets a later event hit softer than an earlier one", () => {
    const byUnlock = [...EPIC_BOSSES].sort(
      (a, b) => epicBossUnlockLevel(a) - epicBossUnlockLevel(b)
    );
    for (let i = 1; i < byUnlock.length; i++) {
      expect(bossDps(byUnlock[i])).toBeGreaterThan(bossDps(byUnlock[i - 1]));
    }
  });

  it("caps the ramp where the top boss's own top prize can still tank it", () => {
    // Vagabond Zombie (Loco Locust's omega, 2835 HP with its +5% All) has to remain a
    // legal front unit for its own event. Measured in BattleSim with the fight played
    // correctly: it survives 100 DPS and dies at 120. Do not raise this without
    // re-measuring — casualties are permanent and a full clear is 40+ attempts, so a
    // multiplier that kills the front unit costs one zombie PER ATTEMPT, not per level.
    const hardest = Math.max(...EPIC_BOSSES.map(bossDps));
    expect(hardest).toBeLessThanOrEqual(100);
  });

  it("keeps each boss's hit rhythm — only power is retuned", () => {
    // dex is character, not difficulty: Skunkarella throws fast small hits and ramps
    // from a str 1 base, so scaling it like the str 2 bosses would double its damage.
    const skunk = EPIC_BOSSES.find((b) => b.id === "skunkarella")!;
    expect(skunk.unitStats.dex).toBe(4);
    expect(skunk.unitStats.str).toBe(2.25);
    expect(bossDps(skunk)).toBe(90);
    for (const boss of EPIC_BOSSES.filter((b) => b.id !== "skunkarella")) {
      expect(boss.unitStats.dex).toBe(2);
    }
  });
});

describe("Epic Boss ladders", () => {
  it("runs every event over the 20 rungs ZF2 actually authored", () => {
    for (const boss of EPIC_BOSSES) {
      expect(boss.maxLevel).toBe(20);
      expect(boss.multipliers).toHaveLength(20);
      // The curve must still climb to the top: the old 40-rung ladders were padding
      // levels 21-40 with a copy of level 20, which is exactly what was cut.
      expect(boss.multipliers[boss.maxLevel - 1]).toBeGreaterThan(boss.multipliers[0]);
      expect(new Set(boss.multipliers).size).toBe(boss.multipliers.length);
    }
  });
});
