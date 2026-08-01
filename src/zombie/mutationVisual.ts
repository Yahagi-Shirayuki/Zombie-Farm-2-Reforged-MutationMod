import type { ZombieDef } from "../assets";
import { bitsOf } from "./mutations";

export type MutationReplacement = "body" | "armF" | "head";

const CARROT_MUTATION_BIT = 4;

/** Carrot-eyed and its Eyebiscus visual override are eye attachments, so they
 * must remain visible above every authored body part, mutation, and actor FX. */
export const EYE_MUTATION_FOREGROUND_Z = 100;

export function mutationPartZIndex(
  bit: number,
  group: "head" | "root",
  authoredZ: number,
): number {
  if (bit === CARROT_MUTATION_BIT) return EYE_MUTATION_FOREGROUND_Z;
  if (group === "head") return 4.5;
  return authoredZ;
}

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
