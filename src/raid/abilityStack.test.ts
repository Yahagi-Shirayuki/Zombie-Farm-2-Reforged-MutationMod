// The battle strip's STACKED buttons: Bash/Smash share one, Explode/Explode Ver.2
// share one (ACTIVATED_STACKS). The reason is layout — five separate buttons ran the
// active column off the bottom of a phone held in landscape — so the arithmetic that
// the column now fits is pinned here alongside the behaviour.
import { describe, expect, it } from "vitest";
import { BattleSim } from "./BattleSim";
import { activatedGroupsOf, ACTIVATED_STACKS } from "../zombie/abilities";
import { computeRaidHudLayout } from "./raidHudLayout";
import type { CombatUnit } from "./types";

function unit(over: Partial<CombatUnit> & Pick<CombatUnit, "id" | "sourceKey" | "team">): CombatUnit {
  return {
    name: over.id,
    str: 5, dex: 5, con: 30, focus: 100, hp: 3000, maxHp: 3000,
    attackCooldownMs: 1000,
    attacks: [{ name: "", frequency: 1, mult: 1 }],
    isBoss: false, alive: true, isGarden: false, isHeadless: false, abilities: [],
    ...over,
  };
}

const enemy = () => unit({ id: "enemy", sourceKey: "FarmStageActorFarmhand", team: "enemy", con: 3000 });

/** Run the sim until `group` has at least `want` ready carriers (zombies have to walk
 *  up to the line first). Deliberately bounded well inside the four-minute sim cap, so
 *  a group that never arms fails the assertion rather than a finished-fight artefact. */
function stepUntilReady(sim: BattleSim, group: string[], want = 1): void {
  for (let i = 0; i < 2000 && !sim.finished; i++) {
    const st = sim.activatedGroupStatus().find((s) => s.keys[0] === group[0]);
    if (st && st.ready >= want) return;
    sim.step(50);
  }
}

describe("activatedGroupsOf", () => {
  it("puts each family on one button and leaves everything else alone", () => {
    expect(activatedGroupsOf(["attachMini", "bash", "bashV2", "explode", "explodeV2"]))
      .toEqual([["attachMini"], ["bashV2", "bash"], ["explodeV2", "explode"]]);
  });

  it("drops members the army does not carry, so a lone move is a group of one", () => {
    expect(activatedGroupsOf(["bash", "explodeV2"])).toEqual([["bash"], ["explodeV2"]]);
  });

  it("orders a group highest tier first, whichever member the army mentions first", () => {
    expect(activatedGroupsOf(["explode", "explodeV2"])).toEqual([["explodeV2", "explode"]]);
  });

  it("gives a group the slot its earliest member would have had", () => {
    // Explode is named before Bash, so the explosion button sits above the bash one —
    // slot order still follows first appearance, which is what keeps the column stable.
    expect(activatedGroupsOf(["explode", "bash", "bashV2", "explodeV2"]))
      .toEqual([["explodeV2", "explode"], ["bashV2", "bash"]]);
  });

  it("is idempotent — regrouping an already-grouped list changes nothing", () => {
    const keys = ["attachMini", "bash", "bashV2", "explode", "explodeV2"];
    const flat = activatedGroupsOf(keys).flat();
    expect(activatedGroupsOf(flat)).toEqual(activatedGroupsOf(keys));
  });
});

describe("the stacked button's next move", () => {
  it("spends the upgrade while any carrier is ready for it", () => {
    // Explode Ver.2 is the only one of the pair that can hit a boss, so a rule that
    // could leave it unreachable would cost a capability, not just a preference.
    const both = unit({
      id: "lep", sourceKey: "ZombieActorSmallTier5", team: "player",
      abilities: ["explode", "explodeV2"],
    });
    const sim = new BattleSim([both], [enemy()], null, true);
    const group = sim.activatedGroups[0];
    expect(group).toEqual(["explodeV2", "explode"]);
    stepUntilReady(sim, group);
    expect(sim.nextInGroup(group)).toBe("explodeV2");
  });

  it("falls back to the base move once the upgrade is spent", () => {
    // Both tiers in the army, so the button really is a stack — then the only Ver.2
    // carrier uses its one shot. The button must not go on advertising a move nobody
    // can still perform while a plain Explode is standing right there.
    const v2 = unit({
      id: "v2", sourceKey: "ZombieActorSmallTier4", team: "player", abilities: ["explodeV2"],
    });
    const base = unit({
      id: "base", sourceKey: "ZombieActorSmallTier3", team: "player", abilities: ["explode"],
    });
    const sim = new BattleSim([v2, base], [enemy()], null, true);
    const group = sim.activatedGroups[0];
    expect(group).toEqual(["explodeV2", "explode"]);
    stepUntilReady(sim, group, 2);
    expect(sim.nextInGroup(group)).toBe("explodeV2");
    expect(sim.activate("explodeV2")).toBe(true);
    expect(sim.nextInGroup(group)).toBe("explode");
  });

  it("returns a key `activate` accepts — the tap and the sim never disagree", () => {
    // The whole safety argument for stacking rests on this: the button sends ONE
    // concrete key, and it is a key the sim (and therefore the server's replay of the
    // recorded transcript) will honour. A stack that could hand back a refused key
    // would turn every tap into a wasted input.
    const both = unit({
      id: "lep", sourceKey: "ZombieActorSmallTier5", team: "player",
      abilities: ["explode", "explodeV2"],
    });
    const basher = unit({
      id: "large", sourceKey: "ZombieActorLargeTier4", team: "player",
      abilities: ["bash", "bashV2"],
    });
    const sim = new BattleSim([both, basher], [enemy()], null, true);
    expect(sim.activatedGroups).toHaveLength(2);
    for (const group of sim.activatedGroups) {
      stepUntilReady(sim, group);
      const key = sim.nextInGroup(group);
      expect(group).toContain(key);
      expect(sim.activate(key), key).toBe(true);
    }
  });

  it("keeps a stable face when nothing is ready", () => {
    // Before anyone reaches the line the group has no ready and no present carrier, so
    // the button must still name something — the top key — rather than nothing.
    const both = unit({
      id: "lep", sourceKey: "ZombieActorSmallTier5", team: "player",
      abilities: ["explode", "explodeV2"],
    });
    const sim = new BattleSim([both], [enemy()], null, true);
    expect(sim.nextInGroup(["explodeV2", "explode"])).toBe("explodeV2");
  });
});

