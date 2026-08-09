import type { MutationPart, ZombieDef, ZombieModel } from "../assets";
import {
  bitOf,
  mutationOf,
  mutationRefs,
  SECONDARY_ARM_SUFFIX,
  secondaryArmMutationKey,
  slotOfRef,
  type MutationRef,
} from "./mutations";

export type MutationReplacement = "body" | "armF" | "armB" | "head";

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
  const direct = (key ? parts[key] : undefined) ?? parts[raw];
  if (direct) return direct;
  if (!key || def?.slot !== "armB" || !key.endsWith(SECONDARY_ARM_SUFFIX)) return undefined;
  const primaryKey = key.slice(0, -SECONDARY_ARM_SUFFIX.length);
  if (secondaryArmMutationKey(primaryKey) !== key) return undefined;
  const primaryName = overrides?.[primaryKey] ?? primaryKey;
  const primary = parts[primaryName];
  if (!primary) return undefined;
  return {
    ...primary,
    ox: primary.ox - 12,
    oy: primary.oy + 4,
    z: 0,
    replaces: "armB",
  };
}

export function mutationPartForFacing(
  parts: Readonly<Record<string, MutationPart>>,
  model: Pick<ZombieModel, "mutationOverrides"> | undefined,
  ref: MutationRef,
  swapArmSlots: boolean,
): MutationPart | undefined {
  if (!swapArmSlots) return mutationPartFor(parts, model, ref);
  const def = mutationOf(ref);
  if (def?.slot === "arm") {
    return mutationPartFor(parts, model, secondaryArmMutationKey(def.key));
  }
  if (def?.slot === "armB" && def.key.endsWith(SECONDARY_ARM_SUFFIX)) {
    const primaryKey = def.key.slice(0, -SECONDARY_ARM_SUFFIX.length);
    return mutationPartFor(parts, model, primaryKey);
  }
  return mutationPartFor(parts, model, ref);
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

export function shouldPromoteBaseHeadForegroundPart(file: string, z: number): boolean {
  return z > 4 && isMutationForegroundPart(file);
}

export function mutationReplacementFor(
  ref: MutationRef,
  part: Pick<MutationPart, "replaces">,
): MutationReplacement | undefined {
  if (part.replaces) return part.replaces;
  const slot = slotOfRef(ref);
  if (slot === "head") return "head";
  if (slot === "arm") return "armF";
  if (slot === "armB") return "armB";
  if (slot === "body") return "body";
  return undefined;
}

export function matchesMutationReplacement(
  file: string,
  replacement: MutationReplacement,
): boolean {
  if (replacement === "body") return /Body(?:\.png)?$/i.test(file);
  if (replacement === "armF") return /ArmF(?:\.png)?$/i.test(file);
  if (replacement === "armB") return /ArmB(?:\.png)?$/i.test(file);
  return /(?:Head|UpperTeeth|Scar)(?:\.png)?$/i.test(file)
    && !isMutationForegroundPart(file);
}
