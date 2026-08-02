// Zombie Almanac: the collection ("dex") behind the Zombies menu's second tab.
// Pure data logic — which species belong in the almanac, how each is obtained,
// and the lifetime-discovery counter shape persisted in the save. Rendering
// lives in ui/panels/zombies.ts; discovery increments in ZombieField/GameState.
import type { ZombieDef } from "../assets";
import { purchasableZombies } from "../assets";
import { COMBINE_SPECIAL_BY_GROUP, COMBINE_SPECIAL_LEVEL } from "./combineSpecies";
import { EPIC_QUEST_ZOMBIE_REWARDS } from "../epicBoss/rewards";
import { RAID_ZOMBIE_DROPS } from "../raid/zombieDrops";

/** Lifetime obtained count per species key. Persisted (local save / online
 *  presentation — see save/schema.ts AlmanacSave). A key's presence with a
 *  count >= 1 means "discovered". */
export type DiscoveredMap = Record<string, number>;

/** Names looked up by the caller (main.ts owns the raid + epic boss catalogs). */
export interface ObtainSources {
  raidNameById: (raidId: number) => string | undefined;
  epicBossNameByQuestId: (questId: string) => string | undefined;
}

// Reverse maps: species key -> where it comes from.
const RAID_BY_ZOMBIE: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(RAID_ZOMBIE_DROPS).map(([raidId, drop]) => [drop.key, Number(raidId)])
);
const EPIC_QUEST_BY_ZOMBIE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EPIC_QUEST_ZOMBIE_REWARDS).map(([questId, key]) => [key, questId])
);
const POT_SPECIALS = new Set(Object.values(COMBINE_SPECIAL_BY_GROUP));

/** Is this species currently acquirable through any real path? Orphaned seasonal
 *  specials (no market seed, no reward source wired yet) stay OUT of the almanac
 *  until they gain one — the almanac lists obtainable zombies only. */
export function isObtainable(def: ZombieDef): boolean {
  return (
    (!def.rewardOnly && !def.marketHidden) ||
    POT_SPECIALS.has(def.key) ||
    def.key in EPIC_QUEST_BY_ZOMBIE ||
    def.key in RAID_BY_ZOMBIE
  );
}

const CATEGORY_ORDER: Record<string, number> = { normal: 0, mutant: 1, special: 2 };

/** The almanac's entry list: every obtainable species, plus any species the
 *  player has already discovered even if it has no current source (a legacy or
 *  event grant must never vanish from the collection). Sorted for display:
 *  normal -> mutant -> special, then by unlock level, then name. */
export function almanacEntries(
  zombies: readonly ZombieDef[],
  discovered: DiscoveredMap
): ZombieDef[] {
  return zombies
    .filter((def) => isObtainable(def) || (discovered[def.key] ?? 0) > 0)
    .sort(
      (a, b) =>
        (CATEGORY_ORDER[a.category] ?? 3) - (CATEGORY_ORDER[b.category] ?? 3) ||
        a.level - b.level ||
        a.name.localeCompare(b.name)
    );
}

/** One-line "how do I get this?" hint, shown for undiscovered entries. Sources are
 *  checked in specificity order — a raid/epic exclusive names its exact source. */
export function obtainHint(def: ZombieDef, sources: ObtainSources): string {
  const raidId = RAID_BY_ZOMBIE[def.key];
  if (raidId !== undefined) {
    const raid = sources.raidNameById(raidId);
    return raid
      ? `Rarely found after winning an invasion of ${raid}.`
      : "Rarely found after winning a certain invasion.";
  }
  const questId = EPIC_QUEST_BY_ZOMBIE[def.key];
  if (questId !== undefined) {
    const boss = sources.epicBossNameByQuestId(questId);
    return boss
      ? `Earned by fighting ${boss} during an Epic Boss event.`
      : "Earned during an Epic Boss event.";
  }
  if (POT_SPECIALS.has(def.key)) {
    return `A rare Zombie Pot result: combine two ${def.group} zombies at level ${COMBINE_SPECIAL_LEVEL}+.`;
  }
  if (!def.rewardOnly && !def.marketHidden) {
    const price = def.brainsNeeded ? `${def.cost} brains` : `${def.cost} gold`;
    return `Grow it from a Market gravestone (level ${Math.max(1, def.level)}, ${price}).`;
  }
  return "Obtained from special events.";
}

/** Seed the discovery map from an existing roster (first run after the almanac
 *  ships, or a save written before it existed): every currently owned species
 *  counts at least the number of copies owned right now. */
export function backfillDiscovered(roster: readonly { key: string }[]): DiscoveredMap {
  const discovered: DiscoveredMap = {};
  for (const unit of roster) discovered[unit.key] = (discovered[unit.key] ?? 0) + 1;
  return discovered;
}

/** Sanitize a persisted discovery map: keep finite counts >= 1 only. */
export function sanitizeDiscovered(raw: unknown): DiscoveredMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const discovered: DiscoveredMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
      discovered[key] = Math.floor(value);
    }
  }
  return discovered;
}

// purchasableZombies is re-exported so panel/test code has one almanac import
// surface for "what the market sells" vs "what the almanac lists".
export { purchasableZombies };
