// Menu copies of a tinted farm object.
//
// Several placeables are byte-identical copies of one pale sprite, told apart
// purely by the `color` their def carries — the five monoliths are all the same
// stone. The farm applies it as a Pixi sprite tint (a per-channel multiply), but a
// DOM <img> of the same file has no tint, so menus showed the base art while the
// object on the ground was blue/yellow/green/brown. This reproduces the multiply
// on a canvas so the two match.

/** Is this tint a no-op? White multiplies to the source pixel unchanged, so an
 *  untinted object needs no canvas work at all. */
export function isNeutralTint(tint: number | undefined): boolean {
  return tint === undefined || tint === 0xffffff;
}

const cache = new Map<string, Promise<string>>();

/** Cache key for one src/tint pair. Exported for the test. */
export function tintCacheKey(src: string, tint: number): string {
  return `${src}|${tint}`;
}

async function decode(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode === "function") {
    await image.decode();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("sprite could not be decoded"));
  });
}

/** Multiply each colour channel in place, leaving alpha alone — what the GPU does
 *  to a tinted sprite. Exported so the maths can be checked without a canvas.
 *
 *  A canvas `multiply` composite is NOT equivalent: it blends against the
 *  backdrop's alpha, so anti-aliased edge pixels come out near the flood colour
 *  instead of near transparent, giving the sprite a bright fringe. */
export function multiplyPixels(pixels: Uint8ClampedArray, tint: number): void {
  const r = (tint >> 16) & 0xff, g = (tint >> 8) & 0xff, b = tint & 0xff;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue; // fully transparent: nothing to colour
    pixels[i] = Math.round((pixels[i] * r) / 255);
    pixels[i + 1] = Math.round((pixels[i + 1] * g) / 255);
    pixels[i + 2] = Math.round((pixels[i + 2] * b) / 255);
  }
}

async function render(src: string, tint: number): Promise<string> {
  const image = new Image();
  image.src = src;
  await decode(image);
  const width = Math.max(1, image.naturalWidth || image.width);
  const height = Math.max(1, image.naturalHeight || image.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("tint canvas unavailable");
  context.drawImage(image, 0, 0);
  const frame = context.getImageData(0, 0, width, height);
  multiplyPixels(frame.data, tint);
  context.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/png");
}

/** `src` multiplied by `tint`, as a data URL — the same colour the farm draws.
 *  Resolves to `src` untouched for a neutral tint or outside a browser. */
export function tintedImage(src: string, tint: number | undefined): Promise<string> {
  if (!src || isNeutralTint(tint) || typeof document === "undefined") {
    return Promise.resolve(src);
  }
  const key = tintCacheKey(src, tint!);
  const existing = cache.get(key);
  if (existing) return existing;
  // A failed tint must not be cached: the caller keeps the untinted art and a
  // later open gets a fresh attempt.
  const pending = render(src, tint!).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

/** Show `src` in `img` at the colour the farm draws it. The base art goes up
 *  immediately so nothing waits on the canvas, then the tinted copy replaces it
 *  (usually the same frame, since the sprite is already cached).
 *
 *  Unlike the action sheet, this does not skip a detached `img`. Assigning `src`
 *  off-document costs nothing, and a caller that appends its cards asynchronously
 *  would otherwise lose the tint with no sign that it had. */
export function setTintedSrc(
  img: HTMLImageElement, src: string, tint: number | undefined
): void {
  img.src = src;
  if (!src || isNeutralTint(tint)) return;
  void tintedImage(src, tint)
    .then((tinted) => { img.src = tinted; })
    .catch(() => { /* keep the untinted art */ });
}
