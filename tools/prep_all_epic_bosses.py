#!/usr/bin/env python3
"""Prepare every recoverable Epic Boss asset family for the web runtime.

Bosses 1-5 use the authored EpicEventEnemy animation lists. EPB 8-10 shipped
without those definitions or atlas metadata, so they intentionally use their
revealed intro art as a static combat actor while preserving their raw sheets in
the output for future frame reconstruction.
"""
from __future__ import annotations

import json
import plistlib
import re
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
EXTRACTED = (ROOT / ".." / "ZF2R_extracted").resolve()
APP = EXTRACTED / "raw" / "ios-1.0" / "1.0" / "Payload" / "ZF2R.app"
GAMEPLAY = EXTRACTED / "data" / "json" / "gameplay"
OUT_ROOT = ROOT / "public" / "assets" / "epic-bosses"
RECT = re.compile(r"\{\{\s*(-?\d+),\s*(-?\d+)\s*\},\s*\{\s*(\d+),\s*(\d+)\s*\}\}")
SIZE = re.compile(r"\{\s*(\d+),\s*(\d+)\s*\}")
POINT = re.compile(r"\{\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\}")

SLUGS = {
    1: "dr-groundhog",
    2: "loco-locust",
    3: "bully-frog",
    4: "foul-owl",
    5: "skunkarella",
}
QUEST_ICONS = {
    1: "questicon_drgroundhog.png",
    2: "questicon_locolocust.png",
    3: "questicon_bullyfrog.png",
    4: "Icon_Quest_FoulOwl.png",
    5: "questIcon_EP_Boss7.png",
}
# Every event runs 10 rungs, PAIR-COMPRESSED from the 20 HP multipliers ZF2 authored
# (EpicBossHP.json LevelMultiplier) — see multipliers() for why, and for the measurements.
# Total ladder HP is unchanged; there are simply half as many fights to divide it into.
#
# Two earlier cuts led here. The bosses that advertised 40 rungs were getting levels 21-40
# padded with a copy of level 20's multiplier, so the back half of those ladders was 20
# more fights that never got any harder — that padding went first. What remained was 20
# real rungs whose bottom half any competent army one-shots, and a rung costs an attempt
# however far you overkill it; merging pairs is what removes that floor.
#
# Everything keyed to a rung follows: loot thresholds (scale_loot_levels), quest
# thresholds and the two pinned prize rungs (prep_quests.py), and the brain/gold schedule
# (src/epicBoss/rewards.ts).
MAX_LEVEL = 10
# The authored curve's own length. Dr. Groundhog placed its loot against this; the other
# bosses used SOURCE_MAX_LEVEL. Both are rescaled onto MAX_LEVEL.
AUTHORED_MAX_LEVEL = 20
# What the 40-rung bosses used to advertise. Only used to rescale the loot/quest
# thresholds that were authored against it.
SOURCE_MAX_LEVEL = 40
MAX_LEVELS = {1: MAX_LEVEL, 2: MAX_LEVEL, 3: MAX_LEVEL, 4: MAX_LEVEL, 5: MAX_LEVEL}
QUEST_IDS = {
    1: ["1000", "1001", "1002", "1003", "1010", "1011"],
    2: ["2000", "2001", "2002", "2003", "2004", "2005", "2006", "2010", "2011"],
    # The shipped Bully Frog row incorrectly reuses Groundhog IDs for its middle
    # milestones. Keep only its unambiguous, boss-prefixed quest records.
    3: ["3000", "3010", "3011"],
    4: ["4000", "4001", "4002", "4003", "4004", "4005", "4006", "4010", "4011"],
    5: ["5000", "5011"],
}
SKUNK_LOOT = [
    {"level": 3, "name": "Skunkarella's Perfume", "tile": "perfumeVat", "sprite": "Perfume_Vat.png"},
    {"level": 5, "name": "Skunkarella's Scarecrow", "tile": "fashionableScarecrow", "sprite": "Fashionable_Scarecrow.png"},
    {"level": 8, "name": "Skunkarella's Mirror", "tile": "evilMirror", "sprite": "Fancy_Evil_Mirror.png"},
    {"level": 10, "name": "Skunkarella's Gravestone", "tile": "bedazzledGravestone", "sprite": "blingn_Gravestone.png"},
    {"level": 13, "name": "Skunkarella's Fountain", "tile": "fancyFountain", "sprite": "fancyChocoFountain_default.png"},
    {"level": 15, "name": "Skunkarella's Gazebo", "tile": "crystalGazebo", "sprite": "Crystal_Gazebo.png"},
    {"level": 18, "name": "Skunkarella's Car", "tile": "diamondCar", "sprite": "Diamond_Car.png"},
    {"level": 19, "name": "Skunkarella's Home", "tile": "jewelHome", "sprite": "Jewel_Home.png"},
    {"level": 20, "name": "Tame Skunk", "stageActor": "skunkPetActor", "sprite": "skunkPet_default.png"},
]

