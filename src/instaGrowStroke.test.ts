import { describe, expect, it } from "vitest";
import { appendInstaGrowTarget, instaGrowTargetKey, type InstaGrowTarget } from "./instaGrowStroke";

describe("Insta-Grow drag stroke", () => {
  it("deduplicates every crop and Zombie Pot while retaining crossing order", () => {
    const crop: InstaGrowTarget = { kind: "crop", oc: 4, or: 8 };
    const pot: InstaGrowTarget = { kind: "pot", instanceId: "pot-1" };
    const targets: InstaGrowTarget[] = [];
    const seen = new Set<string>();

    expect(appendInstaGrowTarget(crop, targets, seen)).toBe(true);
    expect(appendInstaGrowTarget(crop, targets, seen)).toBe(false);
    expect(appendInstaGrowTarget(pot, targets, seen)).toBe(true);
    expect(appendInstaGrowTarget(pot, targets, seen)).toBe(false);
    expect(targets).toEqual([crop, pot]);
  });

  it("uses distinct keys for crops and pots", () => {
    expect(instaGrowTargetKey({ kind: "crop", oc: 1, or: 2 })).toBe("crop:1,2");
    expect(instaGrowTargetKey({ kind: "pot", instanceId: "1,2" })).toBe("pot:1,2");
  });
});
