import { describe, expect, it } from "vitest";
import { BattleSim } from "./BattleSim";
import type { CombatUnit } from "./types";

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

describe("Mini Buddy", () => {
  it("preserves mutation state for the raid renderer", () => {
    const player = unit({
      id: "mutant", sourceKey: "ZombieActorRegularTier1", team: "player", mutation: 1 | 8,
    });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy" });
    const sim = new BattleSim([player], [enemy], null, true);
    expect(sim.units.find((candidate) => candidate.id === "mutant")?.mutation).toBe(1 | 8);
  });

  it("accepts special zombies classified as Large, including Dapper", () => {
    const dapper = unit({
      id: "dapper", sourceKey: "ZombieActorDapper", group: "Large", team: "player",
      abilities: ["attachMini"],
    });
    const imp = unit({
      id: "imp", sourceKey: "ZombieActorSmallTier4", group: "Small", team: "player",
    });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy" });
    const sim = new BattleSim([dapper, imp], [enemy], null, true);

    expect(sim.activatedStatus()).toContainEqual({ key: "attachMini", ready: 1 });
    expect(sim.activate("attachMini")).toBe(true);
    expect(sim.units.find((candidate) => candidate.id === "dapper")?.buddyId).toBe("imp");
  });

  it("mounts before deployment, doubles the carrier run, then deploys both with a stun", () => {
    const brute = unit({
      id: "brute", sourceKey: "ZombieActorLargeTier2", team: "player",
      abilities: ["attachMini"],
    });
    const mini = unit({ id: "mini", sourceKey: "ZombieActorSmallTier1", team: "player" });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 300 });
    const sim = new BattleSim([brute, mini], [enemy], null, true);

    expect(sim.activatedStatus()).toContainEqual({ key: "attachMini", ready: 1 });
    expect(sim.activate("attachMini")).toBe(true);
    const b = sim.units.find((u) => u.id === "brute")!;
    const m = sim.units.find((u) => u.id === "mini")!;
    const e = sim.units.find((u) => u.id === "enemy")!;
    expect(b.buddyId).toBe("mini");
    expect(m.state).toBe("carried");

    for (let i = 0; i < 5000 && m.state === "carried"; i++) sim.step(50);
    expect(m.state).not.toBe("carried");
    expect(b.buddyId).toBeNull();
    expect(m.buddyCarrierId).toBeNull();
    expect(["advance", "fight"]).toContain(m.state);
    expect(e.stunMs).toBeGreaterThan(0);
  });
});

describe("finished combat input", () => {
  it("rejects ability and focus inputs after the decisive tick", () => {
    const player = unit({
      id: "player", sourceKey: "ZombieActorLargeTier2", team: "player", abilities: ["bash"],
    });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy" });
    const sim = new BattleSim([player], [enemy], null, true);
    const live = sim.units.find((candidate) => candidate.id === "player")!;
    live.state = "charging";
    live.distracted = true;
    sim.finished = true;

    expect(sim.activate("bash")).toBe(false);
    expect(sim.popBubble("player")).toBe(false);
  });
});

