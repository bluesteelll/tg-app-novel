// Q60's e2e on the `chromium-sticky` project only (design §8, e2e 9-12): Chromium with ModuleMapDoNotCacheFailedFetch
// off keeps a failed module fetch in the module map until a new document, as older engines do (playwright.config.ts).
// A chunk blocked once therefore fails every later import() of it with no request: the second failure, after the
// evidence, restarts the page once with the chunk latch, and the new document loads it. The canary proves the
// project's switch took effect; without it every other test here would pass for the wrong reason or time out.
import type { APIRequestContext, Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import {
  blockScript,
  catalogTitle,
  chunkFile,
  devToken,
  expect,
  holdRequests,
  hotspot,
  launch,
  loads,
  ownBuild,
  plantPending,
  reachLine,
  scriptRequests,
  test,
  type E2eWindow,
} from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);

const LINE_MS = 30_000;
/** What ch1 carries into ch2 on the trust path (story/common/globals.ink). */
const CARRY = { g_gate_forced: false, g_manor_trust: 2, g_manor_promise: true, g_tide_trust_keeper: 0 } as const;

test.use({ reducedMotion: 'reduce' });

/** The chunk latch of this build, as a restart writes it into the fragment (app/reload.ts, `chunk:<own>` encoded). */
const chunkLatch = (): string => `novelReloadedFor=chunk%3A${ownBuild()}`;
const chunkPath = (key: string): string => `/${chunkFile(key)}`;

const paywall = (page: Page) => page.getByRole('heading', { name: catalogTitle('ch2'), exact: true });
const buyButton = (page: Page, price: number) => page.getByRole('button', { name: ru('paywall.buy', { n: price }) });
const startButton = (page: Page) => page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
const resumeButton = (page: Page) => page.getByRole('button', { name: ru('tap.continue_story', { story: catalogTitle('manor') }) });
const firstLine = (page: Page) => page.locator('.dialogue[data-line-id]');

async function ch2Price(request: APIRequestContext, uid: number): Promise<number> {
  const res = await request.get('/api/entitlements', { headers: { Authorization: `Bearer ${await devToken(request, uid)}` } });
  expect(res.status(), 'GET /api/entitlements').toBe(200);
  const p = ((await res.json()) as { products: Array<{ chapterId: string; priceStars: number }> }).products.find((x) => x.chapterId === 'ch2');
  if (p === undefined) {
    throw new Error('no ch2 product');
  }
  return p.priceStars;
}

/** The terms box (P1), then Buy. */
async function buy(page: Page, price: number): Promise<void> {
  await page.getByRole('checkbox', { name: ru('paywall.terms_agree') }).check();
  await buyButton(page, price).tap();
}

/** Home's Continue: the paywall over an empty stage (the planted pending start, or the restart's autosave of it). */
async function continueToPaywall(page: Page): Promise<void> {
  await expect(resumeButton(page)).toBeVisible({ timeout: LINE_MS });
  await resumeButton(page).tap();
  await expect(paywall(page)).toBeVisible({ timeout: LINE_MS });
}

/** The page's `load` events from now on, once the launch's own has fired: each restart is one. */
async function navigations(page: Page): Promise<{ readonly count: () => number }> {
  await page.waitForLoadState('load');
  return loads(page);
}

/** The next document request of the page: the restart's reload (a hash-only navigation requests none). */
function nextDocument(page: Page): Promise<unknown> {
  return page.waitForRequest((r) => r.resourceType() === 'document' && r.frame() === page.mainFrame(), { timeout: LINE_MS });
}

/** The design's "wait for the arm": the recovery armed `pathname`'s URL (its failure's evidence answered). */
async function waitArmed(page: Page, pathname: string, what: string): Promise<void> {
  try {
    await page.waitForFunction(
      (p) => (window as unknown as E2eWindow).__novelChunks?.armed().includes(new URL(p, location.href).href) === true,
      pathname,
      { timeout: LINE_MS },
    );
  } catch (e) {
    throw new Error(`waited for __novelChunks.armed() to hold ${pathname} (${what}): ${e instanceof Error ? e.message : String(e)}`);
  }
}

