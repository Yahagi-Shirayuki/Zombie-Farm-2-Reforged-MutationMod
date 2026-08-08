import { describe, expect, it } from "vitest";
import { DR_GROUNDHOG, EPIC_BOSSES, epicBossById } from "./catalog";
import { rollEpicBossLoot } from "./combat";
import { epicLootWeight } from "./rewards";
import { BattleSim } from "../raid/BattleSim";
import { buildPlayerUnits } from "../raid/CombatEngine";
import { deriveAttackIntervalMs } from "../raid/combatStats";
import { makeOwned } from "../zombie/types";
import type { CombatUnit } from "../raid/types";
import zombieRows from "../../public/assets/zombies.json";
import type { ZombieDef } from "../assets";

describe("Epic Boss fallback loot", () => {
  it("unlocks source rewards by defeated level and prefers missing rewards", () => {
    expect(rollEpicBossLoot(DR_GROUNDHOG, 1, new Set(), () => 0)).toBeNull();
    expect(rollEpicBossLoot(DR_GROUNDHOG, 2, new Set(), () => 0)?.name).toContain("Evil Device");
    const owned = new Set(["Dr. Groundhog's Evil Device"]);
    expect(rollEpicBossLoot(DR_GROUNDHOG, 4, owned, () => 0)?.name).toContain("Tricycle");
  });

  it("does not duplicate the pet once collected", () => {
    const owned = new Set(DR_GROUNDHOG.loot.map((loot) => loot.name));
    const result = rollEpicBossLoot(DR_GROUNDHOG, 20, owned, () => 0);
    expect(result?.stageActor).toBeUndefined();
  });

  it("makes the ladder's top prize RARER than its first rung", () => {
    // The regression: a uniform pick gave the level-20 prize exactly the same odds as the
    // level-2 one, so climbing bought no better chance at what climbing unlocks.
    const top = DR_GROUNDHOG.loot.reduce((a, b) => (b.level > a.level ? b : a));
    const first = DR_GROUNDHOG.loot.reduce((a, b) => (b.level < a.level ? b : a));
    const counts = new Map<string, number>();
    let seed = 0.5;
    const random = () => {
      seed = (seed * 9301 + 0.49297) % 1; // deterministic spread, no Math.random in tests
      return seed;
    };
    for (let i = 0; i < 20_000; i++) {
      const loot = rollEpicBossLoot(DR_GROUNDHOG, top.level, new Set(), random);
      if (loot) counts.set(loot.name, (counts.get(loot.name) ?? 0) + 1);
    }
    const topHits = counts.get(top.name) ?? 0;
    const firstHits = counts.get(first.name) ?? 0;
    expect(topHits).toBeGreaterThan(0); // still reachable — rarer, not gated off
    expect(topHits * 2).toBeLessThan(firstHits); // and clearly rarer than the first rung
  });

  it("weights strictly by the unlocking rung", () => {
    expect(epicLootWeight(5)).toBeGreaterThan(epicLootWeight(10));
    expect(epicLootWeight(20)).toBeGreaterThan(epicLootWeight(40));
    expect(epicLootWeight(0)).toBe(epicLootWeight(1)); // level 0 can't divide by zero
  });
});

// ---------------------------------------------------------------------------
// Damage-ramp calibration, MEASURED rather than modelled.
//
// The per-boss attack power in the catalogs (tools/prep_all_epic_bosses.py
// EPIC_BOSS_DAMAGE) was tuned against real BattleSim fights, because two properties
// of the epic fight break any closed-form estimate:
//   * only a handful of zombies are engaged at once, so a 20-strong army does not
//     bring 20 zombies' worth of damage, and incoming damage concentrates on the
//     front slot rather than spreading across the line;
//   * a level takes many attempts and damage carries over, so nearly every attempt
//     runs the full 30 seconds. Casualties are permanent, so a boss that kills the
//     front unit costs one zombie PER ATTEMPT, not one per level.
// Together those mean the ramp has to be read as "which zombies can survive 30s in
// the front slot", which is exactly what these tests pin.
// ---------------------------------------------------------------------------
const defs = zombieRows as ZombieDef[];
const defByName = (name: string) => defs.find((z) => z.name === name)!;

