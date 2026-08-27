import { describe, expect, it } from "vitest";
import zombieRows from "../../public/assets/zombies.json";
import { bitOf, mutationBonus, occupiedSlots } from "./mutations";
import { makeOwned } from "./types";
import { upgradeVariantMutations, VARIANT_MUTATION_UPGRADE } from "./variantMutations";
import type { ZombieDef } from "../assets";

const rows = zombieRows as unknown as ZombieDef[];
const row = (key: string) => rows.find((z) => z.key === key)!;

const EYEBISCUS = "ZombieActorRegularTier4Eyebiscus";
const HEARTICHOKE = "ZombieActorRegularTier4Heartichoke";

describe("retiring the shared Tier-4 bits", () => {
  it("swaps a legacy unit's shared bit for the mutation the species owns now", () => {
    expect(upgradeVariantMutations(EYEBISCUS, bitOf("carrot"))).toBe(bitOf("eyebiscus"));
    expect(upgradeVariantMutations(HEARTICHOKE, bitOf("cauli"))).toBe(bitOf("heartichoke"));
  });

  it("leaves every other mutation on the unit alone", () => {
    const mask = bitOf("cauli") | bitOf("turnip") | bitOf("flytrap");
    expect(upgradeVariantMutations(HEARTICHOKE, mask))
      .toBe(bitOf("heartichoke") | bitOf("turnip") | bitOf("flytrap"));
  });

  it("leaves every other species alone, shared bit or not", () => {
    const mask = bitOf("carrot") | bitOf("cauli");
    expect(upgradeVariantMutations("ZombieActorRegularTier1Carrots", mask)).toBe(mask);
    expect(upgradeVariantMutations("ZombieActorRegularTier2Cauliflower", mask)).toBe(mask);
    expect(upgradeVariantMutations("ZombieActorRegularTier1", mask)).toBe(mask);
  });

  it("is a no-op on a unit already carrying the new bit", () => {
    const mask = bitOf("heartichoke") | bitOf("garlic");
    expect(upgradeVariantMutations(HEARTICHOKE, mask)).toBe(mask);
  });

  it("keeps one mutation per slot when the new bit lands in an occupied one", () => {
    // Heartichoke moved from hair_eye to body, so a legacy unit could hold BOTH it and
    // a Lima Bean. The replacement takes the slot, exactly as the Zombie Pot resolves a
    // conflict (higher bit wins), and it is the better of the two anyway.
    const upgraded = upgradeVariantMutations(HEARTICHOKE, bitOf("cauli") | bitOf("limabean"));
    expect(upgraded).toBe(bitOf("heartichoke"));
    expect(occupiedSlots(upgraded)).toEqual(new Set(["body"]));
  });

  it("upgrades through makeOwned, which the client AND the raid verifier build with", () => {
    // One implementation on both sides: a legacy unit that came out with different
    // stats on the server would desync a replay.
    const legacy = makeOwned("z1", row(HEARTICHOKE), 0, 0, 0, bitOf("cauli"));
    const fresh = makeOwned("z2", row(HEARTICHOKE), 0, 0);
    expect(legacy.mutation).toBe(bitOf("heartichoke"));
    expect(legacy.con).toBe(fresh.con);
    expect(legacy.con).toBe(row(HEARTICHOKE).con! + mutationBonus(bitOf("heartichoke")).con);
  });

  it("names a species and a mutation the catalog actually has", () => {
    for (const [key, upgrades] of Object.entries(VARIANT_MUTATION_UPGRADE)) {
      expect(rows.some((z) => z.key === key), `unknown species ${key}`).toBe(true);
      for (const [legacy, own] of Object.entries(upgrades)) {
        expect(() => bitOf(legacy)).not.toThrow();
        expect(() => bitOf(own)).not.toThrow();
      }
    }
  });

  it("gives each Tier-4 species the mutation it now owns as its guaranteed bit", () => {
    expect(row(EYEBISCUS).mutation).toBe(bitOf("eyebiscus"));
    expect(row(HEARTICHOKE).mutation).toBe(bitOf("heartichoke"));
  });
});
