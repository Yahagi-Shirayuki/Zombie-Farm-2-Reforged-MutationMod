import type { GameState } from "../GameState";
import * as api from "./api";
import { CommandQueue } from "./commandQueue";
import type { BootstrapResponse, CommandBatchResponse, GameplayCommand } from "./protocol";
import type { RaidOutcome } from "../raid/types";
import { RAID_RULESET_VERSION } from "../raid/replay";
import { epicBossRunToClient, serverTimestampToClient } from "./clock";

export const OWNERSHIP_POLL_IDLE_MS = 3 * 60_000;

export interface InventoryInput {
  type: "buy" | "use" | "grant";
  key: string;
  qty?: number;
  unitId?: string;
  localZombieHarvests?: { id: string; oc: number; or: number }[];
  oc?: number;
  or?: number;
  target?: "zombie_pot";
}

export type RosterInput =
  | { type: "sell"; unitId: string }
  | { type: "grant"; unitId: string; key: string; mutation?: number; invasions?: number }
  | { type: "veteran"; unitIds: string[] }
  | { type: "casualty"; unitIds: string[] }
  | { type: "combineStart"; potId?: string; parentAId: string; parentBId: string; playerLevel?: number }
  | { type: "combineCollect"; potId?: string; unitId: string; key: string; mutation?: number };

export interface FarmActionInput {
  type: "plant" | "harvest" | "plow" | "remove" | "move";
  oc: number;
  or: number;
  /** Destination origin, "move" only. */
  toOc?: number;
  toOr?: number;
  cropKey?: string;
  fertilized?: boolean;
  unitId?: string;
}

interface OptimisticDelta {
  gold: number;
  brains: number;
  xp: number;
  inventoryKey?: string;
  inventoryCount?: number;
  localUnitId?: string;
  localZombieHarvests?: { id: string; oc: number; or: number }[];
  localObjectId?: string;
}

interface PendingRaidFinish {
  sessionId: string;
  finalTick: number;
  inputs: api.RaidReplayInput[];
  outcome: RaidOutcome;
  savedAt: number;
}

const RAID_FINISH_PREFIX = "zf2r.v3.raid-finish";
const RAID_FINISH_RETRY_MS = [250, 500, 1_000, 2_000, 4_000, 8_000];

/** Compatibility facade used by the current gameplay code. Every non-raid method
 * feeds one protocol-v3 queue; none of these methods owns an HTTP stream anymore. */
export class EconomyClient {
  private readonly queue: CommandQueue;
  private base: api.Balance | null = null;
  private serverInv: Record<string, number> = {};
  private optimistic = new Map<number, OptimisticDelta>();
  private authoritativeUnitIds = new Map<string, string>();
  private deferredRosterAliases: Record<string, string> = {};
  private deferredObjectAliases: Record<string, string> = {};
  private deferredRejectedObjectIds = new Set<string>();
  private combineParents = new Map<string, {
    parentAId: string; parentBId: string; playerLevel?: number;
  }>();
  private commandsBySequence = new Map<number, GameplayCommand>();
  private ready = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryAttempt = 0;
  private recoveryInFlight = false;
  private ownershipTimer: ReturnType<typeof setTimeout> | null = null;
  private ownershipCheckInFlight = false;

  onShopState: ((size: number, climates: string[]) => void) | null = null;
  onFarmerState: ((headIds: number[], equippedHeadId: number) => void) | null = null;
  onPetState: ((ownedPets: string[], activePet: string | null, penPets: string[]) => void) | null = null;
  onQuestState: ((state: api.QuestStateResult) => void) | null = null;
  onQuestChanges: ((changes: api.QuestChange[]) => void) | null = null;
  onCropFertilized: ((oc: number, or: number) => void) | null = null;
  onFarmState: ((farm: api.FarmState) => void) | null = null;
  /** Resolving `false` means a newer reconcile superseded this pass before it consumed
   *  `aliases`, and this client must keep them for the next one. Any other result (or a
   *  synchronous handler) means they were applied and may be dropped. */
  onObjectState: ((
    objects: BootstrapResponse["gameplay"]["objects"]["objects"],
    aliases: Record<string, string>,
    baseZombieMax: number,
    rejectedLocalIds: string[],
  ) => void | Promise<boolean | void>) | null = null;
  /** `settled` means this client has NOTHING outstanding — no queued command, none in
   *  flight — so the roster it just received is the whole truth and may be used to
   *  retire local state the server contradicts (see ZombieField.reconcileServerPots).
   *  While work is outstanding the roster is merely a snapshot that predates it. */
  onRosterState: ((
    roster: BootstrapResponse["gameplay"]["roster"],
    aliases: Record<string, string>,
    settled: boolean,
  ) => void) | null = null;
  onRaidSettled: ((res: api.RaidFinishResult) => void) | null = null;
  onRaidRevival: ((offer: NonNullable<BootstrapResponse["gameplay"]["raidRevival"]>, brains: number) => void) | null = null;
  onEpicBossState: ((event: BootstrapResponse["gameplay"]["epicBoss"]) => void) | null = null;
  onTutorialState: ((rewarded: boolean) => void) | null = null;
  onGameplayUnavailable: ((reason: string) => void) | null = null;
  onWriterReplaced: (() => void) | null = null;
  /** Fired whenever a bootstrap confirms this tab owns the writer, including recovery. */
  onWriterOwned: (() => void) | null = null;
  onWriterAvailable: (() => void) | null = null;
  onCommandRejected: ((command: GameplayCommand | undefined, error: string) => void) | null = null;
  onAuthoritativeSettled: ((serverTime: number) => void) | null = null;
  onPendingChange: ((pending: number) => void) | null = null;
  /** Fired at boot when the Worker's raid ruleset differs from this bundle's. Every
   *  `/raid/start` would be refused with `426 stale_ruleset` until the tab reloads, so
   *  the UI surfaces a reload prompt rather than letting the player discover it by
   *  pressing Invade. */
  onRulesetSkew: ((serverVersion: number, clientVersion: number) => void) | null = null;

