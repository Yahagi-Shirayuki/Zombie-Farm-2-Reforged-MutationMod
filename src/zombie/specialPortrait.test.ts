// The BAKED portrait and the LIVE rig are the same actor drawn twice, by two
// programs. tools/prep_assets.py composites public/assets/zombie/portrait/<key>.png
// ahead of time; src/assets.ts assembles the rig at runtime. Only the runtime knew to
// drop the ordinary eyes/teeth/scar from an actor that paints a complete face into its
// own head art — so a Zombug looked right wandering the farm and wore a second set of
// eyeballs on every card that shows the PNG (the raid reward panel, Received).
//
// The lists are now in both places, and this pins them together: the Python is read as
// text, because there is no other way for a TypeScript test to see it, and the sets it
// declares are plain string literals.
import { describe, expect, it } from "vitest";
// The app has no @types/node (it only ever runs in a browser); the node test
// environment provides this at runtime. Same treatment as skyExtension.test.ts.
// @ts-ignore
import { readFileSync } from "node:fs";
import { COMPLETE_SPECIAL_FACES, DEFAULT_FACE_SLOTS, MASKED_FACE_SLOTS } from "../assets";
import { hidesHeadMutationArt } from "./mutationVisual";
import zombieRows from "../../public/assets/zombies.json";

const python = readFileSync(new URL("../../tools/prep_assets.py", import.meta.url), "utf8");

/** The members of a top-level `NAME = { "a", "b" }` set literal in the prep tool. */
function pythonSet(name: string): string[] {
  const block = python.match(new RegExp(`^${name} = \\{([\\s\\S]*?)\\}`, "m"));
  expect(block, `tools/prep_assets.py declares no set named ${name}`).toBeTruthy();
  return [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("baked portraits agree with the live rig about faces", () => {
  it("hides the ordinary face on the same actors", () => {
    expect(new Set(pythonSet("COMPLETE_SPECIAL_FACE_KEYS"))).toEqual(COMPLETE_SPECIAL_FACES);
  });

  it("hides the same slots", () => {
    expect(new Set(pythonSet("DEFAULT_FACE_SLOTS"))).toEqual(DEFAULT_FACE_SLOTS);
    expect(new Set(pythonSet("MASKED_FACE_SLOTS"))).toEqual(MASKED_FACE_SLOTS);
  });

  it("treats the same actors as masked", () => {
    // mutationVisual owns this membership (it also decides whether head-mutation art
    // is drawn), so the tool is checked against IT, not against a third copy.
    for (const key of pythonSet("MASKED_FACE_KEYS")) {
      expect(hidesHeadMutationArt(key), `${key} is masked for the portrait only`).toBe(true);
    }
    const masked = (zombieRows as { key: string }[])
      .map((zombie) => zombie.key)
      .filter(hidesHeadMutationArt);
    expect(new Set(pythonSet("MASKED_FACE_KEYS"))).toEqual(new Set(masked));
  });

  it("names a real catalog zombie in every entry", () => {
    const keys = new Set((zombieRows as { key: string }[]).map((zombie) => zombie.key));
    for (const key of [...COMPLETE_SPECIAL_FACES, ...pythonSet("MASKED_FACE_KEYS")]) {
      expect(keys.has(key), `unknown zombie "${key}"`).toBe(true);
    }
  });
});
