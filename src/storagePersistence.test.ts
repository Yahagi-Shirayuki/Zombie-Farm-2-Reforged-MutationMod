// The reported symptom this guards: "settings don't save when I exit the browser and
// come back, and I never cleared the site data". Nothing in the writing code can produce
// that — the value is provably in localStorage on a reload — but an evicted origin can,
// and the game caches tens of megabytes of art, which is what invites eviction. So the
// game asks for persistent storage, and the diagnostics report says which answer it got.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestPersistentStorage,
  storagePersistence,
  storagePersistenceLine,
} from "./storagePersistence";

function stubStorageManager(over: Partial<StorageManager> | null) {
  vi.stubGlobal("navigator", over === null ? {} : { storage: over });
}

describe("persistent storage request", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("asks for persistence only when the origin does not already have it", async () => {
    const persist = vi.fn(async () => true);
    stubStorageManager({
      persisted: async () => true,
      persist,
      estimate: async () => ({ usage: 1_000_000, quota: 2_000_000 }),
    } as Partial<StorageManager>);

    const result = await requestPersistentStorage();
    expect(result.persisted).toBe(true);
    // Re-asking is what turns a silent grant into a repeat permission prompt on the
    // browsers that prompt, so a granted origin must never reach `persist()`.
    expect(persist).not.toHaveBeenCalled();
  });

  it("requests persistence when the origin is still best-effort", async () => {
    const persist = vi.fn(async () => true);
    stubStorageManager({
      persisted: async () => false,
      persist,
      estimate: async () => ({ usage: 88_000_000, quota: 300_000_000 }),
    } as Partial<StorageManager>);

    const result = await requestPersistentStorage();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ persisted: true, usage: 88_000_000, quota: 300_000_000 });
    expect(storagePersistenceLine()).toBe("persistent, 88MB of 300MB");
  });

  it("reports a refusal as evictable rather than as an error", async () => {
    stubStorageManager({
      persisted: async () => false,
      persist: async () => false,
      estimate: async () => ({ usage: 90_000_000, quota: 120_000_000 }),
    } as Partial<StorageManager>);

    const result = await requestPersistentStorage();
    expect(result.persisted).toBe(false);
    expect(storagePersistenceLine()).toBe("best-effort (evictable), 90MB of 120MB");
  });

  it("never throws where the API is missing or refuses outright", async () => {
    stubStorageManager(null);
    await expect(requestPersistentStorage()).resolves.toBeDefined();

    stubStorageManager({
      persisted: async () => { throw new Error("denied by policy"); },
      estimate: async () => { throw new Error("nope"); },
    } as Partial<StorageManager>);
    const result = await requestPersistentStorage();
    expect(result).toEqual({ persisted: null, usage: null, quota: null });
    expect(storagePersistence()).toEqual(result);
    expect(storagePersistenceLine()).toBe("unknown, ? of ?");
  });
});
