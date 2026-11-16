// Flatten plans and the GPU ledger (docs/plans/shots §5.5, CH §5.3 and D30, lane SH6): the size of a one-render
// target and where its pixels sit, and the count of GPU objects Pixi has not destroyed yet. Pure: no pixi.js, no gsap
// (its vitests run in node); the targets themselves are made, rendered and freed in scene/controller.ts (D28).
import type { Size } from '../geom/cover.ts';
import type { Box } from '../story/shots.ts';
import { MAX_TEXTURE_PX } from './registry.ts';

/**
 * One render of the world into a target: `w` x `h` device px (integers: Pixi's TextureSource sets its pixel size
 * without rounding), `bytes` = w h 4, `scale` = target px per stage px, `origin` = the stage point at the target's
 * top left. The target shows at `1 / scale`, so it covers exactly the stage rect it was rendered from.
 */
export type FlatPlan = {
  readonly w: number;
  readonly h: number;
  readonly bytes: number;
  readonly scale: number;
  readonly origin: { readonly x: number; readonly y: number };
};

/** The smallest integer >= v, forgiving the float error of a product that should be whole. */
const up = (v: number): number => Math.ceil(v - 1e-6);

/**
 * The dissolve's snapshot (§5.5 step 1, cut Q1): the whole stage at the render resolution, scaled down with its aspect
 * kept when a side would pass MAX_TEXTURE_PX. Shown at 1 / scale, it is sharp at any scale up to the resolution.
 */
export function snapshotPlan(stage: Size, resolution: number): FlatPlan {
  const scale = Math.min(resolution, MAX_TEXTURE_PX / stage.w, MAX_TEXTURE_PX / stage.h);
  const w = Math.min(MAX_TEXTURE_PX, up(stage.w * scale));
  const h = Math.min(MAX_TEXTURE_PX, up(stage.h * scale));
  return { w, h, bytes: w * h * 4, scale, origin: { x: 0, y: 0 } };
}

/** The largest integer <= v, forgiving the float error of a product that should be whole. */
const down = (v: number): number => Math.floor(v + 1e-6);

/** A face patch (S15): its render, and its sprite's place in its shot root's plate px (`k`: plate px per target px). */
export type PatchPlan = { readonly plan: FlatPlan; readonly x: number; readonly y: number; readonly k: number };

/**
 * A face patch's target (S15, D9, review O2): the plate rect `rect` where `xf` (plate px to stage px) shows it, in whole
 * device px at `resolution`: its near edges snapped down and its far edges up, so it covers the rect and its pixels sit
 * on the device grid; the sprite goes at the snapped edge in plate px. Null when a side is past MAX_TEXTURE_PX or empty.
 */
export function patchPlan(rect: Box, xf: { readonly x: number; readonly y: number; readonly k: number }, resolution: number): PatchPlan | null {
  const [rx, ry, rw, rh] = rect;
  const dev = (at: number, v: number): number => (at + v * xf.k) * resolution;
  const x0 = down(dev(xf.x, rx));
  const y0 = down(dev(xf.y, ry));
  const w = up(dev(xf.x, rx + rw)) - x0;
  const h = up(dev(xf.y, ry + rh)) - y0;
  if (w < 1 || h < 1 || w > MAX_TEXTURE_PX || h > MAX_TEXTURE_PX) {
    return null;
  }
  const origin = { x: x0 / resolution, y: y0 / resolution };
  return {
    plan: { w, h, bytes: w * h * 4, scale: resolution, origin },
    x: (origin.x - xf.x) / xf.k,
    y: (origin.y - xf.y) / xf.k,
    k: 1 / (xf.k * resolution),
  };
}

/** Anything Pixi emits `destroy` on once its GPU data is freed (TextureSource; pixi.js 8.22.0 `TextureSource.destroy`). */
export type GpuObject = { once(event: 'destroy', fn: () => void): unknown };
/** What the ledger counts (SH8 adds its mesh buffers). */
export type GpuKind = 'target';
/** Live targets and their bytes; `targetsCreated` / `targetsDestroyed` are cumulative (E1's witness, A10). */
export type GpuStats = { targets: number; targetBytes: number; targetsCreated: number; targetsDestroyed: number };
/** D30: a tracked object's count drops only when Pixi destroys it; there is no untrack. */
export interface GpuLedger {
  /** Counts `obj` from now until its `destroy` event. */
  track(kind: GpuKind, bytes: number, obj: GpuObject): void;
  stats(): GpuStats;
}

/** One per mounted controller: it outlives a rebuild's adapter, so a target made before it is still counted. */
export function createGpuLedger(): GpuLedger {
  const stats: GpuStats = { targets: 0, targetBytes: 0, targetsCreated: 0, targetsDestroyed: 0 };
  return {
    track(_kind, bytes, obj) {
      stats.targets += 1;
      stats.targetBytes += bytes;
      stats.targetsCreated += 1;
      let gone = false;
      obj.once('destroy', () => {
        // Counted down once, whatever the emitter repeats.
        if (gone) {
          return;
        }
        gone = true;
        stats.targets -= 1;
        stats.targetBytes -= bytes;
        stats.targetsDestroyed += 1;
      });
    },
    stats: () => ({ ...stats }),
  };
}
