// The quest events a raid WIN produces: the invasion itself, each looted item, and a
// "perfect game" when nobody fell. Object names match the quest data (raid name / loot
// item name), so invasion/loot quests advance.
//
// ONLINE these events are NOT posted. /raid/finish already counted the same win in the
// authoritative quest projection and returned the resulting `questChanges`, which the
// balance client hands to QuestSystem.applyAuthoritativeChanges(). Posting locally on
// top of that counted every win TWICE in the optimistic presentation layer, so a
// 3-invasion quest displayed 3/3 (and fired its completion popup) after only two real
// wins — while the server, correctly at 2/3, granted no reward. The Epic Boss path
// already guards its own posts the same way.
import { QuestBus, QuestEvent } from "../quest/events";

export interface RaidWinSummary {
  win: boolean;
  zombiesLost: number;
  loot: { name: string }[];
}

export function postRaidWinQuests(
  bus: QuestBus,
  view: RaidWinSummary,
  raidName: string,
  /** True when the raid ran under a server session, so the server already counted it. */
  serverCounted: boolean
): void {
  if (!view.win || serverCounted) return;
  bus.post(QuestEvent.InvasionSuccessful, raidName, 1);
  if (view.zombiesLost === 0) bus.post(QuestEvent.InvasionPerfectGame, raidName, 1);
  for (const drop of view.loot) bus.post(QuestEvent.LootItemWon, drop.name, 1);
}
