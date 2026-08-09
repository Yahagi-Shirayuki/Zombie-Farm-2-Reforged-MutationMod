import { describe, expect, it } from "vitest";
import placeables from "../public/assets/placeables.json";
import type { PlaceableDef } from "./assets";
import { Field } from "./Field";
import { HW, TILE_H, TILE_W, gridToScreen } from "./iso";

// Road/pond art is drawn to meet its neighbours edge to edge, so it is anchored by
// the pivot the source authored for it rather than bottom-centered on its footprint
// (see Field.flatTileOffset). Bottom-centering left a visible step in the kerb where
// a Stone Road met a Stone Crossing, because each piece's art is a different size.
const defs = placeables as unknown as PlaceableDef[];
const def = (key: string) => {
  const found = defs.find((d) => d.key === key);
  if (!found) throw new Error(`no placeable ${key}`);
  return found;
};

// The two placement internals under test, which Field keeps private.
interface Placement {
  flatTileOffset(d: PlaceableDef, oc: number, or: number, flipped: boolean):
    { dx: number; dy: number };
  footprintAnchor(oc: number, or: number, w: number, h: number): { x: number; y: number };
}

// Only the tile size is read off `assets`; skip the Pixi constructor as the other
// Field tests do.
const makeField = (): Placement => {
  const field: Field = Object.create(Field.prototype);
  Object.assign(field, { assets: { field: { tileW: 48 } } });
  return field as unknown as Placement;
};

// Where the art actually lands: [left, right] and the bottom edge, in world space.
const drawn = (d: PlaceableDef, oc: number, or: number, flipped = false) => {
  const field = makeField();
  const a = field.footprintAnchor(oc, or, d.tileW, d.tileH);
  const off = field.flatTileOffset(d, oc, or, flipped);
  const w = d.nativeW * (TILE_W / 48);
  return {
    left: a.x + off.dx - w / 2,
    right: a.x + off.dx + w / 2,
    bottom: a.y + off.dy,
  };
};

describe("flat tile anchoring", () => {
  it("puts every stone road piece on the same ground point", () => {
    // The pivot pins each piece to the bottom-left corner of its front tile's 48x24
    // box, so pieces of different art sizes still agree on where the ground is.
    const scale = TILE_W / 48;
    for (const key of ["cobblestoneRoadStraight_01", "cobblestoneRoadBend_01",
      "cobblestoneRoadIntersection", "roadStraight", "roadBend_01", "roadIntersection"]) {
      const d = def(key);
      expect(d.flatTile).toBe(true);
      const front = gridToScreen(2 + d.tileW - 1, 3 + d.tileH - 1);
      const r = drawn(d, 2, 3);
      expect(r.left).toBeCloseTo(front.x - HW - d.anchorX! * d.nativeW * scale, 4);
      expect(r.bottom).toBeCloseTo(front.y + TILE_H + d.anchorY! * d.nativeH * scale, 4);
    }
  });

  it("corrects each piece by its own authored amount", () => {
    // The pieces of one path do NOT share a correction — that is the whole bug. A
    // Stone Crossing sat 1.5px above the Stone Road it continued, which showed up as
    // a step in the kerb; the dirt Road and its Bend were 3px apart horizontally.
    const field = makeField();
    const off = (key: string) => field.flatTileOffset(def(key), 0, 0, false);
    expect(off("cobblestoneRoadStraight_01").dy).toBeCloseTo(6.78, 1);
    expect(off("cobblestoneRoadIntersection").dy).toBeCloseTo(8.23, 1);
    expect(off("roadStraight").dx).toBeCloseTo(-0.48, 1);
    expect(off("roadBend_01").dx).toBeCloseTo(2.55, 1);
  });

  it("mirrors a flipped piece about its own ground tile", () => {
    // Flipping must not slide the piece off the footprint: the mirrored art spans the
    // reflection of the original about the front tile's centre line.
    const d = def("cobblestoneRoadBend_01");
    const base = drawn(d, 1, 1);
    const flip = drawn(d, 1, 1, true);
    const centre = gridToScreen(1 + d.tileW - 1, 1 + d.tileH - 1).x; // tile centre line
    expect(flip.left).toBeCloseTo(2 * centre - base.right, 4);
    expect(flip.right).toBeCloseTo(2 * centre - base.left, 4);
    expect(flip.bottom).toBeCloseTo(base.bottom, 4);
  });

  it("leaves objects that stand up off the ground bottom-centered", () => {
    const grave = def("gravestoneNormal");
    expect(grave.flatTile).toBeUndefined();
    expect(makeField().flatTileOffset(grave, 4, 4, false)).toEqual({ dx: 0, dy: 0 });
  });
});
