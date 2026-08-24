import { RewardType, type QuestDef } from "../quest/types";
import { QuestEvent } from "../quest/events";
import { epicBossUnlockLevel } from "./catalog";
import type { EpicBossDef } from "./types";

/** The event picker's list: every boss in UNLOCK order, or just the active one.
 *
 *  The catalog array is in recovery order (the five bosses with authored animation
 *  strips first, then the three reconstructed ones), which is the right order for
 *  asset code and the wrong one for a shop: it listed the level-42 event second, above
 *  four cheaper ones. Sorting here rather than reordering EPIC_BOSSES keeps the
 *  authored/reconstructed split that the asset tests rely on. Ties fall back to the
 *  catalog's own order, so a future event without its own unlock level still lands
 *  somewhere stable. */
export function visibleEpicBosses(
  bosses: readonly EpicBossDef[], activeBossId: string | null
): readonly EpicBossDef[] {
  if (activeBossId) return bosses.filter((boss) => boss.id === activeBossId);
  return [...bosses].sort(
    (a, b) => epicBossUnlockLevel(a) - epicBossUnlockLevel(b) || bosses.indexOf(a) - bosses.indexOf(b)
  );
}

/** Player-facing milestone notes for the special zombies in a boss's quest chain. */
export function epicZombieRewardNotes(
  boss: EpicBossDef, quests: Readonly<Record<string, QuestDef>>
): string[] {
  return boss.questIds.flatMap((id) => {
    const quest = quests[id];
    if (!quest || quest.rewardType !== RewardType.Zombie || !quest.rewardItem) return [];
    const levels = quest.requirements
      .filter((requirement) => requirement.notificationID === QuestEvent.EpicStageEnemyDefeated)
      .map((requirement) => Number(requirement.notificationObject))
      .filter((level) => Number.isFinite(level));
    if (!levels.length) return [quest.rewardItem];
    // The HIGHEST rung, not the list. A prize can be gated behind a collection chain of
    // several defeat requirements — Skunkarella's Diva needs rungs 2, 3, 4 AND 5 ("Prize
    // Cards 1-4") — and listing them read as "any one of these" when it means all of
    // them. The ladder only ever advances one rung per win (EpicBossManager: run.level++
    // from 1), so reaching the top requirement necessarily clears every one below it:
    // the last rung is both the honest completion point and the only number a shopper
    // needs. The per-card breakdown still shows on the quest rail, where each
    // requirement has its own line and checkbox.
    return [`Level ${Math.max(...levels)}: ${quest.rewardItem}`];
  });
}
