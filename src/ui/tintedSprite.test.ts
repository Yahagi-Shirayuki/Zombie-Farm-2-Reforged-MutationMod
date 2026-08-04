import { describe, expect, it } from "vitest";
import placeables from "../../public/assets/placeables.json";
import { objectTint, type PlaceableDef } from "../assets";
import { isNeutralTint, multiplyPixels, tintCacheKey, tintedImage } from "./tintedSprite";

const catalog = placeables as PlaceableDef[];
const rgba = (...values: number[]) => new Uint8ClampedArray(values);

describe("multiplyPixels", () => {
  it("multiplies each channel like a GPU sprite tint", () => {
    const pixels = rgba(255, 128, 64, 255);
    multiplyPixels(pixels, 0x8000ff); // r 128/255, g 0, b 255/255
    expect([...pixels]).toEqual([128, 0, 64, 255]);
  });

  it("leaves alpha untouched, including on anti-aliased edges", () => {
    const pixels = rgba(200, 200, 200, 32, 200, 200, 200, 255);
    multiplyPixels(pixels, 0x9999ff);
    expect(pixels[3]).toBe(32);
    expect(pixels[7]).toBe(255);
    // Both pixels take the same colour: coverage is alpha's job, not the tint's.
    expect([...pixels.slice(0, 3)]).toEqual([...pixels.slice(4, 7)]);
  });

  it("does not paint the transparent margin", () => {
    const pixels = rgba(0, 0, 0, 0);
    multiplyPixels(pixels, 0xff0000);
    expect([...pixels]).toEqual([0, 0, 0, 0]);
  });

  it("is the identity for white", () => {
    const pixels = rgba(17, 90, 231, 200);
    multiplyPixels(pixels, 0xffffff);
    expect([...pixels]).toEqual([17, 90, 231, 200]);
  });
});

describe("tintedImage", () => {
  it("treats white and a missing tint as no-ops", () => {
    expect(isNeutralTint(0xffffff)).toBe(true);
    expect(isNeutralTint(undefined)).toBe(true);
    expect(isNeutralTint(0x99ccff)).toBe(false);
  });

  it("hands back the source untouched when there is nothing to tint", async () => {
    const src = "assets/objects/daisy.png";
    await expect(tintedImage(src, undefined)).resolves.toBe(src);
    await expect(tintedImage(src, 0xffffff)).resolves.toBe(src);
    await expect(tintedImage("", 0x99ccff)).resolves.toBe("");
  });

  it("keys its cache on both the sprite and the tint", () => {
    // The monoliths are one sprite under five names, so a src-only key would
    // serve the first colour asked for to every one of them.
    expect(tintCacheKey("m.png", 0x9999ff)).not.toBe(tintCacheKey("m.png", 0xffff64));
    expect(tintCacheKey("a.png", 0x9999ff)).not.toBe(tintCacheKey("b.png", 0x9999ff));
  });
});

describe("the monoliths this exists for", () => {
  // The FUNCTIONAL monoliths — the five farm-effect stones that share tex1009.png.
  // Match on category, not the key prefix: the decorative Egg Monolith and Broken
  // Monolith are ordinary decor with art of their own and no tint to tell apart.
  const monoliths = catalog.filter(
    (entry) => /^monolith/.test(entry.key) && entry.category === "functional"
  );

  it("are one sprite distinguished only by colour", () => {
    expect(monoliths.length).toBeGreaterThan(1);
    // Literally ONE file shared by every key — the def's colour is the only thing
    // telling a Plowing Monolith from a Speed Monolith on screen. They used to ship
    // as five byte-identical PNGs, which hid that.
    expect(new Set(monoliths.map((entry) => entry.sprite)).size).toBe(1);
    const coloured = monoliths.filter((entry) => !isNeutralTint(objectTint(entry.color)));
    expect(coloured.map((entry) => entry.key).sort()).toEqual([
      "monolithCombine", "monolithMutation", "monolithPlowing", "monolithSpeed",
    ]);
  });

  it("each map to a distinct tint", () => {
    const tints = monoliths.map((entry) => objectTint(entry.color));
    expect(new Set(tints).size).toBe(tints.length);
  });
});
