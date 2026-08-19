import { describe, expect, it } from "vitest";
// Read as text, the same way the CSS invariants next door do it: the app carries no
// @types/node, so this built-in has to be imported past the typechecker.
// @ts-ignore
import { readFileSync } from "node:fs";
import { APP_VERSION, BUILD_ID, BUILD_SHA, BUILD_TAG } from "./version";

describe("build identity", () => {
  it("is header-safe and carries both halves", () => {
    expect(BUILD_TAG).toBe(`${APP_VERSION}+${BUILD_SHA}`);
    // A header value with a space or a paren is a nuisance to grep out of a log line,
    // which is the only place this is ever read.
    expect(BUILD_TAG).not.toMatch(/[\s()]/);
    // The human-facing one keeps its parentheses; they are different strings on purpose.
    expect(BUILD_ID).toContain(APP_VERSION);
  });

  // The bug this locks out: `X-Client-Build` was sent from `import.meta.env.VITE_BUILD_ID`,
  // which nothing has ever set — not the deploy workflow, not any .env file. Every
  // production client therefore reported build:"dev", and Worker logs could not tell an
  // old bundle from a new one. That is exactly the question you need answered after
  // shipping a fix for a bug you could not reproduce. There is one populated source of
  // build identity (`__BUILD_SHA__`, filled from GITHUB_SHA in vite.config.ts); a second
  // name for it is how the first one went stale unnoticed.
  it("has exactly one source, with no VITE_BUILD_ID left to drift from it", () => {
    for (const file of ["net/api.ts", "version.ts", "../vite.config.ts"]) {
      const source: string = readFileSync(new URL(file, import.meta.url), "utf8");
      // The comment in version.ts names it to explain the history; nothing may READ it.
      expect(source).not.toMatch(/import\.meta\.env\.VITE_BUILD_ID/);
      expect(source).not.toMatch(/process\.env\.VITE_BUILD_ID/);
    }
    expect(readFileSync(new URL("net/api.ts", import.meta.url), "utf8") as string)
      .toContain('headers["X-Client-Build"] = BUILD_TAG;');
  });
});
