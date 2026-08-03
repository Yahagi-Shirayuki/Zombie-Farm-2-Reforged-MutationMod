import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../net/api";
import { SaveManager } from "./SaveManager";
import { activeSaveKey } from "./profiles";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const memoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
};

describe("SaveManager presentation conflicts", () => {
  it("adopts the committed server version after a lost PUT response", async () => {
    const manager = new SaveManager(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new Map(),
      new Map(),
      async () => undefined,
    );
    const first = { camera: { x: 1, y: 2 } };
    const second = { camera: { x: 3, y: 4 } };
    const put = vi.spyOn(api, "putPresentationV3")
      .mockRejectedValueOnce(new api.ApiError(409, "presentation_conflict"))
      .mockResolvedValueOnce({ version: 2, data: second });
    vi.spyOn(api, "bootstrap").mockResolvedValue({
      presentation: { version: 1, data: first },
    } as never);

    await (manager as any).push(first);
    await (manager as any).push(second);

    expect(api.bootstrap).toHaveBeenCalledWith(true);
    expect(put).toHaveBeenNthCalledWith(2, {
      protocolVersion: 3,
      expectedVersion: 1,
      data: second,
    });
    expect((manager as any).presentationDirty).toBe(false);
  });
});

describe("SaveManager object layout races", () => {
  it("retains a removed object's position until authoritative settlement", () => {
    const field = {
      serializeObjects: vi.fn()
        .mockReturnValueOnce([{ id: "candle-1", key: "candle", oc: 8, or: 9 }])
        .mockReturnValueOnce([]),
    };
    const manager = new SaveManager(
      {} as never, field as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "online",
    );
    vi.spyOn(manager, "serialize").mockImplementation(() => ({
      version: 1,
      savedAt: 1,
      player: { name: "Tester", farmerAppearance: {} },
      farm: { fieldId: "default", w: 30, h: 30, climate: "grass", plots: [] },
      objects: field.serializeObjects(),
    } as never));

    expect((manager as any).presentation().objectLayout).toEqual([
      { id: "candle-1", oc: 8, or: 9, rotation: undefined },
    ]);
    expect((manager as any).presentation().objectLayout).toEqual([
      { id: "candle-1", oc: 8, or: 9, rotation: undefined },
    ]);

    manager.reconcileObjectLayouts(new Set());
    expect((manager as any).presentation().objectLayout).toEqual([]);
  });
});