LATE_BOSSES = [
    {
        "id": "rocky-rhino", "sourceId": 8, "name": "Rocky Rhino",
        "questIds": ["8000"],
        "sheet": "rockyRhino_default.png", "portrait": "epb8_portrait_intro.png",
        "lootIcon": "epb8_loot_icon.png", "questIcon": "epb8_quest_icon.png",
        "intros": ["epb8_INTRO1.png", "epb8_INTRO2.png", "epb8_INTRO3.png"],
        "support": ["EPB8_BANNER1.png", "EPB8_CAVE.png", "ROCKY_RHINO_GONG.png",
                    "Rocky_Beetle.png", "EPB_8_Banner_MarketItems.png",
                    "Rocky_Cave_Icon_MarketItems.png", "GONG_ROCKY_RHINO_Icon_MarketItems.png",
                    "Rocky_Beetle_MarketIcons.png", "rockyRhinoPet_default.png",
                    "rockyRhinoPet_default.plist", "rockyrhinogong.mp3"],
        "loot": [
            (5, "Rocky Rhino's Banner", "rockyRhinosBanner", "EPB8_BANNER1.png", None),
            (10, "Rocky Rhino's Cave", "rockyRhinosCave", "EPB8_CAVE.png", None),
            (15, "Rocky Rhino's Gong", "rockyRhinosGong", "ROCKY_RHINO_GONG.png", None),
            (18, "Rocky Rhino's Sculpture", "rockyRhinosSculpture", "Rocky_Beetle.png", None),
            (20, "Tame Rhino", None, "rockyRhinoPet_default.png", "rockyRhinoPetActor"),
        ],
    },
    {
        "id": "general-larvaelus", "sourceId": 9, "name": "General Larvaelus",
        "questIds": ["9000", "9011"],
        "sheet": "generalLarvaelus_default.png", "portrait": "EpicBoss9_PORTRAIT_INTRO.png",
        "lootIcon": "EpicBoss9_LOOT_ICON.png", "questIcon": "EpicBoss9_QUEST_ICON.png",
        "intros": ["EpicBoss9_INTRO1.png", "EpicBoss9_INTRO2.png", "EpicBoss9_INTRO3.png"],
        "support": ["EPB_9_Banner.png", "EPB_9Teleporter_A.png", "EPB_9Teleporter_B.png",
                    "teleporter_default.png", "teleporter_default.plist", "EPB_9_Teleporter_PRTCLE.plist",
                    "Icon_MarketItems_EPB_9_BANNER.png", "Icon_MarketItems_EPB9_A_TELEPORTER.png",
                    "Icon_MarketItems_EPB9_B_TELEPORTER.png", "Icon_MarketItems_EPB9_MAIN_TELEPORTER.png",
                    "generalLarvaelusPet_default.png", "generalLarvaelusPet_default.plist"],
        "loot": [
            (5, "General Larvaelus' Banner", "generalLarvaelusBanner", "EPB_9_Banner.png", None),
            (10, "General Larvaelus' Blue Portal", "generalLarvaelusTeleporterA", "EPB_9Teleporter_A.png", None),
            (15, "General Larvaelus' Red Portal", "generalLarvaelusTeleporterB", "EPB_9Teleporter_B.png", None),
            (18, "General Larvaelus' Portal", "teleporter", "teleporter_default.png", None),
            (20, "Tame Larva", None, "generalLarvaelusPet_default.png", "generalLarvaelusPetActor"),
        ],
    },
    {
        "id": "mystical-mamba", "sourceId": 10, "name": "Mystical Mamba",
        "questIds": ["10000", "10011"],
        "sheet": "mysticalMamba_default.png", "portrait": "EPB_10_portrait_intro.png",
        "lootIcon": "EPB_10_loot_Icon.png", "questIcon": "EPB_10_Quest_Icon.png",
        "intros": ["EPB_10_INTRO_1.png", "EPB_10_INTRO_2.png", "EPB_10_INTRO_3.png"],
        "support": ["EPB_10_IPHONE_ns_icon.png", "EPB_10_BANNER.png",
                    "EPB_10_BANNER_Icon_MarketItems.png", "zomtarMachine_default.png",
                    "zomtarMachine_default.plist", "ZOMTAR_machine_Icon_MarketItems.png",
                    "ZOMTAR_EPB10_default.png", "ZOMTAR_EPB10_default.plist",
                    "ZOMTAR_PARTICLE.plist", "tameMamba_default.png", "tameMamba_default.plist"],
        "loot": [
            (8, "Mystical Mamba Banner", "mysticalMambaBanner", "EPB_10_BANNER.png", None),
            (15, "Mystical Mamba's Wish Machine", "mysticalMambasWishMachineLeft", "zomtarMachine_default.png", None),
            (20, "Tame Mamba", None, "tameMamba_default.png", "tameMamba"),
        ],
    },
]


