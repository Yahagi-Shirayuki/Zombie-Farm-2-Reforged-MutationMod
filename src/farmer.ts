import { buyXp } from "./economy";

export type FarmerEffectKey =
  | "harvestGold"
  | "zombieGrowTime"
  | "zombieLife"
  | "zombieStrength"
  | "invasionCooldown";

/** Source-priced head bonuses keyed by PlayerDictionary head ID. */
const HEAD_EFFECTS: Partial<Record<number, { key: FarmerEffectKey; amount: number }>> = {
  12: { key: "harvestGold", amount: 0.10 }, // Paper Bag
  14: { key: "harvestGold", amount: 0.10 }, // Pumpkin
  13: { key: "zombieGrowTime", amount: -0.25 }, // Monolith
  2: { key: "zombieLife", amount: 0.10 },
  6: { key: "zombieLife", amount: 0.10 },
  3: { key: "zombieStrength", amount: 0.10 },
  7: { key: "zombieStrength", amount: 0.10 },
  8: { key: "invasionCooldown", amount: -0.25 },
  9: { key: "invasionCooldown", amount: -0.25 },
};

export function farmerEffect(headId: number, key: FarmerEffectKey): number {
  const effect = HEAD_EFFECTS[headId];
  return effect?.key === key ? effect.amount : 0;
}

/** Whether this head carries a gameplay bonus at all. Heads without one are pure
 *  cosmetics, so they never appear in the FUNCTION slot (see farmerBonusHeadId):
 *  a player who owns none of these never has to think about that slot existing. */
export const farmerHeadHasEffect = (headId: number): boolean => !!HEAD_EFFECTS[headId];

/** Resolve the head whose bonus is actually live. `null` (the default, and every
 *  save written before the slot split) means "follow the head being WORN" — which
 *  is exactly the single-slot behaviour that shipped before, so nobody's bonus
 *  changes until they deliberately pin one. */
export const activeBonusHeadId = (
  wornHeadId: number,
  bonusHeadId: number | null | undefined
): number => (bonusHeadId === null || bonusHeadId === undefined ? wornHeadId : bonusHeadId);

/** XP granted for BUYING a Farmer head, derived from its price by the same
 *  recovered `xpFromItem:` formula the Market uses for objects (see economy.ts):
 *  brain-priced items grant cost*80 when they do something functional and cost*100
 *  when they are cosmetic. A head with a bonus is the functional case. */
export const farmerHeadXp = (head: { cost?: number; brains?: boolean; id: number }): number =>
  buyXp(head.cost ?? 0, 0, !!head.brains, farmerHeadHasEffect(head.id) ? "functional" : "decor");

export const farmerMultiplier = (headId: number, key: FarmerEffectKey): number =>
  1 + farmerEffect(headId, key);

export const farmerGold = (value: number, headId: number): number =>
  Math.max(0, Math.round(value * farmerMultiplier(headId, "harvestGold")));

export const farmerZombieGrowMs = (value: number, headId: number): number =>
  Math.max(1, Math.round(value * farmerMultiplier(headId, "zombieGrowTime")));

export const farmerCooldownMs = (value: number, headId: number): number =>
  Math.max(0, Math.round(value * farmerMultiplier(headId, "invasionCooldown")));
