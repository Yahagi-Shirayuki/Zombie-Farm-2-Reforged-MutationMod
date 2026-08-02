export interface StoredItemState {
  retrieveItem(key: string): boolean;
}

export interface StoredObjectRef {
  key: string;
  instanceId: string;
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
