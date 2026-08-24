import { describe, expect, it } from "vitest";
import { appendCancelTarget, cancelTargetKey, type CancelTarget } from "./cancelStroke";

describe("cancel stroke", () => {
  it("keys plot jobs by origin and tree jobs by instance", () => {
    expect(cancelTargetKey({ kind: "plot", jobKind: "harvest", oc: 4, or: 8 }))
      .toBe("plot:4,8");
    expect(cancelTargetKey({ kind: "plot", jobKind: "till", oc: 4, or: 8 }))
      .toBe("plot:4,8");
    expect(cancelTargetKey({ kind: "object", instanceId: "apple-1" }))
      .toBe("object:apple-1");
  });

  it("retains first-crossed order and ignores backtracking duplicates", () => {
    const till: CancelTarget = { kind: "plot", jobKind: "till", oc: 0, or: 0 };
    const plant: CancelTarget = { kind: "plot", jobKind: "plant", oc: 4, or: 0 };
    const tree: CancelTarget = { kind: "object", instanceId: "pear-1" };
    const targets: CancelTarget[] = [];
    const seen = new Set<string>();

    expect(appendCancelTarget(till, targets, seen)).toBe(true);
    expect(appendCancelTarget(plant, targets, seen)).toBe(true);
    expect(appendCancelTarget(tree, targets, seen)).toBe(true);
    expect(appendCancelTarget(till, targets, seen)).toBe(false);
    expect(targets).toEqual([till, plant, tree]);
  });

  // One plot can only hold one queued job at a time, so whatever kind the stroke
  // saw first is the job a later crossing would cancel anyway.
  it("treats a plot as one target regardless of the queued job kind", () => {
    const targets: CancelTarget[] = [];
    const seen = new Set<string>();
    expect(appendCancelTarget({ kind: "plot", jobKind: "harvest", oc: 0, or: 0 }, targets, seen))
      .toBe(true);
    expect(appendCancelTarget({ kind: "plot", jobKind: "till", oc: 0, or: 0 }, targets, seen))
      .toBe(false);
    expect(targets).toHaveLength(1);
  });
});
