// ---------------------------------------------------------------------------
// What a zombie's mutations look like on its card
// ---------------------------------------------------------------------------
// A mutated zombie used to advertise its mutations only INDIRECTLY: the boosted
// stat tiles render green, and the rig wears the vegetable. Neither says WHICH
// mutations it carries — which is what a player needs to know before pairing it in
// the Zombie Pot (slots are one-per-body-part and the higher bit wins a conflict).
// This module turns a mask into the per-mutation rows the card shows.
//
// Two things are deliberately NOT re-derived here:
//   • the bonus is reported in DISPLAYED units, not the raw 1–4 points — the tiles
//     normalize against a per-stat reference, so Carrot's "+1 dex" reads +23 Speed
//     while Tomato's "+1 str" reads +4 Damage (see statDisplay).
//   • each mutation's contribution is measured by chaining through the same
//     rounding boundaries the tile uses, so the rows always SUM to the "Mutation"
//     line in the stat breakdown rather than drifting a point away from it.
import { BASE } from "../base";
import { MUTATIONS, mutationBonus, mutationsOf, type Slot, type Stat } from "./mutations";
import { STATS, displayStat } from "./traits";

// ZF2's own 40x40 mutation icons (MutationIcons.png — the vegetable in a lab flask),
// sliced by tools/prep_mutation_icons.py. The set covers all 13 primaries and both
// Tier-4 variants; only Pumpking, which never had an authored entry, is composed —
// its rig head placed in the same flask.
const MI = BASE + "assets/ui/mutation/";
const iconFile = (name: string) => `${MI}icon_mutation_${name}.png`;

/** mutation KEY (mutations.ts) -> its authored icon. Three names differ from ours:
 *  cauli/dragon are the game's cauliflower/dragonfruit, pumpking is the composed one. */
export const MUTATION_ICON: Record<string, string> = {
  tomato: iconFile("tomato"), onion: iconFile("onion"), carrot: iconFile("carrot"),
  turnip: iconFile("turnip"), potato: iconFile("potato"), coffee: iconFile("coffee"),
  celery: iconFile("celery"), broccoli: iconFile("broccoli"), garlic: iconFile("garlic"),
  cauli: iconFile("cauliflower"), limabean: iconFile("limabean"), flytrap: iconFile("flytrap"),
  dragon: iconFile("dragonfruit"), pumpking: iconFile("pumpking"),
};

/** Tier-4 variants share a lower tier's bit for stats and slot occupancy but ship
 *  their OWN art and name — Eyebiscus rides Carrot's bit 4, Heartichoke rides
 *  Cauliflower's 512. Naming such a zombie's mutation off the bit alone is simply
 *  wrong (the reported "Cauli-hair" text on Heartichoke), so the two species get an
 *  explicit override here, art included: the game authored icons for both. MIRRORS
 *  `mutationOverrides` in zombie/models.json — pinned against it by the tests. */
export const MUTATION_VARIANTS: Record<
  string,
  Record<number, { part: string; name: string; icon: string }>
> = {
  ZombieActorRegularTier4Eyebiscus: {
    4: { part: "eyebiscusHat", name: "Eyebiscus", icon: iconFile("eyebiscus") },
  },
  ZombieActorRegularTier4Heartichoke: {
    512: { part: "heartichokeBody", name: "Heartichoke", icon: iconFile("heartichoke") },
  },
};

const SLOT_LABELS: Record<Slot, string> = {
  head: "Head",
  hair_eye: "Hair & Eyes",
  arm: "Arm",
  body: "Body",
  neck: "Neck",
};

const STAT_LABELS: Record<Stat, string> = {
  str: STATS.find((s) => s.key === "str")!.label,
  dex: STATS.find((s) => s.key === "dex")!.label,
  con: STATS.find((s) => s.key === "con")!.label,
};

/** One mutation as the card shows it. */
export interface MutationCardEntry {
  bit: number;
  /** mutations.json key for the RIG art — the variant part when the species overrides it. */
  partKey: string;
  icon: string; // the card's 40x40 icon URL
  name: string; // "Onionhead", "Eyebiscus", …
  slotLabel: string; // which body slot it occupies (one mutation per slot)
  statLabel: string; // "Damage" / "Speed" / "Life"
  delta: number; // what it adds to THIS zombie's displayed stat
}

/** The minimum a zombie must carry for its mutation rows. `str`/`dex`/`con`
 *  already INCLUDE the mutation bonuses (makeOwned bakes them in). */
export interface MutationSource {
  key: string; // species key — resolves the Tier-4 variant art/name
  str: number;
  dex: number;
  con: number;
  mutation: number; // bitmask
}

/** The mutations a zombie carries, in bit (tier) order. Empty when unmutated. */
export function mutationEntries(z: MutationSource): MutationCardEntry[] {
  const defs = mutationsOf(z.mutation);
  if (!defs.length) return [];
  const bonus = mutationBonus(z.mutation);
  // Strip the mutations back off to recover the species' own stats, then re-apply
  // them one at a time so each row reports its marginal, already-rounded gain.
  const base: Record<Stat, number> = {
    str: z.str - bonus.str,
    dex: z.dex - bonus.dex,
    con: z.con - bonus.con,
  };
  const applied: Record<Stat, number> = { str: 0, dex: 0, con: 0 };
  const variants = MUTATION_VARIANTS[z.key];

  return defs.map((def) => {
    const before = displayStat(def.stat, base[def.stat] + applied[def.stat]);
    applied[def.stat] += def.amount;
    const after = displayStat(def.stat, base[def.stat] + applied[def.stat]);
    const variant = variants?.[def.bit];
    return {
      bit: def.bit,
      partKey: variant?.part ?? String(def.bit),
      icon: variant?.icon ?? MUTATION_ICON[def.key],
      name: variant?.name ?? def.name,
      slotLabel: SLOT_LABELS[def.slot],
      statLabel: STAT_LABELS[def.stat],
      delta: after - before,
    };
  });
}

/** The tooltip body for one mutation — the tile itself is unlabelled, so this is
 *  where the bonus is read. Two lines under the name: the gain, then the slot. */
export function mutationTipText(entry: MutationCardEntry): string {
  return `<span class="zeff">+${entry.delta} ${entry.statLabel}</span><br>${entry.slotLabel} slot`;
}

/** Every mutation name a mask stands for on THIS species, e.g. "Onionhead, Celery-arms".
 *  Variant-aware, unlike the raw `mutationLabel` in mutations.ts. */
export function mutationNames(key: string, mask: number): string[] {
  const variants = MUTATION_VARIANTS[key];
  return mutationsOf(mask).map((def) => variants?.[def.bit]?.name ?? MUTATIONS[def.bit].name);
}
