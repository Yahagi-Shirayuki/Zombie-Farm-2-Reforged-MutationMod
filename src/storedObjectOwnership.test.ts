import { describe, expect, it } from "vitest";
import { takeStoredObject } from "./storedObjectOwnership";

describe("stored object ownership", () => {
  it("rejects a pending placement after that exact item was sold", () => {
    let count = 1;
    const state = {
      retrieveItem: () => {
        if (count < 1) return false;
        count--;
        return true;
      },
    };
    const ids = new Map([["windmill", ["object-1"]]]);
    const selected = { key: "windmill", instanceId: "object-1" };

    expect(takeStoredObject(state, ids, selected)).toBe(true); // sold
    expect(takeStoredObject(state, ids, selected)).toBe(false); // stale placement
    expect(count).toBe(0);
  });

  it("does not consume another copy when the selected instance is stale", () => {
    let count = 1;
    const state = {
      retrieveItem: () => {
        count--;
        return true;
      },
    };
    const ids = new Map([["fence", ["object-2"]]]);

    expect(takeStoredObject(state, ids, { key: "fence", instanceId: "object-1" })).toBe(false);
    expect(ids.get("fence")).toEqual(["object-2"]);
    expect(count).toBe(1);
  });
});
