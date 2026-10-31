import { expect, test } from 'vitest';

import { backdropPlacement } from '../scene/layout.ts';
import type { Rect } from '../story/staging.ts';
import { ROOM_SOURCE, cover, minTarget, toStage } from './cover.ts';

// A 390×844 CSS px phone stage: the height binds, scale 844 / 2048 = 211/512, so every number below is exact.
const S390 = { w: 390, h: 844 };

test('cover: hotspot rect follows the bg cover transform', () => {
  const c = cover(S390, ROOM_SOURCE);
  const rect: Rect = [80, 160, 920, 1600];
  const box = toStage(rect, c);
  expect(box.x).toBe(5.4296875);
  expect(box.y).toBe(65.9375);
  expect(box.w).toBe(379.140625);
  expect(box.h).toBe(659.375);
  expect(c.scale).toBe(0.412109375);
  expect(c.offsetX).toBe(-27.5390625);
  expect(c.offsetY).toBe(0);
  // The bg sprite's own transform maps the same corners to the same stage px.
  const bg = backdropPlacement(S390);
  const [x, y, w, h] = rect;
  expect({ x: x * bg.scale + bg.offsetX, y: y * bg.scale + bg.offsetY }).toEqual({ x: box.x, y: box.y });
  expect({ x: (x + w) * bg.scale + bg.offsetX, y: (y + h) * bg.scale + bg.offsetY }).toEqual({
    x: box.x + box.w,
    y: box.y + box.h,
  });
});

test('cover: small target expanded to 44 px', () => {
  const small = minTarget({ x: 178.515625, y: 370.8984375, w: 41.2109375, h: 41.2109375 }, 44);
  expect(small.w).toBe(44);
  expect(small.h).toBe(44);
  expect(small.x).toBe(177.12109375);
  expect(small.y).toBe(369.50390625);
  // The centre is kept.
  expect(small.x + small.w / 2).toBe(178.515625 + 41.2109375 / 2);
  expect(small.y + small.h / 2).toBe(370.8984375 + 41.2109375 / 2);
  // A box already at least 44 px on each side is unchanged.
  const big = { x: 10, y: 20, w: 61.8, h: 61.8 };
  expect(minTarget(big, 44)).toEqual(big);
  // The composed path: a 100 px source rect at the 390 px stage is 41.2 CSS px, expanded around its centre.
  const composed = minTarget(toStage([500, 900, 100, 100], cover(S390, ROOM_SOURCE)), 44);
  expect(composed).toEqual({ x: 177.12109375, y: 369.50390625, w: 44, h: 44 });
});
