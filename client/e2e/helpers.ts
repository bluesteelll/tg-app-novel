// The e2e fixtures and the skip guard. Every test's page:
// - gets index.html's https://telegram.org/js/telegram-web-app.js?64 from the pinned fixture (no network);
// - has every other request that leaves the loopback aborted, and the test fails at teardown if one was;
// - records window.open / alert / confirm / prompt calls instead of running them (an init script), and any dialog.
// A fresh browser context per test also means fresh sessionStorage (TWA's `__telegram__*` keys).
// The default export is a reporter, since Playwright loads a reporter only as a module's default export: it fails
// the run when any test ended skipped (PROTOTYPE-PLAN "Vacuous-green guards").
// The play helpers (L15b; MEMORY-PLAN section 14 item 7): a dev user per test, the debug hook's readers and the line
// helper, exported so later specs reuse them. They find a line by `.dialogue[data-line-id]` only: choices and backlog
// rows carry `data-line-id` too.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, expect, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import sharp from 'sharp';

import type { PutSaveRequest } from '../src/api/generated/api.ts';
import { EMPTY_WORLD_STATE } from '../src/explore/state.ts';
import { t } from '../src/i18n/index.ts';
import type { InkScalar } from '../src/story/catalog.ts';
import { SAVE_FORMAT, encodeSave, type SaveBody } from '../src/story/save-codec.ts';
import { EMPTY_SNAPSHOT, type ChapterId, type StoryVersion, type VarName } from '../src/story/staging.ts';
import type { MockControls, MockEvent } from '../src/telegram/dev/mock-transport.ts';

/** A call the init script intercepted. */
export type ForbiddenCall = { name: string; args: string[] };

/**
 * The fields of `__novelDebug.stats()` the specs read. Specs read fields and never compare the whole value: later
 * lanes add counters (MEMORY-PLAN M2).
 */
export type DebugStats = {
  scene: { liveTextures: number; liveBytes: number; pendingLoads: number; activeTimelines: number; overCap: number };
  audio: { decodedBytes: number; state: string } | null;
  runners: number;
  explore: boolean;
  puzzle: boolean;
};

/** `__novelDebug`, installed by the engine's Game in `__TG_MOCK__` builds (app/game.ts). */
export type NovelDebug = {
  stats(): DebugStats;
  lineId(): string | null;
  forceContextLoss(): void;
  propRects(): ReadonlyArray<{ prop: string; x: number; y: number; w: number; h: number }>;
};

/**
 * `__novelChunks`, Q60's recovery as boot made it (app/boot.ts `createPageRecovery`), in `__TG_MOCK__` builds only: the
 * armed keys (a failed chunk's URL, or '' for a failure that names none), the failure events whose evidence round has
 * ended, and the recovery the page holds itself (null once handed to the Game).
 */
export type ChunksHook = {
  armed(): readonly string[];
  checked(): number;
  wanted(): 'chunk' | 'skew' | null;
};

/** The page's globals the specs read. */
export type E2eWindow = Window & {
  __tgMock: MockControls;
  __e2eForbidden: ForbiddenCall[];
  __novelDebug?: NovelDebug;
  __novelChunks?: ChunksHook;
};

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const TWA_FIXTURE = path.join(E2E_DIR, 'fixtures', 'telegram-web-app.js');
/** The client directory: the story tool's and the e2e build's outputs are read from here, in Node only. */
const CLIENT_DIR = path.resolve(E2E_DIR, '..');

/** index.html's TWA tag, by URL parts: a `?` in a Playwright glob is a wildcard, not the literal query. */
function isTwaScript(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname === 'telegram.org' && url.pathname === '/js/telegram-web-app.js';
}

function isLoopback(url: URL): boolean {
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
}

/** Runs in the page before any of its scripts; self-contained (Playwright serialises it). */
function recordForbiddenCalls(): void {
  const calls: Array<{ name: string; args: string[] }> = [];
  Object.defineProperty(window, '__e2eForbidden', { value: calls });
  const target = window as unknown as Record<string, unknown>;
  for (const name of ['open', 'alert', 'confirm', 'prompt']) {
    target[name] = (...args: unknown[]): null => {
      calls.push({ name, args: args.map((a) => String(a)) });
      return null;
    };
  }
}

