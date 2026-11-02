// LMI's social e2e (META-PLAN "Test strategy", e2e; M10-M14, M22; F18-F22, F25): an invite link, a friend's profile
// behind the friend's consent, the share as a prepared message and its fallback link, and a gift between friends.
// The second user has a browser context of its own, through the same guards as the fixture's page, checked before it
// closes. Every friendship and balance checked is the server's; the setup a test does not exercise goes through the
// API with the dev users' real tokens (devToken), never through a dev shortcut.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext, Browser, BrowserContextOptions, Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import { mt, type MetaKey } from '../src/i18n/meta.ts';
import { catalogTitle, devToken, events, expect, grantChapter, guard, inviteCode, launch, reachLine, test, walletOf, type E2eWindow } from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);
const meta = (key: MetaKey, params?: Readonly<Record<string, string | number>>): string => mt('ru', key, params);

const LINE_MS = 30_000;
/** The first name `/dev/launch` signs when the launch names none: the users these tests do not name. */
const DEV_NAME = 'Dev';
const STORY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'story');

test.use({ reducedMotion: 'reduce' });

const auth = async (request: APIRequestContext, uid: number) => ({ Authorization: `Bearer ${await devToken(request, uid)}` });

/** `b` asks `a` through `a`'s invite code, and `a` accepts: a friendship the server records (M10). */
async function befriend(request: APIRequestContext, a: number, b: number): Promise<void> {
  const code = await inviteCode(request, a);
  const asked = await request.post(`/api/invites/${code}/request`, { headers: await auth(request, b) });
  expect(asked.status(), 'POST /api/invites/{code}/request').toBe(200);
  const asA = await auth(request, a);
  const social = (await (await request.get('/api/social', { headers: asA })).json()) as { requests: Array<{ handle: string }> };
  const handle = social.requests[0]?.handle;
  if (handle === undefined) {
    throw new Error('the request did not reach the inviter');
  }
  const accepted = await request.post(`/api/friends/requests/${handle}/accept`, { headers: asA });
  expect(accepted.status(), 'POST /api/friends/requests/{handle}/accept').toBe(200);
}

/** A second user's page in a context of its own, with the config's page options and the fixture's guards. */
async function secondPage(browser: Browser, options: BrowserContextOptions): Promise<{ page: Page; close(): Promise<void> }> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const check = await guard(page);
  return {
    page,
    close: async () => {
      check();
      await context.close();
    },
  };
}

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** Home's Friends: the overlay. */
async function openFriends(page: Page) {
  await page.getByRole('button', { name: ru('stories.friends'), exact: true }).tap();
  const friends = region(page, meta('meta.friends_title'));
  await expect(friends).toBeVisible({ timeout: LINE_MS });
  return friends;
}

/** Home's Friends, then the friend named `name`: the profile overlay. */
async function openProfile(page: Page, name: string) {
  const friends = await openFriends(page);
  await friends.getByRole('button', { name, exact: true }).tap();
  const profile = region(page, name);
  await expect(profile).toBeVisible({ timeout: LINE_MS });
  return profile;
}

test('social: invite link sends a request the inviter accepts', async ({ page, request, browser, baseURL, viewport, hasTouch }) => {
  const code = await inviteCode(request, 9001);
  // B opens A's link (`startapp=f<code>`, M11): the prompt names nobody; Send asks once.
  const b = await secondPage(browser, { baseURL, viewport, hasTouch, reducedMotion: 'reduce' });
  await launch(b.page, 9002, { name: 'Bea', startapp: `f${code}` });
  const prompt = region(b.page, meta('meta.invite_title'));
  await expect(prompt).toBeVisible({ timeout: LINE_MS });
  await prompt.getByRole('button', { name: meta('meta.invite_send') }).tap();
  await expect(prompt).toBeHidden();
  await expect(b.page.getByText(ru('meta.invite_sent'))).toBeVisible();
  await b.close();

  // A sees the request and accepts it: B is a friend, on the server too.
  await launch(page, 9001, { name: 'Аня' });
  const friends = await openFriends(page);
  const row = friends.getByRole('listitem').filter({ hasText: 'Bea' });
  await row.getByRole('button', { name: meta('meta.friends_accept') }).tap();
  await expect(friends.getByRole('button', { name: 'Bea', exact: true })).toBeVisible({ timeout: LINE_MS });
  await expect(friends.getByRole('button', { name: meta('meta.friends_accept') })).toHaveCount(0);
  const social = (await (await request.get('/api/social', { headers: await auth(request, 9001) })).json()) as {
    friends: Array<{ firstName: string }>;
    requests: unknown[];
  };
  expect([social.friends.map((f) => f.firstName), social.requests]).toEqual([['Bea'], []]);
});

