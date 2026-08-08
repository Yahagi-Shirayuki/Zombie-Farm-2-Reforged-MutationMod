import type { MutationPart, ZombieDef, ZombieModel } from "../assets";
import { bitOf, bitsOf, mutationOf, slotOf } from "./mutations";

export type MutationReplacement = "body" | "armF" | "head";

const CARROT_MUTATION_BIT = bitOf("carrot");
const PUMPKING_BIT = bitOf("pumpking");

/**
 * The art a mutation draws on a given model, or undefined when this build ships no
 * part for it (an incomplete asset never removes a base part — see the rigs).
 *
 * Both mutations.json and a model's `mutationOverrides` are keyed by the mutation's
 * KEY ("pumpking"). A raw bit key ("8192") is still accepted as a fallback so art
 * authored against the old numeric form — including an existing mod's — keeps
 * resolving. Overrides are how the Tier-4 variants show their own art for a mutation
 * they share (carrot -> eyebiscusHat, cauli -> heartichokeBody).
 */
export function mutationPartFor(
  parts: Readonly<Record<string, MutationPart>>,
  model: Pick<ZombieModel, "mutationOverrides"> | undefined,
  bit: number,
): MutationPart | undefined {
  const key = mutationOf(bit)?.key;
  const overrides = model?.mutationOverrides;
  const named = (key ? overrides?.[key] : undefined) ?? overrides?.[String(bit)];
  if (named) return parts[named];
  return (key ? parts[key] : undefined) ?? parts[String(bit)];
}

/**
 * Does this mutation replace the whole head, face and all?
 *
 * The vegetable heads are worn AROUND the zombie's own face: an Onionhead keeps its
 * eyes, jaw and teeth in front of the onion, which is the entire reason head parts
 * are re-layered rather than hidden. The pumpkin is not one of those — it is a
 * carved head with a face already on it, so a zombie showing its own eyes and jaw
 * through it would be wearing two faces at once.
 *
 * Only matters for a zombie that HAS a face: the headless family it was authored for
 * has no head parts to hide.
 */
export function mutationCoversFace(bit: number): boolean {
  return bit === PUMPKING_BIT;
}

/** Carrot-eyed and its Eyebiscus visual override are eye attachments, so they
 * must remain visible above every authored body part, mutation, and actor FX. */
export const EYE_MUTATION_FOREGROUND_Z = 100;

export function mutationPartZIndex(
  bit: number,
  group: "head" | "root",
  authoredZ: number,
): number {
  if (slotOf(bit) === "hair_eye") return EYE_MUTATION_FOREGROUND_Z;
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
