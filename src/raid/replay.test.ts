import { describe, expect, it } from "vitest";
import { BattleSim } from "./BattleSim";
import { advanceRaidSegment, RAID_MAX_INPUTS, RAID_TICK_MS, replayRaid } from "./replay";
import type { RaidReplayInput } from "./replay";
import type { CombatUnit } from "./types";

const RUN_BENCHMARK = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.REPLAY_BENCH === "1";

function unit(id: string, team: "player" | "enemy", n: number): CombatUnit {
  return {
    id, sourceKey: id, team, name: id,
    str: 8 + n, dex: 3 + (n % 5), con: 80, focus: 50,
    hp: 800, maxHp: 800, attackCooldownMs: 700,
    attacks: [{ name: "hit", frequency: 1, mult: 1 }],
    isBoss: team === "enemy" && n === 15,
    alive: true, isGarden: n % 4 === 0, isHeadless: n % 5 === 0, abilities: [],
  };
}

function worstCaseSim(): BattleSim {
  const players = Array.from({ length: 16 }, (_, n) => unit(`p${n}`, "player", n));
  const enemies = Array.from({ length: 16 }, (_, n) => unit(`e${n}`, "enemy", n));
  return new BattleSim(players, enemies, null, false);
}

/** A Ninja-shaped fight whose perched boss immediately drops a carrotWall. The minion is
 *  what keeps it perched — a descended boss stops walling. */
function wallSim(): BattleSim {
  const player = unit("p0", "player", 0);
  const minion = { ...unit("e0", "enemy", 0), con: 3000, hp: 9000, maxHp: 9000 };
  const boss = { ...unit("e1", "enemy", 1), isBoss: true, con: 3000, hp: 9000, maxHp: 9000 };
  const wallTemplate = {
    ...unit("wall", "enemy", 2),
    sourceKey: "carrotWall", str: 0, con: 150, hp: 1500, maxHp: 1500,
    attacks: [{ name: "", frequency: 1, mult: 0 }],
  };
  return new BattleSim(
    [player], [minion, boss], null, true,
    [{ name: "wall", weight: 100, castMs: 0, cooldownMs: 999_999, damage: 0 }],
    10 * 60 * 1000, null, wallTemplate
  );
}

/** The same fight, but one the army can actually win: the wall still bars the lane, so
 *  the run only ends if the taps land on both sides. */
function winnableWallSim(): BattleSim {
  const players = Array.from({ length: 4 }, (_, n) => ({
    ...unit(`p${n}`, "player", n), str: 60, attackCooldownMs: 400,
  }));
  const minion = { ...unit("e0", "enemy", 0), str: 1, con: 20, attackCooldownMs: 4000 };
  const boss = { ...unit("e1", "enemy", 1), isBoss: true, str: 1, con: 20, attackCooldownMs: 4000 };
  const wallTemplate = {
    ...unit("wall", "enemy", 2),
    sourceKey: "carrotWall", str: 0, con: 150, hp: 1500, maxHp: 1500,
    attacks: [{ name: "", frequency: 1, mult: 0 }],
  };
  return new BattleSim(
    [...players], [minion, boss], null, true,
    [{ name: "wall", weight: 100, castMs: 0, cooldownMs: 999_999, damage: 0 }],
    10 * 60 * 1000, null, wallTemplate
  );
}

/** The winnable wall fight with a wall the army cannot simply chew through: at 30,000 HP
 *  the blocker is genuinely on the critical path, so whether the taps landed decides how
 *  long the run takes. `winnableWallSim`'s 1,500-HP wall falls to melee well inside the
 *  fight's own schedule, which makes it useless for measuring an overrun. */
function wallGatedSim(): BattleSim {
  const players = Array.from({ length: 4 }, (_, n) => ({
    ...unit(`p${n}`, "player", n), str: 60, attackCooldownMs: 400,
  }));
  const minion = { ...unit("e0", "enemy", 0), str: 1, con: 20, attackCooldownMs: 4000 };
  const boss = { ...unit("e1", "enemy", 1), isBoss: true, str: 1, con: 20, attackCooldownMs: 4000 };
  const wallTemplate = {
    ...unit("wall", "enemy", 2),
    sourceKey: "carrotWall", str: 0, con: 3000, hp: 30_000, maxHp: 30_000,
    attacks: [{ name: "", frequency: 1, mult: 0 }],
  };
  return new BattleSim(
    [...players], [minion, boss], null, true,
    [{ name: "wall", weight: 100, castMs: 0, cooldownMs: 999_999, damage: 0 }],
    10 * 60 * 1000, null, wallTemplate
  );
}

