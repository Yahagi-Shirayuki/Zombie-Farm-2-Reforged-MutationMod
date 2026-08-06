// Planned-closedown switch for the beta -> full-release window.
//
// Why D1 and not a Worker var: the operator's admin console holds a Cloudflare token
// scoped to D1 read/write only, so it can flip a row but cannot edit Worker vars or
// deploy. `MUTATIONS_DISABLED` stays the incident lever (needs a deploy, and still
// wins over anything here); this is the planned lever that does not.
//
// Failure policy is FAIL OPEN. A missing table (a Worker deployed ahead of migration
// 0042) or a transient D1 error must never lock the entire player base out of a
// service that is actually running — the far more likely mistake of the two.

/** What the service currently permits. Each mode is a superset of restrictions of
 *  the one before it. */
export type ServiceMode =
  /** Normal service. */
  | "open"
  /** Existing accounts play as usual; `/auth` refuses to create new ones. */
  | "signups_closed"
  /** Existing accounts sign in and read their farm so the client can move it to
   *  Local Farm. Every gameplay mutation is refused. No new accounts. */
  | "export_only"
  /** No sign-in at all. Existing sessions can no longer reach gameplay either. */
  | "closed";

export const SERVICE_MODES: readonly ServiceMode[] = [
  "open",
  "signups_closed",
  "export_only",
  "closed",
];

export interface ServiceState {
  mode: ServiceMode;
  /** Operator-authored line shown on the client's start screen. Null = use the
   *  client's built-in copy for the mode. */
  notice: string | null;
  updatedAt: number;
}

export const OPEN_SERVICE: ServiceState = { mode: "open", notice: null, updatedAt: 0 };

export function isServiceMode(value: unknown): value is ServiceMode {
  return typeof value === "string" && (SERVICE_MODES as readonly string[]).includes(value);
}

/** Sign-in (and therefore any authenticated read) is possible. */
export const signInAllowed = (state: ServiceState): boolean => state.mode !== "closed";

/** `/auth` may create an account that does not exist yet. */
export const signupsAllowed = (state: ServiceState): boolean => state.mode === "open";

/** Gameplay mutations (commands, presentation, raid, Epic Boss, Black Market) run. */
export const mutationsAllowed = (state: ServiceState): boolean =>
  state.mode === "open" || state.mode === "signups_closed";

// One D1 read per isolate per window, not per request. The flip therefore takes
// effect within this window everywhere, which is the right trade for a planned
// closedown against a read on every authenticated mutation.
const CACHE_TTL_MS = 30_000;
let cached: { at: number; state: ServiceState } | null = null;

/** Drop the memo. Tests only — a live Worker relies on the TTL. */
export function resetServiceStateCache(): void {
  cached = null;
}

interface ServiceStateRow {
  mode: string | null;
  notice: string | null;
  updated_at: number | null;
}

export async function readServiceState(
  db: D1Database,
  now: number = Date.now()
): Promise<ServiceState> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.state;
  let state = OPEN_SERVICE;
  try {
    const row = await db
      .prepare("SELECT mode, notice, updated_at FROM service_state WHERE id = 1")
      .first<ServiceStateRow>();
    if (row && isServiceMode(row.mode)) {
      state = {
        mode: row.mode,
        notice: row.notice && row.notice.trim() ? row.notice : null,
        updatedAt: Number(row.updated_at ?? 0),
      };
    }
  } catch {
    // Pre-migration deploy or a D1 blip: serve normally (see the fail-open note above).
    state = OPEN_SERVICE;
  }
  cached = { at: now, state };
  return state;
}
