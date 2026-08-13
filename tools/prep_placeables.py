#!/usr/bin/env python3
"""Build the placeable-object catalog (Phase 2/4) from source data.

Joins Market.json item entries to TileProperties.json (footprint tileWidth x
tileHeight, movable, rotations, pivot, atlas + frame) and writes:

  public/assets/placeables.json   [{key,name,category,cost,level,xp,brainsNeeded,
                                     tileW,tileH,movable,rotations,
                                     sprite,nativeW,nativeH,pivotX,pivotY}]
  public/assets/objects/<key>.png the in-world sprite

Three Market sub-categories become the Items sections in-game:
  - "tree"       -> Fruit Trees  (art from Trees1/Trees2/other atlases)
  - "decor"      -> Decors       (art from Decors*/tex* atlases; deduped by tile)
  - "special"    -> Functional   (no atlas art; uses the loose market icon PNG)

Market rows that share a `tile` but differ in name+tint become recolor VARIANTS of
one base row (same art, own `color`); identical repeats collapse. Only entries whose
art can be resolved are emitted.

Run from the repo root:  python zombiefarm/tools/prep_placeables.py
"""
import hashlib
import io
import json
import os
import plistlib
import re

from reforge_economy import brain_price
import contributed_art
import memorial_statue

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ROOT = os.path.dirname(PROJ)
APP = os.path.join(ROOT, "ZF2R_extracted", "raw", "ios-1.0", "1.0", "Payload", "ZF2R.app")
GAMEPLAY = os.path.join(ROOT, "ZF2R_extracted", "data", "json", "gameplay")
OUT = os.path.join(PROJ, "public", "assets")
OBJDIR = os.path.join(OUT, "objects")

CTRL = re.compile(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]")
# Market subCategory -> our catalog category (also the Items section name mapping).
# Item -> catalog category (the Items section it lands in). The real Fruit Trees
# (Apple/Olive/Lemon/Orange) are `subCategory:"decor"` but `categoryID:16`; the
# `subCategory:"tree"` entries (Cypress/Oak/...) are DECORATIVE trees -> Decors.
FRUIT_TREE_CATID = 16
EPIC_REWARD_TILES = {
    "drgroundhogEvilDevice", "drgroundhogTricycle", "drgroundhogNutStash",
    "drgroundhogLabShelves", "drgroundhogLabTable", "drgroundhogEvilLab",
    "drgroundhogBurrow", "drgroundhogDistillery",
    "cactusTarget", "saddle", "rockingHorse", "boots", "banjo", "saloon", "hideout", "gunRack",
    "lilyJukebox", "mossyCouch", "toadStool", "muddyPool", "carnivorousPlants",
    "fireflies", "swamp_Cabin", "squirmyWorms",
    "snowFarmhand", "snowLumberjack", "snowOlMcDonnell", "snowZombie", "snowOwl",
    "antiHolidayIncinerator", "evilCarriage", "antiHolidayVault",
    "bedazzledGravestone", "fancyFountain", "crystalGazebo", "diamondCar",
    "evilMirror", "fashionableScarecrow", "jewelHome", "perfumeVat",
    "rockyRhinosBanner", "rockyRhinosCave", "rockyRhinosGong", "rockyRhinosSculpture",
    "generalLarvaelusBanner", "generalLarvaelusTeleporterA", "generalLarvaelusTeleporterB", "teleporter",
    "mysticalMambaBanner", "mysticalMambasWishMachineLeft", "mysticalMambasWishMachineRight",
}

# ---- Decor themes (hand-authored, NOT derivable from source) ----------------
# Nothing in Market.json says which holiday a decor belongs to: only 4 rows carry an
# enableDate, and flagNeeded/pflag are progression flags for sheds and graves. ZF2
# gated events by server content push, so the labels have to be authored here.
#
# Each tile gets at most ONE label. Anything absent is `evergreen` and always on
# sale; a labelled tile is sold only while its label is on the market allow-list
# (src/decorThemes.ts). Six themed-but-not-calendar sets deliberately have NO label —
# Roman/Greek, dinosaur, space, underwater, fancy/tea and the ponds are ordinary
# catalog that happens to share a look, and they are level-gated like everything else.
#
# See docs/DECOR_RESTORATION_PLAN.md for the full table and its rationale.
DECOR_THEMES = {
    "christmas": """
        xmasCandle xmasTree sleigh giftBasket xmasFence xmasArch snowMan xmasGifts
        xmasGingerbreadHouse xmasWreath giantCandyCane greenGift redGift yellowGift
        teddyBear""",
    "winter": """
        snowFort snowBalls igloo iceSculpture snowCannon winterSnowWoman snowHedge_01
        logCabin""",
    "newYear": "newYearBallLeft newYearBallRight newYearBannerLeft newYearBannerRight",
    "lunarNewYear": """
        stoneLion urn redLantern pagoda riceDumpling lotusLantern bigDragonBoat
        riceDumplingPile luckPlant yellowSatchet blueSatchet redSatchet smallDragonBoat
        dragonStatue newYearTree""",
    "valentines": """
        cupidTopiary holidayBalloonRed holidayBalloonWhite holidayBalloonYellow
        holidayHeartTopiary holidayRoseBushWhite holidayRoseBushYellow holidayRoseBushRed
        cupidStatueA cupidStatueB heartGravestone heartHedge heartCandle heartFountain
        holidayChocolateFountain teddyValentine loveShack""",
    "easter": """
        chocolateBunnyA chocolateBunnyB eggTree monolithEgg giantPeep easterEggBlue
        easterEggGreen easterEggPink easterEggPurple easterEggWhite easterGrass peepPink
        peepYellow goldEgg bigEasterEggBlue bigEasterEggGreen bigEasterEggPink
        easterBasket eggBush eggLamp rockBunny""",
    "stPatricks": """
        stPatricksClover stPatricksPotOfGold stPatricksShamrock stPatricksIrishFlag
        stPatricksFountain""",
    "halloween": """
        hauntedHouse candelabra organ spookyStrawmanRight candleAltarDay festiveFence
        sugarSkull skeletonCouple boxoLantern""",
    "harvest": """
        patioBench appleBobbing patioTable treeAutumn1 treeAutumn2 treeAutumn3 mayflower
        pumpkin enormoPumpkin cornucopia""",
    "independence": """
        drinksCooler starTopiary bbqGrill libertySnareDrum libertyMonument
        barrelOfFireworks sculptureOfLiberty libertyBell""",
    "anniversary": """
        birthdayTimStatue birthdayBalloonsRight zombieGift birthdayCakeThirdYearRight""",
    "summer": """
        umbrellaYellow umbrellaOrange tikiHeadSmall tikiHeadLarge sandCastle
        lifeguardChair surfboardRed surfboardBlue beachBall pailAndShovel""",
    "pirate": """
        powderKeg cannon pirateCratePlain shipWheel rumBarrel rope pirateCrate gibbetCage
        pirateBarrel cannonBalls cursedChest islandRelic pirateSack pirateBag""",
}
THEME_OF_TILE = {
    tile: theme for theme, tiles in DECOR_THEMES.items() for tile in tiles.split()
}

