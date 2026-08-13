import {
  addMutationRef,
  mutationOf,
  mutationRefs,
  occupiedMutationSlots,
  refGrowable,
  resolveMutationBit,
  resolveMutationRef,
  secondaryArmMutationKey,
  slotOfRef,
  type MutationRef,
  type MutationSet,
} from "./mutations";

/** A crop table: which mutations each crop key grows. One name, or a list of them. */
export type CropMutationTable =
  Readonly<Record<string, MutationRef | readonly MutationRef[]>>;

/** Which mutations a vegetable crop grows on a zombie planted beside it.
 *
 * Keys are crop keys from public/assets/plants.json; values name mutations from the
 * catalog in mutations.ts. Vanilla mutations resolve to legacy bits; local modded
 * mutations resolve to string ids and are stored in mutationIds. Arm-slot mutations
 * automatically expose a `${key}_b` back-arm pair, so a crop only names the primary
 * arm mutation. A crop may grant several mutations by listing them: each one rolls
 * on its own. */
export const CROP_MUTATIONS: CropMutationTable = {
  tomato: "tomato",
  onion: "onion",
  carrot: ["carrot", "carrot_arm"],
  eyebiscus: "carrot",
  turnip: ["turnip", "turnip_head", "turnip_eye"],
  potato: "potato",
  coffee: "coffee",
  celery: "celery",
  broccoli: "broccoli",
  garlic: "garlic",
  cauliflower: "cauli",
  heartichoke: "cauli",
  lima_beans: "limabean",
  venus_flytrap: "flytrap",
  dragon_fruit: "dragon",
  pumpking: "pumpking",
  // mod stuffs
  breadfruit: "bread_neck",
  sampaguita: "sampaguita_hair",
  corn: ["corn_head", "corn_arm"],
  Spineapple: "spineapple_body",
  malakale: "kale_arm",
  blueberyl: "berry_eye",
  spinalch: "spinach_hair",
  Bloodberry: "bloodberry_hair",
  skellyberry: "skellyberry_body",
  reddelicious: "apple_head",
  felonmelon: "melon_head",

};

