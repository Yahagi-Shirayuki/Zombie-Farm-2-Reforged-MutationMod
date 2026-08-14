// The battle strip's STACKED buttons: Explode and Explode Ver.2 share one
// (ACTIVATED_STACKS). The reason is layout — five separate buttons ran the active
// column off the bottom of a phone held in landscape — so the arithmetic that the
// column fits is pinned here alongside the behaviour.
//
// Bash and Smash were stacked too and no longer are: they are a trade, not an upgrade
// (2.75x against 1.8x + a 1 s area stun), so the choice is the player's. That costs a
// fourth button, which the column's adaptive pitch pays for — also pinned below.
import { describe, expect, it } from "vitest";
import { BattleSim } from "./BattleSim";
import { activatedGroupsOf, ACTIVATED_STACKS } from "../zombie/abilities";
import { abilityColumnStep, computeRaidHudLayout } from "./raidHudLayout";
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
  it("stacks the explode family and leaves everything else alone", () => {
    expect(activatedGroupsOf(["attachMini", "bash", "bashV2", "explode", "explodeV2"]))
      .toEqual([["attachMini"], ["bash"], ["bashV2"], ["explodeV2", "explode"]]);
  });

  it("gives Bash and Smash a button each — they are a trade, not an upgrade", () => {
    // The whole point of the split: an army carrying both can spend either one. If
    // these ever collapse back into one group, the player has silently lost the
    // choice between 2.75x and 1.8x-plus-a-stun.
    const groups = activatedGroupsOf(["bash", "bashV2"]);
    expect(groups).toEqual([["bash"], ["bashV2"]]);
    expect(ACTIVATED_STACKS.flat()).not.toContain("bash");
    expect(ACTIVATED_STACKS.flat()).not.toContain("bashV2");
  });

  it("drops members the army does not carry, so a lone move is a group of one", () => {
    expect(activatedGroupsOf(["bash", "explodeV2"])).toEqual([["bash"], ["explodeV2"]]);
  });

  it("orders a group highest tier first, whichever member the army mentions first", () => {
    expect(activatedGroupsOf(["explode", "explodeV2"])).toEqual([["explodeV2", "explode"]]);
  });

  it("gives a group the slot its earliest member would have had", () => {
    // Explode is named first, so the explosion button sits above the bash ones — slot
    // order still follows first appearance, which is what keeps the column stable.
    expect(activatedGroupsOf(["explode", "bash", "bashV2", "explodeV2"]))
      .toEqual([["explodeV2", "explode"], ["bash"], ["bashV2"]]);
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
    //
    // One button per sim, deliberately: a zombie's cooldown is per-ZOMBIE, not per
    // move, so firing one of its buttons legitimately refuses the rest for ten
    // seconds. That is the subject of the next test, not a disagreement here.
    const army = () => [
      unit({
        id: "lep", sourceKey: "ZombieActorSmallTier5", team: "player",
        abilities: ["explode", "explodeV2"],
      }),
      unit({
        id: "large", sourceKey: "ZombieActorLargeTier4", team: "player",
        abilities: ["bash", "bashV2"],
      }),
    ];
    // One stacked explode button plus a button each for Bash and Smash.
    expect(new BattleSim(army(), [enemy()], null, true).activatedGroups).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const sim = new BattleSim(army(), [enemy()], null, true);
      const group = sim.activatedGroups[i];
      stepUntilReady(sim, group);
      const key = sim.nextInGroup(group);
      expect(group).toContain(key);
      expect(sim.activate(key), key).toBe(true);
    }
  });

  it("spends the zombie, not the move: one Large's two buttons share one cooldown", () => {
    // The split hands the player a choice, not a second charge. A rank-4 Large shows
    // up ready on BOTH the Bash and the Smash button — it can perform either — and
    // committing one takes the other away until its ten seconds are up. Anything else
    // would double every veteran Large's output.
    const basher = unit({
      id: "large", sourceKey: "ZombieActorLargeTier4", team: "player",
      abilities: ["bash", "bashV2"],
    });
    const sim = new BattleSim([basher], [enemy()], null, true);
    const [bashGroup, smashGroup] = sim.activatedGroups;
    expect([bashGroup, smashGroup]).toEqual([["bash"], ["bashV2"]]);

    stepUntilReady(sim, bashGroup);
    const ready = () => sim.activatedGroupStatus().map((s) => s.ready);
    expect(ready()).toEqual([1, 1]); // either move is available…

    expect(sim.activate("bash")).toBe(true);
    expect(ready()).toEqual([0, 0]); // …and spending one spends the zombie
    expect(sim.activate("bashV2")).toBe(false);
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
  // The bug the stack exists for, and the budget the un-stacked Bash/Smash pair has to
  // live inside. Constants mirror RaidScene's (ABILITY_ACTIVE_R 27, ABILITY_ACTIVE_STEP
  // 64, ABILITY_PASSIVE_R 15, ABILITY_PASSIVE_GAP 7) and the placement at
  // RaidScene.layout: the column starts below the top HUD, and below the passive row
  // when the army has one.
  const R = 27, STEP = 64, PASSIVE_R = 15, PASSIVE_GAP = 7;

  // Worst case: an army that also carries a team passive, so the column starts below
  // the passive row as well as the top HUD.
  const columnTop = (height: number, width: number, safeBottom: number) =>
    computeRaidHudLayout(width, height, { top: 0, right: 0, bottom: safeBottom, left: 0 }, true)
      .topHudHeight + R + PASSIVE_GAP + 2 * PASSIVE_R + 10;

  /** Bottom edge of the last button, at the pitch `layout` would actually choose. */
  const bottomOf = (buttons: number, height: number, width: number, safeBottom = 0) => {
    const top = columnTop(height, width, safeBottom);
    const step = abilityColumnStep(buttons, top, height - safeBottom - 8, R, STEP);
    return top + (buttons - 1) * step + R;
  };

  /** What the column would measure at the authored pitch, with no tightening. */
  const rigidBottomOf = (buttons: number, height: number, width: number, safeBottom = 0) =>
    columnTop(height, width, safeBottom) + (buttons - 1) * STEP + R;

  // 375x812 held sideways — the smallest modern phone in landscape.
  const W = 812, H = 375;
  // An iPhone's home indicator in landscape. The original fix measured against a bare
  // viewport; four buttons only fit once this is honoured, so it is honoured here.
  const INDICATOR = 21;

  it("five buttons overflow — which is why the explode pair still shares one", () => {
    const everything = ["attachMini", "bash", "bashV2", "explode", "explodeV2"];
    expect(everything.length).toBe(5);
    expect(rigidBottomOf(5, H, W)).toBeGreaterThan(H); // the reported bug
    expect(activatedGroupsOf(everything)).toHaveLength(4);
  });

  it("four buttons need the adaptive pitch once the home indicator is honoured", () => {
    // This is the whole cost of un-stacking Bash and Smash, stated as arithmetic: at
    // the authored 64 px pitch the fourth button clears the viewport but not the
    // indicator. Tightening the pitch is what buys it back.
    const limit = H - INDICATOR;
    expect(rigidBottomOf(4, H, W, INDICATOR)).toBeGreaterThan(limit);
    expect(bottomOf(4, H, W, INDICATOR)).toBeLessThanOrEqual(limit);
  });

  it("holds for the worst case a real army can produce", () => {
    // A fully unlocked roster is the most buttons the strip can ever be asked for:
    // every activated move in the catalog — every member of every stack, plus the
    // unstacked ones.
    const all = [...new Set(["attachMini", "bash", "bashV2", ...ACTIVATED_STACKS.flat()])];
    const buttons = activatedGroupsOf(all).length;
    expect(buttons).toBe(4);
    expect(bottomOf(buttons, H, W, INDICATOR)).toBeLessThanOrEqual(H - INDICATOR);
  });

  it("leaves a short column at the authored spacing", () => {
    // Only a column that would otherwise overhang pays anything. An army with one or
    // two buttons must look exactly as it did before.
    const top = columnTop(H, W, INDICATOR);
    expect(abilityColumnStep(1, top, H - INDICATOR - 8, R, STEP)).toBe(STEP);
    expect(abilityColumnStep(2, top, H - INDICATOR - 8, R, STEP)).toBe(STEP);
  });

  it("never tightens buttons into each other, even on a viewport too short to fit", () => {
    // Past the point where the pitch would overlap thumb targets it clamps and lets the
    // column overflow instead — an unreachable button beats a pile of ambiguous ones.
    const step = abilityColumnStep(4, columnTop(240, W, 0), 240, R, STEP);
    expect(step).toBeGreaterThanOrEqual(2 * R + 2);
  });
});