describe("Garden healing and formation depth", () => {
  it("does not let healing re-arm consumed one-shot protection", () => {
    const fighter = unit({
      id: "fighter", sourceKey: "ZombieActorRegularTier1", team: "player",
      hp: 100, maxHp: 100, str: 0.1,
    });
    const healer = unit({
      id: "healer", sourceKey: "ZombieActorGardenTier1", team: "player",
      hp: 100, maxHp: 100, str: 0.1, isGarden: true, abilities: ["heal"],
    });
    const enemy = unit({
      id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy",
      str: 100, hp: 100_000, maxHp: 100_000, attackCooldownMs: 4000,
    });
    const sim = new BattleSim([fighter, healer], [enemy], null, true);
    const f = sim.units.find((u) => u.id === "fighter")!;
    const h = sim.units.find((u) => u.id === "healer")!;
    const e = sim.units.find((u) => u.id === "enemy")!;
    f.state = "advance";
    h.state = "advance";
    e.state = "hold";
    e.x = 915;
    e.y = 280;

    for (let elapsed = 0; elapsed < 30_000 && !(f.oneShotProtectionUsed && f.hp > 1); elapsed += 50) {
      sim.step(50);
    }
    expect(h.healCastSeq).toBeGreaterThan(0);
    expect(f.oneShotProtectionUsed).toBe(true);
    expect(f.hp).toBeGreaterThan(1);

    const resumed = new BattleSim([fighter, healer], [enemy], null, true);
    resumed.restore(sim.snapshot());
    const restoredFighter = resumed.units.find((u) => u.id === "fighter")!;
    expect(restoredFighter.oneShotProtectionUsed).toBe(true);
    for (let elapsed = 0; elapsed < 30_000 && restoredFighter.alive; elapsed += 50) resumed.step(50);

    expect(restoredFighter.alive).toBe(false);
    expect(restoredFighter.hp).toBe(0);
  });

  it("holds a healer behind the line and restores any damaged deployed ally", () => {
    const fighter = unit({ id: "fighter", sourceKey: "ZombieActorRegularTier1", team: "player" });
    const healer = unit({
      id: "healer", sourceKey: "ZombieActorGardenTier1", team: "player",
      isGarden: true, abilities: ["heal"],
    });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 300 });
    const sim = new BattleSim([fighter, healer], [enemy], null, true);
    const f = sim.units.find((u) => u.id === "fighter")!;
    const h = sim.units.find((u) => u.id === "healer")!;
    f.state = "advance";
    h.state = "advance";
    f.formOrder = 0;
    h.formOrder = 1;
    f.hp = 2900; // injured, but still well above half Life

    sim.step(50);
    expect(h.slotX).toBeLessThan(f.slotX - 200);
    expect(f.hp).toBe(2925); // healer Power 50 × 0.5
    expect(f.healFxSeq).toBe(1);
    expect(h.healCastSeq).toBe(1);
  });

  it("fires Heal All every 20 seconds for half the healer's Power", () => {
    const a = unit({ id: "a", sourceKey: "ZombieActorRegularTier1", team: "player", hp: 1000 });
    const b = unit({ id: "b", sourceKey: "ZombieActorFemaleTier1", team: "player", hp: 2000 });
    const healer = unit({
      id: "healer", sourceKey: "ZombieActorGardenTier4", team: "player",
      isGarden: true, abilities: ["healAOE"],
    });
    const enemy = unit({
      id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy",
      hp: 100_000, maxHp: 100_000, attackCooldownMs: 100_000,
    });
    const sim = new BattleSim([a, b, healer], [enemy], null, true);
    for (const id of ["a", "b", "healer"]) sim.units.find((u) => u.id === id)!.state = "advance";

    for (let elapsed = 0; elapsed < 19_950; elapsed += 50) sim.step(50);
    expect(sim.units.find((u) => u.id === "a")!.hp).toBe(1000);
    sim.step(50);
    expect(sim.units.find((u) => u.id === "a")!.hp).toBe(1025);
    expect(sim.units.find((u) => u.id === "b")!.hp).toBe(2025);
  });

  it("carries the faithful unbanded base damage on both sides (enemies NOT doubled)", () => {
    // Ground truth: base per-hit = finalPower(str×10) × mult, no flat scalar, no enemy ×2.
    // str 5, mult 1 → 50 on both sides. The player's lineup-depth band is applied at hit time.
    const player = unit({ id: "player", sourceKey: "ZombieActorRegularTier1", team: "player" });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy" });
    const sim = new BattleSim([player], [enemy], null, true);
    expect(sim.units.find((u) => u.id === "player")!.damage).toBe(50);
    expect(sim.units.find((u) => u.id === "enemy")!.damage).toBe(50);
  });

  it("throws boss debris for its authored damage, unscaled", () => {
    const player = unit({ id: "player", sourceKey: "ZombieActorRegularTier1", team: "player" });
    const wall = unit({ id: "wall", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 300 });
    const boss = unit({ id: "boss", sourceKey: "FarmStageActorBoss", team: "enemy", isBoss: true, con: 300 });
    const sim = new BattleSim([player], [wall, boss], {
      intervalMs: 50,
      options: [{ damage: 6, weight: 1, sprite: "throw.png", spriteSize: 32 }],
    }, true);
    sim.units.find((u) => u.id === "player")!.state = "advance";
    sim.step(50);
    // Ground truth: the bossAction's `damage` reaches `[zombie damage:]` verbatim
    // (ZFFightPhysics throwProjectile: → setDamageAmount). No chip scaling.
    expect(sim.projectiles[0]?.damage).toBe(6);
  });

  it("preserves explicitly harmless debris at zero damage", () => {
    const player = unit({ id: "player", sourceKey: "ZombieActorRegularTier1", team: "player" });
    const wall = unit({ id: "wall", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 300 });
    const boss = unit({ id: "boss", sourceKey: "BeachStageActorBoss", team: "enemy", isBoss: true, con: 300 });
    const sim = new BattleSim([player], [wall, boss], {
      intervalMs: 50,
      options: [{ damage: 0, weight: 1, sprite: "harmless.png", spriteSize: 32 }],
    }, true);
    sim.units.find((u) => u.id === "player")!.state = "advance";
    sim.step(50);
    expect(sim.projectiles[0]?.damage).toBe(0);
  });

  it("applies the player-zombie one-shot floor to boss projectiles", () => {
    const player = unit({
      id: "player", sourceKey: "ZombieActorRegularTier1", team: "player",
      hp: 100, maxHp: 100, con: 1, dex: 1,
    });
    const wall = unit({
      id: "wall", sourceKey: "FarmStageActorFarmhand", team: "enemy",
      str: 0, dex: 0.01, attackCooldownMs: 100_000, con: 300,
    });
    const boss = unit({
      id: "boss", sourceKey: "AlienStageActorBoss", team: "enemy", isBoss: true,
      str: 0, dex: 0.01, attackCooldownMs: 100_000, con: 300,
    });
    const sim = new BattleSim([player], [wall, boss], null, true, [
      { name: "alienLaser", weight: 1, castMs: 0, cooldownMs: 100_000, damage: 100 },
    ]);
    const p = sim.units.find((u) => u.id === "player")!;
    p.state = "advance";
    sim.step(16); // select the special
    sim.step(16); // launch the straight projectile
    for (let i = 0; i < 200 && p.hp === 100; i++) sim.step(16);
    expect(p.hp).toBe(1);
    expect(p.alive).toBe(true);
  });

  it("cycles a throw-less boss through its specials on the shared action budget", () => {
    const player = unit({ id: "player", sourceKey: "ZombieActorRegularTier1", team: "player" });
    const wall = unit({ id: "wall", sourceKey: "AlienStageActorMinion", team: "enemy", con: 300 });
    const boss = unit({ id: "boss", sourceKey: "AlienStageActorBoss", team: "enemy", isBoss: true, con: 300 });
    // A summon template is required for `summonBoss` to be performable at all — the
    // source gates it on `allowedToSummonMinion`, and an ungated roll is re-rolled.
    const minion = unit({ id: "spawn", sourceKey: "AlienStageActorMinion", team: "enemy", con: 30 });
    const sim = new BattleSim([player], [wall, boss], null, true, [
      { name: "summonBoss", weight: 50, castMs: 50, cooldownMs: 300, damage: 0 },
      { name: "alienLaser", weight: 30, castMs: 50, cooldownMs: 300, damage: 0 },
    ], undefined, minion);
    sim.units.find((u) => u.id === "player")!.state = "advance";
    const seen = new Set<string>();
    for (let i = 0; i < 200 && seen.size < 2; i++) {
      sim.step(50);
      const pending = sim.snapshot().pendingSpecial;
      if (pending) seen.add(pending.name);
    }
    expect(seen).toEqual(new Set(["summonBoss", "alienLaser"]));
    expect(sim.snapshot().throwCount).toBe(0);
  });

  it("places combat priority from visual front to back within a column", () => {
    const first = unit({ id: "first", sourceKey: "ZombieActorHeadlessTier1", team: "player", isHeadless: true });
    const second = unit({ id: "second", sourceKey: "ZombieActorRegularTier1", team: "player" });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 300 });
    const sim = new BattleSim([first, second], [enemy], null, true);
    const a = sim.units.find((u) => u.id === "first")!;
    const b = sim.units.find((u) => u.id === "second")!;
    a.state = "advance";
    b.state = "advance";
    a.formOrder = 0;
    b.formOrder = 1;

    sim.step(50);
    expect(a.slotX).toBe(b.slotX);
    expect(a.slotY).toBeGreaterThan(b.slotY);
  });
});

