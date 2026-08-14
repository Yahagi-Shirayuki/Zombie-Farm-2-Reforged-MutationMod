// Zombies vs Aliens (raid 6) — the four recovered divergences, pinned against the
// disassembly in docs/mechanics/ALIEN_RAID_RECOVERED.md §7. Three of them move fight
// outcomes (raid ruleset 27); the fourth is the per-alien tint.
import { describe, expect, it } from "vitest";
import { BattleSim, type SimUnit } from "./BattleSim";
import {
  ABDUCTEE_POOL,
  ABDUCTEE_SEED,
  ALIEN_MINION_KEY,
  alienTintFor,
  waveCadenceFor,
} from "./alienStage";
import type { CombatUnit, SummonConfig } from "./types";

function unit(over: Partial<CombatUnit> & Pick<CombatUnit, "id" | "sourceKey" | "team">): CombatUnit {
  return {
    name: over.id,
    str: 5,
    dex: 5,
    con: 30,
    focus: 100,
    hp: 3000,
    maxHp: 3000,
    attackCooldownMs: 1000,
    attacks: [{ name: "", frequency: 1, mult: 1 }],
    isBoss: false,
    alive: true,
    isGarden: false,
    isHeadless: false,
    abilities: [],
    ...over,
  };
}

const alien = (i: number) =>
  unit({ id: `a${i}`, sourceKey: ALIEN_MINION_KEY, team: "enemy", str: 0, hp: 1e6, maxHp: 1e6 });

/** Enemies actually out on the field (not still queued off-screen). */
const onField = (sim: BattleSim) =>
  sim.units.filter((u: SimUnit) => u.team === "enemy" && !u.isBoss && u.state !== "queued").length;

describe("the alien wave is a swarm", () => {
  // `-[ZFFightMan spawnEnemyIn:]` fills a five-slot `enemySlots` array beside the one
  // "current" enemy, and only the `spawnTimer` drip ever fills a slot. `initialSpawn`
  // seeds that timer to 10 s on stage 6 and 3600 s everywhere else.
  it("reads six-at-once with a ten-second drip for raid 6, one-at-a-time for the rest", () => {
    expect(waveCadenceFor(6)).toEqual({ maxActive: 6, dripMs: 10_000 });
    for (const id of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]) {
      expect(waveCadenceFor(id), String(id)).toEqual({ maxActive: 1, dripMs: 0 });
    }
  });

  it("lets exactly one more alien out per drip, up to six", () => {
    const wave = Array.from({ length: 20 }, (_, i) => alien(i));
    const sim = new BattleSim(
      [unit({ id: "p", sourceKey: "ZombieActorRegularTier1", team: "player", str: 0, hp: 1e7, maxHp: 1e7 })],
      wave, null, true, [], undefined, null, null, false, false, false, undefined, null, null,
      waveCadenceFor(6)
    );
    const step = (ms: number) => { for (let i = 0; i < ms / 50; i++) sim.step(50); };
    step(1000);
    expect(onField(sim)).toBe(1); // the field starts where every other raid stays
    step(10_000);
    expect(onField(sim)).toBe(2);
    step(10_000);
    expect(onField(sim)).toBe(3);
    step(60_000); // long past the sixth drip
    expect(onField(sim)).toBe(6); // …and it stops at the five slots plus the current one
  });

  it("keeps every other raid to one at a time, however long the fight runs", () => {
    const wave = Array.from({ length: 8 }, (_, i) =>
      unit({ id: `e${i}`, sourceKey: "FarmStageActorFarmhand", team: "enemy", str: 0, hp: 1e6, maxHp: 1e6 }));
    const sim = new BattleSim(
      [unit({ id: "p", sourceKey: "ZombieActorRegularTier1", team: "player", str: 0, hp: 1e7, maxHp: 1e7 })],
      wave, null, true, [], undefined, null, null, false, false, false, undefined, null, null,
      waveCadenceFor(3)
    );
    for (let i = 0; i < 1200; i++) sim.step(50); // a full minute
    expect(onField(sim)).toBe(1);
  });
});

describe("a landed boss has no actions", () => {
  // `-[CivilianActorFight bossUpdate:]` only rolls an action in state 19; a boss that has
  // finished its descent sits in state 9, below the 15..27 window, and drops through to
  // `civilianUpdate`. This used to be enforced for throws and walls but not for specials,
  // which left the saucer firing its laser through the whole ground phase.
  const laserSim = (bossState: SimUnit["state"]) => {
    const sim = new BattleSim(
      [unit({ id: "p", sourceKey: "ZombieActorRegularTier1", team: "player", hp: 1e6, maxHp: 1e6 })],
      [
        unit({ id: "bag", sourceKey: ALIEN_MINION_KEY, team: "enemy", str: 0, hp: 1e7, maxHp: 1e7 }),
        unit({ id: "boss", sourceKey: "AlienStageActorBoss", team: "enemy", isBoss: true, str: 0, hp: 1e7, maxHp: 1e7 }),
      ],
      null, true, [{ name: "alienLaser", weight: 1, castMs: 0, cooldownMs: 300, damage: 0 }]
    );
    for (let i = 0; i < 40; i++) {
      for (const u of sim.units) {
        u.state = u.team === "enemy" ? (u.isBoss ? bossState : "hold") : "fight";
      }
      sim.step(50);
    }
    return sim;
  };

  it("fires the laser from the perch", () => {
    expect(laserSim("structure").projectiles.length).toBeGreaterThan(0);
  });

  it("fires nothing once it has landed and joined the melee", () => {
    expect(laserSim("fight").projectiles).toHaveLength(0);
    expect(laserSim("hold").projectiles).toHaveLength(0);
  });
});

