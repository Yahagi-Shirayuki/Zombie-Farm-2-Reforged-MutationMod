export const POWDER_MACHINE_KEY = "powderMachine";
export const POWDER_MACHINE_PURCHASE_LIMIT = 4;

export type PowderColor = "black" | "green" | "blue" | "red" | "white";

export interface PowderColorInfo {
  key: PowderColor;
  name: string;
  tint: number;
  crystalCropKey: string;
  crystalName: string;
  crystalIcon: string;
  powderIcon: string;
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
  black: {
    key: "black",
    name: "Black",
    tint: 0x16192b,
    crystalCropKey: "oatnyx",
    crystalName: "Oatnyx",
    crystalIcon: "oat_icon.png",
    powderIcon: "powder_black.png",
  },
  green: {
    key: "green",
    name: "Green",
    tint: 0x36e30b,
    crystalCropKey: "malakale",
    crystalName: "Malakale",
    crystalIcon: "kale_icon.png",
    powderIcon: "powder_green.png",
  },
  blue: {
    key: "blue",
    name: "Blue",
    tint: 0x024ce0,
    crystalCropKey: "blueberyl",
    crystalName: "Blueberyl",
    crystalIcon: "blueberry_icon.png",
    powderIcon: "powder_blue.png",
  },
  red: {
    key: "red",
    name: "Red",
    tint: 0xff003f,
    crystalCropKey: "spinalch",
    crystalName: "Spinalch",
    crystalIcon: "spinach_icon.png",
    powderIcon: "powder_red.png",
  },
  white: {
    key: "white",
    name: "White",
    tint: 0xc1bfd1,
    crystalCropKey: "diamint",
    crystalName: "Diamint",
    crystalIcon: "mint_icon.png",
    powderIcon: "powder_white.png",
  },
};

export const POWDER_STORAGE_DISPLAY: readonly PowderColor[] = ["red", "green", "blue", "white", "black"];
export const GRIND_TIME_PER_CRYSTAL = 3 * 60 * 1000;
export const GRIND_CRYSTAL_CAPACITY = 40;
export const POWDER_PER_CRYSTAL_MIN = 7;
export const POWDER_PER_CRYSTAL_MAX = 9;

const POWDER_COLOR_KEYS: readonly PowderColor[] = ["black", "green", "blue", "red", "white"];

export const CRYSTAL_CROP_HARVESTS: Readonly<Record<string, {
  color: PowderColor;
  min: number;
  max: number;
}>> = {
  spinalch: { color: "red", min: 5, max: 7 },
  malakale: { color: "green", min: 6, max: 8 },
  blueberyl: { color: "blue", min: 8, max: 10 },
  diamint: { color: "white", min: 10, max: 13 },
  oatnyx: { color: "black", min: 12, max: 15 },
};

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

export function rollCropCrystalHarvest(
  cropKey: string,
  fertilized: boolean,
  random: () => number = Math.random
): { color: PowderColor; count: number } | null {
  const rule = CRYSTAL_CROP_HARVESTS[cropKey];
  if (!rule) return null;
  const base = randomInt(rule.min, rule.max, random);
  return { color: rule.color, count: fertilized ? base * 2 : base };
}
