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

// ---- Browse filters ------------------------------------------------------
// The catalog has two real axes, and the toolbar cuts along both: the colour class
// (the tier ladder Green -> Blue -> Red -> Silver, then the specials) and the body
// family. Beware the vocabulary crossover — the player calls the colour axis the
// "category" and the family axis the "class", while the catalog data calls them
// `className` and `group`. The wire values below are the DATA's words so no
// translation table is needed server-side; only `label` is the player's.

export interface BlackMarketFilterOption {
  /** Value sent to the server; matches the catalog field exactly. */
  value: string;
  /** Toolbar text. */
  label: string;
  /** Extra catalog values folded into this option. */
  also?: readonly string[];
}

/** Colour-class options — the toolbar's "category" dropdown. */
export const BLACK_MARKET_CLASS_FILTERS: readonly BlackMarketFilterOption[] = [
  { value: "Green", label: "Green" },
  { value: "Blue", label: "Blue" },
  { value: "Red", label: "Red" },
  { value: "Silver", label: "Silver" },
  // Yellow is the tier-less uniques (Crazy, Cupid). There is no Yellow rung on the
  // ladder and a player reads them as specials, so they file under Special.
  { value: "Special", label: "Special", also: ["Yellow"] },
];

/** Body-family options — the toolbar's "class" dropdown. */
export const BLACK_MARKET_GROUP_FILTERS: readonly BlackMarketFilterOption[] = [
  { value: "Regular", label: "Normal" },
  { value: "Female", label: "Girl" },
  { value: "Large", label: "Large" },
  { value: "Garden", label: "Garden" },
  { value: "Headless", label: "Headless" },
  { value: "Small", label: "Mini" },
];

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

/** Mutations a wanted post may name. The stored column is capped at 8191 by
 * `black_market_orders.mutation_required`'s CHECK (migration 0030) — the OR of the
 * 13 bits that existed then — and SQLite cannot widen a CHECK in place, so the
 * headless-only Pumpking (8192) is not requestable yet. The compose form greys it
 * out and the Worker rejects it, rather than letting D1 fail the INSERT. */
export const REQUESTABLE_MUTATION_MASK = ALL_BITS.reduce((mask, bit) => mask | bit, 0) & 8191;

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
import { ALL_BITS, MUTATIONS, SLOTS, SLOT_MASK } from "./zombie/mutations";
