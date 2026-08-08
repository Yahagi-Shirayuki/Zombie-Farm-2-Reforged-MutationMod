export interface EpicBossAnimation {
  file: string;
  cellWidth: number;
  cellHeight: number;
  frameCount: number;
  frameSeconds: number;
}

export interface EpicBossLoot {
  level: number;
  name: string;
  tile?: string;
  stageActor?: string;
  sprite: string;
}

export interface EpicBossDef {
  id: string;
  sourceId: number;
  name: string;
  costBrains: number;
  durationMs: number;
  fightMs: number;
  retryMs: number;
  encounterMs: number;
  baseHp: number;
  multipliers: number[];
  /** Rungs in this event's ladder. Every boss runs 20, which is exactly as many HP
   *  multipliers as ZF2 ever authored (EpicBossHP.json): the seven bosses that used
   *  to advertise 40 were padding levels 21-40 with a copy of level 20's multiplier,
   *  so the back half of those ladders was 20 more fights at an unchanging 107x. */
  maxLevel: number;
  introText: string;
  successText: string;
  failedText: string;
  unitStats: {
    str: number;
    dex: number;
    con: number;
    attacks: { name: string; frequency: number; mult?: number }[];
  };
  animations: Record<string, EpicBossAnimation>;
  levelAssets: { anchor: string; position: string; sprite: string; z: number }[];
  loot: EpicBossLoot[];
  questIds: string[];
  portrait: string;
  lootIcon: string;
  questIcon: string;
  bossTexture: string;
  music: string;
  punchSfx: string;
  /** True when shipped art survived without the original gameplay/atlas metadata. */
  reconstructed?: boolean;
}

import type { EpicBossProjection } from "../net/protocol";

export type EpicBossRun = EpicBossProjection;

export interface EpicBossAttemptResult {
  run: EpicBossRun;
  defeatedLevel: number | null;
  completed: boolean;
  escaped: boolean;
}
