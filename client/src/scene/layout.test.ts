import { expect, test } from 'vitest';

import { ROOM_SOURCE, cover } from '../geom/cover.ts';
import { decodeAssetManifest } from '../story/catalog.ts';
import type { ImageEntry } from '../story/catalog.ts';
import type { AssetId } from '../story/staging.ts';
import { CHAR_HEIGHT, charPlacement, halfFits, renderResolution, stageBound, textureGeometry, tierFor } from './layout.ts';

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
  const sprite = textureGeometry(entry(466, 1394, { canvasW: 768, canvasH: 1536, x: 151, y: 142 }), 'full');
  expect(sprite.orig).toEqual({ x: 0, y: 0, w: 768, h: 1536 });
  expect(sprite).toEqual({ canvas: { w: 768, h: 1536 }, orig: { x: 0, y: 0, w: 768, h: 1536 }, trim: { x: 151, y: 142, w: 466, h: 1394 }, resolution: 1 });
  // Control: an untrimmed file is its own canvas.
  expect(textureGeometry(entry(1080, 2048), 'full')).toEqual({ canvas: { w: 1080, h: 2048 }, orig: { x: 0, y: 0, w: 1080, h: 2048 }, trim: null, resolution: 1 });
});

// MEMORY-PLAN 4.C: the half tier. A half file is laid out as its full file, and is used only where no half is drawn
// above its stored px.

const imageEntry = (w: number, h: number, trim?: ImageEntry['trim']): ImageEntry => ({
  kind: 'image',
  w,
  h,
  decodedBytes: w * h * 4,
  avif: { url: '/assets/x.avif', bytes: 100 },
  webp: { url: '/assets/x.webp', bytes: 120 },
  ...(trim === undefined ? {} : { trim }),
});

test('layout: half tier keeps the canvas and the full trim rect at resolution 0.5', () => {
  const ally = imageEntry(466, 1394, { canvasW: 768, canvasH: 1536, x: 151, y: 142 });
  expect(textureGeometry(ally, 'half')).toEqual({
    canvas: { w: 768, h: 1536 },
    orig: { x: 0, y: 0, w: 768, h: 1536 },
    trim: { x: 151, y: 142, w: 466, h: 1394 },
    resolution: 0.5,
  });
  expect(textureGeometry(imageEntry(1080, 2048), 'half')).toEqual({
    canvas: { w: 1080, h: 2048 },
    orig: { x: 0, y: 0, w: 1080, h: 2048 },
    trim: null,
    resolution: 0.5,
  });
});

