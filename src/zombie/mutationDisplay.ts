// ---------------------------------------------------------------------------
// What a zombie's mutations look like on its card
// ---------------------------------------------------------------------------
// A mutated zombie used to advertise its mutations only INDIRECTLY: the boosted
// stat tiles render green, and the rig wears the vegetable. Neither says WHICH
// mutations it carries â€” which is what a player needs to know before pairing it in
// the Zombie Pot (slots are one-per-body-part and the higher bit wins a conflict).
// This module turns a mask into the per-mutation rows the card shows.
//
// Two things are deliberately NOT re-derived here:
//   â€¢ the effect is reported in DISPLAYED units, not the raw 1â€“4 points â€” the tiles
//     normalize against a per-stat reference, so Carrot's "+1 dex" reads +23 Speed
//     while Tomato's "+1 str" reads +4 Damage (see statDisplay).
//   â€¢ each mutation's contribution is measured by chaining through the same
//     rounding boundaries the tile uses, so the rows always SUM to the "Mutation"
//     line in the stat breakdown rather than drifting a point away from it.
//
// A mutation may move SEVERAL stats, and may move one DOWN (mutations.ts
// MutationStats), so an entry carries a list of effects rather than one number, and
// every one of them is written signed.
import { BASE } from "../base";
import {
  mutationBonus, mutationsOf, SECONDARY_ARM_SUFFIX, statEffectsOf,
  type MutationRef, type ResolvedMutationDef, type Slot, type Stat,
} from "./mutations";
import { STATS, displayStat, wisToFocusBonus } from "./traits";

// ZF2's own 40x40 mutation icons (MutationIcons.png â€” the vegetable in a lab flask),
// sliced by tools/prep_mutation_icons.py. The set covers all 13 primaries and both
// Tier-4 variants; only Pumpking, which never had an authored entry, is composed â€”
// its rig head placed in the same flask.
const MI = BASE + "assets/ui/mutation/";
const iconFile = (name: string) => `${MI}icon_mutation_${name}.png`;
const placeholderIcon = iconFile("placeholder");

/** mutation KEY (mutations.ts) -> its authored icon. Three names differ from ours:
 *  cauli/dragon are the game's cauliflower/dragonfruit, pumpking is the composed one. */
export const MUTATION_ICON: Record<string, string> = {
  tomato: iconFile("tomato"), 
  onion: iconFile("onion"), 
  carrot: iconFile("carrot"),
  turnip: iconFile("turnip"), 
  potato: iconFile("potato"), 
  coffee: iconFile("coffee"),
  celery: iconFile("celery"), 
  broccoli: iconFile("broccoli"), 
  garlic: iconFile("garlic"),
  cauli: iconFile("cauliflower"), 
  limabean: iconFile("limabean"), 
  flytrap: iconFile("flytrap"),
  dragon: iconFile("dragonfruit"), 
  pumpking: iconFile("pumpking"),
  //modded icon
  carrot_arm: iconFile("carrot"),
  turnip_eye: iconFile("turnip"), 
  turnip_head: iconFile("turnip"), 
  apple_head: iconFile("apple"), 
  melon_head: iconFile("melon"), 
  bread_neck: iconFile("bread"), 
  sampaguita_hair: placeholderIcon,
  corn_head: iconFile("corn"), 
  corn_arm: iconFile("corn"), 
  spineapple_body: placeholderIcon,
  kale_arm: iconFile("kale"),
  berry_eye: iconFile("blueberry"),
  spinach_hair: iconFile("spinach"),
  bloodberry_hair: placeholderIcon, 
  skellyberry_body: placeholderIcon,
};

/** One species' replacement art and name for a mutation it shares with others. */
export interface MutationVariant {
  part: string; // mutations.json key for the rig art
  name: string;
  icon: string;
}

/** Tier-4 variants share a lower tier's MUTATION for stats and slot occupancy but ship
 *  their OWN art and name â€” Eyebiscus rides Carrot's, Heartichoke rides Cauliflower's.
 *  Naming such a zombie's mutation off the shared one alone is simply wrong (the
 *  reported "Cauli-hair" text on Heartichoke), so the two species get an explicit
 *  override here, art included: the game authored icons for both.
 *
 *  Species key -> mutation key -> what that species shows instead. MIRRORS
 *  `mutationOverrides` in zombie/models.json â€” pinned against it by the tests. */
export const MUTATION_VARIANTS: Record<string, Record<string, MutationVariant>> = {
  ZombieActorRegularTier4Eyebiscus: {
    carrot: { part: "eyebiscusHat", name: "Eyebiscus", icon: iconFile("eyebiscus") },
  },
  ZombieActorRegularTier4Heartichoke: {
    cauli: { part: "heartichokeBody", name: "Heartichoke", icon: iconFile("heartichoke") },
  },
};

const SLOT_LABELS: Record<Slot, string> = {
  head: "Head",
  hair_eye: "Hair & Eyes",
  arm: "Front Arm",
  armB: "Back Arm",
  body: "Body",
  neck: "Neck",
};

const STAT_LABELS: Record<Stat, string> = {
  str: STATS.find((s) => s.key === "str")!.label,
  dex: STATS.find((s) => s.key === "dex")!.label,
  con: STATS.find((s) => s.key === "con")!.label,
  wis: STATS.find((s) => s.key === "focus")!.label,
};

function iconForMutationKey(key: string): string {
  if (MUTATION_ICON[key]) return MUTATION_ICON[key];
  if (key.endsWith(SECONDARY_ARM_SUFFIX)) {
    return MUTATION_ICON[key.slice(0, -SECONDARY_ARM_SUFFIX.length)] ?? placeholderIcon;
  }
  return placeholderIcon;
}

