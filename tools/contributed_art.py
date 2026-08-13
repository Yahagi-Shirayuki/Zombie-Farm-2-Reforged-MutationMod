#!/usr/bin/env python3
"""Build placeables whose art was DRAWN FOR THIS PROJECT rather than extracted.

Every other object in public/assets/objects/ is cut out of the original game's
atlases by prep_placeables.py, which joins Market.json/TileProperties.json rows to
that art. Contributed art has neither: no source row prices it, no atlas holds it.
So both halves are authored here — the PNG comes from tools/art/, the catalog row
from CONTRIBUTED below — and prep_placeables imports this module so the emitted
sprites count as referenced and survive its orphan sweep.

The `credit` field is the point of the exercise: art someone drew for the project
carries their name into the Market, on the card's magnifier parchment. It is the
only placeable field that is about the ARTIST rather than the object, and it is
what separates these rows from extracted ones — see PROVENANCE.md, which can no
longer claim that everything under public/assets/ came out of the commercial game.

Sources are trimmed to their alpha bounding box on the way out. The authored PNGs
are padded canvases (the sakura pair are both 204x356 with the art sitting low and
left of centre), and every placement rule downstream measures from the sprite's own
edges: Field.fitObjectSprite bottom-centres nativeW x nativeH on the footprint, so
shipping the padding would hang each tree off its own tiles by the width of the
empty margin. Trimming is also what makes nativeW/nativeH honest — see
src/objectSpriteSize.test.ts.

They are then resampled to an authored `height`. A PLACED object always draws at
nativeH x objectScale — there is no per-def render scale — so the shipped PNG's
height IS the object's size in the world, and it is the only place that size can be
set. Scaling here rather than in tools/art/ keeps the artist's original file intact
at full resolution: the target is a number in this table, and re-running with a
different one re-derives from the untouched source instead of resampling an
already-resampled sprite.

Run directly to rebuild just these items:

    python zombiefarm/tools/contributed_art.py
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ART = os.path.join(HERE, "art")
OUT = os.path.join(PROJ, "public", "assets")
OBJDIR = os.path.join(OUT, "objects")

# Both sakura ship at the SAME height, which is the whole point of the number: a
# tree the player buys and one the Sakura ground skin scatters outside the fence are
# the same species, and until this matched they did not look it — the authored art
# is 276px tall, so a bought cherry stood two and a half times over the ones in the
# grove behind it.
#
# This ONE number sets the size of both, everywhere, because a placed object always
# draws at nativeH x objectScale (~0.979) and src/surroundings.ts scatters them at
# scale 1. 195 puts them mid-pack in the Market's ornamental trees, which run 166
# (Palm) to 225 (Evergreen) — level with the Amiable Tree at 195 and the Beech at
# 187. The first pass at 130 made them the two smallest trees in the game, shorter
# than the 300-gold starter tree.
SAKURA_HEIGHT = 195

# Gold decor pays floor(cost / 100) purchase XP — the binary's
# +[MarketDataManager xpFromItem:] rule, which prep_placeables applies to every
# extracted gold row (see market_economics). Contributed rows follow it too, so the
# server's objectCatalogSync test sees one consistent pricing rule.
CONTRIBUTED = [
    {
        # The showpiece: a tall trunk forking into a full pink canopy. Priced and
        # gated between the Cotton Candy Tree (1500 g, lvl 7) and the Beech (4500 g,
        # lvl 15) — the band where the Market's ornamental trees stop being roadside
        # filler and start being something you place on purpose.
        "source": "sakura_tree.png",
        "key": "sakuraTree",
        "name": "Sakura Tree",
        "cost": 3000,
        "level": 12,
        "height": SAKURA_HEIGHT,
        "credit": "Art by LennyFaze",
    },
    {
        # The same species grown out sideways: a low, leaning trunk under a canopy
        # that sprawls to one side. At a matched height it is much the WIDER of the
        # two, which is what tells them apart now that neither is the taller.
        "source": "sakura_tree_weeping.png",
        "key": "sakuraTreeWeeping",
        "name": "Weeping Sakura",
        "cost": 4500,
        "level": 18,
        "height": SAKURA_HEIGHT,
        "credit": "Art by LennyFaze",
    },
    {
        # The third cut: a slender forked trunk under a broad flat canopy, several
        # shades PALER than the other two and carrying one open flower. That pallor
        # is what earns it a place beside them — three trees in one pink would read
        # as one tree three times, and this is the one that catches the light.
        "source": "sakura_tree_blossom.png",
        "key": "sakuraTreeFlowering",
        "name": "Flowering Sakura",
        "cost": 6000,
        "level": 24,
        "height": SAKURA_HEIGHT,
        "credit": "Art by LennyFaze",
    },
]

# Both sakura are 2x2, whose diamond is 96 px across. Footprint does not scale the
# art (objectScale is footprint-independent) — it decides what the tree OCCUPIES and
# how the depth sort orders it against its neighbours, so a 1x1's 48 px would leave
# both hanging well over tiles they do not own and sorting against them wrongly.
#
# At SAKURA_HEIGHT the canopies are 129 px (upright) and 198 px (weeping) wide, so
# even 2x2 does not fully cover the weeping one — which is fine, and deliberate. A
# canopy is meant to overhang: the game's own Willow is 200 px wide on a 1x1, and
# what a footprint has to enclose is the part of a tree you would walk into. 2x2
# also matches the fruit trees, which is the size class these are now in.
TILE_W = 2
TILE_H = 2


def build(objdir=OBJDIR, artdir=ART):
    """Emit each contributed sprite into `objdir`; return their catalog rows."""
    rows = []
    for item in CONTRIBUTED:
        img = Image.open(os.path.join(artdir, item["source"])).convert("RGBA")
        box = img.getbbox()
        if box is None:
            raise ValueError(f"{item['source']} is fully transparent")
        art = img.crop(box)
        target = item.get("height")
        if target and art.height != target:
            # LANCZOS, not NEAREST: the art is smoothly shaded rather than pixel art,
            # and the ratios here (0.47 / 0.72) are nowhere near an integer step.
            art = art.resize(
                (max(1, round(art.width * target / art.height)), target), Image.LANCZOS)
        sprite = f"{item['key']}.png"
        art.save(os.path.join(objdir, sprite))
        rows.append({
            "key": item["key"],
            "name": item["name"],
            "category": "decor",
            "cost": item["cost"],
            "level": item["level"],
            "xp": item["cost"] // 100,
            "brainsNeeded": False,
            "tileW": TILE_W,
            "tileH": TILE_H,
            "movable": True,
            "rotations": 1,
            "sprite": sprite,
            "nativeW": art.width,
            "nativeH": art.height,
            # Only flatTile rows (roads, ponds) are anchored by their pivot; a tree
            # stands up off the ground and is bottom-centred like all decor, so this
            # is the plain bottom-centre default rather than a measured value.
            "pivotX": 0.5,
            "pivotY": 0.0,
            "armyMax": 0,
            "storageSlots": 0,
            "zombieSlots": 0,
            "growMs": 0,
            "harvestValue": 0,
            "growingSprite": "",
            "credit": item["credit"],
        })
    return rows


def main():
    rows = build()
    path = os.path.join(OUT, "placeables.json")
    with open(path, encoding="utf-8") as f:
        catalog = json.load(f)
    keys = {r["key"] for r in rows}
    catalog = [c for c in catalog if c["key"] not in keys]
    catalog.extend(rows)
    catalog.sort(key=lambda c: (c["category"], c["level"], c["cost"]))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=1)
    for r in rows:
        print(f"contributed: {r['sprite']} {r['nativeW']}x{r['nativeH']} "
              f"{r['cost']}g lvl {r['level']} ({r['credit']})")
    print(f"  -> placeables.json ({len(catalog)} objects)")


if __name__ == "__main__":
    main()
