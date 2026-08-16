import type { GameAssets, ZombieModelPart } from "../assets";

const FACING_FLIP_TEXTURES: Record<string, string> = {
  "luckybox_head.png": "luckybox_head_flip.png",
  "luckybox_zombie/luckybox_head_silver.png": "luckybox_zombie/luckybox_head_silver_flip.png",
  "luckybox_zombie/luckybox_head_gold.png": "luckybox_zombie/luckybox_head_gold_flip.png",
  "luckybox_zombie/luckybox_head_plat.png": "luckybox_zombie/luckybox_head_plat_flip.png",
};

export function extraZombieFacingPartFiles(sourceFiles: Iterable<string>): string[] {
  const files = new Set(sourceFiles);
  return Object.entries(FACING_FLIP_TEXTURES)
    .filter(([source]) => files.has(source))
    .map(([, flipped]) => flipped);
}

export function zombiePartTextureForFacing(
  assets: GameAssets,
  part: Pick<ZombieModelPart, "file">,
  mirrored: boolean,
) {
  const flipped = mirrored ? FACING_FLIP_TEXTURES[part.file] : undefined;
  return (flipped ? assets.zombiePartTex[flipped] : undefined)
    ?? assets.zombiePartTex[part.file];
}