describe("binary-authentic ability procs", () => {
  it("blocks exactly the nine >90 integer results in each 100-roll cycle", () => {
    const blocker = unit({
      id: "blocker", sourceKey: "ZombieActorHeadlessTier4", team: "player",
      hp: 10_000, maxHp: 10_000, abilities: ["block"],
    });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy" });
    const sim = new BattleSim([blocker], [enemy], null, true);
    const live = sim.units.find((u) => u.id === "blocker")!;
    for (let i = 0; i < 100; i++) (sim as any).dealEnemyDamage(live, 1);
    expect(live.hp).toBe(10_000 - 91);
  });

  it("adds 29 quarter-Power strikes per 100 attacks", () => {
    const striker = unit({
      id: "striker", sourceKey: "ZombieActorFemaleTier4", team: "player",
      abilities: ["doubleStrike"],
    });
    const enemy = unit({
      id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy",
      hp: 100_000, maxHp: 100_000,
    });
    const sim = new BattleSim([striker], [enemy], null, true);
    const s = sim.units.find((u) => u.id === "striker")!;
    const e = sim.units.find((u) => u.id === "enemy")!;
    for (let i = 0; i < 100; i++) {
      s.timerMs = 0;
      (sim as any).tryAttack(s, e, 0);
    }
    expect(e.hp).toBe(100_000 - 100 * 50 - 29 * 13);
  });

  it("stuns on exactly the four >95 integer results in each 100-roll cycle", () => {
    const stunner = unit({
      id: "stunner", sourceKey: "ZombieActorFemaleTier3", team: "player",
      abilities: ["stun"],
    });
    const enemy = unit({
      id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy",
      hp: 100_000, maxHp: 100_000,
    });
    const sim = new BattleSim([stunner], [enemy], null, true);
    const s = sim.units.find((u) => u.id === "stunner")!;
    const e = sim.units.find((u) => u.id === "enemy")!;
    let procs = 0;
    for (let i = 0; i < 100; i++) {
      e.stunMs = 0;
      s.timerMs = 0;
      (sim as any).tryAttack(s, e, 0);
      if (e.stunMs === 1000) procs++;
    }
    expect(procs).toBe(4);
  });
});

