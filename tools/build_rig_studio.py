#!/usr/bin/env python3
"""Inline every raid-presentation asset into a standalone tools/rig_studio.html.

The Rig Studio is the one bench for everything the raid screen DRAWS: the paper-doll
rigs, the procedural animations that pose them, the Epic Bosses' authored frame strips,
the stage backgrounds those all stand in front of, and the ability effects that go off
over the top. It supersedes tools/sprite_assembler.html (whose rig editor it contains
verbatim, storage key and all) and hosts tools/tile_lab.html as a tab.

It has to work by double-clicking — no server, no build step at open time — and the rig
editor pixel-picks parts out of the art, which a file:// <img> would taint the canvas
for. So every asset rides in as a data URI:

  • enemy   — raids/enemies/models.json + each model's own parts/<key>.png strip,
              plus enemy_stats.json/attacks.json so a rig knows which ATTACK it swings
              and at what damageTiming (that is what the attack clip is fitted to)
  • zombie  — zombie/models.json + the shared ZombieSheet.png atlas + frames.json
  • stages  — every raid's levelAssets and the fightBG*/invasion* art they name, so a
              rig can be posed on the stage it actually fights on
  • epic    — all eight Epic Bosses: catalog.json's animations block, the six frame
              strips, and the fifteen parallax background layers each one authors
  • fx      — the four cocos2d particle configs the raid scene plays
  • tiles   — tools/tile_lab.html itself, served to an iframe off a blob: URL, so the
              flat-tile bench is a tab here without a second copy of its 1200 lines

Re-run after art, rig, or catalog changes so the tool opens fresh (or hot-load newer
files at runtime via the in-tool Load buttons).

Usage:  python tools/build_rig_studio.py [--no-epic] [--no-tiles]
"""
import base64
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
TOOLS = ROOT / "tools"
TEMPLATE = TOOLS / "rig_studio.template.html"
TILE_LAB = TOOLS / "tile_lab.html"
OUT = TOOLS / "rig_studio.html"

# Kept in step with src/raid/RaidScene.ts. The studio draws the stage the same way the
# game does, so these have to be the game's numbers rather than eyeballed ones.
SCENE = {
    "designW": 480,
    "designH": 320,
    "groundFY": 0.9,
    "sizeRefScale": 1.6,
    "zombieH": 91,
    "enemyH": 130,
    "bossH": 195,
    # GROUND_NUDGE / UNIT_GROUND_NUDGE are authored as fractions of ZOMBIE_H.
    "groundNudgeF": 0.2,
    "unitGroundNudgeF": 0.22,
    "fieldInsetFX": 0.1,
    "bossHScale": {"FarmStageActorBoss": 0.8},
    "enemyForwardFX": {
        "ValentinesDayStageActorMinion1": 0.4,
        "ValentinesDayStageActorMinion2": 0.4,
        "ValentinesDayStageActorMinion3": 0.4,
    },
}


