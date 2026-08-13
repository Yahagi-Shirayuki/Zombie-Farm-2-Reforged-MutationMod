// An owned zombie unit grown from a harvested zombie crop (Phase 3). Only `id`,
// `key`, and its farm tile are source-of-truth (persisted); the taxonomy + stats
// are derived from the zombie catalog (zombies.json) by key at spawn/restore.
import type { ZombieDef } from "../assets";
import { classify } from "./taxonomy";
import { applyBodyTypeIdRestriction, applyBodyTypeRestriction, mutationBonus, normalizeMutationIds } from "./mutations";
import { wisToFocusBonus } from "./traits";
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

export interface OwnedZombie {
  id: string;
  key: string;
  name: string;
  typeName: string;
  group: string;
  className: string;
  classColor: string;
  color?: [number, number, number];
  powderStats?: ZombiePowderStats;
  powderStatProgress?: ZombiePowderStatProgress;
  /** Vanilla mutation bitmask. Local modded mutations live in mutationIds. */
  mutation: number;
  /** Real string ids for local modded mutations. */
  mutationIds?: string[];
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
): OwnedZombie {
  const tax = classify(def.key);
  const group = def.group ?? tax.group;
  const isHeadless = group === "Headless";
  const mask = applyBodyTypeRestriction(mutation ?? def.mutation ?? 0, isHeadless);
  const ids = applyBodyTypeIdRestriction(normalizeMutationIds(mutationIds ?? def.mutationIds), isHeadless);
  const bonus = mutationBonus(mask, ids);
  const cleanPowderStats = sanitizeZombiePowderStats(powderStats);
  const cleanPowderProgress = sanitizeZombiePowderStatProgress(powderStatProgress);
  return {
    id,
    key: def.key,
    name: (normalizeZombieName(customName) ?? randomZombieName(group, id)) || def.name,
    typeName: def.name,
    group,
    className: def.className ?? tax.className,
    classColor: def.classColor ?? tax.classColor,
    color,
    ...(Object.keys(cleanPowderStats).length ? { powderStats: cleanPowderStats } : {}),
    ...(Object.keys(cleanPowderProgress).length ? { powderStatProgress: cleanPowderProgress } : {}),
    mutation: mask,
    ...(ids.length ? { mutationIds: ids } : {}),
    str: (def.str ?? 1) + bonus.str,
    dex: (def.dex ?? 1) + bonus.dex,
    con: (def.con ?? 1) + bonus.con,
    focus: (def.focus ?? 0) + wisToFocusBonus(bonus.wis),
    invasions,
    col,
    row,
  };
}

