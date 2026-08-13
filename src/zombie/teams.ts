// ---------------------------------------------------------------------------
// Zombie teams ? saved farm line-ups
// ---------------------------------------------------------------------------
// A team is nothing but a NAME and an ORDERED list of owned zombie ids: "Garden
// Crew", "Raid Squad", "Circus team". Assembling one puts exactly those zombies
// on the farm and sends everyone else to the Mausoleum, so the player can swap a
// fertilizing garden line-up for a fighting one in a single tap instead of
// storing a dozen zombies by hand.
//
// Teams grant NOTHING. They own no stats, no bonuses and no server state ? every
// move an assembly makes is an ordinary store/deploy that goes through the same
// authoritative path the Mausoleum's own buttons use. That is deliberate: it
// keeps the whole feature client-side presentation data (see SaveManager's
// `ui.teams`), so a team can never be a route to a zombie the account does not
// own or a farm slot it has not earned.
//
// Membership is deliberately NOT pruned when a zombie leaves the roster. A team
// is read against the live roster every time it is shown or assembled, and
// missing members are simply skipped ? "assemble what is left of it". Pruning
// would be actively dangerous: online, the roster is empty for the moment
// between boot and the first authoritative projection, and a prune in that
// window would quietly delete every team the player owns.
import { MAX_ZOMBIE_NAME_LENGTH } from "./types";

/** How many teams one farm may keep. Small on purpose: teams are line-ups, not
 *  a filing system, and the list is meant to stay readable at a glance. */
export const MAX_TEAMS = 8;
/** Team names share the zombie-name budget so the two read alike in panels. */
export const MAX_TEAM_NAME_LENGTH = MAX_ZOMBIE_NAME_LENGTH;
/** Hard cap on stored member ids. The army cap (20) is the real limit; this is
 *  only the sanitizer's bound so a hand-edited blob cannot grow without end. */
export const MAX_TEAM_MEMBERS = 64;

export interface ZombieTeam {
  /** Stable local id ("t1"). Only ever used to address the team in the UI. */
  id: string;
  name: string;
  /** Owned zombie ids, FIRST FIRST: assembly order, and the attack order the
   *  Army screen restores when the team is assembled. */
  members: string[];
}

/** The roster facts an assembly needs. Anything with an id and a location. */
export interface TeamRosterUnit {
  id: string;
  stored: boolean;
}

/** Why an assembly cannot be carried out in full. See shortfallOf(). */
export type AssemblyShortfall =
  /** Everything the team asked for can happen. */
  | "none"
  /** The team has more members than the farm can field at once. */
  | "army_cap"
  /** Zombies must step aside and there is no Mausoleum to step aside INTO. */
  | "no_mausoleum"
  /** There is one, and every slot in it is taken. */
  | "mausoleum_full";

export interface TeamAssembly {
  /** Capacity-safe operation order. A deploy may need to precede the store it unlocks. */
  operations: ({ type: "deploy"; id: string } | { type: "store"; id: string })[];
  /** Ids to deploy from the Mausoleum, in the order they are to be deployed. */
  deploy: string[];
  /** Ids to take off the farm to make room for them. */
  store: string[];
  /** Members that are no longer owned (sold, lost on a raid, combined away). */
  missing: string[];
  /** Members that are owned and stored but have nowhere to land. */
  blocked: string[];
  /** Non-members that could NOT be taken off the farm, so they stay standing
   *  there alongside the team. The line-up is right but not exclusive. */
  left: string[];
  /** Members already standing on the farm before any of this runs. */
  present: string[];
  /** What stopped it, when `blocked` or `left` is non-empty. */
  shortfall: AssemblyShortfall;
}

/** What an assembly actually managed to do, counted for the player's toast. */
export interface TeamAssembleResult {
  deployed: number;
  stored: number;
  missing: number;
  blocked: number;
  /** Non-members still standing on the farm because nothing would take them. */
  left: number;
  present: number;
  shortfall: AssemblyShortfall;
}

