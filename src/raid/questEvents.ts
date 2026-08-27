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
import { raidFeatQuestEvents } from "./featQuestEvents";
import { RARE_INVASION_ZOMBIE_SUBJECT, isRareInvasionZombieName } from "./zombieDrops";
import type { RaidFeats } from "./types";

export interface RaidWinSummary {
  win: boolean;
  zombiesLost: number;
  loot: { name: string }[];
  /** The invasion ran on a Brain Ticket. Absent on an ordinary run. */
  elite?: boolean;
  /** How the fight was won, for the technique achievements. Absent when the caller
   *  has no BattleSim outcome to hand (older call sites, tests). */
  feats?: RaidFeats;
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
  for (const drop of view.loot) {
    // The rare invasion zombie arrives as ordinary loot, so it is here that it picks up
    // the generic identity the "obtain a rare zombie" quest names.
    const aliases = isRareInvasionZombieName(drop.name) ? [RARE_INVASION_ZOMBIE_SUBJECT] : [];
    bus.post(QuestEvent.LootItemWon, drop.name, 1, aliases);
  }
  // Elite + technique events come from the shared derivation the Worker also uses, so
  // an achievement cannot be earnable in one build and not the other.
  const feats = raidFeatQuestEvents({
    win: true,
    perfect: view.zombiesLost === 0,
    elite: !!view.elite,
    raidName,
    feats: view.feats,
  });
  for (const event of feats) bus.post(event.type, event.subject, 1, event.aliases ?? []);
}