/**
 * The fixture's guards on any page: the TWA script from the fixture, every request off the loopback aborted, the
 * forbidden calls recorded, dialogs dismissed. The returned check fails the test if a request was aborted or a dialog
 * opened; a spec that opens its own context calls it before closing that context.
 */
export async function guard(page: Page): Promise<() => void> {
  const aborted: string[] = [];
  const dialogs: string[] = [];
  await page.route(
    () => true,
    async (route) => {
      const url = new URL(route.request().url());
      if (isTwaScript(url)) {
        await route.fulfill({ path: TWA_FIXTURE, contentType: 'application/javascript; charset=utf-8' });
      } else if (isLoopback(url)) {
        await route.continue();
      } else {
        aborted.push(url.href);
        await route.abort('blockedbyclient');
      }
    },
  );
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss(); // dismissing settles the dialog; its promise carries nothing the test needs
  });
  await page.addInitScript(recordForbiddenCalls);
  return () => {
    expect(aborted, 'requests that would have left the machine').toEqual([]);
    expect(dialogs, 'dialogs the page opened').toEqual([]);
  };
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const check = await guard(page);
    await use(page);
    check();
  },
});

export { expect };

/**
 * Opens the app the way the dev launch does: `/` -> the bootstrap's redirect to `/dev/launch` (server-dev through
 * preview.proxy) -> 302 to `/#tgWebAppData=…` -> the mock installed by main.ts.
 */
export async function boot(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForURL(/#tgWebAppData=/);
  await page.waitForFunction(() => '__tgMock' in window);
}

/** Every `postEvent` the mock recorded, in order. */
export function events(page: Page): Promise<MockEvent[]> {
  return page.evaluate(() => (window as unknown as E2eWindow).__tgMock.events);
}

/**
 * Opens the app as dev user `uid` (server-dev's `/dev/launch`, 302 to the signed hash) and waits for the mock. One uid
 * per test: purchases and saves are server state, and server-dev's database lives for the whole run. `name` is the
 * user's first name in the initData; `startapp` the launch link's start parameter (`f<invite code>`, META M11).
 */
export async function launch(page: Page, uid: number, o: { lang?: 'ru' | 'en'; name?: string; startapp?: string } = {}): Promise<void> {
  const query = new URLSearchParams({ uid: String(uid) });
  for (const [key, value] of [
    ['lang', o.lang],
    ['name', o.name],
    ['startapp', o.startapp],
  ] as const) {
    if (value !== undefined) {
      query.set(key, value);
    }
  }
  await page.goto(`/dev/launch?${query.toString()}`, { waitUntil: 'commit' });
  await page.waitForURL(/#tgWebAppData=/);
  await page.waitForFunction(() => '__tgMock' in window);
}

/** The server's own token for dev user `uid`, through the real exchange: `/dev/launch`'s signed initData, `POST /api/auth`. */
export async function devToken(request: APIRequestContext, uid: number): Promise<string> {
  const launched = await request.get(`/dev/launch?uid=${uid}`, { maxRedirects: 0 });
  expect(launched.status(), 'GET /dev/launch').toBe(302);
  const location = launched.headers()['location'] ?? '';
  const initData = new URLSearchParams(location.slice(location.indexOf('#') + 1)).get('tgWebAppData');
  expect(initData, 'tgWebAppData in the launch hash').not.toBeNull();
  const auth = await request.post('/api/auth', { data: { initData } });
  expect(auth.status(), 'POST /api/auth').toBe(200);
  const body: unknown = await auth.json();
  const token = typeof body === 'object' && body !== null && 'token' in body ? body.token : undefined;
  if (typeof token !== 'string') {
    throw new Error('POST /api/auth answered without a token');
  }
  return token;
}

/** A JSON answer of the server for dev user `uid` (the bearer from devToken), checked for a 200. */
async function getAs(request: APIRequestContext, uid: number, url: string): Promise<unknown> {
  const res = await request.get(url, { headers: { Authorization: `Bearer ${await devToken(request, uid)}` } });
  expect(res.status(), `GET ${url}`).toBe(200);
  return res.json();
}

/** Dev user `uid`'s invite code: `GET /api/social`, which creates it on the first call (META M10). */
export async function inviteCode(request: APIRequestContext, uid: number): Promise<string> {
  const body = await getAs(request, uid, '/api/social');
  const code: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'inviteCode') : undefined;
  if (typeof code !== 'string') {
    throw new Error('GET /api/social answered without an inviteCode');
  }
  return code;
}

/** Dev user `uid`'s hint balance: `GET /api/wallet`, the server's number (principle 1). */
export async function walletOf(request: APIRequestContext, uid: number): Promise<number> {
  const body = await getAs(request, uid, '/api/wallet');
  const balances: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'balances') : undefined;
  const hint: unknown = Array.isArray(balances) ? (balances as unknown[]).find((b) => typeof b === 'object' && b !== null && Reflect.get(b, 'kind') === 'hint') : undefined;
  const balance: unknown = typeof hint === 'object' && hint !== null ? Reflect.get(hint, 'balance') : undefined;
  if (typeof balance !== 'number') {
    throw new Error('GET /api/wallet answered without a hint balance');
  }
  return balance;
}

