import { describe, expect, it } from "vitest";
import { Field } from "./Field";
import type { PlaceableDef } from "./assets";

// findFreeOrigin is how the object reconcile rescues a server-owned object whose saved
// position was lost: positions live only in the presentation layout, so an object the
// farm holds no tile for is invisible AND unrecoverable. Only the tile bookkeeping
// matters here, so build a Field without its Pixi constructor.
const makeField = (w: number, h: number, occupied: [number, number][] = []): Field => {
  const field: Field = Object.create(Field.prototype);
  Object.assign(field, {
    w, h,
    tilePlot: new Map<string, string>(),
    reserved: new Set<string>(),
    tileObject: new Map(occupied.map(([c, r]) => [`${c},${r}`, "blocker"] as const)),
  });
  return field;
};

const def = (tileW: number, tileH: number) => ({ tileW, tileH } as PlaceableDef);

describe("Field.findFreeOrigin", () => {
  it("returns the near corner of an empty farm", () => {
    expect(makeField(4, 4).findFreeOrigin(def(1, 1))).toEqual({ oc: 0, or: 0 });
  });

  it("skips occupied tiles", () => {
    const field = makeField(3, 3, [[0, 0], [1, 0]]);
    expect(field.findFreeOrigin(def(1, 1))).toEqual({ oc: 2, or: 0 });
  });

  it("never returns an origin whose footprint would overhang the farm", () => {
    // A 2x2 at oc=2 would need column 3, which does not exist on a 3-wide farm.
    const field = makeField(3, 3, [[0, 0]]);
    expect(field.findFreeOrigin(def(2, 2))).toEqual({ oc: 1, or: 0 });
  });

  it("treats a plot and a queued till reservation as occupied", () => {
    const field = makeField(2, 1);
    (field as any).tilePlot.set("0,0", "plot");
    expect(field.findFreeOrigin(def(1, 1))).toEqual({ oc: 1, or: 0 });
    (field as any).reserved.add("1,0");
    expect(field.findFreeOrigin(def(1, 1))).toBeNull();
  });

  it("returns null when the farm has no room, rather than a bad origin", () => {
    expect(makeField(2, 2, [[0, 0], [1, 0], [0, 1], [1, 1]]).findFreeOrigin(def(1, 1))).toBeNull();
    expect(makeField(1, 1).findFreeOrigin(def(2, 2))).toBeNull();
  });
});
