// Lever O5's e2e (RULINGS 201, 221; o5-overlays design §4, e2e 1-5) on the `chromium` project: the in-play overlays
// (Menu, Backlog, Settings, Saves) are their own chunk, requested once when the first line's reveal ends; a tap before
// it lands waits for it, and the first tap wins; a chunk that fails leaves the game playable and the paywall's Terms
// (the engine's) reachable; a chunk that keeps failing while the server serves it restarts the page once (Q60's
// recovery). Each test names the chunk's file first (`chunkFile`), so a build without the chunk fails every test at its
// first line, before it acts. The first test runs with motion (the reveal it times); the others reduce it.
import type { Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import {
  ANSWER_SETTLE_MS,
  blockScript,
  catalogTitle,
  chunkFile,
  expect,
  holdRequests,
  launch,
  loads,
  ownBuild,
  plantPending,
  scriptRequests,
  test,
  type E2eWindow,
} from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);

const LINE_MS = 30_000;
/** What ch1 carries into ch2 on the trust path (story/common/globals.ink). */
const CARRY = { g_gate_forced: false, g_manor_trust: 2, g_manor_promise: true, g_tide_trust_keeper: 0 } as const;

/** The overlays chunk's path in the e2e build: called first in each test (a module-level call would fail the file). */
const overlaysChunk = (): string => `/${chunkFile('src/ui/overlays/index.ts')}`;

const startButton = (page: Page) => page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
const continueButton = (page: Page) => page.getByRole('button', { name: ru('tap.continue_story', { story: catalogTitle('manor') }) });
const shownLine = (page: Page) => page.locator('.dialogue[data-line-id]');
const quick = (page: Page, key: 'quick.menu' | 'quick.backlog') => page.getByRole('button', { name: ru(key), exact: true });
const heading = (page: Page, key: UiKey) => page.getByRole('heading', { name: ru(key), exact: true });
const paywall = (page: Page) => page.getByRole('heading', { name: catalogTitle('ch2'), exact: true });
/** The note of a failed overlay tap: boot's meta-gate note and key (`meta.action_failed`). */
const overlaysNote = (page: Page) => page.locator('[data-variant="note"]', { hasText: ru('meta.action_failed') });

function pressBack(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as E2eWindow).__tgMock.pressBack());
}

