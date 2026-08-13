// ---------------------------------------------------------------------------
// Mutation system (data-derived from ZF2's Market.plist).
// ---------------------------------------------------------------------------
// Vanilla mutations are stored in the legacy numeric `mutation` bitmask so saves,
// server data, and shipped content stay compatible. Local modded mutations are stored
// separately as string ids in `mutationIds`; they do not consume bit slots and are not
// capped by MAX_MASK_BITS.
//
// Rules:
//   * One mutation per SLOT (head / hair_eye / arm / armB / body / neck).
//   * Max 6 visible mutations (one per slot).
//   * Stat bonuses map: power/attack -> str, life -> con, speed -> dex, focus -> wis.
// ---------------------------------------------------------------------------

import {
  bitValue, isMaskBit, MAX_MASK_BITS, maskBits, maskHas,
  maskIntersect, maskUnion, maskWithout,
} from "./mutationMask";

export type Slot = "head" | "hair_eye" | "arm" | "armB" | "body" | "neck";
export const SLOTS: Slot[] = ["head", "hair_eye", "arm", "armB", "body", "neck"];

export type Stat = "str" | "con" | "dex" | "wis";
export type MutationKey = string;
export type MutationRef = MutationKey | number;
export type MutationStats = Partial<Record<Stat, number>>;

export interface MutationSpec {
  key: MutationKey;
  name: string;
  slot: Slot;
  stats: MutationStats;
}

export interface MutationDef extends MutationSpec {
  bit: number;
}

export interface ModdedMutationDef extends MutationSpec {
  modded: true;
}

export type ResolvedMutationDef = MutationDef | ModdedMutationDef;

const STAT_ORDER: Stat[] = ["str", "dex", "con", "wis"];

export function statEffectsOf(def: Pick<ResolvedMutationDef, "stats">): { stat: Stat; amount: number }[] {
  return STAT_ORDER
    .filter((stat) => !!def.stats[stat])
    .map((stat) => ({ stat, amount: def.stats[stat]! }));
}

