// Where a flat tile's art lands — the ONE copy of that rule outside the game.
//
// tools/tile_lab.html measures anchors by drawing pieces exactly as the farm draws
// them, which is only worth anything if the two agree. So the rule lives here, the
// build script inlines this file into the tool, and src/tileLabGeometry.test.ts
// drives it against Field's own private flatTileOffset for every shipped flat tile
// and every road-bend corner. Change Field's rule and that test fails, rather than
// the tool quietly measuring against a game that has moved on.
//
// GROUND TRUTH `-[Tile anchorPoint]` + `-[Tile loadBaseSprite]`: a tile pins its art
// by the authored (pivotx, pivoty) cocos anchor — y-up, default (0.38, 0) — onto the
// position of the GROUND TILE it sits on, which cocos' iso tile map puts at the
// bottom-left corner of that tile's 48x24 box. For a multi-tile object that is the
// FRONT (south) tile. See src/Field.ts flatTileOffset and the memory note
// flat-tile-anchor-ground-truth.

/** The farm's own lattice (src/iso.ts). The source authored on 48x24; the farm draws
 *  ~10% smaller, so every piece of art is scaled by TILE_W / SOURCE_TILE_W. */
export const TILE_W = 47;
export const TILE_H = 23.5;
export const HW = TILE_W / 2;
export const HH = TILE_H / 2;
/** The tile the ART was authored against (public/assets/field_default.json). */
export const SOURCE_TILE_W = 48;
export const SCALE = TILE_W / SOURCE_TILE_W;

/** Grid (col,row) -> world pixel of that tile's TOP point. */
export function gridToScreen(col, row) {
  return { x: (col - row) * HW, y: (col + row) * HH };
}

/** A turned object's footprint is its def rectangle TRANSPOSED: in iso a horizontal
 *  mirror reflects col<->row (src/Field.ts objectFootprint). */
export function objectFootprint(tileW, tileH, flipped) {
  return flipped ? { w: tileH, h: tileW } : { w: tileW, h: tileH };
}

/** Bottom-centre of a footprint — where every object that is NOT a flat tile stands,
 *  and the point flatTileOffset returns a delta from. */
export function footprintAnchor(oc, or, w, h) {
  return {
    x: ((oc + (w - 1) / 2) - (or + (h - 1) / 2)) * HW,
    y: gridToScreen(oc + w - 1, or + h - 1).y + TILE_H,
  };
}

/** Offset from the bottom-centred position to the authored-pivot one.
 *
 *  `art` is a def or one of its `turns` entries: { nativeW, nativeH, anchorX, anchorY,
 *  dc?, dr? }. Returns {dx:0, dy:0} for art with no authored anchor, which is what
 *  keeps every standing object bottom-centred. */
export function flatTileOffset(art, tileW, tileH, oc, or, flipped) {
  if (!art || art.anchorX === undefined || art.anchorY === undefined) return { dx: 0, dy: 0 };
  const w = art.nativeW * SCALE, h = art.nativeH * SCALE;
  const fp = objectFootprint(tileW, tileH, flipped);
  // A turn state may hang its art off a NEIGHBOURING ground tile (the apex-south road
  // bend does, by a measured whole tile). The footprint is untouched.
  const front = gridToScreen(oc + fp.w - 1 + (art.dc || 0), or + fp.h - 1 + (art.dr || 0));
  const p = { x: front.x - HW, y: front.y + TILE_H }; // the ground tile's own position
  const a = footprintAnchor(oc, or, fp.w, fp.h);
  // A mirrored tile reflects about the centre line of that same ground tile, one
  // source tile to the right of `p` — the binary's `1 - pivotx - 48/width`.
  const anchorX = flipped ? 1 - art.anchorX - SOURCE_TILE_W / art.nativeW : art.anchorX;
  return {
    dx: (p.x - a.x) + w * (0.5 - anchorX),
    dy: (p.y - a.y) + h * art.anchorY,
  };
}

/** The rectangle a piece's art actually covers, in world pixels — what the tool draws
 *  and what a seam is measured against. `art` as above; the sprite is anchored (0.5, 1)
 *  on the footprint anchor plus the offset, and mirrored in place when flipped. */
export function artRect(art, tileW, tileH, oc, or, flipped) {
  const fp = objectFootprint(tileW, tileH, flipped);
  const a = footprintAnchor(oc, or, fp.w, fp.h);
  const off = flatTileOffset(art, tileW, tileH, oc, or, flipped);
  const w = art.nativeW * SCALE, h = art.nativeH * SCALE;
  const cx = a.x + off.dx, by = a.y + off.dy;
  return { left: cx - w / 2, top: by - h, w, h, cx, by };
}
