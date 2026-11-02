// MEMORY-PLAN M1's placement e2e (section 11 commit 6): a trimmed character renders where its canvas puts it. The
// expected colours and edges come from the placeholder renderer itself (rasterized here in Node, as the asset tool's
// encoder does) and the stage layout from scene/layout.ts, so neither is copied. Every sample is first checked against
// the sample rule (critique_r3 open question 2; M3c reuses it on the half tier): a uniform neighbourhood of >= 4 CSS px
// in both rasters, >= 4 CSS px inside the stage, the canvas on top. Then the pixel is read with the shared stagePixel.
// MEMORY-PLAN M2 (section 11): a context loss nothing restores reaches the D13 rebuild, and the stage it draws again
// is the one before the loss, with no image fetched again; a revive whose decode fails ends that record, and the stage
// takes the visual again with one GET of its file; no decoded bitmap stays open once its texture is uploaded.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';
import sharp from 'sharp';

import { catalogImage, decodeAssetCatalog, decodeAssetManifest } from '../scripts/assets/manifest.ts';
import { renderPlaceholder } from '../scripts/assets/placeholder.ts';
import { t } from '../src/i18n/index.ts';
import { backdropPlacement, charPlacement, renderResolution } from '../src/scene/layout.ts';
import type { ImageEntry } from '../src/story/catalog.ts';
import type { AssetId } from '../src/story/staging.ts';
import { atRest, expect, launch, reachLine, requests, stagePixel, test, type E2eWindow } from './helpers.ts';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(E2E_DIR, '..');
const LINE_MS = 30_000;

const ALLY = 'char/ally/neutral' as AssetId; // story/ch1/main.ink `arrival`: `# show: ally neutral at=left`
const STREET = 'bg/street' as AssetId; // `# scene: street`
/** `# show: stranger neutral at=right`, before `a005`: not in `next(arrival)`, so first fetched there (M2 commit 1). */
const STRANGER = 'char/stranger/neutral' as AssetId;
const FIRST_LINE = 'ch1.arrival.a001';
const STRANGER_LINE = 'ch1.arrival.a005';
/** MEMORY-PLAN §11 commit 6: the sample rule's margin and the colour tolerances, per RGB channel. */
const MARGIN_CSS = 4;
const TOLERANCE = 12;
const CONTRAST = 24;
/** scene/controller.ts CONTEXT_GRACE_MS (2000; not imported: the module loads pixi.js) plus the rebuild's own time. */
const REBUILD_MS = 2_000 + 3_000;
/** The art the stage fetches (the debug hook, chunks and the API are not images). */
const IMAGE_URL = /\.(?:avif|webp)(?:\?|$)/;
/** The placeholder head's centre on the 768×1536 char canvas (scripts/assets/placeholder.ts: cy = 0.18 h). */
const HEAD: readonly [number, number] = [384, 276];

type Rgba = [number, number, number, number];
type Raster = { w: number; h: number; data: Buffer };

/**
 * The M2 fields of `__novelDebug` this spec reads. helpers.ts (frozen in this lane) names neither them nor the loss
 * mode; its next holder folds them into DebugStats / NovelDebug. Not a type import of scene/controller.ts: that module
 * loads pixi.js into the node project's check.
 */
type M2Scene = {
  rebuilds: number;
  liveTextures: number;
  pendingLoads: number;
  openBitmaps: number;
  stale: number;
  staleFrames: number;
  reviveFailed: number;
  reviving: boolean;
  visibleReviveMs: number | null;
};
type M2Debug = { stats(): { scene: M2Scene }; forceContextLoss(mode: 'restorable' | 'hard'): void };
type M2Window = Omit<E2eWindow, '__novelDebug'> & { __novelDebug?: M2Debug };