# Unlock levels for the evergreen decor restored alongside the themed sets. 106 of
# the 110 restored rows carry no source level (the generator would default them to
# 1, dumping them all into the level-1 store), and holiday rows do not need one
# because their label is the gate. These 31 are the evergreen remainder.
#
# Seeded from the shipped catalog's own price curve — level ~= 9.72*log10(gold) - 12,
# fitted on the 90 gold decor/tree rows, r2 = 0.38 — then nudged toward the levels
# carrying the fewest unlocks, holding price order and level order in agreement.
# The 9 evergreen tiles that DO carry a source level keep it (the six Roman/Greek
# pieces at 5, pond 16, boulder 22, blueBox 25).
EVERGREEN_LEVELS = {
    "pond7": 13, "pond5": 14, "pond3": 16, "pond1": 17, "pond4": 17, "pond6": 18,
    "pond2": 19, "soilDivider": 19, "stoneDivider": 19, "dinosaurSkull": 19,
    "underwaterCoral": 21, "spaceCrater": 21,
    "spaceLunarLander": 22, "fancyCoatOfArms": 22, "fancyTeacup": 22,
    "dinosaurFootprint": 25, "monolithBusted": 25, "underwaterMermaid": 25,
    "dinosaurRaptor": 25, "spaceRocketShip": 25,
    "fancyUmbrellaTree": 26, "underwaterTreasure": 27, "dinosaurJeep": 27,
    "dinosaurFern": 28, "fancyTeakettle": 28,
    "underwaterShip": 29, "dinosaurTriceratops": 29,
    "fancyMustache": 30, "spaceMoon": 31, "fancyChair": 31,
    "redTractor": 34,
}

# Hand-set premium brain prices. These deliberately skip the brainflation retune —
# they are meant to read as expensive showpieces rather than land in the typical
# 1-5 brain band.
PREMIUM_BRAIN_PRICES = {
    "heartGravestone": 15,
    "cupidStatueA": 50,
    "cupidStatueB": 50,
}

# Market decors that Reforged awards through quests/events instead of selling.
# They keep their art but are never purchasable: cost 0, no level gate, no XP.
REWARD_ONLY_DECOR = {
    "rockBunny", "greenGift", "redGift", "yellowGift", "teddyBear", "loveShack",
}


def is_reward_only(tile):
    """True for a placeable Reforged only ever AWARDS — never sells.

    The source let you buy an Epic Boss prize with brains to skip the fight;
    Reforged does not (category "reward" is absent from the Market's tabs), so
    carrying the source's brain price gave those rows a sell-back value they were
    never paid for — selling a free prize minted 1,000-4,000 gold. Priced like every
    other earned decoration instead: cost 0, which also makes them unpurchasable
    server-side (planObjectBuy refuses cost <= 0).

    What they SELL for is decided separately, by the authored table in
    src/awardSellValue.ts (a quarter of the brain price for an Epic Boss prize), so
    do not give these rows a real `cost` to raise their sale value — that would put
    them back on the market. KEEP IN SYNC with server/src/objectCatalog.ts.
    """
    return tile in REWARD_ONLY_DECOR or tile in EPIC_REWARD_TILES

# Source `subCategory:"decor"` rows that Reforged treats as BUILDINGS, not scenery.
# A functional object is one-per-farm (client and server both derive the purchase
# limit from this category) and sits in the Market's Functional Items tab. The Pet
# Pen is the only one: it is a single roaming-pet enclosure, and owning several has
# no meaning — the pen's five slots are shared, not per-building.
FUNCTIONAL_OVERRIDE_TILES = {"pettingZoo"}

# ---- Objects the Rotate tool must not turn (design override, NOT source data) ----
# In isometric art a horizontal mirror IS a quarter turn, which is why Rotate is a flip.
# It stops being a turn the moment the art has WRITING baked into it: mirroring the Ice
# Cream Stand gives its sign as "MAERC ECI", which is what a player reported. There is no
# mechanical repair — un-mirroring the letters afterwards would need them re-skewed onto a
# plank now leaning the other way — so these simply do not rotate, and the tool says so.
#
# Reviewed the whole object set for baked lettering; this is all of it. Judge by TEXT, not
# by asymmetry: every raid banner is asymmetric and mirrors perfectly well, because its
# crest is a picture. See canMirrorObject in src/assets.ts.
NO_MIRROR_TILES = {
    "iceCreamStand",      # "ICE CREAM 5c" across the sign board
    "iceCreamTruck",      # "ICE CREAM" down the side panel
    "newYearBannerLeft",  # "HAPPY 2012" on the bunting
    "newYearBannerRight",
}

# ---- Mausoleum upgrade ladder (design override, NOT source data) ------------
# The source ships one buyable Mausoleum (mausoleum3) plus two key-fragment tiers
# that Reforged does not use. Reforged instead makes the placed Mausoleum
# upgradeable in place, exactly like the storage sheds: each tier costs brains and
# adds five zombie storage slots. Every tier reuses the base row (same art, same
# 4x4 footprint) and differs only in key/name/cost/zombieSlots.
MAUSOLEUM_BASE_SLOTS = 15
MAUSOLEUM_TIERS = [
    # key, market name, brain cost, zombie storage slots
    ("mausoleum4", "Mausoleum II", 4, MAUSOLEUM_BASE_SLOTS + 5),
    ("mausoleum5", "Mausoleum III", 6, MAUSOLEUM_BASE_SLOTS + 10),
    ("mausoleum6", "Mausoleum IV", 8, MAUSOLEUM_BASE_SLOTS + 15),
    ("mausoleum7", "Mausoleum V", 10, MAUSOLEUM_BASE_SLOTS + 20),
]