// The authored vanilla catalog, in BIT ORDER. Entry N owns bit 2^N.
// APPEND VANILLA ONLY. Modded entries belong in MODDED_MUTATIONS below so they keep
// real string ids instead of spending finite bit positions.
// Original mutation list
const CATALOG: readonly MutationSpec[] = [
	{ key: "tomato",	  name: "Tomatohead",	  slot: "head",		  stats: { str: 1, con: 1 } },
	{ key: "onion",	    name: "Onionhead",	  slot: "head",		  stats: { con: 1 } },
	{ key: "carrot",	  name: "Carrot-eyed",	slot: "hair_eye",	stats: { dex: 1 } },
	{ key: "turnip",	  name: "Turnip-Arm",	  slot: "arm",		  stats: { str: 2 } },
	{ key: "potato",	  name: "Potatohead",	  slot: "head",		  stats: { con: 2, str: 1 } },
	{ key: "coffee",	  name: "Coffeehead",	  slot: "head",		  stats: { dex: 1, wis: 2 } },
	{ key: "celery",	  name: "Celery-arms",	slot: "arm",		  stats: { str: 3, con: 1 } },
	{ key: "broccoli",	name: "Broccohair",	  slot: "hair_eye",	stats: { con: 3, wis: 1 } },
	{ key: "garlic",	  name: "Garlichead",	  slot: "head",		  stats: { str: 2, con: 2, wis: 1 } },
	{ key: "cauli",	    name: "Cauli-hair",	  slot: "hair_eye",	stats: { con: 2, wis: 3 } },
	{ key: "limabean",	name: "Lima Bean",	  slot: "body",		  stats: { con: 3, str: 1 } },
	{ key: "flytrap",	  name: "Flytrap",	    slot: "neck",		  stats: { str: 2, con: 2 } },
	{ key: "dragon",	  name: "Dragon-arm",	  slot: "arm",		  stats: { str: 4, dex: 1, wis: 1 } },
	{ key: "pumpking",	name: "Pumpking",	    slot: "head",		  stats: { str: 3, con: 2, wis: 1 } },
];
// Addition modded mutation
const AUTHORED_MODDED_MUTATIONS: Readonly<Record<MutationKey, ModdedMutationDef>> = Object.freeze({
	carrot_arm:		    { modded: true, key: "carrot_arm",		  name: "carrot-armed",		    slot: "arm",		  stats: { str: 1, dex: 1 } },
	turnip_eye:		    { modded: true, key: "turnip_eye",		  name: "Turnip-eyed",		    slot: "hair_eye",	stats: { wis: 2 } },
	turnip_head:		  { modded: true, key: "turnip_head",		  name: "Turnip-head",		    slot: "head",		  stats: { con: 2 } },
	bread_neck:		    { modded: true, key: "bread_neck",		  name: "Bread neck",		      slot: "neck",		  stats: { con: 3 } },
	apple_head:		    { modded: true, key: "apple_head",		  name: "Red-delicious Head",	slot: "head",		  stats: { str: 1, dex: 1 } },
	melon_head:		    { modded: true, key: "melon_head",		  name: "Felon-Headon",		    slot: "head",		  stats: { con: 3 } },
	sampaguita_hair:	{ modded: true, key: "sampaguita_hair",	name: "Sampaguita hair",	  slot: "hair_eye",	stats: { dex: 1, wis: 2 } },
	corn_head:		    { modded: true, key: "corn_head",		    name: "Corned head",		    slot: "head",		  stats: { str: 1, con: 2, wis: 1 } },
	corn_arm:		      { modded: true, key: "corn_arm",		    name: "Corned Arm",		      slot: "arm",		  stats: { str: 3, con: 1 } },
	spineapple_body:	{ modded: true, key: "spineapple_body",	name: "Spine-ap-body",		  slot: "body",		  stats: { str: 1, con: 3 } },
	kale_arm:		      { modded: true, key: "kale_arm",		    name: "Malakale Arm",		    slot: "arm",		  stats: { str: 2, con: 1, dex: 1 } },
	berry_eye:		    { modded: true, key: "berry_eye",		    name: "Beryl-eyed",		      slot: "hair_eye",	stats: { dex: 1, wis: 2, con: 1 } },
	spinach_hair:		  { modded: true, key: "spinach_hair",		name: "Spinel hair",		    slot: "hair_eye",	stats: { con: 2, dex: 1, wis: 1 } },
  /*
	mint_neck:		    { modded: true, key: "mint_neck",		    name: "Diamint lei",		    slot: "neck",		  stats: { con: 2, wis: 2, dex: 1 } },
	oat_hat:		      { modded: true, key: "oat_hat",			    name: "Oatnyx wreath",		  slot: "hair_eye",	stats: { con: 2, wis: 2 } },
	oat_arm:		      { modded: true, key: "oat_arm",			    name: "Oatnyx Arm",		      slot: "arm",		  stats: { str: 2, con: 2 } },
	*/
	bloodberry_hair:	{ modded: true, key: "bloodberry_hair",	name: "Bloody-hairy",		    slot: "hair_eye",	stats: { str: 2, dex: 1, wis: 2 } },
	skellyberry_body:	{ modded: true, key: "skellyberry_body",name: "Skelly-belly",		    slot: "body",		  stats: { str: 2, con: 4 } },
});

export const SECONDARY_ARM_SUFFIX = "_b";

export function secondaryArmMutationKey(key: MutationKey): MutationKey {
  return `${key}${SECONDARY_ARM_SUFFIX}`;
}

function derivedSecondaryArmMutations(
  vanilla: readonly MutationSpec[],
  authored: Readonly<Record<MutationKey, ModdedMutationDef>>,
): Record<MutationKey, ModdedMutationDef> {
  const out: Record<MutationKey, ModdedMutationDef> = {};
  for (const def of [...vanilla, ...Object.values(authored)]) {
    if (def.slot !== "arm") continue;
    const key = secondaryArmMutationKey(def.key);
    if (authored[key]) continue;
    out[key] = {
      modded: true,
      key,
      name: `${def.name} (secondary)`,
      slot: "armB",
      stats: { ...def.stats },
    };
  }
  return out;
}

