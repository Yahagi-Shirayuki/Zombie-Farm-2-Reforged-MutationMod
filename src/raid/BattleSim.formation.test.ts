// Who stands at the front of the line, and therefore who dies.
//
// This sim's enemies do not chip the whole front row — `playerInRange` picks the single
// front-most zombie down the lane and commits everything to it. So the body-type standoff
// in `assignFormation` is not cosmetic: whichever body plants closest to the enemy is the
// body that absorbs the entire fight.
//
// The binary puts the LIGHTEST body there (`Small: -15`, and the front-most slot of its
// band), which in this sim made every Mini in the army the designated casualty. Players
// reported their Minis pushing to the front and getting themselves killed. So Minis were
// folded into the Regular bucket — see MINI_STANDS_WITH_REGULAR in BattleSim.ts. The
// Headless still pushes to the front, because that is the whole point of a Headless.
//
// These tests pin both halves of that. If a future pass "restores" the disassembled
// `Small` bucket, the first test here is what should stop it.
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

const mini = (id: string) =>
  unit({ id, sourceKey: "ZombieActorSmallTier1", group: "Small", team: "player" });
const regular = (id: string) =>
  unit({ id, sourceKey: "ZombieActorRegularTier1", group: "Regular", team: "player" });
const large = (id: string) =>
  unit({ id, sourceKey: "ZombieActorLargeTier1", group: "Large", team: "player" });
const headless = (id: string) =>
  unit({ id, sourceKey: "ZombieActorHeadlessTier1", group: "Headless", team: "player", isHeadless: true });

/** An army deployed onto the lane against one indestructible enemy, stepped far enough
 *  for everyone to reach their slot. Returns the sim so slots can be read off it. */
function deployed(players: CombatUnit[]) {
  const enemy = unit({
    id: "e", sourceKey: "FarmStageActorBoss", team: "enemy", con: 100000, str: 1, dex: 1,
  });
  const sim = new BattleSim(
    players, [enemy], null, true, [], 10 * 60 * 1000, null, null, false, false, false, 60, null, null
  );
  for (const p of players) sim.units.find((u) => u.id === p.id)!.state = "advance";
  for (let t = 0; t < 8000; t += 50) sim.step(50);
  return sim;
}

/** The zombie standing nearest the enemy — the one `playerInRange` hands every blow to. */
const frontMostId = (sim: BattleSim): string =>
  sim.units
    .filter((u) => u.team === "player" && u.alive)
    .reduce((best, u) => (u.x > best.x ? u : best)).id;

describe("a Mini does not push to the front of the line", () => {
  // Deploy order still decides the lead slot — that is what "the same priority as the
  // other bodies" means. What a Mini must no longer do is OVERTAKE the bodies sent in
  // ahead of it, which is exactly what the disassembled `Small` bucket made it do.
  it("does not overtake the bodies deployed before it", () => {
    const sim = deployed([regular("r"), large("l"), mini("m")]);
    expect(frontMostId(sim)).toBe("r");
  });

  it("stands level with a Regular rather than ahead of it", () => {
    const sim = deployed([mini("m"), regular("r")]);
    const m = sim.units.find((u) => u.id === "m")!;
    const r = sim.units.find((u) => u.id === "r")!;
    const enemyX = sim.units.find((u) => u.id === "e")!.x;
    // Same bucket, same standoff: the pair still fan across their row's slots, but the
    // gap between them is a slot step, not the body-type gulf the source's -15 opened.
    expect(Math.abs(m.x - r.x)).toBeLessThanOrEqual(Math.abs(m.x - enemyX) * 0.15);
  });

  it("takes no more of the incoming damage than the body beside it", () => {
    // The report was that Minis get themselves killed. Sent in behind a Regular, the
    // Mini must not be the one soaking the fight.
    const players = [regular("r"), mini("m")];
    const enemy = unit({
      id: "e", sourceKey: "FarmStageActorBoss", team: "enemy", con: 100000, str: 8, dex: 4,
    });
    const sim = new BattleSim(
      players, [enemy], null, true, [], 10 * 60 * 1000, null, null, false, false, false, 60, null, null
    );
    for (const p of players) sim.units.find((u) => u.id === p.id)!.state = "advance";
    for (let t = 0; t < 30_000; t += 50) sim.step(50);
    const hpLost = (id: string) => {
      const u = sim.units.find((x) => x.id === id)!;
      return u.maxHp - Math.max(0, u.alive ? u.hp : 0);
    };
    expect(hpLost("m")).toBeLessThanOrEqual(hpLost("r"));
  });
});

describe("a Headless still pushes to the front of the line", () => {
  it("takes the lead slot ahead of every ordinary body", () => {
    const sim = deployed([regular("r"), large("l"), headless("h")]);
    expect(frontMostId(sim)).toBe("h");
  });

  it("takes it ahead of a Mini too", () => {
    const sim = deployed([mini("m"), headless("h")]);
    expect(frontMostId(sim)).toBe("h");
  });
});
