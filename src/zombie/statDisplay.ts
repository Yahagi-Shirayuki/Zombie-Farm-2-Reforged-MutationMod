// ---------------------------------------------------------------------------
// Displayed-stat resolution â€” the number the detail card / army list shows for a
// zombie's Damage / Speed / Life / Focus, and the per-modifier breakdown behind it.
//
// The shown value is NOT the raw stat: it folds in every ALWAYS-ON bonus that
// affects THIS zombie, then normalizes to the 0â€“100 reference bar (traits.displayStat):
//   effective = (base + mutation) Ã— veterancy Ã— Î (self passive stat-abilities)
//   shown     = round(effective / STAT_DISPLAY_MAX Ã— 100)   [focus: round(effective)]
//
// Included modifiers (per the game + user spec):
//   â€¢ Mutation   â€” baked into the raw str/con/dex by makeOwned; additive; focus never.
//   â€¢ Veterancy  â€” Ã—(1 + 0.05Â·rank), scales ALL stats incl. focus (Master = +25%).
//   â€¢ Abilities  â€” ONLY the zombie's own passive ("self") stat buffs that are unlocked
//                  and in class-rank. Team/aura buffs (Chivalry, Grace, Heal, Protectâ€¦)
//                  and player-activated moves (Bash, Explodeâ€¦) are excluded â€” they don't
//                  passively raise this unit's own stat. Mirrors raid/CombatEngine.
//
// Everything here is pure + headless-testable; no Pixi, no game-state object.
// ---------------------------------------------------------------------------

// Type-only where the import IS a type: prefs -> rosterSort -> here drags this module
// into the Worker's compile graph, and the server tsconfig runs verbatimModuleSyntax.
import {
  STATS, displayResolvedStat, veterancyMultiplier, veterancy, ABILITY_POOL, wisToFocusBonus, type StatMeta,
} from "./traits";
import { ABILITY_KIND, ABILITY_COMBAT, activeAbilities, type AbilityCombatEffect } from "./abilities";
import { mutationBonus, type Stat } from "./mutations";

/** The minimum a zombie must carry to resolve its displayed stats. */
export interface StatSource {
  str: number;
  dex: number;
  con: number;
  focus: number;
  mutation: number; // vanilla bitmask (mutationBonus)
  mutationIds?: readonly string[];
  invasions: number; // â†’ veterancy rank
  key: string; // named-unique ability overrides
  group: string; // group ability set
  className: string; // colour class â†’ ability rank
}

/** One line in a stat's hover breakdown. */
export interface StatModifierLine {
  label: string; // "Mutation", "+10% Power", "Veterancy (Master)"
  amount: string; // actual contribution in displayed stat units, e.g. "+13" or "+1"
  zero: boolean; // true when this modifier currently contributes nothing (dim it)
}

export interface StatBreakdown {
  base: number; // normalized base, before any modifier
  total: number; // normalized value with every modifier applied (what the tile shows)
  lines: StatModifierLine[]; // mutation â†’ each self ability â†’ veterancy, in that order
}

const STAT_KEYS = ["str", "dex", "con", "focus"] as const;

/** True if an ability effect raises one of the unit's OWN displayed stats. Abilities whose
 *  effect is a team aura, a chance proc, healing, or an activated move carry no self-stat
 *  multiplier and are excluded here â€” they are modeled in CombatEngine/BattleSim instead. */
function affectsSelfStat(e: AbilityCombatEffect): boolean {
  return (
    (e.allStatsMult ?? 1) !== 1 ||
    (e.selfDamageMult ?? 1) !== 1 ||
    (e.selfHpMult ?? 1) !== 1 ||
    (e.selfSpeedMult ?? 1) !== 1
  );
}

/** The zombie's active, always-on, self-affecting stat abilities â€” the SAME gated set
 *  the detail card / CombatEngine use, minus team buffs, activated moves, and abilities
 *  whose only effect is army-wide. `abilityUnlocked` gates by beaten-boss tier. */
export function selfStatAbilities(
  z: Pick<StatSource, "key" | "group" | "className">,
  abilityUnlocked: (key: string) => boolean
): string[] {
  return activeAbilities(z, abilityUnlocked).filter(
    (k) => ABILITY_KIND[k] === "self" && affectsSelfStat(ABILITY_COMBAT[k] ?? {})
  );
}

