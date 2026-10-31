import { expect, test } from 'vitest';

import { charPlacement, renderResolution } from './layout.ts';

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
