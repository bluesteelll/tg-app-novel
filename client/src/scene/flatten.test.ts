// The flatten plans and the GPU ledger (docs/plans/shots §5.5, CH §5.3, lane SH6): pure, so they run in node with no
// Pixi value; the Pixi half (a real TextureSource emitting `destroy`) is pinned in controller.test.ts.
import { expect, test } from 'vitest';

import { createGpuLedger, patchPlan, snapshotPlan } from './flatten.ts';
import type { GpuObject } from './flatten.ts';
import source from './flatten.ts?raw';
import { MAX_TEXTURE_PX } from './registry.ts';

test('flatten: a snapshot target is the stage in device px capped at 2048', () => {
  // A phone at r 2: the stage in device px, at the render resolution.
  expect(snapshotPlan({ w: 390, h: 844 }, 2)).toEqual({ w: 780, h: 1688, bytes: 5_266_560, scale: 2, origin: { x: 0, y: 0 } });
  // Desktop 787 x 1400 at r 1.5 (05b:506): the long side past 2048 scales the whole stage down, aspect kept.
  const desk = snapshotPlan({ w: 787, h: 1400 }, 1.5);
  expect([desk.w, desk.h, desk.bytes]).toEqual([1152, 2048, 9_437_184]);
  expect(desk.scale).toBeCloseTo(2048 / 1400, 12);
  // A square stage at its cap: 2048 on both sides, never one more.
  expect(snapshotPlan({ w: 2048, h: 2048 }, 2)).toMatchObject({ w: 2048, h: 2048, bytes: 2048 * 2048 * 4, scale: 1 });
  for (const [w, h, r] of [
    [390, 844, 2],
    [787, 1400, 1.5],
    [2048, 2048, 2],
    [405, 720, 1],
    [1366, 1024, 2],
  ] as const) {
    const p = snapshotPlan({ w, h }, r);
    for (const side of [p.w, p.h]) {
      expect(Number.isInteger(side), `${w} x ${h} at ${r}`).toBe(true);
      expect(side, `${w} x ${h} at ${r}`).toBeLessThanOrEqual(MAX_TEXTURE_PX);
    }
    expect(p.bytes).toBe(p.w * p.h * 4);
  }
});

/**
 * A GpuObject whose `once` keeps its listener (a naive emitter): a second `destroy` emit reaches the ledger again, so
 * only the ledger's own bookkeeping can keep the count from dropping twice.
 */
function fakeGpuObject(): GpuObject & { emit(event: 'destroy'): void } {
  const fns: Array<() => void> = [];
  return {
    once: (_event, fn) => {
      fns.push(fn);
    },
    emit: () => {
      fns.forEach((fn) => fn());
    },
  };
}

test('flatten: a patch plan is its plate rect in device px, null past 2048', () => {
  // On the device grid: plate (100, 200) 60 x 40 at k 0.5 from (10, 20), r 2, is device (120, 240) 60 x 40; the sprite
  // goes back at the rect's plate place, one target px per device px.
  expect(patchPlan([100, 200, 60, 40], { x: 10, y: 20, k: 0.5 }, 2)).toEqual({
    plan: { w: 60, h: 40, bytes: 9_600, scale: 2, origin: { x: 60, y: 120 } },
    x: 100,
    y: 200,
    k: 1,
  });
  // Off the grid (review O2): device x 2.1 to 6.6 and y 1.5 to 6 snap out to 2 to 7 and 1 to 6, the sprite at the
  // snapped edge in plate px, so the patch covers the rect.
  const p = patchPlan([1, 1, 3, 3], { x: 0.3, y: 0, k: 0.75 }, 2);
  expect(p === null ? null : [p.plan.w, p.plan.h, p.plan.bytes, p.plan.origin.x, p.plan.origin.y]).toEqual([5, 5, 100, 1, 0.5]);
  expect(p?.x).toBeCloseTo(0.7 / 0.75, 12);
  expect(p?.y).toBeCloseTo(0.5 / 0.75, 12);
  expect(p?.k).toBeCloseTo(1 / 1.5, 12);
  // A whole product with float error is not grown by a pixel.
  // (x0 0.29 x 100 = 28.999999999999996, y1 0.3 x 100 = 30.000000000000004.)
  expect(patchPlan([0.29, 0.1, 0.01, 0.2], { x: 0, y: 0, k: 100 }, 1)?.plan).toMatchObject({ w: 1, h: 20, origin: { x: 29, y: 10 } });
  // 2048 device px is a target; one more, or nothing, is none.
  expect(patchPlan([0, 0, 1024, 10], { x: 0, y: 0, k: 1 }, 2)?.plan).toMatchObject({ w: MAX_TEXTURE_PX, h: 20 });
  expect(patchPlan([0, 0, 1024.5, 10], { x: 0, y: 0, k: 1 }, 2)).toBeNull();
  expect(patchPlan([0, 0, 10, 1025], { x: 0, y: 0, k: 1 }, 2)).toBeNull();
  expect(patchPlan([5, 5, 0, 10], { x: 0, y: 0, k: 1 }, 2)).toBeNull();
});

test('flatten: the ledger drops a target only on its destroy event', () => {
  const ledger = createGpuLedger();
  expect(ledger.stats()).toEqual({ targets: 0, targetBytes: 0, targetsCreated: 0, targetsDestroyed: 0 });
  const a = fakeGpuObject();
  const b = fakeGpuObject();
  ledger.track('target', 5_266_560, a);
  ledger.track('target', 1_000, b);
  expect(ledger.stats()).toEqual({ targets: 2, targetBytes: 5_267_560, targetsCreated: 2, targetsDestroyed: 0 });
  // Pixi's destroy event (TextureSource.destroy: unload, then emit) is the only way down.
  a.emit('destroy');
  expect(ledger.stats()).toEqual({ targets: 1, targetBytes: 1_000, targetsCreated: 2, targetsDestroyed: 1 });
  // A second destroy of the same object changes nothing.
  a.emit('destroy');
  expect(ledger.stats()).toEqual({ targets: 1, targetBytes: 1_000, targetsCreated: 2, targetsDestroyed: 1 });
  b.emit('destroy');
  expect(ledger.stats()).toEqual({ targets: 0, targetBytes: 0, targetsCreated: 2, targetsDestroyed: 2 });
});

test('flatten: the module imports neither pixi.js nor gsap', () => {
  // Pure by its imports (CH §5.3, review O6): its vitests run in node, and only controller.ts makes a Pixi target.
  const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  expect(specifiers.length).toBeGreaterThan(0);
  expect(specifiers.filter((s) => s === undefined || /^(?:pixi\.js|gsap)(?:\/|$)/.test(s))).toEqual([]);
});