/** What one mutation does to one stat, in the units the tiles show. */
export interface MutationCardEffect {
  stat: Stat;
  statLabel: string; // "Damage" / "Speed" / "Life"
  delta: number; // what it moves THIS zombie's displayed stat by; NEGATIVE for a penalty
}

/** One mutation as the card shows it. */
export interface MutationCardEntry {
  ref?: MutationRef;
  /** Present only for vanilla bitmask mutations; modded mutations use ref as a string id. */
  bit?: number;
  /** mutations.json key for the RIG art â€” the variant part when the species overrides it. */
  partKey: string;
  icon: string; // the card's 40x40 icon URL
  name: string; // "Onionhead", "Eyebiscus", â€¦
  slotLabel: string; // which body slot it occupies (one mutation per slot)
  /** Every stat this mutation moves, in str/dex/con order. A mutation may trade one
   *  stat for another, so this can mix gains and penalties; it is never empty for a
   *  catalogued mutation, and a stat the mutation leaves alone is simply absent. */
  effects: MutationCardEffect[];
}

/** The minimum a zombie must carry for its mutation rows. `str`/`dex`/`con`
 *  already INCLUDE the mutation bonuses (makeOwned bakes them in). */
export interface MutationSource {
  key: string; // species key â€” resolves the Tier-4 variant art/name
  str: number;
  dex: number;
  con: number;
  focus?: number;
  mutation: number; // vanilla bitmask
  mutationIds?: readonly string[]; // local modded mutation ids
}

/** The mutations a zombie carries, in bit (tier) order. Empty when unmutated. */
export function mutationEntries(z: MutationSource): MutationCardEntry[] {
  const defs = mutationsOf(z.mutation, z.mutationIds);
  if (!defs.length) return [];
  const bonus = mutationBonus(z.mutation, z.mutationIds);
  // Strip the mutations back off to recover the species' own stats, then re-apply
  // them one at a time so each row reports its marginal, already-rounded gain.
  return mutationEntriesFrom(defs, {
    str: z.str - bonus.str,
    dex: z.dex - bonus.dex,
    con: z.con - bonus.con,
    wis: (z.focus ?? 0) - wisToFocusBonus(bonus.wis),
  }, MUTATION_VARIANTS[z.key]);
}

/** The card rows for an explicit set of mutation defs applied to explicit UNMUTATED
 *  stats. Split out from mutationEntries so the row maths can be exercised against a
 *  mutation the shipped catalog doesn't contain â€” which is the only way to cover a
 *  multi-stat or penalty-carrying mutation before one ships. */
export function mutationEntriesFrom(
  defs: readonly ResolvedMutationDef[],
  base: Partial<Record<Stat, number>> & Record<"str" | "dex" | "con", number>,
  variants?: Record<string, MutationVariant>,
): MutationCardEntry[] {
  const applied: Record<Stat, number> = { str: 0, dex: 0, con: 0, wis: 0 };

  return defs.map((def) => {
    // One row per stat this mutation moves. Each is measured by stepping THROUGH the
    // rounding boundary the tile uses, so a mutation that gives and takes reports both
    // halves at the same fidelity as a single-stat one.
    const effects = statEffectsOf(def).map((effect) => {
      const rawBase = base[effect.stat] ?? 0;
      const displayKey = effect.stat === "wis" ? "focus" : effect.stat;
      const beforeRaw = effect.stat === "wis"
        ? rawBase + wisToFocusBonus(applied.wis)
        : rawBase + applied[effect.stat];
      const before = displayStat(displayKey, beforeRaw);
      applied[effect.stat] += effect.amount;
      const afterRaw = effect.stat === "wis"
        ? rawBase + wisToFocusBonus(applied.wis)
        : rawBase + applied[effect.stat];
      const after = displayStat(displayKey, afterRaw);
      return {
        stat: effect.stat,
        statLabel: STAT_LABELS[effect.stat],
        delta: after - before,
      };
    });
    const variant = variants?.[def.key];
    return {
      ref: "bit" in def ? def.bit : def.key,
      bit: "bit" in def ? def.bit : undefined,
      partKey: variant?.part ?? def.key,
      icon: variant?.icon ?? iconForMutationKey(def.key),
      name: variant?.name ?? def.name,
      slotLabel: SLOT_LABELS[def.slot],
      effects,
    };
  });
}

/** One effect as the tooltip writes it: always signed, so a penalty reads as a penalty
 *  rather than as a smaller gain. */
export function mutationEffectText(effect: MutationCardEffect): string {
  return `${effect.delta >= 0 ? "+" : ""}${effect.delta} ${effect.statLabel}`;
}

/** The tooltip body for one mutation â€” the tile itself is unlabelled, so this is where
 *  the effect is read. One line per stat it moves, then the slot. Penalties carry
 *  `zeff-down` so the card can colour a trade-off differently from a pure gain. */
export function mutationTipText(entry: MutationCardEntry): string {
  const lines = entry.effects
    .map((effect) => {
      const cls = effect.delta < 0 ? "zeff zeff-down" : "zeff";
      return `<span class="${cls}">${mutationEffectText(effect)}</span>`;
    })
    .join("<br>");
  return `${lines}<br>${entry.slotLabel} slot`;
}

/** Every mutation name a mask stands for on THIS species, e.g. "Onionhead, Celery-arms".
 *  Variant-aware, unlike the raw `mutationLabel` in mutations.ts. */
export function mutationNames(key: string, mask: number, mutationIds?: readonly string[]): string[] {
  const variants = MUTATION_VARIANTS[key];
  return mutationsOf(mask, mutationIds).map((def) => variants?.[def.key]?.name ?? def.name);
}


