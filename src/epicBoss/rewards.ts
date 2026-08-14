/** Chance that ONE decor roll pays out. This is the authored rate and stays put — it was
 *  calibrated when a ladder was 40 rungs long, so it is the number of ROLLS that has to
 *  move as the ladder shortens, not the odds of each one. */
export const EPIC_LOOT_DROP_CHANCE = 0.35;

/** Decor rolls per cleared rung.
 *
 *  Two, because the ladder is now 10 rungs where the rate was authored against 40. One
 *  roll per rung would hand a player a quarter of the decor for the same event and the
 *  same fighting; two restores the haul to ~7 items over a full clear.
 *
 *  Two rolls at 0.35 rather than one at 0.70 on purpose, even though the expectation is
 *  identical. A single roll can only ever pay one prize, so a shorter ladder means fewer
 *  chances to see a NEW item and a collection that fills more slowly. Two independent
 *  rolls can drop two different prizes from one clear — the second roll re-picks from the
 *  pool with the first already excluded — which is what keeps a 10-rung event able to
 *  finish a collection at all. */
export const EPIC_LOOT_ROLLS = 2;

/** Chance that clearing rung `level` also drops a Brain Ticket, at 1.5% PER RUNG.
 *
 *  Scaled by the rung rather than flat so the reward tracks the fight: rung 1 is one
 *  attempt and pays 1.5%, rung 9 pays 13.5%. The FINAL rung is a guarantee rather than a
 *  chance, for the same reason the brain is — the clear that ends a ladder should pay.
 *  Over a full clear that is 1.5% x (1+2+...+9) + 1 = 1.675 tickets.
 *
 *  A Brain Ticket is a 10,000-gold Market item that turns an invasion elite. Dropping it
 *  here is deliberately a GOLD-side reward, not a brain-side one: the event is priced in
 *  brains and pays out in prizes, and this keeps that separation while still giving the
 *  deep rungs something a player feels. */
export const EPIC_BRAIN_TICKET_CHANCE_PER_LEVEL = 0.015;
export const epicBrainTicketChance = (level: number, maxLevel = 10): number =>
  Math.floor(level) === Math.floor(maxLevel)
    ? 1
    : Math.max(0, Math.min(1, EPIC_BRAIN_TICKET_CHANCE_PER_LEVEL * Math.max(0, Math.floor(level))));

/** Epic-event quest rewards use dedicated catalog keys even though the recovered
 * source data points several of them at generic Regular/Girl actor classes. Keeping
 * this mapping shared prevents the client quest flow and authoritative Worker grant
 * from disagreeing about which named zombie was earned. */
export const EPIC_QUEST_ZOMBIE_REWARDS: Readonly<Record<string, string>> = {
  "1000": "ZombieActorDrZombie",
  "1011": "ZombieActorOmegaDrZombie",
  "2000": "ZombieActorBandido",
  "2011": "ZombieActorVagabond",
  "3000": "ZombieActorCaptain",
  "3011": "ZombieActorAdmiral",
  "4000": "ZombieActorChristmasGhost",
  "4011": "ZombieActorScrooge",
  "5000": "ZombieActorDiva",
  "5011": "ZombieActorMadame",
  "8000": "ZombieActorBrockColey",
  "9000": "ZombieActorProto",
  "9011": "ZombieActorZombug",
  "10000": "ZombieActorZomdini",
  "10011": "ZombieActorZomtar",
};

export const epicQuestZombieReward = (questId: string): string | null =>
  EPIC_QUEST_ZOMBIE_REWARDS[questId] ?? null;

/** Activating an event re-opens its own quests, so a boss the player has already
 *  finished can be run — and paid out — again. An epic quest is otherwise complete
 *  forever, which retired the event's signature zombie after one clear.
 *
 *  Only quests that are ALREADY COMPLETE are touched, and their stored progress goes
 *  with the completion flag. Both halves matter:
 *   - Progress must go, or the reopened quest sits at its target and re-completes on
 *     the very first win of the new run, whatever level that win was on.
 *   - Incomplete quests must be left alone, because epic progress is deliberately
 *     LIFETIME progress: "win all 8 of this boss's prizes" is meant to survive the
 *     event expiring and be resumed by a later activation (QuestSystem.restore).
 *
 *  Returns null when nothing was completed, so callers can skip the write. */
export function reopenEpicQuests<
  T extends { completed: string[]; progress: { questId: string; counts: number[] }[] }
