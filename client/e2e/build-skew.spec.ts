// LBI's deploy e2e (cut C8; D4-D6): server-dev's `POST /dev/build-id` makes every /api answer name another build, as
// a deploy under an open app would. The page reloads once, at a safe point and after its autosave, into a URL that
// carries the latch, and resumes the saved line; a lazy chunk the deploy removed is answered by the build probe; a
// wallet pack purchase the player left in `delayed` does not hold the reload (LRB). No test reads the page's own id
// from the bundle: `dist-e2e/build-id.txt` is the e2e build's id (D1).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext, Page, Request, Response } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import { mt, type MetaKey } from '../src/i18n/meta.ts';
import { catalogTitle, chunkFile, expect, holdRequests, launch, lineId, reachLine, test, walletOf, type E2eWindow } from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);
const meta = (key: MetaKey, params?: Readonly<Record<string, string | number>>): string => mt('ru', key, params);

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINE_MS = 30_000;
/** The build a "deploy" serves: never an id this tree builds to (a 64-bit prefix of a sha256). */
const NEW_BUILD = 'ffffffffffffffff';
/** app/game.ts RELOADED_FOR, as a literal: the spec never imports the engine's module into Node. */
const LATCH = `novelReloadedFor=${NEW_BUILD}`;
/** A plain line of ch1, a few steps in: no choice, no yield. */
const LINE = 'ch1.arrival.a003';
/** What Home reads for a fresh user (boot and the meta controller), each answered before the "deploy". */
const HOME_READS = ['/api/auth', '/api/saves', '/api/entitlements', '/api/social', '/api/wallet', '/api/stats'] as const;
/** Longer than a few of the recovery's polls (RELOAD_POLL_MS = 500): a reload it would start has started by then. */
const QUIET_MS = 2_000;

test.use({ reducedMotion: 'reduce' });

/** The e2e build's own id, as `vite build --mode e2e` wrote it beside the bundle. */
function ownBuild(): string {
  return readFileSync(path.join(CLIENT_DIR, 'dist-e2e', 'build-id.txt'), 'utf8').trim();
}

/** server-dev's deploy simulation: from now on every /api answer carries `x-build-id: <id>` (none for null). */
async function claim(request: APIRequestContext, id: string | null): Promise<void> {
  const res = await request.post('/dev/build-id', { data: { id } });
  expect(res.status(), `POST /dev/build-id ${String(id)}`).toBe(204);
}

function mock(page: Page, action: 'minimize' | 'restore' | 'pressBack'): Promise<void> {
  return page.evaluate((a) => (window as unknown as E2eWindow).__tgMock[a](), action);
}

/** The 3-hint pack's title as the server's catalog sells it (server/catalog.json, read in Node). */
const PACK_TITLE = (JSON.parse(readFileSync(path.resolve(CLIENT_DIR, '..', 'server', 'catalog.json'), 'utf8')) as {
  economy: { packs: { hint_s: { title: { ru: string } } } };
}).economy.packs.hint_s.title.ru;
/** server-dev's longest webhook delay is 60 s: this one lands after the 30 s window ends the pack's `confirming`. */
const WEBHOOK_DELAY_MS = 50_000;

const updateNotice = (page: Page) => page.getByRole('heading', { name: ru('notice.update_title') });

/**
 * The page's /api traffic from now on, the held stats posts left out: the paths answered, and the requests still in
 * flight. Critique O4: an answer in flight when the "deploy" lands names the new build and starts the recovery at a
 * point the test does not choose, so each test claims the new build only once nothing is in flight.
 */
function apiTraffic(page: Page): { readonly answered: ReadonlySet<string>; inFlight(): number } {
  const open = new Set<Request>();
  const answered = new Set<string>();
  const apiPath = (r: Request): string | null => {
    const p = new URL(r.url()).pathname;
    return p.startsWith('/api/') && !p.startsWith('/api/stats/') ? p : null;
  };
  page.on('request', (r) => {
    if (apiPath(r) !== null) {
      open.add(r);
    }
  });
  page.on('requestfinished', (r) => {
    const p = apiPath(r);
    if (p !== null) {
      open.delete(r);
      answered.add(p);
    }
  });
  page.on('requestfailed', (r) => {
    open.delete(r);
  });
  return { answered, inFlight: () => open.size };
}

/** Counts the page's `load` events from now on. */
function loads(page: Page): { readonly count: () => number } {
  let n = 0;
  page.on('load', () => {
    n += 1;
  });
  return { count: () => n };
}

/**
 * Holds every stats request until the returned release. Unlike `holdRequests`, the release does not wait for the held
 * answers: the reload cancels the old page's requests, and a cancelled request never gets one.
 */
async function holdStats(page: Page): Promise<() => void> {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  await page.route('**/api/stats/**', async (route) => {
    await opened;
    await route.fallback();
  });
  return open;
}

