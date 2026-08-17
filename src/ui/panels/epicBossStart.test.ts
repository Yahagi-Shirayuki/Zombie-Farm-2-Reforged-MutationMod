import { describe, expect, it } from "vitest";
import { shouldAnnounceEpicBossStart, type AdoptedEpicBossRun } from "./epicBossStart";

const lured = (patch: Partial<AdoptedEpicBossRun> = {}): AdoptedEpicBossRun =>
  ({ runId: "run-1", startedCrop: "potato", active: true, ...patch });
const memory = (adopted: boolean, ...announced: string[]) =>
  ({ adopted, announced: new Set(announced) });

describe("shouldAnnounceEpicBossStart", () => {
  it("announces a lured event the first time it is adopted", () => {
    expect(shouldAnnounceEpicBossStart(lured(), memory(true))).toBe(true);
  });

  // The first adoption of a session is the bootstrap. An event already running when the
  // game loaded is not news, and without this every reload during a 14-day event pops.
  it("stays silent on the bootstrap adoption", () => {
    expect(shouldAnnounceEpicBossStart(lured(), memory(false))).toBe(false);
  });

  it("announces each run only once, however many settles re-adopt it", () => {
    expect(shouldAnnounceEpicBossStart(lured(), memory(true, "run-1"))).toBe(false);
    expect(shouldAnnounceEpicBossStart(lured({ runId: "run-2" }), memory(true, "run-1"))).toBe(true);
  });

  // A bought event announces at the moment of purchase, where success is known rather
  // than inferred. It carries no crop, which is exactly how this path skips it.
  it("ignores a run with no luring crop", () => {
    expect(shouldAnnounceEpicBossStart(lured({ startedCrop: undefined }), memory(true))).toBe(false);
  });

  it("ignores an expired, completed or absent run", () => {
    expect(shouldAnnounceEpicBossStart(lured({ active: false }), memory(true))).toBe(false);
    expect(shouldAnnounceEpicBossStart(null, memory(true))).toBe(false);
    expect(shouldAnnounceEpicBossStart(undefined, memory(true))).toBe(false);
  });
});