/** `__novelDebug.stats()`, once the engine has installed the hook. */
export async function debugStats(page: Page): Promise<DebugStats> {
  await page.waitForFunction(() => '__novelDebug' in window);
  return page.evaluate(() => {
    const hook = (window as unknown as E2eWindow).__novelDebug;
    if (hook === undefined) {
      throw new Error('__novelDebug is gone');
    }
    return hook.stats();
  });
}

/** The line the game shows (`vm.line`), or null: none, or the engine is not in yet. */
export function lineId(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as E2eWindow).__novelDebug?.lineId() ?? null);
}

/** Every request whose URL matches, from now on, in order. */
export function requests(page: Page, match: RegExp): { readonly urls: string[] } {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (match.test(r.url())) {
      urls.push(r.url());
    }
  });
  return { urls };
}

/** After a held answer arrives: far longer than the page needs to decode it and push an overlay. */
export const ANSWER_SETTLE_MS = 2000;

/**
 * Holds every request of `page` matching `url` until `release()`. A delay only: the request goes on to the fixture's
 * guard and the answer is the server's. `requested` settles at the first such request; `release()` returns once every
 * request held so far has its whole answer.
 */
export async function holdRequests(page: Page, url: string): Promise<{ readonly requested: Promise<void>; release(): Promise<void> }> {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  let seen = (): void => undefined;
  const requested = new Promise<void>((resolve) => (seen = resolve));
  const answers: Array<Promise<unknown>> = [];
  await page.route(url, async (route) => {
    seen();
    answers.push(route.request().response().then((r) => r?.finished()));
    await opened;
    await route.fallback();
  });
  return {
    requested,
    release: async () => {
      open();
      await Promise.all(answers);
    },
  };
}

/** The quick menu's "Back to stories": the session ends, and Home shows the story cards again (and a held prompt). */
export async function backToStories(page: Page): Promise<void> {
  await page.getByRole('button', { name: t('ru', 'quick.menu') }).tap();
  await page.getByRole('button', { name: t('ru', 'menu.back_to_stories') }).tap();
  await expect(page.locator('[data-story]').first()).toBeVisible({ timeout: STEP_MS });
}

/** What the play surface shows: the dialogue's line (null while hidden), whether it is still revealing, the choices. */
type PlayState = { line: string | null; revealing: boolean; choices: string[] };

/** Runs in the page (Playwright serialises it). */
function readPlay(): PlayState {
  const box = document.querySelector<HTMLElement>('.dialogue');
  const shown = box !== null && !box.hidden;
  return {
    line: shown ? box.getAttribute('data-line-id') : null,
    revealing: shown && (box.querySelector('[data-reveal="rest"]')?.textContent ?? '') !== '',
    choices: [...document.querySelectorAll('.choices button')].map((b) => b.getAttribute('data-line-id') ?? ''),
  };
}

