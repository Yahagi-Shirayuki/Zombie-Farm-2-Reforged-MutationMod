// ---------------------------------------------------------------------------
// Economy rules — the single recorded source of truth for buy/sell/XP balancing.
// ---------------------------------------------------------------------------
// Keep tunable economy numbers here (not scattered as magic numbers) so the
// balance is easy to find, reason about, and adjust.
//
// Design intent (placeable items — decor / trees / functional):
//   - Gold purchases retain authored XP, falling back to floor(cost / 100)
//     when the source Market row omits it.
//   - Brain purchases derive XP from cost using the recovered binary formula.
//   - SELLING an item refunds only a small fraction of its price, so churning
//     buy->sell is a real loss, not a free way to farm money.
// ---------------------------------------------------------------------------

export const ECONOMY = {
  /**
   * Fraction of an item's purchase price refunded when it is sold. Selling is
   * meant to be a significant loss versus buying, so this is well below 1.
   * (Was 0.5; lowered so sell value is "significantly less than bought for".)
   */
  SELL_BACK_RATIO: 0.2,
  BRAIN_SELL_GOLD_RATE: 1_000,

} as const;

export type PlaceablePurchaseCategory = "tree" | "decor" | "functional" | "reward";

/** XP granted for buying/placing an item. The shipped binary's
 * `+[MarketDataManager xpFromItem:]` derives brain-purchase XP from the price:
 * decor/tree items grant binary-era cost*10 and functional (`special`) items
 * grant binary-era cost*8. Reforged undid brainflation by dividing brain prices
 * by ten, so the equivalent formulas against current prices are cost*100 and
 * cost*80 respectively. Gold purchases keep positive authored XP; source rows
 * with missing/zero XP use the normal floor(cost / 100) gold-value award. */
export function buyXp(
  cost: number,
  sourceXp = 0,
  brainsNeeded = false,
  category: PlaceablePurchaseCategory = "decor"
): number {
  if (brainsNeeded) {
    return Math.max(0, Math.trunc(cost)) * (category === "functional" ? 80 : 100);
  }
  const authoredXp = Math.max(0, sourceXp);
  return authoredXp > 0 ? authoredXp : Math.floor(Math.max(0, cost) / 100);
}

/** Gold paid when selling an item bought for `cost`. Brain prices convert at
 * 1,000 gold per brain; gold prices use the normal sell-back ratio. */
export function sellBack(cost: number, brainsNeeded = false): number {
  if (brainsNeeded) return Math.max(0, Math.trunc(cost)) * ECONOMY.BRAIN_SELL_GOLD_RATE;
  return Math.max(1, Math.floor(cost * ECONOMY.SELL_BACK_RATIO));
}

/** Gold paid for selling an owned zombie. Gold-priced zombies follow the binary
 *  `-[ZFToolManager sellZombie:]`, docs/mechanics/COMBAT_STATS_RECOVERED.md): the
 *  sell value is simply `floor(baseMarketCost / 2)` — HALF the unit's base buy
 *  price, flat. It is NOT scaled by stats, mutations, or veterancy (the earlier
 *  stat-scaled model was a guess). `baseCost` is the zombie type's market cost
 *  (ZombieDef.cost); pass 0 for a type with no price to floor the payout at 1.
 *  Brain-priced zombies instead convert to 1,000 gold per brain. */
export function zombieSellValue(baseCost: number, brainsNeeded = false): number {
  if (brainsNeeded) return Math.max(0, Math.trunc(baseCost)) * ECONOMY.BRAIN_SELL_GOLD_RATE;
  return Math.max(1, Math.floor((baseCost || 0) / 2));
}
