#!/usr/bin/env python3
"""Cut every frame out of the three unindexed Epic Boss atlases, for hand-ordering.

WHY THIS EXISTS. Rocky Rhino, General Larvaelus and Mystical Mamba shipped their art
without the .plist that names and locates each frame — the only such gap in the
extraction, and it is total: no frame list in the bundle, none in the binary's strings,
and the packer does not lay frames out in name order (checked against foulowl.plist,
whose reading order and alphabetical order disagree). The frames survive as pixels; the
animation SEQUENCES do not, and cannot be derived from geometry.

So they get authored by hand. This dumps each atlas as numbered PNGs plus contact
sheets, and writes a manifest keyed by the same numbers. Fill the `animations` block in
that manifest with frame-number lists — one per state — and prep_all_epic_bosses.py
reads it back to build the strips.

A frame here is the largest opaque island plus anything wholly inside its bounding box,
so a cutout can never swallow a neighbour. Validated against foulowl.png, where it
recovers all 39 authored rects one-to-one at a median IoU of 0.99.

Frame NUMBERS are stable as long as this file and the atlas do not change: islands are
found by a fixed scan and then sorted into reading order (top band, then left to right).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
EXTRACTED = (ROOT / ".." / "ZF2R_extracted").resolve()
APP = EXTRACTED / "raw" / "ios-1.0" / "1.0" / "Payload" / "ZF2R.app"
OUT_ROOT = ROOT / "tools" / "art" / "epic-boss-frames"

# The six states an Epic Boss animates, exactly as EpicEventEnemy.json names them for
# the five bosses that kept their definitions. `attack` is deliberately given no
# duration: its strip is fitted to the fight clock (src/raid/epicBossAnimation.ts).
STATES = ["idle", "enter", "attack", "defeat", "escape", "fly"]

SHEETS = {
    "rocky-rhino": "rockyRhino_default.png",
    "general-larvaelus": "generalLarvaelus_default.png",
    "mystical-mamba": "mysticalMamba_default.png",
}

MIN_AREA = 2000       # ignore specks; real character frames are tens of thousands
ROW_BAND = 120        # px band height used to sort frames into reading order
CONTACT_COLUMNS = 5
CONTACT_ROWS = 4      # 20 frames per page, readable at 100%


def islands(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    """(x, y, w, h, area) for each 4-connected opaque island, area-descending."""
    height, width = mask.shape
    seen = np.zeros((height, width), bool)
    out = []
    for sy, sx in zip(*np.nonzero(mask)):
        if seen[sy, sx]:
            continue
        stack = [(sy, sx)]
        seen[sy, sx] = True
        y0 = y1 = sy
        x0 = x1 = sx
        area = 0
        while stack:
            cy, cx = stack.pop()
            area += 1
            y0, y1 = min(y0, cy), max(y1, cy)
            x0, x1 = min(x0, cx), max(x1, cx)
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        out.append((x0, y0, x1 - x0 + 1, y1 - y0 + 1, area))
    out.sort(key=lambda b: -b[4])
    return out


def frames(path: Path) -> tuple[Image.Image, list[tuple[int, int, int, int]]]:
    image = Image.open(path).convert("RGBA")
    boxes = [b for b in islands(np.array(image)[:, :, 3] > 8) if b[4] >= MIN_AREA]
    kept: list[tuple[int, int, int, int, int]] = []
    for b in boxes:
        contained = any(
            b[0] >= k[0] and b[1] >= k[1]
            and b[0] + b[2] <= k[0] + k[2] and b[1] + b[3] <= k[1] + k[3]
            for k in kept
        )
        if not contained:
            kept.append(b)
    kept.sort(key=lambda b: (b[1] // ROW_BAND, b[0]))  # reading order
    image.load()
    return image, [tuple(int(v) for v in b[:4]) for b in kept]


def contact_sheets(out: Path, sheet: Image.Image, boxes, slug: str) -> int:
    per_page = CONTACT_COLUMNS * CONTACT_ROWS
    cell_w = max(b[2] for b in boxes) + 16
    cell_h = max(b[3] for b in boxes) + 34
    pages = (len(boxes) + per_page - 1) // per_page
    for page in range(pages):
        chunk = list(enumerate(boxes))[page * per_page:(page + 1) * per_page]
        canvas = Image.new("RGBA", (CONTACT_COLUMNS * cell_w, CONTACT_ROWS * cell_h),
                           (26, 26, 34, 255))
        draw = ImageDraw.Draw(canvas)
        for slot, (index, box) in enumerate(chunk):
            cx = (slot % CONTACT_COLUMNS) * cell_w
            cy = (slot // CONTACT_COLUMNS) * cell_h
            if slot % 2:
                draw.rectangle([cx, cy, cx + cell_w - 2, cy + cell_h - 2], fill=(34, 36, 46, 255))
            canvas.alpha_composite(
                sheet.crop((box[0], box[1], box[0] + box[2], box[1] + box[3])),
                (cx + 8, cy + 28))
            draw.text((cx + 8, cy + 8), f"{index:02d}   {box[2]}x{box[3]}",
                      fill=(255, 214, 96, 255))
        canvas.convert("RGB").save(out / f"contact-{page + 1:02d}.png", optimize=True)
    return pages


def main() -> None:
    for slug, name in SHEETS.items():
        out = OUT_ROOT / slug
        out.mkdir(parents=True, exist_ok=True)
        for stale in out.glob("*.png"):
            stale.unlink()
        sheet, boxes = frames(APP / name)
        for index, box in enumerate(boxes):
            sheet.crop((box[0], box[1], box[0] + box[2], box[1] + box[3])).save(
                out / f"frame-{index:02d}.png", optimize=True)
        pages = contact_sheets(out, sheet, boxes, slug)

        manifest_path = out / "animations.json"
        existing = (json.loads(manifest_path.read_text(encoding="utf-8"))
                    if manifest_path.exists() else {})
        manifest = {
            "boss": slug,
            "sheet": name,
            "frameCount": len(boxes),
            # index -> the frame's rect in the atlas, so an ordering authored against
            # these numbers survives without keeping the cut PNGs around.
            "rects": {str(i): list(b) for i, b in enumerate(boxes)},
            # FILL THIS IN: frame numbers in play order, one list per state. A state
            # left empty is simply not built. `durationSeconds` is the whole strip's
            # run time; omit it for `attack`, which is fitted to the fight clock.
            "animations": existing.get("animations") or {
                state: {"frames": [], **({} if state == "attack" else {"durationSeconds": 0})}
                for state in STATES
            },
        }
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(f"{slug}: {len(boxes)} frames, {pages} contact sheets -> {out}")


if __name__ == "__main__":
    main()
