# Decor restoration plan

Goal: every decor item from the source Market is in the game, renders in its intended
colour, and seasonal content is labelled and gate-able.

Scope in numbers:

**All four phases are complete.**

| | start | shipped |
|---|---|---|
| `placeables.json` rows | 307 | **458** |
| — restored source tiles | — | +110 |
| — recolour variants | — | +41 |
| rows carrying their source tint | 5 (monoliths) | **53** |
| `public/assets/objects/` PNGs | 307 | **412** |
| `server/src/objectCatalog.ts` rows | 267 | **418** |
| decor labels | a `seasonal` bool | **`evergreen` + 13 seasonal** |
| decor cards the market offers | 174 | **192** (325 in catalog, 133 withheld) |

Audit findings this plan acts on are in [the audit section](#appendix-audit-findings) at
the bottom.

---

## Design decisions

### D1. One sprite per tile; colour is data, never a duplicated PNG

The monolith pattern is the model, with one correction: monoliths currently ship **five
byte-identical PNGs** (`monolith*.png`, same md5) because the generator writes
`<key>.png` per row. Recolour variants must instead **share the base tile's sprite
filename** and differ only by `color`. `assets.objects[]` is keyed by filename, so
sharing is free — and 43 variants add 0 bytes of art.

```jsonc
{ "key": "hedge_01",      "name": "Hedge",      "sprite": "hedge_01.png", "color": [0,105,0] }
{ "key": "hedge_01_pink", "name": "Pink Hedge", "sprite": "hedge_01.png", "color": [255,153,153],
  "variantOf": "hedge_01" }
```

Variant keys are `<baseTile>_<colourword>`, derived from the source display name
(`"Pink Hedge"` → `pink`). Stable and collision-free; verified against all 43.

The two existing hand-carved exceptions (`flowerBedViolet`, `flowerBedYellow`) get
folded into this scheme, and `QUEST_VARIANT_KEYS` in `prep_placeables.py` goes away.
**Their keys must be preserved** (`flowerBedViolet`, not `flowerBed_violet`) — they are
in live saves and in `server/src/objectCatalog.ts`.

### D2. One label per item; the market carries an allow-list of active labels

Every decor row has exactly one `theme` label. The market shows an item only if its
label is on the allow-list. `evergreen` is the default label and is permanently on the
list.

```jsonc
{ "key": "xmasTree",  "theme": "christmas" }  // sold only while "christmas" is active
{ "key": "dinosaurJeep" }                     // no field = "evergreen" = always sold
```

The field is **omitted when the label is `evergreen`**, matching how the file already
omits `color`, `tapSound` and `petPen`; one accessor supplies the default. That keeps
~320 of the 460 rows unchanged.

Anything that is not seasonal is `evergreen` — including the six themed-but-not-calendar
sets (Roman/Greek, dinosaur, space, underwater, fancy/tea, ponds). They are ordinary
catalogue that happens to share a look. If a reason to group them in the UI shows up
later, adding a label costs one table entry and one allow-list entry, because grouping
and availability read the same field.

The whole mechanism is one module, and the allow-list is the gate:

```ts
// src/decorThemes.ts — the ONLY place that decides availability
export const EVERGREEN = "evergreen";

/** Labels currently on sale. Editing this array IS the gating action. */
export const ACTIVE_THEMES: readonly string[] = [EVERGREEN];

export const themeOf = (def: { theme?: string }) => def.theme ?? EVERGREEN;
export const themeAvailable = (theme: string) => ACTIVE_THEMES.includes(theme);
```

Deliberately a plain array, not a date computation. Whatever eventually drives it —
fixed calendar windows, a server-pushed list, an `enableDate` field — it drives *this
array*, and every call site is already correct. Client and server import the same
module; `src/quest/matching.ts` is already shared across that boundary the same way.

**Day-one decision:** with the allow-list at `[evergreen]`, the 140 seasonal tiles are
all off the market — including 64 that are purchasable today. That is the point of the
gate, and owned copies are untouched (see Phase 4), but it is a visible change on the
day it ships rather than a silent one.

### D3. Seasonal items are gated by their label, not by level

Seasonal decor keeps `level: 1`. Level-gating it as well would mean a player who reaches
their first Christmas at level 3 is locked out of Christmas — the label already decides
whether it is buyable. This matches both the source (all seasonal rows are level 0/1)
and the 64 seasonal items already shipped.

Level extrapolation therefore applies only to **evergreen** additions: 40 tiles, of
which 9 carry a real source level, leaving **31 to assign**.

### D4. Quests accept any recolour of a required item

The buy event carries `aliases` — which `questSubjectMatches` already accepts and
`server/src/v3/engine.ts:375` already forwards. Buying a Blue Fence posts
`subject: "Blue Fence"` with every sibling name as an alias, so a quest asking for
`"Fence"` counts it. Aliases rather than extra events, because a wildcard (empty)
requirement counts every event it sees and a second event would double-count.

The source data says this was always the intent. Quest 27 reads **"Buy 2 Red
Balloons"** but matches on the bare name `"Balloon"`; quest 9 reads **"Buy 4 White
Fences"** against `"Fence"`. The objective names a colour in its text and matches the
family.

Aliases are symmetric — every member lists every sibling, not just the base — because
the base row is whichever variant sorted first, which is not always the uncoloured one
(`tentNormal` is the *Red* Tent). A one-way alias to the base would make
"buy a Tent" unsatisfiable by the Red Tent that holds the base key.

**Revised during implementation:** the plan said the two-word regex in
`src/quest/matching.ts` would go away. It stays. It is not a recolour rule — it makes
`"Barrel"` match `"Pirate Barrel"` and `"Hedge"` match `"Heart Hedge"`, which are
*separate tiles*, and quest 10 relies on it. Deleting it would have made a live quest
stricter, the opposite of the goal. Aliases handle the recolours the regex never
covered (`Fence`, `Crate`, `Balloon`, …); the regex keeps handling its two families.

---

## Phases

Each phase is independently shippable and leaves the game in a working state.

### Phase 1 — Tint correctness (no new items) — **DONE**

The smallest change with the most visible payoff: 11 shipped tiles rendered grey
because the generator emitted `color` only for monoliths.

1. `prep_placeables.py`: `market_tint()` replaces the `if e.get("monolith")` condition —
   every row with a 3-channel value keeps it, white (the identity multiply) is omitted.
   **16 rows are now tinted, up from 5.**
2. `emit_sprite()` content-addresses the extracted art, so tiles that share a piece of
   art share the file. Removed 7 duplicate PNGs (307 → 300): the four extra monoliths,
   both duplicate flower beds, and `spaceWormHoleB` — all byte-identical to the file
   they now point at. (The Worm Hole match turned out to mean something else: both were
   EMPTY. See "Art fixes" below.)
3. Wired the three untinted UI surfaces through a new `setTintedSrc` helper:
   `src/ui/panels/storage.ts` (shed grid), `src/main.ts:3381` (Received cards, skipping
   the tint on loot-atlas art that is already coloured), `src/main.ts:292` → 
   `dialogs.ts` (level-up popup).
4. `src/assets.tint.test.ts` guards the ten greyscale-art tiles, asserts no row ships a
   white `color`, and asserts the flower beds share one sprite with distinct tints.
   `tintedSprite.test.ts`'s monolith case now asserts one shared file rather than one
   file per key — it had been encoding the duplication.

**Verified live** (dev server, measured pixels): `hedge_01.png` on disk is grey
`(160,160,160)`; the market card renders `(0,66,0)` — exactly `160 × 105/255`. The
placed farm sprite carries Pixi tint `0x006900`, the Crate `0xa97327`. Shed thumbnails
and Received cards return tinted data URLs. The level-up popup tints exactly the
expected 11 items, and the three Flower Beds now measure distinctly —
`(138,61,65)` / `(83,61,109)` / `(138,102,0)` from one shared `flowerBed.png`.

Not directly observed: the tap action sheet. Its renderer is the same `tintedImage`
helper proven on the other surfaces and its `tint` argument is unchanged pre-existing
code, but `HTMLImageElement.decode()` never settles while the Browser pane is hidden,
so the popup could not be photographed in this environment.

**Two pre-existing findings surfaced by this phase**, neither caused by it:
- 42 rows carried `xp: 0` where the generator computes `floor(cost/100)`. The
  *unmodified* generator reproduces the same 42 diffs, so `prep_placeables.py` had
  drifted from its asset since the DEFECTS.txt fixed-point verification. Both
  `buyXp` and `objectBuyXp` treat 0 as "derive", so no grant changed; the asset and
  `server/src/objectCatalog.ts` are now re-synced and the generator is a fixed point
  again (verified byte-identical over three runs).
- `spaceWormHoleA` and `spaceWormHoleB` are the same art with no differentiating tint,
  in the source as well as here — two market names, one appearance. Nothing to recover;
  noted in case it wants an authored difference later.

### Phase 2 — Recolour variants (+43 rows) — **DONE**

**307 → 348 rows** (43 variants, two of which — the violet and yellow flower beds —
already existed and only gained `variantOf`). **Zero new art**: still 300 PNGs.

1. `prep_placeables.py` emits a row per distinct (name, tint) instead of dropping every
   Market row after the first. A variant clones the base row — same sprite, footprint,
   pivot, tap sound — and overrides `key`, `name`, `color`, `variantOf` plus its own
   economics. True duplicates (the Gazebo, Pond and Zombie Pot are each listed twice,
   identically) still collapse, keyed on (name, tint).
2. `variant_key()` names them `<tile>_<colour>` from the leading colour word, with
   `_plain` for a sibling whose name carries no colour (the plain "Tent" beside the
   "Red Tent" that holds the base key). `LEGACY_VARIANT_KEYS` pins `flowerBedViolet`
   and `flowerBedYellow`, which are in live saves; `QUEST_VARIANT_KEYS` is gone.
   `market_economics()` is now shared by both paths rather than duplicated.
3. 41 rows added to `server/src/objectCatalog.ts`, **generated from the asset** so the
   mirror cannot drift, and re-sorted into the file's existing alphabetical order.
4. `src/quest/objectVariants.ts` builds the family alias map; `main.ts` (both object-buy
   emitters) and `server/src/v3/engine.ts` (`object.buy` and the restore path) pass it
   on the event. `ObjectRule` and `PlaceableDef` gained `variantOf`.
5. `objectVariants.test.ts` (10 cases) covers the map, the shipped families, and quest
   crediting in both directions. `server/test/objects.test.ts`'s hardcoded "has all 267"
   count became a coverage assertion — it named no missing key and simply had to be
   bumped whenever the catalog grew.

**Verified live**: with the real module and the real catalog on the dev server, quest 9
— *"Buy 4 White Fences"* + *"Buy 1 White Fence Gate"* — completed using four coloured
fences and a red gate, **not one white item**. The market lists the new cards
(`Fence`, `Pink Fence`, `Blue Fence`, … under a "fence" search). All 14 families sit on
one sprite each with every member visually distinct: 7/7 crates, 6/6 hedges, 5/5 fences.

Not directly observed: the tinted market thumbnails for the new cards, for the same
hidden-pane `decode()` limitation noted in Phase 1. `main.ts`'s alias argument is
likewise covered by unit test and by posting the identical payload on the live bus,
rather than by a real canvas tap (synthetic pointer events do not reach Pixi's event
system in a non-compositing pane).

One consequence worth knowing: `placeByName` (loot/quest reward lookup by display name)
now sees repeated names within a family, so it keeps the FIRST row — a variant can never
displace the base a reward resolves to.

### Phase 3 — Restore the 110 tiles (+110 rows) — **DONE**

**348 → 458 rows, 300 → 410 PNGs.**

1. `SEASONAL_DECOR_EXCLUDED` is gone from `prep_placeables.py`. The four junk tiles
   (`missingItem`, `dogHouse`, `mausoleum1`, `mausoleum2`) stay out through the
   `dontShowInMarket` filter that was already there.
2. All 110 PNGs extracted; the Phase-1 dry run had already proved every one resolves,
   and the real run skipped none.
3. `EVERGREEN_LEVELS` assigns the 31 evergreen tiles that carry no source level. The
   9 that do keep it (six Roman/Greek at 5, `pond` 16, `boulder` 22, `blueBox` 25).
   Seasonal rows need none — their label is the gate (D3).
4. 110 rows added to `server/src/objectCatalog.ts`, generated from the asset.

**Level assignment.** Seeded from `level ≈ 9.72·log10(gold) − 12` (r² = 0.38, fitted on
the 90 shipped gold decor/tree rows), with brain prices converted at the catalog's own
1 brain = 1,000 gold, then nudged toward the levels carrying the fewest unlocks —
holding price order and level order in agreement, but only raising the floor when the
price actually rises, so equal-priced siblings do not all pile onto one level.

Result: **no level between 2 and 45 is empty any more** (25 was). The restored items
land between 13 and 34, which is where their prices put them; the early game keeps the
catalogue it had. Level 5 is the one deliberate clump — the six Roman/Greek pieces all
carry source level 5 and ship together as a set.

### Phase 4 — Labels + allow-list wiring — **DONE**

1. `src/decorThemes.ts`: `ACTIVE_THEMES`, `themeOf`, `themeAvailable`, `decorAvailable`,
   `themeLabel`. Shipped as `[EVERGREEN]`.
2. `prep_placeables.py` emits `theme` from `DECOR_THEMES` (13 labels, 139 tiles) and
   omits it for evergreen. `seasonal` is now derived from it and kept for the existing
   market sort. The hand-listed `SEASONAL_MARKET_DECOR` is gone.
3. Market filters the Items tab through `decorAvailable` and badges an active seasonal
   card with its label (`.mkt-theme`, absolutely placed so it does not disturb the
   card's grid).
4. Server gates `object.buy` on the same predicate, rejecting with `locked`.
   `object.place` / `object.status` / the restore path are deliberately untouched.
5. `src/decorThemes.test.ts` (10 cases) checks the defaulting, that the catalog uses no
   unknown label and leaves none dead, that `seasonal` stays in step with `theme`, and
   that a recolour family shares one label so a variant cannot outlive its base.

**Verified live.** With `ACTIVE_THEMES = [evergreen]` the Decors tab offers **192 of
325** decor rows over 20 pages; searching "christmas" returns nothing while "dino",
"pond" and "tree" return the restored evergreen items. Then — the central claim —
adding the single string `"christmas"` to the array and reloading brought back exactly
the four Christmas cards, each carrying a **"Christmas"** badge, with Easter still
hidden. The array was reverted afterwards. Restored decor also places for real on the
farm (Triceratops 5×5, Moon, Pond 3, Tea Cup, Temple), no console errors.

Server-side, `heartFountain` (valentines) is rejected with `locked` and nothing is
charged, while an owned one still stores and re-places — both covered by new tests in
`server/test/v3.engine.test.ts`.

### Phase 5 — Cleanup — **DONE**

- `DEFECTS.txt` records the generator drift each phase surfaced.
- Both generators re-verified as fixed points (three runs, byte-identical output).
- Two more hardcoded-count tests replaced with the property they were reaching for
  (`server/test/objects.test.ts`); they named no missing key and only ever needed
  bumping as the catalog grew.

### Quest wording (added after Phase 2 shipped)

An objective must not name a colour it does not require. `prep_quests.py` now drops the
colour adjective from an objective's text when its subject belongs to a recolour family,
derived from `placeables.json` rather than hand-listed:

| quest | was | now |
|---|---|---|
| 9 | "Buy 4 White Fences" | "Buy 4 Fences" |
| 9 | "Buy 1 White Fence Gate" | "Buy 1 Fence Gate" |
| 27 | "Buy 2 Red Balloons" | "Buy 2 Balloons" |
| 28 | "Buy 2 Red / Violet / Yellow Flower Beds" | **"Buy 6 Flower Beds"** (one objective) |

Objectives naming genuinely distinct art keep their colour — the Easter eggs and circus
flags are separate sprites, not tints, and "Orange Tree" is a fruit.

Quest 28 is the one structural change: its three objectives became interchangeable the
moment recolours started aliasing, so decoloured they read as the same sentence three
times. `merge_recolor_objectives` folds same-family, same-event, same-text neighbours
into one line for the same six items. `QuestSystem.restore` already zeroes a quest whose
requirement count changed, so an in-progress quest 28 restarts — the only player-visible
cost in the change.

Note the generator ordering this introduces: `prep_quests.py` reads the generated
`placeables.json`, so **`prep_placeables.py` runs first**.

### Art fixes (after phases 3-4 shipped)

**Both Worm Holes were invisible** — in the market and on the farm. They are animated
tiles whose declared `frameName` (`wormhole*_00`) is a fully transparent 111x142
placeholder; the drawn art lives in the `_01.._04` animation frames. Extracting the
declared frame produced an empty PNG, which is also why Phase 1's content-dedup merged
them: they were not "the same art", they were both nothing.

`extract_first_animated_frame` now falls back to the first animation frame with pixels,
and `is_blank` stops any fully transparent sprite from being emitted at all. Both holes
now carry their own art (a magenta portal and a teal one, ~8.8k opaque pixels each).
This was pre-existing — they shipped blank in the original 307.

**The White Flower Bed rendered pink.** A recolour family multiplies one sprite by each
variant's tint, which assumes neutral base art — every other family (hedge, crate,
fence, balloon) is authored greyscale. `flowerbed.png` is not: its petals are magenta
and its TileProperties row is literally named "Red Flower Bed". Multiply can only
darken, so white is unreachable from magenta, and the source has exactly one flowerbed
frame — there is no white art to recover. (The original game had the same bug; its
White Flower Bed took the identity tint and drew the magenta art.)

Fixed by giving that one variant a de-coloured sprite of its own
(`NEUTRALIZED_VARIANT_SPRITES`), petals greyed by value and leaves untouched. The Red,
Violet and Yellow beds keep the shared source art and are **pixel-for-pixel unchanged**.
Measured as drawn: red `(253,130,150)`, violet `(152,130,250)`, yellow `(252,219,0)`,
white `(253,253,253)`.

## Label table (draft)

Verified complete: every source decor tile lands in exactly one bucket, no typos, no
orphans, and all 64 currently-`seasonal` tiles are covered.

### Seasonal labels — allow-list gated, level 1

| theme | tiles | restored |
|---|---:|---:|
| `easter` | 21 | 5 |
| `valentines` | 17 | 8 |
| `christmas` | 15 | 10 |
| `lunarNewYear` | 15 | 15 |
| `pirate` | 14 | 0 |
| `harvest` | 10 | 10 |
| `summer` | 10 | 0 |
| `halloween` | 9 | 7 |
| `winter` | 8 | 6 |
| `independence` | 8 | 0 |
| `stPatricks` | 5 | 3 |
| `newYear` | 4 | 4 |
| `anniversary` | 4 | 2 |
| **total** | **140** | **70** |

`newYear` is the one label with source gating data to copy: all four rows carry
`enableDate: 2011-12-25`.

Two of these are judgement calls rather than calendar facts. `summer` (beach set) and
`pirate` (14 tiles) were ZF2 events, but neither is tied to a date the way Easter is —
if they read as ordinary catalogue to you, moving them to evergreen is a two-line edit
and they then need levels like any other evergreen addition.

### Evergreen — no `theme` field, level-gated

Everything else: the whole existing permanent catalogue, plus **40 restored tiles** —
the six themed sets that are not calendar events, and six loose items.

| former set | tiles | restored |
|---|---:|---:|
| ponds (`pond`, `pond1`–`pond7`, koi pond) | 9 | 8 |
| space | 7 | 4 |
| fancy / tea | 7 | 6 |
| Roman/Greek | 6 | 6 |
| dinosaur | 6 | 6 |
| underwater | 4 | 4 |
| loose (`blueBox`, `boulder`, `redTractor`, `soilDivider`, `stoneDivider`, `monolithBusted`) | 6 | 6 |
| **total** | **45** | **40** |

Grouped here only to show the provenance of the 40 — they ship with no label.

---

## Risks

**The server mirror is hand-maintained.** `server/src/objectCatalog.ts` is what actually
charges the player; `server/test/objectCatalogSync.test.ts` asserts parity and that no
server row lacks an asset row. 153 new rows is the single largest hand-edit in this
plan — generate them from `placeables.json` in the same commit rather than by hand, and
let the sync test be the gate.

**Save compatibility.** New keys are additive; no existing key changes. The one hazard
is D1's key preservation for `flowerBedViolet`/`flowerBedYellow` — renaming those
orphans them in live saves and in the server mirror.

**Market volume.** Phase 3 takes the Decors tab from 174 to 327 cards. Phase 4's
allow-list cuts it back to ~193 (110 evergreen decor today + 40 restored + 43 variants)
— so the tab is only unwieldy in the window between the two phases. Ship 3 and 4
together.

**Seasonal decor leaves the market on day one.** 64 items that are purchasable today
stop being purchasable when the allow-list lands at `[evergreen]`. Intended, but it is
the one player-visible regression in this plan — owned copies keep working, and any
theme can be re-opened by adding one string.

**Purchase-limit semantics.** Recolour variants are separate catalogue keys, so a
"1 per farm" cap would apply per colour, not per item. No current variant base is
`functional`, so nothing is affected today — but it is a trap for any future variant of a
limited item.

---

## Appendix: audit findings

Established against `ZF2R_extracted/data/json/gameplay/{Market,TileProperties,Drops}.json`
and the shipped assets.

1. **114 source tiles absent** from `placeables.json` (110 shippable + 4 junk), excluded
   by the hand-written `SEASONAL_DECOR_EXCLUDED` list at `tools/prep_placeables.py:65`.
   A dry run of the extractor against all 114 resolved art for **every one** — no art
   blockers.

2. **43 recolour variants dropped** by the dedupe-by-tile at
   `tools/prep_placeables.py:348`. 17 source tiles carry multiple Market rows differing
   only by `color`.

3. **11 shipped tiles lost their source tint** — `color` is emitted only for monoliths
   (`tools/prep_placeables.py:444`). The affected art is *pure greyscale* (mean
   saturation 0 for `hedge_01`, `crate`, `baloon`, `pen_01`, `cemeteryFence_01`), so
   Hedge renders grey instead of `[0,105,0]` dark green.

4. **`flowerBedViolet`/`flowerBedYellow` are byte-identical to `flowerBed`** (md5
   `afb5222e…` ×3) with no `color` — three market cards, one appearance. Same for the
   five monolith PNGs (md5 `7ea9295f…` ×5), which are saved by the tint they *do* carry.

5. **Tint reaches 4 of 7 surfaces.** Working: market card
   (`hud.ts:1638`→`:2083`), placed sprite (`Field.ts:917`), placement ghost
   (`Field.ts:1531`), tap popup (`main.ts:3755`→`dialogs.ts:95`). Missing: shed grid,
   Received cards, level-up popup.

6. **No seasonal gating exists.** `seasonal` is a sort key only (`marketOrder.ts`,
   consumed once at `hud.ts:1598`). The source has no theme field to recover — only 4
   rows carry `enableDate`, and `flagNeeded`/`pflag` are progression flags for sheds,
   coloured graves and the Zombie Pot. The labels must be authored.

   The server needs no new mirror for this: `server/src/v3/engine.ts:14` imports
   `placeables.json` directly, so `theme` and `variantOf` reach it as soon as the
   generator emits them. Only the *economics* table (`objectCatalog.ts`) is
   hand-maintained.

7. **106 of the 110 restored rows have no source level** (the generator defaults them
   to 1). Only `pond` (16), `blueBox` (25), `boulder` (22) and the six antiquity pieces
   (5) carry one.

8. **Further pool, not in this plan:** 71 orphan `TileProperties` entries that look
   placeable but have no Market row — mostly state/orientation twins (`hedge_02`,
   `roadBend_03/04`, `spookyStrawmanLeft`, `birthdayTimStatueLeft`, `giantClamOpen`,
   night-lit variants).
