// The rig animation model: the clip SCHEMA the Rig Studio edits, and its evaluator.
//
// This file has ONE copy, and it is the runtime's — src/raid/EnemyActor.ts and
// src/raid/RaidActor.ts pose themselves from a clip through `poseAt` whenever one has
// been authored for the rig they are drawing. tools/build_rig_studio.py inlines this
// same file into the studio (a single <script> in a file:// page, not a module), and
// src/rigClips.test.ts drives it against the two actors pose for pose. That is the whole
// point of it being one file: a bench that animates a rig differently from the game
// teaches you a wrong animation, and the mistake ships looking measured.
//
// The BUILT-IN clips — the ones that reproduce what the procedural code does today —
// live next door in tools/rigClipsAuthored.js. The runtime does not need them (a rig
// with no authored clip simply keeps running the procedural path), so they stay out of
// the game bundle.
//
// Plain JS rather than TS on purpose: the studio inlines the source verbatim, and a
// transpile step between the two copies is exactly the drift this arrangement exists to
// prevent. src/raid/rigClips.d.ts gives the app its types.
//
// ---------------------------------------------------------------------------
// A CLIP is one named animation (idle / move / attack / throw / ability) made of
// TRACKS. A track poses one part GROUP on one CHANNEL, and carries its own timing:
//
//   { target:"arm.front", channel:"rot", pivot:"shoulder", ease:"smooth",
//     keys:[[0,0],[0.36,48.7],[0.6,-22.9],[1,0]] }
//
// target   root | <group> | <group>.front|.back|.<n> | <group>.front.<n>
// channel  rot (degrees) · x · y (rig px) · scaleX · scaleY (multiplier)
// pivot    self (the part's own anchor) | origin | neck | shoulder | auto | <named>
//          — only meaningful on `rot`; this is what makes an arm swing ABOUT the
//          shoulder (carrying its weapon) instead of spinning on its own anchor.
// ease     smooth (the engine's own smoothstep) | linear | step
// keys     [normalisedTime, value] pairs. A track can instead carry
//            wave:{amp,cycles,phase,clamp}   — the engine's sin() motions
//            spin:{rate}                     — free-running rotation (rad/s)
//
// A clip records `timeBase` so the timeline knows what its 0..1 means:
//   "source" — the authored animation's own timeline; the hit lands at damageTiming
//              (this is what ZFAttackAnims timelines are in)
//   "cycle"  — the sim's whole attack cooldown; the engine RESTS for the first 28%
//              and swings over the remaining 72%, so the hit is NOT at t=0
//   "windup" — a perched boss's throw or special, whose 0..1 the renderer maps onto
//              the swing window itself (`simProgress` records that mapping)
//   "free"   — no hit (idle, move)
//
// THE PERSISTENT LAYER. The engine never stops breathing. `EnemyActor.update` runs the
// whole-body bob and the head rock EVERY frame and only THEN lets an authored attack
// pose the rig on top, so an enemy mid-swing is still bobbing and still rocking its
// head. Those two are free-running on their own clocks — nothing about the attack
// resets them — so they cannot be expressed as keys on an attack clip's timeline.
// A track marked `free:{period}` is evaluated against the WALL clock instead of the
// clip's, which is exactly what the engine does with them. Leaving them out is what
// made an attacking rig stand dead still with one arm flailing.
//
// The built-ins are TRANSCRIBED from EnemyActor/RaidActor, not invented — piecewise-
// smoothstep envelopes come across as exact keys because the engine's `smooth` IS this
// file's "smooth" ease.

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const round = (v) => Math.round((v + Number.EPSILON) * 1000) / 1000;
export const clone = (o) => JSON.parse(JSON.stringify(o));
/** The engine's own 0..1 ease — src/raid/EnemyActor.ts `smooth`. */
export const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const radToDeg = (r) => r * 180 / Math.PI;

// An animation track addresses a GROUP, not a layer index, because that is what
// the game's own animators do (`for (const a of this.arms)`). Enemy rigs carry the
// group on the part; zombie rigs infer it the way RaidActor does — by filename.
export function partMeta(kind, part, index) {
  if (kind === "enemy") {
    return { group: part.group || "body", back: !!part.back, index };
  }
  const file = part.file || "";
  if (/Arm[FB](?:\.png)?$/i.test(file)) return { group: "arm", back: /ArmB(?:\.png)?$/i.test(file), index };
  if (part.group === "head") {
    if (/Eye[LR](?:\.png)?$/i.test(file)) return { group: "eye", back: false, index };
    if (/Jaw(?:Feature)?(?:\.png)?$/i.test(file)) return { group: "jaw", back: false, index };
    return { group: "head", back: false, index };
  }
  if (part.group === "footF") return { group: "footF", back: false, index };
  if (part.group === "footB") return { group: "footB", back: true, index };
  if (/Body(?:\.png)?$/i.test(file)) return { group: "body", back: false, index };
  return { group: part.group || "root", back: false, index };
}

