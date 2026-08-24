// Every file in docs/ has to be classified in the README as either current behaviour or a
// historical design plan.
//
// The distinction is the whole reason the split exists: `BLACK_MARKET_IMPLEMENTATION_PLAN.md`
// describes a plan whose shipped form diverged from it in three places, and a reader who
// mistakes it for a description of the code will be wrong about how the feature works. That
// only helps if the list stays complete — an unclassified doc is exactly the one a reader has
// no way to judge, and a new file is unclassified by default.
//
// This is a convention with a test rather than a convention, for the same reason
// docsVersionSync.test.ts exists: the conventions in this repo that were only written down
// are the ones that drifted.
import { describe, expect, it } from "vitest";
// The app has no @types/node (it only ever runs in a browser); the node test environment
// provides these at runtime. Same treatment as surroundings.test.ts.
// @ts-ignore
import { readFileSync, readdirSync } from "node:fs";

const readmeUrl = new URL("../README.md", import.meta.url);
const docsUrl = new URL("../docs/", import.meta.url);

/** Docs listed by name in the README's "Where the docs live" split. Read as plain text —
 *  the point is that the filename is written down there, not how it is marked up. */
const readme = readFileSync(readmeUrl, "utf8");

/** Files under docs/ that the split deliberately does not name one by one. `mechanics/` is
 *  covered as a directory (and indexed by its own README), so listing seven more filenames
 *  in the top-level README would be noise that goes stale on its own. */
const COVERED_AS_A_GROUP = ["mechanics"];

function topLevelDocs(): string[] {
  return readdirSync(docsUrl, { withFileTypes: true })
    .filter((entry: { isFile(): boolean; name: string }) => entry.isFile())
    .map((entry: { name: string }) => entry.name)
    .filter((name: string) => name.endsWith(".md"));
}

describe("docs/ is classified in the README", () => {
  it("names every top-level doc as current or historical", () => {
    const unclassified = topLevelDocs().filter((name) => !readme.includes(name));
    expect(unclassified, "add these to the docs split in README.md").toEqual([]);
  });

  it("indexes docs/mechanics/ rather than leaving it to grep", () => {
    // The mechanics docs are the ones CONTRIBUTING says win over intuition, so they have to
    // be findable. Their index carries the anchoring convention too — see its "Writing one
    // of these" section.
    const index = readFileSync(new URL("mechanics/README.md", docsUrl), "utf8");
    const mechanics = readdirSync(new URL("mechanics/", docsUrl))
      .filter((name: string) => name.endsWith(".md") && name !== "README.md");
    const missing = mechanics.filter((name: string) => !index.includes(name));
    expect(missing, "add these to docs/mechanics/README.md").toEqual([]);
  });

  it("covers the grouped entries it claims to", () => {
    // Guards the escape hatch above: if `mechanics/` were renamed or emptied, the exemption
    // would silently start excusing nothing while still looking deliberate.
    const dirs = readdirSync(docsUrl, { withFileTypes: true })
      .filter((entry: { isDirectory(): boolean }) => entry.isDirectory())
      .map((entry: { name: string }) => entry.name);
    expect(dirs.sort()).toEqual([...COVERED_AS_A_GROUP].sort());
  });
});