test('social: friend profile hidden until consent', async ({ page, request, browser, baseURL, viewport, hasTouch }) => {
  await befriend(request, 9003, 9004);
  await launch(page, 9003);
  const hidden = await openProfile(page, DEV_NAME);
  // M12: off by default, so the friend's progress is hidden.
  await expect(hidden).toContainText(meta('meta.friend_hidden'));

  // The friend turns the consent on in her own app.
  const b = await secondPage(browser, { baseURL, viewport, hasTouch, reducedMotion: 'reduce' });
  await launch(b.page, 9004);
  const friends = await openFriends(b.page);
  await friends.getByRole('button', { name: meta('meta.friends_visibility') }).tap();
  const consent = region(b.page, meta('meta.consent_title'));
  await expect(consent).toBeVisible({ timeout: LINE_MS });
  const toggle = consent.getByRole('switch', { name: meta('meta.consent_switch') });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: LINE_MS });
  await b.close();

  // A opens the profile again: it is read again, and shown.
  await page.evaluate(() => (window as unknown as E2eWindow).__tgMock.pressBack());
  await expect(hidden).toBeHidden();
  const friendsOfA = region(page, meta('meta.friends_title'));
  await friendsOfA.getByRole('button', { name: DEV_NAME, exact: true }).tap();
  const shown = region(page, DEV_NAME);
  await expect(shown).toBeVisible({ timeout: LINE_MS });
  await expect(shown).not.toContainText(meta('meta.friend_hidden'));
});

test('social: share sends a prepared message without titles', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tide = (JSON.parse(readFileSync(path.join(STORY_DIR, 'meta.json'), 'utf8')) as {
    tide: { endings: Record<string, { ru: string; en: string }>; achievements: Record<string, { name: { ru: string; en: string } }> };
  }).tide;
  const titles = [...Object.values(tide.endings).flatMap((e) => [e.ru, e.en]), ...Object.values(tide.achievements).flatMap((a) => [a.name.ru, a.name.en])];
  await launch(page, 9005);
  const start = page.locator('[data-story="tide"]').getByRole('button', { name: ru('stories.start') });
  await start.tap();
  await reachLine(page, 'ch3.shore_drowned.d005', { 'ch3.shore.c001': 0 });
  await page.locator('.dialogue .tap').tap();
  const card = region(page, meta('meta.card_title', { story: catalogTitle('tide') }));
  await expect(card).toBeVisible({ timeout: LINE_MS });
  await card.getByRole('button', { name: meta('meta.card_share') }).tap();
  // M14: the server's prepared message, sent through the native share (the dev launch claims 9.6).
  let id: unknown;
  await expect
    .poll(async () => {
      id = (await events(page)).find((e) => e.type === 'web_app_send_prepared_message')?.data;
      return typeof id === 'object' && id !== null ? Reflect.get(id, 'id') : undefined;
    })
    .toMatch(/^dev-prepared-\d+$/);
  const preparedId = String(Reflect.get(Object(id), 'id'));
  expect((await events(page)).some((e) => e.type === 'web_app_open_tg_link'), 'no fallback link').toBe(false);
  const res = await request.get(`/dev/prepared/${preparedId}`);
  expect(res.status(), 'GET /dev/prepared/{id}').toBe(200);
  const prepared = (await res.json()) as { title: string; text: string; button: string };
  // RULINGS 79 Q3: a share names no ending and no achievement, so it gives nothing of the story away.
  for (const title of titles) {
    expect(`${prepared.title}\n${prepared.text}\n${prepared.button}`, title).not.toContain(title);
  }
  expect(prepared.text).not.toBe('');
  await expect(card).toBeVisible();
});

test('social: share falls back to a share link below 8.0', async ({ page }) => {
  await launch(page, 9006);
  // TWA's shareMessage needs Mini App API 8.0: below it, the facade reports `unsupported` and the link is opened.
  // setVersion reloads the page: started after the evaluate returns, so the evaluate is not cut by the navigation.
  const reloaded = page.waitForEvent('load');
  await page.evaluate(() => {
    setTimeout(() => (window as unknown as E2eWindow).__tgMock.setVersion('7.10'), 0);
  });
  await reloaded;
  await page.waitForFunction(() => '__tgMock' in window && location.hash.includes('tgWebAppVersion=7.10'));
  const friends = await openFriends(page);
  await friends.getByRole('button', { name: meta('meta.friends_invite') }).tap();
  await expect
    .poll(async () => (await events(page)).filter((e) => e.type === 'web_app_open_tg_link').map((e) => String(Reflect.get(Object(e.data), 'path_full'))))
    .toEqual([expect.stringMatching(/^\/share\/url\?url=https%3A%2F%2Ft\.me%2F[^&]+&text=/)]);
  expect((await events(page)).some((e) => e.type === 'web_app_send_prepared_message'), 'no prepared message').toBe(false);
});

test('social: gift moves a hint to a friend', async ({ page, request }) => {
  await grantChapter(request, 9007, 'pack:hint_s');
  await befriend(request, 9007, 9008);
  expect([await walletOf(request, 9007), await walletOf(request, 9008)], 'the balances before').toEqual([3, 0]);
  await launch(page, 9007);
  const profile = await openProfile(page, DEV_NAME);
  await profile.getByRole('button', { name: meta('meta.friend_gift') }).tap();
  const dialog = region(page, meta('meta.gift_title', { name: DEV_NAME }));
  await expect(dialog).toBeVisible({ timeout: LINE_MS });
  await expect(dialog.getByRole('status')).toHaveText(meta('meta.gift_amount', { n: 1 }));
  await dialog.getByRole('button', { name: meta('meta.gift_send') }).tap();
  // Success closes the dialog; the move is the server's, once (M22).
  await expect(dialog).toBeHidden({ timeout: LINE_MS });
  await expect.poll(async () => [await walletOf(request, 9007), await walletOf(request, 9008)]).toEqual([2, 1]);
});
