import { Container, Rectangle, Sprite, type Renderer } from "pixi.js";
import type { GameAssets, ZombieModel } from "../assets";
import { slotOfRef } from "./mutations";
import {
  isMutationForegroundPart,
  matchesMutationReplacement,
  mutationCoversFace,
  mutationRefsForRendering,
  mutationPartFor,
  mutationPartZIndex,
  type MutationReplacement,
} from "./mutationVisual";
import { displayedAppearance, displayedMutationIds, zombiePartTint } from "./appearance";
import { classify } from "./taxonomy";

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
  mutationIds: readonly string[] = [],
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

  for (const ref of mutationRefsForRendering(assets.zombies, key, mutation, mutationIds)) {
    const part = mutationPartFor(assets.mutationParts, model, ref);
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
      part.replaces ?? (slotOfRef(ref) === "head" ? "head" : undefined);
    if (replacement) {
      for (const basePart of replaceable[replacement]) basePart.visible = false;
      if (replacement === "head") {
        // Same rule as the farm and raid rigs: a head mutation with a face of its
        // own hides the zombie's, rather than sitting behind it.
        const covers = mutationCoversFace(ref);
        for (const basePart of headForeground) {
          if (covers) basePart.visible = false;
          else basePart.zIndex = MUT_BASE_FOREGROUND_Z + basePart.zIndex;
        }
      }
    }
    sprite.zIndex = mutationPartZIndex(ref, part.group, part.z);
    root.addChild(sprite);
  }

  root.scale.set(model.scale ?? 1);
  return root;
}

/** How many times one key/mask/color may fail before it stops being retried. A
 *  failing extraction costs as much as a successful one (~30ms of blocked main
 *  thread), and the panels that request portraits rebuild their whole list on every
 *  tap â€” so without a ceiling a single zombie whose textures never loaded re-pays
 *  that cost on every interaction, forever. */
export const MAX_PORTRAIT_ATTEMPTS = 2;

/** Hand the main thread back between extractions. Each one blocks on a GPUâ†’CPU
 *  readback, so a panel that asks for fifty at once used to run them as a single
 *  uninterruptible task (~1.5s frozen on a full roster). Spacing them across frames
 *  keeps input and rendering alive while the portraits fill in. */
function yieldToNextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") {
    // Headless (tests/SSR): still yield, just without a frame to hang it on.
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Cache the GPU extraction for each immutable key/mask/color combination. */
export class MutationPortraits {
  private cache = new Map<string, Promise<string>>();
  /** Consecutive failures per cache key, capped by MAX_PORTRAIT_ATTEMPTS. */
  private failures = new Map<string, number>();
  /** Tail of the extraction chain â€” see enqueue(). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private renderer: Renderer, private assets: GameAssets) {}

  get(key: string, mutation: number, color?: [number, number, number], mutationIds: readonly string[] = []): Promise<string> {
    // Normalize through the display prefs BEFORE the cache key is formed: a portrait
    // is cached by what it will look like, so flipping "show mutations" or the body
    // colour mode addresses a different entry instead of returning a stale one.
    ({ mutation, color } = displayedAppearance(mutation, color));
    mutationIds = displayedMutationIds(mutationIds);
    const cacheKey = `${key}|${mutation}|${mutationIds.join(",")}|${color?.join(",") ?? "default"}`;
    const existing = this.cache.get(cacheKey);
    if (existing) return existing;
    if ((this.failures.get(cacheKey) ?? 0) >= MAX_PORTRAIT_ATTEMPTS) {
      return Promise.reject(new Error(`portrait extraction gave up for ${cacheKey}`));
    }
    const pending = this.enqueue(() => this.extract(key, mutation, color, mutationIds)).catch((error) => {
      this.cache.delete(cacheKey);
      this.failures.set(cacheKey, (this.failures.get(cacheKey) ?? 0) + 1);
      throw error;
    });
    this.cache.set(cacheKey, pending);
    return pending;
  }

  /** Run extractions one at a time, each starting on a fresh frame, so a burst of
   *  requests becomes a series of short tasks instead of one long one. The chain's
   *  tail absorbs rejections; callers still see them through their own promise. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(yieldToNextFrame).then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async extract(key: string, mutation: number, color?: [number, number, number], mutationIds: readonly string[] = []): Promise<string> {
    const rig = buildZombiePortraitRig(this.assets, key, mutation, color, mutationIds);
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

