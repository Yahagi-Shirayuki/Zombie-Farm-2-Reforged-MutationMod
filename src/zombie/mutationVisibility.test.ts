import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureMutationVisibilityScope,
  hiddenMutations,
  isMutationHidden,
  pruneMutationVisibility,
  resetMutationVisibilityCache,
  setMutationHidden,
  visibleMutations,
} from "./mutationVisibility";
import { MUTATION_LIST } from "./mutations";

const ONION = 2;
const CARROT = 4;
// The highest catalogued bit: the point of the arithmetic mask helpers is that a
// mutation past bit 31 survives, which `mask | bit` would not.
const TOP_BIT = MUTATION_LIST[MUTATION_LIST.length - 1].bit;

describe("per-zombie mutation visibility", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  beforeEach(() => {
    values.clear();
    configureMutationVisibilityScope("local:profile-1");
    resetMutationVisibilityCache();
  });

  it("shows every mutation until one is hidden, and only on that zombie", () => {
    const mask = ONION + CARROT;
    expect(visibleMutations("z1", mask)).toBe(mask);

    setMutationHidden("z1", ONION, true);
    expect(visibleMutations("z1", mask)).toBe(CARROT);
    expect(isMutationHidden("z1", ONION)).toBe(true);
    expect(isMutationHidden("z1", CARROT)).toBe(false);
    // z2 carries the same mutations and is untouched by z1's choice.
    expect(visibleMutations("z2", mask)).toBe(mask);
  });

  it("keeps hiding one mutation from taking the others with it", () => {
    setMutationHidden("z1", ONION, true);
    setMutationHidden("z1", CARROT, true);
    expect(visibleMutations("z1", ONION + CARROT)).toBe(0);

    setMutationHidden("z1", ONION, false);
    expect(visibleMutations("z1", ONION + CARROT)).toBe(ONION); // carrot stays hidden
  });

  it("hides a mutation past bit 31, where a bitwise mask would wrap", () => {
    setMutationHidden("z1", TOP_BIT, true);
    expect(hiddenMutations("z1")).toBe(TOP_BIT);
    expect(visibleMutations("z1", TOP_BIT + ONION)).toBe(ONION);
  });

  it("persists the choice, and forgets it once nothing is hidden", () => {
    setMutationHidden("z1", ONION, true);
    resetMutationVisibilityCache(); // as if the page had been reloaded
    expect(isMutationHidden("z1", ONION)).toBe(true);

    setMutationHidden("z1", ONION, false);
    resetMutationVisibilityCache();
    expect(hiddenMutations("z1")).toBe(0);
    expect(values.size).toBe(0); // no empty record left behind
  });

  it("has nothing to hide for a card with no owned unit behind it", () => {
    // Catalog previews and Almanac entries pass no id: they are a species, not a
    // zombie, so there is nothing to remember a choice against.
    expect(visibleMutations(undefined, ONION)).toBe(ONION);
    expect(isMutationHidden(undefined, ONION)).toBe(false);
  });

  it("drops entries for zombies that no longer exist", () => {
    // Ids are reissued from the highest one in the roster, so a sold zombie's
    // record would otherwise dress the next zombie grown into its number.
    setMutationHidden("z1", ONION, true);
    setMutationHidden("z2", CARROT, true);

    pruneMutationVisibility(["z2", "z3"]);
    expect(hiddenMutations("z1")).toBe(0);
    expect(hiddenMutations("z2")).toBe(CARROT);
  });

  it("keeps preferences separate when farms reuse the same zombie id", () => {
    setMutationHidden("z1", ONION, true);

    configureMutationVisibilityScope("local:profile-2");
    expect(hiddenMutations("z1")).toBe(0);
    setMutationHidden("z1", CARROT, true);

    configureMutationVisibilityScope("local:profile-1");
    expect(hiddenMutations("z1")).toBe(ONION);
    configureMutationVisibilityScope("local:profile-2");
    expect(hiddenMutations("z1")).toBe(CARROT);
  });

  it("clears stale preferences when the owned roster is empty", () => {
    setMutationHidden("z1", ONION, true);
    pruneMutationVisibility([]);
    expect(hiddenMutations("z1")).toBe(0);
    expect(values.size).toBe(0);
  });

  it("adopts the old device-wide record only for the currently open farm", () => {
    values.set("zf2r.zombieHiddenMutations", '{"z1":2}');
    resetMutationVisibilityCache();
    expect(hiddenMutations("z1")).toBe(ONION);
    expect(values.has("zf2r.zombieHiddenMutations")).toBe(false);

    configureMutationVisibilityScope("local:profile-2");
    expect(hiddenMutations("z1")).toBe(0);
  });

  it("survives a corrupt or foreign record rather than taking a rig down", () => {
    values.set("zf2r.zombieHiddenMutations:local%3Aprofile-1", '{"z1":"lots","z2":8}');
    resetMutationVisibilityCache();
    expect(hiddenMutations("z1")).toBe(0);
    expect(hiddenMutations("z2")).toBe(8);

    values.set("zf2r.zombieHiddenMutations:local%3Aprofile-1", "not json");
    resetMutationVisibilityCache();
    expect(hiddenMutations("z2")).toBe(0);
  });
});
