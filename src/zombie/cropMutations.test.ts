import { describe, expect, it } from "vitest";
import { resolveCropMutations, touchingPlotOffsets } from "./cropMutations";

describe("crop-adjacency mutations", () => {
  it("enumerates all eight touching plots and excludes the center", () => {
    expect(touchingPlotOffsets(4)).toEqual([
      [-4, -4], [0, -4], [4, -4],
      [-4, 0],           [4, 0],
      [-4, 4],  [0, 4],  [4, 4],
    ]);
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
