export const POWDER_MACHINE_KEY = "powderMachine";
export const POWDER_MACHINE_PURCHASE_LIMIT = 4;

export type PowderColor = "black" | "green" | "blue" | "red" | "white";

export interface PowderColorInfo {
  key: PowderColor;
  name: string;
  tint: number;
}

export interface PowderStorage {
  crystals: Record<PowderColor, number>;
  powders: Record<PowderColor, number>;
}

export interface PowderGrindJob {
  crystals: Record<PowderColor, number>;
  powders: Record<PowderColor, number>;
  startedAt: number;
  finishAt: number;
}

export const POWDER_COLORS: Record<PowderColor, PowderColorInfo> = {
  black: { key: "black", name: "Black", tint: 0x16192b },
  green: { key: "green", name: "Green", tint: 0x36e30b },
  blue: { key: "blue", name: "Blue", tint: 0x024ce0 },
  red: { key: "red", name: "Red", tint: 0xff003f},
  white: { key: "white", name: "White", tint: 0xc1bfd1 },
};

export const POWDER_STORAGE_DISPLAY: readonly PowderColor[] = ["red", "green", "blue", "white", "black"];
export const POMEGRANITE_CRYSTAL_BY_VARIANT: readonly PowderColor[] = ["black", "green", "blue", "red", "white"];
export const GRIND_TIME_PER_CRYSTAL = 3 * 60 * 1000;
export const GRIND_CRYSTAL_CAPACITY = 20;
export const POWDER_PER_CRYSTAL_MIN = 7;
export const POWDER_PER_CRYSTAL_MAX = 9;

const POWDER_COLOR_KEYS: readonly PowderColor[] = ["black", "green", "blue", "red", "white"];

const POWDER_MACHINE_PRICES = [
  { cost: 25_000, brains: false },
  { cost: 5, brains: true },
  { cost: 10, brains: true },
  { cost: 20, brains: true },
] as const;

export interface PowderMachinePrice {
  cost: number;
  brains: boolean;
}

function cleanCount(value: unknown): number {
  return Math.max(0, Math.trunc(typeof value === "number" && Number.isFinite(value) ? value : 0));
}

function randomInt(min: number, max: number, random: () => number): number {
  const clamped = Math.max(0, Math.min(0.999999999, random()));
  return min + Math.floor(clamped * (max - min + 1));
}

export function isPowderMachineKey(key: string): boolean {
  return key === POWDER_MACHINE_KEY;
}

export function powderMachinePrice(ownedCount: number): PowderMachinePrice | null {
  return POWDER_MACHINE_PRICES[ownedCount] ?? null;
}

export function emptyPowderStorage(): PowderStorage {
  return {
    crystals: { black: 0, green: 0, blue: 0, red: 0, white: 0 },
    powders: { black: 0, green: 0, blue: 0, red: 0, white: 0 },
  };
}

export function emptyPowderCounts(): Record<PowderColor, number> {
  return { black: 0, green: 0, blue: 0, red: 0, white: 0 };
}

export function sanitizePowderCounts(input?: Partial<Record<PowderColor, number>> | null): Record<PowderColor, number> {
  const counts = emptyPowderCounts();
  for (const key of POWDER_COLOR_KEYS) counts[key] = cleanCount(input?.[key]);
  return counts;
}

export function sanitizePowderStorage(input?: Partial<{
  crystals: Partial<Record<PowderColor, number>>;
  powders: Partial<Record<PowderColor, number>>;
}> | null): PowderStorage {
  const storage = emptyPowderStorage();
  for (const key of POWDER_COLOR_KEYS) {
    storage.crystals[key] = cleanCount(input?.crystals?.[key]);
    storage.powders[key] = cleanCount(input?.powders?.[key]);
  }
  return storage;
}

export function totalPowderCount(input?: Partial<Record<PowderColor, number>> | null): number {
  return Object.values(sanitizePowderCounts(input)).reduce((sum, count) => sum + count, 0);
}

export function grindDurationMs(input?: Partial<Record<PowderColor, number>> | null): number {
  return Math.min(totalPowderCount(input), GRIND_CRYSTAL_CAPACITY) * GRIND_TIME_PER_CRYSTAL;
}

export function sanitizePowderGrindJob(input?: Partial<PowderGrindJob> | null): PowderGrindJob | null {
  if (!input) return null;
  const crystals = sanitizePowderCounts(input.crystals);
  const total = totalPowderCount(crystals);
  const startedAt = cleanCount(input.startedAt);
  const finishAt = cleanCount(input.finishAt);
  if (total <= 0 || total > GRIND_CRYSTAL_CAPACITY || finishAt < startedAt) return null;
  return { crystals, powders: sanitizePowderCounts(input.powders), startedAt, finishAt };
}

export function sanitizePowderGrinds(
  input?: Record<string, Partial<PowderGrindJob> | null> | null
): Record<string, PowderGrindJob> {
  const jobs: Record<string, PowderGrindJob> = {};
  for (const [id, job] of Object.entries(input ?? {})) {
    const clean = sanitizePowderGrindJob(job);
    if (id && clean) jobs[id] = clean;
  }
  return jobs;
}

export function rollPowderGrindJob(
  crystals: Partial<Record<PowderColor, number>>,
  startedAt = Date.now(),
  random: () => number = Math.random
): PowderGrindJob | null {
  const cleanCrystals = sanitizePowderCounts(crystals);
  const total = totalPowderCount(cleanCrystals);
  if (total <= 0 || total > GRIND_CRYSTAL_CAPACITY) return null;
  const powders = emptyPowderCounts();
  for (const key of POWDER_COLOR_KEYS) {
    for (let i = 0; i < cleanCrystals[key]; i++) {
      powders[key] += randomInt(POWDER_PER_CRYSTAL_MIN, POWDER_PER_CRYSTAL_MAX, random);
    }
  }
  return {
    crystals: cleanCrystals,
    powders,
    startedAt,
    finishAt: startedAt + grindDurationMs(cleanCrystals),
  };
}

export function pomegraniteCrystalColor(variant?: number): PowderColor | null {
  return Number.isInteger(variant) ? POMEGRANITE_CRYSTAL_BY_VARIANT[variant!] ?? null : null;
}

export function rollPomegraniteCrystalHarvest(
  cropKey: string,
  variant: number | undefined,
  fertilized: boolean,
  random: () => number = Math.random
): { color: PowderColor; count: number } | null {
  if (cropKey !== "pomegranite") return null;
  const color = pomegraniteCrystalColor(variant ?? 4);
  if (!color) return null;
  const base = randomInt(5, 10, random);
  return { color, count: fertilized ? base * 2 : base };
}
