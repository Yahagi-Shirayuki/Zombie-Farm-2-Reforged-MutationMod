import { beforeEach, describe, expect, it } from "vitest";
import {
  isServiceMode,
  mutationsAllowed,
  readServiceState,
  resetServiceStateCache,
  signInAllowed,
  signupsAllowed,
  type ServiceMode,
} from "../src/serviceState";
import { upsertAccount } from "../src/db";

/** Returns `row` for every SELECT — enough for both the single-row service_state read
 *  and the accounts-by-google_sub lookup, which are exercised separately. */
function fakeDb(row: unknown, onSelect?: () => void) {
  return {
    prepare(_sql: string) {
      return {
        bind() {
          return this;
        },
        async first() {
          onSelect?.();
          return row;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  } as unknown as D1Database;
}

function throwingDb(message: string) {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first(): Promise<unknown> {
          throw new Error(message);
        },
      };
    },
  } as unknown as D1Database;
}

const state = (mode: ServiceMode) => ({ mode, notice: null, updatedAt: 0 });

describe("service mode permissions", () => {
  it("only 'open' registers new accounts", () => {
    expect(signupsAllowed(state("open"))).toBe(true);
    expect(signupsAllowed(state("signups_closed"))).toBe(false);
    expect(signupsAllowed(state("export_only"))).toBe(false);
    expect(signupsAllowed(state("closed"))).toBe(false);
  });

  // export_only exists precisely so a beta player can still READ their farm and move
  // it to Local Farm; taking sign-in away there would defeat the whole window.
  it("keeps sign-in open everywhere except 'closed'", () => {
    expect(signInAllowed(state("open"))).toBe(true);
    expect(signInAllowed(state("signups_closed"))).toBe(true);
    expect(signInAllowed(state("export_only"))).toBe(true);
    expect(signInAllowed(state("closed"))).toBe(false);
  });

  it("halts gameplay mutations from export_only onward", () => {
    expect(mutationsAllowed(state("open"))).toBe(true);
    expect(mutationsAllowed(state("signups_closed"))).toBe(true);
    expect(mutationsAllowed(state("export_only"))).toBe(false);
    expect(mutationsAllowed(state("closed"))).toBe(false);
  });

  it("rejects unknown modes", () => {
    expect(isServiceMode("export_only")).toBe(true);
    expect(isServiceMode("maintenance")).toBe(false);
    expect(isServiceMode(null)).toBe(false);
  });
});

describe("readServiceState", () => {
  beforeEach(() => resetServiceStateCache());

  it("reads the single row", async () => {
    const db = fakeDb({ mode: "export_only", notice: "Back for launch", updated_at: 42 });
    expect(await readServiceState(db, 1000)).toEqual({
      mode: "export_only",
      notice: "Back for launch",
      updatedAt: 42,
    });
  });

  it("treats a blank notice as none", async () => {
    const db = fakeDb({ mode: "closed", notice: "   ", updated_at: 1 });
    expect((await readServiceState(db, 1000)).notice).toBeNull();
  });

  // Fail OPEN. A Worker deployed ahead of migration 0042 (or a D1 blip) must not lock
  // the entire player base out of a service that is actually running.
  it("falls back to open when the table is missing", async () => {
    const db = throwingDb("no such table: service_state");
    expect((await readServiceState(db, 1000)).mode).toBe("open");
  });

  it("falls back to open on an unrecognised mode", async () => {
    const db = fakeDb({ mode: "banana", notice: null, updated_at: 1 });
    expect((await readServiceState(db, 1000)).mode).toBe("open");
  });

  it("memoises within the TTL and re-reads after it", async () => {
    let reads = 0;
    const db = fakeDb({ mode: "closed", notice: null, updated_at: 1 }, () => reads++);
    await readServiceState(db, 1_000);
    await readServiceState(db, 20_000);
    expect(reads).toBe(1);
    await readServiceState(db, 40_000);
    expect(reads).toBe(2);
  });
});

describe("upsertAccount signup gate", () => {
  it("returns null instead of registering an unknown identity when creation is off", async () => {
    const db = fakeDb(null);
    expect(await upsertAccount(db, { sub: "google:new" }, 1, false)).toBeNull();
  });

  it("still resolves an EXISTING identity when creation is off", async () => {
    const existing = {
      id: "acct-1",
      google_sub: "google:old",
      username: "Beta Player",
      friend_code: "ABCDEF",
      created_at: 1,
      last_online_at: 1,
    };
    const db = fakeDb(existing);
    expect(await upsertAccount(db, { sub: "google:old" }, 2, false)).toEqual(existing);
  });
});
