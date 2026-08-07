import { describe, expect, it } from "vitest";
import { BattleSim } from "./BattleSim";
import { replayRaid, type RaidReplayInput } from "./replay";
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

// A Silver Small — the leprechaun — is the only unit that carries BOTH explosion
// buttons, and usually the army's only exploder at all, so `activate` has exactly one
// candidate and any state disagreement between the two sims is immediately fatal.
function party(): CombatUnit[] {
  return [
    unit({ id: "lep", sourceKey: "ZombieActorSmallTier5", group: "Small", team: "player", abilities: ["explode", "explodeV2"] }),
    unit({ id: "reg", sourceKey: "ZombieActorRegularTier1", group: "Regular", team: "player" }),
  ];
}
function foes(): CombatUnit[] {
  return [unit({ id: "e1", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 900 })];
}

describe("one-use activated abilities", () => {
  it("cannot be re-armed by cancelling the wind-up", () => {
    const sim = new BattleSim(party(), foes(), null, true);
    for (let i = 0; i < 400 && !sim.activate("explode"); i++) sim.step(50);
    const lep = sim.units.find((u) => u.id === "lep")!;
    expect(lep.windupKey).toBe("explode");
    expect(lep.usedAbilities).toEqual(["explode"]); // spent at commit, not at payoff

    // Exactly what a knockback, pixelFire, or a (client-only) trapeze/crab grab does to
    // its victim: the charge is cancelled. That must not refund the move.
    lep.windupKey = null;
    lep.windupMs = 0;
    expect(sim.activate("explode")).toBe(false);
    expect(sim.activate("explodeV2")).toBe(true); // the OTHER button is still its own move
  });

  it("survives the finish even when the two sims disagree about the exploder", () => {
    // Play the client's fight, interrupting the first charge the way only the client's
    // hazards can, and tap again — the shape of the reported bug.
    const client = new BattleSim(party(), foes(), null, true);
    const lep = client.units.find((u) => u.id === "lep")!;
    const inputs: RaidReplayInput[] = [];
    let seq = 0;
    let tick = 0;
    for (; tick < 3000 && !client.finished && seq < 2; tick++) {
      const key = seq === 0 ? "explode" : "explodeV2";
      if (client.activate(key)) {
        inputs.push({ seq: ++seq, tick, type: "ability", abilityKey: key });
        lep.windupKey = null; // grabbed mid-charge
        lep.windupMs = 0;
      }
      client.step(50);
    }
    expect(inputs).toHaveLength(2);

    // The server never grabs anyone, so its leprechaun is still charging the first move
    // when the second tap arrives. That used to be `illegal_ability` → 422 → the win was
    // erased. It is now dropped, counted, and the fight settles.
    const replayed = replayRaid(new BattleSim(party(), foes(), null, true), tick + 400, inputs);
    expect(replayed).toMatchObject({ ok: true });
    if (!replayed.ok) return;
    expect(replayed.divergence.refusedInputs).toBe(1);
  });
});
