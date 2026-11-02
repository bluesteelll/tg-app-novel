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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

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
