import { describe, expect, it, vi } from "vitest";
import type { ZombieDef } from "../assets";
import { bitOf, MODDED_MUTATIONS } from "./mutations";
import { makeOwned } from "./types";
import { ABILITY_TIER, displayStat, randomAbilityPoolForTiers } from "./traits";

function luckyboxDef(
  key: string,
  name: string,
  abilityTiers: number[],
  min: number,
  max: number,
): ZombieDef {
  return {
    key,
    name,
    cost: 5,
    growMs: 86400000,
    category: "special",
    level: 26,
    xp: 1,
    brainsNeeded: true,
    group: "Regular",
    className: "Special",
    classColor: "#c077ff",
    str: 23.32 * min / 100,
    dex: 4.4 * min / 100,
    con: 29.7 * min / 100,
    focus: min,
    mutation: 0,
    tier: 5,
    mutationProfile: "headless",
    abilityKeys: ["randomAbility", "randomAbility", "randomAbility", "randomAbility"],
    randomizeOnCreate: {
      bodyColor: true,
      abilitySlots: 4,
      abilityTiers,
      visualGroups: ["Regular", "Female", "Small", "Large"],
      visualScale: { min: 0.2, max: 2.0 },
      displayStats: {
        str: { min, max },
        dex: { min, max },
        con: { min, max },
        focus: { min, max },
      },
    },
  };
}

const silverBoxDef = luckyboxDef("ZombieActorLuckyboxSilver", "Silver Box Zombie", [1, 2], 10, 50);
const goldBoxDef = luckyboxDef("ZombieActorLuckyboxGold", "Gold Box Zombie", [1, 2, 3], 30, 150);
const platinumBoxDef = luckyboxDef("ZombieActorLuckybox", "Platinum Box Zombie", [1, 2, 3, 4], 50, 200);

describe("Luckybox Zombie", () => {
  it("rolls color, visual size, four real abilities, and bounded displayed stats on creation", () => {
    const zombie = makeOwned("z1", platinumBoxDef, 0, 0);
    const abilityPool = new Set(Object.values(ABILITY_TIER).flat());

    expect(zombie.group).toBe("Regular");
    expect(["Regular", "Female", "Small", "Large"]).toContain(zombie.visualGroup);
    expect(zombie.visualScale).toBeGreaterThanOrEqual(0.2);
    expect(zombie.visualScale).toBeLessThanOrEqual(2.0);
    expect(zombie.color).toHaveLength(3);
    for (const channel of zombie.color ?? []) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
    expect(zombie.abilityKeys).toHaveLength(4);
    for (const key of zombie.abilityKeys ?? []) {
      expect(abilityPool.has(key)).toBe(true);
      expect(key).not.toBe("randomAbility");
    }
    expect(displayStat("str", zombie.str)).toBeGreaterThanOrEqual(50);
    expect(displayStat("str", zombie.str)).toBeLessThanOrEqual(200);
    expect(displayStat("dex", zombie.dex)).toBeGreaterThanOrEqual(50);
    expect(displayStat("dex", zombie.dex)).toBeLessThanOrEqual(200);
    expect(displayStat("con", zombie.con)).toBeGreaterThanOrEqual(50);
    expect(displayStat("con", zombie.con)).toBeLessThanOrEqual(200);
    expect(displayStat("focus", zombie.focus)).toBeGreaterThanOrEqual(50);
    expect(displayStat("focus", zombie.focus)).toBeLessThanOrEqual(200);
  });

  it("limits each box to its authored boss ability pools plus always-unlocked modded skills", () => {
    const silverPool = new Set(randomAbilityPoolForTiers([1, 2]));
    const goldPool = new Set(randomAbilityPoolForTiers([1, 2, 3]));
    const platinumPool = new Set(randomAbilityPoolForTiers([1, 2, 3, 4]));

    for (const key of makeOwned("silver", silverBoxDef, 0, 0).abilityKeys ?? []) {
      expect(silverPool.has(key)).toBe(true);
    }
    for (const key of makeOwned("gold", goldBoxDef, 0, 0).abilityKeys ?? []) {
      expect(goldPool.has(key)).toBe(true);
    }
    for (const key of makeOwned("platinum", platinumBoxDef, 0, 0).abilityKeys ?? []) {
      expect(platinumPool.has(key)).toBe(true);
    }
  });

  it("does not roll Heal or Great Heal from the random ability pool", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    try {
      const zombie = makeOwned("no-heal", platinumBoxDef, 0, 0);
      expect(zombie.abilityKeys).toHaveLength(4);
      expect(zombie.abilityKeys).not.toContain("heal");
      expect(zombie.abilityKeys).not.toContain("healAOE");
    } finally {
      random.mockRestore();
    }
  });

  it("includes the always-unlocked modded skills in random rolls", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const zombie = makeOwned("mod-skills", platinumBoxDef, 0, 0);
      expect(zombie.abilityKeys).toEqual(["freeze", "lifeSteal", "castle", "gymRat"]);
    } finally {
      random.mockRestore();
    }
  });

  it("uses persisted rolls instead of rolling a restored unit again", () => {
    const zombie = makeOwned(
      "z2",
      platinumBoxDef,
      1,
      2,
      0,
      0,
      [12, 34, 56],
      undefined,
      undefined,
      undefined,
      undefined,
      {
        abilityKeys: ["heal", "stun"],
        visualGroup: "Small",
        visualScale: 1.7,
        rolledStats: { str: 10, dex: 2, con: 20, focus: 55 },
      },
    );

    expect(zombie.color).toEqual([12, 34, 56]);
    expect(zombie.abilityKeys).toEqual(["heal", "stun"]);
    expect(zombie.visualGroup).toBe("Small");
    expect(zombie.visualScale).toBe(1.7);
    expect(zombie.rolledStats).toEqual({ str: 10, dex: 2, con: 20, focus: 55 });
    expect(zombie.str).toBe(10);
    expect(zombie.dex).toBe(2);
    expect(zombie.con).toBe(20);
    expect(zombie.focus).toBe(55);
  });

  it("uses headless mutation slots without allowing any head or hair-eye mutation", () => {
    const zombie = makeOwned(
      "z3",
      platinumBoxDef,
      0,
      0,
      0,
      bitOf("pumpking"),
      undefined,
      undefined,
      ["apple_head", "corn_arm"],
    );

    expect(zombie.mutation).toBe(0);
    expect(zombie.mutationIds).toEqual(["corn_arm"]);
    expect(MODDED_MUTATIONS.corn_arm.slot).toBe("arm");
  });
});