export const MODDED_MUTATIONS: Readonly<Record<MutationKey, ModdedMutationDef>> = Object.freeze({
  ...AUTHORED_MODDED_MUTATIONS,
  ...derivedSecondaryArmMutations(CATALOG, AUTHORED_MODDED_MUTATIONS),
});

export const ALL_MODDED_MUTATION_IDS: readonly string[] = Object.freeze(Object.keys(MODDED_MUTATIONS));

const PINNED_ORDER: readonly MutationKey[] = [
  "tomato", "onion", "carrot", "turnip", "potato", "coffee", "celery",
  "broccoli", "garlic", "cauli", "limabean", "flytrap", "dragon", "pumpking",
];

export const MUTATION_LIST: readonly MutationDef[] = CATALOG.map((spec, index) => ({
  ...spec,
  bit: bitValue(index),
}));

(function assertCatalogIntegrity() {
  if (CATALOG.length > MAX_MASK_BITS) {
    throw new RangeError(
      `vanilla mutation catalog holds ${CATALOG.length} entries; the integer mask tops out at ` +
      `${MAX_MASK_BITS}. Put local modded mutations in MODDED_MUTATIONS instead.`
    );
  }
  const seen = new Set<MutationKey>();
  for (const def of MUTATION_LIST) {
    if (seen.has(def.key)) throw new Error(`duplicate mutation key "${def.key}"`);
    seen.add(def.key);
  }
  for (const [id, def] of Object.entries(MODDED_MUTATIONS)) {
    if (def.key !== id) throw new Error(`modded mutation key mismatch: "${id}" contains "${def.key}"`);
    if (seen.has(id)) throw new Error(`modded mutation "${id}" shadows a vanilla mutation key`);
    seen.add(id);
  }
  for (const [index, key] of PINNED_ORDER.entries()) {
    if (CATALOG[index]?.key === key) continue;
    const moved = MUTATION_LIST.find((def) => def.key === key);
    throw new Error(
      `mutation "${key}" is no longer catalog entry #${index}` +
      (moved ? ` (it is now #${CATALOG.findIndex((e) => e.key === key)})` : " (it was removed)") +
      `. Position determines the persisted bit, so CATALOG is APPEND-ONLY for vanilla mutations.`
    );
  }
})();

export const MUTATIONS_BY_KEY: Readonly<Record<MutationKey, MutationDef>> =
  Object.fromEntries(MUTATION_LIST.map((def) => [def.key, def]));

const BY_BIT: Readonly<Record<number, MutationDef>> =
  Object.fromEntries(MUTATION_LIST.map((def) => [def.bit, def]));

export const ALL_BITS: number[] = MUTATION_LIST.map((def) => def.bit);
export const ALL_MUTATIONS_MASK: number = ALL_BITS.reduce(maskUnion, 0);

export const SLOT_MASK: Record<Slot, number> = (() => {
  const m: Record<Slot, number> = { head: 0, hair_eye: 0, arm: 0, armB: 0, body: 0, neck: 0 };
  for (const def of MUTATION_LIST) m[def.slot] = maskUnion(m[def.slot], def.bit);
  return m;
})();

export function resolveMutationBit(ref: MutationRef): number | null {
  if (typeof ref === "string") return MUTATIONS_BY_KEY[ref]?.bit ?? null;
  if (!isMaskBit(ref)) return null;
  return BY_BIT[ref] ? ref : null;
}

export function resolveMutationRef(ref: MutationRef): MutationRef | null {
  if (typeof ref === "string") {
    if (MUTATIONS_BY_KEY[ref]) return MUTATIONS_BY_KEY[ref].bit;
    if (MODDED_MUTATIONS[ref]) return ref;
    return null;
  }
  return resolveMutationBit(ref);
}

export function mutationOf(ref: MutationRef): ResolvedMutationDef | null {
  if (typeof ref === "string") return MODDED_MUTATIONS[ref] ?? MUTATIONS_BY_KEY[ref] ?? null;
  const bit = resolveMutationBit(ref);
  return bit === null ? null : BY_BIT[bit];
}

export function bitOf(key: MutationKey): number {
  const def = MUTATIONS_BY_KEY[key];
  if (!def) throw new Error(`unknown vanilla mutation "${key}" - see CATALOG in mutations.ts`);
  return def.bit;
}

