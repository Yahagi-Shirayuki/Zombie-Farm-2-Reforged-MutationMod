/** Wire contract for the authoritative gameplay protocol. Keep this module free of
 * browser and Worker dependencies so both sides compile against the same shapes. */
export const GAMEPLAY_PROTOCOL = 3 as const;
export const CLIENT_INTEGRITY_VERSION = 5 as const;
export const COMMAND_BATCH_LIMIT = 64;
// Mutations coalesce into one /commands POST per window. Widened from 10s to 30s to
// cut request volume while actively farming (~3x fewer batches). Safe because the
// outbox is durable in localStorage with idempotent batchId replay, dependent
// actions (raids/spends) force an immediate flush via settle(), and the queue also
// flushes on beforeunload / visibilitychange:hidden.
export const COMMAND_BATCH_WINDOW_MS = 30_000;
export const PRESENTATION_WINDOW_MS = 60_000;

export type CommandStatus = "applied" | "duplicate" | "rejected" | "dependency_failed";

export interface CommandResult {
  sequence: number;
  status: CommandStatus;
  error?: string;
  createdIds?: string[];
  /** Source plots for zombies created by a farm/power command. This avoids pairing
   * bulk-harvest identities by two different iteration orders. */
  createdZombieSources?: { id: string; oc: number; or: number }[];
}

export type GameplayCommand =
  | { type: "writer.claim" }
  | { type: "farm.plow"; oc: number; or: number }
  | { type: "farm.plant"; oc: number; or: number; cropKey: string; fertilized?: boolean }
  | { type: "farm.harvest"; oc: number; or: number }
  | { type: "farm.remove"; oc: number; or: number }
  /** Relocate a plot and whatever is growing on it. Layout only — the crop,
   *  its timers and its value are carried across untouched. */
  | { type: "farm.move"; oc: number; or: number; toOc: number; toOr: number }
  | { type: "power.buy"; key: string }
  | { type: "power.use"; key: string; oc?: number; or?: number; target?: "zombie_pot" }
  | { type: "object.buy"; catalogKey: string; clientInstanceId?: string }
  | { type: "object.refund"; instanceId: string }
  | { type: "object.upgrade"; instanceId: string; catalogKey: string }
  | { type: "object.status"; instanceId: string; status: "placed" | "stored" }
  | { type: "object.harvest_trees"; instanceIds: string[] }
  | { type: "storage.claim"; itemName: string; clientInstanceId?: string }
  | { type: "storage.move"; itemKey: string; direction: "store" | "take"; quantity: number }
  | { type: "roster.sell"; unitId: string }
  | { type: "roster.status"; unitId: string; stored: boolean }
  | { type: "roster.combine_start"; potId: string; parentAId: string; parentBId: string; playerLevel?: number }
  | { type: "roster.combine"; potId?: string; parentAId: string; parentBId: string; playerLevel?: number }
  | { type: "shop.size"; size: number; currency: "gold" | "brains" }
  | { type: "shop.climate"; terrain: string }
  | { type: "farmer.buy"; headId: number }
  | { type: "farmer.equip"; headId: number }
  /** Pin the head supplying bonuses; null hands the job back to the worn head. */
  | { type: "farmer.bonus"; headId: number | null }
  | { type: "pet.buy"; petKey: string }
  | { type: "pet.equip"; petKey: string | null }
  | { type: "pet.pen"; petKeys: string[] }
  | { type: "tutorial.complete" };

export interface SequencedCommand {
  sequence: number;
  command: GameplayCommand;
}

export interface CommandBatchRequest {
  protocolVersion: typeof GAMEPLAY_PROTOCOL;
  deviceId: string;
  batchId: string;
  firstSequence: number;
  expectedAccountVersion: number;
  writerGeneration: number;
  takeWriter?: boolean;
  commands: SequencedCommand[];
}

export interface BalanceProjection {
  gold: number;
  brains: number;
  xp: number;
}

export type FarmPlotProjection =
  | { state: "plowed" }
  | { state: "spent"; zombie?: boolean }
  | {
      state: "planted";
      cropKey: string;
      plantedAt: number;
      growMs: number;
      sell: number;
      xp: number;
      fertilized: boolean;
      zombie: boolean;
    };

export interface FarmDocumentProjection {
  version: number;
  plots: Record<string, FarmPlotProjection>;
}

export interface FunctionalObjectProjection {
  instanceId: string;
  catalogKey: string;
  status: "placed" | "stored";
  readyAt?: number;
  purchaseCost?: number;
  purchaseCurrency?: "gold" | "brains";
}

export interface ObjectDocumentProjection {
  version: number;
  objects: FunctionalObjectProjection[];
}

export interface QuestProjection {
  version: number;
  completed: string[];
  progress: { questId: string; counts: number[] }[];
}

export interface EpicBossProjection {
  runId: string;
  bossId: string;
  activatedAt: number;
  expiresAt: number;
  level: number;
  maxHp: number;
  currentHp: number;
  encounterStartedAt: number;
  retryReadyAt: number;
  /** Harvested attempts for this run. Cleared when the event ends or is replaced. */
  tokenCount: number;
  completedAt: number;
  attackOrder: string[];
}

