import { describe, expect, it } from "vitest";
import { cropMutationBits, resolveCropMutations, plotsTouch } from "./cropMutations";

describe("crop-adjacency mutations", () => {
  it("touches all eight lattice neighbours and not the plot itself", () => {
    const touching = [
      [-4, -4], [0, -4], [4, -4],
      [-4, 0],           [4, 0],
      [-4, 4],  [0, 4],  [4, 4],
    ];
    for (const [dc, dr] of touching) expect(plotsTouch(0, 0, dc, dr, 4)).toBe(true);
    expect(plotsTouch(0, 0, 0, 0, 4)).toBe(false);
  });

  it("touches plots laid down flush but off the lattice", () => {
    // A plot two tiles east and a full plot north: its footprint runs along the top
    // edge without its origin being (0,-4). This is the reported bug — a farm plowed
    // in several strokes has plots that touch without sharing a lattice.
    expect(plotsTouch(0, 0, 2, -4, 4)).toBe(true);
    expect(plotsTouch(0, 0, -1, 4, 4)).toBe(true);
    expect(plotsTouch(0, 0, 4, 3, 4)).toBe(true);
  });

  it("does not touch a plot with a gap between the footprints", () => {
    expect(plotsTouch(0, 0, 5, 0, 4)).toBe(false); // one clear tile column between
    expect(plotsTouch(0, 0, 0, -5, 4)).toBe(false);
    expect(plotsTouch(0, 0, 8, 8, 4)).toBe(false);
  });

  it("gives one adjacent crop a 25% roll", () => {
    expect(resolveCropMutations(0, ["carrot"], { random: () => 0.249 })).toBe(4);
    expect(resolveCropMutations(0, ["carrot"], { random: () => 0.25 })).toBe(0);
  });

  it("stacks matching adjacent crops linearly to 100%", () => {
    expect(resolveCropMutations(0, ["carrot", "carrot", "carrot", "carrot"], {
      random: () => 1,
    })).toBe(4);
  });

  it("can grant every independently rolled non-conflicting mutation", () => {
    expect(resolveCropMutations(0, ["tomato", "carrot", "celery", "lima_beans"], {
      random: () => 0.1,
    })).toBe(1 | 4 | 64 | 1024);
  });

  it("never creates illegal same-slot or headless mutations", () => {
    // Onion wins the head conflict because its roll is lower than Tomato's.
    const rolls = [0.2, 0.1];
    expect(resolveCropMutations(0, ["tomato", "onion"], { random: () => rolls.shift()! })).toBe(2);
    expect(resolveCropMutations(0, ["tomato", "carrot", "celery"], {
      guaranteed: true,
      headless: true,
      random: () => 1,
    })).toBe(64);
  });

  it("grows Pumpking on a headless zombie and on nothing else", () => {
    expect(resolveCropMutations(0, ["pumpking"], { guaranteed: true, headless: true }))
      .toBe(8192);
    expect(resolveCropMutations(0, ["pumpking"], { guaranteed: true })).toBe(0);
    // A zombie with a head of its own grows none, however many are planted around it
    // or how sure the roll is — the Zombie Pot is its only route to one. The crops
    // beside it still mutate normally.
    expect(resolveCropMutations(0, Array(8).fill("pumpking"), { random: () => 0 })).toBe(0);
    expect(resolveCropMutations(0, ["pumpking", "celery"], {
      guaranteed: true, random: () => 1,
    })).toBe(64);
    // It fills the head slot a headless zombie has no other way to use, and leaves
    // the arm/body/neck rolls alone.
    expect(resolveCropMutations(0, ["pumpking", "celery", "onion"], {
      guaranteed: true, headless: true, random: () => 1,
    })).toBe(8192 | 64);
  });

  it("makes every eligible crop mutation guaranteed with the monolith", () => {
    expect(resolveCropMutations(0, ["dragon_fruit"], {
      guaranteed: true,
      random: () => 1,
    })).toBe(4096);
  });
});

describe("crop -> mutation wiring", () => {
  it("names mutations by key, resolving to the bit they persist as", () => {
    expect(cropMutationBits("tomato")).toEqual([1]);
    expect(cropMutationBits("pumpking")).toEqual([8192]);
    expect(cropMutationBits("eyebiscus")).toEqual([4]); // the Tier-4 variant's shared bit
    expect(cropMutationBits("grass")).toEqual([]); // a crop that grows nothing
  });

  it("lets one crop grow SEVERAL mutations, each rolling on its own", () => {
    // The table takes a list as well as a single name. Turnip (8, arm) and potato
    // (16, head) sit in different slots, so a guaranteed roll grows both.
    const crops = { kitchen_sink: ["turnip", "potato"] };
    expect(cropMutationBits("kitchen_sink", crops)).toEqual([8, 16]);
    expect(resolveCropMutations(0, ["kitchen_sink"], { crops, guaranteed: true }))
      .toBe(8 | 16);
    // Same slot, though, still means one wins: the roll order decides, not the list.
    const heads = { two_heads: ["tomato", "garlic"] };
    const grown = resolveCropMutations(0, ["two_heads"], { crops: heads, guaranteed: true });
    expect([1, 256]).toContain(grown);
  });

  it("pools adjacency when two crops name the same mutation", () => {
    // Carrot and eyebiscus both grow bit 4, so two plots of them together clear the
    // 25%-per-plot threshold exactly as two carrot plots would — one roll, not two.
    const random = () => 0.4; // beats 2 x 25%, would fail a single plot's 25%
    expect(resolveCropMutations(0, ["carrot", "eyebiscus"], { random })).toBe(4);
    expect(resolveCropMutations(0, ["carrot"], { random })).toBe(0);
  });

  it("ignores a mutation name the catalog does not have", () => {
    const crops = { corn: "cornhead" };
    expect(cropMutationBits("corn", crops)).toEqual([]);
    expect(resolveCropMutations(0, ["corn"], { crops, guaranteed: true })).toBe(0);
  });
});
