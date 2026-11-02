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

import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import type { PutSaveRequest } from '../src/api/generated/api.ts';
import { EMPTY_WORLD_STATE } from '../src/explore/state.ts';
import { t } from '../src/i18n/index.ts';
import type { InkScalar } from '../src/story/catalog.ts';
import { encodeSave, type SaveBodyV1 } from '../src/story/save-codec.ts';
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

/** The page's globals the specs read. */
export type E2eWindow = Window & { __tgMock: MockControls; __e2eForbidden: ForbiddenCall[]; __novelDebug?: NovelDebug };

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

export const test = base.extend({
  page: async ({ page }, use) => {
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
    await use(page);
    expect(aborted, 'requests that would have left the machine').toEqual([]);
    expect(dialogs, 'dialogs the page opened').toEqual([]);
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
 * per test: purchases and saves are server state, and server-dev's database lives for the whole run.
 */
export async function launch(page: Page, uid: number, o: { lang?: 'ru' | 'en' } = {}): Promise<void> {
  const query = new URLSearchParams({ uid: String(uid) });
  if (o.lang !== undefined) {
    query.set('lang', o.lang);
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

const hotspot = (page: Page, room: string, id: string): Locator =>
  page.getByRole('button', { name: hotspotLabel(room, id), exact: true });

/** The open puzzle's frame (PuzzleHost's labelled section). */
const puzzleFrame = (page: Page, id: string): Locator => page.getByRole('region', { name: puzzleTitle(id), exact: true });

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
async function tapHotspot(page: Page, room: string, id: string): Promise<void> {
  const h = hotspot(page, room, id);
  await expect(h).toBeVisible({ timeout: STEP_MS });
  await atRest(page);
  await h.tap();
}

/** An exit, then the next room's own exit button. */
async function walk(page: Page, room: string, exit: string, to: string, toExit: string): Promise<void> {
  await tapHotspot(page, room, exit);
  await expect(hotspot(page, to, toExit)).toBeVisible({ timeout: STEP_MS });
}

/** A `take`: its button goes with the prop. */
async function take(page: Page, room: string, id: string): Promise<void> {
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

/** The order puzzle: two taps swap two slots, so a selection sort reaches `order`; then Try; the frame closes. */
async function solveOrder(page: Page, puzzle: string, order: readonly number[]): Promise<void> {
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
  await frame.getByRole('button', { name: t('ru', 'puzzle.try') }).tap();
  await expect(frame).toBeHidden({ timeout: STEP_MS });
}

/**
 * Plays ch1 from its first line through the explore section to its END, and taps past the last line: the hall,
 * the study (the sun medal, the drawer's code: the moon medal), the cellar (its voice event, the star medal), the
 * gate's three slots and its order, then the way out. Choices take `picks` (reachLine's rule), option 0 by default:
 * the trust picks. What follows the END (the paywall, the next chapter, a notice) is the caller's to check.
 */
export async function playCh1ToEnd(page: Page, picks: Readonly<Record<string, number>> = {}): Promise<void> {
  const solutions = worldSolutions();
  await reachLine(page, 'ch1.manor_arrive.a008', picks);
  await page.locator('.dialogue .tap').tap(); // `# explore: manor`
  await expect(hotspot(page, 'hall', 'to_study')).toBeVisible({ timeout: STEP_MS });
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await take(page, 'study', 'medal');
  await tapHotspot(page, 'study', 'drawer');
  await solveCode(page, 'drawer', solutions.drawer);
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
  await solveOrder(page, 'gate', solutions.gate); // the last slot filled opens it
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
  const body: SaveBodyV1 = {
    format: 1,
    chapterId: chapterId as ChapterId,
    storyVersion: storyVersion as StoryVersion,
    ink: null,
    at: { lineId: null, knot: null, yield: null },
    staging: EMPTY_SNAPSHOT,
    checkpoint: null,
    chapterStart: { carry: carry as Record<VarName, InkScalar> },
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
