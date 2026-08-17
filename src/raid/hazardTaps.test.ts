// The rescue hazards (Trapeze Artist, Beach crab) are the only two things in a raid a
// player beats with their POINTER rather than their army, so what the pointer is matters.
// These tests pin the two properties that make the mouse profile safe: it really does
// halve the clicking, and it cannot reach the server's replay.
import { describe, expect, it } from "vitest";
import { BattleSim } from "./BattleSim";
import { MOUSE_TAPS, TOUCH_TAPS, hazardTapProfile, rescueHazardHp } from "./hazardTaps";
import type { CombatUnit, CrabConfig } from "./types";

const AUTHORED_HP = 667; // RaidManager.RESCUE_HAZARD_HP — the touch figure
const TAP_DAMAGE = 100;
const tapsToKill = (hp: number) => Math.ceil(hp / TAP_DAMAGE);

describe("rescue-hazard tap profile", () => {
  it("halves the clicks a hazard costs on a mouse", () => {
    expect(hazardTapProfile(false)).toBe(MOUSE_TAPS);
    // Seven deliberate clicks per hazard, several hazards a fight, was the report.
    expect(tapsToKill(AUTHORED_HP)).toBe(7);
    expect(tapsToKill(rescueHazardHp(AUTHORED_HP, false))).toBe(4);
  });

  it("leaves touch on the authored interaction", () => {
    expect(hazardTapProfile(true)).toBe(TOUCH_TAPS);
    expect(TOUCH_TAPS.cooldownMs).toBe(250); // StageActor tapDelay 0.25
    expect(rescueHazardHp(AUTHORED_HP, true)).toBe(AUTHORED_HP);
    expect(tapsToKill(rescueHazardHp(AUTHORED_HP, true))).toBe(7);
  });

  it("accepts clicks faster than a finger taps, so a fast clicker loses none", () => {
    // A mouse click-spams at roughly 8/s (~125 ms apart). The authored 250 ms gate throws
    // away one to two of every three of those — which is what the player was reporting as
    // "a delay before my clicks register".
    const FAST_MOUSE_INTERVAL_MS = 125;
    expect(TOUCH_TAPS.cooldownMs).toBeGreaterThan(FAST_MOUSE_INTERVAL_MS);
    expect(MOUSE_TAPS.cooldownMs).toBeLessThan(FAST_MOUSE_INTERVAL_MS);
  });
});

const unit = (over: Partial<CombatUnit>): CombatUnit => ({
  id: "u", sourceKey: "ZombieActorRegularTier1", team: "player", name: "Z",
  str: 5, dex: 2, con: 20, focus: 0, hp: 500, maxHp: 500, attackCooldownMs: 500,
  attacks: [{ name: "A", frequency: 100, mult: 1 }],
  isBoss: false, alive: true, isGarden: false, isHeadless: false, abilities: [],
  ...over,
} as CombatUnit);

const crabSim = (crab: CrabConfig) => {
  const players = [unit({ id: "p" })];
  const enemies = [unit({ id: "e", sourceKey: "BeachStageActorMinion2", team: "enemy", con: 3000 })];
  const sim = new BattleSim(
    players, enemies, null, true, [], 10 * 60 * 1000, null, null, false, false, false, 60, null, crab
  );
  for (const p of players) sim.units.find((u) => u.id === p.id)!.state = "advance";
  return sim;
};

describe("the sim's own tap pace", () => {
  const crab = (hp: number): CrabConfig =>
    ({ sprite: "c.png", hp, tapDamage: TAP_DAMAGE, spawnMs: 100, limit: 1, holdMs: 2000 });

  it("defaults to the authored touch cooldown, so the verifier never sees the mouse one", () => {
    // Built the way server/src/raidVerifier.ts builds one: nothing sets the tap pace.
    // (It never taps either — both hazards are client-only — but the default is what
    // guarantees a device preference can't reach a replay even if that changes.)
    const sim = new BattleSim([], [], null, false, [], 60_000, null, null, true, true, true, 150);
    expect(sim.hazardTapCooldownMs).toBe(TOUCH_TAPS.cooldownMs);
  });

  it("lands every click a fast mouse makes, and rescues in four of them", () => {
    const sim = crabSim(crab(rescueHazardHp(AUTHORED_HP, false)));
    for (let ms = 0; ms < 2000 && !sim.activeCrabs().length; ms += 50) sim.step(50);
    const [live] = sim.activeCrabs();
    expect(live).toBeTruthy();
    sim.hazardTapCooldownMs = MOUSE_TAPS.cooldownMs;

    let landed = 0;
    for (let click = 0; click < 4; click++) {
      if (sim.tapCrab(live.id)) landed++;
      sim.step(MOUSE_TAPS.cooldownMs);
    }
    expect(landed).toBe(4);
    expect(sim.activeCrabs().some((c) => c.id === live.id)).toBe(false);
  });

  it("still drops the clicks a touch-paced gate would drop, at the touch pace", () => {
    // The gate is not gone — it is matched to the device. At the authored 250 ms, a mouse
    // clicking every 125 ms loses every other click; that is the reported symptom.
    const sim = crabSim(crab(AUTHORED_HP));
    for (let ms = 0; ms < 2000 && !sim.activeCrabs().length; ms += 50) sim.step(50);
    const [live] = sim.activeCrabs();
    let landed = 0;
    for (let click = 0; click < 6; click++) {
      if (sim.tapCrab(live.id)) landed++;
      sim.step(125);
    }
    expect(landed).toBe(3); // six clicks in, three of them counted
  });
});
