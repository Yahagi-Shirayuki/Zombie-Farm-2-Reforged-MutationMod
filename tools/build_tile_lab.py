#!/usr/bin/env python3
"""Inline the current flat-tile art + anchors into a standalone tools/tile_lab.html.

The tile lab lays pieces on the farm's own isometric lattice and lets you drag one
until its kerb meets its neighbour's, then prints the anchor you just measured in the
shape prep_placeables.ANCHOR_OVERRIDES takes. It has to work by double-clicking (no
server), so the art rides in as data URIs and the anchor rule is inlined from
tools/tileAnchorGeometry.js — the same file src/tileLabGeometry.test.ts drives against
Field's own, so the tool cannot quietly drift from the game it is measuring for.

By default it bundles the 15 `flatTile` placeables (both road sets, the seven pond
pieces, rocks, the zombie patch) and every road-bend corner — the art that has to meet
edge to edge, which is the only art whose anchor is worth measuring. `--all` adds the
rest of the catalog (~7 MB) for checking how a standing object sits against a road.

Usage:  python tools/build_tile_lab.py [--all]
"""
import base64
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
OBJDIR = ASSETS / "objects"
TEMPLATE = ROOT / "tools" / "tile_lab.template.html"
GEOMETRY = ROOT / "tools" / "tileAnchorGeometry.js"
OUT = ROOT / "tools" / "tile_lab.html"


def data_uri(name: str) -> str:
    return "data:image/png;base64," + base64.b64encode((OBJDIR / name).read_bytes()).decode("ascii")


def variants(defn: dict) -> list:
    """The orientations of one placeable that draw DIFFERENT art.

    A road bend's four corners are four pieces (see ROAD_TURNS); everything else has
    one. Each carries the tile key its anchor is authored under, which is what an
    ANCHOR_OVERRIDES entry is keyed by — for shipped art that is always the sprite's
    own filename, since prep_placeables emits one PNG per tile.
    """
    turns = defn.get("turns")
    if not turns:
        return [{
            "tile": defn["sprite"].removesuffix(".png"),
            "sprite": defn["sprite"], "nativeW": defn["nativeW"], "nativeH": defn["nativeH"],
            "anchorX": defn.get("anchorX"), "anchorY": defn.get("anchorY"), "turn": 0,
        }]
    return [{
        "tile": t["sprite"].removesuffix(".png"),
        "sprite": t["sprite"], "nativeW": t["nativeW"], "nativeH": t["nativeH"],
        "anchorX": t.get("anchorX"), "anchorY": t.get("anchorY"),
        "flip": bool(t.get("flip")), "dc": t.get("dc", 0), "dr": t.get("dr", 0), "turn": i,
    } for i, t in enumerate(turns)]


def main() -> None:
    every = "--all" in sys.argv[1:]
    catalog = json.loads((ASSETS / "placeables.json").read_text(encoding="utf-8"))
    # One row per catalog KEY: recolor variants share a key's art and would only
    # duplicate the palette.
    seen, pieces, sprites = set(), [], {}
    for defn in catalog:
        if defn["key"] in seen:
            continue
        if not defn.get("flatTile") and not every:
            continue
        seen.add(defn["key"])
        vs = variants(defn)
        for v in vs:
            if v["sprite"] not in sprites and (OBJDIR / v["sprite"]).exists():
                sprites[v["sprite"]] = data_uri(v["sprite"])
        pieces.append({
            "key": defn["key"], "name": defn["name"], "category": defn.get("category", "decor"),
            "tileW": defn["tileW"], "tileH": defn["tileH"],
            "flat": bool(defn.get("flatTile")), "noMirror": bool(defn.get("noMirror")),
            "variants": [v for v in vs if v["sprite"] in sprites],
        })
    pieces = [p for p in pieces if p["variants"]]

    # Strip the ES exports: the tool is one <script> in a file:// page, not a module.
    geometry = re.sub(r"^export ", "", GEOMETRY.read_text(encoding="utf-8"), flags=re.M)
    boot = {"pieces": pieces, "sprites": sprites, "all": every}
    html = TEMPLATE.read_text(encoding="utf-8")
    html = html.replace("/* __GEOMETRY__ */", geometry)
    html = html.replace("__BOOT_JSON__", json.dumps(boot, separators=(",", ":")))
    OUT.write_text(html, encoding="utf-8")

    flat = sum(1 for p in pieces if p["flat"])
    corners = sum(len(p["variants"]) for p in pieces)
    print(f"Wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"  {len(pieces)} placeables ({flat} flat), {corners} orientations, {len(sprites)} sprites")
    if not every:
        print("  (--all also bundles the standing objects — bigger file)")


if __name__ == "__main__":
    main()
