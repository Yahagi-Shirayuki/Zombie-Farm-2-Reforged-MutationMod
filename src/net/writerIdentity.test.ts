// The writer-lease drift that strands a player on "Gameplay paused — reconnect to
// continue" with a perfectly good connection, permanently.
//
// The lease credential lives in sessionStorage; the client key it was issued against
// lives in localStorage. When the second is rebuilt while the first survives — an evicted
// key on iOS, a site-data clear with the tab still open — the two disagree, `POST
// /commands` answers 400 `bad_writer_command`, and because a rejected batch is retried
// verbatim the farm never recovers. Nothing said so: the batch is correctly fenced, the
// lease is live, and every symptom points at the network.
//
// These pin the detection, not the fix. Reporting it is the fix for the DIAGNOSIS — a
// paste now carries `writer: lock held, credential held, identity DRIFTED` instead of
// three healthy-looking lines and no explanation.
import { beforeEach, describe, expect, it, vi } from "vitest";

const CLIENT_KEY = "zf2r.v4.writer-client";
const WRITER_KEY = "zf2r.v4.writer";
const SESSION_KEY = "zf2r.v3.session";

/** A signed-in document holding a lease issued against `clientId`. */
async function documentWith(storedClientId: string | null, credentialClientId: string) {
  const local = new Map<string, string>([
    // api.ts reads the session at module load, and the credential is only honoured for
    // the signed-in account — so it has to be in place before the import below.
    [SESSION_KEY, JSON.stringify({
      token: "s", accountId: "acct-1", username: "Player", friendCode: "AAAA-BBBB",
    })],
  ]);
  if (storedClientId !== null) local.set(CLIENT_KEY, storedClientId);
  const sessionValues = new Map<string, string>([
    [WRITER_KEY, JSON.stringify({
      accountId: "acct-1", clientId: credentialClientId, generation: 3, token: "t",
    })],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value),
    removeItem: (key: string) => local.delete(key),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => sessionValues.get(key) ?? null,
    setItem: (key: string, value: string) => sessionValues.set(key, value),
    removeItem: (key: string) => sessionValues.delete(key),
  });
  vi.stubGlobal("crypto", { randomUUID: () => "minted-id" });
  vi.resetModules();
  const api = await import("./api");
  expect(api.getSession()?.accountId, "the stub session must reach api.ts").toBe("acct-1");
  return api;
}

describe("writer identity drift is visible in a bug report", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("reports a match while the client key and the lease agree", async () => {
    const api = await documentWith("client-a", "client-a");
    expect(api.writerRequestClientId()).toBe("client-a");
    expect(api.writerIdentityState()).toBe("match");
  });

  it("reports DRIFTED once the client key has been rebuilt underneath the lease", async () => {
    const api = await documentWith("client-REBUILT", "client-a");
    // The document still writes under the credential's id — that part is unchanged, and
    // must be: body and header have to be drawn from the same credential.
    expect(api.writerRequestClientId()).toBe("client-a");
    // ...but the report now says why every batch is about to be refused.
    expect(api.writerIdentityState()).toBe("DRIFTED");
  });

  it("does not call a missing client key drift", async () => {
    // No stored key is not drift: `writerClientId()` mints one on demand, and this
    // document is already writing under the credential's id either way. It is reported
    // as unknown rather than as a match, because nothing was actually compared — a
    // report that claims agreement it never checked is worse than one that says so.
    const api = await documentWith(null, "client-a");
    expect(api.writerRequestClientId()).toBe("client-a");
    expect(api.writerIdentityState()).toBe("");
  });

  it("crumbs the drift once, not once per command batch", async () => {
    const api = await documentWith("client-REBUILT", "client-a");
    const { readCrumbs } = await import("../breadcrumbs");
    for (let i = 0; i < 20; i++) api.writerRequestClientId();
    const drift = readCrumbs().filter((c) => c.tag === "writer:identity");
    expect(drift).toHaveLength(1);
    expect(drift[0].repeat ?? 1).toBe(1);
  });

  it("carries no identifier or token into the report", async () => {
    const api = await documentWith("client-REBUILT", "client-a");
    const { readCrumbs } = await import("../breadcrumbs");
    api.writerRequestClientId();
    const text = JSON.stringify(readCrumbs());
    for (const secret of ["client-a", "client-REBUILT", "acct-1"]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
