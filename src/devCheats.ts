import type { GameState } from "./GameState";
import type { SaveManager } from "./save/SaveManager";

export interface DevCheatContext {
  playMode: string;
  state: Pick<GameState, "addGold" | "addBrains">;
  saves: Pick<SaveManager, "flush">;
}

export type DevCheatInstaller = (ctx: DevCheatContext) => void;

const localCheats = import.meta.glob<{ installLocalDevCheats: DevCheatInstaller }>("./devCheats.local.ts");

export function installDevCheats(ctx: DevCheatContext): void {
  if (!import.meta.env.DEV || ctx.playMode !== "local") return;

  const load = localCheats["./devCheats.local.ts"];
  if (!load) return;

  void load()
    .then((module) => module.installLocalDevCheats(ctx))
    .catch((error) => console.warn("[dev-cheats] local cheat module failed", error));
}