/** One ability's multiplier on a single displayed stat (1 = no effect). "Damage" (str)
 *  tracks selfDamageMult, "Speed" (dex) selfSpeedMult, "Life" (con) selfHpMult; all four
 *  also carry allStatsMult (the "+N% All Stats" buffs, which the game applies to focus). */
export function abilityStatMult(key: string, stat: StatMeta["key"]): number {
  const e = ABILITY_COMBAT[key];
  if (!e) return 1;
  const all = e.allStatsMult ?? 1;
  if (stat === "str") return all * (e.selfDamageMult ?? 1);
  if (stat === "dex") return all * (e.selfSpeedMult ?? 1);
  if (stat === "con") return all * (e.selfHpMult ?? 1);
  return all; // focus â€” only "All Stats" touches it
}

function rawStat(z: StatSource, stat: StatMeta["key"]): number {
  return stat === "str" ? z.str : stat === "dex" ? z.dex : stat === "con" ? z.con : z.focus;
}
function mutationStatFor(stat: StatMeta["key"]): Stat {
  return stat === "focus" ? "wis" : stat;
}

export type StatTone = "boosted" | "debuffed" | "overcharged" | "";

export function statTone(base: number, total: number): StatTone {
  if (total < base) return "debuffed";
  if (total > base * 2) return "overcharged";
  if (total > base) return "boosted";
  return "";
}

export function displayStatTones(
  z: StatSource,
  abilityUnlocked: (key: string) => boolean,
): Record<StatMeta["key"], StatTone> {
  const out = {} as Record<StatMeta["key"], StatTone>;
  for (const meta of STATS) {
    const bd = statBreakdown(z, meta.key, abilityUnlocked);
    out[meta.key] = statTone(bd.base, bd.total);
  }
  return out;
}

/** Full breakdown for one stat: base, every applied modifier (incl. +0 ones so the
 *  player sees the slot exists), and the normalized total the tile displays. */
export function statBreakdown(
  z: StatSource,
  stat: StatMeta["key"],
  abilityUnlocked: (key: string) => boolean
): StatBreakdown {
  const raw = rawStat(z, stat); // already includes the mutation bonus (makeOwned)
  const bonus = mutationBonus(z.mutation, z.mutationIds);
  const rawMutation = bonus[mutationStatFor(stat)] ?? 0;
  const mut = stat === "focus" ? wisToFocusBonus(rawMutation) : rawMutation;
  const baseRaw = raw - mut;
  const v = veterancyMultiplier(z.invasions);
  const abilities = selfStatAbilities(z, abilityUnlocked);

  // Mutations are the LAST link of the source's stat chain (see buildPlayerUnits), so
  // the percentage modifiers compound on the UNMUTATED stat and the flat mutation bonus
  // lands on top; multiplying it by veterancy here would overstate the card vs combat.
  let effective = baseRaw * v;
  for (const k of abilities) effective *= abilityStatMult(k, stat);
  effective += mut;
  const show = (value: number) => displayResolvedStat(stat, value);

  const lines: StatModifierLine[] = [];
  // Mutation: additive; shown in display units (e.g. "+13"). Non-focus stats show
  // the line even at +0 to reveal the slot exists; Focus shows it when wis moves it.
  if (stat !== "focus" || mut !== 0) {
    const delta = show(raw) - show(baseRaw);
    lines.push({ label: "Mutation", amount: `${delta >= 0 ? "+" : ""}${delta}`, zero: mut === 0 });
  }
  // Each self stat-ability, in tier order, with its actual contribution to THIS stat.
  for (const k of abilities) {
    const mult = abilityStatMult(k, stat);
    const without = mult === 0 ? effective : (effective - mut) / mult + mut;
    const delta = show(effective) - show(without);
    lines.push({
      label: ABILITY_POOL[k]?.label ?? k,
      amount: `${delta >= 0 ? "+" : ""}${delta}`,
      zero: delta === 0,
    });
  }
  // Veterancy â€” always applicable to every stat; +0 at Newbie is still shown.
  const withoutVeterancy = v === 0 ? effective : (effective - mut) / v + mut;
  const veterancyDelta = show(effective) - show(withoutVeterancy);
  lines.push({
    label: `Veterancy (${veterancy(z.invasions)})`,
    amount: `${veterancyDelta >= 0 ? "+" : ""}${veterancyDelta}`,
    zero: veterancyDelta === 0,
  });

  return { base: show(baseRaw), total: show(effective), lines };
}

