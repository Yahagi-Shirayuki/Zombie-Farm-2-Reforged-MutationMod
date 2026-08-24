import { describe, expect, it, vi } from "vitest";
import {
  checkShellUpdate,
  compareVersions,
  openReleasePage,
  releasesUrl,
  shellInfo,
  shellUpdateMessage,
  type ShellInfo,
} from "./shellUpdate";

const SHELL: ShellInfo = { kind: "app", repo: "someone/their-fork", version: "v0.2.2" };

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe("compareVersions", () => {
  it("orders by number, not by string", () => {
    // The case a string compare gets wrong, and the reason this isn't `!==`.
    expect(compareVersions("v0.2.10", "v0.2.9")).toBe(1);
    expect(compareVersions("v0.2.9", "v0.2.10")).toBe(-1);
  });

  it("treats a missing field as zero", () => {
    expect(compareVersions("v0.3", "v0.3.0")).toBe(0);
    expect(compareVersions("v0.3.1", "v0.3")).toBe(1);
  });

  it("ignores the v prefix and surrounding space", () => {
    expect(compareVersions(" 1.0.0 ", "v1.0.0")).toBe(0);
  });

  it("does not report an older release as an update", () => {
    expect(compareVersions("v0.2.1", "v0.2.2")).toBe(-1);
  });
});

describe("shellInfo", () => {
  const globals = globalThis as { __ZF_SHELL__?: unknown };

  it("is null in a plain browser build", () => {
    delete globals.__ZF_SHELL__;
    expect(shellInfo()).toBeNull();
  });

  it("is null when the shell could not determine its own repo", () => {
    // The shell ships empty strings rather than guessing at upstream's name, so a
    // fork that never configured a channel simply has no update check.
    globals.__ZF_SHELL__ = { kind: "app", repo: "", version: "" };
    expect(shellInfo()).toBeNull();
    delete globals.__ZF_SHELL__;
  });

  it("reads what the shell injected", () => {
    globals.__ZF_SHELL__ = { kind: "launcher", repo: "a/b", version: "v1.2.3" };
    expect(shellInfo()).toEqual({ kind: "launcher", repo: "a/b", version: "v1.2.3" });
    delete globals.__ZF_SHELL__;
  });
});

describe("checkShellUpdate", () => {
  it("asks the shell's own repository, not a hardcoded one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: "v0.2.2" }));
    await checkShellUpdate(SHELL, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/someone/their-fork/releases/latest",
    );
  });

  it("reports an update when the release is newer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: "v0.3.0", name: "v0.3.0" }));
    await expect(checkShellUpdate(SHELL, fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      status: "update-available", latest: "v0.3.0", current: "v0.2.2", name: "v0.3.0",
    });
  });

  it("stays quiet when the newest release is the one installed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: "v0.2.2" }));
    const result = await checkShellUpdate(SHELL, fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("up-to-date");
  });

  it("does not offer a downgrade when the newest release is older", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: "v0.2.1" }));
    const result = await checkShellUpdate(SHELL, fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("up-to-date");
  });

  it("reads as offline rather than broken when there is no network", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await checkShellUpdate(SHELL, fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("offline");
  });

  it("reads as offline when the API refuses (rate limit, private fork)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false));
    const result = await checkShellUpdate(SHELL, fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("offline");
  });

  it("reads as offline when a fork has no releases at all", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "Not Found" }));
    const result = await checkShellUpdate(SHELL, fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("offline");
  });

  it("never fetches in a browser build", async () => {
    const fetchImpl = vi.fn();
    const result = await checkShellUpdate(null, fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("unconfigured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("openReleasePage", () => {
  it("prefers the shell endpoint, which builds the URL itself", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    await expect(openReleasePage(SHELL, fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("/__open-release", { method: "POST" });
  });

  it("falls back to a new tab when no shell endpoint answers", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("no endpoint"));
    const open = vi.fn().mockReturnValue({});
    vi.stubGlobal("open", open);
    await expect(openReleasePage(SHELL, fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith(releasesUrl(SHELL), "_blank", "noopener");
    vi.unstubAllGlobals();
  });
});

describe("shellUpdateMessage", () => {
  it("names both versions so a player can report them", () => {
    expect(shellUpdateMessage({ status: "update-available", latest: "v0.3.0", current: "v0.2.2" }))
      .toBe("v0.3.0 is available — you have v0.2.2.");
  });

  it("says the same thing as the web build when there is no channel", () => {
    expect(shellUpdateMessage({ status: "unconfigured" }))
      .toBe("Update checks aren't available in this build.");
  });
});
