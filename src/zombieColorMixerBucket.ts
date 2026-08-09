import type { PowderColor } from "./powderMachine";

export const ZOMBIE_COLOR_MIXER_BUCKET_KEY = "zombieColorMixerBucket";
export const ZOMBIE_COLOR_MIXER_BUCKET_LIMIT = 3;
export const ZOMBIE_COLOR_MIXER_DURATION_MS = 30 * 60 * 1000;

const ZOMBIE_COLOR_MIXER_BUCKET_PRICES = [
  { cost: 5_000, brains: false },
  { cost: 3, brains: true },
  { cost: 5, brains: true },
] as const;

export interface ZombieColorMixerBucketPrice {
  cost: number;
  brains: boolean;
}

export interface ZombieColorMixerPowderInput {
  color: PowderColor;
  amount: number;
}

export interface ZombieColorMixResult {
  color: [number, number, number];
  amountUsed: number;
  stopReason?: string;
}

export interface ZombieColorDyeJob {
  unitId: string;
  zombieKey: string;
  zombieName?: string;
  powderColor: PowderColor;
  amount: number;
  inputColor: [number, number, number];
  outputColor: [number, number, number];
  startedAt: number;
  finishAt: number;
}

export type PowderStatColor = Exclude<PowderColor, "black">;
export type ZombiePowderStats = Partial<Record<PowderStatColor, number>>;
export type ZombiePowderStatProgress = Partial<Record<PowderStatColor, number>>;

export const POWDER_STAT_BONUS_CAP = 12;
const POWDER_STAT_PROGRESS_PER_POWDER = 4;
const POWDER_STAT_PROGRESS_PER_BONUS = 85;
const POWDER_STAT_COLORS: PowderStatColor[] = ["red", "green", "blue", "white"];

export function isZombieColorMixerBucketKey(key: string): boolean {
  return key === ZOMBIE_COLOR_MIXER_BUCKET_KEY;
}

export function zombieColorMixerBucketPrice(ownedCount: number): ZombieColorMixerBucketPrice | null {
  return ZOMBIE_COLOR_MIXER_BUCKET_PRICES[ownedCount] ?? null;
}

export function sanitizeDyePowderAmount(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : NaN;
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(255, Math.floor(parsed)));
}

function cleanChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.trunc(Number.isFinite(value) ? value : 255)));
}

function cleanColor(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  return [cleanChannel(Number(value[0])), cleanChannel(Number(value[1])), cleanChannel(Number(value[2]))];
}

function colorName(color: PowderColor): string {
  return color;
}

function cleanStatBonus(value: unknown): number {
  return Math.max(0, Math.min(POWDER_STAT_BONUS_CAP, Math.trunc(Number(value) || 0)));
}

