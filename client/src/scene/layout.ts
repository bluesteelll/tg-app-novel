// Pure layout of the scene (PROTOTYPE-PLAN "Scene controller and asset registry", Layout): the render resolution
// clamp, the character slots and sizing, and the backdrop / prop placement over geom/cover.ts. No Pixi, no DOM.
import { ROOM_SOURCE, cover, toStage } from '../geom/cover.ts';
import type { Box, Cover, Size } from '../geom/cover.ts';
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
