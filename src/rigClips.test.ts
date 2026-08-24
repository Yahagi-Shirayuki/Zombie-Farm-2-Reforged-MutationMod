// The Rig Studio's animation model, driven against the animation it claims to show.
//
// src/raid/rigClips.js is the ONE copy of the clip schema and its evaluator -- the
// RUNTIME's copy, which the actors pose themselves from when a clip has been authored
// for the rig they draw -- and tools/rigClipsAuthored.js holds the built-in clips the
// studio opens every rig with. Those built-ins are transcriptions of
// src/raid/EnemyActor.ts and src/raid/RaidActor.ts, and a transcription is only worth
// anything if something checks it: a bench that poses a rig differently from the game
// teaches you a wrong animation, and the mistake ships looking measured. So this test
// runs the REAL actor and the studio's clip side by side over a whole cycle and asserts
// every part lands in the same place — the same arrangement tileLabGeometry.test.ts has
// with the flat-tile anchors.
//
// Read this before "fixing" a built-in clip: if the clip and the engine disagree, one of
// them is wrong, and this file says which parts and by how much.
// The app has no @types/node (it only ever runs in a browser); the node test
// environment provides this at runtime. Same treatment as docsVersionSync.test.ts.
// @ts-ignore
import { readFileSync } from "node:fs";
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { EnemyModel } from "./assets";
import { EnemyActor } from "./raid/EnemyActor";
import { RaidActor } from "./raid/RaidActor";
import { setRigClips } from "./raid/clipRuntime";
import type { Clip } from "./raid/rigClips";
// @ts-expect-error - plain ES module, deliberately untyped (it is inlined into a tool)
import * as RigClips from "../tools/rigClipsAuthored.js";

const json = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf-8"));
const MODELS: Record<string, EnemyModel> = json("../public/assets/raids/enemies/models.json");
const STATS: Record<string, { attacks?: { name: string; frequency: number }[]; bossActions?: unknown[]; dex?: number }> =
  json("../public/assets/raids/enemy_stats.json");
const ATTACKS: Record<string, { damageTiming?: number; animID?: number }> =
  json("../public/assets/raids/attacks.json");

/** The `combat` blob tools/build_rig_studio.py hands the studio for one rig. */
function combatFor(key: string) {
  const s = STATS[key] ?? {};
  return {
    attacks: (s.attacks ?? []).map((a) => ({
      name: a.name,
      frequency: a.frequency,
      damageTiming: ATTACKS[a.name]?.damageTiming ?? 0.5,
      animID: ATTACKS[a.name]?.animID,
    })),
    bossActions: s.bossActions ?? [],
    dex: s.dex ?? 1,
  };
}

/** Sprites in model-part order. Pixi only sorts `children` at render time, and nothing
 *  here renders, so insertion order still maps 1:1 onto model.parts. */
function spritesOf(actor: EnemyActor) {
  const root = (actor as unknown as { root: { children: Sprite[] } }).root;
  return root.children;
}
interface Sprite {
  x: number; y: number; rotation: number; scale: { x: number; y: number };
}
function rootOf(actor: EnemyActor) {
  return (actor as unknown as { root: { x: number; y: number } }).root;
}

/**
 * The engine's own cooldown→source-time rotation (EnemyActor.sourceAttackProgress).
 *
 * Drive the comparison from atkProg and map FORWARD through this, rather than inverting
 * it: the authored timelines are discontinuous at the wrap (armHackBack2 ends at
 * −135° and restarts at 0), so an inverse has two answers there and picking the wrong
 * one reports a 135° gap that does not exist.
 */
const sourceAttackProgress = (atkProg: number, damageTiming: number) => {
  const recovery = 1 - damageTiming;
  return atkProg <= recovery ? damageTiming + atkProg : atkProg - recovery;
};

/** Pose the real actor at one point in its attack cooldown. dt=0 on a fresh actor keeps
 *  the free-running clocks (bob, head rock) at zero, which is where a clip's t=0 sits. */
