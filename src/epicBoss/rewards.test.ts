import { describe, expect, it } from "vitest";
import zombieRows from "../../public/assets/zombies.json";
import questRows from "../../public/assets/quests.json";
import { purchasableZombies, type ZombieDef } from "../assets";
import { EPIC_BOSSES, epicBossUnlockLevel } from "./catalog";
import {
  EPIC_QUEST_ZOMBIE_REWARDS,
  EPIC_BRAIN_DROP_CHANCE,
  epicBossCurrencyReward,
  epicQuestZombieReward,
  reopenEpicQuests,
  shouldStoreEpicReward,
} from "./rewards";

describe("Epic Boss zombie rewards", () => {
  it("maps every recovered zombie quest to a dedicated reward-only actor", () => {
    const zombies = zombieRows as ZombieDef[];
    const byKey = new Map(zombies.map((zombie) => [zombie.key, zombie]));
    const purchasable = new Set(purchasableZombies(zombies).map((zombie) => zombie.key));
    // Two prize zombies per event — the ordinary one on rung 5, the omega on rung 10
    // (EPIC_PRIZE_RUNGS in tools/prep_quests.py). Rocky Rhino used to carry only the
    // first, so its top five rungs paid nothing; it now repeats Brock Coley on rung 10.
    expect(Object.keys(EPIC_QUEST_ZOMBIE_REWARDS)).toHaveLength(EPIC_BOSSES.length * 2);
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

describe("reopening an Epic Boss's quests for a new run", () => {
  const quests = () => ({
    completed: ["7", "1000", "1002"],
    progress: [
      { questId: "7", counts: [3] },
      { questId: "1000", counts: [1] },
      { questId: "1002", counts: [1] },
      { questId: "1010", counts: [4] },
    ],
  });

  it("clears a finished quest's completion AND its finished progress", () => {
    // Progress must go with it: left at its target, the reopened quest re-completes on
    // the first win of the new run regardless of which level that win was on.
    expect(reopenEpicQuests(quests(), ["1000", "1002", "1010"])).toEqual({
      completed: ["7"],
      progress: [{ questId: "7", counts: [3] }, { questId: "1010", counts: [4] }],
    });
  });

  it("keeps unfinished lifetime progress and other bosses' completions", () => {
    // 1010 ("win all 8 of this boss's prizes") is meant to be resumable across events,
    // and another boss's chain is none of this activation's business.
    const reopened = reopenEpicQuests(quests(), ["1000"])!;
    expect(reopened.completed).toEqual(["7", "1002"]);
    expect(reopened.progress).toContainEqual({ questId: "1010", counts: [4] });
  });

  it("reports no write when the boss has nothing finished to reopen", () => {
    expect(reopenEpicQuests(quests(), ["1010", "9999"])).toBeNull();
    expect(reopenEpicQuests({ completed: [], progress: [] }, ["1000"])).toBeNull();
  });
});

describe("Epic Boss currency rewards", () => {
  it("makes a brain a rare drop rather than a schedule", () => {
    // An epic event is not a brain faucet: it costs 3-5 brains to activate and every
    // attempt past your harvested tokens costs another, so a guaranteed payout made
    // finishing one profitable in the currency it was priced in. It now rolls.
    const never = () => 0.99;
    const always = () => 0;
    // Rungs 1-9 roll: the old milestone schedule (1 at rung 5, 4 at rung 10) is gone.
    for (let rung = 1; rung < 10; rung++) {
      expect(epicBossCurrencyReward(rung, 10, never).brains).toBe(0);
      expect(epicBossCurrencyReward(rung, 10, always).brains).toBe(1);
    }
    expect(epicBossCurrencyReward(5, 10, () => EPIC_BRAIN_DROP_CHANCE - 1e-9).brains).toBe(1);
    expect(epicBossCurrencyReward(5, 10, () => EPIC_BRAIN_DROP_CHANCE).brains).toBe(0);
  });

  it("guarantees the brain on the fight that ENDS a ladder", () => {
    // The capstone should never be the one clear that hands back nothing.
    expect(epicBossCurrencyReward(10, 10, () => 0.99).brains).toBe(1);
    // …at each event's own top rung, not a hardcoded 10.
    expect(epicBossCurrencyReward(20, 20, () => 0.99).brains).toBe(1);
    expect(epicBossCurrencyReward(10, 20, () => 0.99).brains).toBe(0);
  });

  it("draws from the generator whether or not the brain is guaranteed", () => {
    // The server hands the SAME generator on to the decor and ticket rolls, so a branch
    // that skipped the draw would shift every later roll on exactly the clears that
    // finish a ladder. Both paths must consume one number.
    const draws = (level: number) => {
      let n = 0;
      epicBossCurrencyReward(level, 10, () => { n++; return 0.99; });
      return n;
    };
    expect(draws(5)).toBe(1);
    expect(draws(10)).toBe(1);
  });

  it("leaves a full clear reliably brain-NEGATIVE", () => {
    // The property that matters: expected brains out must sit well under the cheapest
    // entry price, or the event pays for itself and becomes a brain source.
    // Nine rolled rungs plus the guaranteed final one.
    const expectedPerClear = 9 * EPIC_BRAIN_DROP_CHANCE + 1;
    expect(expectedPerClear).toBeCloseTo(1.72, 10);
    const cheapestEntry = Math.min(...EPIC_BOSSES.map((boss) => boss.costBrains));
    expect(expectedPerClear).toBeLessThan(cheapestEntry);
  });

  it("rolls independently per rung, at the stated rate", () => {
    // A deterministic sweep over the unit interval: the share of rungs that pay must be
    // the drop chance, not some rung-dependent schedule hiding behind it.
    const SAMPLES = 10_000;
    for (const rung of [1, 5, 9]) {
      let paid = 0;
      for (let i = 0; i < SAMPLES; i++) {
        if (epicBossCurrencyReward(rung, 10, () => i / SAMPLES).brains) paid++;
      }
      expect(paid / SAMPLES).toBeCloseTo(EPIC_BRAIN_DROP_CHANCE, 3);
    }
  });

  it("pays each rung the gold of the two it replaced", () => {
    // `max(2, rung) x 100`. Rung 1 merges the old rungs 1+2 (100+100), rung 10 merges
    // 19+20 (500+500), and a full ladder still totals the same 5,600 gold.
    expect(epicBossCurrencyReward(1).gold).toBe(200);
    expect(epicBossCurrencyReward(2).gold).toBe(200);
    expect(epicBossCurrencyReward(5).gold).toBe(500);
    expect(epicBossCurrencyReward(10).gold).toBe(1000);
    let total = 0;
    for (let rung = 1; rung <= 10; rung++) total += epicBossCurrencyReward(rung).gold;
    expect(total).toBe(5600);
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
      ["dr-groundhog", 48],
      ["bully-frog", 60],
      ["rocky-rhino", 72],
      ["general-larvaelus", 84],
      ["mystical-mamba", 96],
      ["foul-owl", 110],
      ["skunkarella", 125],
      ["loco-locust", 140],
    ]);
  });

  it("prices activation in three bands up the unlock ladder", () => {
    // 3 / 3 / 4 / 4 / 4 / 4 / 5 / 5 by unlock order. Banded rather than flat because brain
    // income barely moves across the game by design (~1.6/day at level 4, ~2.9 at 44), so
    // one price would mean the entry event and the endgame event cost the same share of a
    // near-static budget. Authored in tools/prep_all_epic_bosses.py EPIC_BOSS_COST_BRAINS.
    const byUnlock = [...EPIC_BOSSES].sort(
      (a, b) => epicBossUnlockLevel(a) - epicBossUnlockLevel(b)
    );
    expect(byUnlock.map((b) => b.costBrains)).toEqual([3, 3, 4, 4, 4, 4, 5, 5]);
    // …and the price never falls as the ladder climbs.
    for (let i = 1; i < byUnlock.length; i++) {
      expect(byUnlock[i].costBrains).toBeGreaterThanOrEqual(byUnlock[i - 1].costBrains);
    }
  });

  it("crosses the unsupported wall's death line partway up", () => {
    // The ramp's whole shape (see EPIC_BOSS_DAMAGE): a level-appropriate best-mutated
    // headless dies unaided at 100 DPS, so the early events sit under that line and the
    // late ones above it. An army that brings only damage keeps its front-liner early and
    // starts losing it every attempt later. combat.test.ts measures this against the real
    // sim; this is the cheap arithmetic version that fails first if the table drifts.
    const UNAIDED_DEATH_DPS = 100;
    const below = EPIC_BOSSES.filter((b) => bossDps(b) < UNAIDED_DEATH_DPS);
    const above = EPIC_BOSSES.filter((b) => bossDps(b) >= UNAIDED_DEATH_DPS);
    expect(below.length).toBeGreaterThanOrEqual(3);
    expect(above.length).toBeGreaterThanOrEqual(3);
    // …and the entry event is comfortably on the survivable side of it.
    expect(bossDps(EPIC_BOSSES.find((b) => b.id === "dr-groundhog")!))
      .toBeLessThan(UNAIDED_DEATH_DPS * 0.6);
  });

  it("never lets a later event hit softer than an earlier one", () => {
    const byUnlock = [...EPIC_BOSSES].sort(
      (a, b) => epicBossUnlockLevel(a) - epicBossUnlockLevel(b)
    );
    for (let i = 1; i < byUnlock.length; i++) {
      expect(bossDps(byUnlock[i])).toBeGreaterThan(bossDps(byUnlock[i - 1]));
    }
  });

  it("caps the ramp where a level-appropriate SUPPORTED wall can still hold", () => {
    // The bounding rule is stated on the ARMY, not on one zombie, and lives in
    // combat.test.ts: a level-appropriate best-mutated headless survives its event backed
    // by two level-appropriate healers. Measured, that supported wall is untouched to
    // 240 DPS and only dies at 800.
    //
    // 200 is the fence: comfortably above the top boss's 140, comfortably below where the
    // supported wall starts taking real damage. It is kept as a blunt second check because
    // casualties are permanent and a full clear is 20+ attempts, so a ramp that kills the
    // front unit costs one zombie PER ATTEMPT, not per level. Raising it without
    // re-measuring combat.test.ts is the mistake it exists to catch.
    const hardest = Math.max(...EPIC_BOSSES.map(bossDps));
    expect(hardest).toBeLessThanOrEqual(200);
  });

  it("keeps each boss's hit rhythm — only power is retuned", () => {
    // dex is character, not difficulty: Skunkarella throws fast small hits from a lower
    // str, so it reaches its rung on rhythm rather than on power. Every ramp change scales
    // str and leaves dex alone, which is what keeps each boss feeling like itself.
    const skunk = EPIC_BOSSES.find((b) => b.id === "skunkarella")!;
    expect(skunk.unitStats.dex).toBe(4);
    expect(bossDps(skunk)).toBe(125);
    // …and it still sits on its own rung despite the lower str — second-hardest event.
    const ranked = [...EPIC_BOSSES].sort((a, b) => bossDps(b) - bossDps(a));
    expect(ranked[1].id).toBe("skunkarella");
    for (const boss of EPIC_BOSSES.filter((b) => b.id !== "skunkarella")) {
      expect(boss.unitStats.dex).toBe(2);
    }
  });
});

describe("Epic Boss ladders", () => {
  it("runs every event over 10 rungs, pair-compressed from the 20 ZF2 authored", () => {
    // ZF2 authored 20 multipliers summing to 645x baseHp. The ladder is re-cut into ten
    // rungs of two, so the TOTAL is untouched — the same fight, in half as many pieces.
    // That total is the load-bearing number: it is what keeps the top of the ladder
    // costing the attempts it always did while the one-attempt formalities at the bottom
    // disappear. If a future cut changes it, the ladder got easier or harder rather than
    // shorter, and this is where that shows up.
    const AUTHORED_TOTAL = 645;
    for (const boss of EPIC_BOSSES) {
      expect(boss.maxLevel).toBe(10);
      expect(boss.multipliers).toHaveLength(10);
      expect(boss.multipliers.reduce((a, b) => a + b, 0)).toBeCloseTo(AUTHORED_TOTAL, 3);
      // The curve must still climb, and every rung must be a distinct step.
      expect(boss.multipliers[boss.maxLevel - 1]).toBeGreaterThan(boss.multipliers[0]);
      expect(new Set(boss.multipliers).size).toBe(boss.multipliers.length);
      for (let i = 1; i < boss.multipliers.length; i++) {
        expect(boss.multipliers[i]).toBeGreaterThan(boss.multipliers[i - 1]);
      }
    }
  });
});
