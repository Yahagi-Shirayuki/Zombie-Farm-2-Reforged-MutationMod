// Types for src/raid/rigClips.js.
//
// The evaluator is plain JS because the Rig Studio inlines its source verbatim (see the
// header there); this file is how the app gets types over it without a transpile step
// standing between the two copies.

/** A rig part as models.json stores it — the app's EnemyModel/ZombieModel part shape. */
export interface ClipPart {
  px: number;
  py: number;
  group?: string;
  back?: boolean;
}

export interface ClipModel {
  parts?: ClipPart[];
  neck?: { x: number; y: number } | null;
  shoulder?: { x: number; y: number } | null;
  pivots?: { name: string; x: number; y: number }[];
}

/** One animated channel of one target. */
export interface ClipTrack {
  target: string;
  channel: "rot" | "x" | "y" | "scaleX" | "scaleY";
  /** Rotation pivot: "self" | "origin" | "auto" | a named rig pivot. */
  pivot?: string;
  ease?: "smooth" | "linear" | "step";
  /** [normalised time 0..1, value] pairs; degrees for `rot`, model px for x/y. */
  keys?: [number, number][];
  wave?: { amp: number; cycles?: number; phase?: number; clamp?: "pos" | "neg" };
  spin?: { rate: number };
  /** Rides the wall clock over `period` seconds instead of the clip's own phase. */
  free?: { period: number };
  /** Carry the pivot's displacement without the sprite's own turn. */
  posOnly?: boolean;
  mute?: boolean;
  name?: string;
}

export interface Clip {
  duration: number;
  tracks: ClipTrack[];
  loop?: boolean;
  /** What the clip's 0..1 means: "free" (wall clock), "source" (authored source time),
   *  "cycle" (the attack cooldown), "windup" (a boss's cast progress). */
  timeBase?: "free" | "source" | "cycle" | "windup";
  damageTiming?: number;
  attackName?: string;
  authored?: boolean;
  moving?: boolean;
  simProgress?: { rest: number; span: number; uSpan: number };
  note?: string;
}

/** Per-part deltas from the rig's rest pose, in model space. */
export interface ClipPose {
  parts: Record<number, {
    x: number; y: number; rot: number; sx: number; sy: number; dx: number; dy: number;
  }>;
  root: { dx: number; dy: number; rot: number; sx: number; sy: number };
}

export type RigKind = "enemy" | "zombie";

export const DEG: number;
export const SWING_FRAC: number;
export const REST_FRAC: number;
export function clamp(v: number, a: number, b: number): number;
export function round(v: number): number;
export function clone<T>(o: T): T;
export function smooth(t: number): number;

export function partMeta(
  kind: RigKind, part: ClipPart, index: number,
): { index: number; group: string; back: boolean; label: string };
export function targetsOf(kind: RigKind, model: ClipModel): string[];
export function resolveTarget(kind: RigKind, model: ClipModel, target: string): number[];
export function pivotsOf(model: ClipModel): string[];
export function pivotPoint(
  model: ClipModel, name: string | undefined, back: boolean,
): { x: number; y: number } | null;

export function evalKeys(keys: [number, number][], t: number, ease?: string): number;
export function evalTrack(
  track: ClipTrack, t: number, duration: number, freeT: number,
): number;
/** The complete pose a clip produces at normalised time `t`; `freeT` is wall-clock
 *  seconds, for tracks that ride their own period rather than the clip's phase. */
export function poseAt(
  kind: RigKind, model: ClipModel, clip: Clip | null, t: number, freeT: number,
): ClipPose;
export function hitAt(clip: Clip | null): number | null;
