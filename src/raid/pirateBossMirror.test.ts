// Ruleset v38 — the two pirate-raid changes, pinned end-to-end in the real sim.
//
// (a) Protect covers Headless. The aura was gated `group === "Headless" ? 0 : …` at BOTH
//     places that compute damage reduction — the CombatEngine build AND the per-tick
//     BattleSim.refreshTeamAuras. Fixing only one would have been silently undone on the
//     first tick, so the runtime half is pinned here rather than at the build site. A
//     carrier still does not shield ITSELF; it shields the rest of the line.
// (b) The Dread Pirate Arrrnold mirrors the attack speed of the zombie he is facing,
//     as the Scallywag already does. His authored 5000-damage slam exceeds the max hit
//     points of every zombie in the game, so con cannot answer him; his CLOCK is the dial
//     instead. A slow Headless front line holds him below his authored 2.5 s.
import { describe, expect, it } from "vitest";
import { BattleSim } from "./BattleSim";
import { mirroredAttackIntervalSec, MIRROR_SPEED_KEYS, PIRATE_BOSS_KEY, SCALLYWAG_KEY } from "./combatStats";
import type { CombatUnit } from "./types";

function unit(over: Partial<CombatUnit> & Pick<CombatUnit, "id" | "sourceKey" | "team">): CombatUnit {
  return {
    name: over.id, str: 5, dex: 5, con: 30, focus: 100, hp: 3000, maxHp: 3000,
    attackCooldownMs: 1000, attacks: [{ name: "", frequency: 1, mult: 1 }],
    isBoss: false, alive: true, isGarden: false, isHeadless: false, abilities: [], ...over,
  };
}

/** Arrrnold against one zombie whose own cycle is `zombieCycleMs`. */
function duel(
  zombieCycleMs: number,
  playerOver: Partial<CombatUnit> = {},
  backline: CombatUnit[] = []
) {
  const player = unit({
    id: "p", sourceKey: "ZombieActorBombie", team: "player", str: 1,
    con: 50, hp: 5000, maxHp: 5000, attackCooldownMs: zombieCycleMs, ...playerOver,
  });
  const boss = unit({
    id: "boss", sourceKey: PIRATE_BOSS_KEY, team: "enemy", isBoss: true,
    str: 500, dex: 0.4, con: 5_000_000, attackCooldownMs: 2500, mirrorsOpponentSpeed: true,
  });
  const sim = new BattleSim(
    [player, ...backline], [boss], null, true, [],
    10 * 60 * 1000, null, null, false, false, false, 60, null, null
  );
  sim.units.find((u) => u.id === "p")!.state = "advance";
  return sim;
}

/** Gaps between the boss's landed swings, in ms. */
function swingGaps(sim: BattleSim, ticks = 2000) {
  const boss = sim.units.find((u) => u.isBoss)!;
  for (const p of sim.units.filter((u) => u.team === "player")) {
    p.hp = p.maxHp = 500_000_000; // immortal, so the measurement is not cut short
  }
  const at: number[] = [];
  let t = 0;
  for (let i = 0; i < ticks; i++) {
    if (!sim.step(50)) break;
    t += 50;
    if (boss.struckThisTick) at.push(t);
  }
  return at.slice(1).map((s, i) => s - at[i]);
}

