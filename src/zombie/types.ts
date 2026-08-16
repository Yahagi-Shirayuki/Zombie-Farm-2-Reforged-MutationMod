// An owned zombie unit grown from a harvested zombie crop (Phase 3). Only `id`,
// `key`, and its farm tile are source-of-truth (persisted); the taxonomy + stats
// are derived from the zombie catalog (zombies.json) by key at spawn/restore.
import type { ZombieDef } from "../assets";
import { classify } from "./taxonomy";
import { applyBodyTypeIdRestriction, applyBodyTypeRestriction, mutationBonus, normalizeMutationIds, SLOT_MASK } from "./mutations";
import { ABILITY_TIER, randomAbilityPoolForTiers, statDisplayMax, wisToFocusBonus, type StatMeta } from "./traits";
import { randomZombieName } from "./names";
import {
  sanitizeZombiePowderStatProgress,
  sanitizeZombiePowderStats,
  type ZombiePowderStatProgress,
  type ZombiePowderStats,
} from "../zombieColorMixerBucket";

export const MAX_ZOMBIE_NAME_LENGTH = 24;

/** Normalize a player-authored zombie name for display and persistence. */
export function normalizeZombieName(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return cleaned ? [...cleaned].slice(0, MAX_ZOMBIE_NAME_LENGTH).join("") : null;
}

export type RosterEntry = OwnedZombie & { stored: boolean };
export type OwnedZombieRolledStats = Record<StatMeta["key"], number>;

export interface OwnedZombieRolls {
  abilityKeys?: string[];
  visualGroup?: string;
  visualScale?: number;
  rolledStats?: OwnedZombieRolledStats;
}

export interface OwnedZombie {
  id: string;
  key: string;
  name: string;
  typeName: string;
  group: string;
  /** Render-only body family. Mechanics still use group. */
  visualGroup?: string;
  /** Render-only individual size multiplier. Mechanics still use group/type. */
  visualScale?: number;
  className: string;
  classColor: string;
  color?: [number, number, number];
  powderStats?: ZombiePowderStats;
  powderStatProgress?: ZombiePowderStatProgress;
  /** Vanilla mutation bitmask. Local modded mutations live in mutationIds. */
  mutation: number;
  /** Real string ids for local modded mutations. */
  mutationIds?: string[];
  /** Explicit ability slots for this individual zombie. */
  abilityKeys?: string[];
  /** Persisted random base stats, before mutation bonuses. */
  rolledStats?: OwnedZombieRolledStats;
  str: number;
  dex: number;
  con: number;
  focus: number;
  invasions: number;
  col: number;
  row: number;
}