def compose(sheet: Image.Image, frame: dict) -> Image.Image:
    if frame.get("textureRotated"):
        raise ValueError("rotated Epic Boss frames are unsupported")
    rect = RECT.fullmatch(frame["textureRect"])
    if not rect:
        raise ValueError(f"bad textureRect: {frame['textureRect']!r}")
    x, y, w, h = map(int, rect.groups())
    source = SIZE.fullmatch(frame.get("spriteSourceSize", f"{{{w},{h}}}"))
    offset = POINT.fullmatch(frame.get("spriteOffset", "{0,0}"))
    if not source or not offset:
        raise ValueError("bad source size/offset")
    sw, sh = map(int, source.groups())
    ox, oy = map(float, offset.groups())
    canvas = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    canvas.alpha_composite(sheet.crop((x, y, x + w, y + h)),
                           (round((sw - w) / 2 + ox), round((sh - h) / 2 - oy)))
    return canvas


def write_strip(out: Path, name: str, names: list[str], frames: dict, sheet: Image.Image) -> dict:
    images = [compose(sheet, frames[frame]) for frame in names]
    cell_w = max(image.width for image in images)
    cell_h = max(image.height for image in images)
    strip = Image.new("RGBA", (cell_w * len(images), cell_h), (0, 0, 0, 0))
    for index, image in enumerate(images):
        strip.alpha_composite(image, (index * cell_w + (cell_w - image.width) // 2,
                                      cell_h - image.height))
    filename = f"{name}.png"
    strip.save(out / filename, optimize=True)
    return {"file": filename, "cellWidth": cell_w, "cellHeight": cell_h,
            "frameCount": len(images), "frameSeconds": 1 / 12}


def copy(out: Path, source: str, target: str | None = None) -> str | None:
    src = APP / source
    if not src.is_file():
        print(f"warning: missing {source}")
        return None
    name = target or source
    shutil.copy2(src, out / name)
    return name


def multipliers(raw: list[float], max_level: int) -> list[float]:
    """The HP curve for a `max_level`-rung ladder, PAIR-COMPRESSED from the authored one.

    ZF2 authored 20 multipliers. Each rung here is two of them added together, so ten
    rungs carry exactly the HP the twenty did (645x baseHp either way) — the ladder is
    re-cut, not shortened.

    WHY. A rung costs at least one attempt however far you overkill it, and the bottom
    half of the authored curve is tiny next to any real army's damage: nine of the first
    twenty rungs were one-attempt formalities for a starter party and all twenty were for
    a maxed one. Merging pairs deletes that floor without touching the part of the ladder
    where HP genuinely gates progress, because the merged rung costs the sum of what its
    two halves cost. Measured, a full clear goes 52 -> 47 attempts for a starter party,
    29 -> 21 for a solid one, and 20 -> 10 for a maxed one: all of the saving lands where
    the fights were formalities and none of it where they were not.

    The odd tail case (an authored curve of odd length) keeps its last rung uncompressed
    rather than pairing it with nothing; no shipped boss hits it, since all eight use the
    same 20-value curve.
    """
    want = max_level * 2
    src = raw[:want] + [raw[-1]] * max(0, want - len(raw))
    return [round(sum(src[i:i + 2]), 4) for i in range(0, len(src), 2)]


