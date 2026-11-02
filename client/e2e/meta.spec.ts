// LMI's meta e2e (META-PLAN "Test strategy", e2e; F16, F17, F23, F24, F28): the completion card after a declared
// ending and from Home, the pack purchase through server-dev's simulated payment and the real webhook handler
// (principles 1-2), a hint spent from that pack, and the privacy link through openLink, reached after a late Friends
// answer that a started story dropped. Every number checked is the server's (`GET /api/wallet`); the overlays are found
// by their labelled regions, since the layers under an overlay are inert but still in the accessibility tree Playwright
// reads.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import { mt, type MetaKey } from '../src/i18n/meta.ts';
import {
  ANSWER_SETTLE_MS,
  backToStories,
  catalogTitle,
  enterManor,
  events,
  expect,
  grantChapter,
  holdRequests,
  launch,
  puzzleFrame,
  reachLine,
  tapHotspot,
  test,
  walk,
  walletOf,
  type E2eWindow,
} from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);
const meta = (key: MetaKey, params?: Readonly<Record<string, string | number>>): string => mt('ru', key, params);

const LINE_MS = 30_000;
const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORY_DIR = path.join(REPO_DIR, 'story');

test.use({ reducedMotion: 'reduce' });

/** A file of story/, read in Node only: the meta texts and the hint texts never enter the bundle (principle 0). */
function storyJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(STORY_DIR, file), 'utf8'));
}

/** The 3-hint pack's title as the server's catalog sells it (server/catalog.json, read in Node). */
const PACK_TITLE = (JSON.parse(readFileSync(path.join(REPO_DIR, 'server', 'catalog.json'), 'utf8')) as {
  economy: { packs: { hint_s: { title: { ru: string } } } };
}).economy.packs.hint_s.title.ru;

const TIDE_META = (storyJson('meta.json') as { tide: { endings: { drowned: { ru: string } }; achievements: { first_ending: { name: { ru: string } } } } })
  .tide;

function mock(page: Page, action: 'pressBack'): Promise<void> {
  return page.evaluate((a) => (window as unknown as E2eWindow).__tgMock[a](), action);
}

function setOutcome(page: Page, outcome: 'paid'): Promise<void> {
  return page.evaluate((o) => (window as unknown as E2eWindow).__tgMock.setInvoiceOutcome(o), outcome);
}

const storyCard = (page: Page, story: string) => page.locator(`[data-story="${story}"]`);
const completion = (page: Page) => page.getByRole('region', { name: meta('meta.card_title', { story: catalogTitle('tide') }) });
const theEnd = (page: Page) => page.getByRole('heading', { name: ru('notice.the_end_title') });
const wallet = (page: Page) => page.getByRole('region', { name: meta('meta.wallet_title') });

