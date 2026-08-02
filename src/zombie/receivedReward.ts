const PREFIX = "zombie-reward:";

export interface ReceivedZombieReward {
  id: string;
  key: string;
  mutation: number;
  invasions: number;
}

/** Encode an earned zombie as a unique Received-storage entry. The unit does not
 * enter the playable roster until the player claims it into a Mausoleum slot. */
export function encodeReceivedZombie(reward: ReceivedZombieReward): string {
  return `${PREFIX}${encodeURIComponent(reward.id)}:${encodeURIComponent(reward.key)}:${reward.mutation}:${reward.invasions}`;
}

export function parseReceivedZombie(value: string): ReceivedZombieReward | null {
  if (!value.startsWith(PREFIX)) return null;
  const [encodedId, encodedKey, mutationText, invasionsText, ...extra] = value.slice(PREFIX.length).split(":");
  const mutation = Number(mutationText);
  const invasions = Number(invasionsText);
  if (extra.length || !encodedId || !encodedKey || !Number.isSafeInteger(mutation) || mutation < 0 ||
      !Number.isSafeInteger(invasions) || invasions < 0) return null;
  try {
    const id = decodeURIComponent(encodedId);
    const key = decodeURIComponent(encodedKey);
    return id && key ? { id, key, mutation, invasions } : null;
  } catch {
    return null;
  }
}
