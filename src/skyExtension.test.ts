// The sky band has to be the SAME blue as the backdrop it sits on.
//
// main.ts extends each backdrop upward with a flat quad tinted `theme.sky`, which is what
// lets a portrait phone zoom out past the height of the art (see SKY_EXTENSION). The band
// is invisible only while that colour matches the backdrop's own top row — one shade off
// and there is a hard line across the sky at exactly the zoom level players reach for.
//
// Nothing else checks this. Re-exporting a backdrop, or adding a theme by copying an
// existing one and swapping the image, would leave the colour stale with no other symptom
// than a seam nobody looks for. So read it out of the PNG.
import { describe, expect, it } from "vitest";
// Node built-ins: the app has no @types/node, so these follow the same convention as
// hud.css's readFileSync in ui/invasionLayering.test.ts.
// @ts-ignore
import { readFileSync } from "node:fs";
// @ts-ignore
import { inflateSync } from "node:zlib";
import { ALL_THEMES } from "./surroundings";

/** The first pixel of a PNG's top row, as 0xRRGGBB.
 *
 *  Deliberately hand-rolled rather than pulling in a decoder: these are 8-bit
 *  non-interlaced RGB/RGBA files straight out of the asset pipeline, so the format is
 *  fixed and the whole read is the IHDR fields plus one inflated scanline. */
function topLeftPixel(path: string): number {
  const png = new Uint8Array(readFileSync(path) as ArrayLike<number>);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...png.subarray(at, at + length));

  let offset = 8; // PNG signature
  let bitDepth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = ascii(offset + 4, 4);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      bitDepth = body[8];
      colorType = body[9];
      expect(body[12], `${path} is interlaced`).toBe(0);
    }
    if (type === "IDAT") idat.push(body);
    if (type === "IEND") break;
    offset += length + 12; // length + type + data + CRC
  }
  expect(bitDepth, `${path} is not 8-bit`).toBe(8);
  expect([2, 6], `${path} is not RGB/RGBA`).toContain(colorType);

  const packed = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  let cursor = 0;
  for (const part of idat) { packed.set(part, cursor); cursor += part.length; }
  const raw = new Uint8Array(inflateSync(packed) as ArrayLike<number>);

  // Row 0 begins with its filter byte. Filters 0 (None) and 1 (Sub) both leave the FIRST
  // pixel of a row as its literal value, and 2 (Up) has no row above to add, so for
  // pixel 0 of row 0 those three are all identity. Anything else would need real
  // filtering, so refuse rather than report a wrong colour.
  expect([0, 1, 2], `${path} row 0 uses an unexpected filter`).toContain(raw[0]);
  return (raw[1] << 16) | (raw[2] << 8) | raw[3];
}

describe("every surroundings theme continues its own backdrop's sky", () => {
  for (const theme of ALL_THEMES) {
    it(`${theme.key} matches ${theme.background}`, () => {
      expect(theme.sky).toBe(topLeftPixel(`public/assets/${theme.background}`));
    });
  }
});
