import { CROP_MUTATIONS } from "./cropMutations";
import { MUTATION_ICON } from "./mutationDisplay";
import {
  MODDED_MUTATIONS,
  MUTATIONS_BY_KEY,
  MUTATION_LIST,
  SECONDARY_ARM_SUFFIX,
  bitOf,
  mutationOf,
  mutationRefs,
  statEffectsOf,
  type MutationRef,
  type ResolvedMutationDef,
  type Slot,
  type Stat,
} from "./mutations";

export interface MutationAlmanacSources {
  cropName: (cropKey: string) => string | undefined;
}

export interface MutationAlmanacEntry {
  ref: MutationRef;
  key: string;
  name: string;
  slot: Slot;
  slotLabel: string;
  source: "Vanilla" | "Modded";
  icon: string;
  statEffects: { stat: Stat; amount: number }[];
  obtained: number;
  hint: string;
  portraitZombieKey: string;
  portraitMutation: number;
  portraitMutationIds: string[];
}

export const SLOT_LABELS: Readonly<Record<Slot, string>> = {
  head: "Head",
  hair_eye: "Hair & Eyes",
  arm: "Front Arm",
  armB: "Back Arm",
  body: "Body",
  neck: "Neck",
};

export const STAT_LABELS: Readonly<Record<Stat, string>> = {
  str: "Strength",
  dex: "Speed",
  con: "Life",
  wis: "Focus",
};

const BASE_PORTRAIT_ZOMBIE = "ZombieActorRegularTier1";
const PLACEHOLDER_ICON = MUTATION_ICON.pumpking;

const CROPS_BY_MUTATION = ((): Readonly<Record<string, string[]>> => {
  const out: Record<string, string[]> = {};
  for (const [cropKey, refs] of Object.entries(CROP_MUTATIONS)) {
    for (const ref of Array.isArray(refs) ? refs : [refs]) {
      const key = typeof ref === "number" ? mutationOf(ref)?.key : ref;
      if (key) (out[key] ??= []).push(cropKey);
    }
  }
  return out;
})();

const orList = (items: readonly string[]): string =>
  items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

function primaryArmKey(key: string): string {
  return key.endsWith(SECONDARY_ARM_SUFFIX) ? key.slice(0, -SECONDARY_ARM_SUFFIX.length) : key;
}

function iconForMutationKey(key: string): string {
  if (MUTATION_ICON[key]) return MUTATION_ICON[key];
  const primary = primaryArmKey(key);
  return MUTATION_ICON[primary] ?? PLACEHOLDER_ICON;
}

function mutationObtainHint(def: ResolvedMutationDef, sources: MutationAlmanacSources): string {
  const crops = (CROPS_BY_MUTATION[def.key] ?? CROPS_BY_MUTATION[primaryArmKey(def.key)] ?? [])
    .map((cropKey) => sources.cropName(cropKey))
    .filter((name): name is string => !!name);
  if (!crops.length) return "Found on a bought, harvested, or combined zombie.";
  return `Grow a zombie crop beside ${orList(crops)}.`;
}

function portraitSetFor(ref: MutationRef, def: ResolvedMutationDef): { mutation: number; mutationIds: string[] } {
  if (typeof ref === "number") return { mutation: ref, mutationIds: [] };
  if (def.slot !== "arm" && def.slot !== "armB") return { mutation: 0, mutationIds: [ref] };

  const primary = primaryArmKey(ref);
  const secondary = `${primary}${SECONDARY_ARM_SUFFIX}`;
  const mutation = MUTATIONS_BY_KEY[primary] ? bitOf(primary) : 0;
  const ids = [
    ...(MODDED_MUTATIONS[primary] ? [primary] : []),
    ...(MODDED_MUTATIONS[secondary] ? [secondary] : []),
  ];
  if (!ids.includes(ref) && MODDED_MUTATIONS[ref]) ids.push(ref);
  return { mutation, mutationIds: ids };
}

export function mutationAlmanacEntries(
  roster: readonly { mutation?: number; mutationIds?: readonly string[] }[],
  sources: MutationAlmanacSources,
): MutationAlmanacEntry[] {
  const obtained = new Map<string, number>();
  for (const zombie of roster) {
    for (const ref of mutationRefs(zombie.mutation ?? 0, zombie.mutationIds)) {
      const key = String(ref);
      obtained.set(key, (obtained.get(key) ?? 0) + 1);
    }
  }

  const vanilla = MUTATION_LIST.map((def) => ({ ref: def.bit, def, source: "Vanilla" as const }));
  const modded = Object.values(MODDED_MUTATIONS).map((def) => ({ ref: def.key, def, source: "Modded" as const }));
  return [...vanilla, ...modded].map(({ ref, def, source }) => {
    const portrait = portraitSetFor(ref, def);
    return {
      ref,
      key: def.key,
      name: def.name,
      slot: def.slot,
      slotLabel: SLOT_LABELS[def.slot],
      source,
      icon: iconForMutationKey(def.key),
      statEffects: statEffectsOf(def),
      obtained: obtained.get(String(ref)) ?? 0,
      hint: mutationObtainHint(def, sources),
      portraitZombieKey: BASE_PORTRAIT_ZOMBIE,
      portraitMutation: portrait.mutation,
      portraitMutationIds: portrait.mutationIds,
    };
  });
}

export function statEffectText(effect: { stat: Stat; amount: number }): string {
  return `${effect.amount > 0 ? "+" : ""}${effect.amount} ${STAT_LABELS[effect.stat]}`;
}