/** An asset's placeholder as the asset tool rasterizes it before encoding (sharp at its default 72 dpi: 1 px per unit). */
async function placeholder(id: AssetId): Promise<Raster> {
  const decoded = decodeAssetCatalog(JSON.parse(readFileSync(path.join(CLIENT_DIR, '..', 'assets', 'catalog.json'), 'utf8')));
  const entry = decoded.ok ? catalogImage(decoded.value, id) : undefined;
  if (entry === undefined) {
    throw new Error(`assets/catalog.json has no image ${id}`);
  }
  const { data, info } = await sharp(Buffer.from(renderPlaceholder(id, entry).svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data };
}

function at(r: Raster, x: number, y: number): Rgba {
  const i = (y * r.w + x) * 4;
  return [r.data[i] ?? 0, r.data[i + 1] ?? 0, r.data[i + 2] ?? 0, r.data[i + 3] ?? 0];
}

/** Every pixel within `radius` of (x, y) equals the one at (x, y), and the square lies inside the raster. */
function uniform(r: Raster, x: number, y: number, radius: number): boolean {
  const c = at(r, x, y).join();
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= r.w || yy >= r.h || at(r, xx, yy).join() !== c) {
        return false;
      }
    }
  }
  return true;
}

const deviation = (a: readonly number[], b: readonly number[]): number => Math.max(...[0, 1, 2].map((i) => Math.abs((a[i] ?? 0) - (b[i] ?? 0))));

/** The manor card's Start, then ch1's first line, with the ally on stage and nothing loading or moving. */
async function firstLineAtRest(page: Page): Promise<void> {
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: t('ru', 'stories.start') });
  await expect(start).toBeVisible({ timeout: LINE_MS });
  await start.tap();
  await expect(page.locator(`.dialogue[data-line-id="${FIRST_LINE}"]`)).toBeVisible({ timeout: LINE_MS });
  await atRest(page);
}

/** An image entry of ch1's free manifest, as the build under test ships it. */
function ch1Image(id: AssetId): ImageEntry {
  const manifest = decodeAssetManifest(JSON.parse(readFileSync(path.join(CLIENT_DIR, 'src', 'story-gen', 'free', 'ch1.assets.json'), 'utf8')));
  const entry = manifest.ok ? manifest.value.assets[id] : undefined;
  if (entry?.kind !== 'image') {
    throw new Error(`ch1.assets.json has no image ${id}`);
  }
  return entry;
}

/** The scene's M2 stats through the debug hook. */
async function sceneStats(page: Page): Promise<M2Scene> {
  await page.waitForFunction(() => '__novelDebug' in window);
  return page.evaluate(() => {
    const hook = (window as unknown as M2Window).__novelDebug;
    if (hook === undefined) {
      throw new Error('__novelDebug is gone');
    }
    return hook.stats().scene;
  });
}

/** The stage's size in CSS px (the canvas box). */
async function stageSize(page: Page): Promise<{ w: number; h: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) {
    throw new Error('no canvas');
  }
  return { w: box.width, h: box.height };
}

/**
 * A character's head centre on the stage at `slot`, checked against the sample rule first (a uniform neighbourhood of
 * MARGIN_CSS in the sprite and bg rasters, inside the stage, the canvas on top). `expected` is the sprite's colour
 * there, `bg` the backdrop's under it.
 */
async function headSample(
  page: Page,
  stage: { w: number; h: number },
  slot: 'left' | 'right',
  sprite: Raster,
  street: Raster,
): Promise<{ x: number; y: number; expected: Rgba; bg: Rgba }> {
  const p = charPlacement(stage, slot, { w: sprite.w, h: sprite.h }, renderResolution(1, 'AVERAGE'));
  const s = p.h / sprite.h;
  const [cx, cy] = HEAD;
  const x = Math.round(p.x + (cx - sprite.w / 2) * s);
  const y = Math.round(p.y - (sprite.h - cy) * s);
  const cover = backdropPlacement(stage);
  const b = { x: Math.round((x + 0.5 - cover.offsetX) / cover.scale), y: Math.round((y + 0.5 - cover.offsetY) / cover.scale) };
  expect(uniform(sprite, cx, cy, Math.ceil(MARGIN_CSS / s)), `${slot} head: the sprite raster is uniform within ${MARGIN_CSS} CSS px`).toBe(true);
  expect(uniform(street, b.x, b.y, Math.ceil(MARGIN_CSS / cover.scale)), `${slot} head: the bg raster is uniform within ${MARGIN_CSS} CSS px`).toBe(true);
  expect(x >= MARGIN_CSS && y >= MARGIN_CSS && x <= stage.w - MARGIN_CSS && y <= stage.h - MARGIN_CSS, `${slot} head (${x}, ${y}) inside the stage`).toBe(true);
  const box = await page.locator('canvas').boundingBox();
  const top = box === null ? null : await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName ?? null, [box.x + x + 0.5, box.y + y + 0.5] as const);
  expect(top, `${slot} head: the canvas is the element at the sample`).toBe('CANVAS');
  const expected = at(sprite, cx, cy);
  expect(expected[3], `${slot} head: the sprite is opaque there`).toBe(255);
  return { x, y, expected, bg: at(street, b.x, b.y) };
}