/** A step can wait for a chapter load and a scene transition. */
const STEP_MS = 20_000;
/** Longer than any path the specs walk with one call. */
const REACH_MAX_STEPS = 150;

/**
 * Waits for a step at rest: a line fully revealed or a choice set, with no transition running. A tap during a
 * transition only completes it, and a pick during one is ignored (app/game.ts F2), so neither would advance.
 */
async function atRestStep(page: Page): Promise<PlayState> {
  let last: PlayState = { line: null, revealing: false, choices: [] };
  await expect
    .poll(
      async () => {
        last = await page.evaluate(readPlay);
        const shown = last.choices.length > 0 || (last.line !== null && !last.revealing);
        return shown && (await debugStats(page)).scene.activeTimelines === 0;
      },
      { timeout: STEP_MS, message: 'a line or a choice set at rest' },
    )
    .toBe(true);
  return last;
}

/**
 * Plays on until `.dialogue` shows `target`: one tap per step at rest (a revealed line advances), and each choice set
 * answered by `picks[<its first option's line id>]`, else option 0. Throws if the story stops elsewhere (a yield, an
 * end, a paywall) or the line is not reached.
 */
export async function reachLine(page: Page, target: string, picks: Readonly<Record<string, number>> = {}): Promise<void> {
  for (let step = 0; step < REACH_MAX_STEPS; step++) {
    const now = await atRestStep(page);
    const first = now.choices[0];
    if (first !== undefined) {
      await page.locator('.choices button').nth(picks[first] ?? 0).tap();
      await expect
        .poll(async () => (await page.evaluate(readPlay)).choices.join(' '), { timeout: STEP_MS, message: `the pick in ${first}` })
        .not.toBe(now.choices.join(' '));
      continue;
    }
    if (now.line === target) {
      return;
    }
    await page.locator('.dialogue .tap').tap();
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(readPlay);
          return s.line !== now.line || s.choices.length > 0;
        },
        { timeout: STEP_MS, message: `the step after ${now.line ?? 'nothing'} (on the way to ${target})` },
      )
      .toBe(true);
  }
  throw new Error(`reachLine: ${target} not reached in ${REACH_MAX_STEPS} steps`);
}

/** A title of the public catalog (`src/story-gen/catalog.json`, the story tool's output), in Russian. */
export function catalogTitle(id: string): string {
  const raw: unknown = JSON.parse(readFileSync(path.join(CLIENT_DIR, 'src', 'story-gen', 'catalog.json'), 'utf8'));
  const lists = typeof raw === 'object' && raw !== null ? [Reflect.get(raw, 'stories'), Reflect.get(raw, 'chapters')] : [];
  for (const list of lists) {
    for (const entry of Array.isArray(list) ? (list as unknown[]) : []) {
      if (typeof entry === 'object' && entry !== null && Reflect.get(entry, 'id') === id) {
        const ru: unknown = Reflect.get(Reflect.get(entry, 'title') ?? {}, 'ru');
        if (typeof ru === 'string') {
          return ru;
        }
      }
    }
  }
  throw new Error(`catalog.json has no title for ${id}`);
}

/** What the specs read of `story/ch1/world.json`; the story gate has checked the file's shape. */
type WorldJson = {
  items: Record<string, { name: { ru: string } }>;
  puzzles: Record<string, { title: { ru: string }; params: { pieces?: string[] }; solution: number[] }>;
  sections: Record<string, { rooms: Record<string, { hotspots: Array<{ id: string; label: { ru: string } }> }> }>;
};

/** ch1's world, read in Node only: its solutions never enter the bundle (principle 0). */
function ch1World(): WorldJson {
  // A cast of a repository file the story gate validates; a missing field throws in the readers below.
  return JSON.parse(readFileSync(path.join(CLIENT_DIR, '..', 'story', 'ch1', 'world.json'), 'utf8')) as WorldJson;
}

/** The demo's solutions: the gate's order and the drawer's code. */
export function worldSolutions(): { gate: number[]; drawer: number[] } {
  const w = ch1World();
  const of = (id: string): number[] => {
    const p = w.puzzles[id];
    if (p === undefined) {
      throw new Error(`world.json has no puzzle ${id}`);
    }
    return p.solution;
  };
  return { gate: of('gate'), drawer: of('drawer') };
}