export function makeOwned(
  id: string,
  def: ZombieDef,
  col: number,
  row: number,
  invasions = 0,
  mutation?: number,
  color?: [number, number, number],
  customName?: string,
  mutationIds?: readonly string[],
  powderStats?: ZombiePowderStats,
  powderStatProgress?: ZombiePowderStatProgress,
  rolls?: OwnedZombieRolls,
): OwnedZombie {
  const tax = classify(def.key);
  const group = def.group ?? tax.group;
  const restrictHeadSlots = group === "Headless" || def.mutationProfile === "headless";
  const restrictedMask = applyBodyTypeRestriction(mutation ?? def.mutation ?? 0, restrictHeadSlots);
  const mask = def.mutationProfile === "headless"
    ? restrictedMask & ~(SLOT_MASK.head | SLOT_MASK.hair_eye)
    : restrictedMask;
  const ids = applyBodyTypeIdRestriction(normalizeMutationIds(mutationIds ?? def.mutationIds), restrictHeadSlots);
  const bonus = mutationBonus(mask, ids);
  const cleanPowderStats = sanitizeZombiePowderStats(powderStats);
  const cleanPowderProgress = sanitizeZombiePowderStatProgress(powderStatProgress);
  const rolledStats = rolls?.rolledStats ?? rollBaseStats(def);
  const abilityKeys = rolls?.abilityKeys ?? rollAbilityKeys(def);
  const visualGroup = rolls?.visualGroup ?? rollVisualGroup(def);
  const visualScale = cleanVisualScale(rolls?.visualScale ?? rollVisualScale(def));
  const ownedColor = color ?? rollBodyColor(def);
  const baseStr = rolledStats?.str ?? (def.str ?? 1);
  const baseDex = rolledStats?.dex ?? (def.dex ?? 1);
  const baseCon = rolledStats?.con ?? (def.con ?? 1);
  const baseFocus = rolledStats?.focus ?? (def.focus ?? 0);
  return {
    id,
    key: def.key,
    name: (normalizeZombieName(customName) ?? randomZombieName(group, id)) || def.name,
    typeName: def.name,
    group,
    ...(visualGroup ? { visualGroup } : {}),
    ...(visualScale !== undefined ? { visualScale } : {}),
    className: def.className ?? tax.className,
    classColor: def.classColor ?? tax.classColor,
    ...(ownedColor ? { color: ownedColor } : {}),
    ...(Object.keys(cleanPowderStats).length ? { powderStats: cleanPowderStats } : {}),
    ...(Object.keys(cleanPowderProgress).length ? { powderStatProgress: cleanPowderProgress } : {}),
    mutation: mask,
    ...(ids.length ? { mutationIds: ids } : {}),
    ...(abilityKeys?.length ? { abilityKeys } : {}),
    ...(rolledStats ? { rolledStats } : {}),
    str: baseStr + bonus.str,
    dex: baseDex + bonus.dex,
    con: baseCon + bonus.con,
    focus: baseFocus + wisToFocusBonus(bonus.wis),
    invasions,
    col,
    row,
  };
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollBodyColor(def: ZombieDef): [number, number, number] | undefined {
  if (!def.randomizeOnCreate?.bodyColor) return undefined;
  return [randomInt(0, 255), randomInt(0, 255), randomInt(0, 255)];
}

function rollAbilityKeys(def: ZombieDef): string[] | undefined {
  const slots = Math.max(0, Math.floor(def.randomizeOnCreate?.abilitySlots ?? 0));
  if (!slots) return undefined;
  const tiers = def.randomizeOnCreate?.abilityTiers?.length
    ? def.randomizeOnCreate.abilityTiers
    : Object.keys(ABILITY_TIER).map(Number);
  const pool = randomAbilityPoolForTiers(tiers);
  const out: string[] = [];
  const available = [...pool];
  for (let i = 0; i < slots && available.length; i++) {
    const index = randomInt(0, available.length - 1);
    out.push(available.splice(index, 1)[0]);
  }
  return out;
}

function rollVisualGroup(def: ZombieDef): string | undefined {
  const groups = def.randomizeOnCreate?.visualGroups?.filter((group) => typeof group === "string" && group);
  if (!groups?.length) return undefined;
  return groups[randomInt(0, groups.length - 1)];
}

function cleanVisualScale(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0.05, Math.min(4, value));
}

function rollVisualScale(def: ZombieDef): number | undefined {
  const range = def.randomizeOnCreate?.visualScale;
  if (!range) return undefined;
  const min = Math.min(range.min, range.max);
  const max = Math.max(range.min, range.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  return min + Math.random() * (max - min);
}

function rollBaseStats(def: ZombieDef): OwnedZombieRolledStats | undefined {
  const ranges = def.randomizeOnCreate?.displayStats;
  if (!ranges) return undefined;
  const roll = (key: StatMeta["key"], fallback: number): number => {
    const range = ranges[key];
    if (!range) return fallback;
    const display = randomInt(Math.ceil(range.min), Math.floor(range.max));
    const max = statDisplayMax(key);
    return max === null ? display : (max * display) / 100;
  };
  return {
    str: roll("str", def.str ?? 1),
    dex: roll("dex", def.dex ?? 1),
    con: roll("con", def.con ?? 1),
    focus: roll("focus", def.focus ?? 0),
  };
}

