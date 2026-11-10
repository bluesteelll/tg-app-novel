// Q60's e2e on the `chromium` project (design §8, e2e 1-8, 13, 14): a lazy chunk that keeps failing while the server
// serves it restarts the page once, at a safe point, with the chunk latch; a transient failure, a 404 and a page that
// already restarted keep today's error states; without a Game the restart waits for the wallet's sheet and the
// background. Chromium 156 fetches a failed module again at the next import(), so stickiness is simulated here by a
// persistent block; `lazy-recovery-sticky.spec.ts` runs the real thing. A block fails only the chunk's `script`
// requests (`blockScript`): the recovery's servability `fetch` of the same URL passes. Ordering rule: a tap whose
// outcome depends on an earlier failure waits for that failure's arm (or `checked()` where the evidence cannot pass),
// and a negative is asserted only after the round it depends on, then over QUIET_MS.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext, Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import { mt, type MetaKey } from '../src/i18n/meta.ts';
import {
  blockScript,
  catalogTitle,
  chunkFile,
  devToken,
  enterManor,
  expect,
  holdRequests,
  launch,
  loads,
  ownBuild,
  plantPending,
  puzzleFrame,
  scriptRequests,
  take,
  tapHotspot,
  test,
  walk,
  type E2eWindow,
} from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);
const meta = (key: MetaKey, params?: Readonly<Record<string, string | number>>): string => mt('ru', key, params);

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINE_MS = 30_000;
/** Longer than four of the recovery's polls (RELOAD_POLL_MS = 500): a reload it would start has started by then. */
const QUIET_MS = 2_000;
/** What ch1 carries into ch2 on the trust path (story/common/globals.ink). */
const CARRY = { g_gate_forced: false, g_manor_trust: 2, g_manor_promise: true, g_tide_trust_keeper: 0 } as const;
/** The 3-hint pack's title as the server's catalog sells it (server/catalog.json, read in Node). */
const PACK_TITLE = (JSON.parse(readFileSync(path.resolve(CLIENT_DIR, '..', 'server', 'catalog.json'), 'utf8')) as {
  economy: { packs: { hint_s: { title: { ru: string } } } };
}).economy.packs.hint_s.title.ru;

test.use({ reducedMotion: 'reduce' });

/** The chunk latch of this build, as a restart writes it into the fragment (app/reload.ts, `chunk:<own>` encoded). */
const chunkLatch = (): string => `novelReloadedFor=chunk%3A${ownBuild()}`;
const chunkPath = (key: string): string => `/${chunkFile(key)}`;

const paywall = (page: Page) => page.getByRole('heading', { name: catalogTitle('ch2'), exact: true });
const buyButton = (page: Page, price: number) => page.getByRole('button', { name: ru('paywall.buy', { n: price }) });
const purchaseNote = (page: Page) => page.locator('[data-variant="note"]', { hasText: ru('toast.purchase_failed') });
const restartNotice = (page: Page) => page.getByRole('heading', { name: ru('notice.restart_title') });
const startButton = (page: Page) => page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
const firstLine = (page: Page) => page.locator('.dialogue[data-line-id]');
const sheet = (page: Page) => page.locator('[data-tg-mock-sheet]');

async function ch2Price(request: APIRequestContext, uid: number): Promise<number> {
  const res = await request.get('/api/entitlements', { headers: { Authorization: `Bearer ${await devToken(request, uid)}` } });
  expect(res.status(), 'GET /api/entitlements').toBe(200);
  const p = ((await res.json()) as { products: Array<{ chapterId: string; priceStars: number; owned: boolean }> }).products.find((x) => x.chapterId === 'ch2');
  if (p === undefined) {
    throw new Error('no ch2 product');
  }
  return p.priceStars;
}

async function ch2Owned(request: APIRequestContext, uid: number): Promise<boolean> {
  const res = await request.get('/api/entitlements', { headers: { Authorization: `Bearer ${await devToken(request, uid)}` } });
  return ((await res.json()) as { products: Array<{ chapterId: string; owned: boolean }> }).products.some((x) => x.chapterId === 'ch2' && x.owned);
}

