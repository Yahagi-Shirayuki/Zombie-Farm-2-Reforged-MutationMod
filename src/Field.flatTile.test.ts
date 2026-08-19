import { describe, expect, it } from "vitest";
// The app has no @types/node (it only ever runs in a browser); the node test
// environment provides these at runtime. Same treatment as objectSpriteSize.test.ts.
// @ts-ignore
import { readFileSync } from "node:fs";
// @ts-ignore
import { inflateSync } from "node:zlib";
import placeables from "../public/assets/placeables.json";
import { turnArt, turnFlip, type PlaceableDef } from "./assets";
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
  flatTileOffset(d: PlaceableDef, oc: number, or: number, flipped: boolean, turn?: number):
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

  it("keeps every pond piece that still takes the derived anchor interchangeable", () => {
    // The seven pond pieces are one set: six rims and a fill, laid edge to edge into
    // a single body of water, with the SE and NW rims supplied by turning the SW and
    // NE ones. That only works if a piece occupies identical pixels either way round,
    // and if the pieces agree with each other — one sitting 3px off is a step in the
    // rim.
    //
    // The source pivots do NOT agree (pond5 0.36, pond2/pond7 0.35, the rest 0.34, and
    // pond7 alone 0.02 vertically), and turning doubles a disagreement, which is why
    // Pond 5 came back 6px out. centered_flat_tile_fields replaces them with the anchor
    // the geometry fixes — which is also the mirror's own fixed point.
    //
    // Pieces being tuned BY HAND are outside this: an ANCHOR_OVERRIDES entry is
    // somebody measuring a piece against its neighbours, and it outranks the
    // derivation. The next test is what that costs.
    const centred = ["pond1", "pond4", "pond7"].map(def)
      .filter((d) => d.anchorX === 0.34 && d.anchorY === 0.02);
    expect(centred.length).toBeGreaterThan(1); // else the set has been retuned wholesale
    const first = drawn(centred[0], 3, 2);
    for (const d of centred) {
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

  it("shows what a hand-measured pond anchor costs when the piece is turned", () => {
    // A measured anchor lays a better UNTURNED pond and a worse turned one, and the
    // trade is invisible until someone rotates a rim. This does not judge the numbers
    // — they are being tuned — it pins the RELATION, so the cost stays on the record
    // whatever they land on: turning reflects the anchor about the front tile's centre
    // line (`1 - anchorX - 48/w`), which leaves exactly one anchor per piece where a
    // turned copy lands on an unturned one. Off it by anything, the piece comes back
    // twice that far away.
    const scale = TILE_W / 48;
    for (const key of ["pond1", "pond2", "pond3", "pond4", "pond5", "pond6", "pond7"]) {
      const d = def(key);
      const fixed = (1 - 48 / d.nativeW) / 2; // 0.34 for a 150px pond piece
      const drift = drawn(d, 3, 2, true).left - drawn(d, 3, 2).left;
      expect({ key, drift: +drift.toFixed(6) })
        .toEqual({ key, drift: +(2 * (d.anchorX! - fixed) * d.nativeW * scale).toFixed(6) });
    }
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

// ---- Road bends: four corners, four pieces of art ---------------------------
// Turning a placed object is a horizontal MIRROR, and in iso a mirror swaps the two
// grid axes — so it maps a bend's arms onto each other and every corner onto ITSELF.
// One bend art therefore cannot make four corners however it is turned, which is what
// "the roads don't line up" was: the same corner redrawn from a mirrored pivot, a few
// pixels out of line, with the other three corners unreachable. The source authored
// them as separate tiles (roadBend_01/_03/_04) and the def carries them as `turns`;
// see ROAD_TURNS in tools/prep_placeables.py.
const BENDS = ["roadBend_01", "cobblestoneRoadBend_01"];

/** Where a given turn's art lands, the same way `drawn` measures the def's own. */
const drawnTurn = (d: PlaceableDef, oc: number, or: number, turn: number) => {
  const art = turnArt(d, turn);
  const field = makeField();
  const a = field.footprintAnchor(oc, or, d.tileW, d.tileH);
  const off = field.flatTileOffset(d, oc, or, turnFlip(d, turn), turn);
  const w = art.nativeW! * (TILE_W / 48);
  return { left: a.x + off.dx - w / 2, right: a.x + off.dx + w / 2, bottom: a.y + off.dy };
};

describe("road bends turn into all four corners", () => {
  it("gives each family four turns drawing four different pieces", () => {
    for (const key of BENDS) {
      const d = def(key);
      expect(d.turns?.length).toBe(4);
      // Turn 0 restates the def's own art, so anything reading `turns[turn]` and
      // anything reading the def agree about an unturned piece.
      expect(d.turns![0].sprite).toBe(d.sprite);
      expect([d.turns![0].anchorX, d.turns![0].anchorY]).toEqual([d.anchorX, d.anchorY]);
      // Three arts and a mirror of one of them: four corners, no repeats. A repeat is
      // the bug — it means a turn hands back a corner the player already had.
      const corners = d.turns!.map((t) => `${t.sprite}${t.flip ? ":mirrored" : ""}`);
      expect(new Set(corners).size).toBe(4);
    }
  });

  it("hangs every turn off its own authored pivot", () => {
    // Same rule as the straights: the anchor lands on the bottom-left corner of the
    // front tile's 48x24 box. Each corner is a different size and pivot, so this is
    // what keeps them all on one ground point instead of drifting apart.
    const scale = TILE_W / 48;
    for (const key of BENDS) {
      const d = def(key);
      d.turns!.forEach((t, turn) => {
        if (t.flip) return; // mirrored turns are pinned by the reflection test below
        const front = gridToScreen(2 + d.tileW - 1 + (t.dc ?? 0), 3 + d.tileH - 1 + (t.dr ?? 0));
        const r = drawnTurn(d, 2, 3, turn);
        expect(r.left).toBeCloseTo(front.x - HW - t.anchorX * t.nativeW * scale, 4);
        expect(r.bottom).toBeCloseTo(front.y + TILE_H + t.anchorY * t.nativeH * scale, 4);
      });
    }
  });

  it("hangs the apex-south corner one whole tile north of its footprint", () => {
    // MEASURED, not derived: that piece's art meets the straights it continues only
    // from the ground tile one row north (24px right, 10px up — exactly (HW, -HH)),
    // and no reading of its authored pivot accounts for it (the stone one's pivotx is
    // a bare 0.5). Only the ART moves: the 2x2 block the player placed still blocks.
    for (const key of BENDS) {
      const d = def(key);
      expect([d.turns![1].dc, d.turns![1].dr]).toEqual([undefined, -1]);
      const hung = drawnTurn(d, 2, 3, 1);
      const flat = { ...d, turns: d.turns!.map((t, i) => (i === 1 ? { ...t, dr: 0 } : t)) };
      const plain = drawnTurn(flat as PlaceableDef, 2, 3, 1);
      expect(hung.left - plain.left).toBeCloseTo(HW, 4);
      expect(hung.bottom - plain.bottom).toBeCloseTo(-TILE_H / 2, 4);
    }
  });

  it("mirrors the fourth corner about its own ground tile", () => {
    // The corner the source never drew (its bends have `rotations: 3`). It is the
    // third one mirrored, which is exact here because the reflection is the binary's
    // own `1 - pivotx - 48/w` about the front tile's centre line — the same rule the
    // stone bend is turned by — rather than an assumption that the art is symmetric.
    for (const key of BENDS) {
      const d = def(key);
      expect(d.turns![3].sprite).toBe(d.turns![2].sprite);
      expect(d.turns![3].flip).toBe(true);
      const base = drawnTurn(d, 1, 1, 2);
      const flip = drawnTurn(d, 1, 1, 3);
      const centre = gridToScreen(1 + d.tileW - 1, 1 + d.tileH - 1).x;
      expect(flip.left).toBeCloseTo(2 * centre - base.right, 4);
      expect(flip.bottom).toBeCloseTo(base.bottom, 4);
    }
  });

  it("ships every corner's art with straight alpha", () => {
    // Same reason as the flat-tile art above (a doubled premultiply seams wherever
    // pieces overlap) — and these four PNGs are emitted by a different code path.
    for (const key of BENDS) {
      for (const t of def(key).turns!) {
        const data = decodeRgbaPng(readFileSync(`public/assets/objects/${t.sprite}`));
        let semi = 0, overAlpha = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a === 0 || a === 255) continue;
          semi++;
          if (Math.max(data[i], data[i + 1], data[i + 2]) > a) overAlpha++;
        }
        expect({ sprite: t.sprite, semi: semi > 50, overAlpha: overAlpha > 0 })
          .toEqual({ sprite: t.sprite, semi: true, overAlpha: true });
      }
    }
  });
});
