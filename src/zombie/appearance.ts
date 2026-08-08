import { zombieAppearancePrefs, type ZombieAppearancePrefs } from "../prefs";

/** What a zombie should actually be DRAWN as, after this device's display prefs.
 *
 *  Every rig that assembles a zombie â€” the farm actor, the raid actor, the mutation
 *  portraits behind every card and menu tile â€” resolves its mask and tint through
 *  here, so the two toggles apply everywhere a zombie is visible at once.
 *
 *  `color` undefined means "no inherited tint": the caller falls back to the model
 *  catalog's species colour, which is exactly what "species" mode wants. */
export function displayedAppearance<T>(
  mutation: number,
  color: T | undefined,
  prefs: ZombieAppearancePrefs = zombieAppearancePrefs(),
): { mutation: number; color: T | undefined } {
  return {
    mutation: prefs.showMutations ? mutation : 0,
    color: prefs.bodyColor === "species" ? undefined : color,
  };
}

export function displayedMutationIds(
  mutationIds: readonly string[] | undefined,
  prefs: ZombieAppearancePrefs = zombieAppearancePrefs(),
): string[] {
  return prefs.showMutations ? [...(mutationIds ?? [])] : [];
}
/** White multiplication preserves the eye sprite's authored light-yellow color. */
export const DEFAULT_ZOMBIE_EYE_TINT = 0xffffff;
export const BRUTE_ZOMBIE_EYE_TINT = 0x111111;
export const DEFAULT_ZOMBIE_TEETH_TINT = 0xffffff;
export const BRUTE_EYEBALL_SCALE = 0.2;

/** Large/brute zombies keep their black eye disks, with a tiny copy of the
 * authored eyeball centered inside each one. */
export function isBruteEyeball(group: string, file: string): boolean {
  return group === "Large" && /^defaultEye[LR](?:\.png)?$/i.test(file);
}

export function zombiePartTint(file: string, bodyTint: number, group = ""): number {
  if (/^default(?:Upper|Lower)Teeth(?:\.png)?$/i.test(file)) {
    return DEFAULT_ZOMBIE_TEETH_TINT;
  }
  if (/^defaultEye[LR](?:\.png)?$/i.test(file)) {
    return group === "Large" ? BRUTE_ZOMBIE_EYE_TINT : DEFAULT_ZOMBIE_EYE_TINT;
  }
  return bodyTint;
}



