import {
  addMutationRef,
  refGrowable,
  resolveMutationBit,
  resolveMutationRef,
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
 * mutations resolve to string ids and are stored in mutationIds. A crop may grant
 * several mutations by listing them: each one rolls on its own. */
export const CROP_MUTATIONS: CropMutationTable = {
  tomato: "tomato",
  onion: "onion",
  carrot: "carrot",
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
  candycorn: ["corn_head", "corn_arm"],
  Spineapple: "spineapple_body",
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
  const successes: { ref: MutationRef; roll: number }[] = [];
  for (const [ref, count] of counts) {
    if (!refGrowable(ref, !!options.headless)) continue;
    const roll = random();
    const chance = options.guaranteed ? 1 : Math.min(1, count * CROP_MUTATION_CHANCE);
    if (chance >= 1 || roll < chance) successes.push({ ref, roll });
  }

  successes.sort((a, b) => a.roll - b.roll || String(a.ref).localeCompare(String(b.ref)));
  let set: MutationSet = { mask: baseMask, ids: [...(baseIds ?? [])] };
  for (const success of successes) set = addMutationRef(set, success.ref, !!options.headless);
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