# ---- Extra storage-shed rungs (design override, NOT source data) -------------
# The source's shed ladder stops at storage08 (McDonnell's Barn, 64 slots), which a
# long-running farm outgrows with nothing left to spend gold on. These rungs continue
# the same ladder: +8 slots each, keeping the source's roughly x1.5 price step. Each
# clones the top source shed's row, so it reuses that art until it gets its own —
# only key/name/cost/xp/storageSlots differ. KEEP IN SYNC with
# server/src/objectCatalog.ts (OBJECTS + SHED_SLOTS).
EXTRA_SHED_BASE = "storage08"
EXTRA_SHED_TIERS = [
    # key, market name, gold cost, item storage slots
    ("storage09", "Zombie Warehouse", 525_000, 72),
]

# ---- Recolor variants --------------------------------------------------------
# 17 TileProperties keys carry several Market rows that differ ONLY by display name
# and tint: one Hedge sprite is sold as six colors, one crate as seven. The catalog
# used to keep just the first row of each, which threw away 43 buyable items.
#
# A variant is a full catalog row that reuses the base row's art and footprint and
# overrides name/color, so it costs no extra pixels — see emit_sprite and D1 in
# docs/DECOR_RESTORATION_PLAN.md.
COLOR_WORDS = {
    "pink", "blue", "red", "black", "white", "yellow", "violet",
    "green", "silver", "gold", "orange", "purple",
}

# Two variants shipped before this scheme existed, under hand-picked keys. Those
# keys are in live saves and in server/src/objectCatalog.ts, so they are pinned
# rather than regenerated.
LEGACY_VARIANT_KEYS = {
    "Violet Flower Bed": "flowerBedViolet",
    "Yellow Flower Bed": "flowerBedYellow",
}


def variant_key(tile, name, taken):
    """Stable catalog key for one recolor of `tile`.

    Source names lead with the color ("Pink Hedge", "White Flower Bed"), so that
    word is the suffix. A sibling whose name carries no color at all — the plain
    "Tent" next to the "Red Tent" that holds the base key — becomes `_plain`.
    """
    if name in LEGACY_VARIANT_KEYS:
        return LEGACY_VARIANT_KEYS[name]
    first = name.strip().split()[0].lower() if name.strip() else ""
    suffix = first if first in COLOR_WORDS else "plain"
    key = f"{tile}_{suffix}"
    # Nothing in the current data collides, but two same-colored siblings must not
    # silently overwrite each other if the source ever grows one.
    n = 2
    while key in taken:
        key = f"{tile}_{suffix}{n}"
        n += 1
    return key


def unlock_level(e, tile, reward_only):
    """Player level this row unlocks at.

    Most restored decor carries no source level. A themed row does not need one —
    its label decides whether it is on sale at all — so it stays at the source
    default. Evergreen rows without a source level take an authored one, or the
    whole set would land at level 1 at once (see EVERGREEN_LEVELS).
    """
    if reward_only:
        return -1
    source = e.get("level")
    if source is not None and source > 1:
        return source
    return EVERGREEN_LEVELS.get(tile, source if source is not None else 1)


def market_economics(e, key, tile, reward_only, brains_priced, category):
    """Price, level gate, currency and purchase XP for one Market row."""
    brains = brains_priced and not reward_only
    if reward_only:
        cost = 0
    elif brains:
        # Brain prices take the brainflation retune, except the few premium
        # showpieces priced by hand. See tools/reforge_economy.py.
        cost = PREMIUM_BRAIN_PRICES.get(key) or brain_price(
            e.get("cost", 0), key, strict=False)
    else:
        cost = e.get("cost", 0)
    return {
        "cost": cost,
        "level": unlock_level(e, tile, reward_only),
        # Fruit-tree rows omit `xp`, and some ordinary gold decor rows carry zero.
        # The binary's +[MarketDataManager xpFromItem:] awards those normal gold
        # purchases floor(cost / 100) XP. Preserve positive authored XP and the
        # informational source XP on brain purchases.
        "xp": (0 if reward_only
               else cost // 100 if category == "tree"
               else cost // 100 if not brains and e.get("xp", 0) <= 0
               else e.get("xp", 0)),
        "brainsNeeded": brains,
    }


def market_tint(e):
    """This row's sprite tint, or None when it is absent or the identity.

    The original game passes the Market RGB through
    `placeNewObjectTileWithKey:andFilename:andColor:` and applies it as a
    multiplicative cocos2d sprite tint. Much of the decor art is authored
    GREYSCALE and takes ALL of its colour from this value — hedge_01, crate,
    baloon, pen_01 and cemeteryFence_01 all have mean saturation 0 — so a row
    that loses its tint renders grey. White is the identity multiply, so those
    rows are omitted to keep the generated catalog compact.
    """
    color = e.get("color")
    if not isinstance(color, list) or len(color) != 3:
        return None
    return None if all(channel == 255 for channel in color) else color


_sprite_by_digest = {}


def emit_sprite(key, img):
    """Save `img` as <key>.png and return the filename it can be referenced by.

    Several tiles share one piece of art and are told apart ONLY by their Market
    tint: the five monoliths all draw tex1009.png. Writing a copy per key
    duplicates the bytes and buries the fact that colour, not art, distinguishes
    them — so a byte-identical sprite reuses the first file written instead.
    """
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = buf.getvalue()
    digest = hashlib.sha1(data).hexdigest()
    shared = _sprite_by_digest.get(digest)
    if shared:
        return shared
    out_name = f"{key}.png"
    with open(os.path.join(OBJDIR, out_name), "wb") as fh:
        fh.write(data)
    _sprite_by_digest[digest] = out_name
    return out_name


def classify(e):
    if e.get("subCategory") == "special":
        return "functional"
    if e.get("categoryID") == FRUIT_TREE_CATID:
        return "tree"  # Fruit Trees
    if e.get("subCategory") in ("tree", "decor"):
        return "decor"
    return None


_plist_cache = {}


def load_plist(path):
    return plistlib.load(io.BytesIO(CTRL.sub(b"", open(path, "rb").read())))


def frames(fl):
    if fl not in _plist_cache:
        p = os.path.join(APP, fl)
        _plist_cache[fl] = load_plist(p)["frames"] if os.path.exists(p) else None
    return _plist_cache[fl]


