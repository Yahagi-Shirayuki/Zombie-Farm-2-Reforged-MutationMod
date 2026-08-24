// The client half of daily / weekly quests.
//
// It runs in one of two modes, chosen once at construction from whether this build
// talks to a server at all:
//
//   OFFLINE (`authoritative: false`) — this system IS the authority. It generates the
//     sets, counts game events off the quest bus, pays the XP on claim, and persists
//     everything in the save. Exactly the same generator the server uses, so the two
//     builds agree about what a Tuesday looks like.
//
//   ONLINE (`authoritative: true`) — the server owns all of it. Bus events are ignored
//     outright (the server counts the commands they came from), the state is whatever
//     the last projection said, and a claim is a command whose result arrives as a new
//     projection. Progress is NOT previewed optimistically the way catalog quests are:
//     these counts arrive with the very next batch response, and a preview that ran
//     ahead of the server could offer a Claim button for a reward the server would
//     then refuse.

import type { GameState } from "../../GameState";
import { XP_THRESHOLDS } from "../../GameState";
import { QuestBus } from "../events";
import {
  applyPeriodicEvents, claimPeriodicQuest, claimablePeriodicCount, periodicViews,
  refreshPeriodicState, xpToNextLevel,
} from "./generate";
import { periodEndsAt } from "./periods";
import {
  emptyPeriodicState, type PeriodicQuestState, type PeriodicScope, type PeriodicScopeState,
  type PeriodicScopeView,
} from "./types";

export interface PeriodicQuestHooks {
  /** True when a server owns the state (see the mode note above). */
  authoritative?: boolean;
  /** Online only: send the claim. The XP arrives with the server's next projection. */
  /** Return true only when the authoritative command entered the durable queue. */
  submitClaim?: (scope: PeriodicScope, questId: string, xp: number) => boolean;
  /** Celebrate a paid-out claim. */
  claimed?: (text: string, xp: number) => void;
  /** Push the current panel state to the HUD. */
  render: (views: PeriodicScopeView[]) => void;
}

/** The account identity the roll is seeded with. Offline there is no account, so the
 *  local profile's own id stands in — it just has to be stable for one save. */
export type PeriodicIdentity = () => string;

export class PeriodicQuestSystem {
  private state: PeriodicQuestState = emptyPeriodicState();
  /** Set once the online projection has been received, so an online client does not
   *  briefly draw a locally-generated board before the server's arrives. */
  private adopted = false;

  constructor(
    private gameState: GameState,
    private identity: PeriodicIdentity,
    bus: QuestBus,
    private hooks: PeriodicQuestHooks
  ) {
    if (!this.hooks.authoritative) {
      bus.subscribe((nid, object, _n, aliases) => {
        // Roll the day over first: the event that arrives after midnight belongs to the
        // NEW day's board, not to the expired one it would otherwise be counted against.
        const rolled = this.refresh();
        // One event advances a quest by one, matching the server engine — `n` is
        // deliberately ignored so a bulk post cannot outpace the authoritative count.
        const advanced = applyPeriodicEvents(this.state, [{ type: nid, subject: object, aliases }]);
        if (rolled || advanced) this.hooks.render(this.views());
      });
      // A level-up can unlock a scope outright (daily at 5, weekly at 15).
      this.gameState.onChange(() => {
        if (this.refresh()) this.hooks.render(this.views());
      });
    }
  }

  /** Roll the sets forward to now. Offline this generates; online it only advances the
   *  clock the panel's countdown reads, since the server owns the sets. */
  refresh(now = Date.now()): boolean {
    if (this.hooks.authoritative) return false;
    const level = this.gameState.level;
    return refreshPeriodicState(this.state, {
      accountId: this.identity(),
      level,
      xpToNext: xpToNextLevel(level, XP_THRESHOLDS),
      now,
    });
  }

  /** Online: install the server's authoritative sets. */
  adoptAuthoritative(state: { daily: PeriodicScopeState | null; weekly: PeriodicScopeState | null } | null): void {
    if (!this.hooks.authoritative) return;
    this.adopted = true;
    this.state = state ? { daily: state.daily, weekly: state.weekly } : emptyPeriodicState();
    this.hooks.render(this.views());
  }

  /** Collect a finished quest.
   *
   *  Offline this pays immediately. Online it only SENDS — the XP and the claimed flag
   *  both come back from the server, because a claim can legitimately be refused (the
   *  period rolled over between the panel rendering and the button being pressed). */
  claim(scope: PeriodicScope, questId: string): void {
    const set = this.state[scope];
    if (!set) return;
    const index = set.quests.findIndex((quest) => quest.id === questId);
    if (index < 0) return;
    const quest = set.quests[index];
    if ((set.counts[index] ?? 0) < quest.countTotal || set.claimed.includes(questId)) return;

    if (this.hooks.authoritative) {
      if (!this.hooks.submitClaim?.(scope, questId, quest.xp)) return;
      // Mark it locally so a double-tap cannot post the claim twice while the round
      // trip is in flight. Only do this after enqueue succeeds: otherwise there is no
      // future projection guaranteed to undo the local latch.
      set.claimed = [...set.claimed, questId];
      this.hooks.render(this.views());
      return;
    }
    const result = claimPeriodicQuest(this.state, scope, questId);
    if (!result.ok) return;
    this.gameState.addXp(result.xp);
    this.hooks.claimed?.(result.quest.text, result.xp);
    this.hooks.render(this.views());
  }

  views(now = Date.now()): PeriodicScopeView[] {
    if (this.hooks.authoritative && !this.adopted) return [];
    return periodicViews(this.state, now);
  }

  /** How many finished quests are waiting to be collected — the HUD's badge. */
  get claimable(): number {
    return claimablePeriodicCount(this.state);
  }

  /** When the soonest period rolls over, so the HUD knows when to redraw. */
  nextRolloverAt(now = Date.now()): number {
    const ends: number[] = [];
    if (this.state.daily) ends.push(periodEndsAt("daily", now));
    if (this.state.weekly) ends.push(periodEndsAt("weekly", now));
    return ends.length ? Math.min(...ends) : Number.POSITIVE_INFINITY;
  }

  // ---- persistence (offline only; online state is never saved, it is projected) ----

  serialize(): PeriodicQuestState | undefined {
    if (this.hooks.authoritative) return undefined;
    return this.state;
  }

  restore(save?: PeriodicQuestState | null): void {
    if (!this.hooks.authoritative && save) {
      this.state = { daily: save.daily ?? null, weekly: save.weekly ?? null };
    }
    this.refresh();
    this.hooks.render(this.views());
  }
}
