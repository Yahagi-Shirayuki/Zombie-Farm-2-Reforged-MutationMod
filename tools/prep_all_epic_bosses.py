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
# Every event runs 20 levels, which is exactly as many HP multipliers as ZF2 authored
# (EpicBossHP.json LevelMultiplier). The bosses that used to advertise 40 were getting
# levels 21-40 padded with a copy of level 20's multiplier by multipliers() below, so the
# back half of those ladders was 20 more fights that never got any harder. Loot and quest
# thresholds are halved to match (see prep_quests.py EPIC_LADDER_SCALE).
MAX_LEVEL = 20
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
    """The HP curve for a `max_level`-rung ladder.

    The padding branch is kept for a hypothetical ladder longer than the authored
    curve, but no boss uses it any more: MAX_LEVEL is the authored length, so every
    ladder is now a straight truncation and the flat 107x tail is gone.
    """
    return raw[:max_level] + [raw[-1]] * max(0, max_level - len(raw))


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
# The ramp is therefore tuned by "how many of the 30 obtainable specials survive 30 s in
# the front slot", which narrows smoothly:
#
#   Dr. Groundhog      x1.00  str 2.00  dex 2   40 DPS   28/30 front-liners safe
#   Bully Frog         x1.20  str 2.40  dex 2   48 DPS   26/30
#   Rocky Rhino        x1.40  str 2.80  dex 2   56 DPS   26/30
#   General Larvaelus  x1.60  str 3.20  dex 2   64 DPS   23/30
#   Mystical Mamba     x1.80  str 3.60  dex 2   72 DPS   21/30
#   Foul Owl           x2.00  str 4.00  dex 2   80 DPS   21/30
#   Skunkarella        x2.25  str 2.25  dex 4   90 DPS   18/30  (from its str 1 base, NOT 2)
#   Loco Locust        x2.50  str 5.00  dex 2  100 DPS   15/30
#
# The cap is x2.5 on purpose. At x3 the top boss's own top prize (Vagabond Zombie, 2835 HP)
# can no longer tank its own event, which is perverse; at x2.5 every event's signature prize
# stays a legal front-liner, the Market-bought Headless wall (Bombie, 3267 HP) answers the
# whole ladder, and the thin damage-dealers (Zomtar/Zombug 1575, Zomdini 1260) cannot hold
# the line from General Larvaelus onward. src/epicBoss/combat.test.ts pins all of that and
# asserts x3 WOULD kill Vagabond, so raising the ramp fails loudly instead of silently.
EPIC_BOSS_DAMAGE = {
    1: 2.0,    # Dr. Groundhog     x1.00 (unchanged)
    2: 5.0,    # Loco Locust       x2.50
    3: 2.4,    # Bully Frog        x1.20
    4: 4.0,    # Foul Owl          x2.00
    5: 2.25,   # Skunkarella       x2.25 of its str 1 base
    8: 2.8,    # Rocky Rhino       x1.40
    9: 3.2,    # General Larvaelus x1.60
    10: 3.6,   # Mystical Mamba    x1.80
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


def scale_loot_levels(loot: list[dict], source_id: int) -> list[dict]:
    """Move a boss's loot thresholds onto the 20-rung ladder.

    Dr. Groundhog (source 1) was authored at 20 and is returned untouched. Every other
    shipped boss placed its loot across 40 rungs, so each threshold is halved (rounded
    up) — the same transform prep_quests.py applies to that boss's quest levels, which
    keeps a prize and the quest that announces it on the same rung.
    """
    if source_id == 1:
        return loot
    return [{**item, "level": -(-int(item["level"]) * MAX_LEVEL // SOURCE_MAX_LEVEL)}
            for item in loot]


def common_catalog(source_id: int, slug: str, name: str, max_level: int,
                   hp: dict, params: dict) -> dict:
    return {
        "id": slug, "sourceId": source_id, "name": name,
        "costBrains": 100, "durationMs": 14 * 24 * 60 * 60 * 1000,
        "fightMs": int(params["epicBossFightTimeBeforeFleeing"]) * 1000,
        "retryMs": int(params["epicBossEscapeTime"]) * 60 * 1000,
        "encounterMs": int(params["epicBossAvailabilityTime"]) * 60 * 1000,
        "baseHp": int(hp["BaseHP"]),
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
    # SKUNK_LOOT is already authored on the 20-rung scale; the source loot of the other
    # 40-rung bosses is not, so scale it the same way the quest thresholds are scaled.
    loot = SKUNK_LOOT if source_id == 5 else scale_loot_levels(boss.get("loot", []), source_id)
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
    loot = [{"level": level, "name": name, "sprite": sprite,
             **({"tile": tile} if tile else {}), **({"stageActor": actor} if actor else {})}
            for level, name, tile, sprite, actor in boss["loot"]]
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