/** Whether `p` has settled, read synchronously (for `expect.poll`, which bounds the wait and names it). */
function settled(p: Promise<unknown>): () => boolean {
  let done = false;
  void p.then(() => {
    done = true;
  });
  return () => done;
}

/** After the reload: Home's Continue (the newest autosave) resumes manor. */
async function continueFromHome(page: Page): Promise<void> {
  await page.waitForFunction(() => '__tgMock' in window);
  const resume = page.getByRole('button', { name: ru('tap.continue_story', { story: catalogTitle('manor') }) });
  await expect(resume).toBeVisible({ timeout: LINE_MS });
  await resume.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

// The simulation is server-dev state for the whole run: every test leaves it cleared, as the other specs expect.
test.afterEach(async ({ request }) => {
  await claim(request, null);
});

test('deploy skew reloads once at a safe point and resumes the saved line', async ({ page, request }) => {
  test.setTimeout(150_000);
  // The match path first: every answer names this page's own build, and nothing reloads.
  await claim(request, ownBuild());
  const traffic = apiTraffic(page);
  await launch(page, 9601);
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
  await expect(start).toBeVisible();
  await start.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
  await reachLine(page, LINE);
  await expect(updateNotice(page), 'no update notice while the server serves this build').toHaveCount(0);

  // Critique O4: no answer that would name the new build while the app is in front (the stats posts held, the last
  // step's autosave answered), so the deactivated autosave's answer is the first to carry it.
  const releaseStats = await holdStats(page);
  await expect.poll(() => traffic.inFlight(), { timeout: LINE_MS, message: 'no /api answer in flight before the deploy' }).toBe(0);
  await claim(request, NEW_BUILD);
  const autosaved = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.startsWith('/api/saves/'));
  await mock(page, 'minimize'); // `deactivated` writes the autosave (F3)
  expect((await autosaved).headers()['x-build-id'], "the deactivated autosave's answer names the new build").toBe(NEW_BUILD);
  await page.waitForTimeout(QUIET_MS);
  await expect(updateNotice(page), "no notice in the background: 'background' holds the recovery").toHaveCount(0);

  const saves = await holdRequests(page, '**/api/saves/**');
  const autosaveSent = settled(saves.requested);
  const loaded = loads(page);
  await mock(page, 'restore');
  await expect(updateNotice(page), 'the update notice at the safe point').toBeVisible({ timeout: LINE_MS });
  await expect.poll(autosaveSent, { timeout: 5_000, message: "the safe point's autosave is sent (held)" }).toBe(true);
  expect(loaded.count(), 'no reload before the autosave is answered').toBe(0);
  await saves.release();
  await expect.poll(loaded.count, { timeout: LINE_MS, message: 'the reload after the flush' }).toBe(1);
  expect(page.url(), 'the latch in the fragment').toContain(LATCH);
  expect(page.url(), 'the launch params kept').toContain('#tgWebAppData=');

  await continueFromHome(page);
  expect(await lineId(page), 'the saved line resumed').toBe(LINE);
  // The server still serves the new build: the latch keeps this tab where it is.
  await page.waitForTimeout(QUIET_MS);
  expect(loaded.count(), 'one reload, no second').toBe(1);
  await expect(updateNotice(page)).toHaveCount(0);
  releaseStats();
});

test('a chunk gone after a deploy probes the build id', async ({ page, request }) => {
  test.setTimeout(120_000);
  await claim(request, ownBuild());
  const traffic = apiTraffic(page);
  await launch(page, 9602);
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
  await expect(start).toBeVisible();

  // The JSON calls that would name the new build themselves are held, and Home's reads are answered before the
  // "deploy" (O4: at Home, any answer naming it reloads the page there): the probe is what tells the page.
  const saves = await holdRequests(page, '**/api/saves/**');
  const releaseStats = await holdStats(page);
  await expect
    .poll(() => HOME_READS.every((p) => traffic.answered.has(p)) && traffic.inFlight() === 0, {
      timeout: LINE_MS,
      message: "Home's reads answered, none in flight",
    })
    .toBe(true);
  await claim(request, NEW_BUILD);
  // The meta overlays chunk, prefetched at the first line (app/meta.ts lineShown), is gone after the deploy.
  const overlays = `/${chunkFile('src/ui/meta/index.ts')}`;
  const order: string[] = [];
  await page.route(
    (url) => url.pathname === overlays,
    async (route) => {
      order.push('chunk');
      await route.fulfill({ status: 404, body: '' });
    },
  );
  const isProbe = (method: string, url: string): boolean => method === 'GET' && new URL(url).pathname === '/api/health';
  page.on('request', (r) => {
    if (isProbe(r.method(), r.url())) {
      order.push('probe');
    }
  });
  const probes: Response[] = [];
  page.on('response', (r) => {
    if (isProbe(r.request().method(), r.url())) {
      probes.push(r);
    }
  });
  const loaded = loads(page);

  await start.tap();
  // The first of the two events is the chunk (the import may request it more than once): the probe follows it.
  await expect.poll(() => order[0], { timeout: LINE_MS, message: 'the gone chunk is requested' }).toBe('chunk');
  await expect.poll(() => probes.length, { timeout: LINE_MS, message: 'a GET /api/health followed' }).toBeGreaterThan(0);
  expect(probes[0]?.headers()['x-build-id'], "the probe's answer names the new build").toBe(NEW_BUILD);
  await expect(updateNotice(page), 'the update notice at the safe point').toBeVisible({ timeout: LINE_MS });
  expect(loaded.count(), 'no reload before the autosave is answered').toBe(0);
  await saves.release();
  await expect.poll(loaded.count, { timeout: LINE_MS, message: 'the reload after the flush' }).toBe(1);
  expect(page.url(), 'the latch in the fragment').toContain(LATCH);
  await page.waitForFunction(() => '__tgMock' in window);
  await page.waitForTimeout(QUIET_MS);
  expect(loaded.count(), 'one reload, no second').toBe(1);
  releaseStats();
});