/** Normalize a player-authored team name (same rules as a zombie's). */
export function normalizeTeamName(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return cleaned ? [...cleaned].slice(0, MAX_TEAM_NAME_LENGTH).join("") : null;
}

/** Read a persisted/`ui.teams` blob defensively: anything malformed is dropped
 *  rather than thrown, because this runs on a save the player cannot repair. */
export function sanitizeTeams(value: unknown): ZombieTeam[] {
  if (!Array.isArray(value)) return [];
  const teams: ZombieTeam[] = [];
  const usedIds = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as { id?: unknown; name?: unknown; members?: unknown };
    const id = typeof entry.id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(entry.id) ? entry.id : "";
    if (!id || usedIds.has(id)) continue;
    const name = normalizeTeamName(typeof entry.name === "string" ? entry.name : undefined);
    if (!name) continue;
    const members: string[] = [];
    for (const member of Array.isArray(entry.members) ? entry.members : []) {
      if (typeof member !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(member)) continue;
      if (members.includes(member)) continue;
      if (members.length >= MAX_TEAM_MEMBERS) break;
      members.push(member);
    }
    usedIds.add(id);
    teams.push({ id, name, members });
    if (teams.length >= MAX_TEAMS) break;
  }
  return teams;
}

/** The next free "t<n>" id for a new team. */
export function nextTeamId(teams: readonly ZombieTeam[]): string {
  let n = 1;
  const taken = new Set(teams.map((team) => team.id));
  while (taken.has(`t${n}`)) n++;
  return `t${n}`;
}

/** Rewrite member ids through an id map ? used when optimistic local ids are
 *  exchanged for the server's authoritative ones, exactly as the raid party's
 *  saved selection is (see raid/partySelection.reconcilePartySelection). Teams
 *  whose members did not move are returned unchanged. */
export function settleTeamMembers(
  teams: readonly ZombieTeam[],
  authoritativeId: (id: string) => string,
): ZombieTeam[] {
  return teams.map((team) => {
    const members: string[] = [];
    for (const member of team.members) {
      const settled = authoritativeId(member);
      if (!members.includes(settled)) members.push(settled);
    }
    return members.every((id, i) => id === team.members[i]) && members.length === team.members.length
      ? team
      : { ...team, members };
  });
}

/**
 * Work out the exact store/deploy moves that turn the current farm into `members`.
 *
 * Everyone not in the team leaves the farm and everyone in it comes back, but both
 * halves are capacity-bound: the army holds `armyCap` and the Mausoleum `cryptCap`.
 * The two constraints feed each other ? storing a non-member frees an army slot,
 * deploying a member frees a crypt slot ? so the moves are interleaved rather than
 * done in two passes. Storing goes first whenever the crypt has room, because that
 * is the move that unblocks the other one; when the crypt is full (nothing can be
 * stored) a deploy runs first to open a slot, and the loop comes back round.
 *
 * Nothing here mutates or fails: a team with sold members, a farm with no
 * Mausoleum at all, and a full crypt all produce a partial plan plus the lists
 * explaining what could not be done.
 */
export function planTeamAssembly(
  members: readonly string[],
  roster: readonly TeamRosterUnit[],
  armyCap: number,
  cryptCap: number,
): TeamAssembly {
  const owned = new Map(roster.map((unit) => [unit.id, unit]));
  const wanted: string[] = [];
  const missing: string[] = [];
  for (const id of members) {
    if (wanted.includes(id) || missing.includes(id)) continue;
    if (owned.has(id)) wanted.push(id);
    else missing.push(id);
  }
  const wantedSet = new Set(wanted);

  const present = wanted.filter((id) => !owned.get(id)!.stored);
  // Non-members in roster order ? the order they were listed in is as good as any,
  // and it keeps a re-assembly of the same team deterministic.
  const evict = roster.filter((unit) => !unit.stored && !wantedSet.has(unit.id)).map((unit) => unit.id);
  const recall = wanted.filter((id) => owned.get(id)!.stored);

  let armyFree = Math.max(0, armyCap - roster.filter((unit) => !unit.stored).length);
  let cryptFree = Math.max(0, cryptCap - roster.filter((unit) => unit.stored).length);

  const store: string[] = [];
  const deploy: string[] = [];
  const operations: TeamAssembly["operations"] = [];
  let si = 0;
  let di = 0;
  while (si < evict.length || di < recall.length) {
    if (si < evict.length && cryptFree > 0) {
      const id = evict[si++];
      store.push(id);
      operations.push({ type: "store", id });
      cryptFree--;
      armyFree++;
    } else if (di < recall.length && armyFree > 0) {
      const id = recall[di++];
      deploy.push(id);
      operations.push({ type: "deploy", id });
      armyFree--;
      cryptFree++;
    } else break; // nothing can move in either direction: both sides are full
  }

  const blocked = recall.slice(di);
  const left = evict.slice(si);
  return { operations, deploy, store, missing, blocked, left, present,
    shortfall: shortfallOf(blocked, left, evict, si, cryptCap) };
}