export interface RosterUnitProjection {
  id: string;
  key: string;
  mutation: number;
  invasions: number;
  stored: boolean;
  lockedByRaid?: string;
  /** True when the unit is the player's OWN zombie coming back out of Black Market
   *  escrow (they cancelled their sale). It arrives under a new server unit id, so
   *  without this the client would read it as a first-time arrival and credit the
   *  Zombie Almanac again. Absent on every other unit — and on an older Worker,
   *  where the client simply keeps the pre-fix behaviour. */
  restored?: boolean;
}

export interface GameplayProjection {
  balance: BalanceProjection;
  farm: FarmDocumentProjection;
  objects: ObjectDocumentProjection;
  quests: QuestProjection;
  inventory: Record<string, number>;
  storage: { received: Record<string, number>; stored: Record<string, number> };
  roster: RosterUnitProjection[];
  farmSize: number;
  climates: string[];
  farmerHeads: number[];
  /** The head worn: appearance only, and the face friends see beside the name. */
  farmerHeadId: number;
  /** The head whose bonus is pinned, or null to follow the worn one. Absent from a
   *  Worker that predates the split — clients read that as null. */
  farmerBonusHeadId?: number | null;
  ownedPets: string[];
  activePet: string | null;
  penPets: string[];
  zombieMax: number;
  /** Permanent dynamic-pricing flag: first Zombie Pot is gold, later Pots are brains. */
  zombiePotBought?: boolean;
  tutorialRewarded: boolean;
  /** Per running Zombie Pot, the parent id that went into SLOT 1 — the slot that decides
   *  the result species. Recorded when the combine starts because the collect command
   *  arrives an hour later from a client that may have rebuilt its job from the roster,
   *  which is ordered by creation and so cannot be read as slot order. Server-owned:
   *  entries appear on `roster.combine_start` and are dropped on `roster.combine`. */
  potSlots?: Record<string, string>;
  raids: { progress: Record<string, number>; lastRaidAt: number };
  raidRevival?: {
    sessionId: string;
    zombies: { id: string; key: string; mutation: number; invasions: number; stored: boolean }[];
    costPerZombie: 1;
  } | null;
  epicBoss?: EpicBossProjection | null;
}

export interface PresentationProjection {
  version: number;
  data: Record<string, unknown>;
}

export interface SocialBootstrap {
  friends: { accountId: string; name: string; friendCode: string }[];
  incomingRequestCount: number;
  inboxCount: number;
}

/** How recently a friend played, at the only resolution the server discloses to them.
 *  Deliberately coarse — the raw last-online instant never leaves the server. */
export type FriendActivity = "today" | "week" | "away";

/** Online gift economy, mirroring server/src/db.ts. There is no ceiling on gifts per
 *  day — gold is the only brake, and the per-recipient rules (once a day, and not
 *  while they hold an unopened one from you) are enforced server-side. These live
 *  here only so the client can quote a cost before sending (the "Gift all"
 *  confirmation). server/test/logic.test.ts asserts the two copies stay equal. */
export const FREE_DAILY_GIFTS = 2;
export const GIFT_GOLD_COST = 100;
export const GIFT_XP_REWARD = 5;

/** Friends per account, mirroring server/src/db.ts. The cap bounds ACCEPTING, not
 *  receiving — requests keep arriving at a full list and wait in the inbox — so the
 *  client needs the number only to explain a refused accept. */
export const MAX_FRIENDS = 50;

/** What opening a friend's gift paid out. The contents are rolled by the server when
 *  the gift is SENT and stored on it, so nothing the recipient does can change them —
 *  the one exception is the first gift opened each day, which is always a brain. The
 *  inbox deliberately does not carry this: the box stays closed until it is claimed. */
export interface GiftReward {
  kind: "brain" | "gold";
  amount: number;
}

export interface ResumableRaidProjection {
  sessionId: string;
  raidId: string;
  startedAt: number;
  expiresAt: number;
  earliestFinishAt: number;
  rosterIds: string[];
}

export interface BootstrapResponse {
  protocolVersion: typeof GAMEPLAY_PROTOCOL;
  serverTime: number;
  minimumProtocolVersion: number;
  /** The Worker's `RAID_RULESET_VERSION`. The client compares this against its own
   *  constant at boot: a mismatch means this tab's JS predates (or postdates) the
   *  deployed Worker, so `/raid/start` would reject every launch with
   *  `426 stale_ruleset`. Surfacing it here lets the client prompt a reload up front
   *  instead of failing at the Invade button. */
  raidRulesetVersion: number;
  mutationsEnabled: boolean;
  accountVersion: number;
  writerGeneration: number;
  writerDeviceId: string | null;
  writer: {
    status: "free" | "mine" | "other";
    generation: number;
    lastActivityAt: number;
  };
  gameplay: GameplayProjection;
  presentation: PresentationProjection;
  social: SocialBootstrap;
  resumableRaid: ResumableRaidProjection | null;
}

