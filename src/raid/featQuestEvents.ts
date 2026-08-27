// Turn a settled invasion into the quest events that describe HOW it was won.
//
// Shared deliberately: the offline build calls this from RaidManager and the Worker
// calls it from /raid/finish, off the same RaidFeats produced by the same BattleSim.
// Two copies of these rules would be two chances for an achievement to be grantable
// offline and not online (or the reverse).
//
// EVERYTHING HERE REQUIRES A WIN. Resurrections and ability kills happen during a
// losing fight too, but counting them would make deliberately throwing an invasion the
// cheapest way to farm "revive 25 zombies" — the fight is short, the roster survives,
// and the cooldown is the only cost. Gating on the win removes that entirely.

import type { RaidFeats } from "./types";

/** Display name a quest names an ability by. Both tiers of a move share one subject:
 *  a quest asks you to kill something with an EXPLOSION, and whether that came from
 *  Explode or Explode Ver. 2 is a detail of which zombie you brought. (The boss-kill
 *  quest is still implicitly tier 4, because plain Explode cannot hit a boss at all —
 *  see the hitBoss guard in BattleSim.) */
export const ABILITY_SUBJECT: Readonly<Record<string, string>> = {
  explode: "Explosion",
  explodeV2: "Explosion",
  bash: "Smash",
  bashV2: "Smash",
};

/** Alias carried by a resurrection that pulled a zombie out of its OWN blast. */
export const EXPLODED_MINI_SUBJECT = "Exploded Mini";

export interface FeatQuestInput {
  win: boolean;
  /** Nobody fell — the same condition the perfect-game event already uses. */
  perfect: boolean;
  /** The invasion ran on a Brain Ticket. Server-pinned on the session. */
  elite: boolean;
  raidName: string;
  feats?: RaidFeats;
}

export interface FeatQuestEvent {
  type: string;
  subject: string;
  aliases?: string[];
}

/** Elite and technique events for one settled invasion. The ordinary
 *  win / perfect-game / loot events are NOT produced here — they already have their
 *  own call sites on both sides, and moving them would change existing behaviour. */
export function raidFeatQuestEvents(input: FeatQuestInput): FeatQuestEvent[] {
  if (!input.win) return [];
  const events: FeatQuestEvent[] = [];

  if (input.elite) {
    events.push({ type: "kEliteInvasionSuccessfulNotification", subject: input.raidName });
    if (input.perfect) {
      events.push({ type: "kElitePerfectGameNotification", subject: input.raidName });
    }
  }

  for (const kill of input.feats?.abilityKills ?? []) {
    const subject = ABILITY_SUBJECT[kill.ability];
    if (!subject) continue; // an ability with no quest identity (Mini Buddy)
    // A boss is also an enemy, so a boss kill counts toward BOTH "destroy N enemies
    // with explosions" and "defeat a boss with an explosion". Anything else would make
    // the hardest kill in the fight not count toward the easier quest.
    events.push({ type: "kEnemyDefeatedByAbilityNotification", subject });
    if (kill.boss) {
      events.push({ type: "kBossDefeatedByAbilityNotification", subject });
    }
  }

  for (const rez of input.feats?.resurrections ?? []) {
    events.push({
      type: "kZombieResurrectedNotification",
      subject: "",
      // Subject stays the wildcard so "revive N zombies" counts every one; the alias is
      // what lets the Garden/Small combo quest name the special case without a second
      // event that the wildcard would then double-count.
      ...(rez.exploded ? { aliases: [EXPLODED_MINI_SUBJECT] } : {}),
    });
  }

  return events;
}
