"""Extract the authentic MUTATION ICON set + its frame for the zombie card.

ZF2 shipped a dedicated 40x40 icon per mutation (MutationIcons.png, 15 frames:
the 13 primaries plus the two Tier-4 variants Eyebiscus/Heartichoke), and the
Mausoleum's mutation board framed each one in `mutations_frame.png`. Both are used
verbatim by the card's Mutations row — no rig parts are re-rendered for it.

The one exception is Pumpking: it never had a MutationIcons entry (it shipped as a
crop-adjacency-only mutation for the headless family), so its icon is COMPOSED here
in the authored style — the game's own flask, reconstructed from the set, with the
`pumpkinHead` rig part sitting in it where every other icon's vegetable sits.

Reconstructing the empty flask takes three steps because no icon ships without a
vegetable in it: pixels every authored icon agrees on are flask (that loses the right
side, which some vegetable always covers), mirroring the intact left half restores the
outline, and a per-row fill closes the middle, where the flask's flat colour bands make
the nearest-neighbour colour the correct one.

Sources (iOS 1.0 bundle):
  - MutationIcons.png/.plist              -> per-mutation 40x40 icons
  - ZombieMausoleumMutation.png/.json     -> the icon frame
  - ZombieSheet.png + zombie/frames.json  -> the Pumpking fallback

Outputs to zombiefarm/public/assets/ui/mutation/ and .../ui/zdetail/mutation_frame.png.
Run from the repo root (folder containing ZF2R_extracted/ and zombiefarm/).
"""
import json
import os
import plistlib
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, "ZF2R_extracted", "raw", "ios-1.0", "1.0", "Payload", "ZF2R.app")
SHEETS = os.path.join(ROOT, "ZF2R_extracted", "data", "json", "sprites")
GAME = os.path.join(ROOT, "zombiefarm", "public", "assets")
OUT = os.path.join(GAME, "ui", "mutation")
OUT_ZD = os.path.join(GAME, "ui", "zdetail")

ICON_SIZE = 40  # every authored MutationIcons frame is exactly 40x40
# Where an icon's vegetable sits: the box the authored set disagrees over, measured
# from the icons themselves (x 14-39, y 11-39). The pumpkin is fitted into it.
VEG_BOX = 24
VEG_CENTER = (26, 25)


def rect(s):
    return [int(float(x)) for x in s.replace("{", "").replace("}", "").split(",")]


def empty_flask(icons):
    """The authored flask with no vegetable in it — see the module docstring."""
    w, h = icons[0].size
    px = [i.load() for i in icons]
    flask = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    fp = flask.load()
    for y in range(h):
        for x in range(w):
            colour = px[0][x, y]
            if all(p[x, y] == colour for p in px[1:]):
                fp[x, y] = colour  # every icon agrees -> this pixel is flask
    for y in range(h):  # mirror the intact half over the vegetable-eaten one
        for x in range(w):
            if fp[x, y][3] == 0:
                fp[x, y] = fp[w - 1 - x, y]
    for y in range(h):  # close what is still open: the flask's flat interior bands
        filled = [x for x in range(w) if fp[x, y][3] > 0]
        if not filled:
            continue
        lo, hi = min(filled), max(filled)
        for x in range(lo, hi + 1):
            if fp[x, y][3]:
                continue
            left = next((i for i in range(x, lo - 1, -1) if fp[i, y][3]), None)
            right = next((i for i in range(x, hi + 1) if fp[i, y][3]), None)
            near = left if left is not None and (right is None or x - left <= right - x) else right
            fp[x, y] = fp[near, y]
    return flask


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(OUT_ZD, exist_ok=True)

    # --- the authored icon set ---
    atlas = Image.open(os.path.join(APP, "MutationIcons.png")).convert("RGBA")
    frames = plistlib.load(open(os.path.join(APP, "MutationIcons.plist"), "rb"))["frames"]
    authored = []
    for name, meta in sorted(frames.items()):
        x, y, w, h = rect(meta["textureRect"])
        icon = atlas.crop((x, y, x + w, y + h))
        icon.save(os.path.join(OUT, name))
        authored.append(icon)
    print(f"mutation icons: {len(frames)} -> {OUT}")

    # --- the frame the Mausoleum's mutation board shows them in ---
    board = Image.open(os.path.join(APP, "ZombieMausoleumMutation.png")).convert("RGBA")
    board_frames = json.load(open(os.path.join(SHEETS, "ZombieMausoleumMutation.json")))
    board_frames = board_frames.get("frames", board_frames)
    x, y, w, h = rect(board_frames["mutations_frame.png"]["textureRect"])
    board.crop((x, y, x + w, y + h)).save(os.path.join(OUT_ZD, "mutation_frame.png"))
    print(f"mutation frame: {w}x{h} -> {OUT_ZD}")

    # --- Pumpking: no authored icon, so compose one in the same style ---
    sheet = Image.open(os.path.join(GAME, "zombie", "ZombieSheet.png")).convert("RGBA")
    part = json.load(open(os.path.join(GAME, "zombie", "frames.json")))["pumpkinHead"]
    head = sheet.crop((part["x"], part["y"], part["x"] + part["w"], part["y"] + part["h"]))
    head = head.crop(head.getbbox())  # drop transparent margin before fitting
    scale = min(VEG_BOX / head.width, VEG_BOX / head.height)
    head = head.resize((max(1, round(head.width * scale)), max(1, round(head.height * scale))),
                       Image.LANCZOS)
    icon = empty_flask(authored)
    icon.alpha_composite(head, (VEG_CENTER[0] - head.width // 2, VEG_CENTER[1] - head.height // 2))
    icon.save(os.path.join(OUT, "icon_mutation_pumpking.png"))
    print(f"pumpking icon: pumpkinHead in the authored flask -> {OUT}")


if __name__ == "__main__":
    main()
