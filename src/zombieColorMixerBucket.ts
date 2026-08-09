import type { PowderColor } from "./powderMachine";

export const ZOMBIE_COLOR_MIXER_BUCKET_KEY = "zombieColorMixerBucket";
export const ZOMBIE_COLOR_MIXER_BUCKET_LIMIT = 3;

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

function colorName(color: PowderColor): string {
  return color;
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
