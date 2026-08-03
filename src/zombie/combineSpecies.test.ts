import { describe, expect, it, vi } from "vitest";
import {
  COMBINE_SILVER_BY_GROUP,
  COMBINE_SPECIAL_BY_GROUP,
  createCombineRandom,
  selectCombineSpecies,
  type CombineSpeciesParent,
} from "./combineSpecies";

const parent = (
  key: string,
  extra: Partial<CombineSpeciesParent> = {}
): CombineSpeciesParent => ({ key, tier: 1, group: "Regular", ...extra });

describe("Zombie Pot species selection", () => {
  it("uses the same stable roll regardless of parent id order", () => {
    const forward = createCombineRandom("parent-a", "parent-b");
    const reverse = createCombineRandom("parent-b", "parent-a");
    expect([forward(), forward(), forward()]).toEqual([reverse(), reverse(), reverse()]);
  });

  it("uses slot 1 as the output species", () => {
    const garden = parent("garden", { group: "Garden" });
    const large = parent("large", { group: "Large" });
    expect(selectCombineSpecies(garden, large, 24, () => 0.99)).toBe("garden");
    expect(selectCombineSpecies(large, garden, 24, () => 0.99)).toBe("large");
  });

  it("rejects two specials", () => {
    expect(selectCombineSpecies(
      parent("special-a", { isSpecial: true }),
      parent("special-b", { isSpecial: true }),
      45,
      () => 0
    )).toBeNull();
  });

  it("always preserves a named special parent's species", () => {
    const evolutionRoll = vi.fn(() => 0);
    expect(selectCombineSpecies(
      parent("ZombieActorRegularCrazy", { tier: 5, group: "Regular", isSpecial: true }),
      parent("ordinary", { tier: 99 }),
      45,
      evolutionRoll
    )).toBe("ZombieActorRegularCrazy");
    expect(evolutionRoll).not.toHaveBeenCalled();
    // Backward compatibility for a combine persisted before specials were
    // restricted to slot 1.
    expect(selectCombineSpecies(
      parent("ordinary"),
      parent("ZombieActorBombie", { isSpecial: true, group: "Headless" }),
      45,
      () => 0.99
    )).toBe("ZombieActorBombie");
  });

  it("keeps the named special edge cases", () => {
    expect(selectCombineSpecies(
      parent("ZombieActorBombie", { isSpecial: true, group: "Headless" }),
      parent("ordinary", { group: "Regular" }),
      45,
      () => 0
    )).toBe("ZombieActorBombie");
    expect(selectCombineSpecies(
      parent("ZombieActorHeadlessTier3", { group: "Headless", tier: 3 }),
      parent("ordinary", { group: "Regular" }),
      25,
      () => 0.099
    )).toBe("ZombieActorHeadlessTier5");
  });

  it("does not make a combining special before level 25", () => {
    expect(selectCombineSpecies(
      parent("low", { tier: 1 }),
      parent("high", { tier: 4 }),
      24,
      () => 0.05
    )).toBe("low");
  });

  it("maps every same-type eligible pair to its combining-only special", () => {
    for (const [group, specialKey] of Object.entries(COMBINE_SPECIAL_BY_GROUP)) {
      expect(selectCombineSpecies(
        parent(`${group}-a`, { group }),
        parent(`${group}-b`, { group }),
        25,
        () => 0.099
      )).toBe(specialKey);
    }
  });

  it("promotes the slot-1 type after a successful mixed-type roll", () => {
    const garden = parent("garden", { group: "Garden" });
    const large = parent("large", { group: "Large" });
    expect(selectCombineSpecies(garden, large, 25, () => 0.05))
      .toBe(COMBINE_SPECIAL_BY_GROUP.Garden);
    expect(selectCombineSpecies(large, garden, 25, () => 0.05))
      .toBe(COMBINE_SPECIAL_BY_GROUP.Large);
  });

  it("breeds a matched pair up to its body type's silver", () => {
    for (const [group, silverKey] of Object.entries(COMBINE_SILVER_BY_GROUP)) {
      const same = parent(`${group}-same`, { group });
      expect(selectCombineSpecies(same, { ...same }, 25, () => 0.99)).toBe(silverKey);
    }
    // Two Flameheads -> Party Zombie, the Headless silver.
    const flamehead = parent("ZombieActorHeadlessTier3", { group: "Headless", tier: 3 });
    expect(selectCombineSpecies(flamehead, { ...flamehead }, 45, () => 0.99))
      .toBe("ZombieActorHeadlessTier4");
  });

  it("does not breed a matched pair up before level 25", () => {
    const brute = parent("ZombieActorLargeTier3", { group: "Large", tier: 3 });
    expect(selectCombineSpecies(brute, { ...brute }, 24, () => 0.99))
      .toBe("ZombieActorLargeTier3");
  });

  it("lets the tier-5 promotion override a matched pair's silver", () => {
    // Two Flameheads at level 25+ normally give a Party Zombie; the rare roll
    // upgrades that to Skull Head.
    const flamehead = parent("ZombieActorHeadlessTier3", { group: "Headless", tier: 3 });
    expect(selectCombineSpecies(flamehead, { ...flamehead }, 25, () => 0.099))
      .toBe(COMBINE_SPECIAL_BY_GROUP.Headless);
  });

  it("keeps a matched pair that is already silver", () => {
    // Mutant silvers must not flatten to the plain silver for their group.
    const eyebiscus = parent("ZombieActorRegularTier4Eyebiscus", { group: "Regular", tier: 4 });
    expect(selectCombineSpecies(eyebiscus, { ...eyebiscus }, 45, () => 0.99))
      .toBe("ZombieActorRegularTier4Eyebiscus");
  });

  it("keeps a matched special pair prohibited", () => {
    const bombie = parent("ZombieActorBombie", { group: "Headless", isSpecial: true });
    expect(selectCombineSpecies(bombie, { ...bombie }, 45, () => 0.99)).toBeNull();
  });

  it("uses the ordinary rules when the 10% roll fails", () => {
    expect(selectCombineSpecies(
      parent("mutant", { isMutant: true, tier: 5 }),
      parent("ordinary", { tier: 1 }),
      25,
      () => 0.10
    )).toBe("mutant");
  });
});
