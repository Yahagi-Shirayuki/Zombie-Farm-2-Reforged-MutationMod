import { Container, Rectangle, Sprite, type Renderer } from "pixi.js";
import type { GameAssets, ZombieModel } from "../assets";
import { slotOf } from "./mutations";
import {
  isMutationForegroundPart,
  matchesMutationReplacement,
  mutationBitsForRendering,
  type MutationReplacement,
} from "./mutationVisual";
import { zombiePartTint } from "./appearance";
import { classify } from "./taxonomy";

const MUT_HEAD_REPLACE_Z = 4.5;
const MUT_FACE_OVERLAY_Z = 20;
const MUT_BASE_FOREGROUND_Z = 30;

/** Ensure a renderer extraction contains at least one visible pixel before it is
 * allowed to replace a known-good catalog portrait. Some browser/GPU combinations
 * have returned a valid transparent PNG instead of rejecting the extraction. */
export async function validatePortraitDataUrl(source: string): Promise<string> {
  if (typeof document === "undefined" || typeof Image === "undefined") return source;
  const image = new Image();
  image.src = source;
  if (typeof image.decode === "function") await image.decode();
  else await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("portrait image could not be decoded"));
  });
  const width = Math.max(1, image.naturalWidth || image.width);
  const height = Math.max(1, image.naturalHeight || image.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("portrait validation canvas unavailable");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) return source;
  }
  throw new Error("portrait extraction was transparent");
}

/** Assemble the same static rig used by an owned farm zombie, including every
 * mutation overlay/replacement carried in its individual bitmask. */
export function buildZombiePortraitRig(
  assets: GameAssets,
  key: string,
  mutation: number,
  color?: [number, number, number],
): Container {
  const root = new Container();
  root.sortableChildren = true;
  const model: ZombieModel =
    assets.zombieModels[key] ?? assets.zombieModels["ZombieActorRegularTier1"];
  const [r, g, b] = color ?? model.color;
  const tint = (r << 16) | (g << 8) | b;
  const group = classify(key).group;
  const replaceable: Record<MutationReplacement, Sprite[]> = { body: [], armF: [], head: [] };
  const headForeground: Sprite[] = [];

  for (const part of model.parts) {
    const texture = assets.zombiePartTex[part.file];
    if (!texture) continue;
    const sprite = new Sprite(texture);
    sprite.label = part.file;
    sprite.anchor.set(part.ax, part.ay);
    sprite.position.set(part.px, part.py);
    sprite.scale.set(part.scale ?? 1);
    sprite.zIndex = part.z;
    if (part.tint) sprite.tint = zombiePartTint(part.file, tint, group);
    root.addChild(sprite);
    if (matchesMutationReplacement(part.file, "body")) replaceable.body.push(sprite);
    if (matchesMutationReplacement(part.file, "armF")) replaceable.armF.push(sprite);
    if (part.group === "head" && matchesMutationReplacement(part.file, "head")) {
      replaceable.head.push(sprite);
    }
    if (part.group === "head" && isMutationForegroundPart(part.file)) {
      headForeground.push(sprite);
    }
  }

  for (const bit of mutationBitsForRendering(assets.zombies, key, mutation)) {
    const partKey = model.mutationOverrides?.[String(bit)] ?? String(bit);
    const part = assets.mutationParts[partKey];
    const texture = part ? assets.zombiePartTex[part.file] : undefined;
    if (!part || !texture) continue;
    const sprite = new Sprite(texture);
    sprite.label = part.file;
    sprite.anchor.set(part.ax, part.ay);
    sprite.position.set(
      part.ox + (part.headRel ? model.neck.x : 0),
      -part.oy + (part.headRel ? model.neck.y : 0),
    );
    const replacement: MutationReplacement | undefined =
      part.replaces ?? (slotOf(bit) === "head" ? "head" : undefined);
    if (replacement) {
      for (const basePart of replaceable[replacement]) basePart.visible = false;
      if (replacement === "head") {
        for (const basePart of headForeground) {
          basePart.zIndex = MUT_BASE_FOREGROUND_Z + basePart.zIndex;
        }
      }
    }
    sprite.zIndex = part.group === "head"
      ? (slotOf(bit) === "hair_eye" ? MUT_FACE_OVERLAY_Z : MUT_HEAD_REPLACE_Z)
      : part.z;
    root.addChild(sprite);
  }

  root.scale.set(model.scale ?? 1);
  return root;
}

/** Cache the GPU extraction for each immutable key/mask/color combination. */
export class MutationPortraits {
  private cache = new Map<string, Promise<string>>();

  constructor(private renderer: Renderer, private assets: GameAssets) {}

  get(key: string, mutation: number, color?: [number, number, number]): Promise<string> {
    const cacheKey = `${key}|${mutation}|${color?.join(",") ?? "default"}`;
    const existing = this.cache.get(cacheKey);
    if (existing) return existing;
    const pending = this.extract(key, mutation, color).catch((error) => {
      this.cache.delete(cacheKey);
      throw error;
    });
    this.cache.set(cacheKey, pending);
    return pending;
  }

  private async extract(key: string, mutation: number, color?: [number, number, number]): Promise<string> {
    const rig = buildZombiePortraitRig(this.assets, key, mutation, color);
    // Keep the scaled rig as a child so the extraction target's local bounds include
    // the model scale (notably the 1.15x Large silhouette) and nothing is clipped.
    const target = new Container();
    target.addChild(rig);
    const bounds = target.getLocalBounds();
    const pad = 8;
    const frame = new Rectangle(
      bounds.x - pad,
      bounds.y - pad,
      Math.max(1, bounds.width + pad * 2),
      Math.max(1, bounds.height + pad * 2),
    );
    try {
      const source = await this.renderer.extract.base64({
        target,
        frame,
        resolution: 2,
        format: "png",
        clearColor: [0, 0, 0, 0],
      });
      return await validatePortraitDataUrl(source);
    } finally {
      target.destroy({ children: true });
    }
  }
}