test('sticky canary: a failed dynamic import is not fetched again in this project', async ({ page }) => {
  test.setTimeout(60_000);
  const flow = chunkPath('src/purchase/flow.ts');
  const scripts = scriptRequests(page, flow);
  const block = await blockScript(page, flow, { once: true });
  await launch(page, 9909);
  await expect(startButton(page)).toBeVisible({ timeout: LINE_MS });
  // Two plain import()s from the page: not Vite's helper, so no `vite:preloadError` and no recovery.
  const outcomes = await page.evaluate(async (p) => {
    const url = new URL(p, location.href).href;
    const out: string[] = [];
    for (let i = 0; i < 2; i++) {
      out.push(await import(/* @vite-ignore */ url).then(() => 'resolved', () => 'rejected'));
    }
    return out;
  }, flow);
  expect(outcomes, 'the second import() meets the cached failure').toEqual(['rejected', 'rejected']);
  expect([block.blocked(), scripts()], 'one blocked request, and no second one').toEqual([1, 1]);
});

test('sticky: a flow chunk failed once restarts the page at the second failure, and the Buy works after', async ({ page, request }) => {
  test.setTimeout(150_000);
  const flow = chunkPath('src/purchase/flow.ts');
  await plantPending(request, 9910, 'ch2', CARRY);
  const price = await ch2Price(request, 9910);
  const scripts = scriptRequests(page, flow);
  await blockScript(page, flow, { once: true });
  await launch(page, 9910);
  const navs = await navigations(page);
  await continueToPaywall(page);
  await waitArmed(page, flow, "the paywall's prefetch");
  // The Buy's evidence probe is held until its note shows, so the note is seen before the restart replaces the screen.
  const probe = await holdRequests(page, '**/api/health');
  await buy(page, price);
  await expect(page.locator('[data-variant="note"]', { hasText: ru('toast.purchase_failed') }), 'the Buy fails as today').toBeVisible({ timeout: 10_000 });
  expect(scripts(), 'the Buy met the cached failure: no new request').toBe(1);
  await probe.requested;
  await probe.release();
  await expect.poll(navs.count, { timeout: LINE_MS, message: 'the restart' }).toBe(1);
  expect(page.url(), 'the chunk latch in the fragment').toContain(chunkLatch());
  await page.waitForFunction(() => '__tgMock' in window);
  await continueToPaywall(page);
  await buy(page, price);
  await expect(page.locator('[data-tg-mock-sheet]'), 'the invoice sheet in the new document').toBeVisible({ timeout: 10_000 });
});

test('sticky: the engine failed once at launch restarts the page before any tap, and Start works after', async ({ page }) => {
  test.setTimeout(150_000);
  const engine = chunkPath('src/app/engine.ts');
  const scripts = scriptRequests(page, engine);
  await blockScript(page, engine, { once: true });
  // `**/api/saves` is the list `listSaves` reads (api/endpoints.ts); held until import #1's evidence armed its URL.
  const saves = await holdRequests(page, '**/api/saves');
  await launch(page, 9911);
  const navs = await navigations(page);
  await waitArmed(page, engine, 'the import at launch');
  const reloaded = nextDocument(page);
  await saves.release(); // the reads end: engineOf's import #2 meets the cached failure, and no Game can be made
  await reloaded;
  expect(scripts(), 'import #2 rejected with no request').toBe(1);
  await expect.poll(navs.count, { timeout: LINE_MS, message: 'the restart, with no tap' }).toBe(1);
  expect(page.url(), 'the chunk latch in the fragment').toContain(chunkLatch());
  await page.waitForFunction(() => '__tgMock' in window);
  await startButton(page).tap();
  await expect(firstLine(page)).toBeVisible({ timeout: LINE_MS });
});

test('sticky: a cue stage failed once restarts at the explore yield, and Continue opens the section', async ({ page }) => {
  test.setTimeout(180_000);
  const stage = chunkPath('src/cues/stage/index.ts');
  const scripts = scriptRequests(page, stage);
  await blockScript(page, stage, { once: true });
  await launch(page, 9912);
  const navs = await navigations(page);
  await startButton(page).tap();
  await expect(firstLine(page)).toBeVisible({ timeout: LINE_MS });
  await waitArmed(page, stage, "the first line's prefetch");
  // enterManor is not used: its hotspot assertion cannot hold at a yield whose import fails.
  await reachLine(page, 'ch1.manor_arrive.a008');
  const reloaded = nextDocument(page);
  await page.locator('.dialogue .tap').tap(); // `# explore: manor`: the section's imports
  await reloaded;
  expect(scripts(), "the yield's import rejected with no request").toBe(1);
  await expect.poll(navs.count, { timeout: LINE_MS, message: 'the restart' }).toBe(1);
  expect(page.url(), 'the chunk latch in the fragment').toContain(chunkLatch());
  await page.waitForFunction(() => '__tgMock' in window);
  await resumeButton(page).tap();
  await expect(hotspot(page, 'hall', 'to_study'), 'the resumed yield opens its section').toBeVisible({ timeout: LINE_MS });
});