_img_cache = {}


def image(png):
    from PIL import Image

    if png not in _img_cache:
        p = os.path.join(APP, png)
        _img_cache[png] = Image.open(p).convert("RGBA") if os.path.exists(p) else None
    return _img_cache[png]


def rect(s):
    n = list(map(int, re.findall(r"-?\d+", s)))
    return n[0], n[1], n[2], n[3]


def extract_from_atlas(fl, fn):
    """Cut frame `fn` out of atlas `fl`; returns a PIL image or None."""
    fr = frames(fl)
    if not fr or fn not in fr:
        return None
    atlas = image(fl.replace(".plist", ".png"))
    if atlas is None:
        return None
    f = fr[fn]
    x, y, w, h = rect(f["textureRect"])
    rotated = f.get("textureRotated", False)
    cw, ch = (h, w) if rotated else (w, h)
    im = atlas.crop((x, y, x + cw, y + ch))
    return im.rotate(-90, expand=True) if rotated else im


def pair(s):
    n = [float(v) for v in re.findall(r"-?\d+\.?\d*", s)]
    return n[0], n[1]


def flat_tile_fields(tp, sprite_img):
    """`{}`, or the flat-tile anchor fields — the cocos anchor of a flatTile's art,
    EXPRESSED AGAINST THE PNG WE SHIP.

    GROUND TRUTH `-[Tile anchorPoint]` / `-[Tile loadBaseSprite]`: a tile positions
    its node at the ground tile's own position and hangs the art off
    `(pivotx, pivoty)` — cocos anchor, y-up, defaulting to (0.38, 0). Ordinary
    objects survive being bottom-centered instead; flat road/pond art does not,
    because its pieces only meet at the seams if every piece uses its own pivot.

    An atlas frame is TRIMMED, and cocos applies the anchor to the UNtrimmed size
    then shifts the quad by `offset + (untrimmed - trimmed)/2`. We ship the trimmed
    crop, so fold both terms into one anchor against that crop.
    """
    if not tp.get("flatTile"):
        return {}
    ax = float(tp.get("pivotx", 0.38))
    ay = float(tp.get("pivoty", 0.0))
    w, h = sprite_img.width, sprite_img.height
    w0, h0, offx, offy = w, h, 0.0, 0.0
    fr = frames(tp["frameList"]) if tp.get("frameList") else None
    f = fr.get(tp.get("frameName")) if fr else None
    if f and "spriteSourceSize" in f:
        w0, h0 = pair(f["spriteSourceSize"])
        offx, offy = pair(f.get("spriteOffset", "{0,0}"))
        offx += (w0 - w) / 2
        offy += (h0 - h) / 2
    return {"flatTile": True,
            "anchorX": round((ax * w0 - offx) / w, 6),
            "anchorY": round((ay * h0 - offy) / h, 6)}


# ---- Variants that need their own de-coloured sprite (authored, NOT source art) --
# A recolor family multiplies ONE sprite by each variant's tint, which assumes the
# base art is neutral — every other family (hedge, crate, fence, balloon) is authored
# greyscale. flowerbed.png is not: its petals are magenta and its TileProperties row
# is literally named "Red Flower Bed".
#
# Multiply can only darken, so no tint can turn those petals white and the White
# Flower Bed rendered pink. The source has exactly one flowerbed frame, so there is
# no white art to recover. Rather than neutralise the shared base — which would also
# repaint the Red, Violet and Yellow beds that look right today — the white variant
# alone gets its own sprite with the petals greyed out. Leaves are untouched; they
# are green in every variant of the original too.
NEUTRALIZED_VARIANT_SPRITES = {"flowerBed_white"}


def neutralize_petals(img):
    """Grey out the coloured (non-green) pixels so a tint can recolour them.

    A petal pixel is one whose red beats its green; leaves and their shading are
    the other way round. Value (max channel) is kept so highlights and shadows
    survive and only the hue is dropped.
    """
    out = img.copy()
    pixels = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = pixels[x, y]
            if a and r > g:
                value = max(r, g, b)
                pixels[x, y] = (value, value, value, a)
    return out


def is_blank(img):
    """True when every pixel is transparent — nothing would be drawn."""
    return img is None or img.getbbox() is None


def loose_sprite(tp, sheet=None):
    """Full-size in-world art for a tile that ships as a standalone tex*.png.

    Some tiles are ONE frame of a SHARED sheet — the coloured graves (Blue/Red/
    Silver) all live in tex2004.png as a 2x2 grid — so crop to this tile's own
    rect when it sits at a nonzero offset in the sheet.
    """
    ss = sheet or (tp or {}).get("spriteSheet")
    if not tp or not ss:
        return None
    img = image(ss)
    if img is None:
        return None
    img = img.copy()
    fw, fh = tp.get("width"), tp.get("height")
    fx, fy = int(tp.get("x") or 0), int(tp.get("y") or 0)
    if fw and fh and (fx > 0 or fy > 0):
        img = img.crop((fx, fy, fx + int(fw), fy + int(fh)))
    return img


# Functional objects whose working state changes what they look like on the farm.
# The source ships each state as its OWN TileProperties tile with the same
# footprint and ground point, differing only in art: the Zombie Pot is bare while
# idle, wears a clamped-down lid while a combine cooks, and sprouts the finished
# zombie's arm once it is done. They ride along on the one catalog row as
# alternate sprites (see `busySprite` / `readySprite` in assets.ts).
STATE_SPRITE_TILES = (("cooking", "busySprite"), ("done", "readySprite"))


def state_sprites(tileprops, tile):
    """{"busySprite": file, ...} for `tile`'s working-state art (may be empty)."""
    out = {}
    for suffix, field in STATE_SPRITE_TILES:
        img = loose_sprite(tileprops.get(f"{tile}_{suffix}"))
        if not is_blank(img):
            out[field] = emit_sprite(f"{tile}_{suffix}", img)
    return out