function poseActor(key: string, model: EnemyModel, clip: Clip, atkProg: number) {
  const actor = new EnemyActor(Texture.EMPTY, model, key);
  if (clip.timeBase === "free") {
    actor.update(0, clip.moving === true, null);
  } else {
    actor.update(0, false, {
      atkProg, damageTiming: clip.damageTiming ?? 0.5, attackName: clip.attackName,
    });
  }
  return { sprites: spritesOf(actor), root: rootOf(actor) };
}

/** Where on the clip's own timeline an attack-cooldown position lands. */
function clipTimeFor(clip: Clip, atkProg: number) {
  if (clip.timeBase === "source") return sourceAttackProgress(atkProg, clip.damageTiming ?? 0.5);
  return atkProg; // "cycle" clips ARE the cooldown; "free" clips ignore it
}


/** Largest positional / angular gap between the engine's pose and the clip's, over one
 *  whole cycle. Returns the worst offender so a failure names the part. */
function worstGap(key: string, clip: Clip, samples = 24) {
  const model = MODELS[key];
  let worst = { part: -1, what: "", gap: 0, t: 0 };
  const note = (part: number, what: string, gap: number, t: number) => {
    if (gap > worst.gap) worst = { part, what, gap, t };
  };
  for (let i = 0; i <= samples; i++) {
    // Half-step in, so no sample sits exactly on the authored timelines' wrap.
    const u = (i + 0.5) / (samples + 1);
    const sp = clip.simProgress;
    // A "free" clip has no sim clock at all: the engine's bob and head rock are the
    // only things moving and a fresh actor sits at the top of both, i.e. t = 0.
    const atkProg = clip.timeBase === "free" ? 0 : sp ? sp.rest + sp.span * u : u;
    const t = clip.timeBase === "free" ? 0 : sp ? u : clipTimeFor(clip, atkProg);
    const { sprites, root } = poseActor(key, model, clip, atkProg);
    const pose = RigClips.poseAt("enemy", model, clip, t, 0);
    note(-1, "root.x", Math.abs(root.x - pose.root.dx), t);
    note(-1, "root.y", Math.abs(root.y - pose.root.dy), t);
    model.parts.forEach((p, idx) => {
      const sp = sprites[idx];
      const d = pose.parts[idx] ?? { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
      note(idx, `${p.group}${p.back ? ".back" : ".front"} x`, Math.abs(sp.x - (p.px + d.dx)), t);
      note(idx, `${p.group}${p.back ? ".back" : ".front"} y`, Math.abs(sp.y - (p.py + d.dy)), t);
      note(idx, `${p.group}${p.back ? ".back" : ".front"} rot`,
        Math.abs(sp.rotation - ((p.rot ?? 0) + d.rot)) * 30, t); // rad→"px-ish" so one threshold covers both
      note(idx, `${p.group}${p.back ? ".back" : ".front"} scale`,
        Math.abs(sp.scale.x - d.sx) * 30, t);
    });
  }
  return worst;
}

const RIG_KEYS = Object.keys(MODELS);

describe("Rig Studio clips match the animation the game actually plays", () => {
  it("has a clip set for every enemy rig", () => {
    for (const key of RIG_KEYS) {
      const clips = RigClips.defaults("enemy", key, MODELS[key], combatFor(key));
      expect(Object.keys(clips).length, key).toBeGreaterThan(0);
      expect(clips.idle, key).toBeTruthy();
      expect(clips.move, key).toBeTruthy();
    }
  });

  // The two the report named, plus one of each shape they stand for.
  const NAMED = [
    "PirateStageActorSwashbuckler", // authored slice, two-part front arm
    "CityStageActorLawyer", // authored flail on a PUNCH rig
    "CityStageActorCrazedWorker", // authored wind-through
    "PirateStageActorBoss", // authored slash on a SLAM rig
    "CityStageActorBoss", // authored two-strike pair
    "NinjaStageActorGirl", // authored full-body stab
    "RobotStageActorBroBot", // authored per-arm spins
    "FarmStageActorFarmhand", // generic chop
    "FarmStageActorLumberjack", // generic chop, late damageTiming
    "PirateStageActorScallywag", // generic HEAVY chop
    "BeachStageActorBoss", // generic back-arm striker
    "CircusStageActorMinion1", // authored unicycle bear
  ];

  for (const key of NAMED) {
    it(`${key} — every clip poses the rig the way the engine does`, () => {
      const clips = RigClips.defaults("enemy", key, MODELS[key], combatFor(key));
      for (const name of Object.keys(clips)) {
        const clip = clips[name] as Clip;
        if (clip.timeBase === "free") continue; // idle/move are checked separately below
        const worst = worstGap(key, clip);
        expect(
          worst.gap,
          `${key}/${name}: part ${worst.part} ${worst.what} out by ${worst.gap.toFixed(3)} at t=${worst.t}`
        ).toBeLessThan(0.5);
      }
    });
  }

  it("every enemy rig's attack clips match the engine", () => {
    const bad: string[] = [];
    for (const key of RIG_KEYS) {
      const clips = RigClips.defaults("enemy", key, MODELS[key], combatFor(key));
      for (const name of Object.keys(clips)) {
        const clip = clips[name] as Clip;
        if (clip.timeBase === "free") continue;
        const worst = worstGap(key, clip, 12);
        if (worst.gap >= 0.5) {
          bad.push(`${key}/${name}: part ${worst.part} ${worst.what} out by ${worst.gap.toFixed(2)} at t=${worst.t}`);
        }
      }
    }
    expect(bad.join("\n")).toBe("");
  });

  // The fault the studio was built to catch, stated as a property rather than a list of
  // rigs: a limb that the engine turns AS A UNIT must turn about ONE pivot. Rotating each
  // part about its own anchor is what sent the Swashbuckler's cutlass off without his
  // hand, and it is invisible in a two-minute fight — so it is asserted, not eyeballed.
  it("no multi-part limb rotates about per-part anchors", () => {
    const torn: string[] = [];
    for (const key of RIG_KEYS) {
      const model = MODELS[key];
      const actor = new EnemyActor(Texture.EMPTY, model, key);
      const arms = (actor as unknown as {
        arms: { baseX: number; baseY: number; back: boolean }[];
      }).arms;
      const pivots = actor as unknown as {
        shoulder: { x: number; y: number } | null;
        backShoulder: { x: number; y: number } | null;
      };
      for (const back of [false, true]) {
        const side = arms.filter((a) => a.back === back);
        if (side.length < 2) continue; // a one-part arm turns on its own anchor, correctly
        const pivot = back ? pivots.backShoulder : pivots.shoulder;
        const label = `${key} arm.${back ? "back" : "front"} (${side.length} parts)`;
        if (!pivot) { torn.push(`${label}: no pivot at all`); continue; }
        // Turning the assembly must be RIGID: every part keeps its distance from every
        // other. That holds if and only if they all swing about the same point.
        const turn = (a: { baseX: number; baseY: number }, th: number) => {
          const c = Math.cos(th), s2 = Math.sin(th);
          const dx = a.baseX - pivot.x, dy = a.baseY - pivot.y;
          return { x: pivot.x + dx * c - dy * s2, y: pivot.y + dx * s2 + dy * c };
        };
        for (let i = 0; i < side.length; i++) {
          for (let j = i + 1; j < side.length; j++) {
            const before = Math.hypot(side[i].baseX - side[j].baseX, side[i].baseY - side[j].baseY);
            const a = turn(side[i], 1.7), b = turn(side[j], 1.7);
            const after = Math.hypot(a.x - b.x, a.y - b.y);
            if (Math.abs(before - after) > 0.01) torn.push(`${label}: parts drift ${(after - before).toFixed(1)}px apart`);
          }
        }
      }
    }
    expect(torn.join(" | ")).toBe("");
  });

  it("idle and move match the engine's resting and walking poses", () => {
    const bad: string[] = [];
    for (const key of RIG_KEYS) {
      const clips = RigClips.defaults("enemy", key, MODELS[key], combatFor(key));
      for (const name of ["idle", "move"]) {
        const clip = { ...(clips[name] as Clip), moving: name === "move" };
        const worst = worstGap(key, clip, 1); // t=0 only: the free clocks are shared
        if (worst.gap >= 0.5) {
          bad.push(`${key}/${name}: part ${worst.part} ${worst.what} out by ${worst.gap.toFixed(2)}`);
        }
      }
    }
    expect(bad.join("\n")).toBe("");
  });
});

// ---------------------------------------------------------------------------
//  THE RUNTIME PATH
// ---------------------------------------------------------------------------
// Everything above compares the studio's clip to the engine. These compare the ENGINE
// DRIVEN BY a clip to the engine computing the pose itself, which is the substitution
// src/raid/clipRuntime.ts performs whenever someone has authored an animation for a rig.
// Feeding it the built-in clip -- the transcription of what the procedural code does --
// must therefore change nothing at all. That is what makes shipping an edited clip safe:
// the mechanism is a no-op until the clip itself differs.

/** Pose an actor twice at the same point in its cycle: once with the clip installed as
 *  an authored override, once with nothing installed at all. */
function bothWays(key: string, clip: Clip, atkProg: number, moving: boolean) {
  const model = MODELS[key];
  setRigClips("enemy", {});
  const plain = poseActor(key, model, clip, atkProg);
  setRigClips("enemy", { [key]: { [clipNameOf(clip, moving)]: clip } });
  const driven = poseActor(key, model, clip, atkProg);
  setRigClips("enemy", {});
  return { plain, driven };
}

/** The name clipRuntime will look the clip up under, for the state being posed. */
function clipNameOf(clip: Clip, moving: boolean) {
  if (clip.timeBase === "free") return moving ? "move" : "idle";
  return clip.attackName ? "attack:" + clip.attackName : "attack";
}

describe("authored clips drive the real actor", () => {
  it("installing the BUILT-IN clip leaves every pose unchanged", () => {
    const drift: string[] = [];
    for (const key of Object.keys(MODELS)) {
      const clips = RigClips.defaults("enemy", key, MODELS[key], combatFor(key));
      for (const name of Object.keys(clips)) {
        const clip: Clip = clips[name];
        // "windup" clips (a perched boss's throw/ability) are named by RaidScene rather
        // than inferred from the swing, so they are not on this path yet -- see the
        // `clip` field on EnemyAttackPose.
        if (clip.timeBase === "windup") continue;
        const moving = name === "move";
        for (let i = 0; i <= 6; i++) {
          const atkProg = (i + 0.5) / 7;
          const { plain, driven } = bothWays(key, clip, atkProg, moving);
          // Same measure and same 0.5 threshold the comparisons above use: px for
          // positions, radians for rotations. The residual is the transcription gap
          // those tests already bound, not something this substitution introduces.
          const gap = Math.max(
            Math.abs(plain.root.x - driven.root.x),
            Math.abs(plain.root.y - driven.root.y),
            ...plain.sprites.map((sp, idx) => Math.max(
              Math.abs(sp.x - driven.sprites[idx].x),
              Math.abs(sp.y - driven.sprites[idx].y),
              Math.abs(sp.rotation - driven.sprites[idx].rotation),
            )),
          );
          if (gap >= 0.5) {
            drift.push(`${key} ${name} @${atkProg.toFixed(2)}: ${gap.toFixed(3)}`);
            break;
          }
        }
      }
    }
    expect(drift.slice(0, 8).join(" | ")).toBe("");
  });

  it("an EDITED clip actually moves the rig", () => {
    // The other half of the guarantee: the mechanism is a no-op on the built-ins, but it
    // is not a no-op in general -- an edit has to reach the screen, or none of this does
    // anything for the person who made it.
    const key = "PirateStageActorSwashbuckler";
    const model = MODELS[key];
    const clips = RigClips.defaults("enemy", key, model, combatFor(key));
    const name = Object.keys(clips).find((n) => n.startsWith("attack"))!;
    const edited = RigClips.clone(clips[name]);
    edited.tracks.push({
      name: "test lift", target: "body", channel: "y", keys: [[0, 0], [1, -40]],
    });
    setRigClips("enemy", { [key]: { [name]: edited } });
    const driven = poseActor(key, model, edited, 0.9);
    setRigClips("enemy", {});
    const plain = poseActor(key, model, clips[name], 0.9);
    const moved = plain.sprites.some((sp, i) => Math.abs(sp.y - driven.sprites[i].y) > 5);
    expect(moved).toBe(true);
  });

  it("a rig with no authored clip is left entirely alone", () => {
    setRigClips("enemy", { SomeOtherRig: { attack: { duration: 1, tracks: [] } } });
    const key = "PirateStageActorScallywag";
    const clips = RigClips.defaults("enemy", key, MODELS[key], combatFor(key));
    const name = Object.keys(clips).find((n) => n.startsWith("attack"))!;
    const driven = poseActor(key, MODELS[key], clips[name], 0.8);
    setRigClips("enemy", {});
    const plain = poseActor(key, MODELS[key], clips[name], 0.8);
    expect(driven.sprites.map((s) => Math.round(s.x * 100)))
      .toEqual(plain.sprites.map((s) => Math.round(s.x * 100)));
  });
});

// ---------------------------------------------------------------------------
//  THE ZOMBIE RIG
// ---------------------------------------------------------------------------
// Everything above is the enemy rig. RaidActor is the other half of the same story and
// had no coverage at all, which is how its transcription came to be wrong in a way
// nobody noticed: partMeta splits a zombie's head into head/eye/jaw so a bite can open
// the jaw and squint the eyes on their own tracks, but RaidActor hangs the whole face
// off the neck and rocks and lunges it AS ONE. Tracks aimed at plain `head` moved the
// skull and left the eyes and jaw behind -- 8px behind, mid-bite. Hence `head.all`.

const ZMODELS: Record<string, ZModel> = json("../public/assets/zombie/models.json");
interface ZModel { parts: { px: number; py: number; file: string; group?: string }[] }

/** RaidActor only needs four things off GameAssets to build a rig, and only the models
 *  carry any geometry -- every part resolves to the same empty texture here, because
 *  nothing renders and only the transform is under test. */
const ZASSETS = {
  zombieModels: ZMODELS,
  zombiePartTex: new Proxy({}, { get: () => Texture.EMPTY, has: () => true }),
  mutationParts: {},
  zombies: [],
} as never;

function zSprites(actor: RaidActor): Sprite[] {
  return (actor as unknown as { root: { children: Sprite[] } }).root.children;
}

/** Pose a zombie at one point in its cycle, the way RaidScene drives it: update() then
 *  poseArms(), every frame, in that order. */
function poseZombie(key: string, name: string, atkProg: number) {
  const a = new RaidActor(ZASSETS, key);
  const walking = name === "move";
  a.update(0, walking, false);
  if (name.startsWith("attack")) {
    a.poseArms(0, true, false, atkProg, 0, -1, 0, name.includes("scratch") ? "scratch" : "bite");
  } else {
    a.poseArms(0, false, walking, 0, 0, -1, 0, "");
  }
  return zSprites(a);
}

/** Worst gap between RaidActor's own pose and the clip's, over a whole cycle. */
function zWorst(key: string, name: string, clip: Clip) {
  const model = ZMODELS[key];
  const attack = name.startsWith("attack");
  let worst = { gap: 0, part: -1, t: 0 };
  const samples = attack ? 16 : 1;
  for (let i = 0; i < samples; i++) {
    const atkProg = (i + 0.5) / (samples + 1);
    const t = attack
      ? sourceAttackProgress(atkProg, clip.damageTiming ?? 0.5)
      : 0; // the free clocks are shared, and a fresh actor sits at the top of both
    const sprites = poseZombie(key, name, atkProg);
    const pose = RigClips.poseAt("zombie", model, clip, t, 0);
    // Sprite order is part order only while nothing is skipped; a plain zombie with no
    // mutation skips nothing, which is what this harness builds.
    model.parts.forEach((part, idx) => {
      const sp = sprites[idx];
      if (!sp) return;
      const d = pose.parts[idx] ?? { dx: 0, dy: 0, rot: 0 };
      const g = Math.max(
        Math.abs(sp.x - (part.px + d.dx)),
        Math.abs(sp.y - (part.py + d.dy)),
        Math.abs(sp.rotation - d.rot),
      );
      if (g > worst.gap) worst = { gap: g, part: idx, t };
    });
  }
  return worst;
}

describe("the zombie clips match RaidActor", () => {
  const ZKEYS = Object.keys(ZMODELS).filter((k) => ZMODELS[k]?.parts?.length);

  it("idle, move, bite and scratch all land where the engine puts them", () => {
    const bad: string[] = [];
    for (const key of ZKEYS) {
      const clips = RigClips.defaults("zombie", key, ZMODELS[key], {});
      for (const name of ["idle", "move", "attack:bite", "attack:scratch"]) {
        const clip: Clip = clips[name];
        if (!clip) continue;
        const worst = zWorst(key, name, clip);
        if (worst.gap >= 0.5) {
          bad.push(`${key}/${name}: part ${worst.part} out by ${worst.gap.toFixed(2)} at t=${worst.t.toFixed(2)}`);
        }
      }
    }
    expect(bad.slice(0, 6).join("\n")).toBe("");
  });

  it("the head rock reaches the eyes and the jaw, not just the skull", () => {
    // The specific regression: a `head` track leaves the face behind. Guarded directly,
    // because a rig whose eyes happen to sit near the neck would hide it in the averages.
    const key = "ZombieActorRegularTier1";
    const model = ZMODELS[key];
    const clips = RigClips.defaults("zombie", key, model, {});
    const pose = RigClips.poseAt("zombie", model, clips["attack:bite"], 0.25, 0);
    const moved = model.parts
      .map((part, i) => ({ file: part.file, group: part.group, d: pose.parts[i] }))
      .filter((r) => r.group === "head");
    expect(moved.length).toBeGreaterThan(3);
    const still = moved.filter((r) => !r.d || (Math.abs(r.d.dx) < 0.01 && Math.abs(r.d.dy) < 0.01));
    expect(still.map((r) => r.file).join(", ")).toBe("");
  });
});

describe("authored clips drive the real zombie", () => {
  it("installing the BUILT-IN clip leaves every pose unchanged", () => {
    const drift: string[] = [];
    for (const key of Object.keys(ZMODELS).slice(0, 12)) {
      if (!ZMODELS[key]?.parts?.length) continue;
      const clips = RigClips.defaults("zombie", key, ZMODELS[key], {});
      for (const name of ["idle", "move", "attack:bite", "attack:scratch"]) {
        const clip: Clip = clips[name];
        if (!clip) continue;
        for (let i = 0; i < 5; i++) {
          const atkProg = (i + 0.5) / 6;
          setRigClips("zombie", {});
          const plain = poseZombie(key, name, atkProg).map((sp) => [sp.x, sp.y, sp.rotation]);
          setRigClips("zombie", { [key]: { [name]: clip } });
          const driven = poseZombie(key, name, atkProg).map((sp) => [sp.x, sp.y, sp.rotation]);
          setRigClips("zombie", {});
          const gap = Math.max(...plain.map((a, j) => Math.max(
            Math.abs(a[0] - driven[j][0]), Math.abs(a[1] - driven[j][1]), Math.abs(a[2] - driven[j][2]),
          )));
          if (gap >= 0.5) {
            drift.push(`${key}/${name} @${atkProg.toFixed(2)}: ${gap.toFixed(3)}`);
            break;
          }
        }
      }
    }
    expect(drift.slice(0, 6).join(" | ")).toBe("");
  });

  it("an EDITED zombie clip actually moves the rig", () => {
    const key = "ZombieActorRegularTier1";
    const clips = RigClips.defaults("zombie", key, ZMODELS[key], {});
    const edited = RigClips.clone(clips.idle);
    edited.tracks.push({
      name: "test lift", target: "head.all", channel: "y", keys: [[0, -30], [1, -30]],
    });
    setRigClips("zombie", { [key]: { idle: edited } });
    const driven = poseZombie(key, "idle", 0);
    setRigClips("zombie", {});
    const plain = poseZombie(key, "idle", 0);
    expect(plain.some((sp, i) => Math.abs(sp.y - driven[i].y) > 20)).toBe(true);
  });
});
