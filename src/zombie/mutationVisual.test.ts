import { describe, expect, it } from "vitest";
import {
  EYE_MUTATION_FOREGROUND_Z,
  matchesMutationReplacement,
  mutationBitsForRendering,
  mutationRefsForRendering,
  mutationPartFor,
  mutationPartZIndex,
} from "./mutationVisual";
import { bitOf, MUTATION_LIST, resolveMutationBit } from "./mutations";
import mutationArt from "../../public/assets/zombie/mutations.json";
import zombieModels from "../../public/assets/zombie/models.json";

describe("mutation visual replacements", () => {
  it("keeps the Carrot/Eyebiscus eye attachment above every other layer", () => {
    expect(mutationPartZIndex(4, "head", 6)).toBe(EYE_MUTATION_FOREGROUND_Z);
    expect(mutationPartZIndex(128, "head", 6)).toBe(EYE_MUTATION_FOREGROUND_Z);
    expect(mutationPartZIndex(8, "root", 8)).toBe(8);
  });

  it("omits carrot-eye artwork from special zombies without changing other mutations", () => {
    const zombies = [
      { key: "regular", category: "normal" as const },
      { key: "special", category: "special" as const },
    ];

    expect(mutationBitsForRendering(zombies, "regular", 4 | 8)).toEqual([4, 8]);
    expect(mutationBitsForRendering(zombies, "special", 4 | 8)).toEqual([8]);
  });

  it("keeps modded string ids in every render ref list", () => {
    const zombies = [
      { key: "regular", category: "normal" as const },
      { key: "special", category: "special" as const },
    ];

    expect(mutationRefsForRendering(zombies, "regular", 4, ["apple_head"]))
      .toEqual([4, "apple_head"]);
    expect(mutationRefsForRendering(zombies, "special", 4, ["apple_head"]))
      .toEqual(["apple_head"]);
  });

  it("matches every base body silhouette without hiding unrelated decorations", () => {
    expect(matchesMutationReplacement("defaultBody", "body")).toBe(true);
    expect(matchesMutationReplacement("bellydancerBody", "body")).toBe(true);
    expect(matchesMutationReplacement("heartichokeBody", "body")).toBe(true);
    expect(matchesMutationReplacement("flytrapCollar", "body")).toBe(false);
  });

  it("replaces only the front arm", () => {
    expect(matchesMutationReplacement("defaultArmF", "armF")).toBe(true);
    expect(matchesMutationReplacement("diverArmF", "armF")).toBe(true);
    expect(matchesMutationReplacement("defaultArmB", "armF")).toBe(false);
    expect(matchesMutationReplacement("dragonArm", "armF")).toBe(false);
  });

  it("replaces the skull while preserving foreground face and accessory layers", () => {
    expect(matchesMutationReplacement("defaultHead", "head")).toBe(true);
    expect(matchesMutationReplacement("defaultUpperTeeth", "head")).toBe(true);
    expect(matchesMutationReplacement("defaultScar", "head")).toBe(true);
    expect(matchesMutationReplacement("defaultEyeL", "head")).toBe(false);
    expect(matchesMutationReplacement("defaultJaw", "head")).toBe(false);
    expect(matchesMutationReplacement("defaultLowerTeeth", "head")).toBe(false);
    expect(matchesMutationReplacement("gnomeFeature", "head")).toBe(false);
    expect(matchesMutationReplacement("barbarianHair", "head")).toBe(false);
    expect(matchesMutationReplacement("defaultBody", "head")).toBe(false);
  });
});

describe("mutation art lookup", () => {
  const part = (file: string) => ({
    file, group: "head" as const, headRel: false, ox: 0, oy: 0, ax: 0, ay: 0, z: 0,
  });
  const shipped = { tomato: part("tomatoHead"), cauli: part("cauliflowerHat") };

  it("finds art by the mutation's KEY, which is how mutations.json is written", () => {
    expect(mutationPartFor(shipped, undefined, bitOf("tomato"))?.file).toBe("tomatoHead");
    expect(mutationPartFor(shipped, {}, bitOf("cauli"))?.file).toBe("cauliflowerHat");
  });

  it("still finds art keyed by a raw bit, so older art keeps resolving", () => {
    // The shipped file was keyed by bit until the keys took over, and a mod may still
    // be. Nothing has to be renamed for its art to appear.
    const parts = { [String(bitOf("pumpking"))]: part("pumpkinHead") };
    expect(mutationPartFor(parts, undefined, bitOf("pumpking"))?.file).toBe("pumpkinHead");
  });

  it("prefers the key-addressed entry when a mutation has both", () => {
    // Only reachable while art is being migrated from one form to the other; pinning
    // it means the change can be made a row at a time without a flicker of ambiguity.
    const parts = { "1": part("oldTomatoHead"), tomato: part("tomatoHead") };
    expect(mutationPartFor(parts, undefined, bitOf("tomato"))?.file).toBe("tomatoHead");
  });

  it("honours a model override addressed either way", () => {
    // This is how the Tier-4 variants show their own art for a shared mutation.
    const parts = { ...shipped, heartichokeBody: part("heartichokeBody") };
    const cauli = bitOf("cauli");
    const byKey = { mutationOverrides: { cauli: "heartichokeBody" } };
    const byBit = { mutationOverrides: { [String(cauli)]: "heartichokeBody" } };
    expect(mutationPartFor(parts, byKey, cauli)?.file).toBe("heartichokeBody");
    expect(mutationPartFor(parts, byBit, cauli)?.file).toBe("heartichokeBody");
  });

  it("returns nothing for a mutation this build ships no art for", () => {
    // The rigs skip a partless mutation AND leave the base body part visible, so a
    // missing image costs one attachment rather than deleting the zombie's head.
    expect(mutationPartFor(shipped, undefined, bitOf("pumpking"))).toBeUndefined();
    expect(mutationPartFor(shipped, { mutationOverrides: { tomato: "missing" } }, bitOf("tomato")))
      .toBeUndefined();
  });
});

describe("shipped mutation data is addressed by name", () => {
  // Both files used to be keyed by the raw bit ("512": {...}), which meant authoring
  // art required knowing a power of two and reading a diff required decoding one.
  // A bit key still RESOLVES (the tests above), so this guards intent rather than
  // capability: the shipped data stays readable.
  const isNumeric = (key: string) => /^\d+$/.test(key);

  it("keys mutations.json by mutation key, never by bit", () => {
    const offenders = Object.keys(mutationArt).filter(isNumeric);
    expect(offenders, `numeric keys in mutations.json: ${offenders.join(", ")}`).toEqual([]);
    // Every catalogued mutation has art, addressed by its own name.
    for (const def of MUTATION_LIST) {
      expect(mutationArt, `no art entry for "${def.key}"`).toHaveProperty(def.key);
    }
  });

  it("keys every model's mutationOverrides by mutation key, never by bit", () => {
    const models = zombieModels as Record<string, { mutationOverrides?: Record<string, string> }>;
    for (const [species, model] of Object.entries(models)) {
      for (const key of Object.keys(model.mutationOverrides ?? {})) {
        expect(isNumeric(key), `${species} overrides bit "${key}"`).toBe(false);
        // ...and it names a mutation that exists, so a typo can't silently do nothing.
        expect(resolveMutationBit(key), `${species} overrides unknown "${key}"`).not.toBeNull();
      }
    }
  });
});
