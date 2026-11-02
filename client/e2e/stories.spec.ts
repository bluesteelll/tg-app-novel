// L15b's stories e2e (STORIES-PLAN "Test strategy", e2e; D17 / RULINGS 85 F1 MB5): Home's two story cards, saves kept
// per story, the second story's free chapter then its paywall, a declared ending recorded on the server, BackButton
// on the chapter list, the picker gone during play, and a locked chapter row leading to the paywall without a load.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext, Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import { catalogTitle, devToken, expect, launch, lineId, reachLine, requests, test, type E2eWindow } from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);

const LINE_MS = 30_000;
const COVERS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'story-gen', 'covers.json');

test.use({ reducedMotion: 'reduce' });

function mock(page: Page, action: 'pressBack'): Promise<void> {
  return page.evaluate((a) => (window as unknown as E2eWindow).__tgMock[a](), action);
}

function card(page: Page, story: string) {
  return page.locator(`[data-story="${story}"]`);
}

/** A card's Start or Continue, then the first line of the session. */
async function play(page: Page, story: string, button: 'stories.start' | 'stories.continue'): Promise<void> {
  const b = card(page, story).getByRole('button', { name: ru(button) });
  await expect(b).toBeVisible();
  await b.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

/** The menu's "Back to stories": the session ends, Home lists the saves again. */
async function backToStories(page: Page): Promise<void> {
  await page.getByRole('button', { name: ru('quick.menu') }).tap();
  await page.getByRole('button', { name: ru('menu.back_to_stories') }).tap();
  await expect(card(page, 'manor')).toBeVisible({ timeout: 10_000 });
}

/** The server's price of `chapterId`, from `GET /api/entitlements` (principle 1: never a client constant). */
async function price(request: APIRequestContext, uid: number, chapterId: string): Promise<number> {
  const res = await request.get('/api/entitlements', { headers: { Authorization: `Bearer ${await devToken(request, uid)}` } });
  expect(res.status(), 'GET /api/entitlements').toBe(200);
  const body = (await res.json()) as { products: Array<{ chapterId: string; priceStars: number }> };
  const p = body.products.find((x) => x.chapterId === chapterId);
  if (p === undefined) {
    throw new Error(`no product for ${chapterId}`);
  }
  return p.priceStars;
}

test('stories: picker lists both stories with covers', async ({ page }) => {
  await launch(page, 6001);
  const covers = JSON.parse(readFileSync(COVERS, 'utf8')) as { assets: Record<string, { webp: { url: string } }> };
  for (const [story, cover] of [
    ['manor', 'cover/manor'],
    ['tide', 'cover/tide'],
  ] as const) {
    const img = card(page, story).locator('img');
    await expect(card(page, story)).toBeVisible();
    await expect(card(page, story).getByRole('heading', { name: catalogTitle(story) })).toBeVisible();
    await expect(img).toHaveAttribute('src', covers.assets[cover]?.webp.url ?? '<missing in covers.json>');
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { message: `${story} cover decoded` }).toBeGreaterThan(0);
  }
});

test('stories: saves are per story', async ({ page }) => {
  test.setTimeout(180_000);
  await launch(page, 6002);
  const manorLine = 'ch1.arrival.a003';
  const tideLine = 'ch3.shore.s003';
  await play(page, 'manor', 'stories.start');
  await reachLine(page, manorLine);
  await backToStories(page);
  await play(page, 'tide', 'stories.start');
  await reachLine(page, tideLine);
  await backToStories(page);

  await play(page, 'manor', 'stories.continue');
  await expect.poll(() => lineId(page)).toBe(manorLine);
  await backToStories(page);
  await play(page, 'tide', 'stories.continue');
  await expect.poll(() => lineId(page)).toBe(tideLine);
});

test('stories: second story first chapter free then paywall', async ({ page, request }) => {
  test.setTimeout(180_000);
  const refused: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 403) {
      refused.push(r.url());
    }
  });
  await launch(page, 6003);
  await play(page, 'tide', 'stories.start');
  await reachLine(page, 'ch3.lighthouse_stairs.t011', { 'ch3.shore.c001': 1 });
  await page.locator('.dialogue .tap').tap();
  await expect(page.getByRole('heading', { name: catalogTitle('ch4'), exact: true })).toBeVisible({ timeout: LINE_MS });
  await expect(page.getByRole('button', { name: ru('paywall.buy', { n: await price(request, 6003, 'ch4') }) })).toBeVisible();
  expect(refused, 'no refused request on the free chapter').toEqual([]);
});

test('stories: story ending shows the end and records the ending', async ({ page, request }) => {
  test.setTimeout(120_000);
  await launch(page, 6004);
  await play(page, 'tide', 'stories.start');
  await reachLine(page, 'ch3.shore_drowned.d005', { 'ch3.shore.c001': 0 });
  await page.locator('.dialogue .tap').tap();
  await expect(page.getByRole('heading', { name: ru('notice.the_end_title') })).toBeVisible({ timeout: LINE_MS });

  const token = await devToken(request, 6004);
  const tide = async (): Promise<Record<string, unknown> | null> => {
    const res = await request.get('/api/stats', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status(), 'GET /api/stats').toBe(200);
    const body = (await res.json()) as { stories: Array<Record<string, unknown>> };
    return body.stories.find((s) => s['storyId'] === 'tide') ?? null;
  };
  await expect.poll(async () => (await tide())?.['endingsReached'], { timeout: 10_000, message: 'the ending reached' }).toEqual(['drowned']);
  const stats = await tide();
  expect(stats !== null && Object.hasOwn(stats, 'endingsTotal'), 'no endingsTotal in the answer').toBe(false);
});

test('stories: back button closes chapter select to the picker', async ({ page }) => {
  await launch(page, 6005);
  const depth = await page.evaluate(() => history.length);
  await card(page, 'manor').getByRole('button', { name: ru('stories.chapters') }).tap();
  const list = page.getByRole('heading', { name: ru('chapters.title', { story: catalogTitle('manor') }) });
  await expect(list).toBeVisible();
  await mock(page, 'pressBack');
  await expect(list).toBeHidden();
  await expect(card(page, 'manor').getByRole('button', { name: ru('stories.start') })).toBeVisible();
  expect(await page.evaluate(() => history.length), 'history untouched').toBe(depth);
});

test('stories: picker unmounted during play', async ({ page }) => {
  test.setTimeout(120_000);
  await launch(page, 6006);
  await play(page, 'manor', 'stories.start');
  await expect(page.locator('[data-story]')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
  await backToStories(page);
  await play(page, 'manor', 'stories.continue');
  await expect(page.locator('[data-story]')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('stories: a locked chapter row opens the paywall without loading the chapter', async ({ page, request }) => {
  const loads = requests(page, /\/api\/chapters\//);
  await launch(page, 6007);
  await card(page, 'manor').getByRole('button', { name: ru('stories.chapters') }).tap();
  const row = page.getByRole('listitem').filter({ hasText: catalogTitle('ch2') });
  await expect(row).toContainText(ru('chapters.locked'));
  await row.getByRole('button').tap();
  await expect(page.getByRole('heading', { name: catalogTitle('ch2'), exact: true })).toBeVisible({ timeout: LINE_MS });
  await expect(page.getByRole('button', { name: ru('paywall.buy', { n: await price(request, 6007, 'ch2') }) })).toBeVisible();
  expect(loads.urls, 'no chapter request').toEqual([]);
  await expect(card(page, 'manor'), 'the root is still Home').toHaveCount(1);
});
