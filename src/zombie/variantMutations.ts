// ---------------------------------------------------------------------------
// Tier-4 variant mutations: retiring the shared bit
// ---------------------------------------------------------------------------
// Eyebiscus and Heartichoke shipped RIDING a lower tier's mutation — an Eyebiscus
// Zombie carried Carrot-eyed's bit, a Heartichoke Zombie carried Cauli-hair's — so the
// two most expensive mutation crops in the game granted a Tier-1 bonus, and a
// Heartichoke filed itself under the hair slot while visibly wearing a body.
//
// Both are catalogued mutations of their own now (see mutations.ts CATALOG). Units
// grown, bought, or combined before that still hold the shared bit, in every save
// blob and in roster_v3, so the old bit is upgraded wherever a mask lands on a unit.
//
// This runs inside `makeOwned`, which the client AND the server's raid verifier both
// call — one implementation, so a legacy unit's stats can never come out different on
// the two sides and desync a replay. server/migrations/0050 does the same rewrite in
// D1 so the stored rows stop needing it; until it is applied (and for offline saves,
// which have no migration at all) this is what keeps them honest.
import { bitOf, SLOT_MASK, slotOf, type MutationKey } from "./mutations";
import { maskHas, maskUnion, maskWithout } from "./mutationMask";

/** Species key -> the shared mutation it used to ride -> the mutation it owns now.
 *  MIRRORS the legacy half of MUTATION_VARIANTS in mutationDisplay.ts, which still
 *  supplies the right name and art for a unit whose row hasn't been rewritten yet. */
export const VARIANT_MUTATION_UPGRADE: Readonly<Record<string, Readonly<Record<MutationKey, MutationKey>>>> = {
  ZombieActorRegularTier4Eyebiscus: { carrot: "eyebiscus" },
  ZombieActorRegularTier4Heartichoke: { cauli: "heartichoke" },
};

/**
 * `mask` with any shared bit this species has outgrown swapped for the mutation it
 * owns now. Returns the mask unchanged for every other species — which is all but two
 * of them — and for a unit already carrying the new bit.
 *
 * The replacement TAKES its slot, evicting whatever else sat there. That only bites a
 * Heartichoke that had also grown a Lima Bean (both are body mutations, and the two
 * could coexist only while Heartichoke was misfiled under hair): the eviction is
 * exactly what the Zombie Pot would do, since the higher bit wins its slot, and
 * Heartichoke's +5 Life is the better of the two anyway.
 */
export function upgradeVariantMutations(key: string, mask: number): number {
  const upgrades = VARIANT_MUTATION_UPGRADE[key];
  if (!upgrades) return mask;
  let out = mask;
  for (const [legacyKey, ownKey] of Object.entries(upgrades)) {
    const legacyBit = bitOf(legacyKey);
    if (!maskHas(out, legacyBit)) continue;
    const ownBit = bitOf(ownKey);
    const slot = slotOf(ownBit)!;
    out = maskUnion(maskWithout(maskWithout(out, legacyBit), SLOT_MASK[slot]), ownBit);
  }
  return out;
}