  constructor(
    private state: GameState,
    private readonly accountId: string,
    private readonly options: { requireReady?: boolean } = {},
  ) {
    this.queue = new CommandQueue(accountId);
    this.queue.onProjection = (response) => this.adoptCommandResponse(response);
    this.queue.onUnavailable = (reason) => {
      this.onGameplayUnavailable?.(reason);
      this.scheduleRecovery();
    };
    this.queue.onWriterReplaced = () => this.onWriterReplaced?.();
    this.queue.onStateConflict = () => { void this.reloadAfterConflict(); };
    this.queue.onSizeChange = (size) => this.onPendingChange?.(size);
    api.setWriterRejectedHandler(() => this.handleWriterLost());
    api.setWriterConfirmedHandler(() => this.scheduleOwnershipCheck());
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void this.resumeFromBackground();
        else this.clearOwnershipCheck();
      });
      // A different device cannot push a takeover notification into this page.
      // Successful writer-protected requests already prove ownership and postpone
      // the next check. Only an idle visible tab needs a dedicated status request;
      // focus remains immediate so a resumed tab never waits three minutes.
    }
  }

  async start(): Promise<void> {
    try {
      let bootstrap = await api.bootstrap();
      // A missing token can be recovered without a takeover when this document
      // owns the browser-local lock and the server lease belongs to the same
      // session/client. A genuinely different browser still receives writer_active.
      if (bootstrap.writer.status !== "mine" && api.hasLocalWriterLock()) {
        try { await api.acquireWriter(bootstrap.writer.generation, false); }
        catch { /* another client may have acquired it between bootstrap and claim */ }
        bootstrap = await api.bootstrap(true);
      }
      bootstrap = await this.recoverResumableRaid(bootstrap);
      this.queue.adoptBootstrap(bootstrap);
      this.ready = true;
      this.adoptGameplay(bootstrap.gameplay, {}, {}, [], bootstrap.serverTime);
      if (bootstrap.raidRulesetVersion !== RAID_RULESET_VERSION) {
        this.onRulesetSkew?.(bootstrap.raidRulesetVersion, RAID_RULESET_VERSION);
      }
      if (this.queue.size === 0) this.onAuthoritativeSettled?.(bootstrap.serverTime);
      this.syncOwnershipPolling(bootstrap.writer.status);
      if (bootstrap.writer.status === "mine") this.onWriterAvailable?.();
      else this.onWriterReplaced?.();
    } catch {
      this.ready = false;
      this.queue.disable("bootstrap_failed");
      this.scheduleRecovery();
    }
  }

  get available(): boolean { return this.ready && this.queue.available; }

  async takeOver(): Promise<boolean> {
    try {
      const current = await api.bootstrap(true);
      await api.acquireWriter(current.writer.generation, true);
      this.scheduleOwnershipCheck();
      return true;
    } catch {
      return false;
    }
  }

  private handleWriterLost(): void {
    this.clearOwnershipCheck();
    api.clearWriterCredential();
    this.queue.markWriterLost();
    this.optimistic.clear();
    this.commandsBySequence.clear();
    this.onWriterReplaced?.();
    void this.refreshReadOnly();
  }

  /** Re-take a lease the server reports as unheld. A free lease is NOT a conflict:
   *  no other document owns it, so claiming it needs no takeover and must never raise
   *  the "Farm active elsewhere" gate. The path that makes this load-bearing is mobile
   *  resume — `pagehide` releases the lease when the OS suspends the app, but a
   *  suspended document is often resumed rather than destroyed, so it wakes up holding
   *  a credential the server has already forgotten. Without a silent re-claim that
   *  document is paused forever: every tap answers "Gameplay paused — reconnect to
   *  continue" and only a manual reload clears it.
   *  Returns true once this document is writing again. */
  private async reclaimFreeWriter(observedGeneration: number): Promise<boolean> {
    if (!api.hasLocalWriterLock() || !api.getSession()) return false;
    try {
      await api.acquireWriter(observedGeneration, false);
      let bootstrap = await api.bootstrap(true);
      if (bootstrap.writer.status !== "mine") return false;
      // Only now does the raid recovery in the caller's bootstrap become reachable:
      // it no-ops while the lease is unowned.
      bootstrap = await this.recoverResumableRaid(bootstrap);
      this.queue.adoptBootstrap(bootstrap);
      this.ready = true;
      this.adoptGameplay(bootstrap.gameplay, {}, {}, [], bootstrap.serverTime);
      this.syncOwnershipPolling(bootstrap.writer.status);
      if (this.queue.size === 0) this.onAuthoritativeSettled?.(bootstrap.serverTime);
      this.recoveryAttempt = 0;
      this.onWriterAvailable?.();
      await this.queue.retry();
      return true;
    } catch {
      // A real second device answers 423 writer_active here; fall back to the gate.
      return false;
    }
  }

  private async refreshReadOnly(): Promise<void> {
    try {
      const bootstrap = await api.bootstrap(true);
      if (bootstrap.writer.status === "free" &&
          await this.reclaimFreeWriter(bootstrap.writer.generation)) return;
      this.queue.adoptBootstrap(bootstrap);
      this.ready = true;
      this.adoptGameplay(bootstrap.gameplay, {}, {}, [], bootstrap.serverTime);
      this.syncOwnershipPolling(bootstrap.writer.status);
      if (this.queue.size === 0) this.onAuthoritativeSettled?.(bootstrap.serverTime);
    } catch { /* the blocking state remains until a later focus/reconnect */ }
  }

  private clearOwnershipCheck(): void {
    if (this.ownershipTimer) clearTimeout(this.ownershipTimer);
    this.ownershipTimer = null;
  }

  private scheduleOwnershipCheck(): void {
    this.clearOwnershipCheck();
    if (typeof window === "undefined" || typeof document === "undefined" ||
        document.visibilityState !== "visible" || !this.ready ||
        !api.getSession() || !api.hasWriterCredential()) return;
    this.ownershipTimer = setTimeout(() => {
      this.ownershipTimer = null;
      void this.checkOwnership();
    }, OWNERSHIP_POLL_IDLE_MS);
  }

  private syncOwnershipPolling(status: "free" | "mine" | "other"): void {
    if (status === "mine") {
      this.scheduleOwnershipCheck();
      this.onWriterOwned?.();
    } else this.clearOwnershipCheck();
  }

  /** Foregrounding the app. Confirm the lease first, then — if gameplay is still
   *  paused — retry immediately instead of waiting out a backoff that was scheduled
   *  before the OS suspended us and may be a minute away. A document already behind
   *  the takeover gate (its credential cleared) is left alone: that state is the
   *  player's to resolve, and re-running recovery would reopen the dialog they
   *  dismissed with "View only". */
  private async resumeFromBackground(): Promise<void> {
    await this.checkOwnership();
    if (this.available || !api.hasWriterCredential()) return;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.recoveryAttempt = 0;
    await this.recover();
  }

  private async checkOwnership(): Promise<void> {
    if (this.ownershipCheckInFlight) return;
    this.clearOwnershipCheck();
    if (!this.ready || !api.getSession() || !api.hasWriterCredential()) return;
    this.ownershipCheckInFlight = true;
    try {
      const writer = await api.writerStatus();
      // Resolve "free" before treating the lease as lost. This check runs on every
      // visibility change, so a mobile resume after `pagehide` released the lease lands
      // here first — re-claim it instead of gating a farm no other device is holding.
      if (writer.status === "free" && await this.reclaimFreeWriter(writer.generation)) return;
      if (writer.status !== "mine") this.handleWriterLost();
    } catch { /* ordinary recovery owns network failure handling */ }
    finally {
      this.ownershipCheckInFlight = false;
      this.scheduleOwnershipCheck();
    }
  }

  private scheduleRecovery(): void {
    if (this.recoveryTimer || typeof window === "undefined") return;
    const delays = [2_000, 5_000, 10_000, 30_000, 60_000];
    const delay = delays[Math.min(this.recoveryAttempt, delays.length - 1)];
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.recover();
    }, delay);
  }

  private async recover(): Promise<void> {
    // A resume can race the backoff timer; one recovery attempt at a time.
    if (this.recoveryInFlight) return;
    this.recoveryInFlight = true;
    try {
      let bootstrap = await api.bootstrap(true);
      bootstrap = await this.recoverResumableRaid(bootstrap);
      this.queue.adoptBootstrap(bootstrap);
      this.ready = true;
      this.adoptGameplay(bootstrap.gameplay, {}, {}, [], bootstrap.serverTime);
      this.syncOwnershipPolling(bootstrap.writer.status);
      if (this.queue.size === 0) this.onAuthoritativeSettled?.(bootstrap.serverTime);
      if (!this.queue.available) {
        // Another live device owns the lease: the takeover gate owns this state, so
        // stop retrying and let the player decide.
        if (bootstrap.writer.status === "other") { this.onWriterReplaced?.(); return; }
        if (bootstrap.writer.status === "free" &&
            await this.reclaimFreeWriter(bootstrap.writer.generation)) return;
        // Still paused (mutations disabled server-side, protocol skew, or a lost claim
        // race). Keep the backoff alive: nothing else re-arms this timer, and dropping
        // it here leaves the farm frozen behind "Gameplay paused — reconnect to
        // continue" with no retry and no dialog until the player reloads by hand.
        this.recoveryAttempt++;
        this.scheduleRecovery();
        return;
      }
      this.recoveryAttempt = 0;
      await this.queue.retry();
    } catch {
      this.recoveryAttempt++;
      this.scheduleRecovery();
    } finally {
      this.recoveryInFlight = false;
    }
  }

  private async reloadAfterConflict(): Promise<void> {
    try {
      let bootstrap = await api.bootstrap(true);
      bootstrap = await this.recoverResumableRaid(bootstrap);
      this.queue.rebaseAfterConflict(bootstrap);
      this.ready = true;
      this.optimistic.clear();
      this.adoptGameplay(bootstrap.gameplay, {}, {}, [], bootstrap.serverTime);
      this.syncOwnershipPolling(bootstrap.writer.status);
      await this.queue.retry();
    } catch {
      this.onGameplayUnavailable?.("state_conflict");
    }
  }

  private enqueue(command: GameplayCommand, delta: Partial<OptimisticDelta> = {}): number | null {
    if (this.options.requireReady && !this.available) {
      this.onGameplayUnavailable?.("gameplay_unavailable");
      return null;
    }
    try {
      const sequence = this.queue.enqueue(command);
      this.commandsBySequence.set(sequence, command);
      this.optimistic.set(sequence, {
        gold: delta.gold ?? 0,
        brains: delta.brains ?? 0,
        xp: delta.xp ?? 0,
        inventoryKey: delta.inventoryKey,
        inventoryCount: delta.inventoryCount,
        localUnitId: delta.localUnitId,
        localZombieHarvests: delta.localZombieHarvests,
        localObjectId: delta.localObjectId,
      });
      this.reconcile();
      return sequence;
    } catch {
      this.onGameplayUnavailable?.("gameplay_unavailable");
      return null;
    }
  }

  /** Raw client-authored balance changes are intentionally not representable in v3.
   * Callers must use a semantic command or a server-derived quest/raid reward. */
  record(_currency: api.Currency, _delta: number, _reason: string): void {}

  submitFarm(input: FarmActionInput, optimistic: { gold?: number; brains?: number; xp?: number }): void {
    const command: GameplayCommand = input.type === "plant"
      ? {
          type: "farm.plant",
          oc: input.oc,
          or: input.or,
          cropKey: input.cropKey ?? "",
          fertilized: !!input.fertilized,
        }
      : input.type === "harvest"
        ? { type: "farm.harvest", oc: input.oc, or: input.or }
        : input.type === "remove"
          ? { type: "farm.remove", oc: input.oc, or: input.or }
          : input.type === "move"
            ? { type: "farm.move", oc: input.oc, or: input.or,
                toOc: input.toOc ?? input.oc, toOr: input.toOr ?? input.or }
            : { type: "farm.plow", oc: input.oc, or: input.or };
    const sequence = this.enqueue(command, { ...optimistic, localUnitId: input.unitId });
    // A harvested zombie is rendered immediately, but its crop-adjacency mutation
    // is server-owned. Do not leave that visible result sitting in the ordinary
    // batching window: reconcile it as soon as network latency allows.
    if (sequence !== null && input.type === "harvest" && input.unitId) void this.queue.flush();
  }

  submitInventory(
    input: InventoryInput,
    optimistic: { count: number; gold?: number; brains?: number; xp?: number }
  ): void {
    if (input.type === "grant") return; // grants are emitted only by server subsystems
    const command: GameplayCommand = input.type === "buy"
      ? { type: "power.buy", key: input.key }
      : { type: "power.use", key: input.key, oc: input.oc, or: input.or, target: input.target };
    const sequence = this.enqueue(command, {
      gold: optimistic.gold,
      brains: optimistic.brains,
      // A farm-wide power (Insta-Harvest / Insta-Plow) pays out gold + XP across
      // every plot it hits; the server owns the real numbers and reconciles.
      xp: optimistic.xp,
      inventoryKey: input.key,
      inventoryCount: optimistic.count,
      localUnitId: input.unitId,
      localZombieHarvests: input.localZombieHarvests,
    });
    // Insta-Harvest can create several zombies whose mutations are all resolved by
    // the server. Flush the single semantic power command immediately for the same
    // reason as an ordinary zombie harvest.
    if (sequence !== null && input.localZombieHarvests?.length) void this.queue.flush();
  }

  submitPower(key: "insta_harvest" | "insta_plow"): void {
    this.enqueue({ type: "power.use", key }, { inventoryKey: key, inventoryCount: -1 });
  }

  /** Returns false ONLY when a combine collection could not be submitted because this
   *  client no longer knows the job's parents (its in-memory record was cleared, or the
   *  pot id moved). That case used to fall through silently: the caller had already
   *  destroyed its pot job and granted an optimistic child, so no command, no rejection
   *  and no rollback meant both parents were simply gone. The caller must undo its
   *  optimistic collection when this returns false. */
  submitRoster(input: RosterInput, optimistic: { gold?: number } = {}): boolean {
    if (input.type === "combineStart") {
      const potId = input.potId ?? "legacy";
      this.combineParents.set(potId, {
        parentAId: input.parentAId,
        parentBId: input.parentBId,
        playerLevel: input.playerLevel,
      });
      this.enqueue({
        type: "roster.combine_start",
        potId,
        parentAId: this.authoritativeUnitId(input.parentAId),
        parentBId: this.authoritativeUnitId(input.parentBId),
        ...(input.playerLevel === undefined ? {} : { playerLevel: input.playerLevel }),
      });
      return true;
    }
    if (input.type === "combineCollect") {
      const potId = input.potId ?? "legacy";
      const parents = this.combineParents.get(potId);
      if (!parents) return false;
      this.enqueue({
        type: "roster.combine",
        potId,
        parentAId: this.authoritativeUnitId(parents.parentAId),
        parentBId: this.authoritativeUnitId(parents.parentBId),
        ...(parents.playerLevel === undefined ? {} : { playerLevel: parents.playerLevel }),
      }, { localUnitId: input.unitId });
      return true;
    }
    if (input.type === "sell") this.enqueue({ type: "roster.sell", unitId: this.authoritativeUnitId(input.unitId) }, optimistic);
    // Grants, casualties, and veterancy come from farm/raid results in v3.
    return true;
  }
  submitRosterStatus(unitId: string, stored: boolean): void {
    this.enqueue({ type: "roster.status", unitId: this.authoritativeUnitId(unitId), stored });
  }

  restoreCombineParents(parentAId: string, parentBId: string): void;
  restoreCombineParents(potId: string, parentAId: string, parentBId: string, playerLevel?: number): void;
  restoreCombineParents(a: string, b: string, c?: string, playerLevel?: number): void {
    const [potId, parentAId, parentBId] = c === undefined ? ["legacy", a, b] : [a, b, c];
    this.combineParents.set(potId, { parentAId, parentBId, playerLevel });
  }

  async settleUnitIds(ids: string[]): Promise<string[]> {
    await this.settleBeforeDependency();
    return ids.map((id) => this.authoritativeUnitId(id));
  }

  submitObject(
    input: { type: "buy" | "refund"; key: string; instanceId?: string } |
      { type: "upgrade"; fromKey: string; toKey: string; instanceId?: string },
    optimistic: { gold?: number; brains?: number; xp?: number }
  ): void {
    if (input.type === "buy") this.enqueue(
      { type: "object.buy", catalogKey: input.key, clientInstanceId: input.instanceId },
      { ...optimistic, localObjectId: input.instanceId }
    );
    else if (input.type === "refund" && input.instanceId) this.enqueue({ type: "object.refund", instanceId: input.instanceId }, optimistic);
    else if (input.type === "upgrade") {
      if (input.instanceId) this.enqueue({ type: "object.upgrade", instanceId: input.instanceId, catalogKey: input.toKey }, optimistic);
    }
  }

  submitObjectStatus(instanceId: string, status: "placed" | "stored"): void {
    this.enqueue({ type: "object.status", instanceId, status });
  }

  submitTreeHarvest(instanceIds: string[], optimisticGold = 0): void {
    if (instanceIds.length) this.enqueue(
      { type: "object.harvest_trees", instanceIds },
      { gold: optimisticGold }
    );
  }

  submitStorageClaim(
    itemName: string,
    optimistic: { inventoryKey?: string; localObjectId?: string }
  ): boolean {
    return this.enqueue(
      { type: "storage.claim", itemName, clientInstanceId: optimistic.localObjectId },
      {
        inventoryKey: optimistic.inventoryKey,
        inventoryCount: optimistic.inventoryKey ? 1 : undefined,
        localObjectId: optimistic.localObjectId,
      }
    ) !== null;
  }

  submitShopSize(size: number, currency: "gold" | "brains", cost: number): boolean {
    return this.enqueue(
      { type: "shop.size", size, currency }, currency === "gold" ? { gold: -cost } : { brains: -cost }
    ) !== null;
  }

  submitFarmerBuy(headId: number, currency: "gold" | "brains", cost: number): boolean {
    return this.enqueue(
      { type: "farmer.buy", headId },
      currency === "gold" ? { gold: -cost } : { brains: -cost }
    ) !== null;
  }

  submitFarmerEquip(headId: number): boolean {
    return this.enqueue({ type: "farmer.equip", headId }) !== null;
  }

  submitPetBuy(petKey: string, cost: number, xp: number): boolean {
    return this.enqueue({ type: "pet.buy", petKey }, { brains: -cost, xp }) !== null;
  }

  submitPetEquip(petKey: string | null): boolean {
    return this.enqueue({ type: "pet.equip", petKey }) !== null;
  }

  submitPenPets(petKeys: string[]): boolean {
    return this.enqueue({ type: "pet.pen", petKeys }) !== null;
  }

  submitShopClimate(terrain: string, cost: number): boolean {
    return this.enqueue({ type: "shop.climate", terrain }, { gold: -cost }) !== null;
  }

  submitTutorialCompletion(): void {
    this.enqueue({ type: "tutorial.complete" }, { gold: 200 });
  }

  submitQuest(_questId: string): void {
    // Completion and reward happen inside the accepted command/raid transaction.
  }

  async submitRaid(
    sessionId: string,
    finalTick: number,
    inputs: api.RaidReplayInput[],
    outcome: RaidOutcome,
    _optimistic: { gold?: number; xp?: number }
  ): Promise<api.RaidFinishResult> {
    const pending: PendingRaidFinish = { sessionId, finalTick, inputs, outcome, savedAt: Date.now() };
    this.persistPendingRaid(pending);
    let result: api.RaidFinishResult;
    try {
      result = await this.sendRaidFinish(pending);
      this.clearPendingRaid(sessionId);
    } catch (error) {
      // Transport/writer contention leaves the server session resumable. Preserve the
      // exact transcript and let reconnect/bootstrap retry it instead of turning a
      // completed invasion into a retreat.
      if (this.raidFinishRetryable(error) || (error instanceof api.ApiError && error.status === 423)) {
        this.scheduleRecovery();
      } else {
        this.clearPendingRaid(sessionId);
      }
      throw error;
    }
    this.base = result.balance;
    if (result.inventory) this.serverInv = { ...result.inventory };
    if (result.storage) this.state.syncStorage(result.storage.received, result.storage.stored);
    if (result.raidProgress) this.state.syncRaidProgress(result.raidProgress);
    this.state.syncRaidCooldown(serverTimestampToClient(
      result.lastRaidAt,
      result.serverTime ?? Date.now(),
    ));
    this.onQuestChanges?.(result.questChanges ?? []);
    this.reconcile();
    this.onRaidSettled?.(result);
    return result;
  }

  async resolveRaidRevival(sessionId: string, reviveIds: string[]): Promise<api.RaidReviveResult> {
    const result = await api.raidRevive(sessionId, reviveIds);
    this.base = result.balance;
    this.reconcile();
    return result;
  }

  async flush(): Promise<void> { await this.queue.flush(); }
  async settleBeforeDependency(): Promise<void> {
    try {
      await this.queue.settle();
      return;
    } catch (error) {
      // A bootstrap/network failure can leave an otherwise empty durable queue paused.
      // Out-of-band mutations (gift claims, raids, Epic Boss actions) used to remain
      // blocked behind that stale flag even after connectivity returned. With no local
      // commands to preserve, a fresh bootstrap is a safe immediate recovery boundary.
      if (this.queue.size > 0) throw error;
    }

    const bootstrap = await api.bootstrap(true);
    this.queue.adoptBootstrap(bootstrap);
    this.ready = true;
    this.adoptGameplay(bootstrap.gameplay, {}, {}, [], bootstrap.serverTime);
    this.syncOwnershipPolling(bootstrap.writer.status);
    if (bootstrap.writer.status !== "mine") {
      this.onWriterReplaced?.();
      throw new Error("writer_replaced");
    }
    // Re-check the queue state so maintenance mode, a protocol gate, or ownership
    // loss still blocks the external mutation instead of bypassing server authority.
    await this.queue.settle();
  }

  /** Establish a fresh CAS boundary for a direct cross-account mutation. Market
   * actions deliberately do not auto-replay after this version is observed. */
  async prepareExternalMutation(): Promise<number> {
    await this.queue.settle();
    const bootstrap = await api.bootstrap(true);
    this.queue.adoptBootstrap(bootstrap);
    this.ready = true;
    this.adoptGameplay(bootstrap.gameplay, {}, {}, [], bootstrap.serverTime);
    this.syncOwnershipPolling(bootstrap.writer.status);
    if (bootstrap.writer.status !== "mine") throw new Error("writer_replaced");
    return bootstrap.accountVersion;
  }

  adoptRaidStartInventory(inventory: Record<string, number>): void {
    this.serverInv = { ...inventory };
    this.reconcile();
  }

  adoptEpicBossResult(result: api.EpicBossFinishResult): void {
    this.base = result.balance;
    this.serverInv = { ...result.inventory };
    this.state.syncStorage(result.storage.received, result.storage.stored);
    this.onPetState?.(result.ownedPets, this.state.activePet, this.state.penPets);
    // Changes BEFORE the wholesale adopt. restoreAuthoritative installs the server's
    // `completed` set, and applyAuthoritativeChanges only celebrates a quest it did not
    // already consider complete — so the old order silently swallowed the completion
    // popup for every epic-boss quest, including the one handing over the event's
    // signature zombie. The raid lane (submitRaid) posts changes alone for this reason.
    this.onQuestChanges?.(result.questChanges);
    this.onQuestState?.({ completed: result.quests.completed, progress: result.quests.progress, questChanges: result.questChanges });
    const serverTime = result.serverTime ?? Date.now();
    this.onEpicBossState?.(epicBossRunToClient(result.event, serverTime));
    if (result.lastRaidAt != null) this.state.syncRaidCooldown(serverTimestampToClient(
      result.lastRaidAt,
      serverTime,
    ));
    this.reconcile();
  }

  adoptEpicBossActivation(
    event: NonNullable<BootstrapResponse["gameplay"]["epicBoss"]>,
    balance: api.Balance,
    serverTime = Date.now(),
  ): void {
    this.base = balance;
    this.onEpicBossState?.(epicBossRunToClient(event, serverTime));
    this.reconcile();
  }

  /** Translate an optimistic harvest id after its command has settled. */
  authoritativeUnitId(id: string): string {
    return this.authoritativeUnitIds.get(id) ?? id;
  }

  async refreshInventory(): Promise<void> {
    let bootstrap = await api.bootstrap(true);
    bootstrap = await this.recoverResumableRaid(bootstrap);
    this.queue.adoptBootstrap(bootstrap);
    this.ready = true;
    this.adoptGameplay(bootstrap.gameplay, {}, {}, [], bootstrap.serverTime);
    this.syncOwnershipPolling(bootstrap.writer.status);
  }
  async refreshAuthoritative(): Promise<void> { await this.refreshInventory(); }

  private pendingRaidKey(): string { return `${RAID_FINISH_PREFIX}::${this.accountId}`; }

  private persistPendingRaid(value: PendingRaidFinish): void {
    try { localStorage.setItem(this.pendingRaidKey(), JSON.stringify(value)); }
    catch { /* the live retry path still works when storage is unavailable */ }
  }

  private readPendingRaid(): PendingRaidFinish | null {
    try {
      const value = JSON.parse(localStorage.getItem(this.pendingRaidKey()) ?? "null") as PendingRaidFinish | null;
      if (!value || typeof value.sessionId !== "string" || !Number.isInteger(value.finalTick) ||
          !Array.isArray(value.inputs) || !value.outcome || typeof value.outcome.win !== "boolean") return null;
      return value;
    } catch {
      return null;
    }
  }

  private clearPendingRaid(sessionId?: string): void {
    const current = this.readPendingRaid();
    if (sessionId && current && current.sessionId !== sessionId) return;
    try { localStorage.removeItem(this.pendingRaidKey()); } catch { /* unavailable */ }
  }

  private raidFinishRetryable(error: unknown): boolean {
    if (!(error instanceof api.ApiError)) return false;
    return error.status === 0 || error.status === 408 || error.status === 425 || error.status === 429 ||
      error.status >= 500 || error.code === "operation_in_progress" ||
      error.code === "state_conflict" || error.code === "future_finish";
  }

  private async sendRaidFinish(pending: PendingRaidFinish): Promise<api.RaidFinishResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api.raidFinish(pending.sessionId, pending.finalTick, pending.inputs, pending.outcome);
      } catch (error) {
        if (!this.raidFinishRetryable(error) || attempt === RAID_FINISH_RETRY_MS.length) throw error;
        const retryAfterMs = Number((error as api.ApiError).body &&
          ((error as api.ApiError).body as { retryAfterMs?: unknown }).retryAfterMs);
        const delay = Number.isFinite(retryAfterMs) && retryAfterMs >= 0
          ? retryAfterMs + 250
          : RAID_FINISH_RETRY_MS[attempt];
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /** Resolve a server session discovered by bootstrap. A durable completed transcript
   * wins over the old crash fallback; only a genuinely abandoned session retreats. */
  private async recoverResumableRaid(bootstrap: BootstrapResponse): Promise<BootstrapResponse> {
    if (bootstrap.writer.status !== "mine") return bootstrap;
    const pending = this.readPendingRaid();
    const resumable = bootstrap.resumableRaid;
    if (!resumable) {
      if (pending) this.clearPendingRaid(pending.sessionId);
      return bootstrap;
    }
    if (pending?.sessionId === resumable.sessionId) {
      await this.sendRaidFinish(pending);
      this.clearPendingRaid(pending.sessionId);
    } else {
      if (pending) this.clearPendingRaid(pending.sessionId);
      await api.raidFinish(resumable.sessionId, 0, [{ seq: 1, tick: 0, type: "retreat" }]);
    }
    return api.bootstrap(true);
  }

  /** Claiming a social gift is an independent, server-fenced mutation. It must not
   * wait on the gameplay writer queue: another tab may own that queue, and a paused
   * durable command must not prevent this account from receiving its gift. */
  async claimGift(giftId: string) {
    let result: Awaited<ReturnType<typeof api.claimGift>> | undefined;
    let lastError: unknown;
    // A command batch owns the account fence only briefly. Claims are idempotent,
    // so retry a transient collision instead of making the player click again.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await api.claimGift(giftId);
        break;
      } catch (error) {
        lastError = error;
        if (!(error instanceof api.ApiError) || error.code !== "operation_in_progress" || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    if (!result) throw lastError ?? new Error("gift_claim_failed");
    this.adoptExternalBalance(result.balance, result.accountVersion);
    return result;
  }

  /** Adopt a balance returned by a trusted server-side mutation such as claiming a
   * social gift. Pending optimistic gameplay deltas remain layered on top. */
  adoptExternalBalance(balance: api.Balance, accountVersion?: number): void {
    this.base = { ...balance };
    if (accountVersion !== undefined) this.queue.adoptAccountVersion(accountVersion);
    this.reconcile();
  }

  // Reset means there is no client seed/import path. These remain as no-ops until
  // their call sites are removed from the presentation hydration code.
  async syncRoster(_units: api.RosterSeedUnit[]): Promise<void> {}
  async syncObjects(_counts: Record<string, number>): Promise<void> {}
  async syncFarm(_plowed: { oc: number; or: number }[]): Promise<void> {}
  async syncShop(_size: number, _climates: string[]): Promise<void> {}

  private adoptCommandResponse(response: CommandBatchResponse): void {
    const aliases: Record<string, string> = {};
    const objectAliases: Record<string, string> = {};
    const rejectedObjectIds: string[] = [];
    for (const result of response.results) {
      const pending = this.optimistic.get(result.sequence);
      const command = this.commandsBySequence.get(result.sequence);
      if ((result.status === "rejected" || result.status === "dependency_failed") && result.error) {
        if (command?.type === "roster.combine_start") this.combineParents.delete(command.potId);
        this.onCommandRejected?.(command, result.error);
      }
      if (result.status === "applied" && command?.type === "roster.combine") {
        this.combineParents.delete(command.potId ?? "legacy");
      }
      if (pending?.localUnitId && result.status === "applied" && result.createdIds?.[0]) {
        aliases[result.createdIds[0]] = pending.localUnitId;
        this.authoritativeUnitIds.set(pending.localUnitId, result.createdIds[0]);
      }
      if (pending?.localZombieHarvests?.length && result.createdZombieSources?.length) {
        const localByPlot = new Map(pending.localZombieHarvests.map((item) => [`${item.oc}:${item.or}`, item.id]));
        for (const created of result.createdZombieSources) {
          const local = localByPlot.get(`${created.oc}:${created.or}`);
          if (!local) continue;
          aliases[created.id] = local;
          this.authoritativeUnitIds.set(local, created.id);
        }
      }
      if (pending?.localObjectId && result.status === "applied" && result.createdIds?.[0] &&
          result.createdIds[0] !== pending.localObjectId) {
        objectAliases[result.createdIds[0]] = pending.localObjectId;
      }
      if (pending?.localObjectId && (result.status === "rejected" || result.status === "dependency_failed")) {
        rejectedObjectIds.push(pending.localObjectId);
      }
      this.optimistic.delete(result.sequence);
      this.commandsBySequence.delete(result.sequence);
    }
    Object.assign(this.deferredRosterAliases, aliases);
    Object.assign(this.deferredObjectAliases, objectAliases);
    rejectedObjectIds.forEach((id) => this.deferredRejectedObjectIds.add(id));
    this.onQuestChanges?.(response.questChanges);
    this.adoptGameplay(response.gameplay, aliases, objectAliases, rejectedObjectIds, response.serverTime);
    if (this.queue.size === 0) this.onAuthoritativeSettled?.(response.serverTime);
  }

  private adoptGameplay(
    gameplay: BootstrapResponse["gameplay"],
    aliases: Record<string, string> = {},
    objectAliases: Record<string, string> = {},
    rejectedObjectIds: string[] = [],
    serverTime = Date.now(),
  ): void {
    this.base = gameplay.balance;
    this.serverInv = gameplay.inventory;
    this.state.zombiePotBought = gameplay.zombiePotBought ?? false;
    this.state.syncRaidProgress(gameplay.raids.progress);
    this.state.syncRaidCooldown(serverTimestampToClient(gameplay.raids.lastRaidAt, serverTime));
    const deferStructural = this.commandsBySequence.size > 0;
    const plowed: api.FarmState["plowed"] = [];
    const spent: NonNullable<api.FarmState["spent"]> = [];
    const crops: api.FarmState["crops"] = [];
    // Farm growth uses the local wall clock. Translate server-authored timestamps
    // into that clock domain so clock skew cannot make an acknowledged Insta-Grow
    // briefly appear unripe (or skew every ordinary crop countdown).
    const clientTime = Date.now();
    for (const [key, plot] of Object.entries(gameplay.farm.plots)) {
      const [oc, pr] = key.split(":").map(Number);
      if (plot.state === "plowed") plowed.push({ oc, pr });
      else if (plot.state === "spent") spent.push({ oc, pr, zombie: !!plot.zombie });
      else if (plot.state === "planted") {
        crops.push({
          oc,
          pr,
          crop_key: plot.cropKey,
          planted_at: serverTimestampToClient(plot.plantedAt, serverTime, clientTime),
          grow_ms: plot.growMs,
          fertilized: plot.fertilized ? 1 : 0,
        });
      }
    }
    if (!deferStructural) {
      this.onShopState?.(gameplay.farmSize, gameplay.climates);
      this.onFarmerState?.(gameplay.farmerHeads, gameplay.farmerHeadId);
      this.onPetState?.(gameplay.ownedPets, gameplay.activePet, gameplay.penPets);
      this.onQuestState?.({
        completed: gameplay.quests.completed,
        progress: gameplay.quests.progress,
        questChanges: [],
      });
      this.state.syncStorage(gameplay.storage.received, gameplay.storage.stored);
      for (const crop of crops) if (crop.fertilized) this.onCropFertilized?.(crop.oc, crop.pr);
      this.onFarmState?.({ plowed, spent, crops });
      const objectAliasesForPass = { ...this.deferredObjectAliases, ...objectAliases };
      const objectPass = this.onObjectState?.(
        gameplay.objects.objects.map((object) => object.readyAt === undefined ? object : ({
          ...object,
          readyAt: serverTimestampToClient(object.readyAt, serverTime, clientTime),
        })),
        objectAliasesForPass,
        gameplay.zombieMax,
        [...new Set([...this.deferredRejectedObjectIds, ...rejectedObjectIds])]
      );
      // The reconcile is async. Clearing the alias map here — as this used to — discarded
      // it the moment that reconcile awaited a texture, so a pass superseded mid-flight
      // lost the only mapping from a server-minted instance id to the local object holding
      // its position. Positions live nowhere else, so the object could never be drawn
      // again: the player had paid for something permanently invisible. Retain each alias
      // until a pass reports it consumed them, and drop only the keys actually delivered
      // so an alias learned since this pass started survives.
      void Promise.resolve(objectPass)
        .then((consumed) => {
          if (consumed === false) return;
          for (const id of Object.keys(objectAliasesForPass)) delete this.deferredObjectAliases[id];
        })
        .catch(() => {});
      // Rejections are applied before the reconcile's first await, so they are always
      // consumed. Re-delivering one could delete a later object that reused the freed id.
      this.deferredRejectedObjectIds.clear();
      // Capture/display a pending revival before roster reconciliation removes the
      // casualties from the local presentation cache. The offer remains server-owned.
      if (gameplay.raidRevival) this.onRaidRevival?.(gameplay.raidRevival, gameplay.balance.brains);
      this.onRosterState?.(
        gameplay.roster,
        { ...this.deferredRosterAliases, ...aliases },
        this.queue.size === 0,
      );
      this.deferredRosterAliases = {};
      this.onEpicBossState?.(epicBossRunToClient(gameplay.epicBoss, serverTime, clientTime));
      this.onTutorialState?.(gameplay.tutorialRewarded);
    }
    this.reconcile();
  }

  private reconcile(): void {
    if (!this.base) return;
    const balance = { ...this.base };
    const inventory = { ...this.serverInv };
    for (const delta of this.optimistic.values()) {
      balance.gold += delta.gold;
      balance.brains += delta.brains;
      balance.xp += delta.xp;
      if (delta.inventoryKey) inventory[delta.inventoryKey] = (inventory[delta.inventoryKey] ?? 0) + (delta.inventoryCount ?? 0);
    }
    this.state.syncBalance(balance.gold, balance.brains, balance.xp);
    this.state.syncInventory(inventory);
  }
}