test('layout: no decodable half is drawn above its stored px', () => {
  // critique_r3 W1, r4 O3: every candidate is decoded as the build would ship it; the ones the decoder refuses (a char
  // off the 1536-px canvas) load their full file on either tier and are no half candidates.
  const half = (name: string, w: number, h: number): Record<string, unknown> => ({
    w,
    h,
    decodedBytes: w * h * 4,
    avif: { url: `/assets/${name}-half-0f0f0f0f.avif`, bytes: 30 },
    webp: { url: `/assets/${name}-half-0f0f0f0f.webp`, bytes: 40 },
  });
  const raw = (name: string, w: number, h: number, extra: Record<string, unknown>): Record<string, unknown> => ({
    kind: 'image',
    w,
    h,
    decodedBytes: w * h * 4,
    avif: { url: `/assets/${name}-0a0a0a0a.avif`, bytes: 100 },
    webp: { url: `/assets/${name}-0a0a0a0a.webp`, bytes: 120 },
    ...extra,
  });
  const candidates: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['bg/street', raw('bg-street', 1080, 2048, { half: half('bg-street', 540, 1024) })],
    ['char/ally/neutral', raw('char-ally-neutral', 466, 1394, { trim: { canvasW: 768, canvasH: 1536, x: 151, y: 142 }, half: half('char-ally-neutral', 233, 697) })],
    ['char/small/neutral', raw('char-small-neutral', 400, 1100, { trim: { canvasW: 600, canvasH: 1200, x: 100, y: 50 }, half: half('char-small-neutral', 200, 550) })],
    ['char/short/neutral', raw('char-short-neutral', 768, 1024, { half: half('char-short-neutral', 384, 512) })],
  ];
  const halves: Array<{ id: string; entry: ImageEntry }> = [];
  for (const [id, entry] of candidates) {
    const m = decodeAssetManifest({ chapterId: 'ch1', assets: { [id]: entry } });
    const decoded = m.ok ? m.value.assets[id as AssetId] : undefined; // a fixture id, checked by the decoder
    if (decoded?.kind === 'image' && decoded.half !== undefined) {
      halves.push({ id, entry: decoded });
    }
  }
  // Non-vacuity: the bg and the canonical char ship a half, and the half tier occurs.
  expect(halves.map((c) => c.id)).toEqual(['bg/street', 'char/ally/neutral']);
  expect(tierFor('LOW', { w: 360, h: 800 }, 1)).toBe('half');
  // Device px per canvas px: the bg through the cover transform, a char at min(0.78 H r, c) over its canvas height c.
  const perCanvasPx = (id: string, entry: ImageEntry, stage: { w: number; h: number }, r: number): number => {
    if (!id.startsWith('char/')) {
      return cover(stage, ROOM_SOURCE).scale * r;
    }
    const c = entry.trim?.canvasH ?? entry.h;
    return Math.min(CHAR_HEIGHT * stage.h * r, c) / c;
  };
  const above: string[] = [];
  const band = new Map<number, string[]>([
    [1, []],
    [1.5, []],
    [2, []],
  ]);
  let halfStages = 0;
  for (const r of [1, 1.5, 2]) {
    for (let w = 320; w <= 1280; w += 8) {
      for (let h = 480; h <= 2048; h += 8) {
        const stage = { w, h };
        const tier = tierFor('LOW', stage, r);
        // The char term's band: the bg term holds and 0.78 H r > 768.
        if (cover(stage, ROOM_SOURCE).scale * r <= 0.5 && CHAR_HEIGHT * h * r > 768) {
          band.get(r)?.push(`${w}x${h}:${tier}`);
        }
        if (tier !== 'half') {
          continue;
        }
        halfStages += 1;
        for (const { id, entry } of halves) {
          const ratio = perCanvasPx(id, entry, stage, r);
          if (ratio > 0.5) {
            above.push(`${id} at ${w}x${h} r=${r}: ${ratio.toFixed(3)} device px per canvas px`);
          }
        }
      }
    }
  }
  expect(halfStages).toBeGreaterThan(0);
  expect(above, 'a half drawn above its stored px').toEqual([]);
  expect([band.get(1)?.length, band.get(1.5)?.length, band.get(2)?.length]).toEqual([140, 18, 0]);
  expect([...band.values()].flat().filter((s) => !s.endsWith(':full')), 'band stages on the half tier').toEqual([]);
  // critique_r4 O3: at 360 x 1000, r = 1, the bg term holds and the char term fails.
  expect(cover({ w: 360, h: 1000 }, ROOM_SOURCE).scale).toBeCloseTo(0.488, 3);
  expect((CHAR_HEIGHT * 1000) / 1536).toBeCloseTo(0.508, 3);
  expect(tierFor('LOW', { w: 360, h: 1000 }, 1)).toBe('full');
});

test('layout: a LOW tablet keeps the full tier', () => {
  // critique W2: an 800 x 1280 tablet at resolution 1 would draw the bg half at 1.33 x its px.
  const bound = stageBound({ w: 800, h: 1280 }, { w: 664, h: 1180 });
  expect(bound).toEqual({ w: 720, h: 1280 });
  expect(tierFor('LOW', bound, 1)).toBe('full');
});

test('layout: a LOW 360 x 800 phone takes the half tier', () => {
  const bound = stageBound({ w: 360, h: 800 }, { w: 360, h: 740 });
  expect(bound).toEqual({ w: 360, h: 800 });
  expect(tierFor('LOW', bound, 1)).toBe('half');
  // At resolution 2 the bg term fails (W x 2 = 720 > 540).
  expect(tierFor('LOW', bound, 2)).toBe('full');
  // The screen's long side is its portrait height, whichever orientation it reports.
  expect(stageBound({ w: 800, h: 360 }, { w: 360, h: 740 })).toEqual({ w: 360, h: 800 });
});

test('layout: a screen of unknown size takes the full tier', () => {
  // The host alone would fit the half tier: only the unknown screen keeps the full one.
  const host = { w: 360, h: 740 };
  expect(halfFits(host, 1)).toBe(true);
  for (const screen of [null, { w: Number.NaN, h: 800 }, { w: 360, h: 0 }, { w: -1, h: 800 }, { w: 360, h: Number.POSITIVE_INFINITY }]) {
    expect(tierFor('LOW', stageBound(screen, host), 1), JSON.stringify(screen)).toBe('full');
  }
  expect(halfFits({ w: Number.NaN, h: 800 }, 1)).toBe(false);
  expect(halfFits({ w: 360, h: 800 }, Number.POSITIVE_INFINITY)).toBe(false);
});

test('layout: tierFor takes the half tier only for LOW', () => {
  const bound = stageBound({ w: 360, h: 800 }, { w: 360, h: 740 });
  expect(tierFor('AVERAGE', bound, 1)).toBe('full');
  expect(tierFor('HIGH', bound, 1)).toBe('full');
  expect(tierFor('LOW', bound, 1)).toBe('half'); // control
});