/** A ch1 hotspot's label in Russian: its button's `aria-label`. */
export function hotspotLabel(room: string, id: string): string {
  const label = ch1World().sections['manor']?.rooms[room]?.hotspots.find((h) => h.id === id)?.label.ru;
  if (label === undefined) {
    throw new Error(`world.json has no hotspot ${room}.${id}`);
  }
  return label;
}

/** A ch1 item's name in Russian. */
export function itemName(id: string): string {
  const name = ch1World().items[id]?.name.ru;
  if (name === undefined) {
    throw new Error(`world.json has no item ${id}`);
  }
  return name;
}

/** A ch1 puzzle's title in Russian: its frame's heading. */
export function puzzleTitle(id: string): string {
  const title = ch1World().puzzles[id]?.title.ru;
  if (title === undefined) {
    throw new Error(`world.json has no puzzle ${id}`);
  }
  return title;
}

/** A ch1 hotspot's button, found by its label. */
export const hotspot = (page: Page, room: string, id: string): Locator =>
  page.getByRole('button', { name: hotspotLabel(room, id), exact: true });

/** The open puzzle's frame (PuzzleHost's labelled section). */
export const puzzleFrame = (page: Page, id: string): Locator => page.getByRole('region', { name: puzzleTitle(id), exact: true });

/**
 * The scene at rest: no load and no transition, on two reads 100 ms apart. A room's hotspots show while its
 * background still loads, and a hotspot tap or an insert during that batch only completes it (app/game.ts D7).
 */
export async function atRest(page: Page): Promise<void> {
  const still = async (): Promise<boolean> => {
    const s = (await debugStats(page)).scene;
    return s.pendingLoads === 0 && s.activeTimelines === 0;
  };
  await expect
    .poll(
      async () => {
        if (!(await still())) {
          return false;
        }
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
        return still();
      },
      { timeout: STEP_MS, message: 'the scene at rest (no load, no transition)' },
    )
    .toBe(true);
}

/** Taps a hotspot of the current room once the scene is at rest; a room change, a take or a lock answers on screen. */
export async function tapHotspot(page: Page, room: string, id: string): Promise<void> {
  const h = hotspot(page, room, id);
  await expect(h).toBeVisible({ timeout: STEP_MS });
  await atRest(page);
  await h.tap();
}

/** An exit, then the next room's own exit button. */
export async function walk(page: Page, room: string, exit: string, to: string, toExit: string): Promise<void> {
  await tapHotspot(page, room, exit);
  await expect(hotspot(page, to, toExit)).toBeVisible({ timeout: STEP_MS });
}

/** A `take`: its button goes with the prop. */
export async function take(page: Page, room: string, id: string): Promise<void> {
  await tapHotspot(page, room, id);
  await expect(hotspot(page, room, id)).toBeHidden({ timeout: STEP_MS });
}

/** The code lock: each dial stepped up to its digit, then Try; the frame closes once solved. */
async function solveCode(page: Page, puzzle: string, code: readonly number[]): Promise<void> {
  const frame = puzzleFrame(page, puzzle);
  await expect(frame).toBeVisible({ timeout: STEP_MS });
  for (const [i, want] of code.entries()) {
    const dial = frame.locator('.dial').nth(i);
    const digit = dial.locator('.digit');
    await expect(digit).toBeVisible({ timeout: STEP_MS });
    for (let n = 0; n < 10 && Number(await digit.textContent()) !== want; n++) {
      const before = await digit.textContent();
      await dial.getByRole('button', { name: t('ru', 'puzzle.dial_up') }).tap();
      await expect(digit).not.toHaveText(before ?? '');
    }
    await expect(digit).toHaveText(String(want));
  }
  await frame.getByRole('button', { name: t('ru', 'puzzle.try') }).tap();
  await expect(frame).toBeHidden({ timeout: STEP_MS });
}

