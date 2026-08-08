import type { MutationPart, ZombieDef, ZombieModel } from "../assets";
import { bitOf, mutationOf, mutationRefs, slotOfRef, type MutationRef } from "./mutations";

export type MutationReplacement = "body" | "armF" | "head";

const CARROT_MUTATION_BIT = bitOf("carrot");
const PUMPKING_BIT = bitOf("pumpking");

export function mutationPartFor(
  parts: Readonly<Record<string, MutationPart>>,
  model: Pick<ZombieModel, "mutationOverrides"> | undefined,
  ref: MutationRef,
): MutationPart | undefined {
  const def = mutationOf(ref);
  const key = def?.key;
  const raw = String(ref);
  const overrides = model?.mutationOverrides;
  const named = (key ? overrides?.[key] : undefined) ?? overrides?.[raw];
  if (named) return parts[named];
  return (key ? parts[key] : undefined) ?? parts[raw];
}

export function mutationCoversFace(ref: MutationRef): boolean {
  return ref === PUMPKING_BIT || mutationOf(ref)?.key === "pumpking";
}

export const EYE_MUTATION_FOREGROUND_Z = 100;

export function mutationPartZIndex(
  ref: MutationRef,
  group: "head" | "root",
  authoredZ: number,
): number {
  if (slotOfRef(ref) === "hair_eye") return EYE_MUTATION_FOREGROUND_Z;
  if (group === "head") return 4.5;
  return authoredZ;
}

export function mutationRefsForRendering(
  zombies: readonly Pick<ZombieDef, "key" | "category">[] | undefined,
  key: string,
  mutation: number,
  mutationIds?: readonly string[],
): MutationRef[] {
  const isSpecial = zombies?.some((zombie) =>
    zombie.key === key && zombie.category === "special"
  ) ?? false;
  return mutationRefs(mutation, mutationIds).filter((ref) => !(isSpecial && ref === CARROT_MUTATION_BIT));
}

/** Numeric compatibility wrapper for older tests/callers. */
export function mutationBitsForRendering(
  zombies: readonly Pick<ZombieDef, "key" | "category">[] | undefined,
  key: string,
  mutation: number,
): number[] {
  return mutationRefsForRendering(zombies, key, mutation).filter((ref): ref is number => typeof ref === "number");
}

export function isMutationForegroundPart(file: string): boolean {
  return /(?:Eye[LR]|Jaw|LowerTeeth|Hair|Hat|Feature|Beard|Mustache)(?:\.png)?$/i.test(file);
}

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
