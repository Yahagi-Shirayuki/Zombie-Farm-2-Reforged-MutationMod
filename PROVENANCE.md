# Provenance

**What this project is.** *Zombie Farm 2 Reforged* is an independent, from-scratch
reimplementation of the 2011 mobile game **Zombie Farm 2** (© The Playforge, Inc.). It is
written in **TypeScript** with **PixiJS** and **Vite**, and runs in the browser.

**What it is derived from.** Gameplay logic, tuning, and assets were recovered directly
from the shipped iOS app bundle (`ZF2R.app`, bundle id `com.playforge.ZF2R`) by:

- disassembling the compiled Objective‑C binary to recover formulas, RNG, and timers;
- converting the game's `.plist` config to JSON; and
- extracting the original cocos2d / TexturePacker art, audio, and map data.

**Contributed art.** A small and growing number of assets were **drawn for this project**
and are not extracted from anything. Their sources all live in `tools/art/`, and they reach
`public/assets/` two ways:

- **Catalog items**, listed in `tools/contributed_art.py`, which authors both their art and
  their catalog rows. Each carries a `credit` field the Market shows on the item's info
  parchment. Currently the three sakura trees — `sakuraTree`, `sakuraTreeWeeping` and
  `sakuraTreeFlowering` — drawn by **LennyFaze**.
- **Backdrops**, which have no catalog row and so carry no `credit`: the autumn sunset
  horizon (`farm_background_autumn_dusk.png`), and the tree-less base
  (`tools/art/farm_background_no_trees.png`) that `tools/prep_backgrounds.py` derives the
  Lunar, Dead, Urban, Sakura and Snowy horizons from. The tree-less base is a build input only;
  the sunset ships as-is.

The copyright in each of these is its artist's, not The Playforge's, and the paragraph
below does not apply to them.

**What it is NOT derived from.** This project does not use, fork, or incorporate the source
code, engine project files, or original (re-drawn) assets of any other fan remake. It
contains no Godot code and no third-party remake's scripts, scenes, or artwork. It is an
independent reverse‑engineering of the original shipped game — the same publicly circulated
artifact that any community project starts from — not a derivative of another team's work.

**IP note.** *Zombie Farm 2* and its assets are the property of The Playforge, Inc. The
`ZF2R.app` bundle studied here is a community re-release ("The ZF Archive, 2022"). This
project is a non-commercial fan reimplementation for study and preservation; no ownership of
the original IP is claimed.
