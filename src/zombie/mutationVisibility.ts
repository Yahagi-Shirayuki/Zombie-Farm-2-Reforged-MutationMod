import { maskHas, maskUnion, maskWithout } from "./mutationMask";
import { normalizeMutationIds, type MutationRef } from "./mutations";

const HIDDEN_KEY = "zf2r.zombieHiddenMutations";

interface HiddenMutationState {
  mask: number;
  ids: string[];
}

let cache: Record<string, HiddenMutationState> | null = null;

function emptyState(): HiddenMutationState {
  return { mask: 0, ids: [] };
}

function hasStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function normalizeState(value: unknown): HiddenMutationState {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return { mask: value, ids: [] };
  }
  if (!value || typeof value !== "object") return emptyState();
  const raw = value as { mask?: unknown; ids?: unknown };
  const mask = typeof raw.mask === "number" && Number.isSafeInteger(raw.mask) && raw.mask > 0
    ? raw.mask
    : 0;
  return { mask, ids: normalizeMutationIds(raw.ids) };
}

function hasHidden(state: HiddenMutationState): boolean {
  return state.mask > 0 || state.ids.length > 0;
}

function read(): Record<string, HiddenMutationState> {
  if (cache) return cache;
  cache = {};
  if (!hasStorage()) return cache;
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        const state = normalizeState(value);
        if (hasHidden(state)) cache[id] = state;
      }
    }
  } catch {
    // Optional display preference; corrupt or blocked storage means everything shows.
  }
  return cache;
}

function write(map: Record<string, HiddenMutationState>): void {
  cache = map;
  if (!hasStorage()) return;
  try {
    if (Object.keys(map).length) localStorage.setItem(HIDDEN_KEY, JSON.stringify(map));
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Keep the in-memory preference for this session.
  }
}

export function resetMutationVisibilityCache(): void {
  cache = null;
}

export function hiddenMutationState(id: string | undefined): HiddenMutationState {
  if (!id) return emptyState();
  const state = read()[id];
  return state ? { mask: state.mask, ids: [...state.ids] } : emptyState();
}

export function hiddenMutations(id: string | undefined): number {
  return hiddenMutationState(id).mask;
}

export function hiddenMutationIds(id: string | undefined): string[] {
  return hiddenMutationState(id).ids;
}

export function isMutationHidden(id: string | undefined, ref: MutationRef | undefined): boolean {
  if (ref === undefined) return false;
  const state = hiddenMutationState(id);
  return typeof ref === "number" ? maskHas(state.mask, ref) : state.ids.includes(ref);
}

export function setMutationHidden(id: string, ref: MutationRef, hidden: boolean): void {
  const map = { ...read() };
  const before = map[id] ?? emptyState();
  const ids = new Set(before.ids);
  let mask = before.mask;
  if (typeof ref === "number") {
    mask = hidden ? maskUnion(mask, ref) : maskWithout(mask, ref);
  } else if (hidden) {
    if (normalizeMutationIds([ref]).length) ids.add(ref);
  } else {
    ids.delete(ref);
  }
  const after = { mask, ids: [...ids].sort() };
  if (hasHidden(after)) map[id] = after;
  else delete map[id];
  write(map);
}

export function visibleMutations(id: string | undefined, mask: number): number {
  const hidden = hiddenMutations(id);
  return hidden ? maskWithout(mask, hidden) : mask;
}

export function visibleMutationIds(id: string | undefined, ids?: readonly string[]): string[] {
  const normalized = normalizeMutationIds(ids);
  const hidden = new Set(hiddenMutationIds(id));
  return hidden.size ? normalized.filter((value) => !hidden.has(value)) : normalized;
}

export function visibleMutationSet(
  id: string | undefined,
  mask: number,
  ids?: readonly string[],
): { mutation: number; mutationIds: string[] } {
  return {
    mutation: visibleMutations(id, mask),
    mutationIds: visibleMutationIds(id, ids),
  };
}

export function pruneMutationVisibility(liveIds: Iterable<string>): void {
  const map = read();
  const ids = Object.keys(map);
  if (!ids.length) return;
  const live = new Set(liveIds);
  const kept: Record<string, HiddenMutationState> = {};
  for (const id of ids) if (live.has(id)) kept[id] = map[id];
  if (Object.keys(kept).length !== ids.length) write(kept);
}
