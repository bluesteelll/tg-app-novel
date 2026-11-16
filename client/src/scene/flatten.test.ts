// The flatten plans and the GPU ledger (docs/plans/shots §5.5, CH §5.3, lane SH6): pure, so they run in node with no
// Pixi value; the Pixi half (a real TextureSource emitting `destroy`) is pinned in controller.test.ts.
import { expect, test } from 'vitest';

import { createGpuLedger, snapshotPlan } from './flatten.ts';
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
