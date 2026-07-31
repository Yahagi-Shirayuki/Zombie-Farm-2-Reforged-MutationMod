import { describe, expect, it } from "vitest";
import { plowRectangle, snapPlowOrigin, uniquePlowOrigins } from "./plowSelection";

describe("plow rectangle selection", () => {
  it("snaps freehand targets to the stroke's 4x4 plot lattice", () => {
    const anchor = { oc: 2, or: 6 };
    expect(snapPlowOrigin(anchor, { oc: 3, or: 7 })).toEqual(anchor);
    expect(snapPlowOrigin(anchor, { oc: 5, or: 9 })).toEqual({ oc: 6, or: 10 });
    expect(snapPlowOrigin(anchor, { oc: -1, or: 2 })).toEqual({ oc: -2, or: 2 });
  });

  it("makes a cardinal line", () => {
    expect(plowRectangle({ oc: 2, or: 6 }, { oc: 10, or: 6 })).toEqual([
      { oc: 2, or: 6 }, { oc: 6, or: 6 }, { oc: 10, or: 6 },
    ]);
  });

  it("fills a rectangle in either direction", () => {
    expect(plowRectangle({ oc: 8, or: 8 }, { oc: 4, or: 12 })).toEqual([
      { oc: 4, or: 8 }, { oc: 8, or: 8 },
      { oc: 4, or: 12 }, { oc: 8, or: 12 },
    ]);
  });

  it("snaps pointer travel to the anchor's plot lattice", () => {
    expect(plowRectangle({ oc: 0, or: 0 }, { oc: 3, or: 2 })).toHaveLength(4);
    expect(plowRectangle({ oc: 0, or: 0 }, { oc: 1, or: 1 })).toEqual([{ oc: 0, or: 0 }]);
  });

  it("deduplicates origins before committing", () => {
    expect(uniquePlowOrigins([
      { oc: 0, or: 0 }, { oc: 4, or: 0 }, { oc: 0, or: 0 },
    ])).toEqual([{ oc: 0, or: 0 }, { oc: 4, or: 0 }]);
  });
});