describe("SaveManager mode isolation", () => {
  it("replays an Online Farm journal only after the command channel is ready", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.spyOn(api, "getSession").mockReturnValue({ accountId: "restore-owner" } as never);
    const jobs = {
      restorePending: vi.fn().mockReturnValue(true),
      serializePending: vi.fn().mockReturnValue(undefined),
    };
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map([["carrot", { key: "carrot" } as never]]), new Map(),
      async () => undefined, "online", jobs as never,
    );
    const journal = {
      savedAt: 123,
      jobs: [{ kind: "plant" as const, oc: 4, or: 6, cx: 10, cy: 20, cropKey: "carrot" }],
    };
    (manager as any).pendingOnlineJobs = journal;

    expect(jobs.restorePending).not.toHaveBeenCalled();
    manager.restoreOnlineJobs();
    manager.restoreOnlineJobs();

    expect(jobs.restorePending).toHaveBeenCalledOnce();
    expect(jobs.restorePending).toHaveBeenCalledWith(journal, expect.any(Function));
  });

  it("re-offers a parked journal that JobSystem refused because the queue was busy", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.spyOn(api, "getSession").mockReturnValue({ accountId: "busy-owner" } as never);
    // A plow tapped while the tab was still booting leaves the queue busy, so
    // restorePending declines the first offer and accepts once that job finishes.
    const restorePending = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const jobs = { restorePending, serializePending: vi.fn().mockReturnValue(undefined) };
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "online", jobs as never,
    );
    const journal = {
      savedAt: 123,
      jobs: [{ kind: "plant" as const, oc: 4, or: 6, cx: 10, cy: 20, cropKey: "carrot" }],
    };
    (manager as any).pendingOnlineJobs = journal;
    const key = `${(manager as any).cacheKey()}::farm-jobs`;
    localStorage.setItem(key, JSON.stringify(journal)); // as hydration left it on disk

    manager.restoreOnlineJobs();
    expect((manager as any).pendingOnlineJobs).toBe(journal);
    expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual(journal);

    manager.checkpointJobs(); // the live job completed -> queue change -> retry
    expect(restorePending).toHaveBeenCalledTimes(2);
    expect((manager as any).pendingOnlineJobs).toBeUndefined();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("keeps a parked Online Farm journal through pre-writer checkpoints", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.spyOn(api, "getSession").mockReturnValue({ accountId: "parked-owner" } as never);
    vi.spyOn(api, "isConfigured").mockReturnValue(false);
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "online",
      { serializePending: vi.fn().mockReturnValue(undefined) } as never,
    );
    const journal = {
      savedAt: 123,
      jobs: [{ kind: "plant" as const, oc: 4, or: 6, cx: 10, cy: 20, cropKey: "carrot" }],
    };
    (manager as any).pendingOnlineJobs = journal;
    vi.spyOn(manager, "serialize").mockReturnValue({ farmJobs: undefined } as never);

    manager.save();

    const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
      .find((candidate) => candidate.endsWith("::farm-jobs"));
    expect(JSON.parse(localStorage.getItem(key!) ?? "null")).toEqual(journal);
  });

  it("keeps a parked journal retryable when restoration throws", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.spyOn(api, "getSession").mockReturnValue({ accountId: "retry-owner" } as never);
    const jobs = { restorePending: vi.fn(() => { throw new Error("restore failed"); }) };
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "online", jobs as never,
    );
    const journal = { savedAt: 123, jobs: [{ kind: "plow" as const, oc: 1, or: 2, cx: 3, cy: 4 }] };
    (manager as any).pendingOnlineJobs = journal;

    expect(() => manager.restoreOnlineJobs()).toThrow("restore failed");
    expect((manager as any).pendingOnlineJobs).toBe(journal);
  });

  it("translates authoritative timers before hydrating the first online frame", () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000);
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "online",
    );
    const save = (manager as any).fromBootstrap({
      serverTime: 10_000,
      presentation: { data: { objectLayout: [{ id: "tree-1", oc: 4, or: 5 }] } },
      gameplay: {
        balance: { gold: 0, brains: 0, xp: 0 }, zombieMax: 16, zombiePotBought: false,
        farmerHeads: [1], farmerHeadId: 1, ownedPets: [], activePet: null, penPets: [],
        farmSize: 30, climates: ["grass"], inventory: {},
        storage: { stored: {}, received: {} },
        farm: { plots: { "1:2": { state: "planted", cropKey: "carrot", zombie: false,
          plantedAt: 9_000, growMs: 60_000, fertilized: false } } },
        objects: { objects: [{ status: "placed", instanceId: "tree-1", catalogKey: "fruitTreeApple",
          readyAt: 12_000 }] },
        roster: [], quests: { progress: [], completed: [] },
        raids: { progress: {}, lastRaidAt: 8_000 }, epicBoss: null, tutorialRewarded: false,
      },
      social: { friends: [] },
    });

    expect(save.farm.plots[0].crop.plantedAt).toBe(19_000);
    expect(save.objects[0].readyAt).toBe(22_000);
    expect(save.raids.lastRaidAt).toBe(18_000);
  });

  // A placed object with no layout entry used to be fabricated onto (0,0). Several at
  // once all landed on that one tile, Field.restoreObjects kept the first and silently
  // dropped the rest, and the next presentation — written from the field — erased them
  // for good. They must be left for the reconcile's re-home path instead.
  it("omits placed objects that have no saved position instead of stacking them on 0,0", () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000);
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "online",
    );
    const save = (manager as any).fromBootstrap({
      serverTime: 10_000,
      presentation: { data: { objectLayout: [{ id: "placed-1", oc: 7, or: 9 }] } },
      gameplay: {
        balance: { gold: 0, brains: 0, xp: 0 }, zombieMax: 16, zombiePotBought: false,
        farmerHeads: [1], farmerHeadId: 1, ownedPets: [], activePet: null, penPets: [],
        farmSize: 30, climates: ["grass"], inventory: {},
        storage: { stored: {}, received: {} }, farm: { plots: {} },
        objects: { objects: [
          { status: "placed", instanceId: "placed-1", catalogKey: "flowerBed" },
          { status: "placed", instanceId: "no-layout-1", catalogKey: "flowerBed" },
          { status: "placed", instanceId: "no-layout-2", catalogKey: "flowerBed" },
        ] },
        roster: [], quests: { progress: [], completed: [] },
        raids: { progress: {}, lastRaidAt: 0 }, epicBoss: null, tutorialRewarded: false,
      },
      social: { friends: [] },
    });

    expect(save.objects).toEqual([
      { id: "placed-1", key: "flowerBed", oc: 7, or: 9, rotation: undefined, readyAt: undefined },
    ]);
  });

  it("keeps online farmer intentions in an account-scoped device journal", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.spyOn(api, "getSession").mockReturnValue({ accountId: "queue-owner" } as never);
    const jobs = {
      serializePending: vi.fn().mockReturnValue({
        savedAt: 123,
        jobs: [{ kind: "plant", oc: 4, or: 6, cx: 10, cy: 20, cropKey: "carrot" }],
      }),
    };
    const manager = new SaveManager(
      { name: "Tester", ownedFarmerHeads: [], ownedFarmerBodies: [], farmerHeadId: 1, farmerBodyId: 0,
        ownedPets: [], activePet: null, penPets: [], ownedClimates: [], boostInv: [], storageItemCap: 8,
        storedItems: [], received: [], raidsCompleted: {}, lastRaidAt: 0, raidAttackOrder: [], friends: [] } as never,
      { w: 30, h: 30, climate: "grass", serialize: () => [], serializeObjects: () => [] } as never,
      { tile: { col: 0, row: 0 } } as never,
      { serialize: () => [], serializePots: () => undefined, isGathered: false } as never,
      { serialize: () => undefined } as never,
      new Map(), new Map(), async () => undefined, "online", jobs as never,
    );

    const pending = manager.serialize().farmJobs;
    (manager as any).writeJobJournal(pending);

    const journalKey = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
      .find((key) => key.endsWith("::farm-jobs"));
    expect(journalKey).toContain("queue-owner");
    expect(JSON.parse(localStorage.getItem(journalKey!) ?? "null")).toEqual({
      savedAt: 123,
      jobs: [{ kind: "plant", oc: 4, or: 6, cx: 10, cy: 20, cropKey: "carrot" }],
    });
  });

  it("never falls back to a Local Farm write from Online Farm", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.spyOn(api, "isConfigured").mockReturnValue(false);
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "online",
    );
    vi.spyOn(manager, "serialize").mockReturnValue({ version: 1, savedAt: 1 } as never);

    manager.save();

    expect(localStorage.length).toBe(0);
  });

  it("rotates a last-known-good backup for Local Farm", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "local",
    );
    const first = { version: 1, savedAt: 1 };
    const second = { version: 1, savedAt: 2 };

    (manager as any).writeLocal(first);
    (manager as any).writeLocal(second);

    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!);
    const primary = keys.find((key) => !key.endsWith(".backup") && !key.endsWith(".tmp") && key.includes("local.save"));
    expect(primary).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(primary!) ?? "null")).toMatchObject(second);
    expect(JSON.parse(localStorage.getItem(`${primary}.backup`) ?? "null")).toMatchObject(first);
  });

  it("does not rewrite a farm after persistence is suspended for a switch or reset", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "local",
    );
    const write = vi.spyOn(manager as any, "writeLocal");

    manager.suspend();
    manager.flushCritical();

    expect(write).not.toHaveBeenCalled();
  });

  it("does not treat an existing but unreadable Local Farm as a new farm", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "local",
    );
    const key = activeSaveKey();
    const stored = JSON.stringify({
      version: 1,
      savedAt: 123,
      player: { name: "Preserve Me" },
      farm: { plots: [] },
    });
    localStorage.setItem(key, stored);
    vi.spyOn(manager as any, "applySave").mockRejectedValue(new Error("temporary hydrate failure"));

    await expect(manager.load()).resolves.toEqual({
      kind: "local-unavailable",
      reason: "save_unreadable",
    });
    expect(localStorage.getItem(key)).toBe(stored);
  });

  it("reports unavailable storage instead of creating a disposable Local Farm", async () => {
    const blocked = memoryStorage();
    blocked.getItem = () => { throw new Error("storage blocked"); };
    vi.stubGlobal("localStorage", blocked);
    const manager = new SaveManager(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new Map(), new Map(), async () => undefined, "local",
    );

    await expect(manager.load()).resolves.toEqual({
      kind: "local-unavailable",
      reason: "storage_unavailable",
    });
  });
});
