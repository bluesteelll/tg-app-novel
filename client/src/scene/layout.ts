// Pure layout of the scene (PROTOTYPE-PLAN "Scene controller and asset registry", Layout): the render resolution
// clamp, a file's texture geometry, the half tier's predicate (MEMORY-PLAN 4.C), the character slots and sizing, and
// the backdrop / prop placement over geom/cover.ts. No Pixi, no DOM.
import { ROOM_SOURCE, cover, toStage } from '../geom/cover.ts';
import type { Box, Cover, Size } from '../geom/cover.ts';
import { CHAR_HALF_CANVAS_H } from '../story/catalog.ts';
import type { ImageEntry, SizeTier } from '../story/catalog.ts';
import type { Rect, Slot } from '../story/staging.ts';

/** The device performance class (L7's `PerfClass` is assignable to it). */
export type PerfClass = 'LOW' | 'AVERAGE' | 'HIGH';

/** Principle 4: render resolution ≤ 2× DPR; the framebuffer budget is computed at 2. */
export const MAX_RESOLUTION = 2;
/** Character sprite height as a fraction of the stage height. */
export const CHAR_HEIGHT = 0.78;
/** Character anchor x per slot, as a fraction of the stage width; the anchor is the sprite's bottom centre. */
export const SLOT_X: Readonly<Record<Slot, number>> = Object.freeze({ left: 0.25, center: 0.5, right: 0.75 });

/** The one place the render resolution is decided: LOW → 1, else min(dpr, 2); a dpr that is not a positive number → 1. */
export function renderResolution(dpr: number, perf: PerfClass): number {
  if (perf === 'LOW' || !Number.isFinite(dpr) || dpr <= 0) {
    return 1;
  }
  return Math.min(dpr, MAX_RESOLUTION);
}

/**
 * How a file becomes a texture laid out as its canvas (MEMORY-PLAN §6), in the file's px: `orig` is the whole canvas,
 * `trim` the stored box on it (null: the file is the canvas), `resolution` the source px per canvas px. Pixi sizes and
 * anchors a sprite on `orig` and draws the quad at `trim`, so a trimmed file renders where the untrimmed one would.
 * The full file at resolution 1; its half (MEMORY-PLAN 4.C) at 0.5 with the same canvas, orig and trim, so its
 * texture's size is the full file's and the layout does not depend on the tier (I4).
 */
export type TextureGeometry = { canvas: Size; orig: Box; trim: Box | null; resolution: 1 | 0.5 };

export function textureGeometry(entry: ImageEntry, tier: SizeTier): TextureGeometry {
  const t = entry.trim;
  const canvas = t === undefined ? { w: entry.w, h: entry.h } : { w: t.canvasW, h: t.canvasH };
  return {
    canvas,
    orig: { x: 0, y: 0, w: canvas.w, h: canvas.h },
    trim: t === undefined ? null : { x: t.x, y: t.y, w: entry.w, h: entry.h },
    resolution: tier === 'half' ? 0.5 : 1,
  };
}

/** MEMORY-PLAN 4.C: the stage column's aspect (PP:1497-1499), so the widest stage a screen of height H can show. */
const STAGE_ASPECT = 9 / 16;

/**
 * The largest stage the session can reach (MEMORY-PLAN 4.C), per side the larger of the screen's portrait stage (H =
 * the long side, W = min(short side, 9/16 × H)) and the host's box at mount. A screen that is absent, or has a side that
 * is not a positive finite number, is unbounded: the predicate then fails and the tier is full.
 */
export function stageBound(screen: Size | null, host: Size): Size {
  const known = (v: number): boolean => Number.isFinite(v) && v > 0;
  if (screen === null || !known(screen.w) || !known(screen.h)) {
    return { w: Number.POSITIVE_INFINITY, h: Number.POSITIVE_INFINITY };
  }
  const long = Math.max(screen.w, screen.h);
  const short = Math.min(screen.w, screen.h);
  return { w: Math.max(Math.min(short, STAGE_ASPECT * long), host.w), h: Math.max(long, host.h) };
}

/**
 * MEMORY-PLAN 4.C (RULINGS 35 Q7 in stored px, I6): on `stage` at resolution `r`, no backdrop, CG or character half
 * file is drawn above its stored px. Backdrops and CGs share the cover transform (half px per canvas px: 0.5); every
 * char half is on the CHAR_HALF_CANVAS_H canvas, drawn at most CHAR_HEIGHT × H × r device px. A side or a resolution
 * that is not finite fails.
 */
export function halfFits(stage: Size, r: number): boolean {
  if (![stage.w, stage.h, r].every(Number.isFinite)) {
    return false;
  }
  return cover(stage, ROOM_SOURCE).scale * r <= 0.5 && CHAR_HEIGHT * stage.h * r <= CHAR_HALF_CANVAS_H / 2;
}

/** The session's tier, fixed at mount: the half files only on a LOW device whose largest stage passes `halfFits`. */
export function tierFor(perf: PerfClass, bound: Size, r: number): SizeTier {
  return perf === 'LOW' && halfFits(bound, r) ? 'half' : 'full';
}

/** Backgrounds and CGs: cover-scaled from the canonical source; the sprite is sized ROOM_SOURCE × scale. */
export function backdropPlacement(stage: Size): Cover {
  return cover(stage, ROOM_SOURCE);
}

/**
 * A character's bottom-centre anchor and height. Never upscaled: the height in device px stays ≤ the source height,
 * so the CSS height is min(0.78 × stage height, source height / resolution). The width follows the source aspect.
 */
export function charPlacement(stage: Size, slot: Slot, src: Size, resolution: number): { x: number; y: number; h: number } {
  return { x: stage.w * SLOT_X[slot], y: stage.h, h: Math.min(CHAR_HEIGHT * stage.h, src.h / resolution) };
}

/** A prop at its hotspot rect, in the background's cover transform, so props and hotspots cannot drift from the bg. */
export function propPlacement(stage: Size, rect: Rect): Box {
  return toStage(rect, backdropPlacement(stage));
}
