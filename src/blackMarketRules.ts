export const BLACK_MARKET_SPECIAL_LEVEL = 20;
export const BLACK_MARKET_COLOR_LEVELS = {
  Blue: 1,
  Red: 15,
  Silver: 25,
} as const;

export type BlackMarketPurchaseLock = { kind: "level"; level: number; label: string };

export interface BlackMarketZombieRequirement {
  category?: "normal" | "special" | "mutant";
  unlockGrave?: "Blue" | "Red" | "Silver";
}

export type BlackMarketComposeKind = "BUY_ZOMBIE" | "SELL_ZOMBIE";

/** Initial values for the Create Post form. A roster-originated sale keeps the
 * concrete unit selected when the Black Market opens. */
export function blackMarketComposeDefaults(
  kind: BlackMarketComposeKind,
  selectedUnitId: string | undefined,
  availableUnitIds: readonly string[],
): { kind: BlackMarketComposeKind; assetId?: string } {
  return {
    kind,
    ...(kind === "SELL_ZOMBIE" && selectedUnitId && availableUnitIds.includes(selectedUnitId)
      ? { assetId: selectedUnitId }
      : {}),
  };
}

/** Black Market purchases ignore ordinary crop unlock levels. Colored classes unlock
 * at their gravestone's level, while every special zombie also has a level-20 gate. */
export function blackMarketPurchaseLock(
  zombie: BlackMarketZombieRequirement,
  playerLevel: number
): BlackMarketPurchaseLock | null {
  const requiredLevel = Math.max(
    zombie.category === "special" ? BLACK_MARKET_SPECIAL_LEVEL : 0,
    zombie.unlockGrave ? BLACK_MARKET_COLOR_LEVELS[zombie.unlockGrave] : 0
  );
  if (playerLevel < requiredLevel) {
    return {
      kind: "level",
      level: requiredLevel,
      label: `Level ${requiredLevel} required`,
    };
  }
  return null;
}

/** A specific request matches when the bit is present, even if the zombie carries
 * other mutations too. Without a specific bit, preserve the any/none behavior. */
export function matchesBlackMarketMutation(
  mutationMask: number,
  mutated: boolean,
  mutationRequired?: number
): boolean {
  if (mutationRequired === undefined) return (mutationMask !== 0) === mutated;
  return SLOTS.every((slot) => {
    const requestedInSlot = mutationRequired & SLOT_MASK[slot];
    return requestedInSlot === 0 || (mutationMask & requestedInSlot) !== 0;
  });
}

/** Human-readable grouped expression: alternatives within one anatomical slot use
 * "or", while requirements spanning separate slots use "+". */
export function blackMarketMutationRequirementLabel(mask: number): string {
  return SLOTS
    .map((slot) => Object.values(MUTATIONS)
      .filter((mutation) => mutation.slot === slot && (mask & mutation.bit) !== 0)
      .map((mutation) => mutation.name)
      .join(" or "))
    .filter(Boolean)
    .join(" + ");
}
import { MUTATIONS, SLOTS, SLOT_MASK } from "./zombie/mutations";