describe("Arrrnold mirrors the zombie he is facing", () => {
  it("is flagged as a mirror, and no one outside the pirate family is", () => {
    expect(MIRROR_SPEED_KEYS.has(PIRATE_BOSS_KEY)).toBe(true);
    expect(MIRROR_SPEED_KEYS.has(SCALLYWAG_KEY)).toBe(true);
    expect(MIRROR_SPEED_KEYS.has("PirateStageActorSwashbuckler")).toBe(false);
    expect(MIRROR_SPEED_KEYS.size).toBe(2);
  });

  it("a SLOW Headless front line holds him below his authored 2.5 s", () => {
    // A master-rank Bombie's cycle is 1.6 s → 1.6²/0.8 = 3.2 s.
    const gaps = swingGaps(duel(1600));
    expect(gaps.length).toBeGreaterThan(3);
    // Landed swings are quantised to the 50 ms sim tick, so allow exactly one tick.
    for (const g of gaps) expect(Math.abs(g - 3200)).toBeLessThanOrEqual(50);
    expect(mirroredAttackIntervalSec(1.6) * 1000).toBeCloseTo(3200);
    // …which is genuinely slower than the clock he used to keep.
    expect(3200).toBeGreaterThan(2500);
  });

  it("a FAST front line drives him toward the 0.5 s floor", () => {
    const gaps = swingGaps(duel(400)); // 0.4 s cycle → 0.2 → floored at 0.5 s
    expect(gaps.length).toBeGreaterThan(3);
    for (const g of gaps) expect(Math.abs(g - 500)).toBeLessThanOrEqual(50);
  });

  it("break-even is a 1.414 s zombie — his authored pace", () => {
    expect(mirroredAttackIntervalSec(Math.sqrt(2)) * 1000).toBeCloseTo(2500, 0);
  });

  it("never swings faster than the floor, whatever the zombie's speed", () => {
    for (const cycle of [10, 50, 100, 200]) {
      for (const g of swingGaps(duel(cycle), 400)) expect(g).toBeGreaterThanOrEqual(500);
    }
  });
});

describe("Protect covers Headless too", () => {
  it("survives the per-tick aura refresh, not just the build", () => {
    // Two Headless carriers: each takes the OTHER's 20%. Pre-v38 both sat at zero, and
    // refreshTeamAuras re-applied that exclusion on every one of the 40 steps below —
    // which is why the runtime half is pinned and not just the build.
    const tankUnit = (id: string) => unit({
      id, sourceKey: "ZombieActorBombie", team: "player",
      abilities: ["protect"], str: 1, con: 50, hp: 5000, maxHp: 5000,
    });
    const boss = unit({
      id: "boss", sourceKey: PIRATE_BOSS_KEY, team: "enemy", isBoss: true,
      str: 500, dex: 0.4, con: 5_000_000, attackCooldownMs: 2500, mirrorsOpponentSpeed: true,
    });
    const sim = new BattleSim(
      [tankUnit("tank"), tankUnit("tank2")], [boss], null, true, [],
      10 * 60 * 1000, null, null, false, false, false, 60, null, null
    );
    const tank = sim.units.find((u) => u.id === "tank")!;
    tank.state = "advance";
    sim.units.find((u) => u.id === "tank2")!.state = "advance";
    for (let i = 0; i < 40; i++) sim.step(50);
    expect(tank.damageReduction).toBeCloseTo(0.2);
  });

  it("a lone carrier is still worth nothing to itself", () => {
    const solo = duel(1600, { abilities: ["protect"] });
    for (let i = 0; i < 40; i++) solo.step(50);
    expect(solo.units.find((u) => u.team === "player")!.damageReduction).toBe(0);
  });

  it("mitigates the slam the front zombie is standing in", () => {
    // A Bombie backed by ONE other Protect carrier — the case the old exclusion could
    // never reach, and the one that matters: Arrrnold's 5000 lands as 4000.
    const plain = duel(1600);
    swingGaps(plain, 200);
    const bare = plain.units.find((u) => u.id === "p")!;

    const shielded = duel(1600, {}, [
      unit({ id: "backer", sourceKey: "ZombieActorBombie", team: "player", abilities: ["protect"] }),
    ]);
    swingGaps(shielded, 200);
    const front = shielded.units.find((u) => u.id === "p")!;

    expect(front.damageReduction).toBeCloseTo(0.2);
    expect(front.damageFxTaken).toBeCloseTo(bare.damageFxTaken * 0.8, 5);
  });
});
