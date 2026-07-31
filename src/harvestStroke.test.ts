import { describe, expect, it } from "vitest";
import {
  appendHarvestTarget,
  harvestTargetKey,
  sampleStrokeSegment,
  type HarvestTarget,
} from "./harvestStroke";

describe("harvest stroke", () => {
  it("uses canonical keys for plots and trees", () => {
    expect(harvestTargetKey({ kind: "plot", oc: 4, or: 8, isZombie: false }))
      .toBe("plot:4,8");
    expect(harvestTargetKey({ kind: "tree", instanceId: "apple-1" }))
      .toBe("tree:apple-1");
  });

  it("retains first-crossed order and ignores backtracking duplicates", () => {
    const crop: HarvestTarget = { kind: "plot", oc: 0, or: 0, isZombie: false };
    const tree: HarvestTarget = { kind: "tree", instanceId: "pear-1" };
    const targets: HarvestTarget[] = [];
    const seen = new Set<string>();

    expect(appendHarvestTarget(crop, targets, seen)).toBe(true);
    expect(appendHarvestTarget(tree, targets, seen)).toBe(true);
    expect(appendHarvestTarget(crop, targets, seen)).toBe(false);
    expect(targets).toEqual([crop, tree]);
  });

  it("samples fast movement without gaps and includes the release position", () => {
    const points = sampleStrokeSegment({ x: 0, y: 0 }, { x: 25, y: 0 }, 8);
    expect(points).toHaveLength(4);
    expect(points[points.length - 1]).toEqual({ x: 25, y: 0 });
    expect(points.every((point, index) => {
      const prior = index === 0 ? { x: 0, y: 0 } : points[index - 1];
      return Math.hypot(point.x - prior.x, point.y - prior.y) <= 8;
    })).toBe(true);
  });

  it("does not resample a stationary pointer", () => {
    expect(sampleStrokeSegment({ x: 3, y: 7 }, { x: 3, y: 7 })).toEqual([]);
  });
});