/** URL paths fetched more than once, in first-fetch order. */
function twice(urls: readonly string[]): string[] {
  const seen = new Map<string, number>();
  for (const u of urls) {
    const p = new URL(u).pathname;
    seen.set(p, (seen.get(p) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([p, n]) => `${p} x${n}`);
}

/** `forceContextLoss('hard')`, the loss observed on the canvas itself, and no restore within 1 s (nothing restores it). */
async function hardLoss(page: Page): Promise<string[]> {
  return page.locator('canvas').evaluate(
    (canvas) =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        canvas.addEventListener('webglcontextlost', () => seen.push('lost'), { once: true });
        canvas.addEventListener('webglcontextrestored', () => seen.push('restored'), { once: true });
        (window as unknown as M2Window).__novelDebug?.forceContextLoss('hard');
        setTimeout(() => resolve([...seen]), 1_000);
      }),
  );
}

test('scene: trimmed character renders where its canvas puts it', async ({ page }) => {
  test.setTimeout(90_000);
  // Vacuity guard: the build under test ships the ally trimmed; otherwise this would test an untrimmed file.
  const manifest = decodeAssetManifest(JSON.parse(readFileSync(path.join(CLIENT_DIR, 'src', 'story-gen', 'free', 'ch1.assets.json'), 'utf8')));
  const entry = manifest.ok ? manifest.value.assets[ALLY] : undefined;
  const trim = entry?.kind === 'image' ? entry.trim : undefined;
  expect(trim, `${ALLY} in ch1.assets.json carries a trim`).toMatchObject({ canvasW: 768, canvasH: 1536 });
  expect(entry?.kind === 'image' ? entry.h : 1536, `${ALLY}: stored height under its canvas`).toBeLessThan(1536);

  const [sprite, street] = await Promise.all([placeholder(ALLY), placeholder(STREET)]);
  expect({ w: sprite.w, h: sprite.h }, 'the sprite raster is its canvas').toEqual({ w: 768, h: 1536 });

  await launch(page, 7001);
  await firstLineAtRest(page);
  const box = await page.locator('canvas').boundingBox();
  if (box === null) {
    throw new Error('no canvas');
  }
  const stage = { w: box.width, h: box.height };
  // The executor's layout at DPR 1, perf class AVERAGE (the harness context): the slot, the height on the canvas.
  const p = charPlacement(stage, 'left', { w: sprite.w, h: sprite.h }, renderResolution(1, 'AVERAGE'));
  const s = p.h / sprite.h;
  const bg = backdropPlacement(stage);
  const toCss = (cx: number, cy: number): { x: number; y: number } => ({
    x: Math.round(p.x + (cx - sprite.w / 2) * s),
    y: Math.round(p.y - (sprite.h - cy) * s),
  });
  const toBg = (x: number, y: number): { x: number; y: number } => ({
    x: Math.round((x + 0.5 - bg.offsetX) / bg.scale),
    y: Math.round((y + 0.5 - bg.offsetY) / bg.scale),
  });
  const spriteRadius = Math.ceil(MARGIN_CSS / s);
  const bgRadius = Math.ceil(MARGIN_CSS / bg.scale);

  // Canvas px of the 768×1536 placeholder (head top at y 145, body x 154..614 in the chest band, label y ~ 912-964):
  // `near` is a sprite point of the region the sample must not be confused with.
  const samples: ReadonlyArray<{ name: string; at: readonly [number, number]; near: readonly [number, number] | null }> = [
    { name: "inside the head's top edge", at: [384, 157], near: null },
    { name: 'above the head', at: [384, 133], near: [384, 157] },
    { name: 'beside the body', at: [626, 707], near: [584, 707] },
  ];
  let worst = 0;
  for (const sample of samples) {
    const [cx, cy] = sample.at;
    const css = toCss(cx, cy);
    const b = toBg(css.x, css.y);
    // The sample rule, asserted before any colour is compared.
    expect(uniform(sprite, cx, cy, spriteRadius), `${sample.name}: the sprite raster is uniform within ${MARGIN_CSS} CSS px`).toBe(true);
    expect(uniform(street, b.x, b.y, bgRadius), `${sample.name}: the bg raster is uniform within ${MARGIN_CSS} CSS px`).toBe(true);
    expect(
      css.x >= MARGIN_CSS && css.y >= MARGIN_CSS && css.x <= stage.w - MARGIN_CSS && css.y <= stage.h - MARGIN_CSS,
      `${sample.name}: (${css.x}, ${css.y}) at least ${MARGIN_CSS} CSS px inside the ${stage.w}×${stage.h} stage`,
    ).toBe(true);
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? null, [box.x + css.x + 0.5, box.y + css.y + 0.5] as const);
    expect(top, `${sample.name}: the canvas is the element at the sample`).toBe('CANVAS');
    const spritePx = at(sprite, cx, cy);
    expect([0, 255], `${sample.name}: the sprite is opaque or transparent there`).toContain(spritePx[3]);
    const opaque = spritePx[3] === 255;
    const expected = opaque ? spritePx : at(street, b.x, b.y);
    const other = sample.near === null ? at(street, b.x, b.y) : at(sprite, sample.near[0], sample.near[1]);
    expect(deviation(expected, other), `${sample.name}: ${expected.slice(0, 3).join(',')} vs the other region's ${other.slice(0, 3).join(',')}`).toBeGreaterThan(CONTRAST);

    const got = await stagePixel(page, css.x, css.y);
    const d = deviation(got, expected);
    worst = Math.max(worst, d);
    console.log(`memory: ${sample.name} at canvas (${cx}, ${cy}) = CSS (${css.x}, ${css.y}): expected ${expected.slice(0, 3).join(',')}, got ${got.slice(0, 3).join(',')}, deviation ${d}`);
    expect(d, `${sample.name}: expected ≈ (${expected.slice(0, 3).join(',')}) ±${TOLERANCE}, got ≈ (${got.slice(0, 3).join(',')})`).toBeLessThanOrEqual(TOLERANCE);
  }
  console.log(`memory: largest per-channel deviation ${worst} (tolerance ${TOLERANCE}; above ${TOLERANCE / 2} is flagged)`);
});

