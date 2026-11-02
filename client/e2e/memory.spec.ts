// MEMORY-PLAN M1's placement e2e (section 11 commit 6): a trimmed character renders where its canvas puts it. The
// expected colours and edges come from the placeholder renderer itself (rasterized here in Node, as the asset tool's
// encoder does) and the stage layout from scene/layout.ts, so neither is copied. Every sample is first checked against
// the sample rule (critique_r3 open question 2; M3c reuses it on the half tier): a uniform neighbourhood of >= 4 CSS px
// in both rasters, >= 4 CSS px inside the stage, the canvas on top. Then the pixel is read with the shared stagePixel.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';
import sharp from 'sharp';

import { catalogImage, decodeAssetCatalog, decodeAssetManifest } from '../scripts/assets/manifest.ts';
import { renderPlaceholder } from '../scripts/assets/placeholder.ts';
import { t } from '../src/i18n/index.ts';
import { backdropPlacement, charPlacement, renderResolution } from '../src/scene/layout.ts';
import type { AssetId } from '../src/story/staging.ts';
import { atRest, expect, launch, stagePixel, test } from './helpers.ts';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(E2E_DIR, '..');
const LINE_MS = 30_000;

const ALLY = 'char/ally/neutral' as AssetId; // story/ch1/main.ink `arrival`: `# show: ally neutral at=left`
const STREET = 'bg/street' as AssetId; // `# scene: street`
const FIRST_LINE = 'ch1.arrival.a001';
/** MEMORY-PLAN §11 commit 6: the sample rule's margin and the colour tolerances, per RGB channel. */
const MARGIN_CSS = 4;
const TOLERANCE = 12;
const CONTRAST = 24;

type Rgba = [number, number, number, number];
type Raster = { w: number; h: number; data: Buffer };

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