export interface CommandBatchResponse {
  protocolVersion: typeof GAMEPLAY_PROTOCOL;
  batchId: string;
  accountVersion: number;
  writerGeneration: number;
  serverTime: number;
  results: CommandResult[];
  gameplay: GameplayProjection;
  farmVersionBefore: number;
  farmVersionAfter: number;
  netDelta: BalanceProjection;
  questChanges: { questId: string; counts: number[]; completed: boolean }[];
  createdZombieIds: string[];
}

export interface PresentationRequest {
  protocolVersion: typeof GAMEPLAY_PROTOCOL;
  expectedVersion: number;
  data: Record<string, unknown>;
}

export type BlackMarketOrderKind = "BUY_ZOMBIE" | "SELL_ZOMBIE";
export type BlackMarketOrderStatus = "OPEN" | "FULFILLED" | "CANCELLED";

export interface BlackMarketOrderView {
  id: string;
  kind: BlackMarketOrderKind;
  zombieKey: string;
  mutated: boolean;
  /** Mutation-choice mask requested by a BUY_ZOMBIE order. Bits within one body
   * slot are OR alternatives; requirements across different slots are ANDed. */
  mutationRequired?: number;
  mutation?: number;
  invasions?: number;
  priceBrains: number;
  status: BlackMarketOrderStatus;
  createdAt: number;
  creatorName: string;
  mine: boolean;
}

export interface BlackMarketSummary {
  activePosts: number;
  postsToday: number;
  activeLimit: 10;
  dailyLimit: 50;
  serverTime: number;
}

export interface BlackMarketListResponse {
  orders: BlackMarketOrderView[];
  nextCursor: string | null;
  summary: BlackMarketSummary;
}

export interface BlackMarketMutationResponse {
  ok: true;
  order: BlackMarketOrderView;
  summary: BlackMarketSummary;
}

/** One of the caller's own orders that a counterparty fulfilled and the caller
 * has not yet collected (acknowledged). The trade itself already settled —
 * brains/zombie landed the moment it was fulfilled — so collecting only
 * dismisses the notice. */
export interface BlackMarketFulfillmentView {
  id: string;
  kind: BlackMarketOrderKind;
  zombieKey: string;
  mutated: boolean;
  /** The traded unit's details — the sale's escrowed zombie, or the one delivered
   * for a filled request. Absent only on trades that predate delivered-unit
   * recording (migration 0033). */
  mutation?: number;
  invasions?: number;
  priceBrains: number;
  createdAt: number;
  fulfilledAt: number;
  /** Display name of the OTHER player in the trade, whichever side the viewer is on. */
  fulfilledBy: string;
  /** This card owes the viewer the traded zombie: the trade settled, but the unit
   *  waits on the order until they collect it. Collecting is what mints it, and it is
   *  refused while their farm and Mausoleum are both full. Absent on the pure
   *  brains-earned card an older Worker is the only source of. */
  awaitingClaim?: boolean;
}

export interface BlackMarketFulfillmentsResponse {
  fulfillments: BlackMarketFulfillmentView[];
}

/** A zombie that a collect just minted into the caller's roster. */
export interface ClaimedUnit {
  unitId: string;
  zombieKey: string;
  mutation: number;
  invasions: number;
  /** True when the army was full and it went to the Mausoleum instead. */
  stored: boolean;
}

export interface BlackMarketCollectResponse {
  ok: true;
  alreadyCollected: boolean;
  /** Set when this collect took delivery of a zombie, so the client knows to refresh
   *  its authoritative roster (and can say where the unit landed). */
  claimed?: ClaimedUnit;
  /** The account's authoritative balance, echoed so collecting shows the brains the
   *  trade already paid. Settlement credits them when the OTHER player fulfils the
   *  order, so without this the creator's client keeps a stale balance until its next
   *  bootstrap or command batch. Optional: an older deployed Worker omits it, and the
   *  client falls back to an explicit refresh. */
  balance?: BalanceProjection;
}

/** One completed trade from the caller's perspective (they were creator OR
 * fulfiller of the order). */
export interface BlackMarketHistoryEntry {
  id: string;
  kind: BlackMarketOrderKind;
  /** True when the caller created the post; false when they fulfilled it. */
  mine: boolean;
  /** True when the caller received the brains (they sold a zombie either via
   * their own sale post or by filling someone's request). */
  earned: boolean;
  zombieKey: string;
  /** The delivered unit's mutation mask. Null on filled requests that predate
   * delivered-unit recording (migration 0033). */
  mutation: number | null;
  invasions: number;
  priceBrains: number;
  /** Display name of the other party in the trade. */
  counterparty: string;
  fulfilledAt: number;
}

/** Lifetime aggregates over ALL of the caller's completed trades (not just the
 * page of entries returned alongside). */
export interface BlackMarketTradeStats {
  sold: {
    count: number;
    brains: number;
    best: { zombieKey: string; priceBrains: number; mutation: number | null } | null;
  };
  bought: { count: number; brains: number };
  mostTraded: { zombieKey: string; count: number } | null;
}

export interface BlackMarketHistoryResponse {
  stats: BlackMarketTradeStats;
  /** Most recent completed trades, newest first (capped server-side). */
  entries: BlackMarketHistoryEntry[];
}