def extract_first_animated_frame(tp):
    """First frame with actual pixels from an animated tile's animation.

    Some animated decor rests on an EMPTY frame: both Worm Holes declare
    `frameName` wormhole*_00, which is a fully transparent 111x142 placeholder, and
    the visible art lives in the _01.._04 animation frames. Extracting the declared
    frame yields an invisible object — the two Worm Holes shipped as blank cards and
    blank farm tiles because of exactly this.
    """
    for anim in tp.get("animationDictionaries", []) or []:
        fl = anim.get("animationFrameList") or tp.get("frameList")
        names = anim.get("animationFrames") or []
        single = anim.get("animationFrameName")
        if single:
            names = [single, *names]
        for fn in names:
            frame = extract_from_atlas(fl, fn)
            if not is_blank(frame):
                return frame
    return None


# Tiles whose ANIMATION carries the object and whose declared `frameName` is only
# the part that stands still.
#
# The Worm Holes (handled by extract_first_animated_frame above) rest on a fully BLANK
# frame, which is easy to spot. The Solar System is the harder shape: frame
# solarsystem_00 is a real drawing — the little grey plinth — and every planet and the
# sun live in the 12 animation frames orbiting above it. So the extract succeeded, the
# object shipped, and it shipped as a bare pedestal ("Solar System decor is not showing
# the planets"). Measured against the source: its animation covers 11.7x the area of
# its base frame, where the next-widest animated tile is 3.0x and every other one has
# its subject in the base frame already — this is the only tile of its kind.
#
# The reimplementation draws placeables as single static sprites, so the fix is to bake
# the orbit's FIRST frame over the plinth, exactly as extract_multiplepieces bakes a
# rigged object's layers. Frame 01 is also the widest spread of the twelve and the only
# one the source itself starts on.
ANIMATION_OVER_BASE = {"spaceSolarSystem"}


def extract_animated_over_base(tp):
    """Base frame + the first frame of each animation, cropped around the base.

    The crop is the fiddly half. A placed object is BOTTOM-CENTERED on its footprint
    (Field.fitObjectSprite anchors at 0.5, 1), so whatever this returns has its bottom
    centre pinned to the tile. Returning the composite's own bounds would pin the
    ORBIT's centre there and hang the plinth off to one side and up in the air. Instead
    the result keeps the BASE frame's bottom edge as its own bottom edge and is padded
    symmetrically about the base frame's centre line, so the plinth lands exactly where
    it lands today and the planets simply extend above and around it.
    """
    fl = tp.get("frameList")
    fr = frames(fl)
    base_name = tp.get("frameName")
    if not fr or base_name not in fr:
        return None
    atlas = image(fl.replace(".plist", ".png"))
    if atlas is None:
        return None

    from PIL import Image

    names = [base_name]
    for ad in tp.get("animationDictionaries", []) or []:
        seq = ad.get("animationFrames") or []
        first = ad.get("animationFrameName") or (seq[0] if seq else None)
        if first and first in fr and first not in names:
            names.append(first)
    if len(names) < 2:
        return None

    # Every frame is trimmed out of one shared untrimmed canvas; spriteColorRect is
    # its origin in that canvas, which is what makes the pieces line up.
    sizes = [list(map(int, re.findall(r"-?\d+", fr[n]["spriteSourceSize"]))) for n in names]
    canvas = Image.new("RGBA", (max(s[0] for s in sizes), max(s[1] for s in sizes)), (0, 0, 0, 0))
    for n in names:
        f = fr[n]
        x, y, w, h = rect(f["textureRect"])
        rotated = f.get("textureRotated", False)
        cw, ch = (h, w) if rotated else (w, h)
        piece = atlas.crop((x, y, x + cw, y + ch))
        if rotated:
            piece = piece.rotate(-90, expand=True)
        cx, cy, _, _ = rect(f["spriteColorRect"])
        canvas.alpha_composite(piece, (cx, cy))

    content = canvas.getbbox()
    if not content:
        return None
    bx, by, bw, bh = rect(fr[base_name]["spriteColorRect"])
    centre = bx + bw / 2
    bottom = by + bh
    half = max(centre - content[0], content[2] - centre)
    left = int(round(centre - half))
    right = int(round(centre + half))
    # Anything dipping below the base's ground line would be cut off by this crop.
    # Frame 01 of the only tile that uses this does not; refuse rather than silently
    # clip half a planet off a tile added here later.
    if content[3] > bottom:
        raise ValueError(
            f"{tp.get('name')}: animation frame draws {content[3] - bottom}px below the "
            f"base frame's ground line, which this crop would clip"
        )
    return canvas.crop((left, content[1], right, bottom))


def extract_multiplepieces(tp):
    """Composite a `multiplePieces` object into one static sprite.

    These are paper-doll / rigged objects (Skeleton Couple, fireflies jar, ...)
    whose `frameName` is only one small piece (e.g. the couple's held hands), so
    the single-frame extract yields a tiny fragment. The whole sprite is the base
    frame plus every animationDictionary layer, each a trimmed frame placed by its
    spriteColorRect origin within a source canvas shared by all pieces. Layers that
    are a frame-sequence (animationFrames) contribute only their first frame.
    """
    fl = tp.get("frameList")
    fr = frames(fl)
    if not fr:
        return None
    atlas = image(fl.replace(".plist", ".png"))
    if atlas is None:
        return None

    # Ordered, deduped draw list: base first (bottom), then each layer on top.
    names = []
    base = tp.get("frameName")
    if base:
        names.append(base)
    for ad in tp.get("animationDictionaries", []):
        fn = ad.get("animationFrameName")
        if not fn:
            seq = ad.get("animationFrames")
            fn = seq[0] if seq else None
        if fn:
            names.append(fn)
    seen_fn = set()
    names = [n for n in names if n in fr and not (n in seen_fn or seen_fn.add(n))]
    if not names:
        return None

    from PIL import Image

    # Every piece is trimmed from a common untrimmed canvas (spriteSourceSize);
    # spriteColorRect origins are in that canvas's coordinate space.
    srcsizes = [list(map(int, re.findall(r"-?\d+", fr[n]["spriteSourceSize"]))) for n in names]
    sw = max(s[0] for s in srcsizes)
    sh = max(s[1] for s in srcsizes)
    canvas = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    for n in names:
        f = fr[n]
        x, y, w, h = rect(f["textureRect"])
        rotated = f.get("textureRotated", False)
        cw, ch = (h, w) if rotated else (w, h)
        im = atlas.crop((x, y, x + cw, y + ch))
        if rotated:
            im = im.rotate(-90, expand=True)
        cx, cy, _, _ = rect(f["spriteColorRect"])
        canvas.alpha_composite(im, (cx, cy))
    return canvas


