import { describe, expect, it } from "vitest";
import { matchesMutationReplacement, mutationBitsForRendering } from "./mutationVisual";

describe("mutation visual replacements", () => {
  it("omits carrot-eye artwork from special zombies without changing other mutations", () => {
    const zombies = [
      { key: "regular", category: "normal" as const },
      { key: "special", category: "special" as const },
    ];

    expect(mutationBitsForRendering(zombies, "regular", 4 | 8)).toEqual([4, 8]);
    expect(mutationBitsForRendering(zombies, "special", 4 | 8)).toEqual([8]);
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
