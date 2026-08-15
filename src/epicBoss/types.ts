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
    /** `damageTiming` is the attack's authored 0..1 connect point (Attacks.json),
     *  baked in by the prep tool. Absent only if an attack is missing from that file. */
    attacks: { name: string; frequency: number; mult?: number; damageTiming?: number }[];
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
  /** True for the three bosses whose atlases shipped with no frame metadata. Their
   *  combat art is recovered from the sheet by geometry and their animation ordering
   *  is hand-authored (tools/art/epic-boss-frames), rather than read from ZF2. */
  reconstructed?: boolean;
  /** [x, y, w, h] of `bossTexture` inside that atlas — present only when the art was
   *  cut from the sheet, which is what makes it combat art rather than a menu card.
   *  Loose about its length because it arrives through a JSON import. */
  staticFrame?: number[];
}

import type { EpicBossProjection } from "../net/protocol";

export type EpicBossRun = EpicBossProjection;

export interface EpicBossAttemptResult {
  run: EpicBossRun;
  defeatedLevel: number | null;
  completed: boolean;
  escaped: boolean;
}