/** A Home card's Start: the story's first line. */
async function start(page: Page, story: string): Promise<void> {
  const b = storyCard(page, story).getByRole('button', { name: ru('stories.start') });
  await expect(b).toBeVisible();
  await b.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

/** Tide from its first line to the drowned ending's last line, then past it: the end notice. */
async function drown(page: Page): Promise<void> {
  await start(page, 'tide');
  await reachLine(page, 'ch3.shore_drowned.d005', { 'ch3.shore.c001': 0 });
  await page.locator('.dialogue .tap').tap();
  await expect(theEnd(page)).toBeVisible({ timeout: LINE_MS });
}

/**
 * The card shows the drowned ending and `first_ending`, marked new on the first card only: that card's POST is the one
 * the server answers `new` for (M9).
 */
async function expectCard(page: Page, o: { isNew: boolean }): Promise<void> {
  const card = completion(page);
  await expect(card, 'card visible').toBeVisible({ timeout: LINE_MS });
  await expect(card.getByRole('list', { name: meta('meta.card_endings') })).toContainText(TIDE_META.endings.drowned.ru);
  const achievement = card.getByRole('listitem').filter({ hasText: TIDE_META.achievements.first_ending.name.ru });
  await expect(achievement).toBeVisible();
  if (o.isNew) {
    await expect(achievement.locator('.new')).toHaveText(meta('meta.card_new'));
  } else {
    await expect(achievement.locator('.new')).toHaveCount(0);
  }
}

test('meta: ending opens the card with the ending and a new achievement', async ({ page }) => {
  test.setTimeout(120_000);
  await launch(page, 8001);
  await drown(page);
  // F16: after the stats settle, the card comes over the end by itself.
  await expectCard(page, { isNew: true });
});

test('meta: card back returns to the end', async ({ page }) => {
  test.setTimeout(120_000);
  await launch(page, 8002);
  await drown(page);
  await expect(completion(page), 'card visible').toBeVisible({ timeout: LINE_MS });
  await mock(page, 'pressBack');
  await expect(completion(page)).toBeHidden();
  await expect(theEnd(page)).toBeVisible();
  await expect(page.getByRole('button', { name: ru('notice.the_end_action') })).toBeVisible();
});

test('meta: home opens the card after the first ending', async ({ page }) => {
  test.setTimeout(150_000);
  await launch(page, 8003);
  // Before any ending, the card has no playthrough button (F17).
  await expect(storyCard(page, 'tide').getByRole('button', { name: ru('stories.start') })).toBeVisible();
  await expect(storyCard(page, 'tide').getByRole('button', { name: ru('stories.card') })).toHaveCount(0);
  await drown(page);
  await expect(completion(page), 'card visible').toBeVisible({ timeout: LINE_MS });
  await mock(page, 'pressBack');
  await page.getByRole('button', { name: ru('notice.the_end_action') }).tap();
  // This session's ending, then the stats after a reload: each time Home's button opens the card.
  for (const pass of ['session', 'reload']) {
    const button = storyCard(page, 'tide').getByRole('button', { name: ru('stories.card') });
    await expect(button, pass).toBeVisible({ timeout: LINE_MS });
    await button.tap();
    await expectCard(page, { isNew: false });
    await mock(page, 'pressBack');
    await expect(completion(page), pass).toBeHidden();
    if (pass === 'session') {
      await page.reload();
      await page.waitForFunction(() => '__tgMock' in window);
    }
  }
});

test('meta: pack purchase credits the wallet', async ({ page, request }) => {
  test.setTimeout(90_000);
  expect(await walletOf(request, 8004), 'the hint balance before').toBe(0);
  await launch(page, 8004);
  await page.getByRole('button', { name: ru('stories.wallet'), exact: true }).tap();
  const w = wallet(page);
  await expect(w).toBeVisible({ timeout: LINE_MS });
  await expect(w).toContainText(meta('meta.wallet_balance', { kind: meta('meta.kind_hint'), n: 0 }));
  // PP P1: Buy is enabled only after the terms box.
  await w.getByRole('checkbox', { name: meta('meta.wallet_terms_agree') }).check();
  await setOutcome(page, 'paid');
  await w.getByRole('listitem').filter({ hasText: PACK_TITLE }).getByRole('button', { name: meta('meta.wallet_buy', { stars: 1 }) }).tap();
  // The balance shown is the server's after the order turned paid, never the client's own sum.
  await expect(w).toContainText(meta('meta.wallet_balance', { kind: meta('meta.kind_hint'), n: 3 }), { timeout: LINE_MS });
  expect(await walletOf(request, 8004), 'the hint balance after').toBe(3);
});

test('meta: hint from a pack shows its text', async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = storyJson('ch1/world.json') as { puzzles: { drawer: { hints: Array<{ ru: string }> } } };
  const tier1 = world.puzzles.drawer.hints[0]?.ru ?? '';
  expect(tier1, "the drawer's first hint").not.toBe('');
  await grantChapter(request, 8005, 'pack:hint_s');
  expect(await walletOf(request, 8005), 'the pack credited').toBe(3);
  await launch(page, 8005);
  await start(page, 'manor');
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await tapHotspot(page, 'study', 'drawer');
  const frame = puzzleFrame(page, 'drawer');
  await expect(frame).toBeVisible();
  await frame.getByRole('button', { name: ru('puzzle.hint') }).tap();
  const ladder = frame.getByRole('region', { name: ru('hint.title') });
  await expect(ladder).toBeVisible();
  await expect(ladder).toContainText(ru('hint.balance', { n: 3 }));
  await ladder.getByRole('button', { name: ru('hint.use', { n: 1 }) }).tap();
  // The text is the server's answer to the spend (M21), shown in place; the balance is its new one.
  await expect(ladder.locator('li[data-state="unlocked"] .text')).toHaveText(tier1, { timeout: LINE_MS });
  await expect(ladder).toContainText(ru('hint.balance', { n: 2 }));
  expect(await walletOf(request, 8005), 'the hint balance after the spend').toBe(2);
});

test('meta: privacy link opens through openLink', async ({ page, request }) => {
  test.setTimeout(120_000);
  // Critique O2: Friends tapped on Home, then a story started before the friends read landed. The root change (boot's
  // onView forward) drops that answer, so Friends never comes over the story; back on Home, it opens.
  const social = await holdRequests(page, '**/api/social');
  await launch(page, 8006);
  await social.requested; // the controller's boot read: the controller is in before the tap
  await page.getByRole('button', { name: ru('stories.friends'), exact: true }).tap();
  await start(page, 'tide');
  await social.release();
  await page.waitForTimeout(ANSWER_SETTLE_MS);
  const friends = page.getByRole('region', { name: meta('meta.friends_title') });
  await expect(friends, 'Friends pushed over the story').toHaveCount(0);
  await backToStories(page);
  await page.getByRole('button', { name: ru('stories.friends'), exact: true }).tap();
  await expect(friends).toBeVisible({ timeout: LINE_MS });
  await friends.getByRole('button', { name: meta('meta.friends_policy'), exact: true }).tap();
  // F28: through the facade's openLink inside the tap, https on this host; the mock records it and navigates nowhere.
  const host = new URL(page.url()).host;
  await expect
    .poll(async () => (await events(page)).filter((e) => e.type === 'web_app_open_link').map((e) => Reflect.get(Object(e.data), 'url')))
    .toEqual([`https://${host}/api/privacy`]);
  expect((await request.get('/api/privacy')).status(), 'GET /api/privacy').toBe(200);
});