test('scene: an unrestored context loss rebuilds the stage', async ({ page }) => {
  test.setTimeout(120_000);
  // Vacuity guard: the stranger's file is first fetched at a005, after the rebuild (the "asset not loaded before").
  const strangerUrl = ch1Image(STRANGER).avif.url;
  const [ally, stranger, street] = await Promise.all([placeholder(ALLY), placeholder(STRANGER), placeholder(STREET)]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const images = requests(page, IMAGE_URL);

  await launch(page, 7002);
  await firstLineAtRest(page);
  expect(images.urls.map((u) => new URL(u).pathname), `${STRANGER} is not fetched before ${STRANGER_LINE}`).not.toContain(strangerUrl);
  const stage = await stageSize(page);
  // The backdrop's centre column at 12 % of the height, above the characters' heads (perf.spec.ts `context loss recovers`).
  const bgAt = { x: Math.round(stage.w / 2), y: Math.round(stage.h * 0.12) };
  const head = await headSample(page, stage, 'left', ally, street);
  const before = { bg: await stagePixel(page, bgAt.x, bgAt.y), ally: await stagePixel(page, head.x, head.y) };
  expect(Math.max(...before.bg.slice(0, 3)), `the stage before the loss: ${before.bg.join(',')}`).toBeGreaterThan(CONTRAST);
  expect(deviation(before.ally, head.expected), `the ally's head before the loss: ${before.ally.join(',')}`).toBeLessThanOrEqual(TOLERANCE);
  // critique_r5 open question 1: GETs are counted from here; what the page fetched twice before is reported.
  console.log(`memory: image URLs fetched twice before the marker: ${twice(images.urls).join(', ') || 'none'}`);
  const marker = images.urls.length;

  expect(await hardLoss(page), 'the hard loss landed and nothing restored it within 1 s').toEqual(['lost']);
  await page.evaluate(() => {
    const mock = (window as unknown as M2Window).__tgMock;
    mock.minimize();
    mock.restore();
  });
  await expect.poll(async () => (await sceneStats(page)).rebuilds, { timeout: REBUILD_MS, message: 'activated rebuilt the stage' }).toBe(1);
  // The rebuilt canvas draws its first frame after the revive's visible pass, and `rebuilds` rises before the revive
  // starts: the samples wait for the whole revive (critique r2 O1).
  await expect.poll(async () => (await sceneStats(page)).reviving, { timeout: REBUILD_MS, message: 'the revive settled' }).toBe(false);
  await atRest(page);
  const revived = await sceneStats(page);
  console.log(`memory: visible revive after the rebuild ${revived.visibleReviveMs ?? 'none'} ms`);
  expect(
    { openBitmaps: revived.openBitmaps, stale: revived.stale, staleFrames: revived.staleFrames, reviving: revived.reviving },
    'after the revive: every bitmap closed, every texture revived, no frame drawn early',
  ).toEqual({ openBitmaps: 0, stale: 0, staleFrames: 0, reviving: false });
  expect(await stageSize(page), 'the rebuilt canvas has the same box').toEqual(stage);
  const after = { bg: await stagePixel(page, bgAt.x, bgAt.y), ally: await stagePixel(page, head.x, head.y) };
  const worst = Math.max(deviation(after.bg, before.bg), deviation(after.ally, before.ally));
  console.log(
    `memory: after the rebuild bg ${before.bg.slice(0, 3).join(',')} -> ${after.bg.slice(0, 3).join(',')}, ` +
      `ally head ${before.ally.slice(0, 3).join(',')} -> ${after.ally.slice(0, 3).join(',')}, largest deviation ${worst}`,
  );
  expect(deviation(after.bg, before.bg), 'the bg after the rebuild').toBeLessThanOrEqual(TOLERANCE);
  expect(deviation(after.ally, before.ally), "the ally's head after the rebuild").toBeLessThanOrEqual(TOLERANCE);
  // Kept art is drawn again from what the page holds: no re-download of no-store files (MEMORY-PLAN 4.A).
  expect(images.urls.slice(marker), 'no image fetched after the loss').toEqual([]);
  expect(errors, 'no page error').toEqual([]);

  // The next batch that shows an asset not loaded before: it decodes and draws on the rebuilt renderer.
  await reachLine(page, STRANGER_LINE);
  await atRest(page);
  const right = await headSample(page, stage, 'right', stranger, street);
  expect(deviation(right.expected, right.bg), `the stranger's head ${right.expected.slice(0, 3).join(',')} vs the bg's ${right.bg.slice(0, 3).join(',')}`).toBeGreaterThan(CONTRAST);
  const got = await stagePixel(page, right.x, right.y);
  console.log(`memory: the stranger's head at ${STRANGER_LINE}: expected ${right.expected.slice(0, 3).join(',')}, got ${got.slice(0, 3).join(',')}`);
  expect(deviation(got, right.expected), `the stranger's head: expected ≈ (${right.expected.slice(0, 3).join(',')}) ±${TOLERANCE}`).toBeLessThanOrEqual(TOLERANCE);
  expect(errors, 'no page error').toEqual([]);
});

test('scene: a failed revive re-acquires the visual', async ({ page }) => {
  test.setTimeout(120_000);
  const [ally, street] = await Promise.all([placeholder(ALLY), placeholder(STREET)]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const images = requests(page, IMAGE_URL);

  await launch(page, 7003);
  await firstLineAtRest(page);
  const stage = await stageSize(page);
  const bgAt = { x: Math.round(stage.w / 2), y: Math.round(stage.h * 0.12) };
  const head = await headSample(page, stage, 'left', ally, street);
  const before = { bg: await stagePixel(page, bgAt.x, bgAt.y), ally: await stagePixel(page, head.x, head.y) };
  expect(Math.max(...before.bg.slice(0, 3)), `the stage before the loss: ${before.bg.join(',')}`).toBeGreaterThan(CONTRAST);
  expect(deviation(before.ally, head.expected), `the ally's head before the loss: ${before.ally.join(',')}`).toBeLessThanOrEqual(TOLERANCE);
  // Nothing loads now, so the next decode is the revive's first re-decode of a kept file (a visible record).
  expect((await sceneStats(page)).pendingLoads, 'no load before the decode is armed').toBe(0);
  await page.evaluate(() => {
    const decode = window.createImageBitmap.bind(window);
    let armed = true;
    const once = (image: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap> => {
      if (armed) {
        armed = false;
        return Promise.reject(new DOMException('e2e: the decode fails once', 'InvalidStateError'));
      }
      return decode(image, options);
    };
    // The loader calls the one-source form only (scene/loader.ts); the crop overload is never reached.
    window.createImageBitmap = once as typeof window.createImageBitmap;
  });
  console.log(`memory: image URLs fetched twice before the marker: ${twice(images.urls).join(', ') || 'none'}`);
  const marker = images.urls.length;
  const fetchedBefore = images.urls.slice(0, marker).map((u) => new URL(u).pathname);

  expect(await hardLoss(page), 'the hard loss landed and nothing restored it within 1 s').toEqual(['lost']);
  await page.evaluate(() => {
    const mock = (window as unknown as M2Window).__tgMock;
    mock.minimize();
    mock.restore();
  });
  await expect.poll(async () => (await sceneStats(page)).rebuilds, { timeout: REBUILD_MS, message: 'activated rebuilt the stage' }).toBe(1);
  await expect
    .poll(
      async () => {
        const s = await sceneStats(page);
        return !s.reviving && s.pendingLoads === 0;
      },
      { timeout: 5_000, message: 'the revive settled and the re-acquired visual loaded' },
    )
    .toBe(true);
  await atRest(page);
  const revived = await sceneStats(page);
  console.log(`memory: visible revive after the failed decode ${revived.visibleReviveMs ?? 'none'} ms`);
  expect(
    { reviveFailed: revived.reviveFailed, rebuilds: revived.rebuilds, openBitmaps: revived.openBitmaps, stale: revived.stale },
    'one record ended by the failed decode, every other one revived',
  ).toEqual({ reviveFailed: 1, rebuilds: 1, openBitmaps: 0, stale: 0 });
  const after = { bg: await stagePixel(page, bgAt.x, bgAt.y), ally: await stagePixel(page, head.x, head.y) };
  console.log(
    `memory: after the failed revive bg ${before.bg.slice(0, 3).join(',')} -> ${after.bg.slice(0, 3).join(',')}, ` +
      `ally head ${before.ally.slice(0, 3).join(',')} -> ${after.ally.slice(0, 3).join(',')}`,
  );
  expect(deviation(after.bg, before.bg), 'the bg after the failed revive').toBeLessThanOrEqual(TOLERANCE);
  expect(deviation(after.ally, before.ally), "the ally's head after the failed revive").toBeLessThanOrEqual(TOLERANCE);
  // The ended record's slot is taken again on a new record: one GET of a file the page fetched before (F10).
  const fetched = images.urls.slice(marker).map((u) => new URL(u).pathname);
  console.log(`memory: image GETs after the marker: ${fetched.join(', ') || 'none'}`);
  expect(fetched, 'exactly one image GET after the loss').toHaveLength(1);
  expect(fetchedBefore, `${fetched.join(', ')} was fetched before the marker`).toContain(fetched[0]);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
  expect(images.urls.slice(marker).map((u) => new URL(u).pathname), 'no image GET 500 ms later').toEqual(fetched);
  expect(errors, 'no page error').toEqual([]);
});

test('scene: no decoded bitmap outlives its upload', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await launch(page, 7004);
  await firstLineAtRest(page);
  const first = await sceneStats(page);
  console.log(`memory: at ${FIRST_LINE} ${first.liveTextures} live textures, ${first.openBitmaps} open bitmaps`);
  // Vacuity guard: the stage's visuals and a preload-only record of `next(arrival)` are live (MEMORY-PLAN M2 commit 6).
  expect(first.liveTextures, `live textures at ${FIRST_LINE}`).toBeGreaterThanOrEqual(3);
  expect(first.openBitmaps, `open bitmaps at ${FIRST_LINE}`).toBe(0);
  // A visible load after the first line (the stranger, first fetched at a005).
  await reachLine(page, STRANGER_LINE);
  await atRest(page);
  const later = await sceneStats(page);
  console.log(`memory: at ${STRANGER_LINE} ${later.liveTextures} live textures, ${later.openBitmaps} open bitmaps`);
  expect(later.openBitmaps, `open bitmaps at ${STRANGER_LINE}`).toBe(0);
  expect(errors, 'no page error').toEqual([]);
});
