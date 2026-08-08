#!/usr/bin/env python3
"""Derive a per-climate hills-and-sky backdrop from the base grass artwork.

The farm's backdrop (public/assets/farm_background.png) is one flat-shaded
2800x560 image: blue sky, white clouds, rolling green hills, dark green hill
trees.  A ground skin repaints every terrain tile, so leaving lush green hills
behind a beach (or the moon) reads as a bug.  Rather than hand-painting six
horizons, this recolours the base art per climate.

The art is flat-shaded, so a pixel's ROLE is recoverable from its colour:

  * greenish (G is the dominant channel)   -> hills.  Bright greens (L >= ~130)
    are the hill body; darker greens are the little trees dotted on them and
    the shading under the hill edges.  Each greenish pixel is remapped through
    a per-climate luminance ramp, which keeps the original shading structure
    (and every anti-aliased edge) intact while changing what the hills are
    made of.
  * blueish/white (sky + clouds)           -> only remapped for climates that
    need a different sky (the moon).

Run:  python tools/prep_backgrounds.py
Writes public/assets/farm_background_<terrain>.png for every non-grass climate
(grass keeps using the untouched farm_background.png).
"""
from __future__ import annotations

import pathlib
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - tooling guard
    sys.exit("Pillow is required: pip install pillow")

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "assets" / "farm_background.png"
OUT_DIR = ROOT / "public" / "assets"

# A ramp is a list of (luminance, rgb) stops, sampled by a source pixel's
# luminance and linearly interpolated between neighbouring stops. Stops below
# ~130 describe the hill TREES and edge shading; stops above describe the hill
# body itself. Keeping both in one continuous ramp means the anti-aliased pixels
# between a tree and the grass behind it blend through the same gradient.
GREEN_RAMPS: dict[str, list[tuple[int, tuple[int, int, int]]]] = {
    # Sandy Ground: tropical island. The hills become pale dune sand while the
    # dotted trees stay green — distant palms above a beach.
    "dirt": [
        (0, (12, 58, 38)),
        (49, (18, 72, 44)),
        (96, (36, 132, 58)),
        (106, (44, 148, 52)),
        (126, (150, 176, 108)),
        (140, (214, 190, 132)),
        (150, (231, 205, 146)),
        (158, (240, 216, 160)),
        (185, (250, 234, 190)),
        (255, (255, 245, 214)),
    ],
    # Snowy Ground: snow-capped hills with frosted evergreens.
    "snow": [
        (0, (28, 48, 66)),
        (49, (36, 60, 80)),
        (96, (62, 96, 112)),
        (106, (74, 110, 126)),
        (126, (170, 194, 210)),
        (140, (216, 231, 243)),
        (150, (232, 242, 250)),
        (158, (240, 248, 255)),
        (185, (248, 252, 255)),
        (255, (255, 255, 255)),
    ],
    # Urban Ground: grey concrete rises, soot-dark street trees.
    "stone": [
        (0, (34, 38, 42)),
        (49, (44, 48, 54)),
        (96, (62, 74, 66)),
        (106, (72, 86, 74)),
        (126, (118, 122, 126)),
        (140, (146, 150, 154)),
        (150, (160, 164, 168)),
        (158, (172, 176, 180)),
        (185, (196, 200, 204)),
        (255, (222, 226, 230)),
    ],
    # Dead Ground: parched olive scrubland, bare brown trees.
    "sand": [
        (0, (34, 26, 14)),
        (49, (46, 36, 18)),
        (96, (86, 68, 32)),
        (106, (100, 80, 38)),
        (126, (150, 128, 62)),
        (140, (176, 152, 74)),
        (150, (190, 166, 84)),
        (158, (202, 178, 94)),
        (185, (220, 198, 116)),
        (255, (236, 218, 146)),
    ],
    # Lunar Ground: bare grey regolith ridges, no vegetation left.
    "water": [
        (0, (30, 32, 40)),
        (49, (38, 40, 50)),
        (96, (60, 63, 76)),
        (106, (70, 74, 88)),
        (126, (110, 114, 130)),
        (140, (134, 138, 154)),
        (150, (146, 150, 166)),
        (158, (156, 160, 176)),
        (185, (178, 182, 198)),
        (255, (204, 208, 222)),
    ],
}

# Optional sky treatment. Without an entry the original blue sky and white
# clouds are kept verbatim. `sky` recolours the flat blue; `cloud` recolours the
# near-white cloud bodies, both by the same luminance-ramp interpolation.
SKY_RAMPS: dict[str, list[tuple[int, tuple[int, int, int]]]] = {
    # Airless moon: deep space above the regolith, with the clouds dimmed to
    # faint dust so they read as haze rather than water vapour.
    "water": [
        (0, (6, 6, 18)),
        (140, (14, 14, 34)),
        (200, (26, 26, 52)),
        (230, (52, 52, 84)),
        (255, (86, 86, 120)),
    ],
    # Beach sky: a deeper, more saturated tropical blue than the temperate
    # original, with the clouds left bright and slightly warm.
    "dirt": [
        (0, (56, 138, 200)),
        (194, (116, 198, 242)),
        (235, (226, 246, 252)),
        (255, (255, 254, 248)),
    ],
}


def luminance(r: int, g: int, b: int) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def sample(ramp: list[tuple[int, tuple[int, int, int]]], lum: float) -> tuple[int, int, int]:
    """Linearly interpolate `ramp` at `lum` (clamped to the end stops)."""
    if lum <= ramp[0][0]:
        return ramp[0][1]
    for (l0, c0), (l1, c1) in zip(ramp, ramp[1:]):
        if lum <= l1:
            t = (lum - l0) / (l1 - l0) if l1 > l0 else 0.0
            return tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))  # type: ignore[return-value]
    return ramp[-1][1]


def is_green(r: int, g: int, b: int) -> bool:
    """A hill/tree pixel: green dominates both other channels by a clear margin."""
    return g > r + 10 and g > b + 10


def is_sky(r: int, g: int, b: int) -> bool:
    """Sky or cloud: blue-leaning or near-neutral bright. Excludes the greens."""
    return not is_green(r, g, b) and b >= r and b > 60


def build(terrain: str, src: Image.Image) -> Image.Image:
    green = GREEN_RAMPS[terrain]
    sky = SKY_RAMPS.get(terrain)
    out = src.copy()
    px = out.load()
    cache: dict[tuple[int, int, int, int], tuple[int, int, int, int]] = {}
    w, h = out.size
    for y in range(h):
        for x in range(w):
            key = px[x, y]
            hit = cache.get(key)
            if hit is None:
                r, g, b, a = key
                if a == 0:
                    hit = key
                elif is_green(r, g, b):
                    hit = (*sample(green, luminance(r, g, b)), a)
                elif sky and is_sky(r, g, b):
                    hit = (*sample(sky, luminance(r, g, b)), a)
                else:
                    hit = key
                cache[key] = hit
            px[x, y] = hit
    return out


def main() -> None:
    if not SRC.exists():
        sys.exit(f"missing base backdrop: {SRC}")
    src = Image.open(SRC).convert("RGBA")
    for terrain in GREEN_RAMPS:
        out = build(terrain, src)
        dest = OUT_DIR / f"farm_background_{terrain}.png"
        out.save(dest)
        print(f"wrote {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
