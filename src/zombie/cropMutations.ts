import { addMutation, bitGrowable, slotOf } from "./mutations";

/** Mutation-bearing vegetable crops. Tier-4 visual variants intentionally share
 * the same mutation bit as their underlying Carrot/Cauliflower mutation. */
export const CROP_MUTATIONS: Readonly<Record<string, number>> = {
  tomato: 1,
  onion: 2,
  carrot: 4,
  eyebiscus: 4,
  turnip: 8,
  potato: 16,
  coffee: 32,
  celery: 64,
  broccoli: 128,
  garlic: 256,
  cauliflower: 512,
  heartichoke: 512,
  lima_beans: 1024,
  venus_flytrap: 2048,
  dragon_fruit: 4096,
  // Grows on the headless family ONLY (bitGrowable): a zombie that already has a head
  // never grows a pumpkin, however many are planted beside it. It can still inherit
  // one in the Zombie Pot — that is the only route to a Regular wearing it.
  pumpking: 8192,
};

export const CROP_MUTATION_CHANCE = 0.25;

/** Do two plot footprints of `plotSize` tiles square touch along an edge or a corner?
 *
 * Plots are free-placed: a plow stroke snaps to the lattice its own anchor tile
 * establishes (see plowSelection.snapPlowOrigin), so a plot laid down in a second
 * stroke can sit flush against the first without its origin being a whole plot away.
 * Testing the eight exact ±plotSize offsets — which is what this used to do — missed
 * every one of those neighbours, and crops beside an off-grid zombie plot never
 * mutated it. Footprints never overlap (Field.areaFree / engine.overlapsExistingPlot),
 * so "within one plot on both axes" is exactly "sharing an edge or a corner", and the
 * eight-neighbour maximum still holds: nine 4x4 footprints is all that fits in the
 * 12x12 span an origin this close can occupy. */
export function plotsTouch(
  ac: number, ar: number, bc: number, br: number, plotSize: number
): boolean {
  if (ac === bc && ar === br) return false; // the plot itself
  return Math.abs(bc - ac) <= plotSize && Math.abs(br - ar) <= plotSize;
}

export interface CropMutationOptions {
  guaranteed?: boolean;
  headless?: boolean;
  random?: () => number;
}

/** Resolve all crop-adjacency mutations for one harvested zombie.
 *
 * Each adjacent crop adds 25 percentage points to its mutation's chance, capped
 * at 100%. Different non-conflicting mutations roll independently. If multiple
 * successful crops target the same anatomical slot, the lowest random roll wins;
 * this prevents plot iteration order from deciding the conflict. */
export function resolveCropMutations(
  baseMask: number,
  adjacentCropKeys: readonly string[],
  options: CropMutationOptions = {}
): number {
  const counts = new Map<number, number>();
  for (const key of adjacentCropKeys) {
    const bit = CROP_MUTATIONS[key];
    if (bit) counts.set(bit, (counts.get(bit) ?? 0) + 1);
  }

  const random = options.random ?? Math.random;
  const successes: { bit: number; roll: number }[] = [];
  for (const [bit, count] of counts) {
    if (slotOf(bit) === null) continue;
    // A mutation this body type can't grow never even rolls — no wasted roll, and no
    // dependence on addMutation to refuse it further down.
    if (!bitGrowable(bit, !!options.headless)) continue;
    const roll = random();
    const chance = options.guaranteed ? 1 : Math.min(1, count * CROP_MUTATION_CHANCE);
    if (chance >= 1 || roll < chance) successes.push({ bit, roll });
  }

  successes.sort((a, b) => a.roll - b.roll || a.bit - b.bit);
  let mask = baseMask;
  for (const success of successes) mask = addMutation(mask, success.bit, !!options.headless);
  return mask;
}