/**
 * Why an assembly could not finish ? so the player is told the thing they can act
 * on rather than a generic "no room".
 *
 * The distinction that matters: running out of ARMY slots means the team itself is
 * too big for the farm (nothing but a bigger farm fixes it), while running out of
 * CRYPT slots means the zombies being displaced have nowhere to go (a Mausoleum,
 * or a bigger one, fixes it). The two look identical from inside the loop above ?
 * both just stop moving ? so they are told apart here by whether there was anyone
 * left to evict when it stopped.
 */
function shortfallOf(
  blocked: readonly string[],
  left: readonly string[],
  evict: readonly string[],
  evicted: number,
  cryptCap: number,
): AssemblyShortfall {
  if (!blocked.length && !left.length) return "none";
  // Everyone who could step aside already did, and members are still stuck outside:
  // the farm is full of the team itself. Only the army cap explains that.
  if (blocked.length && evicted === evict.length) return "army_cap";
  return cryptCap > 0 ? "mausoleum_full" : "no_mausoleum";
}

/** One line of plain language describing what an assembly managed to do. Lives
 *  here rather than in the panel so the wording is covered by tests. */
export function assembleReport(teamName: string, result: TeamAssembleResult): string {
  const { deployed, stored, missing, blocked, left, present, shortfall } = result;
  const did: string[] = [];
  if (deployed) did.push(`${deployed} deployed`);
  if (stored) did.push(`${stored} sent to rest`);
  let line = did.length
    ? `${teamName}: ${did.join(", ")}.`
    : `${teamName}: ${present ? "already on your farm" : "nothing could be moved"}.`;

  // Name the fix, not just the symptom.
  if (shortfall === "army_cap") {
    line += ` ${blocked} could not come out ? your farm is full at ${present + deployed}.`;
  } else if (shortfall === "no_mausoleum") {
    line += blocked
      ? ` ${blocked} could not come out ? build a Mausoleum so the others can step aside.`
      : ` ${left} had nowhere to rest ? build a Mausoleum.`;
  } else if (shortfall === "mausoleum_full") {
    line += blocked
      ? ` ${blocked} could not come out ? your Mausoleum is full.`
      : ` ${left} stayed on the farm ? your Mausoleum is full.`;
  }
  if (missing) line += ` ${missing} no longer in your roster.`;
  return line;
}

/** The same explanation, phrased for the team row BEFORE anything is tapped. */
export function shortfallNotice(plan: TeamAssembly): string | null {
  switch (plan.shortfall) {
    case "army_cap":
      return `Too big for your farm ? ${plan.blocked.length} would stay in the Mausoleum.`;
    case "no_mausoleum":
      return plan.blocked.length
        ? `Needs a Mausoleum ? ${plan.blocked.length} can't come out until the others have somewhere to rest.`
        : `Needs a Mausoleum ? ${plan.left.length} would stay on the farm.`;
    case "mausoleum_full":
      return plan.blocked.length
        ? `Mausoleum full ? ${plan.blocked.length} can't come out.`
        : `Mausoleum full ? ${plan.left.length} would stay on the farm.`;
    default:
      return null;
  }
}
