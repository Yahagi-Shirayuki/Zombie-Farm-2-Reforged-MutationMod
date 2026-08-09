#!/usr/bin/env python3
"""Build the Memorial Statue placeable (art + catalog row).

The Memorial Statue is a REIMPLEMENTATION ADDITION, not a ZF2 item: nothing in
Market.json or TileProperties.json describes it, so both its art and its catalog
row are authored here rather than joined from source data.

Art: ZF2 ships exactly one "figure standing on a plinth" object — the anniversary
Tim Statue (`birthdayTimStatue`, 104x218). Its lower two thirds are a two-tier iso
plinth with a Z plaque, which is precisely the pedestal a memorial wants. So the
statue's base is cut out of that sprite:

  * everything below the plinth's top face is copied verbatim (walls + base slab);
  * the top face is REDRAWN as a clean iso diamond, because in the source it is
    partly hidden behind Tim's boots — cropping alone leaves boot soles sitting on
    the pedestal a player's own zombie is supposed to stand on;
  * the result is desaturated to grey stone, so the plinth matches the stone-tinted
    zombie the game renders on top of it (see src/zombie/statueRig.ts).

`mountX`/`mountY` are where that zombie's feet go — the centre of the rebuilt top
face, in fractions of the emitted sprite. The renderer needs them because the
plinth is bottom-centred on its footprint like every other object, so the mount
point cannot be derived from the footprint alone.

Imported by prep_placeables.py (which owns public/assets/objects and would delete
any PNG the catalog does not reference). Run directly to rebuild just this item:

    python zombiefarm/tools/memorial_statue.py
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "public", "assets")
OBJDIR = os.path.join(OUT, "objects")

KEY = "memorialStatue"
SPRITE = f"{KEY}.png"
SOURCE = "birthdayTimStatue.png"

# Geometry of the Tim Statue's upper plinth block, in SOURCE pixel coordinates.
# The top face is an iso diamond: its left/right corners sit on row TOP_FACE_Y at
# x = CX +/- HALF_W, and a 2:1 iso diamond is half as tall as it is wide.
CX = 49.5
TOP_FACE_Y = 142.0
HALF_W = 34.5
HALF_H = HALF_W / 2.0
# Below this row the source art is all plinth (walls + base slab) and is kept as-is.
KEEP_BELOW = 160

# Top-face shading, sampled from the base slab's own top face in the source: the
# light comes from the right, so the face ramps dark-left to light-right.
FACE_DARK = (15, 37, 24)
FACE_LIGHT = (87, 118, 107)
FACE_EDGE = (8, 20, 13)


def _stone(rgb):
    """Green granite -> grey stone. Luminance is boosted because the source art is
    dark enough that a plain desaturation reads as soot rather than stone."""
    r, g, b = rgb
    lum = min(255.0, (0.30 * r + 0.59 * g + 0.11 * b) * 1.55 + 26)
    return (int(lum * 0.99), int(lum), int(lum * 0.97))


def build(objdir=OBJDIR):
    """Emit <objdir>/memorialStatue.png; return its catalog row."""
    src_path = os.path.join(objdir, SOURCE)
    src_img = Image.open(src_path).convert("RGBA")
    w, h = src_img.size
    src = src_img.load()

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    o = out.load()
    for y in range(h):
        for x in range(w):
            if y > KEEP_BELOW:
                o[x, y] = src[x, y]
                continue
            # Manhattan distance in diamond space: <= 1 is inside the top face.
            t = abs(x - CX) / HALF_W + abs(y - TOP_FACE_Y) / HALF_H
            if t <= 1.0:
                if t > 0.94:
                    colour = FACE_EDGE
                else:
                    f = min(1.0, max(0.0, (x - (CX - HALF_W)) / (2 * HALF_W))) ** 1.3
                    colour = [FACE_DARK[i] + (FACE_LIGHT[i] - FACE_DARK[i]) * f for i in range(3)]
                speckle = ((x * 7 + y * 11) % 7) - 3
                o[x, y] = tuple(max(0, min(255, int(c) + speckle)) for c in colour) + (255,)
            elif y >= TOP_FACE_Y:
                # Outside the diamond but level with it: the block's side walls.
                o[x, y] = src[x, y]

    box = out.getbbox()
    plinth = out.crop(box)
    px = plinth.load()
    for y in range(plinth.height):
        for x in range(plinth.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = _stone((r, g, b)) + (a,)
    plinth.save(os.path.join(objdir, SPRITE))

    # Mount point: centre of the rebuilt top face, rebased onto the cropped sprite.
    mount_x = (CX - box[0]) / plinth.width
    mount_y = (plinth.height - (TOP_FACE_Y - box[1])) / plinth.height
    return {
        "key": KEY,
        "name": "Memorial Statue",
        "category": "functional",
        "cost": 3000,
        "level": 1,
        "xp": 30,
        "brainsNeeded": False,
        "tileW": 2,
        "tileH": 2,
        "movable": True,
        "rotations": 1,
        "sprite": SPRITE,
        "nativeW": plinth.width,
        "nativeH": plinth.height,
        "pivotX": 0.0,
        "pivotY": 0.0,
        "armyMax": 0,
        "storageSlots": 0,
        "zombieSlots": 0,
        "growMs": 0,
        "harvestValue": 0,
        "growingSprite": "",
        "mountX": round(mount_x, 4),
        "mountY": round(mount_y, 4),
    }


def main():
    row = build()
    path = os.path.join(OUT, "placeables.json")
    with open(path, encoding="utf-8") as f:
        catalog = json.load(f)
    catalog = [c for c in catalog if c["key"] != KEY]
    catalog.append(row)
    catalog.sort(key=lambda c: (c["category"], c["level"], c["cost"]))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=1)
    print(f"memorial statue: {SPRITE} {row['nativeW']}x{row['nativeH']} "
          f"mount=({row['mountX']}, {row['mountY']}) -> placeables.json")


if __name__ == "__main__":
    main()