/** Groups present in a rig, in a stable order — the track target menu. */
export function targetsOf(kind, model) {
  const seen = new Map();
  (model.parts || []).forEach((p, i) => {
    const m = partMeta(kind, p, i);
    if (!seen.has(m.group)) seen.set(m.group, { front: 0, back: 0, n: 0 });
    const e = seen.get(m.group);
    e.n++; e[m.back ? "back" : "front"]++;
  });
  const out = ["root"];
  for (const [g, e] of seen) {
    out.push(g);
    if (e.front && e.back) { out.push(g + ".front"); out.push(g + ".back"); }
    if (e.front > 1) for (let i = 0; i < e.front; i++) out.push(g + ".front." + i);
    if (e.back > 1) for (let i = 0; i < e.back; i++) out.push(g + ".back." + i);
    if (e.n > 1) for (let i = 0; i < e.n; i++) out.push(g + "." + i);
  }
  return out;
}

/** Resolve a track target to the part indices it poses. "root" resolves to []
 *  (the whole-rig transform is handled separately by the renderer). */
export function resolveTarget(kind, model, target) {
  if (!target || target === "root") return [];
  // group | group.front | group.back | group.<n> | group.front.<n> | group.back.<n>
  const bits = String(target).split(".");
  const group = bits[0];
  let pool = (model.parts || []).map((p, i) => partMeta(kind, p, i)).filter((m) => m.group === group);
  let rest = bits.slice(1);
  if (rest[0] === "front") { pool = pool.filter((m) => !m.back); rest = rest.slice(1); }
  else if (rest[0] === "back") { pool = pool.filter((m) => m.back); rest = rest.slice(1); }
  if (!rest.length) return pool.map((m) => m.index);
  const n = parseInt(rest[0], 10);
  return Number.isFinite(n) && pool[n] ? [pool[n].index] : [];
}

/** Named pivots a track can rotate about. `self` keeps the part's own anchor. */
export function pivotsOf(model) {
  const out = ["self", "origin", "auto"];
  if (model.neck) out.push("neck");
  if (model.shoulder) out.push("shoulder");
  for (const pv of model.pivots || []) if (pv.name) out.push(pv.name);
  return out;
}
export function pivotPoint(model, name, back) {
  if (!name || name === "self") return null;
  if (name === "origin") return { x: 0, y: 0 };
  if (name === "auto") {
    // The assembly's authored pivot for THIS side, or — mirroring EnemyActor's own
    // fallback — the top-most part of the assembly, which for a shoulder-down arm is the
    // shoulder end. A one-part assembly resolves to its own anchor, i.e. no change.
    if (back) {
      const bs = (model.pivots || []).find((q) => q.name === "back-shoulder");
      if (bs) return { x: bs.x, y: bs.y };
    } else if (model.shoulder) {
      return { x: model.shoulder.x, y: model.shoulder.y };
    }
    const side = (model.parts || []).filter(
      (q) => (q.group || "body") === "arm" && !!q.back === back);
    if (!side.length) return null;
    const top = side.reduce((a, b) => (b.py < a.py ? b : a));
    return { x: top.px, y: top.py };
  }
  if (name === "neck") return model.neck ? { x: model.neck.x, y: model.neck.y } : null;
  if (name === "shoulder") return model.shoulder ? { x: model.shoulder.x, y: model.shoulder.y } : null;
  const pv = (model.pivots || []).find((p) => p.name === name);
  return pv ? { x: pv.x, y: pv.y } : null;
}



