export interface StoredItemState {
  retrieveItem(key: string): boolean;
}

export interface StoredItemCounts {
  storedItems: { key: string; count: number }[];
}

export interface StoredObjectRef {
  key: string;
  instanceId: string;
}

/** Give every stored copy of `key` an identity, minting one for any copy that has
 *  none, and return the first. OFFLINE ONLY — see below.
 *
 *  A local save records the shed as counts alone: object identities live in the
 *  online object service, and a local farm has no service to restore them from. So
 *  after a reload the identity map is empty while the shed still shows its items —
 *  and since both "place it back" and "sell" resolve an instance id before they do
 *  anything, every restored item is inert and fails silently. Minting an id here
 *  makes the local shed work like the online one. An online farm's ids are
 *  authoritative and must never be invented: pass it through this only when the
 *  economy client is absent. */
export function ensureLocalStoredIds(
  state: StoredItemCounts,
  storedObjectIds: Map<string, string[]>,
  key: string,
  mint: () => string,
): string | undefined {
  const count = state.storedItems.find((item) => item.key === key)?.count ?? 0;
  if (count <= 0) return undefined;
  const ids = storedObjectIds.get(key)?.slice() ?? [];
  while (ids.length < count) ids.push(mint());
  storedObjectIds.set(key, ids);
  return ids[0];
}

/** Consume one exact stored object from both the count projection and its identity
 * projection. A stale placement selection must not consume a different copy that
 * happens to share the same catalog key. */
export function takeStoredObject(
  state: StoredItemState,
  storedObjectIds: Map<string, string[]>,
  object: StoredObjectRef,
): boolean {
  const ids = storedObjectIds.get(object.key);
  const index = ids?.indexOf(object.instanceId) ?? -1;
  if (!ids || index < 0 || !state.retrieveItem(object.key)) return false;

  const remaining = ids.slice();
  remaining.splice(index, 1);
  if (remaining.length) storedObjectIds.set(object.key, remaining);
  else storedObjectIds.delete(object.key);
  return true;
}