/** The terms box (P1), then Buy. */
async function buy(page: Page, price: number): Promise<void> {
  await page.getByRole('checkbox', { name: ru('paywall.terms_agree') }).check();
  await buyButton(page, price).tap();
}

/** Home's Continue resumes the planted pending start (or the restart's autosave of it): the paywall over an empty stage. */
async function continueToPaywall(page: Page): Promise<void> {
  const resume = page.getByRole('button', { name: ru('tap.continue_story', { story: catalogTitle('manor') }) });
  await expect(resume).toBeVisible({ timeout: LINE_MS });
  await resume.tap();
  await expect(paywall(page)).toBeVisible({ timeout: LINE_MS });
}

type Navigations = { readonly count: () => number };

/** The page's `load` events from now on, once the launch's own has fired: each restart is one. */
async function navigations(page: Page): Promise<Navigations> {
  await page.waitForLoadState('load');
  return loads(page);
}

/** A page wait that names what it waited for when it times out. */
async function named(what: string, wait: Promise<unknown>): Promise<void> {
  try {
    await wait;
  } catch (e) {
    throw new Error(`waited for ${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The design's "wait for the arm": the recovery armed `pathname`'s URL (its failure's evidence answered). */
function waitArmed(page: Page, pathname: string, what = ''): Promise<void> {
  return named(
    `__novelChunks.armed() to hold ${pathname}${what}`,
    page.waitForFunction((p) => (window as unknown as E2eWindow).__novelChunks?.armed().includes(new URL(p, location.href).href) === true, pathname, {
      timeout: LINE_MS,
    }),
  );
}

/** The recovery's evidence rounds ended so far reach `n` (answered or not). */
function waitChecked(page: Page, n: number, what: string): Promise<void> {
  return named(
    `__novelChunks.checked() >= ${n} (${what})`,
    page.waitForFunction((m) => ((window as unknown as E2eWindow).__novelChunks?.checked() ?? -1) >= m, n, { timeout: LINE_MS }),
  );
}

/** The restart the page holds itself (no Game took it). */
function waitWanted(page: Page, kind: 'chunk' | 'skew'): Promise<void> {
  return named(
    `__novelChunks.wanted() === '${kind}'`,
    page.waitForFunction((k) => (window as unknown as E2eWindow).__novelChunks?.wanted() === k, kind, { timeout: LINE_MS }),
  );
}

function armed(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => [...((window as unknown as E2eWindow).__novelChunks?.armed() ?? [])]);
}

function mock(page: Page, action: 'minimize' | 'restore'): Promise<void> {
  return page.evaluate((a) => (window as unknown as E2eWindow).__tgMock[a](), action);
}

test('platform: a failed dynamic import is fetched again by the next import()', async ({ page }) => {
  test.setTimeout(60_000);
  const flow = chunkPath('src/purchase/flow.ts');
  const scripts = scriptRequests(page, flow);
  const block = await blockScript(page, flow, { once: true });
  await launch(page, 9901);
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
  expect(outcomes).toEqual(['rejected', 'resolved']);
  expect([block.blocked(), scripts()], 'one blocked request, then a second one').toEqual([1, 2]);
});

/**
 * e2e 2's path to the restart: the flow chunk blocked for good; Continue -> the paywall, whose prefetch fails and arms
 * -> Buy -> the note -> one navigation with the chunk latch. The Buy's evidence probe is held until the note shows, so
 * the note is seen before the restart replaces the screen.
 */
async function restartOnStuckFlow(
  page: Page,
  request: APIRequestContext,
  uid: number,
): Promise<{ price: number; navs: Navigations; unblock(): Promise<void> }> {
  const flow = chunkPath('src/purchase/flow.ts');
  await plantPending(request, uid, 'ch2', CARRY);
  const price = await ch2Price(request, uid);
  const block = await blockScript(page, flow, { once: false });
  await launch(page, uid);
  const navs = await navigations(page);
  await continueToPaywall(page);
  await waitArmed(page, flow, " (the paywall's prefetch)");
  const probe = await holdRequests(page, '**/api/health');
  await buy(page, price);
  await expect(purchaseNote(page), 'the Buy fails as today').toBeVisible({ timeout: 10_000 });
  expect(navs.count(), 'no restart before the evidence').toBe(0);
  await probe.requested;
  await probe.release();
  await expect.poll(navs.count, { timeout: LINE_MS, message: 'the restart' }).toBe(1);
  expect(page.url(), 'the chunk latch in the fragment').toContain(chunkLatch());
  expect(page.url(), 'the launch params kept').toContain('#tgWebAppData=');
  await page.waitForFunction(() => '__tgMock' in window);
  return { price, navs, unblock: () => block.unroute() };
}

test('a chunk that keeps failing while the server serves it restarts the page once at a safe point, and the Buy works after', async ({ page, request }) => {
  test.setTimeout(150_000);
  const r = await restartOnStuckFlow(page, request, 9902);
  await r.unblock();
  await continueToPaywall(page);
  await buy(page, r.price);
  await expect(sheet(page), 'the invoice sheet').toBeVisible({ timeout: 10_000 });
  expect(await ch2Owned(request, 9902), 'ch2 on the server').toBe(false);
  expect(r.navs.count(), 'one restart').toBe(1);
});

test('a second stuck chunk after the restart keeps the error state', async ({ page, request }) => {
  test.setTimeout(150_000);
  const r = await restartOnStuckFlow(page, request, 9903);
  const flow = chunkPath('src/purchase/flow.ts');
  await continueToPaywall(page);
  await waitArmed(page, flow, ': a page that restarted for this build still arms (only the act reads the latch)');
  await buy(page, r.price);
  await expect(purchaseNote(page), 'the Buy fails as today').toBeVisible({ timeout: 10_000 });
  await waitChecked(page, 2, "the prefetch's and the Buy's rounds");
  await page.waitForTimeout(QUIET_MS);
  expect(r.navs.count(), 'no second restart').toBe(1);
  await expect(restartNotice(page)).toHaveCount(0);
});

test('a transient chunk failure that the retry fixes restarts nothing', async ({ page, request }) => {
  test.setTimeout(120_000);
  const flow = chunkPath('src/purchase/flow.ts');
  await plantPending(request, 9904, 'ch2', CARRY);
  const price = await ch2Price(request, 9904);
  const scripts = scriptRequests(page, flow);
  const block = await blockScript(page, flow, { once: true });
  await launch(page, 9904);
  const navs = await navigations(page);
  await continueToPaywall(page); // its prefetch meets the block
  await waitArmed(page, flow, " (the paywall's prefetch)");
  await buy(page, price);
  await expect(sheet(page), 'the retry loaded the chunk').toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(QUIET_MS);
  expect([navs.count(), scripts(), block.blocked()], 'no restart; the prefetch and the Buy each requested it').toEqual([0, 2, 1]);
});

test('an engine chunk failed once at launch: Start still reaches the first line with no restart', async ({ page }) => {
  test.setTimeout(120_000);
  const engine = chunkPath('src/app/engine.ts');
  const scripts = scriptRequests(page, engine);
  const block = await blockScript(page, engine, { once: true });
  await launch(page, 9905);
  const navs = await navigations(page);
  await expect(startButton(page)).toBeVisible({ timeout: LINE_MS });
  await waitArmed(page, engine, ' (the import at launch)');
  await startButton(page).tap();
  await expect(firstLine(page)).toBeVisible({ timeout: LINE_MS });
  await page.waitForTimeout(QUIET_MS);
  // The second import came from `engineOf` at the reads' end or from Start, whichever came first.
  expect([navs.count(), scripts(), block.blocked()]).toEqual([0, 2, 1]);
});

test('a chunk the server does not serve never restarts the page', async ({ page, request }) => {
  test.setTimeout(120_000);
  const flow = chunkPath('src/purchase/flow.ts');
  // Gone for every request, the servability fetch included: the 404 of P's test.
  await page.route(
    (url) => url.pathname === flow,
    (route) => route.fulfill({ status: 404, body: '' }),
  );
  await plantPending(request, 9906, 'ch2', CARRY);
  const price = await ch2Price(request, 9906);
  await launch(page, 9906);
  const navs = await navigations(page);
  await continueToPaywall(page);
  await waitChecked(page, 1, "the paywall's prefetch");
  await buy(page, price);
  await expect(purchaseNote(page)).toBeVisible({ timeout: 10_000 });
  await waitChecked(page, 2, 'the first Buy');
  await buyButton(page, price).tap();
  await waitChecked(page, 3, 'the second Buy');
  expect(await armed(page), 'a 404 arms nothing').toEqual([]);
  await page.waitForTimeout(QUIET_MS);
  expect(navs.count(), 'no restart').toBe(0);
  await expect(restartNotice(page)).toHaveCount(0);
});

test('the page inserts no modulepreload link and loads one stylesheet', async ({ page }) => {
  test.setTimeout(150_000);
  const overlays = scriptRequests(page, chunkPath('src/ui/meta/index.ts'));
  await launch(page, 9907);
  await startButton(page).tap(); // the engine
  await expect(firstLine(page)).toBeVisible({ timeout: LINE_MS });
  await expect.poll(overlays, { timeout: LINE_MS, message: "the meta overlays' chunk, prefetched at the first line" }).toBeGreaterThan(0);
  await enterManor(page); // explore
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await take(page, 'study', 'medal');
  await tapHotspot(page, 'study', 'drawer'); // a puzzle: its host and its type's UI
  await expect(puzzleFrame(page, 'drawer')).toBeVisible({ timeout: LINE_MS });
  const links = await page.evaluate(() => ({
    modulepreload: document.querySelectorAll('link[rel=modulepreload]').length,
    stylesheets: [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].map((l) => l.sheet !== null),
  }));
  expect(links).toEqual({ modulepreload: 0, stylesheets: [true] });
});

test('a stylesheet that failed at launch restarts the page once, styled after', async ({ page }) => {
  test.setTimeout(120_000);
  const css = chunkPath('style.css');
  const engine = chunkPath('src/app/engine.ts');
  // MEAS (critique Q2; no assertion): the failure, D6's check, the engine's arrival and the restart, in ms from the
  // first document request.
  const at: Record<string, number> = {};
  let checkedAt = '';
  const mark = (name: string): void => {
    at[name] ??= Date.now();
  };
  page.on('request', (r) => {
    if (r.resourceType() === 'document' && new URL(r.url()).pathname === '/') {
      mark(at['document'] === undefined ? 'document' : 'navigation');
    }
  });
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).pathname === css) {
      mark('stylesheet failed');
    }
  });
  page.on('requestfinished', (r) => {
    if (r.resourceType() === 'script' && new URL(r.url()).pathname === engine) {
      mark('engine arrived');
    }
  });
  page.on('console', (m) => {
    if (m.text().startsWith('recovery: stylesheet check') && checkedAt === '') {
      mark('D6 check');
      checkedAt = m.text();
    }
  });
  await blockScript(page, css, { once: true, type: 'stylesheet' });
  // D-O9: the reads wait until the restart is wanted, so no Game exists yet; only engineOf's settle() hands it over.
  const saves = await holdRequests(page, '**/api/saves');
  await launch(page, 9908);
  const navs = await navigations(page);
  await waitWanted(page, 'chunk');
  expect(navs.count(), 'no restart without a Game while the engine can still make one').toBe(0);
  await saves.release();
  await expect.poll(navs.count, { timeout: LINE_MS, message: 'the restart once the Game exists' }).toBe(1);
  expect(page.url(), 'the chunk latch in the fragment').toContain(chunkLatch());
  const card = page.locator('[data-story="manor"]');
  await expect(card).toBeVisible({ timeout: LINE_MS });
  // `.card { display: flex }` is in the one stylesheet only (StoryPicker.svelte); a list item without it.
  expect(await card.evaluate((el) => getComputedStyle(el).display), 'Home styled after the restart').toBe('flex');
  const t0 = at['document'] ?? 0;
  const rel = (name: string): string => (at[name] === undefined ? 'none' : `+${at[name] - t0}`);
  console.log(
    `MEAS e2e8 (ms from the first document request): stylesheet failed ${rel('stylesheet failed')}, D6 check ${rel('D6 check')} ` +
      `(${checkedAt}), engine arrived ${rel('engine arrived')}, navigation ${rel('navigation')}`,
  );
});

/**
 * e2e 13 / 14's way to the no-Game path: the engine blocked for good; the reads held until import #1's URL is armed,
 * then the probe held, then the reads released: Home shows, import #2 (engineOf's) fails, and its evidence round
 * waits on the held probe.
 */
async function noGameWithHeldProbe(page: Page, uid: number): Promise<{ navs: Navigations; probe: { release(): Promise<void> }; unblock(): Promise<void> }> {
  const engine = chunkPath('src/app/engine.ts');
  const block = await blockScript(page, engine, { once: false });
  const saves = await holdRequests(page, '**/api/saves');
  await launch(page, uid);
  const navs = await navigations(page);
  await waitArmed(page, engine, ' (import #1, at launch)');
  const probe = await holdRequests(page, '**/api/health');
  await saves.release();
  await expect(startButton(page), 'Home').toBeVisible({ timeout: LINE_MS });
  await probe.requested; // import #2's evidence round
  return { navs, probe, unblock: () => block.unroute() };
}

test('no game: a restart waits while a wallet pack sheet is on screen, then reloads once', async ({ page }) => {
  test.setTimeout(150_000);
  const r = await noGameWithHeldProbe(page, 9913);
  await page.evaluate(() => (window as unknown as E2eWindow).__tgMock.setInvoiceOutcome(null)); // the sheet shows
  await page.getByRole('button', { name: ru('stories.wallet'), exact: true }).tap();
  const w = page.getByRole('region', { name: meta('meta.wallet_title') });
  await expect(w).toBeVisible({ timeout: LINE_MS });
  await w.getByRole('checkbox', { name: meta('meta.wallet_terms_agree') }).check();
  await w.getByRole('listitem').filter({ hasText: PACK_TITLE }).getByRole('button', { name: meta('meta.wallet_buy', { stars: 1 }) }).tap();
  await expect(sheet(page), "the pack's invoice sheet").toBeVisible({ timeout: LINE_MS });
  await r.probe.release();
  await waitWanted(page, 'chunk');
  await page.waitForTimeout(QUIET_MS);
  expect(r.navs.count(), 'no restart while the sheet is on screen').toBe(0);
  await expect(restartNotice(page)).toHaveCount(0);
  await r.unblock();
  await sheet(page).locator('[data-sheet-button="cancel"]').tap();
  await expect.poll(r.navs.count, { timeout: LINE_MS, message: 'the restart once the sheet closed' }).toBe(1);
  expect(page.url(), 'the chunk latch in the fragment').toContain(chunkLatch());
  await page.waitForFunction(() => '__tgMock' in window);
  await startButton(page).tap();
  await expect(firstLine(page)).toBeVisible({ timeout: LINE_MS });
  await page.waitForTimeout(QUIET_MS);
  expect(r.navs.count(), 'one restart').toBe(1);
});

test('no game: a restart waits in the background, then reloads once at activated', async ({ page }) => {
  test.setTimeout(150_000);
  const r = await noGameWithHeldProbe(page, 9914);
  await mock(page, 'minimize');
  await r.probe.release();
  await waitWanted(page, 'chunk');
  await page.waitForTimeout(QUIET_MS);
  expect(r.navs.count(), 'no restart in the background').toBe(0);
  await r.unblock();
  await mock(page, 'restore');
  await expect.poll(r.navs.count, { timeout: LINE_MS, message: 'the restart at activated' }).toBe(1);
  expect(page.url(), 'the chunk latch in the fragment').toContain(chunkLatch());
});