def data_uri(path: pathlib.Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def load_json(path: pathlib.Path):
    return json.loads(path.read_text(encoding="utf-8"))


def build_enemy() -> dict:
    """Enemy rigs + the combat data that decides which attack clip each one plays."""
    edir = ASSETS / "raids" / "enemies"
    models = load_json(edir / "models.json")
    stats = load_json(ASSETS / "raids" / "enemy_stats.json")
    attacks = load_json(ASSETS / "raids" / "attacks.json")
    strips, missing = {}, []
    for key in models:
        png = edir / "parts" / f"{key}.png"
        if png.exists():
            strips[key] = data_uri(png)
        else:
            missing.append(key)
    if missing:
        print(f"  ! enemy strips missing for: {', '.join(missing)}")

    # Per rig: the named attacks it can swing, each with the damageTiming the swing has
    # to land on. EnemyActor picks its authored pose off the attack NAME, so this is what
    # tells the studio whether a rig has a hand-authored attack or the generic chop.
    rig_attacks = {}
    for key in models:
        rows = []
        for entry in (stats.get(key) or {}).get("attacks", []):
            name = entry.get("name", "")
            meta = attacks.get(name, {})
            rows.append({
                "name": name,
                "frequency": entry.get("frequency", 100),
                "damageTiming": meta.get("damageTiming", 0.5),
                "animID": meta.get("animID"),
                "knockBack": bool(meta.get("knockBack")),
                "stun": bool(meta.get("stun")),
            })
        actions = [
            {"name": a.get("name", ""), "frequency": a.get("frequency", 0),
             "castTime": a.get("castTime"), "cooldownTime": a.get("cooldownTime")}
            for a in (stats.get(key) or {}).get("bossActions", [])
        ]
        rig_attacks[key] = {
            "attacks": rows,
            "bossActions": actions,
            "dex": (stats.get(key) or {}).get("dex", 1),
        }
    return {
        "kind": "enemy", "label": "Enemies", "models": models,
        "strips": strips, "combat": rig_attacks,
    }


def build_zombie() -> dict:
    zdir = ASSETS / "zombie"
    return {
        "kind": "zombie",
        "label": "Zombies",
        "models": load_json(zdir / "models.json"),
        "frames": load_json(zdir / "frames.json"),
        "atlas": data_uri(zdir / "ZombieSheet.png"),
    }


def build_stages() -> tuple:
    """Every raid's stage: the levelAssets list plus the art it names.

    The studio lays these out in the same 480x320 cocos design space RaidScene does, so
    the rig it is animating stands on the ground line of the real background.
    """
    raids = load_json(ASSETS / "raids" / "raids.json")
    imgdir = ASSETS / "raids" / "images"
    images, stages = {}, []
    for raid in raids:
        assets = raid.get("levelAssets", [])
        for a in assets:
            name = a.get("sprite")
            if name and name not in images and (imgdir / name).exists():
                images[name] = data_uri(imgdir / name)
        keys = set()
        for stage in raid.get("stages", []):
            keys.update(stage.get("enemyKeys", []))
            for w in stage.get("weighted", []):
                keys.add(w.get("enemy"))
            if stage.get("bossKey"):
                keys.add(stage["bossKey"])
        stages.append({
            "id": raid["id"], "name": raid["name"], "bossName": raid.get("bossName", ""),
            "levelAssets": [a for a in assets if a.get("sprite") in images],
            "enemyKeys": sorted(k for k in keys if k),
        })
    return stages, images


def build_epic(include: bool) -> dict:
    """The eight Epic Bosses: authored frame strips + their own parallax stage.

    An Epic Boss is the one enemy drawn from full-body strips rather than a rig (see
    src/raid/epicBossAnimation.ts), so it gets its own tab: a strip viewer that plays a
    named animation off its authored cell grid and frame rate.
    """
    out = {}
    if not include:
        return out
    root = ASSETS / "epic-bosses"
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        cat_path = d / "catalog.json"
        if not cat_path.exists():
            continue
        cat = load_json(cat_path)
        images = {}
        for anim in (cat.get("animations") or {}).values():
            f = anim.get("file")
            if f and f not in images and (d / f).exists():
                images[f] = data_uri(d / f)
        level_assets = []
        for a in cat.get("levelAssets", []):
            name = a.get("sprite")
            if not name or not (d / name).exists():
                continue
            if name not in images:
                images[name] = data_uri(d / name)
            level_assets.append(a)
        if (d / "portrait.png").exists():
            images["portrait.png"] = data_uri(d / "portrait.png")
        out[cat.get("id", d.name)] = {
            "id": cat.get("id", d.name),
            "name": cat.get("name", d.name),
            "animations": cat.get("animations") or {},
            "levelAssets": level_assets,
            "images": images,
            "unitStats": cat.get("unitStats") or {},
            "fightMs": cat.get("fightMs"),
        }
    return out


def build_particles() -> dict:
    pdir = ASSETS / "raids" / "particles"
    return {p.stem: load_json(p) for p in sorted(pdir.glob("*.json"))}


def main() -> None:
    argv = sys.argv[1:]
    want_epic = "--no-epic" not in argv
    want_tiles = "--no-tiles" not in argv

    stages, stage_images = build_stages()
    tile_lab = ""
    if want_tiles:
        if TILE_LAB.exists():
            tile_lab = TILE_LAB.read_text(encoding="utf-8")
        else:
            print("  ! tools/tile_lab.html missing — run tools/build_tile_lab.py first;"
                  " the Tiles tab will be empty")

    boot = {
        "rigs": {"enemy": build_enemy(), "zombie": build_zombie()},
        "stages": stages,
        "stageImages": stage_images,
        "epic": build_epic(want_epic),
        "particles": build_particles(),
        "scene": SCENE,
    }
    html = TEMPLATE.read_text(encoding="utf-8")
    # The tile lab goes in as its own literal rather than inside the boot JSON: it is a
    # whole HTML document, and burying a megabyte of markup in a JSON string doubles its
    # escaping for no gain. </script> is the only sequence that could close us early.
    html = html.replace("__TILE_LAB_HTML__", json.dumps(tile_lab).replace("</", "<\\/"))
    html = html.replace("__BOOT_JSON__", json.dumps(boot, separators=(",", ":")).replace("</", "<\\/"))
    OUT.write_text(html, encoding="utf-8")

    en, zo = boot["rigs"]["enemy"], boot["rigs"]["zombie"]
    mb = OUT.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUT.relative_to(ROOT)}  ({mb:.1f} MB)")
    print(f"  enemy:  {len(en['models'])} rigs, {len(en['strips'])} strips")
    print(f"  zombie: {len(zo['models'])} rigs, {len(zo['frames'])} frames")
    print(f"  stages: {len(stages)} raids, {len(stage_images)} background layers")
    print(f"  epic:   {len(boot['epic'])} bosses"
          + ("" if want_epic else "  (--no-epic: skipped)"))
    print(f"  fx:     {len(boot['particles'])} particle configs")
    print(f"  tiles:  {'embedded tile_lab.html' if tile_lab else 'none'}")


if __name__ == "__main__":
    main()
