// Loot rarity-tier selection — recovered from the iOS binary
// (`ZFFightSummary rollForDrop:`, method BINARY_RE_METHODOLOGY.md).
//
// A raid win rolls ONE item drop. Each raid's `loot` is 6 rarity tiers
// (tier 0 = common "Bonus Gold" … tier 5 = rarest signature decoration). The
// tier is chosen by a percentage roll against cumulative thresholds; the whole
// distribution shifts RARER as the loot-luck bonus (Golden Dice spent) rises.
// Within the chosen tier, one eligible alternative is picked uniformly.
//
// Ground truth of the thresholds (roll r in [0,1), bonus B = dice spent):
//   B = 0 : r<.09→t0, r<.24→t1, r<.84→t2, r<.92→t3, else t4   (tiers 0–4)
//   B = 1 : r<.14→t1, r<.74→t2, r<.84→t3, r<.92→t4, else t5   (tiers 1–5)
//   B = 2 : r<.59→t2, r<.79→t3, r<.89→t4, else t5             (tiers 2–5)
//   B ≥ 3 : n=B-3; r' = r + 0.10n; d = 0.9^n;
//           r'<0.39d→t3, r'<0.79d→t4, else t5                  (tiers 3–5)
// So one die makes the common tiers unreachable and puts tier 5 on the table;
// each further die keeps compressing the roll toward the rarest tiers.

type Threshold = readonly [cum: number, tier: number];
type TierChances = readonly [number, number, number, number, number, number];

// Ascending cumulative thresholds per bracket + the fall-through tier.
const BRACKET_0: readonly Threshold[] = [
  [0.09, 0],
  [0.24, 1],
  [0.84, 2],
  [0.92, 3],
];
const BRACKET_1: readonly Threshold[] = [
  [0.14, 1],
  [0.74, 2],
  [0.84, 3],
  [0.92, 4],
];
const BRACKET_2: readonly Threshold[] = [
  [0.59, 2],
  [0.79, 3],
  [0.89, 4],
];

function pickFromTable(roll: number, table: readonly Threshold[], fallthrough: number): number {
  for (const [cum, tier] of table) if (roll < cum) return tier;
  return fallthrough;
}

function integerTierChances(bonus: number): TierChances {
  if (bonus === 0) return [0.09, 0.15, 0.60, 0.08, 0.08, 0];
  if (bonus === 1) return [0, 0.14, 0.60, 0.10, 0.08, 0.08];
  if (bonus === 2) return [0, 0, 0.59, 0.20, 0.10, 0.11];
  const n = bonus - 3;
  const decay = Math.pow(0.9, n);
  const t3Cum = Math.max(0, Math.min(1, 0.39 * decay - 0.10 * n));
  const t4Cum = Math.max(t3Cum, Math.min(1, 0.79 * decay - 0.10 * n));
  return [0, 0, 0, t3Cum, t4Cum - t3Cum, 1 - t4Cum];
}

function pickFromChances(roll: number, chances: TierChances): number {
  let cumulative = 0;
  for (let tier = 0; tier < chances.length; tier++) {
    cumulative += chances[tier];
    if (roll < cumulative) return tier;
  }
  return chances.length - 1;
}

/** Choose a loot rarity tier (0–5) for a win. `roll` is a uniform [0,1) sample;
 *  `bonus` is the loot-luck bracket (Golden Dice spent, 0 = none). Mirrors the
 *  binary's `rollForDrop:` tier selection exactly for whole-number dice. Fractional
 *  modded luck interpolates between adjacent Golden Dice brackets. */
export function rollLootTier(roll: number, bonus: number): number {
  const raw = Math.max(0, Number.isFinite(bonus) ? bonus : 0);
  const b = Math.floor(raw);
  const frac = raw - b;
  if (frac > 0) {
    const lo = integerTierChances(b);
    const hi = integerTierChances(b + 1);
    return pickFromChances(
      roll,
      lo.map((chance, i) => chance * (1 - frac) + hi[i] * frac) as unknown as TierChances
    );
  }
  if (b === 0) return pickFromTable(roll, BRACKET_0, 4);
  if (b === 1) return pickFromTable(roll, BRACKET_1, 5);
  if (b === 2) return pickFromTable(roll, BRACKET_2, 5);
  // Bracket 3+: over-luck. Push the roll up by 0.10 per extra die and decay the
  // tier-3/4 windows by 0.9 each, so tier 5 grows ever more likely (tiers 3–5).
  const n = b - 3;
  const rp = roll + 0.1 * n;
  const decay = Math.pow(0.9, n);
  if (rp < 0.39 * decay) return 3;
  if (rp < 0.79 * decay) return 4;
  return 5;
}