/** Step until the boss's wall stands, returning its id and the tick it was tapped on —
 *  the same bookkeeping RaidScene does (`simTick` counts completed steps). */
function tapWallOnFirstSight(sim: BattleSim): { unitId: string; tick: number } {
  for (let tick = 0; tick < 400; tick++) {
    const wall = sim.units.find((u) => u.isWall && u.alive);
    if (wall) {
      expect(sim.tapWall(wall.id)).toBe(true);
      return { unitId: wall.id, tick };
    }
    sim.step(RAID_TICK_MS);
  }
  throw new Error("the boss never summoned a wall");
}

describe("deterministic raid replay", () => {
  it("rejects reordered, future, malformed, and oversized transcripts", () => {
    expect(replayRaid(worstCaseSim(), 1, [{ seq: 2, tick: 0, type: "retreat" }])).toMatchObject({ error: "bad_sequence" });
    expect(replayRaid(worstCaseSim(), 1, [{ seq: 1, tick: 2, type: "retreat" }])).toMatchObject({ error: "bad_input_tick" });
    // A transcript that isn't shaped like one is still fatal, whatever the path.
    expect(replayRaid(worstCaseSim(), 1, [{ seq: 1, tick: 0, type: "ability" } as never])).toMatchObject({ error: "illegal_ability" });
    expect(replayRaid(worstCaseSim(), 1, [{ seq: 1, tick: 0, type: "wallTap" } as never])).toMatchObject({ error: "illegal_wall_tap" });
    expect(replayRaid(worstCaseSim(), 1, [{ seq: 1, tick: 0, type: "shove" } as never])).toMatchObject({ error: "bad_input_type" });
    const tooMany = Array.from({ length: RAID_MAX_INPUTS + 1 }, (_, n) => ({ seq: n + 1, tick: 0, type: "retreat" as const }));
    expect(replayRaid(worstCaseSim(), 1, tooMany)).toMatchObject({ error: "too_many_inputs" });
  });

  // The finish path forgives a well-formed tap the server's own sim won't take: it is
  // player help the server's army never receives, so dropping it can only make the
  // server's result worse. A checkpoint has no such licence.
  it("drops a refused tap at the finish and counts it, but still fails a checkpoint", () => {
    const refused = replayRaid(worstCaseSim(), 1, [
      { seq: 1, tick: 0, type: "ability", abilityKey: "forged" },
      { seq: 2, tick: 0, type: "wallTap", unitId: "e0" },
      { seq: 3, tick: 0, type: "bubble", unitId: "nobody" },
    ]);
    expect(refused).toMatchObject({ ok: true });
    if (refused.ok) expect(refused.divergence.refusedInputs).toBe(3);

    expect(advanceRaidSegment(worstCaseSim(), 0, 1, 0, [
      { seq: 1, tick: 0, type: "ability", abilityKey: "forged" },
    ], false)).toMatchObject({ error: "illegal_ability" });
  });

  it("chips the verifier's wall by the same taps the player landed", () => {
    // The player taps the carrotWall the moment it lands.
    const client = wallSim();
    const tap = tapWallOnFirstSight(client);
    const clientHp = client.units.find((u) => u.id === tap.unitId)!.hp;
    expect(clientHp).toBe(1425); // 1500 − 75

    // The transcribed tap lands on the same wall, at the same tick, for the same damage.
    const server = wallSim();
    const replayed = advanceRaidSegment(
      server, 0, tap.tick + 1, 0,
      [{ seq: 1, tick: tap.tick, type: "wallTap", unitId: tap.unitId }],
      false
    );
    expect(replayed.ok).toBe(true);
    expect(server.units.find((u) => u.id === tap.unitId)!.hp).toBe(clientHp);

    // Without it the verifier fights a wall the player already chipped — the desync that
    // rejected won Ninja/Robot invasions before ruleset 14.
    const untranscribed = wallSim();
    expect(advanceRaidSegment(untranscribed, 0, tap.tick + 1, 0, [], false).ok).toBe(true);
    expect(untranscribed.units.find((u) => u.id === tap.unitId)!.hp).toBe(1500);
  });


  it("verifies a WON fight whose wall the player tapped down", () => {
    // Play it the way a real player does: mash the blocker every frame it stands.
    const client = winnableWallSim();
    const inputs: RaidReplayInput[] = [];
    let seq = 0;
    let steps = 0;
    while (steps < 4000 && !client.finished) {
      const wall = client.units.find((u) => u.isWall && u.alive);
      if (wall && client.tapWall(wall.id)) {
        inputs.push({ seq: ++seq, tick: steps, type: "wallTap", unitId: wall.id });
      }
      client.step(RAID_TICK_MS);
      steps++;
    }
    const outcome = client.outcome();
    expect(client.finished).toBe(true);
    expect(outcome.win).toBe(true);
    expect(inputs.length).toBe(20); // 1500 hp / 75 a tap

    // This is the settlement that used to fail: the verifier now reaches the same win.
    const replayed = replayRaid(winnableWallSim(), steps, inputs);
    expect(replayed).toMatchObject({ ok: true });
    if (replayed.ok) expect(replayed.outcome).toEqual(outcome);
    // A transcript the two sims agreed on runs to the same length, with nothing dropped.
    if (replayed.ok) expect(replayed.divergence).toEqual({ overrunTicks: 0, inputsAfterFinish: 0, refusedInputs: 0 });

    // Drop the taps (pre-14 behaviour) and the verifier is still stuck behind a wall the
    // player knocked down on screen. It no longer FAILS the settlement over that — it
    // finishes its own slower fight — but the overrun records how far apart they ran.
    // Measured on the tank-wall fixture, where the blocker really is what gates the run.
    const gated = wallGatedSim();
    const gatedInputs: RaidReplayInput[] = [];
    let gatedSeq = 0;
    let gatedSteps = 0;
    while (gatedSteps < 4000 && !gated.finished) {
      const wall = gated.units.find((u) => u.isWall && u.alive);
      if (wall && gated.tapWall(wall.id)) {
        gatedInputs.push({ seq: ++gatedSeq, tick: gatedSteps, type: "wallTap", unitId: wall.id });
      }
      gated.step(RAID_TICK_MS);
      gatedSteps++;
    }
    expect(gated.outcome().win).toBe(true);
    expect(replayRaid(wallGatedSim(), gatedSteps, gatedInputs)).toMatchObject({ ok: true });

    const desynced = replayRaid(wallGatedSim(), gatedSteps, []);
    expect(desynced).toMatchObject({ ok: true });
    if (desynced.ok) expect(desynced.divergence.overrunTicks).toBeGreaterThan(0);
  });

  it("restores a checkpoint to the same outcome as one uninterrupted replay", () => {
    const full = replayRaid(worstCaseSim(), 600, [{ seq: 1, tick: 600, type: "retreat" }]);
    const first = advanceRaidSegment(worstCaseSim(), 0, 300, 0, [], false);
    expect(first.ok).toBe(true);
    const resumed = worstCaseSim();
    if (!first.ok) return;
    resumed.restore(first.snapshot);
    const second = advanceRaidSegment(resumed, 300, 600, first.lastSeq, [{ seq: 1, tick: 600, type: "retreat" }], true);
    expect(second.ok).toBe(true);
    if (full.ok && second.ok) expect(second.outcome).toEqual(full.outcome);
  });

  it.skipIf(!RUN_BENCHMARK)("keeps benchmark-selected 15-second checkpoint segments below the 8 ms p95 target", () => {
    // Measure steady-state verifier cost. Workerd keeps isolates warm between requests;
    // including V8's first compilation passes made this test primarily measure JIT.
    for (let i = 0; i < 4; i++) replayRaid(worstCaseSim(), 15 * 1000 / 50, []);
    const samples: number[] = [];
    for (let i = 0; i < 24; i++) {
      const start = performance.now();
      replayRaid(worstCaseSim(), 15 * 1000 / 50, []);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    expect(p95).toBeLessThan(8);
  });
});