def extract_child_layer(tp):
    """A tile's authored BACK layer: its `childNodes` composited on their own.

    A childNode is a second sprite the source draws at a DEEPER depth than the tile's
    base art — the Pet Pen is the only tile that has one: `pettingzoo_back.png` at
    depth 15 behind `pettingzoo_front.png` at depth 0. The two must stay separate
    images, never flattened together, because pets and characters stand BETWEEN the
    far and near walls; see Field.fitObjectSprite. Both layers are authored on the
    same canvas, so the exported back layer aligns with the base sprite pixel for
    pixel. Returns None when the tile has no child nodes (or their art is missing).
    """
    children = tp.get("childNodes", [])
    if not tp.get("spriteSheet") or not children:
        return None
    layers = []
    for child in children:
        child_name = child.get("spriteSheet")
        child_image = image(child_name) if child_name else None
        if child_image is None:
            return None
        layers.append(child_image)

    from PIL import Image

    width = max(layer.width for layer in layers)
    height = max(layer.height for layer in layers)
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for layer in layers:
        canvas.alpha_composite(layer, (0, 0))
    return canvas


def main():
    from PIL import Image

    os.makedirs(OBJDIR, exist_ok=True)
    market = json.load(open(os.path.join(GAMEPLAY, "Market.json"), encoding="utf-8"))["Entries"]
    tileprops = json.load(open(os.path.join(GAMEPLAY, "TileProperties.json"), encoding="utf-8"))["Entries"]

    catalog = []
    seen = set()  # tile keys with at least one emitted market/reward object
    counts = {"tree": 0, "decor": 0, "functional": 0, "reward": 0}
    skipped = 0
    skipped_keys = []
    base_row = {}  # tile -> the catalog row holding that tile's art
    base_img = {}  # tile -> that row's extracted sprite
    signatures = {}  # tile -> {(name, tint)} already emitted
    keys_taken = set()
    variant_count = 0

    # Sort so the cheapest/earliest variant of a shared tile wins the base key.
    items = [e for e in market if ((e.get("category") == "item" and classify(e)) or e.get("tile") in EPIC_REWARD_TILES)
             and (not e.get("dontShowInMarket") or e.get("tile") in EPIC_REWARD_TILES)]
    items.sort(key=lambda e: (e.get("level", 1), e.get("cost", 0)))

    for e in items:
        tile = e.get("tile")
        if not tile:
            continue
        category = ("reward" if tile in EPIC_REWARD_TILES or tile in REWARD_ONLY_DECOR
                    else "functional" if tile in FUNCTIONAL_OVERRIDE_TILES
                    else classify(e))

        # A later Market row for art already emitted is either a genuine recolor
        # (its own card) or a straight duplicate of a row already written — the
        # Gazebo, the Pond and the Zombie Pot are each listed twice, identically.
        if tile in base_row:
            signature = (e["name"], tuple(market_tint(e) or ()))
            if signature in signatures[tile]:
                continue
            signatures[tile].add(signature)
            key = variant_key(tile, e["name"], keys_taken)
            keys_taken.add(key)
            row = dict(base_row[tile])  # same art, footprint, pivot, sounds
            row.update({
                "key": key,
                "name": e["name"],
                # Grouping for the quest matcher: buying any recolor also answers to
                # its siblings' names, so "buy a Fence" takes a Blue Fence.
                "variantOf": tile,
                **market_economics(e, key, tile, is_reward_only(tile),
                                   bool(e.get("brainsNeeded", False)), category),
            })
            tint = market_tint(e)
            if tint:
                row["color"] = tint
            else:
                row.pop("color", None)
            # A variant whose colour no tint can reach gets art of its own rather
            # than the family's shared sprite (see NEUTRALIZED_VARIANT_SPRITES).
            if key in NEUTRALIZED_VARIANT_SPRITES and base_img.get(tile) is not None:
                neutral = neutralize_petals(base_img[tile].convert("RGBA"))
                row["sprite"] = emit_sprite(key, neutral)
                row["nativeW"], row["nativeH"] = neutral.width, neutral.height
            catalog.append(row)
            counts[category] += 1
            variant_count += 1
            continue

        key = tile
        keys_taken.add(key)
        tp = tileprops.get(tile, {})

        sprite_img = None
        growing_img = None  # fruit trees only: the pre-harvest (no fruit) frame
        if category == "tree":
            # Fruit tree: two states. The growing (no-fruit) frame is this tile's
            # frameName; the ripe (fruit-bearing) frame is the readyKey tile's.
            fl = tp.get("frameList")
            ready_tp = tileprops.get(tp.get("readyKey"), {})
            ready_fn = ready_tp.get("frameName") or tp.get("frameName")
            growing_fn = tp.get("frameName")
            if fl and ready_fn:
                sprite_img = extract_from_atlas(fl, ready_fn)  # main sprite = ripe
            if fl and growing_fn and growing_fn != ready_fn:
                growing_img = extract_from_atlas(fl, growing_fn)
        elif category in ("decor", "reward"):
            if tp.get("multiplePieces"):
                # frameName is only one fragment; assemble every piece.
                sprite_img = extract_multiplepieces(tp)
            elif tile in ANIMATION_OVER_BASE:
                # frameName is only the part that stands still; bake the orbit on.
                sprite_img = extract_animated_over_base(tp)
            else:
                fl, fn = tp.get("frameList"), tp.get("frameName")
                if fl and fn:
                    sprite_img = extract_from_atlas(fl, fn)
            # Some ordinary decor and Epic rewards use loose sprites (occasionally
            # one rectangle within a shared sheet) rather than an atlas frame.
            # Without this fallback named quest items such as Gravestone, Heart
            # Gravestone, and the Cupid Statues silently disappear from the market.
            # An animated tile can REST on an empty frame; use its first drawn
            # animation frame rather than shipping an invisible object.
            if is_blank(sprite_img) and tp.get("animationDictionaries"):
                sprite_img = extract_first_animated_frame(tp) or sprite_img
            if is_blank(sprite_img) and tp.get("spriteSheet"):
                loose = image(tp["spriteSheet"])
                if loose is not None:
                    sprite_img = loose.copy()
                    fw, fh = tp.get("width"), tp.get("height")
                    fx, fy = int(tp.get("x") or 0), int(tp.get("y") or 0)
                    if fw and fh and (fx > 0 or fy > 0 or
                                      int(fw) < sprite_img.width or int(fh) < sprite_img.height):
                        sprite_img = sprite_img.crop((fx, fy, fx + int(fw), fy + int(fh)))
        else:  # functional: prefer the full-size in-world sprite from
            # TileProperties (a standalone tex10xx.png); the market icon is tiny
            # and would look pixelated placed on the farm.
            sprite_img = loose_sprite(tp, tp.get("spriteSheet") or e.get("spriteSheet"))

        if is_blank(sprite_img):
            skipped += 1
            skipped_keys.append(key)
            continue
        out_name = emit_sprite(key, sprite_img)
        # A tile's childNodes ship as a SECOND image drawn behind it (Pet Pen far wall).
        back_img = extract_child_layer(tp)
        back_name = "" if is_blank(back_img) else emit_sprite(f"{key}_back", back_img)
        seen.add(tile)
        counts[category] += 1
        # Fruit-tree growing-state sprite (saved as <tile>_growing.png).
        growing_name = ""
        if growing_img is not None:
            growing_name = f"{tile}_growing.png"
            growing_img.save(os.path.join(OBJDIR, growing_name))
        # Storage sheds encode their capacity in the TileProperties toolTip.
        slots = 0
        m = re.search(r"(\d+)\s*slots", tp.get("toolTip", ""))
        if m:
            slots = int(m.group(1))
        # Reward-only decor is never sold: no price, no level gate, no purchase XP.
        reward_only = is_reward_only(tile)
        row = {
            "key": key,
            "name": e["name"],
            "category": category,
            # Theme label; absent means evergreen. `seasonal` is DERIVED from it and
            # kept for the existing market sort until that reads `theme` directly.
            **({"theme": THEME_OF_TILE[tile], "seasonal": True}
               if tile in THEME_OF_TILE else {}),
            **market_economics(e, key, tile, reward_only,
                               bool(e.get("brainsNeeded", False)), category),
            # Authentic sprite tint (see market_tint): for greyscale art this is the
            # item's ONLY source of colour, and it is what tells the five monoliths —
            # one shared tex1009.png — apart.
            **({"color": market_tint(e)} if market_tint(e) else {}),
            # Whole tiles only: the game reads these via integerValue (truncates),
            # so coerce any fractional footprint (e.g. coolerLarge 1.5) to an int.
            "tileW": max(1, int(tp.get("tileWidth", 1))),
            "tileH": max(1, int(tp.get("tileHeight", 1))),
            "movable": bool(tp.get("movable", True)),
            "rotations": tp.get("rotations", 1),
            # Art with writing on it: Rotate is a mirror, so it would read backwards.
            **({"noMirror": True} if tile in NO_MIRROR_TILES else {}),
            "sprite": out_name,
            # Far-side art drawn BEHIND anything standing inside this object.
            **({"backSprite": back_name} if back_name else {}),
            # Working-state art (Zombie Pot: lid on while cooking, arm out when done).
            **state_sprites(tileprops, tile),
            "nativeW": sprite_img.width,
            "nativeH": sprite_img.height,
            "pivotX": tp.get("pivotx", 0.5),
            "pivotY": tp.get("pivoty", 0.0),
            # Ground-hugging art (roads, ponds, the zombie patch) that has to line
            # up seam-to-seam with its neighbours, so it is anchored by its authored
            # pivot rather than bottom-centered. See flat_tile_fields.
            **flat_tile_fields(tp, sprite_img),
            # simple functional effects the game can apply on placement
            "armyMax": e.get("increaseArmyMaxBy", 0),
            "storageSlots": slots,  # >0 for storage sheds (item capacity)
            # >0 for the Mausoleum (zombie storage slots). The base tier's value is
            # a design number, not a source one; see MAUSOLEUM_TIERS below.
            "zombieSlots": MAUSOLEUM_BASE_SLOTS if tile == "mausoleum3" else 0,
            # Pet Pen: tapping it opens the authoritative cosmetic collection.
            **({"petPen": True} if tile == "pettingZoo" else {}),
            # fruit trees: repeatable harvest (regrows fruit for gold)
            "growMs": (e.get("growTime", 0) or 0) * 1000 if category == "tree" else 0,
            "harvestValue": e.get("price", 0) if category == "tree" else 0,
            "growingSprite": growing_name,
            # Signature audio played when this decor is tapped on the farm. Omit
            # empty values so the generated catalog stays compact.
            **({"tapSound": tp.get("tapSoundEffect") or tp.get("soundID")}
               if tp.get("tapSoundEffect") or tp.get("soundID") else {}),
        }
        catalog.append(row)
        # Recolors of this tile clone the row above and override name/color.
        base_row[tile] = row
        base_img[tile] = sprite_img
        signatures[tile] = {(e["name"], tuple(market_tint(e) or ()))}

    # ---- Raid-reward decorations (Phase 6) ----------------------------------
    # Loot drops that are NOT sold in the market but ARE placeable farm decor.
    # Each drop's `tile` points at a TileProperties entry that supplies the same
    # footprint + sprite market decor/functional items use, so we reuse the exact
    # extraction paths here. Emitted as category "reward": excluded from the buy
    # menu (ITEM_CAT has no "reward"), placed for free from the Received tab.
    drops = json.load(open(os.path.join(GAMEPLAY, "Drops.json"), encoding="utf-8"))
    reward_count = 0
    reward_skipped = []
    for name, info in drops.items():
        if info.get("dontAddToStorage"):
            continue  # currency (10 Brains / Bonus Gold) — never placeable
        tile = info.get("tile")
        if not tile or tile in seen:
            continue  # boosts have no tile; `seen` = tiles already emitted (market)
        tp = tileprops.get(tile)
        if not tp:
            continue

        sprite_img = None
        if tp.get("multiplePieces"):
            sprite_img = extract_multiplepieces(tp)
        elif tp.get("frameList") and tp.get("frameName"):
            sprite_img = extract_from_atlas(tp["frameList"], tp["frameName"])
        else:
            ss = tp.get("spriteSheet")
            if ss:
                sprite_img = image(ss)
                if sprite_img is not None:
                    sprite_img = sprite_img.copy()
                    # Some tiles are one sub-rect of a shared sheet (e.g. every
                    # faction banner lives in tex1046.png) — crop to this tile.
                    fw, fh = tp.get("width"), tp.get("height")
                    fx, fy = int(tp.get("x") or 0), int(tp.get("y") or 0)
                    if fw and fh and (fx > 0 or fy > 0):
                        sprite_img = sprite_img.crop((fx, fy, fx + int(fw), fy + int(fh)))

        if is_blank(sprite_img):
            reward_skipped.append(name)
            continue

        out_name = emit_sprite(tile, sprite_img)
        seen.add(tile)
        reward_count += 1
        catalog.append({
            "key": tile,
            "name": name,  # drops are keyed by display name; Received matches on it
            "category": "reward",
            "cost": 0,
            "level": -1,  # always unlocked — it's an earned reward, not a purchase
            "xp": 0,
            "brainsNeeded": False,
            # Whole tiles only: the game reads these via integerValue (truncates),
            # so coerce any fractional footprint (e.g. coolerLarge 1.5) to an int.
            "tileW": max(1, int(tp.get("tileWidth", 1))),
            "tileH": max(1, int(tp.get("tileHeight", 1))),
            "movable": bool(tp.get("movable", True)),
            "rotations": tp.get("rotations", 1),
            # Art with writing on it: Rotate is a mirror, so it would read backwards.
            **({"noMirror": True} if tile in NO_MIRROR_TILES else {}),
            "sprite": out_name,
            "nativeW": sprite_img.width,
            "nativeH": sprite_img.height,
            "pivotX": tp.get("pivotx", 0.5),
            "pivotY": tp.get("pivoty", 0.0),
            # Ground-hugging art (roads, ponds, the zombie patch) that has to line
            # up seam-to-seam with its neighbours, so it is anchored by its authored
            # pivot rather than bottom-centered. See flat_tile_fields.
            **flat_tile_fields(tp, sprite_img),
            "armyMax": 0,
            "storageSlots": 0,
            "zombieSlots": 0,
            "growMs": 0,
            "harvestValue": 0,
            "growingSprite": "",
            **({"tapSound": tp.get("tapSoundEffect") or tp.get("soundID")}
               if tp.get("tapSoundEffect") or tp.get("soundID") else {}),
        })

    # Design override (not in the source data): the Zombie Pot's first purchase is
    # 500 gold (the shown price). Additional pots cost 30 brains — that dual pricing
    # is applied at placement (see main.ts tryPlaceObject).
    tree_balance = {
        "oliveTreeOlive": {"level": 5},
        "fruitTreeLemon": {"harvestValue": 35},
        "fruitTreeOrange": {"harvestValue": 18},
    }
    for c in catalog:
        c.update(tree_balance.get(c["key"], {}))
        if c["key"] == "zombieCombiner":
            c["cost"] = 500
            c["brainsNeeded"] = False
            # The override replaces the price AFTER the loop above computed xp from
            # the source row, so re-apply the game's own floor(cost / 100) rule to
            # the price actually charged (500 gold -> 5 xp, not the source's 500).
            c["xp"] = c["cost"] // 100

    # Mausoleum upgrade tiers: clones of the base row (same sprite/footprint) that
    # the Market offers one at a time above the placed building's capacity.
    base_mausoleum = next((c for c in catalog if c["key"] == "mausoleum3"), None)
    if base_mausoleum:
        for key, name, cost, slots in MAUSOLEUM_TIERS:
            tier = dict(base_mausoleum)
            tier.update({"key": key, "name": name, "cost": cost, "zombieSlots": slots})
            catalog.append(tier)

    # Storage sheds above the source's top rung: clones of the biggest source shed
    # (same sprite/footprint) that the Market offers one at a time above the placed
    # shed's capacity, exactly like the Mausoleum ladder above.
    base_shed = next((c for c in catalog if c["key"] == EXTRA_SHED_BASE), None)
    if base_shed:
        for key, name, cost, slots in EXTRA_SHED_TIERS:
            tier = dict(base_shed)
            tier.update({"key": key, "name": name, "cost": cost,
                         "xp": cost // 100, "storageSlots": slots})
            catalog.append(tier)

    # Memorial Statue: a reimplementation addition with no source row, whose art is
    # cut from the Tim Statue's plinth. Built AFTER the loop above so its source
    # sprite is already in OBJDIR, and BEFORE the orphan sweep so its own PNG counts
    # as referenced. See tools/memorial_statue.py.
    catalog.append(memorial_statue.build(OBJDIR))

    # Art drawn for this project rather than extracted from the source atlases, so
    # it has neither a Market row nor an atlas frame — both halves are authored in
    # tools/contributed_art.py. Appended here for the same reason as the Memorial
    # Statue: before the orphan sweep, so its PNGs count as referenced.
    catalog.extend(contributed_art.build(OBJDIR))

    catalog.sort(key=lambda c: (c["category"], c["level"], c["cost"]))

    # public/assets/objects/ is entirely generated, so anything the catalog no
    # longer references is stale — a rename, a dropped item, or (since emit_sprite)
    # a duplicate that now shares another key's file. Leaving them behind makes the
    # directory look like it still holds art the game can reach.
    referenced = {c["sprite"] for c in catalog} | {
        c["growingSprite"] for c in catalog if c["growingSprite"]} | {
        c["backSprite"] for c in catalog if c.get("backSprite")} | {
        c[field] for c in catalog for _, field in STATE_SPRITE_TILES if c.get(field)}
    orphans = sorted(f for f in os.listdir(OBJDIR)
                     if f.endswith(".png") and f not in referenced)
    for f in orphans:
        os.remove(os.path.join(OBJDIR, f))

    with open(os.path.join(OUT, "placeables.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=1)
    print(f"placeables: {len(catalog)} objects -> {counts} "
          f"+ {reward_count} reward decor (skipped {skipped} market, "
          f"{len(reward_skipped)} reward w/o art)")
    if skipped_keys:
        print(f"  no art (dropped): {', '.join(skipped_keys)}")
    if reward_skipped:
        print(f"  reward w/o art: {', '.join(reward_skipped)}")
    tinted = sum(1 for c in catalog if c.get("color"))
    shared = len(catalog) - len({c["sprite"] for c in catalog})
    print(f"  {tinted} tinted rows, {shared} rows sharing another key's sprite, "
          f"{variant_count} recolor variants")
    if orphans:
        print(f"  removed {len(orphans)} stale png: {', '.join(orphans)}")


if __name__ == "__main__":
    main()