// ---- evaluation ---------------------------------------------------------
const EASE = {
  smooth: (a, b, k) => a + (b - a) * smooth(k),
  linear: (a, b, k) => a + (b - a) * clamp(k, 0, 1),
  step: (a) => a,
};
export function evalKeys(keys, t, ease) {
  if (!keys || !keys.length) return 0;
  const f = EASE[ease] || EASE.smooth;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1], cur = keys[i];
    if (t <= cur[0]) {
      const span = cur[0] - prev[0];
      return span <= 0 ? cur[1] : f(prev[1], cur[1], (t - prev[0]) / span);
    }
  }
  return keys[keys.length - 1][1];
}
/** One track's value at normalised clip time `t`. */
export function evalTrack(track, t, duration, freeT) {
  // A free-running track ignores the clip's phase and rides the wall clock, the way
  // the engine's bob and head rock do (see THE PERSISTENT LAYER above).
  if (track.free) {
    const period = track.free.period || 1;
    t = (((freeT || 0) % period) + period) % period / period;
    duration = period;
  }
  if (track.wave) {
    const w = track.wave;
    let v = Math.sin(2 * Math.PI * ((w.cycles == null ? 1 : w.cycles) * t + (w.phase || 0)));
    if (w.clamp === "pos") v = Math.max(0, v);
    else if (w.clamp === "neg") v = Math.min(0, v);
    return (w.amp || 0) * v;
  }
  if (track.spin) return (track.spin.rate || 0) * t * (duration || 1) / DEG;
  return evalKeys(track.keys, t, track.ease);
}

const ROT_CH = "rot";
/** Build the per-part delta map a clip produces at time `t`. */
export function poseAt(kind, model, clip, t, freeT) {
  const parts = {};
  const root = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
  if (!clip || !model) return { parts, root };
  for (const track of clip.tracks || []) {
    if (track.mute) continue;
    const raw = evalTrack(track, t, clip.duration, freeT);
    if (track.target === "root") {
      if (track.channel === ROT_CH) root.rot += raw * DEG;
      else if (track.channel === "x") root.dx += raw;
      else if (track.channel === "y") root.dy += raw;
      else if (track.channel === "scaleX") root.sx *= raw;
      else if (track.channel === "scaleY") root.sy *= raw;
      continue;
    }
    const idx = resolveTarget(kind, model, track.target);
    for (const i of idx) {
      const p = model.parts[i];
      let s = parts[i];
      if (!s) { s = parts[i] = { x: p.px, y: p.py, rot: 0, sx: 1, sy: 1, dx: 0, dy: 0 }; }
      if (track.channel === ROT_CH) {
        const theta = raw * DEG;
        const back = partMeta(kind, p, i).back;
        const pivot = pivotPoint(model, track.pivot, back);
        if (pivot) {
          // Rotate the part's CURRENT position about the pivot, exactly the way
          // EnemyActor swings the front-arm assembly about `shoulder`.
          const c = Math.cos(theta), sn = Math.sin(theta);
          const ox = s.x - pivot.x, oy = s.y - pivot.y;
          s.x = pivot.x + ox * c - oy * sn;
          s.y = pivot.y + ox * sn + oy * c;
        }
        // `posOnly` carries the pivot's DISPLACEMENT without the sprite's own
        // turn — what is left of the head rock once an authored attack has
        // ASSIGNED head rotation outright (NinjaStab, JunkBotBite).
        if (!track.posOnly) s.rot += theta;
      } else if (track.channel === "x") s.x += raw;
      else if (track.channel === "y") s.y += raw;
      else if (track.channel === "scaleX") s.sx *= raw;
      else if (track.channel === "scaleY") s.sy *= raw;
    }
  }
  for (const i of Object.keys(parts)) {
    const s = parts[i], p = model.parts[i];
    s.dx = s.x - p.px;
    s.dy = s.y - p.py;
  }
  return { parts, root };
}

/** The generic swing occupies the tail SWING_FRAC of an attack cooldown; rest before it. */
export const SWING_FRAC = 0.72;
export const REST_FRAC = 1 - SWING_FRAC;

/** Where in a clip the blow actually lands, as a 0..1 position on its timeline. */
export function hitAt(clip) {
  if (!clip || clip.timeBase === "free" || clip.damageTiming == null) return null;
  if (clip.timeBase === "cycle") return REST_FRAC + SWING_FRAC * clamp(clip.damageTiming, 0.05, 0.95);
  if (clip.timeBase === "windup") {
    // A wind-up clip's t IS the engine's swing parameter scaled by `span`; the blow
    // lands where the envelope peaks, which for the 3 s wall summon is never reached
    // (the pose is a raise-and-hold, so it clamps to the end of the clip).
    const span = (clip.simProgress && clip.simProgress.uSpan) || 1;
    return clamp(clip.damageTiming / span, 0, 1);
  }
  return clamp(clip.damageTiming, 0, 1);
}

