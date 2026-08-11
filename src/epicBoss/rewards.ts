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

/** Every cleared level grants currency in addition to its existing loot roll.
 *
 * Post-brainflation-revert brain schedule (a single brain is now ~10x more valuable, so
 * epic runs hand them out sparingly instead of every level):
 *   - +1 brain on every 5th level cleared (5, 10, 15, 20).
 *   - +1 BONUS brain on the boss's FINAL level, so finishing a ladder pays 2.
 *   - Non-milestone levels award no brains.
 *
 * Every ladder is 20 rungs now (see EpicBossDef.maxLevel), so a full clear pays 5 brains
 * whichever event it is. The old 40-rung bosses paid 11, but 6 of those brains sat on
 * levels 21-40 — rungs that reused level 20's HP multiplier, so they were 20 extra fights
 * at an unchanging difficulty. The per-fight rate is untouched; there are simply no
 * padding rungs left to farm. `maxLevel` still parameterises the bonus rather than being
 * hardcoded to 20, so a future longer event pays its bonus at its own top.
 *
 * Gold is deliberately UNCHANGED from the pre-revert curve (`round(level/4) * 100` per
 * cleared level) — gold is not being rescaled, so the epic run's gold economy is
 * untouched by the brain change.
 */
export const epicBossCurrencyReward = (level: number, maxLevel = 20): EpicBossCurrencyReward => {
  const gold = Math.max(1, Math.round(level / 4)) * 100;
  let brains = level % 5 === 0 ? 1 : 0;
  if (brains > 0 && level === maxLevel) brains += 1;
  return { brains, gold };
};
