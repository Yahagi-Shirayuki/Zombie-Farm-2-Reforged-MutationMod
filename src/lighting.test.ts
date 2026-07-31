import { describe, expect, it, vi } from "vitest";
import { NightLayer } from "./lighting";

describe("NightLayer GPU target recovery", () => {
  it("replaces a discarded render target without losing the night layer", () => {
    const layer = new NightLayer();
    const oldTarget = (layer as any).rt;
    const oldDisplay = (layer as any).display;
    const destroyTarget = vi.spyOn(oldTarget, "destroy");
    const destroyDisplay = vi.spyOn(oldDisplay, "destroy");

    layer.resetRenderTarget();

    expect((layer as any).rt).not.toBe(oldTarget);
    expect((layer as any).display).not.toBe(oldDisplay);
    expect(layer.children).toContain((layer as any).display);
    expect(destroyTarget).toHaveBeenCalledWith(true);
    expect(destroyDisplay).toHaveBeenCalledOnce();
    expect((layer as any).sw).toBe(0);
    expect((layer as any).sh).toBe(0);
  });
});