test('deploy skew does not wait for a delayed pack purchase the player left', async ({ page, request }) => {
  test.setTimeout(150_000);
  await claim(request, ownBuild());
  expect(await walletOf(request, 9603), 'the hint balance before').toBe(0);
  const traffic = apiTraffic(page);
  await launch(page, 9603);
  await page.getByRole('button', { name: ru('stories.wallet'), exact: true }).tap();
  const w = page.getByRole('region', { name: meta('meta.wallet_title') });
  await expect(w).toBeVisible({ timeout: LINE_MS });
  await w.getByRole('checkbox', { name: meta('meta.wallet_terms_agree') }).check();
  const buy = w.getByRole('listitem').filter({ hasText: PACK_TITLE }).getByRole('button', { name: meta('meta.wallet_buy', { stars: 1 }) });

  // The preset sheet presses Pay; its simulated payment reaches the webhook only after the 30 s window, so the
  // pack's flow goes `delayed` while the server holds the order in checkout.
  await page.evaluate(() => (window as unknown as E2eWindow).__tgMock.setInvoiceOutcome('paid'));
  await page.route('**/dev/simulate-payment', async (route) => {
    const body: unknown = route.request().postDataJSON();
    const sent = typeof body === 'object' && body !== null ? body : {};
    await route.continue({ postData: JSON.stringify({ ...sent, webhookDelayMs: WEBHOOK_DELAY_MS }) });
  });
  const simulated = page.waitForResponse((r) => new URL(r.url()).pathname === '/dev/simulate-payment');
  await buy.tap();
  expect((await simulated).status(), 'the simulated payment, its webhook delayed').toBe(200);
  // Critique O1: after the sheet's close, Buy is disabled while the order is confirmed, and enabled again only in
  // `delayed` (the window ended with the order in checkout).
  await expect(buy, 'confirming').toBeDisabled({ timeout: LINE_MS });
  await expect(buy, 'delayed').toBeEnabled({ timeout: 40_000 });

  // Critique O4: nothing in flight when the "deploy" lands, so the Check again's answer is the first to name it.
  const releaseStats = await holdStats(page);
  await expect.poll(() => traffic.inFlight(), { timeout: LINE_MS, message: 'no /api answer in flight before the deploy' }).toBe(0);
  await claim(request, NEW_BUILD);
  const loaded = loads(page);
  const checked = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith('/api/orders/'));
  await buy.tap(); // `delayed`: Check again, one order poll
  expect((await checked).headers()['x-build-id'], "the order poll's answer names the new build").toBe(NEW_BUILD);
  await page.waitForTimeout(QUIET_MS);
  await expect(updateNotice(page), 'no notice while the wallet shows the pack being confirmed').toHaveCount(0);
  expect(loaded.count(), 'no reload while the wallet is open').toBe(0);

  // The player leaves the wallet: nothing of the flow is on screen, so the recovery reloads. At Home there is no
  // autosave to flush, so the reload follows the notice in the same task: the load and its latch are the proof.
  await mock(page, 'pressBack');
  await expect.poll(loaded.count, { timeout: LINE_MS, message: 'the reload after the wallet closed' }).toBe(1);
  expect(page.url(), 'the latch in the fragment').toContain(LATCH);
  await page.waitForFunction(() => '__tgMock' in window);

  // The credit is the server's, with the webhook about 50 s after the payment; the reloaded wallet reads it.
  await expect.poll(() => walletOf(request, 9603), { timeout: 45_000, message: "the webhook's credit" }).toBe(3);
  await page.getByRole('button', { name: ru('stories.wallet'), exact: true }).tap();
  await expect(w).toContainText(meta('meta.wallet_balance', { kind: meta('meta.kind_hint'), n: 3 }), { timeout: LINE_MS });
  await page.waitForTimeout(QUIET_MS);
  expect(loaded.count(), 'one reload, no second').toBe(1);
  releaseStats();
});
