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

# A second base, hand-drawn for this project: the same horizon with the five hill
# trees taken off it. Those trees are drawn as broadleaves in full leaf on BROWN
# trunks, and a trunk is not green — `is_green` cannot see it, so no ramp can
# recolour one. Every skin derived from the original therefore inherits five summer
# trees, which is fine on a temperate or autumn horizon and wrong on a moon, a
# desert, a paved lot, a valley in blossom or a snowfield.
#
# It is a build INPUT, not an asset: nothing loads it at runtime, so it lives in
# tools/art/ with the rest of the hand-drawn source rather than shipping to players.
# `_export.png` beside it is the untouched drawing it was cut from — 2172x724 inside
# a white margin — kept so the fit below can be redone if it is ever wrong.
NO_TREE_SRC = ROOT / "tools" / "art" / "farm_background_no_trees.png"
# Terrains built from it. The rest keep the original — a wood belongs on the
# temperate and autumn horizons, and the beach's distant palms are the point.
NO_TREE_TERRAINS = {"water", "sand", "stone", "sakura", "snow"}
# Both bases must be this exact frame — see load_base.
BASE_SIZE = (2800, 560)

# A pixel squarely inside the hill body, away from every outline and hill tree.
# Sampled to report each backdrop's `filler` colour (see main).
MID_HILL_PX = (700, 530)

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
    # Autumn Ground: orange-tan hills under trees that have turned deep russet.
    # Unlike the other skins this one keeps a clear light/dark split between the
    # hill body and its dotted trees — autumn is a foliage colour, so the trees
    # have to stay legible rather than melting into the ground.
    "autumn": [
        (0, (48, 20, 10)),
        (49, (62, 28, 13)),
        (96, (134, 58, 24)),
        (106, (156, 72, 28)),
        (126, (198, 132, 66)),
        (140, (214, 158, 92)),
        (150, (222, 170, 104)),
        (158, (230, 181, 116)),
        (185, (240, 202, 148)),
        (255, (250, 226, 186)),
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
    # Sakura Ground: hills under blossom all the way to the horizon. Unlike autumn
    # this one deliberately does NOT keep a light/dark split between the hill body
    # and its dotted trees — both are the same flowering pink, a few shades apart,
    # because a stand of cherry seen at that distance IS the hillside's colour. It
    # also avoids the mud: the ramp only ever interpolates within one hue family, so
    # the anti-aliased pixels around every tree keep blending cleanly, which a
    # pink-trees-on-green-hills ramp would turn to grey through the crossover.
    # Every stop is the same ramp taken down about 5%, uniformly — scaling the light
    # end alone would have flattened the hills' own outlines against their bodies.
    # The farm's ground was darkened separately, and this closes most of the gap that
    # opened up between the two without collapsing it: distant hills reading a shade
    # lighter than the ground in front of them is what haze actually does.
    "sakura": [
        (0, (82, 29, 51)),
        (49, (106, 38, 65)),
        (96, (167, 67, 106)),
        (106, (188, 84, 124)),
        (126, (226, 160, 188)),
        (140, (233, 181, 203)),
        (150, (236, 190, 209)),
        (158, (238, 198, 215)),
        (185, (239, 211, 224)),
        (255, (242, 226, 234)),
    ],
    # Lunar Ground: bare regolith ridges, no vegetation left. Pitched to sit just
    # above the Lunar TERRAIN TILE (~(81,84,91) after prep_assets' regrade_lunar)
    # rather than to look good alone — the hills and the farm are the same dust,
    # and a pale horizon behind dark ground turns the farm into a cut-out square.
    # Keep these two in step if either is retuned.
    "water": [
        (0, (19, 20, 23)),
        (49, (25, 26, 30)),
        (96, (40, 42, 47)),
        (106, (47, 49, 55)),
        (126, (76, 79, 85)),
        (140, (87, 90, 97)),
        (150, (92, 95, 102)),
        (158, (98, 101, 108)),
        (185, (117, 120, 128)),
        (255, (146, 149, 158)),
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
    # Sakura: warm peach rather than afternoon blue, drawn off the autumn DUSK
    # painting's own sky — its (253,218,188) high and (246,169,142) near the horizon.
    # Pitched between the two rather than at the deeper end: the hills below are
    # already a strong pink, and a full sunset over them leaves nothing in the frame
    # that is not hot.
    #
    # It comes out FLAT, and that is inherent rather than a shortcut. The ramp maps
    # luminance to colour, and the base art's open sky is one uniform value — so the
    # gradient the dusk piece has could only be got by painting one, which is exactly
    # why that piece is shipped whole instead of derived (see SurroundingsTheme.dusk).
    # The stops below the sky's own 191 are its cloud shading, and the ones above are
    # the cloud bodies.
    "sakura": [
        (0, (146, 74, 52)),
        (150, (214, 132, 100)),
        (185, (238, 172, 134)),
        (192, (247, 196, 160)),
        (220, (250, 212, 182)),
        (246, (253, 228, 204)),
        (255, (255, 242, 224)),
    ],
}

# Starfields, by terrain. Only a sky dark enough to show them gets one.
#
# The count is a flat number of attempts across the whole 2800px backdrop, NOT
# anything derived from the scenery-ring density in surroundings.ts — the two are
# unrelated systems and a sparse moon should still have a full sky.
STARS: dict[str, dict[str, int]] = {
    "water": {"count": 130, "seed": 0x5EED_11A2},
}
# Star brightnesses, as (weight, colour). Mostly faint pinpricks with a few
# bright ones, so the field has depth instead of reading as evenly-spaced dots.
STAR_TONES = [
    (6, (128, 132, 158)),
    (5, (176, 180, 205)),
    (3, (214, 218, 238)),
    (2, (245, 247, 255)),
]
# A star this bright also gets four 1px arms, which is the only way to suggest a
# brighter star at this resolution without it becoming a visible blob.
STAR_CROSS_MIN = 214

# Grain laid over a backdrop's LAND, by terrain: a deterministic brightness jitter of
# +/- this many levels, sky and clouds untouched.
#
# The base art is flat-shaded, which is fine when the farm's terrain is flat too. The
# Sakura skin's ground is not — it has stones and grit bedded into it — and a textured
# field in front of plastic-smooth hills reads as two different materials rather than
# one landscape. This is the hills' half of matching them; the ground's half is the
# softened PEBBLE_* in prep_assets.py. Keep it small: at any real strength it stops
# being a surface and starts being noise.
TERRAIN_GRAIN: dict[str, int] = {"sakura": 7}
# How far a pixel may sit from the modal sky colour and still count as open sky
# when placing stars. See `clear` in add_stars.
SKY_MATCH_TOLERANCE = 4


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


# The lowest cloud pixel in the base art is row 238 and the highest distant-hill
# pixel is row 335, so this row divides them outright. It has to: the two cannot be
# told apart by colour. Cloud EDGES antialias through exactly the hazed blue-greens
# the far hills are painted in, and the two distributions genuinely overlap —
# measured on the source, cloud edges reach g-r=46 while hill pixels start at g-r=26,
# so no threshold separates them. The backdrop is one fixed authored 2800x560 layout,
# which is what makes a row a safe discriminator where a colour is not.
FAR_HILL_MIN_Y = 280


def is_far_hill(r: int, g: int, b: int) -> bool:
    """The pale distant hills behind the treeline, by colour alone.

    These are terrain, but hazed so far toward the sky that blue catches green and
    `is_green` lets them past — their lit crest (145,210,212) has MORE blue than
    green. Every backdrop was shipping those crests unrecoloured as a result: a
    teal-green fringe along the far hills of the beach, the moon, and the rest.

    Blue overtaking RED is what makes one; open sky is excluded because it runs blue
    well clear of green (150,208,236) rather than level with it, and the lightness
    ceiling drops cloud BODIES (236,251,248). Cloud edges need FAR_HILL_MIN_Y.
    """
    return g > r + 10 and b > r and b - g < 18 and r < 190


def is_terrain(r: int, g: int, b: int, y: int) -> bool:
    """Any land pixel: near hills and trees, or the pale far hills behind them."""
    return is_green(r, g, b) or (y >= FAR_HILL_MIN_Y and is_far_hill(r, g, b))


def is_sky(r: int, g: int, b: int, y: int) -> bool:
    """Sky or cloud: blue-leaning or near-neutral bright. Excludes all terrain."""
    return not is_terrain(r, g, b, y) and b >= r and b > 60


def flat_sky_colour(img: Image.Image) -> tuple[int, int, int, int]:
    """The single most common colour in the top third — the open sky between the
    clouds. Used as the mask for star placement, so stars land in clear sky and
    never on a cloud, a hill, or the horizon haze."""
    top = img.crop((0, 0, img.width, img.height // 3))
    return max(top.getcolors(top.width * top.height), key=lambda kv: kv[0])[1]


def add_stars(img: Image.Image, count: int, seed: int) -> int:
    """Sprinkle a deterministic starfield into the open sky. Returns how many
    landed — attempts that fall on a cloud or below the horizon are dropped
    rather than nudged, which keeps the field naturally uneven."""
    px = img.load()
    sky = flat_sky_colour(img)
    tones: list[tuple[int, int, int]] = []
    for weight, colour in STAR_TONES:
        tones.extend([colour] * weight)
    # A plain LCG, not `random`: the backdrop is a checked-in build artefact, so
    # the same source art must always produce the same sky.
    state = seed & 0x7FFFFFFF

    def rnd(n: int) -> int:
        nonlocal state
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        return state % n

    def clear(x: int, y: int) -> bool:
        """Open sky, within a hair. An exact match would do for the original art,
        which is flat-shaded — but a hand-drawn base can carry a faint dither, and
        the no-tree one does: 43 shades of the same blue across a single row, all
        within +/-2. Demanding equality there rejects most of the sky and thins the
        starfield to a fraction of its count for no reason anyone could see."""
        if not (0 <= x < img.width and 0 <= y < img.height):
            return False
        return all(abs(a - b) <= SKY_MATCH_TOLERANCE for a, b in zip(px[x, y][:3], sky[:3]))

    placed = 0
    for _ in range(count):
        x, y = rnd(img.width), rnd(img.height)
        if not clear(x, y):
            continue
        colour = tones[rnd(len(tones))]
        px[x, y] = colour + (sky[3],)
        if colour[0] >= STAR_CROSS_MIN:
            # Dim arms, and only onto pixels that were open sky, so a bright star
            # near a cloud edge cannot spill onto the cloud.
            arm = tuple(round(c * 0.45 + s * 0.55) for c, s in zip(colour, sky[:3]))
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if clear(x + dx, y + dy):
                    px[x + dx, y + dy] = arm + (sky[3],)
        placed += 1
    return placed


def build(terrain: str, src: Image.Image) -> tuple[Image.Image, int]:
    """The recoloured backdrop, plus how many stars landed in its sky."""
    green = GREEN_RAMPS[terrain]
    sky = SKY_RAMPS.get(terrain)
    out = src.copy()
    px = out.load()
    # Keyed by colour AND which side of FAR_HILL_MIN_Y the pixel is on, because that
    # row is part of the classification: the same hazed blue-green is a cloud edge
    # above it and a distant hillside below it.
    # Each entry is (recoloured pixel, was it land) — the second half is what the
    # grain pass below keys off, so sky and cloud stay perfectly smooth.
    cache: dict[tuple[tuple[int, int, int, int], bool],
                tuple[tuple[int, int, int, int], bool]] = {}
    grain = TERRAIN_GRAIN.get(terrain, 0)
    w, h = out.size
    for y in range(h):
        low = y >= FAR_HILL_MIN_Y
        for x in range(w):
            key = (px[x, y], low)
            hit = cache.get(key)
            if hit is None:
                r, g, b, a = px[x, y]
                land = a != 0 and is_terrain(r, g, b, y)
                if a == 0:
                    hit = (px[x, y], False)
                elif land:
                    hit = ((*sample(green, luminance(r, g, b)), a), True)
                elif sky and is_sky(r, g, b, y):
                    hit = ((*sample(sky, luminance(r, g, b)), a), False)
                else:
                    hit = (px[x, y], False)
                cache[key] = hit
            if grain and hit[1]:
                # One offset applied to all three channels, so it reads as brightness
                # variation in the surface and never as colour speckle.
                n = (x * 73856093) ^ (y * 19349663)
                n = (n ^ (n >> 13)) & 0x7FFFFFFF
                d = (n % (2 * grain + 1)) - grain
                r, g, b, a = hit[0]
                px[x, y] = (max(0, min(255, r + d)), max(0, min(255, g + d)),
                            max(0, min(255, b + d)), a)
            else:
                px[x, y] = hit[0]
    # Stars go on last, so the recolour cannot smear them back into sky.
    field = STARS.get(terrain)
    stars = add_stars(out, field["count"], field["seed"]) if field else 0
    return out, stars


def load_base(path: pathlib.Path, label: str) -> Image.Image:
    """One base backdrop, checked against the layout every skin is built to.

    Both bases must be the same 2800x560 frame or the derived skins do not line up:
    the renderer scales EVERY backdrop by a factor computed from the grass one's
    width (BG_BASE_HALF in main.ts), so a base of another size lands at the wrong
    size on screen and leaves the camera bounds pointing at nothing.
    """
    if not path.exists():
        sys.exit(f"missing base backdrop: {path}")
    img = Image.open(path).convert("RGBA")
    if img.size != BASE_SIZE:
        sys.exit(f"{label} is {img.width}x{img.height}, expected "
                 f"{BASE_SIZE[0]}x{BASE_SIZE[1]}: {path}")
    return img


def main() -> None:
    src = load_base(SRC, "base backdrop")
    no_trees = load_base(NO_TREE_SRC, "no-tree backdrop")
    print("terrain  file                              filler (-> surroundings.ts)  stars")
    for terrain in GREEN_RAMPS:
        base = no_trees if terrain in NO_TREE_TERRAINS else src
        out, stars = build(terrain, base)
        dest = OUT_DIR / f"farm_background_{terrain}.png"
        out.save(dest)
        # The viewport filler beyond the backdrop MUST be the backdrop's own
        # mid-hill colour or the two stop reading as one surface (see the `filler`
        # field in src/surroundings.ts). Print it rather than leave whoever retunes
        # a ramp to eyedropper the PNG and hope they picked the right pixel.
        r, g, b = out.convert("RGB").getpixel(MID_HILL_PX)
        print(f"{terrain:<8} {dest.name:<33} 0x{r:02x}{g:02x}{b:02x}"
              f"{'' if not stars else f'                   {stars}'}")


if __name__ == "__main__":
    main()