export function cropMutationRefs(
  cropKey: string,
  crops: CropMutationTable = CROP_MUTATIONS,
): MutationRef[] {
  const refs = crops[cropKey];
  if (refs === undefined) return [];
  const list: readonly MutationRef[] = Array.isArray(refs) ? refs : [refs as MutationRef];
  const out: MutationRef[] = [];
  for (const ref of list) {
    const resolved = resolveMutationRef(ref);
    if (resolved !== null && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

/** Back-compat helper for tests and old numeric-only callers. Modded ids are omitted. */
export function cropMutationBits(
  cropKey: string,
  crops: CropMutationTable = CROP_MUTATIONS,
): number[] {
  const refs = crops[cropKey];
  if (refs === undefined) return [];
  const list: readonly MutationRef[] = Array.isArray(refs) ? refs : [refs as MutationRef];
  const out: number[] = [];
  for (const ref of list) {
    const bit = resolveMutationBit(ref);
    if (bit !== null && !out.includes(bit)) out.push(bit);
  }
  return out;
}

export const CROP_MUTATION_CHANCE = 0.25;
export const MATCHING_BACK_ARM_CHANCE_MULTIPLIER = 0.1;
export const GUARANTEED_BACK_ARM_CHANCE = 0.5;

function pairedBackArmRef(ref: MutationRef): MutationRef | null {
  const key = mutationOf(ref)?.key;
  if (!key || slotOfRef(ref) !== "arm") return null;
  const resolved = resolveMutationRef(secondaryArmMutationKey(key));
  return resolved !== null && slotOfRef(resolved) === "armB" ? resolved : null;
}

function mutationChance(count: number, guaranteed: boolean): number {
  return guaranteed ? 1 : Math.min(1, count * CROP_MUTATION_CHANCE);
}

function frontArmKey(set: MutationSet): string | null {
  for (const ref of mutationRefs(set.mask, set.ids)) {
    if (slotOfRef(ref) === "arm") return mutationOf(ref)?.key ?? null;
  }
  return null;
}

function backArmChance(baseChance: number, frontKey: string | null, pairedWith: MutationRef, guaranteed: boolean): number {
  const pairedKey = mutationOf(pairedWith)?.key ?? null;
  if (!frontKey || pairedKey !== frontKey) return baseChance;
  return guaranteed ? GUARANTEED_BACK_ARM_CHANCE : baseChance * MATCHING_BACK_ARM_CHANCE_MULTIPLIER;
}

function chanceSucceeds(chance: number, random: () => number): boolean {
  return chance >= 1 || random() < chance;
}

export function plotsTouch(
  ac: number, ar: number, bc: number, br: number, plotSize: number
): boolean {
  if (ac === bc && ar === br) return false;
  return Math.abs(bc - ac) <= plotSize && Math.abs(br - ar) <= plotSize;
}

export interface CropMutationOptions {
  guaranteed?: boolean;
  headless?: boolean;
  random?: () => number;
  crops?: CropMutationTable;
}

export function resolveCropMutationSet(
  baseMask: number,
  baseIds: readonly string[] | undefined,
  adjacentCropKeys: readonly string[],
  options: CropMutationOptions = {}
): MutationSet {
  const counts = new Map<MutationRef, number>();
  for (const key of adjacentCropKeys) {
    for (const ref of cropMutationRefs(key, options.crops)) {
      counts.set(ref, (counts.get(ref) ?? 0) + 1);
    }
  }

  const random = options.random ?? Math.random;
  const guaranteed = !!options.guaranteed;
  const successes: { ref: MutationRef; roll: number; chance: number }[] = [];
  for (const [ref, count] of counts) {
    if (!refGrowable(ref, !!options.headless)) continue;
    const roll = random();
    const chance = mutationChance(count, guaranteed);
    if (chance >= 1 || roll < chance) successes.push({ ref, roll, chance });
  }

  const growthRank = (ref: MutationRef): number => slotOfRef(ref) === "armB" ? 1 : 0;
  successes.sort((a, b) => (
    growthRank(a.ref) - growthRank(b.ref) ||
    a.roll - b.roll ||
    String(a.ref).localeCompare(String(b.ref))
  ));
  const startingSlots = occupiedMutationSlots(baseMask, baseIds);
  let set: MutationSet = { mask: baseMask, ids: [...(baseIds ?? [])] };
  for (const success of successes) {
    const slot = slotOfRef(success.ref);
    if (slot === "arm") {
      const backArmRef = pairedBackArmRef(success.ref);
      if (!startingSlots.has("arm")) set = addMutationRef(set, success.ref, !!options.headless);
      if (backArmRef && occupiedMutationSlots(set.mask, set.ids).has("arm") &&
          refGrowable(backArmRef, !!options.headless)) {
        const chance = backArmChance(success.chance, frontArmKey(set), success.ref, guaranteed);
        if (chanceSucceeds(chance, random)) set = addMutationRef(set, backArmRef, !!options.headless);
      }
      continue;
    }
    // Explicit back-arm entries are secondary growth too: the front arm must exist,
    // either before this harvest pass or from an earlier successful roll in it.
    if (slot === "armB" && !occupiedMutationSlots(set.mask, set.ids).has("arm")) continue;
    set = addMutationRef(set, success.ref, !!options.headless);
  }
  return set;
}

/** Numeric-only compatibility wrapper. New code should use resolveCropMutationSet. */
export function resolveCropMutations(
  baseMask: number,
  adjacentCropKeys: readonly string[],
  options: CropMutationOptions = {}
): number {
  return resolveCropMutationSet(baseMask, [], adjacentCropKeys, options).mask;
}
