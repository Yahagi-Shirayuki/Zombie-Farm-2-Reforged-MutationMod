// Knockback must not disarm the enemy that used it.
//
// Ranges in this sim are deliberately asymmetric: a zombie attacks from anywhere in the
// combat zone (a band four rows deep), while an enemy only strikes what stands within
// `engageDistance`. That is what makes holding the front row matter. But a knockback
// attack shoves its victim 150 units down the lane and re-slots it last — landing it
// inside the band it still attacks from, and outside the 60-unit reach of the enemy that
// just hit it. An enemy could clear its own melee range and then stand there being
// killed, punished for using its ability. These tests pin the floor under that.
import { describe, expect, it } from "vitest";
import { BattleSim } from "./BattleSim";
import type { CombatUnit } from "./types";

function unit(over: Partial<CombatUnit> & Pick<CombatUnit, "id" | "sourceKey" | "team">): CombatUnit {
  return {
    name: over.id, str: 5, dex: 5, con: 30, focus: 100, hp: 3000, maxHp: 3000,
    attackCooldownMs: 1000, attacks: [{ name: "", frequency: 1, mult: 1 }],
    isBoss: false, alive: true, isGarden: false, isHeadless: false, abilities: [], ...over,
  };
}

/** Zombies already released onto the lane, fighting one enemy, with no round timer in
 *  play. `knockBack` decides whether the enemy's swing shoves its target. */
function laneSim(knockBack: boolean, playerCount = 2) {
  const players = Array.from({ length: playerCount }, (_, i) =>
    unit({ id: `p${i}`, sourceKey: "ZombieActorRegularTier1", team: "player", str: 1 })
  );
  const enemy = unit({
    id: "e", sourceKey: "FarmStageActorBoss", team: "enemy",
    con: 100000, str: 5, dex: 2, knockBack,
  });
  const sim = new BattleSim(
    players, [enemy], null, true, [], 10 * 60 * 1000, null, null, false, false, false, 60, null, null
  );
  for (const p of players) sim.units.find((u) => u.id === p.id)!.state = "advance";
  return sim;
}

const enemyOf = (sim: BattleSim) => sim.units.find((u) => u.team === "enemy")!;
const playersOf = (sim: BattleSim) => sim.units.filter((u) => u.team === "player");

/** Run the fight and report how much damage the army took, plus how long the enemy went
 *  without a target while zombies were hitting it. */
function run(sim: BattleSim, ms: number) {
  let idleWhileAttacked = 0;
  let engaged = 0;
  for (let t = 0; t < ms; t += 50) {
    sim.step(50);
    const enemy = enemyOf(sim);
    if (!enemy.alive || (enemy.state !== "fight" && enemy.state !== "hold")) continue;
    const attackers = playersOf(sim).filter((p) => p.alive && p.state === "fight");
    if (!attackers.length) continue;
    engaged++;
    if (enemy.state !== "fight") idleWhileAttacked++;
  }
  const players = playersOf(sim);
  const maxHp = players.reduce((s, p) => s + p.maxHp, 0);
  const left = players.reduce((s, p) => s + (p.alive ? Math.max(0, p.hp) : 0), 0);
  return {
    damageTaken: maxHp ? 1 - left / maxHp : 0,
    idleFrac: engaged ? idleWhileAttacked / engaged : 0,
    enemyHp: enemyOf(sim).hp,
  };
}

/** KNOCKBACK_PX in BattleSim — how far a shove displaces its victim. */
const KNOCKBACK_PX = 150;

describe("an enemy that knocks a zombie back can still reach it", () => {
  it("strikes a zombie parked exactly where a knockback leaves it", () => {
    // The geometry of the defect, held still so nothing else can explain the result: a
    // zombie the shove left 150 units back — inside the attack band (it is still hitting
    // the enemy) and 210 units from an enemy that reaches 60.
    const sim = laneSim(true, 1) as unknown as {
      step: (ms: number) => void;
      players: Array<{ x: number; slotX: number; state: string; hp: number; maxHp: number }>;
      enemies: Array<{ x: number; state: string; hp: number; maxHp: number }>;
      frontX: number;
    };
    const zombie = sim.players[0];
    const enemy = sim.enemies[0];
    const parked = sim.frontX - KNOCKBACK_PX;

    for (let t = 0; t < 8000; t += 50) {
      // Re-park every tick: this test is about reach, not about walking back.
      zombie.x = parked;
      zombie.slotX = parked;
      sim.step(50);
    }

    expect(Math.abs(zombie.x - enemy.x)).toBeGreaterThan(60); // well outside melee reach
    expect(enemy.hp).toBeLessThan(enemy.maxHp); // …yet the zombie is hitting it…
    expect(zombie.hp).toBeLessThan(zombie.maxHp); // …and it hits back.
  });

  it("does not let a knockback enemy stand idle while it is being beaten", () => {
    const knocking = run(laneSim(true, 1), 30_000);
    const plain = run(laneSim(false, 1), 30_000);
    // Shoving its target away may still cost the enemy a beat, but not the long helpless
    // stretches it used to: it stays roughly as busy as one that never shoves.
    expect(knocking.idleFrac).toBeLessThan(plain.idleFrac + 0.15);
  });
});

describe("the extra reach belongs to knockback enemies only", () => {
  it("leaves an ordinary enemy unable to touch a zombie parked out of melee range", () => {
    // The counterpart to the test above, and the reason the fallback is scoped to
    // knockback: every enemy loses its target for a moment (the line refilling after a
    // kill, a zombie carried off by the Circus trapeze), and handing all of them a longer
    // reach for those gaps re-balances raids nobody complained about. A recorded Circus
    // victory in the server's fixtures flips to a defeat when it is.
    const sim = laneSim(false, 1) as unknown as {
      step: (ms: number) => void;
      players: Array<{ x: number; slotX: number; hp: number; maxHp: number }>;
      enemies: Array<{ x: number; hp: number; maxHp: number }>;
      frontX: number;
    };
    const zombie = sim.players[0];
    const parked = sim.frontX - KNOCKBACK_PX;
    for (let t = 0; t < 8000; t += 50) {
      zombie.x = parked;
      zombie.slotX = parked;
      sim.step(50);
    }
    expect(sim.enemies[0].hp).toBeLessThan(sim.enemies[0].maxHp); // being hit…
    expect(zombie.hp).toBe(zombie.maxHp); // …but its reach is unchanged.
  });
});

describe("the front row still takes the hits", () => {
  it("targets the front-most zombie whenever one is in melee range", () => {
    // The reach-of-last-resort must not turn into a free pass to snipe the back row:
    // with a front row present, nothing about targeting changes.
    const sim = laneSim(false, 4);
    for (let t = 0; t < 6000; t += 50) sim.step(50);
    const players = playersOf(sim).filter((p) => p.alive);
    const hurt = players.filter((p) => p.hp < p.maxHp);
    expect(hurt.length).toBeGreaterThan(0);
    const enemy = enemyOf(sim);
    // Everything damaged is inside melee reach — the back of the band is untouched.
    for (const p of hurt) expect(Math.abs(p.x - enemy.x)).toBeLessThanOrEqual(60);
  });
});
