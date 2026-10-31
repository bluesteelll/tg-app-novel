// The one cover transform (PUZZLES-PLAN X10): the background sprite, the props layer (scene/layout.ts) and the
// exploration hotspot buttons all map the 1080×2048 source space through it, so they agree by construction.
// Pure: no DOM, no Pixi.
import type { Rect } from '../story/staging.ts';

/** A width and a height, in px. */
export type Size = { w: number; h: number };
/** stage px = source px × scale + offset. */
export type Cover = { scale: number; offsetX: number; offsetY: number };
/** An axis-aligned box in stage (CSS) px. */
export type Box = { x: number; y: number; w: number; h: number };

/** The canonical background (and room) source size; the build gate holds every bg / CG to it. */
export const ROOM_SOURCE: Size = Object.freeze({ w: 1080, h: 2048 });

/** Hotspot rects lie inside this frame (lint `world/hotspot-frame`): visible from 9:19.5 to 9:16. */
export const HOTSPOT_SAFE_FRAME: { x0: 80; x1: 1000; y0: 160; y1: 1760 } = Object.freeze({
  x0: 80,
  x1: 1000,
  y0: 160,
  y1: 1760,
});

/** Scales `source` to cover `stage` (no letterbox) and centres it; the overflow is cropped evenly. */
export function cover(stage: Size, source: Size): Cover {
  const scale = Math.max(stage.w / source.w, stage.h / source.h);
  return { scale, offsetX: (stage.w - source.w * scale) / 2, offsetY: (stage.h - source.h * scale) / 2 };
}

/** A source-px rect `[x, y, w, h]` in stage px under `c`. */
export function toStage(r: Rect, c: Cover): Box {
  const [x, y, w, h] = r;
  return { x: x * c.scale + c.offsetX, y: y * c.scale + c.offsetY, w: w * c.scale, h: h * c.scale };
}

/** Grows a box smaller than `minCssPx` on a side to that size around its centre (44 px tap targets); larger sides stay. */
export function minTarget(r: Box, minCssPx: number): Box {
  const w = Math.max(r.w, minCssPx);
  const h = Math.max(r.h, minCssPx);
  return { x: r.x - (w - r.w) / 2, y: r.y - (h - r.h) / 2, w, h };
}
