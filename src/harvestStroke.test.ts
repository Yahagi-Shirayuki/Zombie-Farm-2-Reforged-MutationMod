import { describe, expect, it } from "vitest";
import {
  appendHarvestTarget,
  harvestTargetKey,
  sampleStrokeSegment,
  type HarvestTarget,
} from "./harvestStroke";

describe("harvest stroke", () => {
  it("uses canonical keys for harvests, re-plows, and trees", () => {
    expect(harvestTargetKey({ kind: "plot", oc: 4, or: 8, isZombie: false }))
      .toBe("plot:4,8");
    expect(harvestTargetKey({ kind: "tree", instanceId: "apple-1" }))
      .toBe("tree:apple-1");
    expect(harvestTargetKey({ kind: "replow", oc: 12, or: 16 }))
      .toBe("replow:12,16");
  });

  it("retains first-crossed order and ignores backtracking duplicates", () => {
    const crop: HarvestTarget = { kind: "plot", oc: 0, or: 0, isZombie: false };
    const tree: HarvestTarget = { kind: "tree", instanceId: "pear-1" };
    const replow: HarvestTarget = { kind: "replow", oc: 4, or: 0 };
    const targets: HarvestTarget[] = [];
    const seen = new Set<string>();

    expect(appendHarvestTarget(crop, targets, seen)).toBe(true);
    expect(appendHarvestTarget(tree, targets, seen)).toBe(true);
    expect(appendHarvestTarget(replow, targets, seen)).toBe(true);
    expect(appendHarvestTarget(crop, targets, seen)).toBe(false);
    expect(targets).toEqual([crop, tree, replow]);
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

  // The property every drag-paint tool depends on, and the one the plant stroke used
  // to violate by reading raw pointermove positions instead of sampling between them:
  // a swipe fast enough to cross several plots between two pointer events must still
  // land inside every plot on the way. A gesture is fastest in its MIDDLE, which is
  // why the plots players found unplanted were the ones in the middle of the drag.
  it("lands inside every plot a fast swipe crosses", () => {
    // Screen-space walk across seven 4x4 plots laid in a row: each is 96px along x
    // and 48px along y in isometric space (PLOT * HW, PLOT * HH).
    const PLOT_DX = 96;
    const PLOT_DY = 48;
    const start = { x: 0, y: 0 };
    const end = { x: PLOT_DX * 6, y: PLOT_DY * 6 };
    const points = sampleStrokeSegment(start, end);
    // Which plot each sampled point falls in, by its offset along the run.
    const visited = new Set(points.map((point) => Math.round(point.x / PLOT_DX)));
    for (let plot = 1; plot <= 6; plot++) {
      expect(visited.has(plot), `plot ${plot} was jumped over`).toBe(true);
    }
  });
});
