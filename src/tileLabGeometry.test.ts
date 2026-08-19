import { describe, expect, it } from "vitest";
import placeables from "../public/assets/placeables.json";
// The tile lab's copy of the anchor rule. Plain JS with no imports so
// tools/build_tile_lab.py can inline it into a double-clickable page.
// @ts-ignore — a tools file, deliberately outside the app's module graph.
import * as lab from "../tools/tileAnchorGeometry.js";
import { turnArt, turnFlip, type PlaceableDef } from "./assets";
import { Field } from "./Field";
import { TILE_W } from "./iso";

// tools/tile_lab.html exists to MEASURE anchors: you drag a road piece until its kerb
// meets its neighbour's and read the number off. That is only worth anything if the
// tool draws a piece exactly where the farm draws it — a tool that is 3px out teaches
// you a 3px-wrong anchor, and the mistake ships looking measured. So the rule has one
// copy outside the game (tools/tileAnchorGeometry.js) and this drives it against
// Field's own, for every flat tile and every road-bend corner.
const defs = placeables as unknown as PlaceableDef[];

interface Placement {
  flatTileOffset(d: PlaceableDef, oc: number, or: number, flipped: boolean, turn?: number):
    { dx: number; dy: number };
}
const field = (): Placement => {
  const f: Field = Object.create(Field.prototype);
  Object.assign(f, { assets: { field: { tileW: 48 } } });
  return f as unknown as Placement;
};

describe("the tile lab draws what the farm draws", () => {
  it("agrees with Field.flatTileOffset on every flat tile, turned or not", () => {
    const game = field();
    const flat = defs.filter((d) => d.flatTile);
    expect(flat.length).toBeGreaterThan(10);
    let checked = 0;
    for (const d of flat) {
      const turns = d.turns?.length ?? 1;
      for (let turn = 0; turn < turns; turn++) {
        const art = turnArt(d, turn);
        // Both orientations for every piece: the mirror is its own rule
        // (`1 - pivotx - 48/w`) and the tool has to reproduce that too.
        for (const flipped of d.turns ? [turnFlip(d, turn)] : [false, true]) {
          for (const [oc, or] of [[0, 0], [3, 5], [12, 12]]) {
            const mine = lab.flatTileOffset(art, d.tileW, d.tileH, oc, or, flipped);
            const theirs = game.flatTileOffset(d, oc, or, flipped, turn);
            expect({ key: d.key, turn, flipped, oc, or, dx: +mine.dx.toFixed(9), dy: +mine.dy.toFixed(9) })
              .toEqual({ key: d.key, turn, flipped, oc, or, dx: +theirs.dx.toFixed(9), dy: +theirs.dy.toFixed(9) });
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("scales art off the same tile sizes the farm uses", () => {
    // The lab hard-codes the lattice (it has no access to src/iso.ts), so pin the two
    // numbers it copied. A farm that re-tiles and a lab that does not would put every
    // measurement out by the ratio.
    expect(lab.TILE_W).toBe(TILE_W);
    expect(lab.SOURCE_TILE_W).toBe(48);
    expect(lab.SCALE).toBeCloseTo(TILE_W / 48, 12);
  });

  it("leaves art with no authored anchor bottom-centred", () => {
    const grave = defs.find((d) => d.key === "gravestoneNormal")!;
    expect(grave.flatTile).toBeUndefined();
    expect(lab.flatTileOffset(grave, grave.tileW, grave.tileH, 4, 4, false)).toEqual({ dx: 0, dy: 0 });
  });
});
