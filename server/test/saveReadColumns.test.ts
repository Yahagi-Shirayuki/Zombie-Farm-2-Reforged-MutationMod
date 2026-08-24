// `SELECT *` on a table that stores the player's save is a per-request cost that grows
// with how much the player has played, and it is invisible: the query looks fine, the
// tests pass, and the bill climbs as the accounts age. Two columns were being carried on
// every read of the v3 projection for nothing —
//
//   account_runtime_v3.last_result_json   avg 9.4 KB, max 67 KB   (one reader, on retry)
//   farm_documents_v3.previous_json       avg 3.9 KB, max 38 KB   (no reader at all)
//
// — which is most of why CPU per request nearly doubled across the beta while request
// volume fell. This pins the fix: the read path names its columns.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(`${root}src/v3/db.ts`, "utf8");

/** Tables holding a player's save as JSON, where a stray `*` is a real cost. */
const SAVE_TABLES = [
  "account_runtime_v3",
  "farm_documents_v3",
  "object_documents_v3",
  "quest_documents_v3",
  "periodic_quest_documents_v3",
  "gameplay_documents_v3",
  "presentations_v3",
];

describe("the v3 read path names the columns it needs", () => {
  it.each(SAVE_TABLES)("does not SELECT * from %s", (table) => {
    expect(
      source,
      `SELECT * on ${table} bills every request for its widest column, and these tables ` +
      `hold the save — so the cost grows as players play. Name the columns instead.`
    ).not.toMatch(new RegExp(`SELECT\\s+\\*\\s+FROM\\s+${table}\\b`, "i"));
  });

  // The dead column, called out by name. It is written by the farm document update and
  // read by nothing in the repo; if a reader is ever added, this test should be deleted
  // deliberately rather than the column quietly rejoining the hot path.
  it("never reads previous_json, which nothing consumes", () => {
    // It still appears in the farm document UPDATE that maintains it — that write is not
    // what this is about. Only a SELECT would put it back on the read path.
    const reads = [...source.matchAll(/SELECT[^;`]*previous_json/gi)];
    expect(reads.map((m) => m[0].replace(/\s+/g, " "))).toEqual([]);
  });

  // The 9.4 KB one. Fetching it belongs behind the batch-id match in applyBatch, not in
  // the fan-out every bootstrap and every command batch pays for.
  it("fetches last_result_json only where it is actually consumed", () => {
    const reads = [...source.matchAll(/SELECT[^;`]*last_result_json/gi)];
    expect(reads.length, "expected exactly one targeted read of last_result_json")
      .toBe(1);
    expect(reads[0][0]).toMatch(/SELECT\s+last_result_json\s+FROM\s+account_runtime_v3/i);
  });
});