/** A page wait that names what it waited for when it times out. */
async function named(what: string, wait: Promise<unknown>): Promise<void> {
  try {
    await wait;
  } catch (e) {
    throw new Error(`waited for ${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The recovery armed `pathname`'s URL: its failure's evidence answered (lazy-recovery.spec.ts's form). */
function waitArmed(page: Page, pathname: string, what: string): Promise<void> {
  return named(
    `__novelChunks.armed() to hold ${pathname} (${what})`,
    page.waitForFunction((p) => (window as unknown as E2eWindow).__novelChunks?.armed().includes(new URL(p, location.href).href) === true, pathname, {
      timeout: LINE_MS,
    }),
  );
}

/** The recovery's evidence rounds ended so far reach `n`, answered or not (lazy-recovery.spec.ts's form). */
function waitChecked(page: Page, n: number, what: string): Promise<void> {
  return named(
    `__novelChunks.checked() >= ${n} (${what})`,
    page.waitForFunction((m) => ((window as unknown as E2eWindow).__novelChunks?.checked() ?? -1) >= m, n, { timeout: LINE_MS }),
  );
}

/** The page's `load` events from now on, once the launch's own has fired: a restart is one. */
async function navigations(page: Page): Promise<{ readonly count: () => number }> {
  await page.waitForLoadState('load');
  return loads(page);
}

/** When the first line showed, and when its reveal ended (its rest emptied after it had held text), page time. */
type RevealMarks = { lineAt: number | null; held: boolean; revealEndAt: number | null };

/** Runs before the page's scripts (Playwright serialises it): the first line's appearance and reveal end, recorded. */
function recordReveal(): void {
  const marks: RevealMarks = { lineAt: null, held: false, revealEndAt: null };
  Object.defineProperty(window, '__e2eReveal', { value: marks });
  const look = (): void => {
    const box = document.querySelector('.dialogue[data-line-id]');
    if (box === null || marks.revealEndAt !== null) {
      return;
    }
    marks.lineAt ??= performance.now();
    if ((box.querySelector('[data-reveal="rest"]')?.textContent ?? '') !== '') {
      marks.held = true;
    } else if (marks.held) {
      marks.revealEndAt = performance.now();
    }
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-line-id'] });
}

test("overlays: the chunk is requested after the first line's reveal, once, and every overlay opens from it", async ({ page }) => {
  test.setTimeout(120_000);
  const chunk = overlaysChunk();
  const scripts = scriptRequests(page, chunk);
  await page.addInitScript(recordReveal);
  await launch(page, 9501);
  await startButton(page).tap();
  await expect(shownLine(page)).toBeVisible({ timeout: LINE_MS });
  const chunkStart = async (): Promise<number | null> =>
    page.evaluate(
      (p) =>
        performance
          .getEntriesByType('resource')
          .find((r) => new URL(r.name).pathname === p)?.startTime ?? null,
      chunk,
    );
  await expect.poll(chunkStart, { timeout: LINE_MS, message: "the overlays chunk's resource entry" }).not.toBeNull();
  const marks = await page.evaluate(() => (window as unknown as { __e2eReveal: RevealMarks }).__e2eReveal);
  const start = (await chunkStart()) ?? -1;
  console.log(`O5: first line at ${marks.lineAt?.toFixed(0)} ms, reveal end at ${marks.revealEndAt?.toFixed(0)} ms, overlays chunk at ${start.toFixed(0)} ms`);
  const lineAt = marks.lineAt ?? Number.NaN;
  const revealEndAt = marks.revealEndAt ?? Number.NaN;
  // The first line reveals for about 1.4 s at the normal speed, and the chunk is asked for only once it has ended.
  expect(revealEndAt - lineAt, 'a timed reveal').toBeGreaterThanOrEqual(500);
  expect(start, 'the chunk after the reveal').toBeGreaterThanOrEqual(revealEndAt);
  // Every overlay opens from that one request.
  await quick(page, 'quick.menu').tap();
  await expect(heading(page, 'menu.title')).toBeVisible();
  await pressBack(page);
  await expect(heading(page, 'menu.title')).toBeHidden();
  await quick(page, 'quick.backlog').tap();
  await expect(heading(page, 'backlog.title')).toBeVisible();
  await pressBack(page);
  await expect(heading(page, 'backlog.title')).toBeHidden();
  for (const [entry, title] of [
    ['menu.settings', 'settings.title'],
    ['menu.saves', 'saves.title'],
  ] as const) {
    await quick(page, 'quick.menu').tap();
    await page.getByRole('button', { name: ru(entry), exact: true }).tap();
    await expect(heading(page, title)).toBeVisible();
    await pressBack(page);
    await expect(heading(page, title)).toBeHidden();
    await expect(heading(page, 'menu.title')).toBeVisible();
    await pressBack(page);
    await expect(heading(page, 'menu.title')).toBeHidden();
  }
  expect(scripts(), 'one request of the chunk').toBe(1);
});

test.describe(() => {
  test.use({ reducedMotion: 'reduce' });

  test('overlays: a Menu tap then a Backlog tap before the chunk lands open only the menu, once it lands', async ({ page }) => {
    test.setTimeout(120_000);
    const chunk = overlaysChunk();
    const held = await holdRequests(page, `**${chunk}`);
    await launch(page, 9502);
    await startButton(page).tap();
    await expect(shownLine(page)).toBeVisible({ timeout: LINE_MS });
    await held.requested; // the first line's prefetch, held
    await quick(page, 'quick.menu').tap();
    await quick(page, 'quick.backlog').tap();
    await page.waitForTimeout(ANSWER_SETTLE_MS);
    await expect(heading(page, 'menu.title'), 'no overlay before the chunk').toHaveCount(0);
    await expect(heading(page, 'backlog.title'), 'no overlay before the chunk').toHaveCount(0);
    await held.release();
    // The menu's push moved the stack the Backlog tap saw: only the first tap's overlay opens.
    await expect(heading(page, 'menu.title')).toBeVisible({ timeout: 10_000 });
    await expect(heading(page, 'backlog.title')).toHaveCount(0);
    await pressBack(page);
    await expect(heading(page, 'menu.title')).toBeHidden();
    await expect(heading(page, 'backlog.title'), 'Back leaves no overlay').toHaveCount(0);
    await expect(shownLine(page)).toBeVisible();
  });

  test('overlays: a chunk that fails to load leaves the game playable and the next tap opens the menu', async ({ page }) => {
    test.setTimeout(120_000);
    const chunk = overlaysChunk();
    const gone = (url: URL): boolean => url.pathname === chunk;
    // Gone for every request, the servability fetch included: a 404 arms nothing, so no restart follows.
    await page.route(gone, (route) => route.fulfill({ status: 404, body: '' }));
    const scripts = scriptRequests(page, chunk);
    await launch(page, 9503);
    const navs = await navigations(page);
    await startButton(page).tap();
    await expect(shownLine(page)).toBeVisible({ timeout: LINE_MS });
    await waitChecked(page, 1, "the first line's prefetch");
    await quick(page, 'quick.menu').tap();
    await expect(overlaysNote(page), 'the tap is noted').toBeVisible({ timeout: 10_000 });
    await expect(heading(page, 'menu.title')).toHaveCount(0);
    // The story goes on.
    const before = (await shownLine(page).getAttribute('data-line-id')) ?? '';
    await expect
      .poll(
        async () => {
          await page.locator('.dialogue .tap').tap();
          return shownLine(page).getAttribute('data-line-id');
        },
        { timeout: LINE_MS, message: 'a new line after a tap' },
      )
      .not.toBe(before);
    const failed = scripts();
    await page.unroute(gone);
    await quick(page, 'quick.menu').tap();
    await expect(heading(page, 'menu.title'), 'the next tap loads again').toBeVisible({ timeout: 10_000 });
    expect(scripts(), 'the tap requested the chunk again').toBeGreaterThan(failed);
    expect(navs.count(), 'no restart').toBe(0);
  });

  test('overlays: terms open from the paywall after the chunk failed to load', async ({ page, request }) => {
    test.setTimeout(120_000);
    const chunk = overlaysChunk();
    await page.route(
      (url) => url.pathname === chunk,
      (route) => route.fulfill({ status: 404, body: '' }),
    );
    await plantPending(request, 9504, 'ch2', CARRY);
    await launch(page, 9504);
    // A paywall-first session (D11). Its chapter request is held, so the game root and its quick bar show before the
    // paywall: a Menu tap there, before any line, meets the 404 (the empty stage under the paywall has no line to tap).
    const chapter = await holdRequests(page, '**/api/chapters/ch2');
    await expect(continueButton(page)).toBeVisible({ timeout: LINE_MS });
    await continueButton(page).tap();
    await chapter.requested;
    await quick(page, 'quick.menu').tap();
    await expect(overlaysNote(page), 'the tap is noted').toBeVisible({ timeout: 10_000 });
    await chapter.release();
    await expect(paywall(page)).toBeVisible({ timeout: LINE_MS });
    // The paywall's Terms are the engine's: they open with the overlays chunk gone, and Back returns to the paywall.
    await page.getByRole('button', { name: ru('paywall.terms_link'), exact: true }).tap();
    await expect(heading(page, 'terms.title')).toBeVisible();
    await pressBack(page);
    await expect(heading(page, 'terms.title')).toBeHidden();
    await expect(paywall(page)).toBeVisible();
    await pressBack(page);
    await expect(paywall(page), 'the empty stage').toBeHidden();
    // The empty stage's Menu meets the 404 again: the note, no menu.
    await expect(overlaysNote(page), 'the first note expired').toHaveCount(0, { timeout: 10_000 });
    await quick(page, 'quick.menu').tap();
    await expect(overlaysNote(page)).toBeVisible({ timeout: 10_000 });
    await expect(heading(page, 'menu.title')).toHaveCount(0);
    // A tap on the stage (its centre: the note sits at the top) opens the paywall again (D11), and its Terms again.
    const size = page.viewportSize();
    if (size === null) {
      throw new Error('the project sets a viewport');
    }
    await page.touchscreen.tap(size.width / 2, size.height / 2);
    await expect(paywall(page), 'the stage tap: the paywall (D11)').toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: ru('paywall.terms_link'), exact: true }).tap();
    await expect(heading(page, 'terms.title'), 'Terms again').toBeVisible();
  });

  test('overlays: a chunk that keeps failing while the server serves it restarts the page once, and the menu opens after', async ({ page }) => {
    test.setTimeout(150_000);
    const chunk = overlaysChunk();
    // The module fetch fails for good while the servability fetch passes: on Chromium, a sticky engine's evidence.
    const block = await blockScript(page, chunk, { once: false });
    await launch(page, 9505);
    const navs = await navigations(page);
    await startButton(page).tap();
    await expect(shownLine(page)).toBeVisible({ timeout: LINE_MS });
    await waitArmed(page, chunk, "the first line's prefetch");
    // The tap's evidence probe is held until its note shows, so the note is seen before the restart replaces the screen.
    const probe = await holdRequests(page, '**/api/health');
    await quick(page, 'quick.menu').tap();
    await expect(overlaysNote(page), 'the tap is noted').toBeVisible({ timeout: 10_000 });
    expect(navs.count(), 'no restart before the evidence').toBe(0);
    await probe.requested;
    await probe.release();
    await expect.poll(navs.count, { timeout: LINE_MS, message: 'the restart' }).toBe(1);
    expect(page.url(), 'the chunk latch in the fragment').toContain(`novelReloadedFor=chunk%3A${ownBuild()}`);
    expect(page.url(), 'the launch params kept').toContain('#tgWebAppData=');
    await page.waitForFunction(() => '__tgMock' in window);
    await block.unroute();
    await expect(continueButton(page)).toBeVisible({ timeout: LINE_MS });
    await continueButton(page).tap();
    await expect(shownLine(page)).toBeVisible({ timeout: LINE_MS });
    await quick(page, 'quick.menu').tap();
    await expect(heading(page, 'menu.title'), 'the menu after the restart').toBeVisible({ timeout: 10_000 });
    expect(navs.count(), 'one restart').toBe(1);
  });
});