describe("the stacked button's badge", () => {
  it("counts a zombie that carries both tiers exactly once", () => {
    // Summing per-key readiness would advertise the Silver Small as two exploders; it
    // is one tap's worth. The badge is a promise about how many taps will land.
    const both = unit({
      id: "lep", sourceKey: "ZombieActorSmallTier5", team: "player",
      abilities: ["explode", "explodeV2"],
    });
    const sim = new BattleSim([both], [enemy()], null, true);
    const group = sim.activatedGroups[0];
    stepUntilReady(sim, group);
    expect(sim.activatedGroupStatus()[0].ready).toBe(1);
    // …and the per-key view the stack replaces is exactly what would have said "2".
    expect(sim.activatedStatus().reduce((n, s) => n + s.ready, 0)).toBe(2);
  });

  it("totals distinct carriers across both tiers", () => {
    const v2 = unit({
      id: "v2", sourceKey: "ZombieActorSmallTier4", team: "player", abilities: ["explodeV2"],
    });
    const base = unit({
      id: "base", sourceKey: "ZombieActorSmallTier3", team: "player", abilities: ["explode"],
    });
    const sim = new BattleSim([v2, base], [enemy()], null, true);
    stepUntilReady(sim, sim.activatedGroups[0], 2);
    expect(sim.activatedGroupStatus()[0].ready).toBe(2);
  });
});

describe("the active column fits a landscape phone", () => {
  // The bug this whole stack exists for. Constants mirror RaidScene's (ABILITY_ACTIVE_R
  // 27, ABILITY_ACTIVE_STEP 64, ABILITY_PASSIVE_R 15, ABILITY_PASSIVE_GAP 7) and the
  // placement at RaidScene.layout: the column starts below the top HUD, and below the
  // passive row when the army has one.
  const R = 27, STEP = 64, PASSIVE_R = 15, PASSIVE_GAP = 7;
  const bottomOf = (buttons: number, height: number, width: number) => {
    // Worst case on both counts: an army that also carries a team passive (so the
    // column starts below the passive row), on a device reporting no safe-area inset
    // to spare. A notched phone in landscape only shrinks the usable height further,
    // which is why the assertions leave no slack to spend.
    const hud = computeRaidHudLayout(width, height, { top: 0, right: 0, bottom: 0, left: 0 }, true);
    const top = hud.topHudHeight + R + PASSIVE_GAP + 2 * PASSIVE_R + 10;
    return top + (buttons - 1) * STEP + R;
  };

  // 375x812 held sideways — the smallest modern phone in landscape.
  const W = 812, H = 375;

  it("stacking is what makes it fit: five buttons overflow, three do not", () => {
    const everything = ["attachMini", "bash", "bashV2", "explode", "explodeV2"];
    expect(everything.length).toBe(5);
    expect(bottomOf(everything.length, H, W)).toBeGreaterThan(H); // the reported bug
    expect(activatedGroupsOf(everything)).toHaveLength(3);
    expect(bottomOf(activatedGroupsOf(everything).length, H, W)).toBeLessThanOrEqual(H);
  });

  it("holds for the worst case a real army can produce", () => {
    // A fully unlocked roster is the most buttons the strip can ever be asked for:
    // every activated move in the catalog, which is every member of every stack plus
    // the unstacked ones.
    const all = [...new Set(["attachMini", ...ACTIVATED_STACKS.flat()])];
    expect(bottomOf(activatedGroupsOf(all).length, H, W)).toBeLessThanOrEqual(H);
  });
});
