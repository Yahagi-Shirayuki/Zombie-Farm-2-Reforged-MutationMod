import { describe, expect, it } from "vitest";
import { ensureLocalStoredIds, takeStoredObject } from "./storedObjectOwnership";

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

  describe("local stored ids", () => {
    let minted = 0;
    const mint = () => `stored-${++minted}`;

    it("mints an id for every copy a local save restored as a bare count", () => {
      minted = 0;
      const state = { storedItems: [{ key: "glowFlowerDay", count: 2 }] };
      const ids = new Map<string, string[]>();

      // Without this the reloaded shed slot resolves no instance and both the
      // place-it-back and sell paths give up without a word.
      expect(ensureLocalStoredIds(state, ids, "glowFlowerDay", mint)).toBe("stored-1");
      expect(ids.get("glowFlowerDay")).toEqual(["stored-1", "stored-2"]);
    });

    it("keeps the ids it already has and tops up only the shortfall", () => {
      minted = 0;
      const state = { storedItems: [{ key: "glowFlowerDay", count: 3 }] };
      const ids = new Map([["glowFlowerDay", ["object-9"]]]);

      expect(ensureLocalStoredIds(state, ids, "glowFlowerDay", mint)).toBe("object-9");
      expect(ids.get("glowFlowerDay")).toEqual(["object-9", "stored-1", "stored-2"]);
    });

    it("mints nothing for a key the shed does not hold", () => {
      minted = 0;
      const state = { storedItems: [{ key: "glowFlowerDay", count: 1 }] };
      const ids = new Map<string, string[]>();

      expect(ensureLocalStoredIds(state, ids, "windmill", mint)).toBeUndefined();
      expect(ids.has("windmill")).toBe(false);
      expect(minted).toBe(0);
    });

    it("hands the minted copy to takeStoredObject exactly once", () => {
      minted = 0;
      const state = {
        storedItems: [{ key: "glowFlowerDay", count: 1 }],
        retrieveItem: (key: string) => {
          const entry = state.storedItems.find((item) => item.key === key);
          if (!entry || entry.count < 1) return false;
          entry.count--;
          return true;
        },
      };
      const ids = new Map<string, string[]>();

      const first = ensureLocalStoredIds(state, ids, "glowFlowerDay", mint)!;
      expect(takeStoredObject(state, ids, { key: "glowFlowerDay", instanceId: first })).toBe(true);
      expect(state.storedItems[0].count).toBe(0);
      // Sold out: the count is gone, so no fresh id may appear for a second sale.
      expect(ensureLocalStoredIds(state, ids, "glowFlowerDay", mint)).toBeUndefined();
    });
  });
});