>(quests: T, questIds: readonly string[]): { completed: string[]; progress: T["progress"] } | null {
  const done = new Set(quests.completed);
  const reopened = new Set(questIds.filter((id) => done.has(id)));
  if (!reopened.size) return null;
  return {
    completed: quests.completed.filter((id) => !reopened.has(id)),
    progress: quests.progress.filter((entry) => !reopened.has(entry.questId)),
  };
}

/** Farm first; once the authoritative deployed cap is full, the earned unit is filed
 * in Received instead of being destroyed. It is not yet in the roster — claiming it
 * from Received later takes a real Mausoleum slot (see storage.claim). */
export const shouldStoreEpicReward = (activeCount: number, activeCapacity: number): boolean =>
  activeCount >= Math.max(0, activeCapacity);

/** Pick weight for one epic-boss prize, so the ladder's top prizes are RARE.
 *
 * A uniform pick over everything unlocked made the level-37 signature item exactly as
 * likely as the level-5 starter — climbing the ladder bought no better odds on the prize
 * that climbing unlocks. The rung is the game's own rarity signal, so weight is its
 * inverse: on Foul Owl's full ladder that runs from ~37% for the first snowman down to
 * ~5% for the Gift Vault. Fed to `pickByFrequency` (the binary's cumulative
 * frequency-weighted pick) by both the offline roll and the Worker.
 *
 * Binary loot selection for epic bosses is still unrecovered (docs/EPIC_BOSS_MECHANICS.md);
 * this is a reimplementation choice, and monotone in level is all it claims to be. */
export const epicLootWeight = (level: number): number => 1 / Math.max(1, level);

export interface EpicBossCurrencyReward {
  brains: number;
  gold: number;
}

/** Chance that clearing any one rung drops a brain.
 *
 *  An epic event is not a brain faucet. Activating one costs 3-5 brains and every attempt
 *  past your harvested tokens costs another, so at the old schedule — a guaranteed 5 per
 *  full clear — a player came out ahead simply by finishing, and the event quietly became
 *  one of the better brain sources in the game. Brains are meant to stay scarce (income
 *  moves from ~1.6/day at level 4 to ~2.9/day at 44 by design), and the event's payment is
 *  its prizes: the zombies, the decor and the pet.
 *
 *  At 8% across the first nine rungs the expected haul is 0.72 brains, plus one GUARANTEED
 *  on the final rung — see epicBossCurrencyReward. Against a 3-5 brain entry that is still
 *  reliably brain-NEGATIVE (1.72 expected out), so the event never becomes a faucet; the
 *  guarantee exists so the fight that ENDS a ladder pays something certain, rather than the
 *  capstone being the one clear that can hand back nothing. */
export const EPIC_BRAIN_DROP_CHANCE = 0.08;

/** Currency for one cleared rung.
 *
 * Gold is deterministic; the brain is a roll, so `random` is injectable and the SERVER's
 * roll is authoritative. An online client must display what came back in the finish
 * response rather than calling this itself — its own roll would disagree with the one the
 * balance actually moved by. Offline there is only one roller, so it calls this directly.
 *
 * Gold: `max(2, rung) x 100`. Each rung is two of the authored ones merged (see
 * tools/prep_all_epic_bosses.py multipliers), so its payout is the two it replaced added
 * together — which works out to exactly this, and leaves a full ladder paying the same
 * 5,600 gold it always did.
 *
 * `maxLevel` decides where the ladder ENDS, and the final rung guarantees its brain rather
 * than rolling for it. It is a parameter rather than a constant so an event of a different
 * length puts the guarantee on its own last fight.
 */
export const epicBossCurrencyReward = (
  level: number,
  maxLevel = 10,
  random: () => number = Math.random
): EpicBossCurrencyReward => {
  // Drawn UNCONDITIONALLY, then overridden on the final rung. The guarantee must not
  // change how many numbers this pulls from `random`: the server hands the same generator
  // on to the decor and ticket rolls below it, so a branch that skipped the draw would
  // shift every later roll on exactly the clears that finish a ladder.
  const rolled = random() < EPIC_BRAIN_DROP_CHANCE;
  const finalRung = Math.floor(level) === Math.floor(maxLevel);
  return {
    brains: finalRung || rolled ? 1 : 0,
    gold: Math.max(2, Math.floor(level)) * 100,
  };
};
