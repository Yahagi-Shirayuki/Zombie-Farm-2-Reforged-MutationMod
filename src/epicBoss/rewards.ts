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
 *   - +1 brain on every 5th level cleared (5, 10, 15, 20, 25, 30, 35, 40).
 *   - +1 BONUS brain at the boss's top tier(s): levels 30/35/40 on a full 40-level
 *     ladder, or level 20 for the short-ladder Dr. Groundhog (maxLevel 20).
 *   - Non-milestone levels award no brains.
 *
 * Gold is deliberately UNCHANGED from the pre-revert curve (`round(level/4) * 100` per
 * cleared level) — gold is not being rescaled, so the epic run's gold economy is
 * untouched by the brain change.
 */
export const epicBossCurrencyReward = (level: number, maxLevel = 40): EpicBossCurrencyReward => {
  const gold = Math.max(1, Math.round(level / 4)) * 100;
  let brains = level % 5 === 0 ? 1 : 0;
  const topTierBonus = maxLevel <= 20 ? level === maxLevel : level === 30 || level === 35 || level === 40;
  if (brains > 0 && topTierBonus) brains += 1;
  return { brains, gold };
};
