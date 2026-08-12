import { describe, expect, it } from "vitest";
import { call, commandBody, grantBalance, grantRoster, signIn, uniqueSub } from "./helpers";
import { RAID_RULESET_VERSION } from "../../../src/raid/replay";

// The gates on /raid/start, and the roster lock it takes out.
//
// Ported from the protocol-v2 version of this file, which seeded through
// /economy/sync and sold through /roster/actions — both now 410. That retirement is
// why this spec stopped running at all: it was excluded wholesale along with the
// genuinely-dead v2 specs, and took the only end-to-end coverage of the raid roster
// lock with it. The gates themselves were never v2-specific.

async function raidPlayer(label: string) {
  const s = await signIn(uniqueSub(label));
  await grantBalance(s, { gold: 0, brains: 0, xp: 0 });
  // `stored: false` matters: the fixture files units in the Mausoleum by default, and
  // a crypt zombie cannot be deployed — /raid/start answers `unit_not_owned` for it,
  // which reads exactly like a roster that was never granted.
  await grantRoster(s, [{ id: "z1", key: "ZombieActorRegularTier1", stored: false }]);
  return s;
}

/** Try to sell `unitId` through the authoritative command lane. Returns the command
 *  result, which is where a locked unit shows up as `not_owned`. */
async function sellUnit(
  s: Awaited<ReturnType<typeof raidPlayer>>,
  batchId: string,
  sequence: number,
  unitId: string
) {
  const before = await call<{ accountVersion: number; writerGeneration: number }>(
    "POST", "/bootstrap", s.token, {}
  );
  const sold = await call<{ results: { status: string; error?: string }[] }>(
    "POST", "/commands", s.token,
    commandBody(before.body, batchId, sequence, [{ type: "roster.sell", unitId }])
  );
  return sold.body.results[0];
}

describe("raid start — pinned server state", () => {
  it("requires the current ruleset and an owned, unique roster", async () => {
    const s = await raidPlayer("raid-gate");
    const stale = await call<{ error: string }>("POST", "/raid/start", s.token, {
      raidId: 1, orderedUnitIds: ["z1"], rulesetVersion: 1,
    });
    expect(stale).toMatchObject({ status: 426, body: { error: "stale_ruleset" } });

    const foreign = await call<{ error: string }>("POST", "/raid/start", s.token, {
      raidId: 1, orderedUnitIds: ["not-owned"], rulesetVersion: RAID_RULESET_VERSION,
    });
    expect(foreign.body.error).toBe("unit_not_owned");

    const duplicate = await call<{ error: string }>("POST", "/raid/start", s.token, {
      raidId: 1, orderedUnitIds: ["z1", "z1"], rulesetVersion: RAID_RULESET_VERSION,
    });
    expect(duplicate.body.error).toBe("bad_roster");
  });

  it("locks participating units until the verified raid closes", async () => {
    // The property that matters: a zombie cannot be sold out from under a fight it is
    // currently in, and the lock is released by settlement rather than lingering.
    const s = await raidPlayer("raid-lock");
    const started = await call<{ ok: boolean; sessionId: string }>("POST", "/raid/start", s.token, {
      raidId: 1, orderedUnitIds: ["z1"], rulesetVersion: RAID_RULESET_VERSION,
    });
    expect(started.body.ok, JSON.stringify(started.body)).toBe(true);

    const locked = await sellUnit(s, "raid-lock-sell-locked", 1, "z1");
    expect(locked).toMatchObject({ status: "rejected", error: "not_owned" });

    const finished = await call("POST", "/raid/finish", s.token, {
      sessionId: started.body.sessionId,
      finalTick: 0,
      inputs: [{ seq: 1, tick: 0, type: "retreat" }],
    });
    expect(finished.status, JSON.stringify(finished.body)).toBe(200);

    const released = await sellUnit(s, "raid-lock-sell-after", 2, "z1");
    expect(released.status, JSON.stringify(released)).toBe("applied");
  });
});