# ---- Per-boss damage ramp -------------------------------------------------
# Every epic boss shipped dealing exactly 40 DPS (str 2 / dex 2, or Skunkarella's
# str 1 / dex 4 — the same rate with faster, smaller hits), at every level of every
# ladder. Boss HP scales, boss damage never did, so the eight events were identical
# in threat and differed only in how many attempts they took.
#
# HP is the wrong difficulty knob here: a fight is capped at 30 s and damage carries
# over between attempts, so more HP buys only more attempts, and each attempt costs a
# harvest token or a brain. That is grind, not difficulty. Incoming damage is the one
# lever that raises the bar without adding a single attempt.
#
# So damage ramps with the boss's unlock level (see src/epicBoss/catalog.ts
# EPIC_BOSS_UNLOCK_LEVELS). `dex` is deliberately untouched — it is each boss's
# hit-rhythm character, and Skunkarella's fast small hits are its signature.
#
# CALIBRATION: measured in BattleSim with the fight PLAYED CORRECTLY (brain bubbles
# released), not modelled. Two properties break any closed-form estimate:
#   * only a handful of zombies are engaged at once, so a 20-strong army does not bring
#     20 zombies' worth of damage and incoming damage concentrates on the front slot;
#   * a level takes many attempts and damage carries over, so nearly every attempt runs
#     the full 30 s. Casualties are permanent and a full clear is 40+ attempts, so a boss
#     that can kill the front unit kills one PER ATTEMPT, not one per level.
# THE RAMP IS FITTED TO ONE QUESTION: does a level-appropriate best-mutated HEADLESS wall
# survive the event with two level-appropriate healers behind it, and does it struggle
# without them? Measured, the unaided wall's death line sits at 100 DPS, so the ladder is
# built to CROSS that line partway up:
#
#                       str   dex   DPS   with 2 healers   unaided
#   Dr. Groundhog      2.400   2     48      100% HP       alive, 48%
#   Bully Frog         3.000   2     60      100% HP       alive, 36%
#   Rocky Rhino        3.600   2     72      100% HP       alive, 23%
#   General Larvaelus  4.200   2     84      100% HP       alive, 17%
#   Mystical Mamba     4.800   2     96      100% HP       DEAD
#   Foul Owl           5.500   2    110      100% HP       DEAD
#   Skunkarella        3.125   4    125      100% HP       DEAD   (dex carries its rung)
#   Loco Locust        7.000   2    140      100% HP       DEAD
#
# That crossing is the design. The first four events can be brute-forced by a wall alone,
# on a margin that visibly narrows; from Mystical Mamba (level 34) up, an army that brings
# nothing but damage loses its front-liner every attempt, and casualties are permanent. It
# is the ramp's job to make bringing support a real decision rather than a nicety, and a
# ladder that sat entirely below the death line — as the previous fit did — could not.
#
# What it is NOT fitted to: how many of the 46 obtainable specials can hold the front slot.
# That was the old metric and it measured one zombie's HP, not what a player can field.
# The current rule lives in src/epicBoss/combat.test.ts and is stated on the ARMY: Silver-
# grade for events unlocking through 30, specials from 30-35, epic prizes and specials
# above that. Raising the ramp past ~200 DPS starts to threaten even the SUPPORTED wall
# (measured: it holds to 240 and dies at 800), which is the real ceiling here.
#
# THESE ARE RUNG-1 VALUES, NOT THE WHOLE LADDER. Damage compounds 5% for every rung
# climbed (epicBossDamage in src/epicBoss/catalog.ts, raid ruleset v29), so the DPS noted
# against each boss is what its FIRST fight deals and the tenth deals 1.55x that. The
# entry fight of every event is therefore exactly what it was; only the deep rungs moved.
# Rung-10 DPS runs 74 (Dr. Groundhog) to 217 (Loco Locust).
EPIC_BOSS_DAMAGE = {
    1: 2.4,     # Dr. Groundhog       48 DPS at rung 1 ->  74 at rung 10
    2: 7.0,     # Loco Locust        140 DPS at rung 1 -> 217 at rung 10
    3: 3.0,     # Bully Frog          60 DPS at rung 1 ->  93 at rung 10
    4: 5.5,     # Foul Owl           110 DPS at rung 1 -> 171 at rung 10
    5: 3.125,   # Skunkarella        125 DPS at rung 1 -> 194 at rung 10 (dex 4)
    8: 3.6,     # Rocky Rhino         72 DPS at rung 1 -> 112 at rung 10
    9: 4.2,     # General Larvaelus   84 DPS at rung 1 -> 130 at rung 10
    10: 4.8,    # Mystical Mamba      96 DPS at rung 1 -> 149 at rung 10
}


