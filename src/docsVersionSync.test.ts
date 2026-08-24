// The docs quote protocol version numbers in prose, and prose does not get typechecked.
//
// This is the guard for a failure that has already happened once: `RAID_RULESET_VERSION`
// reached 30 while SECURITY.md, server/README.md and docs/PROTOCOL_V3_ROLLOUT.md all still
// said 10 — through twenty bumps, each of which was a real deterministic-transcript change.
// A wrong number here is not cosmetic. SECURITY.md's is the version an auditor reads as the
// posture under review, and the rollout doc's is the one an operator checks a live Worker
// against before deploying a client that `/raid/start` would answer `426 stale_ruleset`.
//
// Scope: only phrasings that assert the CURRENT value. Historical statements ("since ruleset
// 6 the hazards run client-side", "ruleset 14 transcribes every tap") are the docs doing
// their job and must keep working — so the patterns below are deliberately narrow, and the
// coverage test at the bottom is what stops that narrowness from quietly matching nothing.
import { describe, expect, it } from "vitest";
// The app has no @types/node (it only ever runs in a browser); the node test environment
// provides this at runtime. Same treatment as surroundings.test.ts and invasionLayering.
// @ts-ignore
import { readFileSync } from "node:fs";
import { RAID_RULESET_VERSION } from "./raid/replay";
import { CLIENT_INTEGRITY_VERSION, GAMEPLAY_PROTOCOL } from "./net/protocol";

const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/** Every doc allowed to quote a version. Adding a doc here is free; the point is that a
 *  file NOT listed is a file nobody is checking. */
const DOCS = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "server/README.md",
  "server/RUNBOOK.md",
  "docs/PROTOCOL_V3_ROLLOUT.md",
  "docs/EPIC_BOSS_MECHANICS.md",
  "docs/BLACK_MARKET_IMPLEMENTATION_PLAN.md",
] as const;

interface VersionCheck {
  label: string;
  value: number;
  /** Each must capture the quoted number in group 1, and must only match a claim about the
   *  CURRENT value. Patterns run against the whole file, so `\s+` spans line wraps — which
   *  it has to: SECURITY.md's scope sentence breaks between "client integrity" and
   *  "version 5". */
  patterns: RegExp[];
}

const CHECKS: VersionCheck[] = [
  {
    label: "RAID_RULESET_VERSION",
    value: RAID_RULESET_VERSION,
    patterns: [
      /RAID_RULESET_VERSION\s*=\s*(\d+)/g,
      /raid ruleset version\s+\*{0,2}(\d+)\*{0,2}/gi,
      /current version\s+\*{0,2}(\d+)\*{0,2}/gi,
    ],
  },
  {
    label: "CLIENT_INTEGRITY_VERSION",
    value: CLIENT_INTEGRITY_VERSION,
    patterns: [/client integrity\s+version\s+\*{0,2}(\d+)\*{0,2}/gi],
  },
  {
    label: "GAMEPLAY_PROTOCOL",
    value: GAMEPLAY_PROTOCOL,
    // Only the explicit "gameplay protocol vN" claim. A bare "protocol v3" is used all over
    // as a proper noun, including about history, and matching it would make a future bump
    // fail on sentences that are correct.
    patterns: [/gameplay protocol v(\d+)/gi],
  },
];

function findQuoted(check: VersionCheck): { where: string; found: number }[] {
  const hits: { where: string; found: number }[] = [];
  for (const doc of DOCS) {
    const text = read(doc);
    for (const pattern of check.patterns) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split("\n").length;
        hits.push({ where: `${doc}:${line}`, found: Number(match[1]) });
      }
    }
  }
  return hits;
}

describe("docs quote the current protocol versions", () => {
  it.each(CHECKS)("$label", (check) => {
    const stale = findQuoted(check)
      .filter((hit) => hit.found !== check.value)
      .map((hit) => `${hit.where} says ${hit.found}, ${check.label} is ${check.value}`);
    expect(stale).toEqual([]);
  });

  it("actually finds each version quoted somewhere", () => {
    // Without this, rewording a sentence past the patterns above turns the checks into
    // no-ops that still report green — the exact shape of failure that let the integration
    // allowlist retire nineteen specs silently. If this trips, either restore the phrasing
    // or widen that constant's patterns; do not delete the doc's claim to make it pass.
    const uncovered = CHECKS.filter((check) => findQuoted(check).length === 0).map((c) => c.label);
    expect(uncovered).toEqual([]);
  });
});
