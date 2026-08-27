#!/usr/bin/env python3
"""Pack the tile lab into a zip you can hand to somebody who does not have the repo.

The lab is already self-contained — tools/build_tile_lab.py inlines the art and the
anchor rule, so tile_lab.html on its own is the whole tool. What the zip adds is the
context a helper needs to send something back that is usable: what a right answer looks
like, the loose art in case they want to look at it properly, the anchors as they ship
today, and the note that the art is not ours.

Rebuilds the lab first, so the zip can never hold a stale copy.

Usage:  python tools/pack_tile_lab.py        ->  tmp/tile-lab.zip
"""
import json
import pathlib
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
OBJDIR = ASSETS / "objects"
TOOLS = ROOT / "tools"
OUT = ROOT / "tmp" / "tile-lab.zip"

README = """ZOMBIE FARM 2 REFORGED — TILE LAB
=================================

Thanks for helping. This is a bench for the flat ground art — the roads, the stone
paths, the ponds, the rocks, the zombie patch. The job is to get the pieces to LINE UP
with each other, and what decides that is a single number per piece called its anchor.


WHAT TO OPEN
------------
Double-click  tile_lab.html.  That is the whole tool — it runs offline in your browser,
installs nothing, and phones nowhere. Chrome, Edge and Firefox are all fine.


WHY THE PIECES DON'T ALWAYS MEET
--------------------------------
A flat piece of art is not simply centred on the tiles it covers. Each one is pinned to
the ground by a point the original artists chose — the anchor — and those numbers were
typed by hand and rounded to two decimals. Most are right. Some are not, and a piece
whose anchor is a few pixels out is a road with a step in its kerb.

We can't ask the original artists, so the wrong ones have to be MEASURED: lay the piece
next to the piece it is supposed to continue, slide it until the edges line up, and
write down where it landed.


HOW TO USE IT
-------------
  1. Pick a piece on the left, click a tile to put it down.
  2. Put down the piece it has to meet — or select one and use "Surround with
     straights" / "Tile out 3x3" on the right, which lay the neighbours for you.
  3. Zoom in (mouse wheel).
  4. Hold ALT and drag a piece to slide its ART. The tiles it occupies do not move —
     only the art does, which is exactly what the anchor controls.
     Arrow keys nudge one pixel at a time. Hold Shift for ten.
  5. Stop when the kerbs, rims or edges run through each other with no step and no gap.

Useful switches along the top:
  Tint     washes every piece a different colour, so you can see exactly where one
           ends and the next begins — the fastest way to spot an overlap or a gap.
  Pins     shows the point each piece is pinned by, and the tile corner it hangs from.
  Ghost    draws the ORIGINAL position faintly underneath once you have moved something,
           so you can see how far you have taken it.
  Footprint  outlines the tiles a piece actually occupies in the game.

Other keys:  F mirrors a piece · Del removes it · Ctrl+Z undoes · Shift+drag pans.
The 💾 button remembers your bench in the browser, so you can close the tab and come
back to it. (Some browsers refuse to store anything for a page opened straight off the
disk. If yours does, the tool says so rather than pretending — save your anchors with
"⬇ Save" instead.)


WHAT TO SEND BACK
-----------------
Press "⬇ Save" (bottom right). You get a small anchors.json holding only the pieces you
moved. Send that back — it can be loaded straight onto someone else's bench with the
"⬆ Load" button, so two people's measurements can be compared side by side.

If a file is awkward, "Copy Python" puts the same thing on your clipboard as text you
can paste into a chat.

Please also say, in a sentence, WHAT YOU LINED IT UP AGAINST — "the stone bend against a
straight run on both arms" is worth more than the number on its own, because the next
person can check it.


THINGS WORTH KNOWING BEFORE YOU START
-------------------------------------
* The asphalt bends are drawn slightly WIDER than the asphalt straights — about three
  pixels. That small ledge where a bend meets a straight is in the original art and is
  not something an anchor can fix. Don't chase it. The stone set is the cleaner one to
  measure against; its edges meet to about a pixel.
* A road bend is four separate pieces of art, one per corner, listed separately in the
  palette. They do not share an anchor.
* The pond pieces are deliberately drawn a few pixels larger than their tiles so they
  overlap rather than leaving a gap. Overlap there is correct; a visible seam is not.
* One piece — the road bend whose corner points south — is deliberately hung a whole
  tile away from the tiles it occupies. That is measured and intended. If you select it
  and turn on Pins you can see it.
* An anchor belongs to the ART, not to a copy of it. Move one and every copy of that
  same piece on the bench moves too. That is the point: it is how you check a piece
  against two different neighbours at once.


WHAT'S IN THE ZIP
-----------------
  tile_lab.html          the tool. Everything is inside it.
  art/                   the same pieces as loose PNGs, if you want to look closer.
  anchors-shipped.json   the anchors as the game ships them today, for reference.
  tileAnchorGeometry.js  the rule the tool draws by — the same one the game uses.
  NOTICE.txt             where the art comes from. Please read it.
"""

NOTICE = """WHERE THIS ART COMES FROM
=========================

Zombie Farm 2 and its assets are the property of The Playforge, Inc. The art in this
zip was extracted from the shipped iOS app bundle of the 2011 game (bundle id
com.playforge.ZF2R), by way of a community re-release ("The ZF Archive", 2022).

Zombie Farm 2 Reforged is a non-commercial fan reimplementation for study and
preservation. No ownership of the original IP is claimed, and none is transferred by
handing you this zip. It is here so you can measure against the real art; please don't
redistribute it further or use it for anything commercial.

The tool itself (tile_lab.html, tileAnchorGeometry.js) is part of Zombie Farm 2
Reforged and is MIT-licensed like the rest of the project's own code.
"""


def main() -> None:
    # Never ship a stale bench: the anchors and art inside the page are baked at build.
    subprocess.run([sys.executable, str(TOOLS / "build_tile_lab.py")], check=True)

    catalog = json.loads((ASSETS / "placeables.json").read_text(encoding="utf-8"))
    flat = [d for d in catalog if d.get("flatTile")]
    sprites, shipped = set(), {}
    for d in flat:
        arts = d.get("turns") or [d]
        for a in arts:
            sprites.add(a["sprite"])
            shipped[a["sprite"].removesuffix(".png")] = {
                "anchorX": a.get("anchorX"), "anchorY": a.get("anchorY"),
                **({"dc": a["dc"]} if a.get("dc") else {}),
                **({"dr": a["dr"]} if a.get("dr") else {}),
            }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("tile-lab/README.txt", README)
        z.writestr("tile-lab/NOTICE.txt", NOTICE)
        z.write(TOOLS / "tile_lab.html", "tile-lab/tile_lab.html")
        z.write(TOOLS / "tileAnchorGeometry.js", "tile-lab/tileAnchorGeometry.js")
        z.writestr("tile-lab/anchors-shipped.json", json.dumps(shipped, indent=1, sort_keys=True))
        for name in sorted(sprites):
            z.write(OBJDIR / name, f"tile-lab/art/{name}")

    print(f"Wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"  {len(flat)} flat placeables, {len(sprites)} sprites, {len(shipped)} anchors")


if __name__ == "__main__":
    main()