/** A 20-strong line with `front` in the first slot, backed by ordinary damage-dealers. */
function line(front: string, backer = "Zomtar"): CombatUnit[] {
  const owned = [
    makeOwned("front", defByName(front), 0, 0, 0, 0),
    ...Array.from({ length: 19 }, (_, i) =>
      makeOwned(`b${i}`, defByName(backer), 0, 0, 0, 0)),
  ];
  return buildPlayerUnits(owned, {
    concentration: true, abilityUnlocked: () => true, playerLevel: 45,
  });
}

/** An unkillable boss, so the fight always runs its full 30 seconds. */
function endlessBoss(str: number, dex: number): CombatUnit {
  return {
    id: "boss", sourceKey: "EpicBoss:test", team: "enemy", name: "Boss",
    str, dex, con: 20, focus: 0, hp: 10_000_000, maxHp: 10_000_000,
    attackCooldownMs: deriveAttackIntervalMs(dex, "enemy"),
    attacks: [{ name: "", frequency: 100, mult: 1 }], isBoss: true, alive: true,
    isGarden: false, isHeadless: false, abilities: [], attackDamageTiming: 0.88,
  };
}

/** Run one full 30-second epic fight; report casualties and how wide the line got. */
function fight(players: CombatUnit[], boss: CombatUnit) {
  const sim = new BattleSim(players, [boss], null, false, [], 30_000,
    null, null, true, true, true, 150);
  let widest = 0;
  for (let i = 0; i < 1200 && !sim.finished; i++) {
    sim.step(50);
    const bubble = sim.chargingBubble();
    if (bubble) sim.popBubble(bubble.id);
    widest = Math.max(widest, sim.snapshot().units
      .filter((u) => u.team === "player" && u.state === "fight").length);
  }
  return { widest, losses: sim.outcome().losses.length };
}

describe("Epic Boss damage ramp", () => {
  const locust = epicBossById("loco-locust")!;
  const groundhog = epicBossById("dr-groundhog")!;
  const bossOf = (def: (typeof EPIC_BOSSES)[number]) =>
    endlessBoss(def.unitStats.str, def.unitStats.dex);

  it("engages only a fraction of the army at once, however deep the line", () => {
    // The load-bearing fact behind the ramp: a 20-strong army does NOT bring 20
    // zombies' worth of damage, and the boss's damage lands on a handful of units
    // rather than spreading across the line. If this widens, the ramp is wrong in
    // both directions at once (clears get faster, front-liners get safer).
    const { widest } = fight(line("Scrooge Zombie"), bossOf(groundhog));
    expect(widest).toBeGreaterThan(0);
    expect(widest).toBeLessThanOrEqual(8);
  });

  it("leaves the hardest boss's own top prize alive in the front slot", () => {
    // Vagabond Zombie is Loco Locust's omega. If its own event can kill it while it
    // tanks, the ramp has gone too far — that is the cap's whole rationale.
    expect(fight(line("Vagabond Zombie"), bossOf(locust)).losses).toBe(0);
  });

  it("would kill that same prize if the ramp went one step further", () => {
    // The guard rail: x3 (120 DPS) is over the line, which is why the ramp stops at
    // x2.5. If this stops failing, sim pacing changed and the ramp needs re-measuring.
    expect(fight(line("Vagabond Zombie"), endlessBoss(6, 2)).losses).toBeGreaterThan(0);
  });

  it("still punishes a thin front-liner at the top of the ramp", () => {
    // Zomtar (1575 HP) is a damage-dealer, not a tank. Leading with it costs it.
    expect(fight(line("Zomtar"), bossOf(locust)).losses).toBeGreaterThan(0);
  });

  it("leaves the entry boss harmless to any reasonable front-liner", () => {
    for (const front of ["Zomtar", "Old McZombie", "Teddy Zombie", "Bombie"]) {
      expect(fight(line(front), bossOf(groundhog)).losses).toBe(0);
    }
  });

  it("keeps a tank viable at every step of the ramp", () => {
    // Bombie is the Market-bought Headless wall. It has to stay a legal answer to the
    // whole ladder, or the ramp becomes "own Scrooge or do not play".
    for (const boss of EPIC_BOSSES) {
      expect(fight(line("Bombie"), bossOf(boss)).losses).toBe(0);
    }
  });
});