function cleanProgress(value: unknown): number {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

export function sanitizeZombiePowderStats(value?: Partial<Record<PowderStatColor, unknown>> | null): ZombiePowderStats {
  const out: ZombiePowderStats = {};
  let total = 0;
  for (const color of POWDER_STAT_COLORS) {
    const next = Math.min(cleanStatBonus(value?.[color]), POWDER_STAT_BONUS_CAP - total);
    if (next > 0) out[color] = next;
    total += next;
  }
  return out;
}

export function sanitizeZombiePowderStatProgress(
  value?: Partial<Record<PowderStatColor, unknown>> | null
): ZombiePowderStatProgress {
  const out: ZombiePowderStatProgress = {};
  for (const color of POWDER_STAT_COLORS) {
    const next = cleanProgress(value?.[color]);
    if (next > 0) out[color] = next;
  }
  return out;
}

export function totalZombiePowderStatBonus(stats?: ZombiePowderStats | null): number {
  const clean = sanitizeZombiePowderStats(stats);
  return POWDER_STAT_COLORS.reduce((sum, color) => sum + (clean[color] ?? 0), 0);
}

export function applyZombiePowderStatBonus(
  stats: ZombiePowderStats | undefined,
  progress: ZombiePowderStatProgress | undefined,
  powderColor: PowderColor,
  amount: number
): { stats: ZombiePowderStats; progress: ZombiePowderStatProgress; gained: number } {
  const nextStats = sanitizeZombiePowderStats(stats);
  const nextProgress = sanitizeZombiePowderStatProgress(progress);
  let total = totalZombiePowderStatBonus(nextStats);
  if (total >= POWDER_STAT_BONUS_CAP) return { stats: nextStats, progress: {}, gained: 0 };
  if (powderColor === "black") return { stats: nextStats, progress: nextProgress, gained: 0 };
  let pool = (nextProgress[powderColor] ?? 0) +
    sanitizeDyePowderAmount(amount) * POWDER_STAT_PROGRESS_PER_POWDER;
  let gained = 0;
  while (pool >= POWDER_STAT_PROGRESS_PER_BONUS && total < POWDER_STAT_BONUS_CAP) {
    pool -= POWDER_STAT_PROGRESS_PER_BONUS;
    nextStats[powderColor] = (nextStats[powderColor] ?? 0) + 1;
    total++;
    gained++;
  }
  if (total >= POWDER_STAT_BONUS_CAP) return { stats: nextStats, progress: {}, gained };
  if (pool > 0) nextProgress[powderColor] = pool;
  else delete nextProgress[powderColor];
  return { stats: nextStats, progress: nextProgress, gained };
}

export function applyZombieColorPowder(
  baseColor: readonly [number, number, number],
  powder: PowderColor,
  requestedAmount: number
): ZombieColorMixResult {
  const amount = sanitizeDyePowderAmount(requestedAmount);
  const next: [number, number, number] = [
    cleanChannel(baseColor[0]),
    cleanChannel(baseColor[1]),
    cleanChannel(baseColor[2]),
  ];
  const original: [number, number, number] = [...next];
  let used = 0;

  const changed = () => next[0] !== original[0] || next[1] !== original[1] || next[2] !== original[2];
  const too = () => `This zombie is too ${colorName(powder)} to use more of this colored powder.`;

  for (let i = 0; i < amount; i++) {
    if (powder === "white") {
      if (next[0] >= 255 && next[1] >= 255 && next[2] >= 255) break;
      next[0] = Math.min(255, next[0] + 1);
      next[1] = Math.min(255, next[1] + 1);
      next[2] = Math.min(255, next[2] + 1);
      used++;
      continue;
    }
    if (powder === "black") {
      if (next[0] <= 0 && next[1] <= 0 && next[2] <= 0) break;
      next[0] = Math.max(0, next[0] - 1);
      next[1] = Math.max(0, next[1] - 1);
      next[2] = Math.max(0, next[2] - 1);
      used++;
      continue;
    }

    const primaryIndex = powder === "red" ? 0 : powder === "green" ? 1 : 2;
    const otherA = primaryIndex === 0 ? 1 : 0;
    const otherB = primaryIndex === 2 ? 1 : 2;
    if (next[primaryIndex] < 255) {
      next[primaryIndex]++;
      used++;
      continue;
    }
    if (next[otherA] <= 0 && next[otherB] <= 0) break;
    next[otherA] = Math.max(0, next[otherA] - 1);
    next[otherB] = Math.max(0, next[otherB] - 1);
    used++;
  }

  return {
    color: next,
    amountUsed: used,
    ...(used < amount || !changed() ? { stopReason: too() } : {}),
  };
}

export function maxUsefulZombieColorPowder(
  baseColor: readonly [number, number, number],
  powder: PowderColor
): number {
  const [r, g, b] = [
    cleanChannel(baseColor[0]),
    cleanChannel(baseColor[1]),
    cleanChannel(baseColor[2]),
  ];
  if (powder === "white") return Math.max(255 - r, 255 - g, 255 - b);
  if (powder === "black") return Math.max(r, g, b);
  if (powder === "red") return (255 - r) + Math.max(g, b);
  if (powder === "green") return (255 - g) + Math.max(r, b);
  return (255 - b) + Math.max(r, g);
}

export function rgbToTint(color: readonly [number, number, number]): number {
  const [r, g, b] = [cleanChannel(color[0]), cleanChannel(color[1]), cleanChannel(color[2])];
  return (r << 16) | (g << 8) | b;
}

export function createZombieColorDyeJob(args: {
  unitId: string;
  zombieKey: string;
  zombieName?: string;
  baseColor: readonly [number, number, number];
  powderColor: PowderColor;
  amount: number;
  now?: number;
}): ZombieColorDyeJob | null {
  const amount = sanitizeDyePowderAmount(args.amount);
  const inputColor = cleanColor(args.baseColor);
  if (!args.unitId || !args.zombieKey || !inputColor) return null;
  const result = applyZombieColorPowder(inputColor, args.powderColor, amount);
  if (result.amountUsed !== amount) return null;
  const now = Math.max(0, Math.trunc(args.now ?? Date.now()));
  return {
    unitId: args.unitId,
    zombieKey: args.zombieKey,
    ...(args.zombieName ? { zombieName: args.zombieName } : {}),
    powderColor: args.powderColor,
    amount,
    inputColor,
    outputColor: result.color,
    startedAt: now,
    finishAt: now + ZOMBIE_COLOR_MIXER_DURATION_MS,
  };
}

export function sanitizeZombieColorDyeJob(value: unknown): ZombieColorDyeJob | null {
  if (!value || typeof value !== "object") return null;
  const job = value as Partial<ZombieColorDyeJob>;
  if (!job.unitId || !job.zombieKey) return null;
  if (!["red", "green", "blue", "white", "black"].includes(String(job.powderColor))) return null;
  const inputColor = cleanColor(job.inputColor);
  const outputColor = cleanColor(job.outputColor);
  if (!inputColor || !outputColor) return null;
  const amount = sanitizeDyePowderAmount(job.amount);
  const startedAt = Math.max(0, Math.trunc(Number(job.startedAt) || 0));
  const finishAt = Math.max(startedAt, Math.trunc(Number(job.finishAt) || startedAt + ZOMBIE_COLOR_MIXER_DURATION_MS));
  return {
    unitId: String(job.unitId),
    zombieKey: String(job.zombieKey),
    ...(job.zombieName ? { zombieName: String(job.zombieName) } : {}),
    powderColor: job.powderColor as PowderColor,
    amount,
    inputColor,
    outputColor,
    startedAt,
    finishAt,
  };
}

export function sanitizeZombieColorDyeJobs(
  jobs?: Record<string, Partial<ZombieColorDyeJob> | null> | null
): Record<string, ZombieColorDyeJob> {
  const out: Record<string, ZombieColorDyeJob> = {};
  for (const [id, value] of Object.entries(jobs ?? {})) {
    const job = sanitizeZombieColorDyeJob(value);
    if (id && job) out[id] = job;
  }
  return out;
}