def ramp_damage(unit_stats: dict, source_id: int) -> dict:
    """Apply this boss's authored attack power from EPIC_BOSS_DAMAGE.

    Returns a copy — the caller's source dict is left alone. Raises if the boss has
    no entry, so a newly added event has to make a deliberate difficulty choice
    rather than silently inheriting the flat 40 DPS every boss used to share.
    """
    if source_id not in EPIC_BOSS_DAMAGE:
        raise SystemExit(f"epic boss {source_id} has no EPIC_BOSS_DAMAGE entry")
    return {**unit_stats, "str": EPIC_BOSS_DAMAGE[source_id]}


def scale_loot_levels(loot: list[dict], origin: int) -> list[dict]:
    """Move loot thresholds authored against an `origin`-rung ladder onto MAX_LEVEL.

    THREE source scales are in play and all of them need this: Dr. Groundhog's source loot
    sits on the authored 20 rungs, the other shipped bosses' on 40, and the hand-restored
    tables in this file (SKUNK_LOOT, LATE_BOSSES) were written against 20. Rescaling from
    the right origin keeps each prize at the same FRACTION of its ladder it always had, and
    on the same rung as the quest that announces it (prep_quests.py applies the matching
    transform, including the same pinning of the two headline prizes).

    Rounded UP, and floored at rung 1: quartering a 40-rung threshold can otherwise produce
    a rung 0 that no clear ever satisfies, which would strand the prize behind it.
    """
    return [{**item, "level": max(1, -(-int(item["level"]) * MAX_LEVEL // origin))}
            for item in loot]


# The attempt window, overriding the source's 30 s (`epicBossFightTimeBeforeFleeing`).
#
# WHY THIS IS NOT THE SOURCE VALUE. Zombies enter the fight strictly one at a time, one
# every CHARGE_MS (3.6 s), so the window decides how much of the army ever reaches the
# boss at all: 6 zombies get there in 30 s, 10 in 45 s, 13 in 60 s, all 20 by 90 s. That
# makes damage per attempt STRONGLY super-linear in the window — measured, 30 s -> 60 s is
# about 4x, not 2x — and it is why a 20-rung ladder took 304 attempts at 30 s for an
# ordinary army. The event read as a grind rather than a fight.
#
# 60 s, and it should be read together with the pair-compressed ladder and the per-boss
# damage ramp — the three landed as one change:
#   * GRIND. Attempts fall to between a quarter and a third at every army tier: a moderate
#     army goes 304 -> 64 and a best army 52 -> 14, against a hard floor of 10 (one attempt
#     per rung, however far you overkill it).
#   * CASUALTIES. The extra time is spent on the front slot, which is what finally makes
#     the damage ramp visible at all. Before this, a full clear killed NOTHING at any tier;
#     a moderate army now loses 0.9-1.8 zombies per attempt up the ladder.
#   * WHY DAMAGE IS NOT THE GRIND DIAL. Boss damage is regressive — doubling it costs a
#     best army 3 extra attempts on a full ladder and DOUBLES a moderate army's. Past about
#     x4 the boss kills the queue faster than the queue deals damage and a moderate army is
#     worse off than the 30 s window left it. Hence a ramp at x1 with per-boss variation
#     rather than a global multiplier (EPIC_BOSS_DAMAGE), and hence HP — not damage — as the
#     per-event grind dial (EPIC_BOSS_BASE_HP).
#
# The bounding rule lives in src/epicBoss/combat.test.ts — a level-appropriate best-mutated
# headless survives its event with two level-appropriate healers. It passes here with real
# margin (the tank survives every boss even unsupported), so the window is not pressed
# against its limit.
EPIC_BOSS_FIGHT_MS = 60_000

# What activating an event costs, in brains. The source charged 100; post-brainflation-
# revert a brain is worth ~10x what it was, so these are revert-scaled prices and NOT the
# source's. (The catalogs on disk had already drifted from this generator — 5 and 10
# against the 100 that used to be here — so the numbers now live in the tool.)
#
# Banded by position on the unlock ladder rather than set flat: the two entry events cost
# 3, the four middle ones 4, the two hardest 5. Brain income barely moves across the game
# by design (~1.6/day at level 4 to ~2.9/day at 44), so a flat price would mean the entry
# event and the endgame event cost the same share of a very slowly growing budget. The
# band is keyed by SOURCE ID here and annotated with the unlock level it corresponds to —
# the two orders are not the same, so read the comments rather than the keys.
EPIC_BOSS_COST_BRAINS = {
    1: 3,     # Dr. Groundhog      unlock 24
    3: 3,     # Bully Frog         unlock 28
    8: 4,     # Rocky Rhino        unlock 30
    9: 4,     # General Larvaelus  unlock 32
    10: 4,    # Mystical Mamba     unlock 34
    4: 4,     # Foul Owl           unlock 38
    5: 5,     # Skunkarella        unlock 40
    2: 5,     # Loco Locust        unlock 42
}


def cost_brains(source_id: int) -> int:
    """This event's activation price. Raises on an unknown boss so a newly added event
    has to make a deliberate pricing choice rather than inherit one silently."""
    if source_id not in EPIC_BOSS_COST_BRAINS:
        raise SystemExit(f"epic boss {source_id} has no EPIC_BOSS_COST_BRAINS entry")
    return EPIC_BOSS_COST_BRAINS[source_id]


# ---- Per-boss HP ---------------------------------------------------------
# Every event used to share one HP ladder — the source's BaseHP 2000 against the same
# multipliers — so all eight cost the same total damage to walk. Measured, that made the
# ENTRY event the grindiest: a moderate army needs 91 attempts on Dr. Groundhog against
# 63-64 on every boss above him. Nothing about the boss causes that. Total ladder HP is
# identical, so the only variable is the army of the day, and a level-24 roster deals about
# a third less damage than a level-30 one. The ladder was flat while the player was not.
#
# So baseHp now ramps with the unlock ladder, +/-25% end to end, symmetric about the two
# middle events (General Larvaelus and Mystical Mamba), which keep the source's 2000 and
# are therefore the fixed point everything else is stated against. The bottom comes down to
# meet the weak roster that fights it; the top goes up because a level-42 army has three
# more zombie tiers, mutations and veterancy behind it than a level-24 one does.
#
# WHY baseHp AND NOT THE MULTIPLIERS. The multiplier curve is ZF2's authored SHAPE and is
# shared ground truth (see multipliers()); scaling it per boss would fork eight copies of
# recovered data to express one number. baseHp is the per-event dial the source already
# had. Rung HP stays baseHp x multiplier everywhere — src/epicBoss/catalog.ts epicBossHp,
# the Worker's clampRun, and migration 0052 all read it that way.
#
# Keyed by SOURCE ID, annotated with unlock level — the two orders differ, so read the
# comments. Values are round-50 so a rung's HP stays a legible number.
EPIC_BOSS_BASE_HP = {
    1: 1500,   # Dr. Groundhog      unlock 24   0.75x
    3: 1650,   # Bully Frog         unlock 28   0.825x
    8: 1850,   # Rocky Rhino        unlock 30   0.925x
    9: 2000,   # General Larvaelus  unlock 32   1.0x  <- source value
    10: 2000,  # Mystical Mamba     unlock 34   1.0x  <- source value
    4: 2150,   # Foul Owl           unlock 38   1.075x
    5: 2350,   # Skunkarella        unlock 40   1.175x
    2: 2500,   # Loco Locust        unlock 42   1.25x
}


def base_hp(source_id: int, source_value: int) -> int:
    """This event's baseHp. Raises on an unknown boss for the same reason the damage and
    brain-cost tables do: a new event must place itself on the ladder deliberately.

    `source_value` is ZF2's own BaseHP, passed in only to assert the fixed point — if the
    recovered data ever changes, the two middle events must move with it or this ramp is
    silently stated against a number that no longer exists."""
    if source_id not in EPIC_BOSS_BASE_HP:
        raise SystemExit(f"epic boss {source_id} has no EPIC_BOSS_BASE_HP entry")
    middle = [key for key, value in EPIC_BOSS_BASE_HP.items() if value == source_value]
    if sorted(middle) != [9, 10]:
        raise SystemExit(
            f"EPIC_BOSS_BASE_HP is anchored on the source BaseHP ({source_value}); expected "
            f"exactly bosses 9 and 10 to carry it, got {sorted(middle)}"
        )
    return EPIC_BOSS_BASE_HP[source_id]


def common_catalog(source_id: int, slug: str, name: str, max_level: int,
                   hp: dict, params: dict) -> dict:
    return {
        "id": slug, "sourceId": source_id, "name": name,
        "costBrains": cost_brains(source_id),
        "durationMs": 14 * 24 * 60 * 60 * 1000,
        "fightMs": EPIC_BOSS_FIGHT_MS,
        "retryMs": int(params["epicBossEscapeTime"]) * 60 * 1000,
        "encounterMs": int(params["epicBossAvailabilityTime"]) * 60 * 1000,
        "baseHp": base_hp(source_id, int(hp["BaseHP"])),
        "multipliers": multipliers(hp["LevelMultiplier"], max_level),
        "maxLevel": max_level,
        "music": "music.wav", "punchSfx": "punch.wav",
    }


def prepare_authored(boss: dict, hp: dict, params: dict) -> None:
    source_id = int(boss["epicBossID"])
    slug = SLUGS[source_id]
    out = OUT_ROOT / slug
    out.mkdir(parents=True, exist_ok=True)
    with (APP / boss["bossSpriteSheeetData"]).open("rb") as handle:
        atlas = plistlib.load(handle)["frames"]
    animations = {}
    with Image.open(APP / boss["bossSpriteSheeetImage"]).convert("RGBA") as sheet:
        for state in ("idle", "enter", "attack", "defeat", "escape", "fly"):
            names = boss.get(f"{state}Animation", {}).get("frames", [])
            if names:
                animations[state] = write_strip(out, state, names, atlas, sheet)
        compose(sheet, atlas[boss["initialFrame"]]).save(out / "boss.png", optimize=True)

    intro = boss["IntroMovieAssets"]
    mappings = [
        (boss["bossHeadPortrait"], "portrait.png"), (boss["enemyIcon"], "loot-icon.png"),
        (QUEST_ICONS[source_id], "quest-icon.png"), (intro["shadowed1"], "intro-1.png"),
        (intro["shadowed2"], "intro-2.png"), (intro["revealed"], "intro-3.png"),
        ("epicEventBGM.wav", "music.wav"), ("epicPunch.wav", "punch.wav"),
        ("epicEventIntroSFX.caf", "intro.caf"),
        (boss["bossSpriteSheeetImage"], "source-sheet.png"),
        (boss["bossSpriteSheeetData"], "source-sheet.plist"),
    ]
    copied = [x for source, target in mappings if (x := copy(out, source, target))]
    # Each table is rescaled from the rung count it was WRITTEN against: SKUNK_LOOT by
    # hand on the authored 20, Dr. Groundhog's source loot likewise, every other shipped
    # boss on the advertised 40.
    loot = (scale_loot_levels(SKUNK_LOOT, AUTHORED_MAX_LEVEL) if source_id == 5
            else scale_loot_levels(boss.get("loot", []),
                                   AUTHORED_MAX_LEVEL if source_id == 1 else SOURCE_MAX_LEVEL))
    for item in loot:
        if item.get("sprite"):
            copied_name = copy(out, item["sprite"])
            if copied_name:
                copied.append(copied_name)
        if item.get("stageActor"):
            plist = Path(item["sprite"]).with_suffix(".plist").name
            copied_name = copy(out, plist)
            if copied_name:
                copied.append(copied_name)

    layers = []
    for index, layer in enumerate(boss["levelAssets"]):
        target = f"background-{index + 1:02d}.png"
        copy(out, layer["sprite"], target)
        layers.append({**layer, "sprite": target})
    catalog = common_catalog(source_id, slug, boss["bossName"], MAX_LEVELS[source_id], hp, params)
    catalog.update({
        "introText": boss["introText"], "successText": boss["invasionSuccessText"],
        "failedText": boss["invasionFailedText"],
        "unitStats": ramp_damage(boss["UnitStats"], source_id),
        "animations": animations, "levelAssets": layers, "loot": loot,
        "questIds": QUEST_IDS[source_id],
        "portrait": "portrait.png", "lootIcon": "loot-icon.png", "questIcon": "quest-icon.png",
        "bossTexture": "boss.png", "reconstructed": False, "copied": sorted(set(copied)),
    })
    (out / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"prepared {boss['bossName']}: {len(animations)} animations")


def prepare_late(boss: dict, hp: dict, params: dict) -> None:
    out = OUT_ROOT / boss["id"]
    out.mkdir(parents=True, exist_ok=True)
    copied = []
    mappings = [
        (boss["portrait"], "portrait.png"), (boss["lootIcon"], "loot-icon.png"),
        (boss["questIcon"], "quest-icon.png"), (boss["intros"][0], "intro-1.png"),
        (boss["intros"][1], "intro-2.png"), (boss["intros"][2], "intro-3.png"),
        (boss["intros"][2], "boss.png"), (boss["sheet"], "source-sheet.png"),
        ("epicEventBGM.wav", "music.wav"), ("epicPunch.wav", "punch.wav"),
        ("epicEventIntroSFX.caf", "intro.caf"),
    ]
    for source, target in mappings:
        name = copy(out, source, target)
        if name:
            copied.append(name)
    for source in boss["support"]:
        name = copy(out, source)
        if name:
            copied.append(name)
    # Late definitions use the shared battle scene. Preserve its authored layer layout.
    layers = []
    for index in range(1, 13):
        target = f"background-{index:02d}.png"
        copy(out, f"bg_{index:02d}.png", target)
        layers.append({"anchor": "{0,0}", "position": "{0,0}",
                       "sprite": target, "z": index - 13})
    # LATE_BOSSES levels are hand-authored against the 20-rung ladder, so they rescale
    # exactly like every other table rather than being written straight through.
    loot = scale_loot_levels(
        [{"level": level, "name": name, "sprite": sprite,
          **({"tile": tile} if tile else {}), **({"stageActor": actor} if actor else {})}
         for level, name, tile, sprite, actor in boss["loot"]],
        AUTHORED_MAX_LEVEL)
    catalog = common_catalog(boss["sourceId"], boss["id"], boss["name"], MAX_LEVEL, hp, params)
    catalog.update({
        "introText": f"{boss['name']} is here",
        "successText": f"You beat {boss['name']}. They'll be back stronger than before!",
        "failedText": f"{boss['name']} beat you",
        "unitStats": ramp_damage(
            {"str": 2, "dex": 2, "con": 20,
             "attacks": [{"name": "EpicBossAttack", "frequency": 100}]}, boss["sourceId"]),
        "animations": {}, "levelAssets": layers, "loot": loot, "questIds": boss["questIds"],
        "portrait": "portrait.png", "lootIcon": "loot-icon.png", "questIcon": "quest-icon.png",
        "bossTexture": "boss.png", "reconstructed": True, "copied": sorted(set(copied)),
    })
    (out / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"prepared {boss['name']}: static reconstructed actor")


def main() -> None:
    enemies = json.loads((GAMEPLAY / "EpicEventEnemy.json").read_text(encoding="utf-8"))
    hp = json.loads((GAMEPLAY / "EpicBossHP.json").read_text(encoding="utf-8"))
    params = json.loads((GAMEPLAY / "gameplayParameters.json").read_text(encoding="utf-8"))
    for boss in sorted(enemies, key=lambda row: int(row["epicBossID"])):
        prepare_authored(boss, hp, params)
    for boss in LATE_BOSSES:
        prepare_late(boss, hp, params)


if __name__ == "__main__":
    main()