/** The order puzzle's slots put in `order` (indices into its pieces): two taps swap two slots, a selection sort. */
export async function arrangeOrder(page: Page, puzzle: string, order: readonly number[]): Promise<void> {
  const frame = puzzleFrame(page, puzzle);
  await expect(frame).toBeVisible({ timeout: STEP_MS });
  const pieces = ch1World().puzzles[puzzle]?.params.pieces ?? [];
  const want = order.map((i) => itemName(pieces[i] ?? ''));
  const slots = frame.locator('.slots button');
  await expect(slots).toHaveCount(want.length);
  for (let i = 0; i < want.length; i++) {
    const names = await slots.locator('.name').allTextContents();
    const j = names.indexOf(want[i] ?? '', i);
    if (j > i) {
      await slots.nth(i).tap();
      await slots.nth(j).tap();
      await expect(slots.nth(i).locator('.name')).toHaveText(want[i] ?? '');
    }
  }
  await expect(slots.locator('.name')).toHaveText(want);
}

/** The order puzzle in `order`, then Try; the frame closes once solved. */
export async function solveOrder(page: Page, puzzle: string, order: readonly number[]): Promise<void> {
  await arrangeOrder(page, puzzle, order);
  const frame = puzzleFrame(page, puzzle);
  await frame.getByRole('button', { name: t('ru', 'puzzle.try') }).tap();
  await expect(frame).toBeHidden({ timeout: STEP_MS });
}

/** From ch1's first line into its explore section (`# explore: manor`): the hall's hotspot layer shows. */
export async function enterManor(page: Page, picks: Readonly<Record<string, number>> = {}): Promise<void> {
  await reachLine(page, 'ch1.manor_arrive.a008', picks);
  await page.locator('.dialogue .tap').tap();
  await expect(hotspot(page, 'hall', 'to_study'), 'the hotspot layer').toBeVisible({ timeout: STEP_MS });
}

/**
 * Plays ch1 from its first line through the explore section up to the gate's order puzzle: the hall, the study (the
 * sun medal, the drawer's code: the moon medal), the cellar (its voice event, the star medal), then the gate's three
 * slots, the last of which opens its order puzzle. Choices take `picks` (reachLine's rule), option 0 by default: the
 * trust picks. `o.inDrawer` runs while the drawer's frame is open, before its code is entered (the perf heap sample).
 */
export async function playCh1ToGate(
  page: Page,
  picks: Readonly<Record<string, number>> = {},
  o: { inDrawer?: () => Promise<void> } = {},
): Promise<void> {
  await enterManor(page, picks);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await take(page, 'study', 'medal');
  await tapHotspot(page, 'study', 'drawer');
  await expect(puzzleFrame(page, 'drawer')).toBeVisible({ timeout: STEP_MS });
  await o.inDrawer?.();
  await solveCode(page, 'drawer', worldSolutions().drawer);
  await walk(page, 'study', 'to_hall', 'hall', 'to_cellar');
  await tapHotspot(page, 'hall', 'to_cellar'); // the cellar's onEnter: the voice
  await reachLine(page, 'ch1.manor_cellar_voice.v007', picks);
  await page.locator('.dialogue .tap').tap(); // `# explore: manor`: back in the cellar
  await take(page, 'cellar', 'star');
  await walk(page, 'cellar', 'to_hall', 'hall', 'gate');
  await tapHotspot(page, 'hall', 'gate'); // the lock panel
  for (const item of ['medal_sun', 'medal_moon', 'medal_star']) {
    const held = page.locator('.held-item', { hasText: itemName(item) });
    await expect(held).toBeVisible({ timeout: STEP_MS });
    await atRest(page);
    await held.tap();
    await expect(held).toBeHidden({ timeout: STEP_MS });
  }
  await expect(puzzleFrame(page, 'gate')).toBeVisible({ timeout: STEP_MS });
}

/**
 * Plays ch1 from its first line to its END (playCh1ToGate, the gate's order, the way out) and taps past the last
 * line. What follows the END (the paywall, the next chapter, a notice) is the caller's to check.
 */
