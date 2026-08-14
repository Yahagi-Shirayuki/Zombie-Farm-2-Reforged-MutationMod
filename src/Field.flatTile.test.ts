import { describe, expect, it } from "vitest";
// The app has no @types/node (it only ever runs in a browser); the node test
// environment provides these at runtime. Same treatment as objectSpriteSize.test.ts.
// @ts-ignore
import { readFileSync } from "node:fs";
// @ts-ignore
import { inflateSync } from "node:zlib";
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

// Minimal 8-bit-RGBA PNG reader — enough to look at the pixels the generator wrote.
// The project ships no image library, and the alternative to reading them (trusting
// the art is straight-alpha) is exactly the assumption the seam bug broke.
// `png` is a node Buffer; see the @ts-ignore imports above for why it is untyped.
const decodeRgbaPng = (png: {
  length: number;
  readUInt32BE(offset: number): number;
  toString(encoding: string, start: number, end: number): string;
  subarray(start: number, end: number): Uint8Array & { readUInt32BE(o: number): number };
}): Uint8Array => {
  const chunks: Uint8Array[] = [];
  let width = 0, height = 0;
  for (let p = 8; p + 8 <= png.length;) {
    const len = png.readUInt32BE(p);
    const type = png.toString("ascii", p + 4, p + 8);
    const body = png.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      // bit depth 8, colour type 6 (RGBA), no interlace — what PIL writes for RGBA.
      expect([body[8], body[9], body[12]]).toEqual([8, 6, 0]);
    } else if (type === "IDAT") chunks.push(body);
    p += len + 12;
  }
  const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { joined.set(c, at); at += c.length; }
  const raw = inflateSync(joined) as Uint8Array;
  // Undo the per-scanline filter (PNG spec 9.2) in place, into a flat RGBA buffer.
  const out = new Uint8Array(width * height * 4);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (line[x] + add) & 0xff;
    }
  }
  return out;
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

  it("lands every pond piece on the same footprint, turned or not", () => {
    // The seven pond pieces are one set: six rims and a fill, laid edge to edge into
    // a single body of water, with the SE and NW rims supplied by turning the SW and
    // NE ones. That only works if a piece occupies identical pixels either way round,
    // and if all seven agree — a piece that sits 3px off is a step in the rim.
    //
    // The source pivots do NOT agree (pond5 0.36, pond2/pond7 0.35, the rest 0.34,
    // and pond7 alone 0.02 vertically). Turning a 0.02 disagreement doubles it, which
    // is why Pond 5 in particular came back 6px out. The generator replaces them with
    // the anchor the geometry fixes; see prep_placeables.centered_flat_tile_fields.
    const ponds = ["pond1", "pond2", "pond3", "pond4", "pond5", "pond6", "pond7"];
    const first = drawn(def("pond1"), 3, 2);
    for (const key of ponds) {
      const d = def(key);
      expect([d.tileW, d.tileH, d.nativeW, d.nativeH]).toEqual([3, 3, 150, 75]);
      const base = drawn(d, 3, 2);
      const flip = drawn(d, 3, 2, true);
      expect(flip.left).toBeCloseTo(base.left, 4);
      expect(flip.right).toBeCloseTo(base.right, 4);
      expect(flip.bottom).toBeCloseTo(base.bottom, 4);
      expect(base.left).toBeCloseTo(first.left, 4);
      expect(base.bottom).toBeCloseTo(first.bottom, 4);
    }
    // ...and that shared position centres the art on the 3x3 footprint, so the 150x75
    // canvas overhangs the 141x70.5 diamond evenly and neighbours overlap rather than
    // leaving a gap for the grass to show through.
    const scale = TILE_W / 48;
    const anchor = makeField().footprintAnchor(3, 2, 3, 3);
    expect(first.left + first.right).toBeCloseTo(2 * anchor.x, 4);
    expect(first.bottom).toBeCloseTo(anchor.y + 1.5 * scale, 4);
  });

  it("ships flat-tile art with straight alpha, so overlapping pieces do not seam", () => {
    // The source atlases store colour premultiplied by alpha. PixiJS premultiplies
    // image textures again on upload, so an antialiased edge composites rgb*a^2
    // instead of rgb*a — a dark fringe, and on art whose pieces OVERLAP (pond, road)
    // that fringe lands on the neighbour's opaque fill and draws a grid of seams.
    // The generator divides the bake back out (prep_placeables.unpremultiply); a
    // premultiplied pixel is one whose colour can never exceed its own alpha.
    const flat = defs.filter((d) => d.flatTile);
    expect(flat.length).toBeGreaterThan(10);
    for (const d of flat) {
      const data = decodeRgbaPng(readFileSync(`public/assets/objects/${d.sprite}`));
      let semi = 0, overAlpha = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0 || a === 255) continue;
        semi++;
        if (Math.max(data[i], data[i + 1], data[i + 2]) > a) overAlpha++;
      }
      // Straight-alpha art has plenty of edge pixels brighter than their coverage;
      // premultiplied art has none at all, by construction.
      expect({ key: d.key, semi: semi > 50, overAlpha: overAlpha > 0 })
        .toEqual({ key: d.key, semi: true, overAlpha: true });
    }
  });

  it("leaves objects that stand up off the ground bottom-centered", () => {
    const grave = def("gravestoneNormal");
    expect(grave.flatTile).toBeUndefined();
    expect(makeField().flatTileOffset(grave, 4, 4, false)).toEqual({ dx: 0, dy: 0 });
  });
});
