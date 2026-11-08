// Lane LHJ's e2e (QO19, S36 step 1b): the chapter handover keeps the next chapter's art that is still in flight. At
// ch3's last knot GameSession preloads ch4's first knot under `next:ch4` (F5); at the handover it holds that knot under
// `preload:lamp` and releases `next:ch4` in the same turn (app/game.ts enterKnot step 1). char/keeper/smile is off stage
// by then (the c002 path), so `next:ch4` requests it again; the spec holds that request across the handover. A
// preload item whose record is in flight joins it at once, so the release keeps the fetch: one request, none aborted.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { t } from '../src/i18n/index.ts';
import { decodeAssetManifest } from '../src/story/catalog.ts';
import type { AssetId } from '../src/story/staging.ts';
import { debugStats, expect, grantChapter, holdRequests, launch, reachLine, requests, test } from './helpers.ts';

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINE_MS = 30_000;

/** Every file of `id` in ch3's free manifest, as the build under test ships it: full and half, AVIF and WebP. */
function ch3Files(id: string): string[] {
  const manifest = decodeAssetManifest(JSON.parse(readFileSync(path.join(CLIENT_DIR, 'src', 'story-gen', 'free', 'ch3.assets.json'), 'utf8')));
  const entry = manifest.ok ? manifest.value.assets[id as AssetId] : undefined; // a fixture id: the decoder brands it
  if (entry?.kind !== 'image') {
    throw new Error(`ch3.assets.json has no image ${id}`);
  }
  return [entry, ...(entry.half === undefined ? [] : [entry.half])].flatMap((f) => [f.avif.url, f.webp.url]);
}

/** An absolute URL whose path is exactly one of `paths` (each escaped). */
function pathRe(paths: readonly string[]): RegExp {
  const escaped = paths.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^https?://[^/]+(?:${escaped.join('|')})$`);
}

test.use({ reducedMotion: 'reduce' });

test('handover: a next-chapter image in flight at the handover is fetched once', async ({ page, request }) => {
  test.setTimeout(180_000);
  await grantChapter(request, 1101, 'chapter:ch4');
  await launch(page, 1101);
  const start = page.locator('[data-story="tide"]').getByRole('button', { name: t('ru', 'stories.start') });
  await expect(start).toBeVisible({ timeout: LINE_MS });
  await start.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
  // The keeper smiles at l008: the sprite is live, held by `preload:lighthouse`, and leaves the stage at l010.
  await reachLine(page, 'ch3.lighthouse.l008', { 'ch3.shore.c001': 1 });

  const files = ch3Files('char/keeper/smile');
  expect(files.length, 'the sprite ships its files').toBeGreaterThanOrEqual(2);
  const match = pathRe(files);
  const smile = requests(page, match);
  const failed: string[] = [];
  page.on('requestfailed', (r) => {
    if (match.test(r.url())) {
      failed.push(`${r.url()}: ${r.failure()?.errorText ?? 'failed'}`);
    }
  });
  const held = await holdRequests(page, '**/assets/char-keeper-smile-*');

  // The c002 path: the stairs' entry releases `preload:lighthouse` (the sprite ends) and preloads ch4's first knot.
  await reachLine(page, 'ch3.lighthouse_stairs.t011', { 'ch3.lighthouse.c001': 1 });
  await expect
    .poll(() => smile.urls.length, {
      timeout: LINE_MS,
      message: "fixture shape absent: ch4's opening never requested char/keeper/smile before the handover",
    })
    .toBe(1);

  // END: the handover to ch4, with the sprite's request still held.
  await page.locator('.dialogue .tap').tap();
  await expect(page.locator('.dialogue[data-line-id="ch4.lamp.a001"]')).toBeVisible({ timeout: LINE_MS });
  await held.release();
  await expect.poll(async () => (await debugStats(page)).scene.pendingLoads, { timeout: LINE_MS }).toBe(0);

  expect(smile.urls, 'one fetch of the in-flight next-chapter image').toHaveLength(1);
  expect(failed, 'no fetch of it aborted at the handover').toEqual([]);
});