export async function playCh1ToEnd(
  page: Page,
  picks: Readonly<Record<string, number>> = {},
  o: { inDrawer?: () => Promise<void> } = {},
): Promise<void> {
  await playCh1ToGate(page, picks, o);
  await solveOrder(page, 'gate', worldSolutions().gate);
  await tapHotspot(page, 'hall', 'gate'); // open now: `manor_out`
  await reachLine(page, 'ch1.street.s018', picks);
  await page.locator('.dialogue .tap').tap(); // END
}

/**
 * F4 step 3's pending start, written as the dev user's `auto` of the chapter's story: the save of a chapter that has
 * not started (`ink: null`) with the values carried into it, so a Continue opens the chapter's paywall at once.
 * `storyVersion` is the previous chapter's, as the game writes it (its next chapter is not loaded yet).
 */
export async function plantPending(
  request: APIRequestContext,
  uid: number,
  chapterId: 'ch2' | 'ch4',
  carry: Readonly<Record<string, string | number | boolean>>,
): Promise<void> {
  const [story, previous] = chapterId === 'ch2' ? ['manor', 'ch1'] : ['tide', 'ch3'];
  const meta: unknown = JSON.parse(readFileSync(path.join(CLIENT_DIR, 'src', 'story-gen', 'free', `${previous}.meta.json`), 'utf8'));
  const storyVersion: unknown = typeof meta === 'object' && meta !== null ? Reflect.get(meta, 'storyVersion') : undefined;
  if (typeof storyVersion !== 'string') {
    throw new Error(`${previous}.meta.json has no storyVersion`);
  }
  // The brands are the story decoders'; this body is built from the build's own ids, as the game builds it.
  const body: SaveBody = {
    format: SAVE_FORMAT,
    chapterId: chapterId as ChapterId,
    storyVersion: storyVersion as StoryVersion,
    ink: null,
    at: { lineId: null, knot: null, yield: null },
    staging: EMPTY_SNAPSHOT,
    checkpoint: null,
    chapterStart: { carry: carry as Record<VarName, InkScalar>, items: [] },
    backlog: [],
    world: EMPTY_WORLD_STATE,
    worldVersion: null,
  };
  const write: PutSaveRequest = { expectedRev: null, writeId: randomUUID(), chapterId, storyVersion, lineId: null, body: encodeSave(body) };
  const res = await request.put(`/api/saves/${story}/auto`, {
    headers: { Authorization: `Bearer ${await devToken(request, uid)}` },
    data: write,
  });
  expect(res.status(), `PUT /api/saves/${story}/auto`).toBe(200);
}

/**
 * Buys `product` for dev user `uid` the way a payment arrives: `POST /api/invoices`, then server-dev's simulated
 * payment through the real pre-checkout and webhook handlers (principles 1-2); never a direct grant.
 */
export async function grantChapter(request: APIRequestContext, uid: number, product: string): Promise<void> {
  const auth = { Authorization: `Bearer ${await devToken(request, uid)}` };
  const invoice = await request.post('/api/invoices', { headers: auth, data: { productId: product } });
  expect(invoice.status(), `POST /api/invoices ${product}`).toBe(200);
  const body: unknown = await invoice.json();
  const url: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'invoiceUrl') : undefined;
  if (typeof url !== 'string' || !url.includes('$')) {
    throw new Error('POST /api/invoices answered without an invoice link');
  }
  // The dev gateway's link is `https://t.me/$<slug>`, its slug `dev-<orderId>` (server/dev/src/fake_gateway.rs).
  const slug = url.slice(url.indexOf('$') + 1);
  const paid = await request.post('/dev/simulate-payment', { data: { slug, outcome: 'paid' } });
  expect(paid.status(), 'POST /dev/simulate-payment').toBe(200);
  const result: unknown = await paid.json();
  expect(typeof result === 'object' && result !== null ? Reflect.get(result, 'precheckoutOk') : undefined, 'the pre-checkout').toBe(true);
}

/**
 * The composited colour `[r, g, b, a]` of one CSS pixel of the stage, at `(x, y)` from the canvas box's top left.
 * A screenshot reads what the page shows; the WebGL drawing buffer itself is not preserved, so `toDataURL` cannot.
 */