describe("lasers, resurrection, and activated attacks", () => {
  it("fires the base walking laser for 10% Power", () => {
    const laser = unit({
      id: "laser", sourceKey: "ZombieActorRegularTier3", team: "player",
      abilities: ["laserBeam"], attackCooldownMs: 600,
    });
    const enemy = unit({
      id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy",
      hp: 10_000, maxHp: 10_000,
    });
    const sim = new BattleSim([laser], [enemy], null, true);
    const p = sim.units.find((u) => u.id === "laser")!;
    const e = sim.units.find((u) => u.id === "enemy")!;
    p.state = "advance";
    p.x = 300;
    e.state = "hold";
    e.x = 915;
    sim.step(200); // finalAttackSpeed / 3
    expect(e.hp).toBe(9995);
    expect(p.laserFxSeq).toBe(1);
    expect(p.laserTargetId).toBe("enemy");
  });

  it("emits the upgraded T4 laser presentation at its faster cadence", () => {
    const laser = unit({
      id: "laser-v2", sourceKey: "ZombieActorRegularTier4", team: "player",
      abilities: ["laserBeam", "zomBeam"], attackCooldownMs: 600,
    });
    const enemy = unit({
      id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy",
      hp: 10_000, maxHp: 10_000,
    });
    const sim = new BattleSim([laser], [enemy], null, true);
    const p = sim.units.find((u) => u.id === "laser-v2")!;
    p.state = "advance";
    p.x = 300;
    const e = sim.units.find((u) => u.id === "enemy")!;
    e.state = "hold";
    e.x = 915;

    sim.step(100); // finalAttackSpeed / 6

    expect(p.laserFxSeq).toBe(1);
    expect(p.laserTargetId).toBe("enemy");
    expect(e.hp).toBe(9995);
  });

  it("resurrects one non-Small zombie once at full Life", () => {
    const fighter = unit({ id: "fighter", sourceKey: "ZombieActorRegularTier1", team: "player" });
    const healer = unit({
      id: "healer", sourceKey: "ZombieActorGardenTier3", team: "player",
      isGarden: true, abilities: ["ressurect"],
    });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy" });
    const sim = new BattleSim([fighter, healer], [enemy], null, true);
    const f = sim.units.find((u) => u.id === "fighter")!;
    const h = sim.units.find((u) => u.id === "healer")!;

    (sim as any).dealDamage(f, f.maxHp, false);
    expect(f.alive).toBe(true);
    expect(f.hp).toBe(f.maxHp);
    expect(h.resurrectUsed).toBe(true);
    (sim as any).dealDamage(f, f.maxHp, false);
    expect(f.alive).toBe(false);
  });

  it("does not spend Resurrect on a Small zombie", () => {
    const mini = unit({ id: "mini", sourceKey: "ZombieActorSmallTier3", team: "player" });
    const healer = unit({
      id: "healer", sourceKey: "ZombieActorGardenTier3", team: "player",
      isGarden: true, abilities: ["ressurect"],
    });
    const enemy = unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy" });
    const sim = new BattleSim([mini, healer], [enemy], null, true);
    const m = sim.units.find((u) => u.id === "mini")!;
    const h = sim.units.find((u) => u.id === "healer")!;
    (sim as any).dealDamage(m, m.maxHp, false);
    expect(m.alive).toBe(false);
    expect(h.resurrectUsed).toBe(false);
  });

  it("uses shipped Explode damage/stun once and keeps Ver.1 from hitting bosses", () => {
    const mini = unit({
      id: "mini", sourceKey: "ZombieActorSmallTier3", team: "player",
      abilities: ["explode"], attackCooldownMs: 600,
    });
    const boss = unit({
      id: "boss", sourceKey: "FarmStageActorBoss", team: "enemy",
      isBoss: true, hp: 10_000, maxHp: 10_000,
    });
    const sim = new BattleSim([mini], [boss], null, true);
    const p = sim.units.find((u) => u.id === "mini")!;
    const e = sim.units.find((u) => u.id === "boss")!;
    p.state = "fight";
    e.state = "hold";
    expect(sim.activate("explode")).toBe(true);
    (sim as any).stepWindup(p, e, 4000);
    expect(e.hp).toBe(10_000);
    expect(sim.activate("explode")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Enemy damage rate + boss hazards, against the disassembled values.
// (See combatStats "Attack CADENCE" and enemy-damage ground truth.)

describe("enemy cadence and boss hazard damage (ground truth)", () => {
  const player = (over: Partial<CombatUnit> = {}) =>
    unit({ id: "player", sourceKey: "ZombieActorRegularTier1", team: "player", ...over });
  const enemy = (over: Partial<CombatUnit> = {}) =>
    unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy", ...over });
  /** Put the boss on its holding spot and the zombies out fighting, so the special
   *  scheduler is live from the first step (it only runs while the boss is engaged). */
  const onTheLine = (sim: BattleSim) => {
    for (const u of sim.units) u.state = u.team === "enemy" ? "hold" : "advance";
  };

  it("an enemy strikes on its raw 1/dex clock — twice per equal-dex zombie swing", () => {
    // dex 2: zombie cycle 1000 ms, enemy cycle 500 ms (CombatEngine derives these; here
    // they arrive pre-derived, so assert the sim honours them without a pace multiplier).
    const p = player({ hp: 1e7, maxHp: 1e7, attackCooldownMs: 1000 });
    const e = enemy({ str: 10, hp: 1e7, maxHp: 1e7, attackCooldownMs: 500 });
    const sim = new BattleSim([p], [e], null, true);
    const zombie = sim.units.find((u) => u.id === "player")!;
    const foe = sim.units.find((u) => u.id === "enemy")!;
    for (let i = 0; i < 400; i++) sim.step(50); // 20 s of contact
    const zombieHits = (zombie.maxHp - zombie.hp) / foe.damage;
    const enemyHits = (foe.maxHp - foe.hp) / zombie.damage;
    expect(zombieHits).toBeGreaterThan(enemyHits * 1.8); // ~2× as many enemy swings
  });

  it("pixelFire interrupts ONE zombie for a single frame of burn, not an AoE chip", () => {
    const a = player({ id: "a", hp: 1e6, maxHp: 1e6 });
    const b = unit({ id: "b", sourceKey: "ZombieActorRegularTier1", team: "player", hp: 1e6, maxHp: 1e6 });
    const boss = enemy({ id: "boss", isBoss: true, str: 0, hp: 1e7, maxHp: 1e7 });
    const sim = new BattleSim([a, b], [boss], null, true, [
      { name: "pixelFire", weight: 1, castMs: 0, cooldownMs: 1e6, damage: 0 },
    ]);
    onTheLine(sim);
    for (let i = 0; i < 20; i++) sim.step(50); // 1 s — far longer than the effect lasts
    const hit = sim.units.filter((u) => u.team === "player" && u.hp < u.maxHp);
    expect(hit).toHaveLength(1); // single target, never an AoE
    // Ground truth: `setOnFire` parks the zombie at its OWN position, so the burning state
    // ticks once and exits — 5 %/s for one 60 fps frame ≈ 0.083 % of max HP. It must NOT
    // keep burning: a second of exposure costs the same as the first frame.
    const lost = hit[0].maxHp - hit[0].hp;
    expect(lost).toBeCloseTo(hit[0].maxHp * 0.05 / 60, 0);
    expect(lost).toBeLessThan(hit[0].maxHp * 0.001);
  });

  it("telekinesis knocks back and stuns but deals NO damage", () => {
    const p = player({ hp: 1e6, maxHp: 1e6 });
    const boss = enemy({ id: "boss", isBoss: true, str: 0, hp: 1e7, maxHp: 1e7 });
    const sim = new BattleSim([p], [boss], null, true, [
      { name: "telekinesis", weight: 1, castMs: 0, cooldownMs: 1e6, damage: 12 },
    ]);
    onTheLine(sim);
    for (let i = 0; i < 4; i++) sim.step(50);
    const victim = sim.units.find((u) => u.id === "player")!;
    expect(victim.hp).toBe(victim.maxHp);
    expect(victim.stunMs).toBeGreaterThan(0);
  });

  it("the alien laser bolt carries the flat 200 from the binary", () => {
    const p = player({ hp: 1e6, maxHp: 1e6 });
    const boss = enemy({ id: "boss", isBoss: true, str: 0, hp: 1e7, maxHp: 1e7 });
    const sim = new BattleSim([p], [boss], null, true, [
      { name: "alienLaser", weight: 1, castMs: 0, cooldownMs: 1e6, damage: 0 },
    ]);
    onTheLine(sim);
    for (let i = 0; i < 5 && !sim.projectiles.length; i++) sim.step(50);
    expect(sim.projectiles[0]?.damage).toBe(200);
  });
});

describe("boss action budget (throws and specials share one roll)", () => {
  const boss = () => unit({ id: "boss", sourceKey: "RobotStageActorBrainBot", team: "enemy", isBoss: true, str: 0, hp: 1e7, maxHp: 1e7 });
  const player = () => unit({ id: "p", sourceKey: "ZombieActorRegularTier1", team: "player", hp: 1e7, maxHp: 1e7 });
  const throwCfg = { intervalMs: 2000, options: [{ damage: 20, weight: 150, sprite: "junk.png", spriteSize: 32 }] };

  /** Count throws launched over `ms`, with and without a competing special. */
  const throwsOver = (specials: { name: string; weight: number; castMs: number; cooldownMs: number; damage: number }[], ms: number) => {
    // A live minion keeps the boss on its perch — that is the only state it throws from.
    const minion = unit({ id: "m", sourceKey: "RobotStageActorJunkBot", team: "enemy", str: 0, hp: 1e7, maxHp: 1e7 });
    const sim = new BattleSim([player()], [minion, boss()], throwCfg, true, specials);
    sim.units.find((u) => u.id === "p")!.state = "advance";
    let launched = 0;
    let seen = 0;
    for (let t = 0; t < ms; t += 50) {
      sim.step(50);
      const seq = sim.snapshot().projSeq;
      if (seq > seen) { launched += seq - seen; seen = seq; }
    }
    return launched;
  };

  it("a special steals throw slots instead of running on its own clock", () => {
    // BrainBot's real list is telekinesis (f=50) + 5 throws (f=30 each = 150), so the
    // source throws on ~75 % of its action cycles. With two independent timers the
    // throws were unaffected by the special — now they compete.
    const alone = throwsOver([], 30_000);
    const shared = throwsOver(
      [{ name: "telekinesis", weight: 50, castMs: 3000, cooldownMs: 3000, damage: 0 }],
      30_000
    );
    expect(alone).toBeGreaterThan(0);
    expect(shared).toBeLessThan(alone);
  });

  it("a boss whose actions are all throws is unaffected by the merge", () => {
    // Every City/Pirate/Farm boss action is a `throw`, so the budget degenerates to a
    // plain interval — those raids must not change.
    const launched = throwsOver([], 20_000);
    expect(launched).toBeGreaterThanOrEqual(9); // ~20 s / 2 s, allowing for the first tick
    expect(launched).toBeLessThanOrEqual(11);
  });
});