export function mutationName(ref: MutationRef): string {
  return mutationOf(ref)?.name ?? "";
}

export function sanitizeMutationMask(mask: unknown): number {
  if (typeof mask !== "number" || !Number.isSafeInteger(mask) || mask <= 0) return 0;
  return maskIntersect(mask, ALL_MUTATIONS_MASK);
}

export function normalizeMutationIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !MODDED_MUTATIONS[id] || seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  return out;
}

export function slotOf(bit: number): Slot | null {
  return BY_BIT[bit]?.slot ?? null;
}

export function slotOfRef(ref: MutationRef): Slot | null {
  return mutationOf(ref)?.slot ?? null;
}

export function bitsOf(mask: number): number[] {
  return ALL_BITS.filter((b) => maskHas(mask, b));
}

export { maskBits };

export function mutationRefs(mask: number, mutationIds?: unknown): MutationRef[] {
  return [...bitsOf(mask), ...normalizeMutationIds(mutationIds)];
}

export function mutationsOf(mask: number, mutationIds?: unknown): ResolvedMutationDef[] {
  return mutationRefs(mask, mutationIds)
    .map((ref) => mutationOf(ref))
    .filter((def): def is ResolvedMutationDef => !!def);
}

export function occupiedSlots(mask: number): Set<Slot> {
  const s = new Set<Slot>();
  for (const slot of SLOTS) if (maskIntersect(mask, SLOT_MASK[slot]) !== 0) s.add(slot);
  return s;
}

export function occupiedMutationSlots(mask: number, mutationIds?: unknown): Set<Slot> {
  const s = occupiedSlots(mask);
  for (const id of normalizeMutationIds(mutationIds)) s.add(MODDED_MUTATIONS[id].slot);
  return s;
}

export function mutationCount(mask: number, mutationIds?: unknown): number {
  return mutationRefs(mask, mutationIds).length;
}

export function isFullyMutated(mask: number, mutationIds?: unknown): boolean {
  return occupiedMutationSlots(mask, mutationIds).size === SLOTS.length;
}

export const HEADLESS_SLOTS: ReadonlySet<Slot> = new Set<Slot>(["body", "arm", "armB", "neck"]);
export const HEADLESS_HEAD_MASK = MUTATIONS_BY_KEY.pumpking.bit;
export const HEADLESS_FORBIDDEN_MASK =
  maskWithout(maskUnion(SLOT_MASK.head, SLOT_MASK.hair_eye), HEADLESS_HEAD_MASK);

export function bitAllowed(bit: number, isHeadless: boolean): boolean {
  const slot = slotOf(bit);
  if (slot === null) return false;
  if (!isHeadless) return true;
  return HEADLESS_SLOTS.has(slot) || maskHas(HEADLESS_HEAD_MASK, bit);
}

export function bitGrowable(bit: number, isHeadless: boolean): boolean {
  if (!bitAllowed(bit, isHeadless)) return false;
  return isHeadless || !maskHas(HEADLESS_HEAD_MASK, bit);
}

export function refAllowed(ref: MutationRef, isHeadless: boolean): boolean {
  const bit = typeof ref === "number" ? resolveMutationBit(ref) : MUTATIONS_BY_KEY[ref]?.bit ?? null;
  if (bit !== null) return bitAllowed(bit, isHeadless);
  const def = typeof ref === "string" ? MODDED_MUTATIONS[ref] : undefined;
  if (!def) return false;
  return !isHeadless || HEADLESS_SLOTS.has(def.slot);
}

export function refGrowable(ref: MutationRef, isHeadless: boolean): boolean {
  const bit = typeof ref === "number" ? resolveMutationBit(ref) : MUTATIONS_BY_KEY[ref]?.bit ?? null;
  if (bit !== null) return bitGrowable(bit, isHeadless);
  return refAllowed(ref, isHeadless);
}

export function applyBodyTypeRestriction(mask: number, isHeadless: boolean): number {
  return isHeadless ? maskWithout(mask, HEADLESS_FORBIDDEN_MASK) : mask;
}

