import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import worker from "../src/index";

// The /dev/* fixtures set balances to 100 million gold and mint arbitrary rosters.
// A deployed Worker must not expose one, and the ONLY thing standing between them and
// production is DEV_AUTH. That guard used to be an inline first line repeated in each
// handler — eight correct copies, and nothing to stop a ninth route shipping without
// one. It is now a single prefix middleware, and these tests are what keep it that way.

const SOURCE = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");

/** Every `/dev/` path the Worker actually registers, read from the source rather than
 *  from a hand-kept list — a new fixture route is then covered the day it is added
 *  instead of the day someone remembers to add it here. */
const devRoutes = (): string[] => {
  const found = [...SOURCE.matchAll(/app\.(?:get|post|put|delete)\("(\/dev\/[^"]+)"/g)]
    .map((match) => match[1]);
  return [...new Set(found)];
};

const env = (devAuth: string) => ({ DEV_AUTH: devAuth }) as unknown as Parameters<typeof worker.fetch>[1];
const ctx = {} as unknown as Parameters<typeof worker.fetch>[2];

const post = (path: string, devAuth: string) =>
  worker.fetch(
    new Request(`https://example.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    env(devAuth),
    ctx
  );

describe("dev fixture routes", () => {
  it("registers at least the fixtures this suite knows about", () => {
    // A sanity check on the scraper itself: if the regex ever stops matching, every
    // other test here would pass vacuously against an empty list.
    const routes = devRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(8);
    expect(routes).toContain("/dev/fixture/balance");
    expect(routes).toContain("/dev/fixture/roster");
  });

  it("answers 404 for every dev route when DEV_AUTH is off", async () => {
    for (const path of devRoutes()) {
      const response = await post(path, "0");
      expect(response.status, `${path} must not exist in production`).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("answers 404 when DEV_AUTH is absent entirely", async () => {
    // wrangler.toml sets DEV_AUTH="0", but a Worker deployed without the var at all
    // must fail closed too — the guard tests for "1", never for the absence of "0".
    for (const path of devRoutes()) {
      const response = await worker.fetch(
        new Request(`https://example.test${path}`, { method: "POST", body: "{}" }),
        {} as unknown as Parameters<typeof worker.fetch>[1],
        ctx
      );
      expect(response.status, `${path} must fail closed without DEV_AUTH`).toBe(404);
    }
  });

  it("hides the routes rather than revealing them through auth", async () => {
    // 404 before requireAuth, not 401 after it: with the fixtures off these paths
    // should look exactly like any other unrouted URL. A 401 would confirm something
    // is there and invite a look for a token that reaches it.
    const guarded = await post("/dev/fixture/balance", "0");
    expect(guarded.status).toBe(404);

    // ...and with DEV_AUTH on, the same unauthenticated call reaches requireAuth
    // instead — proving the middleware gates on the flag and is not a blanket 404.
    const open = await post("/dev/fixture/balance", "1");
    expect(open.status).toBe(401);
  });

  it("keeps the guard in the prefix middleware, not copied into handlers", () => {
    // The regression this exists for: someone re-adding a per-handler check, which
    // reads as defence in depth but quietly re-establishes the pattern where the
    // NEXT route can be written without one.
    const inlineGuards = SOURCE.match(/DEV_AUTH !== "1"/g) ?? [];
    expect(inlineGuards).toHaveLength(1);
    expect(SOURCE).toContain('app.use("/dev/*"');
  });
});
