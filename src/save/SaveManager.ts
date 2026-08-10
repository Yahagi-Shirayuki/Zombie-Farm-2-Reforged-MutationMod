import { GameState } from "../GameState";
import { CropConfig, Field } from "../Field";
import { objectSpriteFiles, PlaceableDef } from "../assets";
import { WalkController } from "../WalkController";
import { ZombieField } from "../zombie/ZombieField";
import { QuestSystem } from "../quest/QuestSystem";
import type { PeriodicQuestSystem } from "../quest/periodic/PeriodicQuestSystem";
import {
  SaveGame, SAVE_VERSION, ONLINE_PRESENTATION_PREFIX, ONLINE_SNAPSHOT_PREFIX,
  type FallenZombieSave,
} from "./schema";
import { activeSaveKey, migrateLegacyProfileSaves } from "./profiles";
import * as api from "../net/api";
import { getFarmBackground } from "../prefs";
import { epicBossById } from "../epicBoss/catalog";
import { GAMEPLAY_PROTOCOL } from "../net/protocol";
import { epicBossRunToClient, serverTimestampToClient } from "../net/clock";
import { reconcileTutorialCompletion } from "../tutorial/steps";
import { backfillDiscovered, sanitizeDiscovered } from "../zombie/almanac";
import { sanitizeFallen, sanitizeFallenUncapped } from "../zombie/memorial";
import { sanitizeTeams } from "../zombie/teams";
import type { PlayMode } from "../playMode";
import type { JobSystem } from "../JobSystem";

export type FarmLoadResult =
  | { kind: "local-existing" }
  | { kind: "local-new" }
  | { kind: "local-unavailable"; reason: "storage_unavailable" | "save_unreadable" }
  | { kind: "online-authoritative"; restored: boolean }
  | { kind: "online-cached"; savedAt: number }
  | { kind: "online-unavailable"; reason: string };

type PresentationData = {
  player?: { name?: string; farmer?: { col: number; row: number }; farmerAppearance?: SaveGame["player"]["farmerAppearance"] };
  farm?: {
    climate?: string;
    background?: SaveGame["farm"]["background"];
    zombiePatchGathered?: boolean;
  };
  objectLayout?: { id: string; key?: string; oc: number; or: number; rotation?: number;
    memorial?: FallenZombieSave }[];
  rosterLayout?: { id: string; name?: string; pos?: { col: number; row: number }; stored?: boolean; color?: [number, number, number] }[];
  zombiePot?: SaveGame["zombiePot"];
  zombiePots?: SaveGame["zombiePots"];
  tutorial?: SaveGame["tutorial"];
  ui?: { attackOrder?: string[]; teams?: unknown };
  /** Zombie Almanac lifetime-discovery counts. Cosmetic and client-authored, so
   * online it rides the presentation blob rather than a server table. */
  almanac?: SaveGame["almanac"];
  /** The graveyard (unenshrined fallen zombies). Client-authored for the same
   * reason: the server deletes a casualty outright and keeps no record of it. */
  fallen?: SaveGame["fallen"];
};
type ObjectLayout = NonNullable<PresentationData["objectLayout"]>[number];

/** Offline builds retain a local full save. Signed-in v3 builds persist only visual
 * presentation; authoritative gameplay is hydrated from the shared bootstrap call. */
export class SaveManager {
  /** Background from the latest hydrated save. Main applies this only for the
   * player's own farm, so visiting never overwrites device preferences. */
  loadedFarmBackground: SaveGame["farm"]["background"];
  private presentationVersion = 0;
  private lastPresentation = "";
  private presentationDirty = false;
  private pushing = false;
  private pendingPresentation: Record<string, unknown> | null = null;
  private pendingPresentationImmediate = false;
  private autoFlush: (() => void) | null = null;
  private scheduleSave: (() => void) | null = null;
  private lastPresentationCallAt = 0;
  private suspended = false;
  private onlineWritable = false;
  // Keep the last known position of server-owned objects until the authoritative
  // command queue settles. A pagehide between an optimistic remove/store and its
  // server command must not erase the only position the server can use on reload.
  private objectLayouts = new Map<string, ObjectLayout>();
  private readonly localKey: string | null;
  // Online job intents are hydrated with the authoritative farm projection, but
  // their elapsed-time replay must wait until EconomyClient owns a live writer
  // channel. Replaying during bootstrap would otherwise take JobSystem's offline
  // mutation path and discard the journal without sending commands.
  private pendingOnlineJobs: SaveGame["farmJobs"];
  // Set once a bootstrap confirms this tab owns the writer; until then the journal
  // stays parked. `draining` guards the re-entry from restorePending's own enqueues.
  private onlineJobsResumable = false;
  private draining = false;
  onStorageError: ((message: string) => void) | null = null;
  /** Daily/weekly quests. A settable field rather than a constructor parameter: only
   *  main.ts ever supplies one, while a dozen tests build a SaveManager positionally
   *  and have no interest in it. Offline it round-trips through the save; online
   *  `serialize()` returns undefined and the sets come from the server instead. */
  periodicQuests: PeriodicQuestSystem | null = null;

