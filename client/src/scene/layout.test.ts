import { expect, test } from 'vitest';

import type { ImageEntry } from '../story/catalog.ts';
import { charPlacement, renderResolution, textureGeometry } from './layout.ts';

test('layout: resolution capped at 2', () => {
  expect(renderResolution(3, 'HIGH')).toBe(2);
  expect(renderResolution(1.5, 'AVERAGE')).toBe(1.5);
  expect(renderResolution(2, 'HIGH')).toBe(2);
  expect(renderResolution(3, 'LOW')).toBe(1);
  expect(renderResolution(Number.NaN, 'HIGH')).toBe(1);
  expect(renderResolution(Number.POSITIVE_INFINITY, 'HIGH')).toBe(1);
  expect(renderResolution(0, 'AVERAGE')).toBe(1);
});

test('layout: characters at slot fractions, never upscaled', () => {
  const s390 = { w: 390, h: 844 };
  const sprite = { w: 768, h: 1536 };
  expect(charPlacement(s390, 'left', sprite, 2).x).toBe(97.5);
  expect(charPlacement(s390, 'center', sprite, 2).x).toBe(195);
  expect(charPlacement(s390, 'right', sprite, 2).x).toBe(292.5);
  expect(charPlacement(s390, 'center', sprite, 2).y).toBe(844);
  // 0.78 × 844 = 658.32 CSS px = 1316.64 device px ≤ 1536 source px: the stage height binds.
  expect(charPlacement(s390, 'center', sprite, 2).h).toBeCloseTo(658.32, 9);
  // A tall tablet stage: 0.78 × 1366 = 1065.48 CSS px would be 2130.96 device px > 1536; the source binds.
  expect(charPlacement({ w: 1024, h: 1366 }, 'center', sprite, 2).h).toBeCloseTo(768, 9);
  expect(charPlacement({ w: 1024, h: 1366 }, 'center', sprite, 1).h).toBeCloseTo(1065.48, 9);
});

test('layout: a trimmed file keeps its canvas as orig', () => {
  const entry = (w: number, h: number, trim?: ImageEntry['trim']): ImageEntry => ({
    kind: 'image',
    w,
    h,
    decodedBytes: w * h * 4,
    avif: { url: '/assets/x.avif', bytes: 100 },
    webp: { url: '/assets/x.webp', bytes: 120 },
    ...(trim === undefined ? {} : { trim }),
  });
  // MEMORY-PLAN 4.B: the stored 466×1394 alpha box sits at (151, 142) on the 768×1536 canvas; Pixi lays it out as
  // the canvas when `orig` is the canvas and `trim` the stored box.
  const sprite = textureGeometry(entry(466, 1394, { canvasW: 768, canvasH: 1536, x: 151, y: 142 }));
  expect(sprite.orig).toEqual({ x: 0, y: 0, w: 768, h: 1536 });
  expect(sprite).toEqual({ canvas: { w: 768, h: 1536 }, orig: { x: 0, y: 0, w: 768, h: 1536 }, trim: { x: 151, y: 142, w: 466, h: 1394 }, resolution: 1 });
  // Control: an untrimmed file is its own canvas.
  expect(textureGeometry(entry(1080, 2048))).toEqual({ canvas: { w: 1080, h: 2048 }, orig: { x: 0, y: 0, w: 1080, h: 2048 }, trim: null, resolution: 1 });
});