export function applyBodyTypeIdRestriction(ids: unknown, isHeadless: boolean): string[] {
  const normalized = normalizeMutationIds(ids);
  return isHeadless
    ? normalized.filter((id) => HEADLESS_SLOTS.has(MODDED_MUTATIONS[id].slot))
    : normalized;
}

export function canReceive(mask: number, bit: number, isHeadless = false): boolean {
  const slot = slotOf(bit);
  if (slot === null) return false;
  if (!bitAllowed(bit, isHeadless)) return false;
  if (maskHas(mask, bit)) return true;
  return maskIntersect(mask, SLOT_MASK[slot]) === 0;
}

export function canReceiveRef(mask: number, mutationIds: unknown, ref: MutationRef, isHeadless = false): boolean {
  const resolved = resolveMutationRef(ref);
  if (resolved === null) return false;
  const ids = normalizeMutationIds(mutationIds);
  if (typeof resolved === "number") {
    if (!bitAllowed(resolved, isHeadless)) return false;
    if (maskHas(mask, resolved)) return true;
    const slot = slotOf(resolved);
    return slot !== null && !occupiedMutationSlots(mask, ids).has(slot);
  }
  if (!refAllowed(resolved, isHeadless)) return false;
  if (ids.includes(resolved)) return true;
  const slot = MODDED_MUTATIONS[resolved].slot;
  return !occupiedMutationSlots(mask, ids).has(slot);
}

export function addMutation(mask: number, bit: number, isHeadless = false): number {
  return canReceive(mask, bit, isHeadless) ? maskUnion(mask, bit) : mask;
}

export interface MutationSet {
  mask: number;
  ids: string[];
}

export function addMutationRef(set: MutationSet, ref: MutationRef, isHeadless = false): MutationSet {
  const resolved = resolveMutationRef(ref);
  if (resolved === null) return set;
  const ids = applyBodyTypeIdRestriction(set.ids, isHeadless);
  if (!canReceiveRef(set.mask, ids, resolved, isHeadless)) return { mask: set.mask, ids };
  if (typeof resolved === "number") return { mask: maskUnion(set.mask, resolved), ids };
  return ids.includes(resolved) ? { mask: set.mask, ids } : { mask: set.mask, ids: [...ids, resolved] };
}

export function mutationLabel(mask: number, mutationIds?: unknown): string {
  return mutationsOf(mask, mutationIds)
    .map((m) => m.name)
    .join(", ");
}

export function mutationBonus(mask: number, mutationIds?: unknown): Record<Stat, number> {
  const b: Record<Stat, number> = { str: 0, con: 0, dex: 0, wis: 0 };
  for (const m of mutationsOf(mask, mutationIds)) {
    for (const { stat, amount } of statEffectsOf(m)) b[stat] += amount;
  }
  return b;
}

function refRank(ref: MutationRef): number {
  if (typeof ref === "number") return ref;
  const index = ALL_MODDED_MUTATION_IDS.indexOf(ref);
  return index < 0 ? 0 : 1_000_000_000 + index;
}

function highestSlotRef(refs: MutationRef[], slot: Slot): MutationRef | null {
  const candidates = refs.filter((ref) => slotOfRef(ref) === slot);
  if (!candidates.length) return null;
  return candidates.reduce((best, ref) => (refRank(ref) > refRank(best) ? ref : best), candidates[0]);
}

export function combineMasks(a: number, b: number, isHeadlessChild = false): number {
  return combineMutationSets(a, [], b, [], isHeadlessChild).mask;
}

export function combineMutationSets(
  aMask: number,
  aIds: unknown,
  bMask: number,
  bIds: unknown,
  isHeadlessChild = false,
): MutationSet {
  const refs = [
    ...mutationRefs(applyBodyTypeRestriction(aMask, isHeadlessChild), applyBodyTypeIdRestriction(aIds, isHeadlessChild)),
    ...mutationRefs(applyBodyTypeRestriction(bMask, isHeadlessChild), applyBodyTypeIdRestriction(bIds, isHeadlessChild)),
  ];
  let child: MutationSet = { mask: 0, ids: [] };
  for (const slot of SLOTS) {
    const ref = highestSlotRef(refs, slot);
    if (ref === null) continue;
    child = addMutationRef(child, ref, isHeadlessChild);
  }
  return child;
}
