import { describe, expect, it } from "vitest";
import {
  createSession,
  sessionAccount,
  SESSION_TOUCH_MS,
} from "../src/db";

class Statement {
  args: unknown[] = [];

  constructor(
    readonly sql: string,
    private readonly row: unknown = null,
    private readonly runs: Statement[] = [],
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>() {
    return this.row as T;
  }

  async run() {
    this.runs.push(this);
    return { meta: { changes: 1 } };
  }
}

function fakeDb(selectRow: unknown = null) {
  const batches: Statement[][] = [];
  const runs: Statement[] = [];
  const db = {
    prepare(sql: string) {
      return new Statement(sql, sql.startsWith("SELECT") ? selectRow : null, runs);
    },
    async batch(statements: Statement[]) {
      batches.push(statements);
      return [];
    },
  };
  return { db: db as unknown as D1Database, batches, runs };
}

describe("account last-online heartbeat", () => {
  it("records account activity when a session is created", async () => {
    const { db, batches } = fakeDb();

    await createSession(db, "account-1", 12_345, "Test Browser");

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0][0].sql).toContain("INSERT INTO sessions");
    expect(batches[0][1].sql).toContain("UPDATE accounts SET last_online_at");
    expect(batches[0][1].args).toEqual([12_345, "account-1"]);
  });

  it("touches a stale session without treating background requests as gameplay", async () => {
    const lastUsedAt = 10_000;
    const now = lastUsedAt + SESSION_TOUCH_MS + 1;
    const { db, batches, runs } = fakeDb({
      account_id: "account-1",
      last_used_at: lastUsedAt,
    });

    await expect(sessionAccount(db, "session-1", now)).resolves.toBe("account-1");

    expect(batches).toHaveLength(0);
    expect(runs).toHaveLength(1);
    expect(runs[0].sql).toContain("UPDATE sessions SET last_used_at");
    expect(runs[0].args).toEqual([now, "session-1"]);
  });

  it("keeps the existing write throttle for recent activity", async () => {
    const now = 20_000;
    const { db, batches, runs } = fakeDb({
      account_id: "account-1",
      last_used_at: now,
    });

    await expect(sessionAccount(db, "session-1", now)).resolves.toBe("account-1");
    expect(batches).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });
});
