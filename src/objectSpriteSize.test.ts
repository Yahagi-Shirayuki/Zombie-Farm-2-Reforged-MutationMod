// `nativeW`/`nativeH` are how big the game thinks an object's art is, and every
// placement reads them: Field.fitObjectSprite scales by them, flatTileOffset and the
// Memorial mount measure in them. They are written by tools/prep_placeables.py from the
// PNG it just emitted, so they are only ever right if the two were produced together —
// a hand-edited catalog row, or a re-run that changed a sprite without the row landing
// in the same commit, puts every object that reads them a few pixels out.
//
// Nothing checked that until the Solar System shipped as a bare pedestal.
import { describe, expect, it } from "vitest";
// The app has no @types/node (it only ever runs in a browser); the node test
// environment provides this at runtime. Same treatment as skyExtension.test.ts.
// @ts-ignore
import { readFileSync } from "node:fs";
import placeables from "../public/assets/placeables.json";

const OBJECTS = new URL("../public/assets/objects/", import.meta.url);

/** A PNG's dimensions, straight out of the IHDR chunk (bytes 16..24). */
function pngSize(file: string): { w: number; h: number } {
  const bytes = readFileSync(new URL(file, OBJECTS));
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

const rows = placeables as { key: string; sprite: string; nativeW: number; nativeH: number }[];

describe("object catalog art", () => {
  it("records every object's real sprite dimensions", () => {
    const wrong: string[] = [];
    for (const row of rows) {
      const { w, h } = pngSize(row.sprite);
      if (w !== row.nativeW || h !== row.nativeH) {
        wrong.push(`${row.key}: catalog says ${row.nativeW}x${row.nativeH}, ${row.sprite} is ${w}x${h}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("draws the Solar System's planets, not just its pedestal", () => {
    // Its `frameName` is the little grey plinth; the sun and all three planets live in
    // the 12 animation frames orbiting above it, so the plain frame extract shipped a
    // pedestal on its own. The plinth is 61x36 — anything near that is the old bug
    // back again (see ANIMATION_OVER_BASE in tools/prep_placeables.py).
    const solar = rows.find((row) => row.key === "spaceSolarSystem")!;
    expect(solar.nativeW).toBeGreaterThan(200);
    expect(solar.nativeH).toBeGreaterThan(100);
  });
});