describe("summonBoss abducts humans", () => {
  const abductees = (): SummonConfig => ({
    queue: ABDUCTEE_SEED.map((key) =>
      unit({ id: key, sourceKey: key, team: "enemy", str: 0, con: 1, hp: 100, maxHp: 100 })),
    pool: [...new Set(ABDUCTEE_POOL)].map((key) =>
      unit({ id: key, sourceKey: key, team: "enemy", str: 0, con: 1, hp: 100, maxHp: 100 })),
  });

  const summonSim = () => {
    const sim = new BattleSim(
      [unit({ id: "p", sourceKey: "ZombieActorRegularTier1", team: "player", str: 0, hp: 1e7, maxHp: 1e7 })],
      [
        unit({ id: "bag", sourceKey: ALIEN_MINION_KEY, team: "enemy", str: 0, hp: 1e7, maxHp: 1e7 }),
        unit({ id: "boss", sourceKey: "AlienStageActorBoss", team: "enemy", isBoss: true, str: 0, hp: 1e7, maxHp: 1e7 }),
      ],
      null, true, [{ name: "summonBoss", weight: 1, castMs: 0, cooldownMs: 100, damage: 0 }],
      undefined, abductees()
    );
    return sim;
  };

  const summoned = (sim: BattleSim) => sim.units.filter((u) => u.isSummon);

  it("beams down an abducted HUMAN, not another alien", () => {
    const sim = summonSim();
    for (let i = 0; i < 20 && !summoned(sim).length; i++) sim.step(50);
    const victim = summoned(sim)[0];
    expect(victim).toBeTruthy();
    // The seed order is authored: two lumberjacks, a crazed worker, a ninja boy.
    expect(victim.sourceKey).toBe(ABDUCTEE_SEED[0]);
    expect(victim.sourceKey).not.toBe(ALIEN_MINION_KEY);
    // Straight onto the field rather than queued behind the wave.
    expect(victim.state).not.toBe("queued");
  });

  it("refuses a second while the first still lives, then re-arms when it dies", () => {
    const sim = summonSim();
    for (let i = 0; i < 200; i++) sim.step(50);
    expect(summoned(sim).filter((u) => u.alive)).toHaveLength(1); // `bossWall` holds one
    for (const u of summoned(sim)) { u.alive = false; u.hp = 0; }
    for (let i = 0; i < 40; i++) sim.step(50);
    expect(summoned(sim).filter((u) => u.alive)).toHaveLength(1); // re-armed
    expect(summoned(sim).length).toBeGreaterThan(1); // …and that is a NEW one
  });

  it("never runs dry — every cast pushes a replacement onto the queue", () => {
    const sim = summonSim();
    // Far more casts than the four seeded names: the roll refills the list each time.
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < 60; i++) sim.step(50);
      for (const u of summoned(sim)) { u.alive = false; u.hp = 0; }
    }
    expect(summoned(sim).length).toBeGreaterThan(ABDUCTEE_SEED.length);
    for (const u of summoned(sim)) expect(ABDUCTEE_KEYS_SET.has(u.sourceKey)).toBe(true);
  });

  it("does not hold the boss on its perch — an abductee is off-budget", () => {
    // `civilianUpdate` only decrements `enemyPopulation` for a dying actor that is NOT
    // `bossWall`, so a summon neither counts toward the wave nor blocks the descent.
    // Without this an uncapped summon would deadlock the boss up top forever.
    const sim = summonSim();
    const bag = sim.units.find((u) => u.id === "bag")!;
    for (let i = 0; i < 20; i++) sim.step(50);
    bag.alive = false;
    bag.hp = 0;
    for (let i = 0; i < 200; i++) sim.step(50);
    const boss = sim.units.find((u) => u.isBoss)!;
    expect(boss.state).not.toBe("structure"); // it came down even with an abductee alive
  });
});

const ABDUCTEE_KEYS_SET = new Set([...ABDUCTEE_SEED, ...ABDUCTEE_POOL]);

describe("every alien is a different colour", () => {
  // `-[ZFFightMan spawnEnemy]` rolls three independent
  // `(int)((arc4random() % 100) / 100.0f * 255.0f)` channels per minion, alien stage only.
  // The art is greyscale precisely because it is tinted at runtime.
  it("tints alien minions and nothing else", () => {
    expect(alienTintFor(ALIEN_MINION_KEY, "a1")).not.toBeNull();
    expect(alienTintFor("AlienStageActorBoss", "a1")).toBeNull();
    expect(alienTintFor("FarmStageActorFarmhand", "a1")).toBeNull();
  });

  it("keeps every channel on the source's 100-step ladder", () => {
    for (let i = 0; i < 200; i++) {
      const tint = alienTintFor(ALIEN_MINION_KEY, `spawn${i}`)!;
      for (const channel of [tint >> 16, (tint >> 8) & 0xff, tint & 0xff]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(252); // floor(99/100 * 255)
        expect(channel).toBe(Math.floor((Math.round((channel / 255) * 100) / 100) * 255));
      }
    }
  });

  it("is stable per unit but spread across the wave", () => {
    // Stable: a token rebuilt mid-fight must come back the same colour.
    expect(alienTintFor(ALIEN_MINION_KEY, "a7")).toBe(alienTintFor(ALIEN_MINION_KEY, "a7"));
    // Spread: twenty aliens should not read as twenty of the same alien.
    const seen = new Set(
      Array.from({ length: 20 }, (_, i) => alienTintFor(ALIEN_MINION_KEY, `a${i}`))
    );
    expect(seen.size).toBeGreaterThan(15);
  });
});
