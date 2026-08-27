// A held boss throw winds up before it releases (ruleset 39).
//
// Player report: "sometimes bosses don't play the animation for throwing objects."
// The throw animation is the THROW_WINDUP_MS arm-swing the renderer maps over the last
// stretch of the boss's action cooldown (bossThrowSwing). A throw that came due on an
// EMPTY lane used to pin its timer at zero and hold — so the projectile launched on the
// very tick a target first appeared, with the swing helper having reported "arm at rest"
// for every preceding frame. That covered the first throw of every fight (the action
// clock starts at 0 and nobody is deployed at t=0) and every throw pending across a line
// wipe. The fix parks the waiting timer at THROW_WINDUP_MS instead, so lane-entry is
// always a whole animated wind-up away from the release. These tests pin that invariant.
import { describe, expect, it } from "vitest";
import { BattleSim, THROW_WINDUP_MS, type SimUnit } from "./BattleSim";
import { RAID_TICK_MS } from "./replay";
import type { BossThrowConfig, CombatUnit } from "./types";

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

const THROW: BossThrowConfig = {
  intervalMs: 2000,
  options: [{ damage: 1, weight: 1, sprite: "rock", spriteSize: 32 }],
};

/** A perched thrower with one tanky ground enemy holding it on the perch (with the wave
 *  gone the boss climbs down and loses its whole action budget — see promote()). */
function throwerSim(zombieIds: string[]): BattleSim {
  const players = zombieIds.map((id) =>
    unit({ id, sourceKey: "ZombieActorRegularTier1", team: "player" }));
  const wave = unit({
    id: "wave", sourceKey: "FarmStageActorFarmhand", team: "enemy",
    con: 10000, hp: 1e6, maxHp: 1e6, str: 1,
  });
  const boss = unit({
    id: "boss", sourceKey: "FarmStageActorMcDonnell", team: "enemy", isBoss: true,
    con: 10000, hp: 1e6, maxHp: 1e6,
  });
  // concentration=true: no focus minigame, the queue charges and auto-releases — the
  // lane still starts empty for the full charge time, which is the held-throw window.
  return new BattleSim(players, [wave, boss], THROW, true);
}

const throwCount = (sim: BattleSim) => sim.snapshot().throwCount;
const deployed = (u: SimUnit) => u.state === "advance" || u.state === "fight";

/** Step until `z` deploys, asserting the held throw stays parked the whole time. */
function stepUntilDeployed(sim: BattleSim, id: string, limit = 400): number {
  const z = sim.units.find((u) => u.id === id)!;
  let n = 0;
  while (n < limit && !deployed(z)) {
    expect(sim.bossThrowSwing(), "arm must rest on an empty lane").toBeNull();
    expect(throwCount(sim), "no throw may release on an empty lane").toBe(0);
    sim.step(RAID_TICK_MS);
    n++;
  }
  expect(deployed(z)).toBe(true);
  return n;
}

/** From deployment, step to the release and return the swing values the renderer saw. */
function windUpToRelease(sim: BattleSim): { swings: number[]; ticks: number } {
  const swings: number[] = [];
  let ticks = 0;
  while (throwCount(sim) === 0 && ticks < 40) {
    const sw = sim.bossThrowSwing();
    if (sw !== null) swings.push(sw);
    sim.step(RAID_TICK_MS);
    ticks++;
  }
  expect(throwCount(sim), "the held throw must eventually release").toBe(1);
  return { swings, ticks };
}

describe("held boss throw wind-up (ruleset 39)", () => {
  it("parks a waiting throw at the full wind-up instead of zero", () => {
    const sim = throwerSim(["z1"]);
    stepUntilDeployed(sim, "z1");
    // The tick that deployed the zombie may already have run the timer once, so the
    // park is observed within one tick of the full window — never the old zero.
    expect(sim.snapshot().actionCd).toBeGreaterThanOrEqual(THROW_WINDUP_MS - RAID_TICK_MS);
    expect(sim.snapshot().actionCd).toBeLessThanOrEqual(THROW_WINDUP_MS);
  });

  it("releases the fight's first throw only after a full animated wind-up", () => {
    const sim = throwerSim(["z1"]);
    stepUntilDeployed(sim, "z1");
    const { swings, ticks } = windUpToRelease(sim);
    // The regression this exists to catch: v38 released on the tick the lane filled.
    expect(ticks, "release must trail lane-entry by the whole wind-up")
      .toBeGreaterThanOrEqual(Math.floor(THROW_WINDUP_MS / RAID_TICK_MS));
    // And the renderer was given real frames: a swing that fills monotonically, seen
    // at every tick of the window, passing through the open interval.
    expect(swings.length).toBeGreaterThanOrEqual(Math.floor(THROW_WINDUP_MS / RAID_TICK_MS));
    expect(swings[0]).toBeLessThanOrEqual(0.2);
    expect(swings.some((s) => s > 0.2 && s < 0.8)).toBe(true);
    for (let i = 1; i < swings.length; i++) {
      expect(swings[i]).toBeGreaterThanOrEqual(swings[i - 1]);
    }
  });

  it("re-parks when the lane empties mid-wind-up, then winds up in full again", () => {
    const sim = throwerSim(["z1", "z2"]);
    stepUntilDeployed(sim, "z1");
    // Part-way into the wind-up…
    for (let i = 0; i < 5; i++) sim.step(RAID_TICK_MS);
    expect(throwCount(sim)).toBe(0);
    const mid = sim.bossThrowSwing();
    expect(mid).not.toBeNull();
    expect(mid!).toBeGreaterThan(0);
    // …the lone target dies. The arm rests and the timer goes back to the full window.
    const z1 = sim.units.find((u) => u.id === "z1")!;
    z1.hp = 0;
    z1.alive = false;
    z1.state = "dead";
    sim.step(RAID_TICK_MS);
    expect(sim.bossThrowSwing()).toBeNull();
    expect(sim.snapshot().actionCd).toBe(THROW_WINDUP_MS);
    // The reinforcement re-fills the lane, and the release again trails it by the
    // whole wind-up — v38 fired the instant z2 walked out.
    stepUntilDeployed(sim, "z2");
    const { ticks } = windUpToRelease(sim);
    expect(ticks).toBeGreaterThanOrEqual(Math.floor(THROW_WINDUP_MS / RAID_TICK_MS));
  });
});
