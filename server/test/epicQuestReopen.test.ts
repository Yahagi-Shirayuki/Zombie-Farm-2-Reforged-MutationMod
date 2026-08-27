// Activating an Epic Boss re-opens the quests that boss has already finished, so a
// repeat run pays its prizes — the signature zombie above all — all over again.
// Without this an epic quest completed once and stayed complete forever, which retired
// the event's zombie after a single clear.
import { describe, expect, it } from "vitest";
import { activate } from "../src/v3/epicBoss";

interface Result { meta: { changes: number } }

class Statement {
  args: unknown[] = [];
  constructor(readonly sql: string, private readonly rows: Record<string, unknown>) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() {
    const table = Object.keys(this.rows).find((name) => this.sql.includes(name));
    return (table ? this.rows[table] : null) as T;
  }
}

/** Routes each SELECT to a row by the table it names; every batched write "changes" a
 *  row, which is what activate() reads to confirm the activation won its race. */
const fakeDb = (rows: Record<string, unknown>) => {
  const batched: Statement[][] = [];
  const db = {
    prepare(sql: string) { return new Statement(sql, rows); },
    async batch(statements: Statement[]): Promise<Result[]> {
      batched.push(statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { db: db as unknown as D1Database, batched };
};

const questDoc = (completed: string[], progress: { questId: string; counts: number[] }[]) => ({
  version: 4,
  current_json: JSON.stringify({ completed, progress }),
});

// Level 45 clears every unlock gate; brains cover any activation cost.
const balances = { gold: 0, brains: 10_000, xp: 218_000 };
const questWrite = (batched: Statement[][]) =>
  batched[0].find((statement) => statement.sql.includes("UPDATE quest_documents_v3"));

describe("activating an Epic Boss reopens its finished quests", () => {
  it("clears the boss's completed quests and their spent progress", async () => {
    const { db, batched } = fakeDb({
      balances,
      epic_boss_runs_v3: null,
      // 1000 (Dr. Zombie) and 1002 are done; 1010 is the collect-every-prize quest,
      // still in flight, and 7 belongs to the normal progression rail.
      quest_documents_v3: questDoc(["7", "1000", "1002"], [
        { questId: "7", counts: [3] },
        { questId: "1000", counts: [1] },
        { questId: "1002", counts: [1] },
        { questId: "1010", counts: [4] },
      ]),
    });

    const result = await activate(db, "account", "run-reopen", "dr-groundhog", 10_000);

    expect(result.status).toBe(200);
    const write = questWrite(batched);
    expect(write).toBeDefined();
    expect(JSON.parse(write!.args[0] as string)).toEqual({
      completed: ["7"],
      // 1010's lifetime progress survives; the finished quests' does not, or they would
      // re-complete on the new run's first win whatever level that win was on.
      progress: [{ questId: "7", counts: [3] }, { questId: "1010", counts: [4] }],
    });
    // The client needs the reset in the activation response, or its rail keeps showing
    // the quests as done until the next full bootstrap.
    expect(result.body.quests).toEqual({
      version: 5, completed: ["7"],
      progress: [{ questId: "7", counts: [3] }, { questId: "1010", counts: [4] }],
    });
  });

  it("leaves another boss's chain alone", async () => {
    const { db, batched } = fakeDb({
      balances,
      epic_boss_runs_v3: null,
      quest_documents_v3: questDoc(["1000", "1011"], [{ questId: "1000", counts: [1] }]),
    });

    const result = await activate(db, "account", "run-other-boss", "loco-locust", 10_000);

    expect(result.status).toBe(200);
    expect(questWrite(batched)).toBeUndefined();
    expect(result.body.quests).toBeUndefined();
  });

  it("writes nothing when the boss has no finished quests to reopen", async () => {
    const { db, batched } = fakeDb({
      balances,
      epic_boss_runs_v3: null,
      quest_documents_v3: questDoc([], [{ questId: "1010", counts: [2] }]),
    });

    const result = await activate(db, "account", "run-first-time", "dr-groundhog", 10_000);

    expect(result.status).toBe(200);
    expect(questWrite(batched)).toBeUndefined();
    expect(result.body.quests).toBeUndefined();
  });
});