// ---------------------------------------------------------------------------
// Mutation bonuses in DISPLAYED units.
// ---------------------------------------------------------------------------
// A mutation's raw bonus is 1â€“4 stat points, but no surface ever shows a raw stat:
// every tile normalizes against a fixed reference (traits.STAT_DISPLAY_MAX), and the
// three references differ wildly. Speed's is only 4.4, so Carrot's "+1 dex" lands as
// +23 Speed on the card, while Tomato's "+1 str" is +4 Damage. Quoting the raw points
// in the Market therefore understated every mutation and misranked them against each
// other. These helpers report the number the player will actually watch change.

/** The base (unmutated) stats a species is listed with. Catalog rows carry these raw;
 *  makeOwned is what folds a mutation in, so a catalog row is always pre-mutation. */
export interface BaseStats {
  str: number;
  dex: number;
  con: number;
  focus?: number;
}

export interface MutationDisplayGain {
  stat: StatMeta["key"];
  label: string; // "Damage" / "Speed" / "Life" â€” matches the stat tiles
  delta: number; // in displayed units, e.g. 23
}

/**
 * What a mutation mask adds to a species' DISPLAYED stats. Measured as the difference
 * between the normalized mutated and unmutated values, exactly as statBreakdown's
 * "Mutation" line does, so the Market's promise equals the card's later reading.
 *
 * Grouped per stat rather than per mutation: two mutations on the same stat combine
 * into one raw sum, and normalizing that sum once avoids double rounding.
 */
export function mutationDisplayGains(base: BaseStats, mask: number, mutationIds?: readonly string[]): MutationDisplayGain[] {
  return statDisplayGains(base, mutationBonus(mask, mutationIds));
}

/** The same, from an explicit raw stat delta rather than a mask. Split out so a
 *  mutation that MOVES A STAT DOWN can be covered before the catalog ships one: a
 *  penalty must survive normalization with its sign intact, not read as a bonus. */
export function statDisplayGains(
  base: BaseStats,
  bonus: Partial<Record<Stat, number>>,
): MutationDisplayGain[] {
  const gains: MutationDisplayGain[] = [];
  for (const meta of STATS) {
    const stat = meta.key;
    const mutationStat = mutationStatFor(stat);
    const raw = bonus[mutationStat];
    if (!raw) continue;
    const scaledRaw = stat === "focus" ? wisToFocusBonus(raw) : raw;
    const baseRaw = base[stat] ?? 0;
    const delta = displayResolvedStat(stat, baseRaw + scaledRaw) - displayResolvedStat(stat, baseRaw);
    if (delta) gains.push({ stat, label: meta.label, delta });
  }
  return gains;
}

/**
 * The Market card's line for a pre-mutated zombie, in the same units its stat tiles
 * use. Undefined when the species carries no mutation.
 *
 * The mutation is deliberately NOT named. The two Tier-4 mutants reuse a lower tier's
 * mutation (Eyebiscus carries Carrot's, Heartichoke Cauliflower's), so a name derived
 * from the mask is simply wrong for them â€” the reported "wrong text ... for Heartichoke
 * (lvl 44)" defect, which read "Cauli-hair". The card's own title already names the
 * species, so the bonus is what the line needs to carry.
 */
export function mutationMarketDescription(base: BaseStats, mask: number, mutationIds?: readonly string[]): string | undefined {
  return describeMutationGains(mutationDisplayGains(base, mask, mutationIds));
}

/** The Market line for an already-measured set of gains. Undefined when there are none. */
export function describeMutationGains(gains: MutationDisplayGain[]): string | undefined {
  if (!gains.length) return undefined;
  // Always signed: a mutation may trade one stat for another, and a card that wrote
  // "+8 Life, 12 Speed" for a -12 would sell the penalty as a bonus.
  const effects = gains.map((g) => `${g.delta >= 0 ? "+" : ""}${g.delta} ${g.label}`).join(", ");
  return `Starts with a guaranteed mutation: ${effects}. Mutations carry into Zombie Pot combinations.`;
}

/** The four displayed totals (Damage/Speed/Life/Focus) for a zombie â€” the value each
 *  stat tile shows, with every always-on bonus folded in. Convenience for surfaces
 *  that show the numbers without the hover breakdown (e.g. the compact army list). */
export function displayTotals(
  z: StatSource,
  abilityUnlocked: (key: string) => boolean
): Record<StatMeta["key"], number> {
  const out = {} as Record<StatMeta["key"], number>;
  for (const k of STAT_KEYS) out[k] = statBreakdown(z, k, abilityUnlocked).total;
  return out;
}