export async function stagePixel(page: Page, x: number, y: number): Promise<[number, number, number, number]> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) {
    throw new Error('stagePixel: no canvas on the page');
  }
  const png = await page.screenshot({ clip: { x: box.x + x, y: box.y + y, width: 1, height: 1 }, scale: 'css' });
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
}

/** The page's JS heap after a forced collection, in bytes (CDP `Performance.getMetrics` `JSHeapUsedSize`). */
export async function heapUsed(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('Performance.enable');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const used = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value;
    if (used === undefined) {
      throw new Error('Performance.getMetrics has no JSHeapUsedSize');
    }
    return used;
  } finally {
    await cdp.detach();
  }
}

/** The e2e build's file of a chunk, by its source key in `dist-e2e/.vite/manifest.json` (e.g. `src/app/engine.ts`). */
export function chunkFile(key: string): string {
  const manifest: unknown = JSON.parse(readFileSync(path.join(CLIENT_DIR, 'dist-e2e', '.vite', 'manifest.json'), 'utf8'));
  const entry: unknown = typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, key) : undefined;
  const file: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'file') : undefined;
  if (typeof file !== 'string') {
    throw new Error(`dist-e2e/.vite/manifest.json has no chunk for ${key}`);
  }
  return file;
}

/** The e2e build's own id (LBI D1: `dist-e2e/build-id.txt`, the `__BUILD_ID__` compiled into the bundle). */
export function ownBuild(): string {
  return readFileSync(path.join(CLIENT_DIR, 'dist-e2e', 'build-id.txt'), 'utf8').trim();
}

/** A resource type the blocks and counters below tell apart: a module's fetch is a `script`, a `<link>` a `stylesheet`. */
export type LoadType = 'script' | 'stylesheet';

/**
 * The requests of `page` for `pathname` of resource type `type`, from now on. Q60: the recovery's servability check
 * fetches the same URL as a `fetch`, which this leaves out (a URL-only count would see it as a load).
 */
export function scriptRequests(page: Page, pathname: string, type: LoadType = 'script'): () => number {
  let n = 0;
  page.on('request', (r) => {
    if (r.resourceType() === type && new URL(r.url()).pathname === pathname) {
      n += 1;
    }
  });
  return () => n;
}

/**
 * Fails `pathname`'s requests of resource type `type` with a network error (`route.abort('failed')`): the first only
 * (`once`), else every one until `unroute()`. Every other request falls back to the guard, the same URL's `fetch`
 * among them, so Q60's servability check can pass while the module fetch fails.
 */
export async function blockScript(
  page: Page,
  pathname: string,
  o: { once: boolean; type?: LoadType },
): Promise<{ blocked(): number; unroute(): Promise<void> }> {
  const type = o.type ?? 'script';
  let blocked = 0;
  const match = (url: URL): boolean => url.pathname === pathname;
  const handler = async (route: Route): Promise<void> => {
    if (route.request().resourceType() === type && (!o.once || blocked === 0)) {
      blocked += 1;
      await route.abort('failed');
    } else {
      await route.fallback();
    }
  };
  await page.route(match, handler);
  return { blocked: () => blocked, unroute: () => page.unroute(match, handler) };
}

/** Counts the page's `load` events from now on: a reload is one. */
export function loads(page: Page): { readonly count: () => number } {
  let n = 0;
  page.on('load', () => {
    n += 1;
  });
  return { count: () => n };
}

/** Fails a run in which any test ended skipped, with one line naming them. */
export default class SkipGuard implements Reporter {
  readonly #skipped: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'skipped') {
      this.#skipped.push(test.titlePath().filter(Boolean).join(' > '));
    }
  }

  // Async: Playwright reads a status override only from the returned promise.
  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    if (this.#skipped.length === 0) {
      return undefined;
    }
    console.log(`skip guard: ${this.#skipped.length} skipped test(s) fail the run: ${this.#skipped.join('; ')}`);
    return { status: result.status === 'interrupted' ? 'interrupted' : 'failed' };
  }

  printsToStdio(): boolean {
    return false;
  }
}
