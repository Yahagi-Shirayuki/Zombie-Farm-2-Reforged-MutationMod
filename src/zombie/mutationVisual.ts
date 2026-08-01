import type { ZombieDef } from "../assets";
import { bitsOf } from "./mutations";

export type MutationReplacement = "body" | "armF" | "head";

const CARROT_MUTATION_BIT = 4;

/**
 * Mutation bits that should contribute artwork for this species. Named special
 * zombies already have authored faces, so the generic carrot-eye attachment is
 * intentionally omitted there. The bit remains on the zombie and still affects
 * stats; this only controls the rendered rig.
 */
export function mutationBitsForRendering(
  zombies: readonly Pick<ZombieDef, "key" | "category">[] | undefined,
  key: string,
  mutation: number,
): number[] {
  const isSpecial = zombies?.some((zombie) =>
    zombie.key === key && zombie.category === "special"
  ) ?? false;
  return bitsOf(mutation).filter((bit) => !(isSpecial && bit === CARROT_MUTATION_BIT));
}

/**
 * Authored face/accessory layers that remain in front when a crop mutation
 * replaces the skull. Features cover species-specific hair, hats, glasses,
 * ears, and similar decorations (notably every Garden-zombie topper).
 */
export function isMutationForegroundPart(file: string): boolean {
  return /(?:Eye[LR]|Jaw|LowerTeeth|Hair|Hat|Feature|Beard|Mustache)(?:\.png)?$/i.test(file);
}

/** True when a base-model part should be hidden by a replacement mutation. */
export function matchesMutationReplacement(
  file: string,
  replacement: MutationReplacement,
): boolean {
  return replacement === "body"
    ? /Body(?:\.png)?$/i.test(file)
    : replacement === "armF"
      ? /ArmF(?:\.png)?$/i.test(file)
      : /(?:Head|UpperTeeth|Scar)(?:\.png)?$/i.test(file)
        && !isMutationForegroundPart(file);
}
