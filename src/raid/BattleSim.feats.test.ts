// The fight's own record of HOW it was won. This is what makes the technique
// achievements grantable without trusting the client: the server replays the same sim
// when it settles the raid, so whatever these assertions see is what the Worker sees.
import { describe, expect, it } from "vitest";
import { BattleSim } from "./BattleSim";
import type { CombatUnit } from "./types";

function unit(over: Partial<CombatUnit> & Pick<CombatUnit, "id" | "sourceKey" | "team">): CombatUnit {
  return {
    name: over.id,
    str: 5, dex: 5, con: 30, focus: 100,
    hp: 3000, maxHp: 3000,
    attackCooldownMs: 1000,
    attacks: [{ name: "", frequency: 1, mult: 1 }],
    isBoss: false, alive: true, isGarden: false, isHeadless: false,
    abilities: [],
    ...over,
  };
}

/** Run until `done`, or `ticks` steps have passed. */
function runUntil(sim: BattleSim, done: () => boolean, ticks = 4000): void {
  for (let i = 0; i < ticks && !done() && !sim.finished; i++) sim.step(50);
}

const exploder = () => unit({
  id: "lep", sourceKey: "ZombieActorSmallTier5", group: "Small",
  team: "player", abilities: ["explode", "explodeV2"],
});
const smasher = () => unit({
  id: "big", sourceKey: "ZombieActorLargeTier4", group: "Large",
  team: "player", str: 400, abilities: ["bash"],
});
const medic = () => unit({
  id: "gard", sourceKey: "ZombieActorGardenTier3", group: "Garden",
  team: "player", isGarden: true, abilities: ["ressurect"],
});

describe("BattleSim technique attribution", () => {
  it("records nothing for a fight with no activated abilities", () => {
    const sim = new BattleSim(
      [unit({ id: "reg", sourceKey: "ZombieActorRegularTier1", team: "player", str: 300 })],
      [unit({ id: "e1", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 1 })],
      null, true
    );
    runUntil(sim, () => sim.finished);
    expect(sim.outcome().feats).toEqual({ abilityKills: [], resurrections: [] });
  });

  it("attributes an explosion kill to the ability that landed it", () => {
    const sim = new BattleSim(
      [exploder()],
      [unit({ id: "e1", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 1, hp: 5, maxHp: 5 })],
      null, true
    );
    runUntil(sim, () => sim.activate("explode"), 400);
    runUntil(sim, () => (sim.outcome().feats?.abilityKills.length ?? 0) > 0);
    const kills = sim.outcome().feats!.abilityKills;
    expect(kills.length).toBeGreaterThan(0);
    expect(kills[0]).toEqual({ ability: "explode", boss: false });
  });

  it("attributes a Smash kill, and marks the victim as the boss", () => {
    const sim = new BattleSim(
      [smasher()],
      [unit({ id: "boss", sourceKey: "FarmStageActorBoss", team: "enemy", isBoss: true, con: 1, hp: 5, maxHp: 5 })],
      null, true
    );
    runUntil(sim, () => sim.activate("bash"), 600);
    runUntil(sim, () => (sim.outcome().feats?.abilityKills.length ?? 0) > 0);
    const kills = sim.outcome().feats!.abilityKills;
    expect(kills.some((kill) => kill.ability === "bash" && kill.boss)).toBe(true);
  });

  // Plain Explode is barred from touching a boss (the hitBoss guard). That is what
  // makes "defeat a boss with an explosion" implicitly a Silver-rank Small zombie.
  it("never credits a boss kill to plain Explode, which cannot reach one", () => {
    const sim = new BattleSim(
      [exploder()],
      [unit({ id: "boss", sourceKey: "FarmStageActorBoss", team: "enemy", isBoss: true, con: 1, hp: 5, maxHp: 5 })],
      null, true
    );
    runUntil(sim, () => sim.activate("explode"), 400);
    runUntil(sim, () => sim.finished, 600);
    const kills = sim.outcome().feats!.abilityKills;
    expect(kills.some((kill) => kill.ability === "explode" && kill.boss)).toBe(false);
  });

  it("records a resurrection, and flags the exploder pulled from its own blast", () => {
    const sim = new BattleSim(
      [exploder(), medic()],
      [unit({ id: "e1", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 900 })],
      null, true
    );
    // Explode is a suicide move, so the blast makes its own performer a casualty — and
    // the Garden holder's Resurrect gets its shot at that casualty like any other.
    runUntil(sim, () => sim.activate("explode"), 400);
    runUntil(sim, () => (sim.outcome().feats?.resurrections.length ?? 0) > 0, 600);
    const rezzes = sim.outcome().feats!.resurrections;
    expect(rezzes).toHaveLength(1);
    expect(rezzes[0].exploded).toBe(true);
  });

  it("carries the record across a snapshot round trip", () => {
    const sim = new BattleSim(
      [exploder()],
      [unit({ id: "e1", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 1, hp: 5, maxHp: 5 })],
      null, true
    );
    runUntil(sim, () => sim.activate("explode"), 400);
    runUntil(sim, () => (sim.outcome().feats?.abilityKills.length ?? 0) > 0);
    const before = sim.outcome().feats!;
    expect(before.abilityKills.length).toBeGreaterThan(0);

    const restored = new BattleSim(
      [exploder()],
      [unit({ id: "e1", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 1, hp: 5, maxHp: 5 })],
      null, true
    );
    restored.restore(sim.snapshot());
    expect(restored.outcome().feats).toEqual(before);
  });
});