  constructor(
    private state: GameState,
    private field: Field,
    private walk: WalkController,
    private zombies: ZombieField,
    private quests: QuestSystem,
    private catalog: Map<string, CropConfig>,
    private placeCatalog: Map<string, PlaceableDef>,
    private preload: (sprite: string) => Promise<unknown>,
    private readonly mode: PlayMode = "local",
    private readonly jobs?: JobSystem,
  ) {
    if (mode === "local") {
      migrateLegacyProfileSaves();
      this.localKey = activeSaveKey();
    } else {
      this.localKey = null;
    }
  }

  private isOnline(): boolean { return this.mode === "online" && api.isConfigured() && !!api.getSession(); }
  private cacheKey(): string {
    const session = api.getSession();
    if (this.mode === "local") return this.localKey!;
    return `${ONLINE_PRESENTATION_PREFIX}::${session?.accountId ?? "unavailable"}`;
  }
  private snapshotKey(): string | null {
    const session = api.getSession();
    return this.mode === "online" && session
      ? `${ONLINE_SNAPSHOT_PREFIX}::${session.accountId}`
      : null;
  }
  private jobJournalKey(): string | null {
    return this.mode === "online" && api.getSession() ? `${this.cacheKey()}::farm-jobs` : null;
  }
  private writeJobJournal(jobs: SaveGame["farmJobs"]): void {
    const key = this.jobJournalKey();
    if (!key) return;
    try {
      const journal = this.pendingOnlineJobs ?? jobs;
      if (journal?.jobs.length) localStorage.setItem(key, JSON.stringify(journal));
      else localStorage.removeItem(key);
    } catch { /* optional crash-recovery journal */ }
  }
  private readJobJournal(): SaveGame["farmJobs"] {
    const key = this.jobJournalKey();
    if (!key) return undefined;
    try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined; }
    catch { return undefined; }
  }

  /** Resume an Online Farm journal once the authoritative command channel is ready.
   * Safe to call repeatedly (writer recovery can announce availability more than once). */
  restoreOnlineJobs(): void {
    this.onlineJobsResumable = true;
    this.drainOnlineJobs();
  }

  /** Hand the parked journal to JobSystem, or leave it parked if JobSystem declines.
   * A tap made while the tab was still booting leaves the queue busy, and
   * restorePending refuses to interleave with it; checkpointJobs retries this as soon
   * as that live job finishes, so the intents are never silently discarded. */
  private drainOnlineJobs(): void {
    if (this.draining || !this.onlineJobsResumable || this.mode !== "online") return;
    if (!this.pendingOnlineJobs || !this.jobs) return;
    this.draining = true;
    try {
      // The parked copy is cleared only once JobSystem accepts it, so a throw or a
      // busy-queue refusal both leave the journal intact for the next attempt.
      if (!this.jobs.restorePending(this.pendingOnlineJobs, (key) => this.catalog.get(key))) return;
      this.pendingOnlineJobs = undefined;
    } finally {
      this.draining = false;
    }
    this.writeJobJournal(this.jobs.serializePending());
  }

  hasSave(): boolean {
    try { return localStorage.getItem(this.cacheKey()) !== null; } catch { return false; }
  }

  serialize(): SaveGame {
    // Online farm jobs are still client-side movement intentions until the farmer
    // reaches the target and emits its server command. Persist those intentions in
    // an account-scoped device journal so a discarded tab can restore and revalidate
    // them against the authoritative farm projection on its next bootstrap.
    const farmJobs = this.jobs?.serializePending();
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      player: {
        name: this.state.name,
        gold: this.state.gold,
        brains: this.state.brains,
        xp: this.state.xp,
        zombieMax: this.state.zombieMax,
        zombieCount: this.state.zombieCount,
        farmer: this.walk.tile,
        unlockedAbilities: this.state.unlockedAbilities,
        zombiePotBought: this.state.zombiePotBought,
        farmerAppearance: {
          ownedHeads: this.state.ownedFarmerHeads,
          ownedBodies: this.state.ownedFarmerBodies,
          headId: this.state.farmerHeadId,
          bodyId: this.state.farmerBodyId,
          bonusHeadId: this.state.farmerBonusHeadId,
        },
        petCollection: { owned: this.state.ownedPets, active: this.state.activePet, pen: this.state.penPets },
      },
      farm: {
        fieldId: "default",
        w: this.field.w,
        h: this.field.h,
        climate: this.field.climate,
        background: getFarmBackground(),
        ownedClimates: this.state.ownedClimates,
        plots: this.field.serialize(),
        zombiePatchGathered: this.zombies.isGathered,
      },
      objects: this.field.serializeObjects(),
      ownedZombies: this.zombies.serialize(),
      zombiePots: this.zombies.serializePots(),
      storage: { itemCap: this.state.storageItemCap, items: this.state.storedItems, received: this.state.received },
      boosts: this.state.boostInv,
      quests: this.quests.serialize(),
      ...(this.periodicQuests?.serialize() ? { periodicQuests: this.periodicQuests.serialize() } : {}),
      raids: { completed: this.state.raidsCompleted, lastRaidAt: this.state.lastRaidAt, attackOrder: this.state.raidAttackOrder,
        brainDryStreak: this.state.brainDryStreak, zombieDryWins: this.state.zombieDryWins },
      epicBoss: this.state.epicBossRun ?? undefined,
      social: { friends: this.state.friends },
      tutorial: this.state.tutorial,
      almanac: { discovered: this.state.zombieDiscovered },
      fallen: this.state.fallenZombies,
      teams: this.state.zombieTeams,
      ...(farmJobs ? { farmJobs } : {}),
    };
  }

  private presentation(blob = this.serialize()): Record<string, unknown> {
    for (const object of blob.objects ?? []) {
      this.objectLayouts.set(object.id, {
        id: object.id,
        ...(object.key === "storage01" ? { key: object.key } : {}),
        oc: object.oc,
        or: object.or,
        rotation: object.rotation,
      });
    }
    return {
      player: {
        name: blob.player.name,
        farmer: blob.player.farmer,
        farmerAppearance: {
          headId: blob.player.farmerAppearance?.headId,
          bodyId: blob.player.farmerAppearance?.bodyId,
        },
      },
      farm: {
        climate: blob.farm.climate,
        background: blob.farm.background,
        zombiePatchGathered: blob.farm.zombiePatchGathered,
      },
      // The free starter shed is presentation-only, so its key must travel with
      // its layout or it cannot be reconstructed after a signed-in refresh.
      objectLayout: [...this.objectLayouts.values()],
      rosterLayout: (blob.ownedZombies ?? []).map((u) => ({ id: u.id, name: u.name, pos: u.pos, stored: u.stored, color: u.color })),
      zombiePots: blob.zombiePots,
      tutorial: blob.tutorial,
      // Saved line-ups ride the UI blob beside the attack order for the same
      // reason: both are lists of the account's own zombie ids that only this
      // client authors, and neither is ever read back as gameplay truth.
      ui: { attackOrder: blob.raids?.attackOrder ?? [], teams: blob.teams ?? [] },
      almanac: blob.almanac,
      // The graveyard and each statue's occupant are SERVER-owned (fallen_v3) — a
      // visitor renders the memorial from the authoritative projection, so a copy
      // here would be a second source of truth that only this client can see. The
      // `fallen` key stays allow-listed server-side purely so an older client's
      // blob is still accepted rather than rejecting its whole presentation write.
    };
  }

  /** Prune layout tombstones only after the gameplay command queue is empty and
   * its object projection is authoritative. The starter shed is presentation-only. */
  reconcileObjectLayouts(activeServerIds: ReadonlySet<string>): void {
    for (const [id, layout] of this.objectLayouts) {
      if (layout.key !== "storage01" && !activeServerIds.has(id)) this.objectLayouts.delete(id);
    }
  }

  flush(): void { this.autoFlush ? this.autoFlush() : this.save(); }
  /** Immediately checkpoint only the lightweight client-side farmer queue. Fired on
   * every queue change, which also makes it the retry point for a parked journal
   * JobSystem previously refused (see drainOnlineJobs). */
  checkpointJobs(): void {
    if (this.suspended || this.mode !== "online") return;
    this.drainOnlineJobs();
    this.writeJobJournal(this.jobs?.serializePending());
  }
  /** Persist state that must survive an immediate reload (currently Zombie Pot jobs). */
  flushCritical(): void {
    if (this.suspended) return;
    const blob = this.serialize();
    if (this.mode === "local") { this.writeLocal(blob); return; }
    this.writeJobJournal(blob.farmJobs);
    if (!this.isOnline()) return;
    const data = this.presentation(blob);
    try { localStorage.setItem(this.cacheKey(), JSON.stringify(data)); } catch { /* ignore */ }
    if (this.pushing) this.pendingPresentationImmediate = true;
    void this.push(data);
  }
  suspend(): void { this.suspended = true; }
  setOnlineWritable(value: boolean): void {
    this.onlineWritable = value;
    if (value && this.presentationDirty) void this.push(this.presentation());
  }
  syncRev(_rev: number): void {}

  save(): void {
    if (this.suspended) return;
    const blob = this.serialize();
    if (this.mode === "local") {
      this.writeLocal(blob);
      return;
    }
    this.writeJobJournal(blob.farmJobs);
    if (!this.isOnline()) return;
    // Gameplay code calls save() at many semantic boundaries. In v3 those calls only
    // mark presentation dirty; they must not bypass the fixed one-minute deadline.
    if (this.scheduleSave) {
      this.scheduleSave();
      return;
    }
    this.commitPresentation(blob);
  }

  private commitPresentation(blob = this.serialize()): void {
    this.writeJobJournal(blob.farmJobs);
    if (this.suspended || !this.isOnline()) return;
    const data = this.presentation(blob);
    const encoded = JSON.stringify(data);
    if (encoded === this.lastPresentation && !this.presentationDirty) return;
    this.presentationDirty = true;
    try { localStorage.setItem(this.cacheKey(), encoded); } catch { /* ignore */ }
    void this.push(data);
  }

  private writeLocal(blob: SaveGame): void {
    const key = this.cacheKey();
    const temporary = `${key}.tmp`;
    const backup = `${key}.backup`;
    try {
      const encoded = JSON.stringify(blob);
      localStorage.setItem(temporary, encoded);
      JSON.parse(localStorage.getItem(temporary) ?? "");
      const current = localStorage.getItem(key);
      if (current !== null) localStorage.setItem(backup, current);
      localStorage.setItem(key, encoded);
      localStorage.removeItem(temporary);
    } catch (error) {
      console.warn("[save] local write failed", error);
      this.onStorageError?.("Local Farm could not be saved. Check browser storage or export a backup.");
    }
  }

  private async push(data: Record<string, unknown>): Promise<void> {
    if (this.isOnline() && !this.onlineWritable) {
      this.presentationDirty = true;
      this.pendingPresentation = data;
      return;
    }
    if (this.pushing) { this.pendingPresentation = data; return; }
    this.pushing = true;
    this.lastPresentationCallAt = Date.now();
    const encoded = JSON.stringify(data);
    try {
      const saved = await api.putPresentationV3({ protocolVersion: GAMEPLAY_PROTOCOL, expectedVersion: this.presentationVersion, data });
      this.presentationVersion = saved.version;
      this.lastPresentation = encoded;
      this.presentationDirty = false;
    } catch (error) {
      this.presentationDirty = true;
      if (error instanceof api.ApiError && error.status === 409) {
        console.warn("[presentation] conflict; reconciling with server");
        try {
          const boot = await api.bootstrap(true);
          this.presentationVersion = boot.presentation.version;
          const authoritative = JSON.stringify(boot.presentation.data);
          if (authoritative === encoded) {
            // The original PUT committed but its response was lost. Adopt the version
            // returned by bootstrap instead of retrying the already-saved projection.
            this.lastPresentation = encoded;
            this.presentationDirty = false;
          } else {
            // A genuinely newer projection won the CAS. Rebase this write onto its
            // version; preserve any newer local presentation queued while we fetched.
            this.pendingPresentation ??= data;
            this.pendingPresentationImmediate = true;
          }
        } catch (recoveryError) {
          console.warn("[presentation] conflict recovery failed", recoveryError);
        }
      }
    } finally {
      this.pushing = false;
      const next = this.pendingPresentation;
      this.pendingPresentation = null;
      if (next) {
        this.presentationDirty = true;
        if (this.pendingPresentationImmediate) {
          this.pendingPresentationImmediate = false;
          void this.push(next);
        } else this.scheduleSave?.();
      }
    }
  }

  async load(): Promise<FarmLoadResult> {
    if (this.mode === "online") {
      if (!this.isOnline()) return { kind: "online-unavailable", reason: "not_configured" };
      try {
        const boot = await api.bootstrap();
        this.presentationVersion = boot.presentation.version;
        this.lastPresentation = JSON.stringify(boot.presentation.data);
        const snapshot = this.fromBootstrap(boot);
        await this.applySave(snapshot);
        try { localStorage.setItem(this.cacheKey(), this.lastPresentation); } catch { /* ignore */ }
        this.writeOnlineSnapshot(snapshot);
        const restored = Object.keys(boot.gameplay.farm.plots).length > 0 ||
          boot.gameplay.objects.objects.length > 0 || boot.gameplay.roster.length > 0;
        return { kind: "online-authoritative", restored };
      } catch (error) {
        console.warn("[bootstrap] authoritative load failed; trying cached snapshot", error);
        const cached = await this.loadOnlineSnapshot();
        return cached ?? {
          kind: "online-unavailable",
          reason: error instanceof api.ApiError ? error.code : "error",
        };
      }
    }
    return this.loadLocal();
  }

  private writeOnlineSnapshot(snapshot: SaveGame): void {
    const key = this.snapshotKey();
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(snapshot)); } catch { /* read-only cache is optional */ }
  }

  /** Refresh the disconnected-view snapshot only after the economy client confirms
   * there are no optimistic commands layered over the authoritative projection. */
  cacheAuthoritativeSnapshot(serverTime = Date.now()): void {
    if (this.mode !== "online" || !this.isOnline()) return;
    const snapshot = this.serialize();
    snapshot.savedAt = serverTime;
    this.writeOnlineSnapshot(snapshot);
  }

  private async loadOnlineSnapshot(): Promise<FarmLoadResult | null> {
    const key = this.snapshotKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const snapshot = JSON.parse(raw) as SaveGame;
      if (snapshot.version !== SAVE_VERSION) return null;
      await this.applySave(snapshot, false);
      return { kind: "online-cached", savedAt: snapshot.savedAt };
    } catch {
      return null;
    }
  }

  private fromBootstrap(boot: Awaited<ReturnType<typeof api.bootstrap>>): SaveGame {
    const p = boot.presentation.data as PresentationData;
    const clientTime = Date.now();
    this.objectLayouts = new Map((p.objectLayout ?? []).map((layout) => [layout.id, { ...layout }]));
    const objectLayout = new Map((p.objectLayout ?? []).map((o) => [o.id, o]));
    const rosterLayout = new Map((p.rosterLayout ?? []).map((u) => [u.id, u]));
    // The graveyard is server-owned (fallen_v3), so the presentation blob's copy —
    // written by clients before that table existed — is deliberately ignored.
    //
    // Split into the zombies standing on a statue and those still waiting for one
    // BEFORE either is capped. MAX_REMEMBERED_FALLEN bounds the graveyard, which is
    // the unenshrined list alone; capping the combined list instead dropped whichever
    // records were oldest, and an occupant is exactly the record most likely to be old
    // — so a statue bought to remember a long-ago loss came back as a bare plinth once
    // sixty more zombies had died behind it, and re-enshrining it was then refused by
    // the server as `statue_occupied`.
    const projected = boot.gameplay.fallen ?? [];
    const enshrinedIds = new Map(projected
      .filter((unit) => !!unit.memorialObjectId)
      .map((unit) => [unit.id, unit.memorialObjectId!]));
    const enshrined = new Map(sanitizeFallenUncapped(
      projected.filter((unit) => enshrinedIds.has(unit.id))
    ).flatMap((unit) => {
      const objectId = enshrinedIds.get(unit.id);
      return objectId ? [[objectId, unit] as const] : [];
    }));
    const graveyard = sanitizeFallen(projected.filter((unit) => !enshrinedIds.has(unit.id)));
    const plots = Object.entries(boot.gameplay.farm.plots).map(([key, plot]) => {
      const [oc, or] = key.split(":").map(Number);
      if (plot.state === "plowed") return { oc, or, state: "plowed" as const };
      if (plot.state === "spent") return { oc, or, state: plot.zombie ? "hole" as const : "dirt" as const };
      return { oc, or, state: "planted" as const, crop: {
        key: plot.cropKey, isZombie: plot.zombie,
        plantedAt: serverTimestampToClient(plot.plantedAt, boot.serverTime, clientTime),
        growMs: plot.growMs, fertilized: plot.fertilized,
      } };
    });
    const objects = boot.gameplay.objects.objects.flatMap((obj) => {
      if (obj.status !== "placed") return [];
      const layout = objectLayout.get(obj.instanceId);
      // A placed object with no saved position must NOT be fabricated onto (0,0). Every
      // such object used to land on that one tile, where the first won and
      // Field.restoreObjects silently discarded the rest — and the next presentation,
      // written from the field, made the loss permanent. Leave it out here; the object
      // reconcile treats it as an orphan and re-homes it onto a real free tile.
      if (!layout) return [];
      return [{ id: obj.instanceId, key: obj.catalogKey, oc: layout.oc, or: layout.or,
        rotation: layout.rotation, memorial: enshrined.get(obj.instanceId), readyAt: obj.readyAt == null
          ? undefined
          : serverTimestampToClient(obj.readyAt, boot.serverTime, clientTime) }];
    });
    for (const layout of objectLayout.values()) {
      if (layout.key === "storage01" && !objects.some((object) => object.id === layout.id)) {
        objects.push({ id: layout.id, key: layout.key, oc: layout.oc, or: layout.or,
          rotation: layout.rotation, memorial: layout.memorial, readyAt: undefined });
      }
    }
    const pots = Object.fromEntries(Object.entries(p.zombiePots ?? {}).filter(([, pot]) =>
      !!pot?.parentAId && !!pot.parentBId
    ));
    const legacyPot = p.zombiePot?.parentAId && p.zombiePot.parentBId ? p.zombiePot : undefined;
    // The legacy single-pot field is only carried forward when there are no keyed jobs
    // (see the fields below). Deriving `hidden` from the jobs actually KEPT matters:
    // hiding the parents of a job that is then discarded strands those two zombies —
    // no Pot holds them and nothing puts them back in the roster.
    const pot = Object.keys(pots).length ? undefined : legacyPot;
    const hiddenPotParents = new Set(
      [...Object.values(pots), ...(pot ? [pot] : [])].flatMap((job) =>
        job.parentAId && job.parentBId ? [job.parentAId, job.parentBId] : []
      )
    );
    const roster = boot.gameplay.roster.filter((unit) => !hiddenPotParents.has(unit.id)).map((unit) => {
      const layout = rosterLayout.get(unit.id);
      return { id: unit.id, key: unit.key, name: layout?.name, mutation: unit.mutation, invasions: unit.invasions,
        stored: unit.stored, pos: layout?.pos,
        // The server's tint wins over the local hint: after a Black Market trade the
        // unit arrives under a new id that no hint of ours describes, and the
        // authoritative row is the only place its colour survived.
        color: unit.color ?? layout?.color };
    });
    return {
      version: SAVE_VERSION,
      savedAt: boot.serverTime,
      player: {
        name: p.player?.name ?? "Zombie Farmer",
        ...boot.gameplay.balance,
        zombieMax: boot.gameplay.zombieMax,
        zombieCount: roster.filter((u) => !u.stored).length,
        zombiePotBought: boot.gameplay.zombiePotBought,
        farmer: p.player?.farmer,
        farmerAppearance: {
          ...p.player?.farmerAppearance,
          ownedHeads: boot.gameplay.farmerHeads,
          headId: boot.gameplay.farmerHeadId,
          // Both head slots are server-owned online, so the projection wins over
          // whatever the presentation blob remembers. `?? null` also normalizes an
          // older Worker's silence into "follow the worn head".
          bonusHeadId: boot.gameplay.farmerBonusHeadId ?? null,
        },
        petCollection: { owned: boot.gameplay.ownedPets, active: boot.gameplay.activePet, pen: boot.gameplay.penPets },
      },
      farm: { fieldId: "default", w: boot.gameplay.farmSize, h: boot.gameplay.farmSize,
        climate: p.farm?.climate ?? "grass", background: p.farm?.background,
        ownedClimates: boot.gameplay.climates, plots,
        zombiePatchGathered: p.farm?.zombiePatchGathered },
      objects,
      ownedZombies: roster,
      zombiePots: Object.keys(pots).length ? pots : undefined,
      zombiePot: pot,
      storage: {
        itemCap: 8,
        items: Object.entries(boot.gameplay.storage.stored).map(([key, count]) => ({ key, count })),
        received: Object.entries(boot.gameplay.storage.received).flatMap(([key, count]) => Array(count).fill(key)),
      },
      boosts: Object.entries(boot.gameplay.inventory).map(([key, count]) => ({ key, count })),
      quests: { active: boot.gameplay.quests.progress.map((q) => ({ id: q.questId, counts: q.counts })), completed: boot.gameplay.quests.completed },
      raids: { completed: boot.gameplay.raids.progress,
        lastRaidAt: serverTimestampToClient(boot.gameplay.raids.lastRaidAt, boot.serverTime, clientTime),
        attackOrder: p.ui?.attackOrder ?? [] },
      epicBoss: epicBossRunToClient(boot.gameplay.epicBoss, boot.serverTime, clientTime) ?? undefined,
      social: { friends: boot.social.friends.map((friend) => ({ id: friend.accountId, name: friend.name, addedAt: boot.serverTime, giftsSent: 0 })) },
      tutorial: reconcileTutorialCompletion(p.tutorial, boot.gameplay.tutorialRewarded),
      almanac: p.almanac,
      // Only the unenshrined go in the graveyard list; the rest are already standing
      // on their statues, which carry them (see `enshrined` above).
      fallen: graveyard,
      teams: sanitizeTeams(p.ui?.teams),
      farmJobs: this.readJobJournal(),
    };
  }

  private async loadLocal(): Promise<FarmLoadResult> {
    const key = this.cacheKey();
    let values: (string | null)[];
    try { values = [localStorage.getItem(key), localStorage.getItem(`${key}.backup`)]; }
    catch { return { kind: "local-unavailable", reason: "storage_unavailable" }; }
    if (!values.some((value) => value !== null)) return { kind: "local-new" };
    for (let index = 0; index < values.length; index++) {
      const raw = values[index];
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as SaveGame;
        if (data.version !== SAVE_VERSION || !data.player || !data.farm) continue;
        await this.applySave(data);
        if (index === 1) {
          try { localStorage.removeItem(key); } catch { /* keep backup usable */ }
          this.writeLocal(data);
          this.onStorageError?.("The latest Local Farm save was damaged. The previous backup was restored.");
        }
        return { kind: "local-existing" };
      } catch (error) {
        console.warn(`[save] could not restore Local Farm ${index === 0 ? "primary" : "backup"}`, error);
        // Stored bytes are not the same as a new farm. Keep both copies intact
        // and let startup offer recovery instead of overwriting them.
      }
    }
    return { kind: "local-unavailable", reason: "save_unreadable" };
  }

  private async applySave(data: SaveGame, restoreJobs = true): Promise<void> {
    this.loadedFarmBackground = data.farm.background;
    const player = data.player;
    this.state.apply({ name: player.name, gold: player.gold, brains: player.brains, xp: player.xp,
      zombieCount: player.zombieCount, zombieMax: Math.max(16, player.zombieMax || 16) });
    this.state.unlockedAbilities = player.unlockedAbilities ?? [];
    this.state.zombiePotBought = player.zombiePotBought ?? false;
    this.state.ownedFarmerHeads = player.farmerAppearance?.ownedHeads ?? [];
    this.state.ownedFarmerBodies = player.farmerAppearance?.ownedBodies ?? [];
    this.state.farmerHeadId = player.farmerAppearance?.headId ?? 1;
    this.state.farmerBodyId = player.farmerAppearance?.bodyId ?? 0;
    this.state.farmerBonusHeadId = player.farmerAppearance?.bonusHeadId ?? null;
    const legacyPets = data.storage?.pets ?? [];
    this.state.syncPetOwnership(
      player.petCollection?.owned ?? legacyPets,
      player.petCollection?.active ?? legacyPets[0] ?? null,
      player.petCollection?.pen ?? [],
    );
    if (data.storage) {
      this.state.storageItemCap = data.storage.itemCap ?? 8;
      this.state.storedItems = data.storage.items ?? [];
      this.state.received = data.storage.received ?? [];
    }
    this.state.boostInv = data.boosts ?? [];
    this.state.raidsCompleted = data.raids?.completed ?? {};
    this.state.lastRaidAt = data.raids?.lastRaidAt ?? 0;
    this.state.raidAttackOrder = data.raids?.attackOrder ?? [];
    this.state.brainDryStreak = Math.max(0, Math.trunc(data.raids?.brainDryStreak ?? 0));
    this.state.zombieDryWins = Object.fromEntries(
      Object.entries(data.raids?.zombieDryWins ?? {})
        .map(([id, wins]) => [id, Math.max(0, Math.trunc(Number(wins) || 0))])
    );
    this.state.epicBossRun = data.epicBoss ? { ...data.epicBoss, attackOrder: [...data.epicBoss.attackOrder] } : null;
    this.state.friends = (data.social?.friends ?? []).map((friend) => ({ ...friend, giftsSent: friend.giftsSent ?? 0 }));
    this.state.tutorial = data.tutorial;
    // Almanac discovery counts. A save written before the Almanac existed has
    // none — seed them from the roster it carries, so a long-running farm does
    // not open its collection to a wall of silhouettes it obviously earned.
    const discovered = sanitizeDiscovered(data.almanac?.discovered);
    this.state.zombieDiscovered = Object.keys(discovered).length
      ? discovered
      : backfillDiscovered(data.ownedZombies ?? []);
    // `received` was assigned straight onto the state above, so the reward zombies
    // parked in it have not been through receiveItem/syncStorage yet. Owned is owned:
    // count them here too, or an unclaimed prize opens the Almanac as a silhouette.
    this.state.countUnclaimedZombieRewards();
    // The graveyard. Statues carry their own occupant (restoreObjects below), so
    // this is only the zombies still waiting for one.
    this.state.fallenZombies = sanitizeFallen(data.fallen);
    // Saved line-ups. Members are NOT checked against the roster here: a team is
    // resolved when it is shown or assembled, so a zombie that is missing today
    // simply sits the next assembly out (see zombie/teams.ts).
    this.state.zombieTeams = sanitizeTeams(data.teams);
    if (data.farm.w && data.farm.h) this.field.resize(data.farm.w, data.farm.h);
    this.state.ownedClimates = data.farm.ownedClimates ?? ["grass"];
    if (!this.state.ownedClimates.includes("grass")) this.state.ownedClimates.unshift("grass");
    this.field.setClimate(data.farm.climate ?? "grass");
    this.field.restore(data.farm.plots, (key) => this.catalog.get(key));
    const objects = data.objects ?? [];
    await Promise.all(objects.flatMap((object) => {
      const def = this.placeCatalog.get(object.key);
      if (!def) return [];
      return objectSpriteFiles(def).map((file) => this.preload(file));
    }));
    this.field.restoreObjects(objects, (key) => this.placeCatalog.get(key));
    this.zombies.restore(data.ownedZombies ?? []);
    this.zombies.restoreGathered(data.farm.zombiePatchGathered, this.field.patchRestTiles());
    this.zombies.restorePots(data.zombiePots, data.zombiePot);
    const epicRun = this.state.epicBossRun;
    const epicDef = epicBossById(epicRun?.bossId);
    const epicActive = !!epicRun && !epicRun.completedAt && Date.now() < epicRun.expiresAt;
    this.quests.setEpicBossActive(epicActive, epicActive ? epicDef?.questIds ?? [] : []);
    this.quests.restore(data.quests);
    // Offline only — online this is a no-op and the server's projection installs the
    // real sets. A missing field (an older save, or any online save) generates a
    // fresh board for today rather than leaving the panel empty.
    this.periodicQuests?.restore(data.periodicQuests);
    // restorePending uses the same current-field validation as a fresh tap, so an
    // online intent whose command already committed is safely discarded here.
    if (restoreJobs) {
      if (this.mode === "online") this.pendingOnlineJobs = data.farmJobs;
      else this.jobs?.restorePending(data.farmJobs, (key) => this.catalog.get(key));
    }
    if (player.farmer) this.walk.teleport(player.farmer.col, player.farmer.row);
  }

  async hydrateReadOnly(save: SaveGame): Promise<void> { await this.applySave(save, false); }
  exportLocal(): string | null {
    if (this.mode !== "local") return null;
    try { return localStorage.getItem(this.cacheKey()); } catch { return null; }
  }

  /** Build a portable full save from an Online Farm, for the same "download a copy"
   * flow Local Farm has. Online keeps no full blob on the device (only presentation),
   * so the file is serialised from live in-memory state — which IS the server's,
   * hydrated at bootstrap and kept reconciled by the command queue. The result is an
   * ordinary SaveGame, so the only thing that can ingest it is Local Farm's Import
   * (importLocal refuses every other mode); nothing here can travel back online.
   * Account-scoped fields are dropped rather than translated:
   *   - social: online friendships live on the server, and the local list is the
   *     offline stub — carrying account friends over would fabricate local ones.
   *   - farmJobs: unfinished farmer intents whose commands may already have committed
   *     server-side. Replaying them on the copy would repeat their effect for free.
   *   - zombiePots[].reserved: records a SERVER-held parent reservation. Only the
   *     online reconciler reads it, and it marks a job for retirement when no
   *     authoritative reservation backs it — which is every job, once local. */
  exportOnline(): string | null {
    if (this.mode !== "online") return null;
    try {
      const { social: _social, farmJobs: _farmJobs, ...blob } = this.serialize();
      if (blob.zombiePots) {
        const pots: NonNullable<SaveGame["zombiePots"]> = {};
        for (const [id, job] of Object.entries(blob.zombiePots)) {
          const { reserved: _reserved, ...rest } = job;
          pots[id] = rest;
        }
        blob.zombiePots = pots;
      }
      return JSON.stringify(blob);
    } catch {
      return null;
    }
  }

  importLocal(raw: string): boolean {
    if (this.mode !== "local") return false;
    try {
      const data = JSON.parse(raw) as SaveGame;
      if (data.version !== SAVE_VERSION || !data.player || !data.farm) return false;
      this.writeLocal(data);
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    const key = this.cacheKey();
    try {
      localStorage.removeItem(key);
      if (this.mode === "local") {
        localStorage.removeItem(`${key}.backup`);
        localStorage.removeItem(`${key}.tmp`);
      }
    } catch { /* ignore */ }
  }

  enableAutosave(localMs = 250, remoteMs = 60_000): void {
    let localTimer = 0;
    let remoteTimer = 0;
    let dirtySince = 0;
    const flushLocal = () => {
      if (this.suspended) return;
      if (this.mode === "online") {
        if (!this.isOnline()) return;
        try { localStorage.setItem(this.cacheKey(), JSON.stringify(this.presentation())); } catch { /* ignore */ }
      } else this.writeLocal(this.serialize());
    };
    const fireRemote = () => { remoteTimer = 0; dirtySince = 0; this.commitPresentation(); };
    const schedule = () => {
      const encoded = JSON.stringify(this.presentation());
      if (this.mode === "online" && encoded === this.lastPresentation) return;
      clearTimeout(localTimer);
      localTimer = window.setTimeout(flushLocal, localMs);
      if (this.mode !== "online" || !this.isOnline()) return;
      if (!dirtySince) dirtySince = Date.now();
      if (!remoteTimer) {
        const sinceDirty = remoteMs - (Date.now() - dirtySince);
        const sinceCall = remoteMs - (Date.now() - this.lastPresentationCallAt);
        remoteTimer = window.setTimeout(fireRemote, Math.max(0, sinceDirty, sinceCall));
      }
    };
    this.scheduleSave = schedule;
    this.autoFlush = () => {
      clearTimeout(localTimer);
      clearTimeout(remoteTimer);
      remoteTimer = 0;
      flushLocal();
      const remaining = remoteMs - (Date.now() - this.lastPresentationCallAt);
      if (remaining <= 0) {
        dirtySince = 0;
        this.commitPresentation();
      } else {
        if (!dirtySince) dirtySince = Date.now();
        remoteTimer = window.setTimeout(fireRemote, remaining);
      }
    };
    this.state.onChange(schedule);
    window.addEventListener("beforeunload", () => this.autoFlush?.());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") this.autoFlush?.(); });
    window.addEventListener("online", () => { if (this.presentationDirty) void this.push(this.presentation()); });
  }
}
