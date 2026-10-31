// The e2e fixtures and the skip guard. Every test's page:
// - gets index.html's https://telegram.org/js/telegram-web-app.js?64 from the pinned fixture (no network);
// - has every other request that leaves the loopback aborted, and the test fails at teardown if one was;
// - records window.open / alert / confirm / prompt calls instead of running them (an init script), and any dialog.
// A fresh browser context per test also means fresh sessionStorage (TWA's `__telegram__*` keys).
// The default export is a reporter, since Playwright loads a reporter only as a module's default export: it fails
// the run when any test ended skipped (PROTOTYPE-PLAN "Vacuous-green guards").
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, expect, type Page } from '@playwright/test';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import type { MockControls, MockEvent } from '../src/telegram/dev/mock-transport.ts';

/** A call the init script intercepted. */
export type ForbiddenCall = { name: string; args: string[] };

/** The page's globals the specs read. */
export type E2eWindow = Window & { __tgMock: MockControls; __e2eForbidden: ForbiddenCall[] };

const TWA_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'telegram-web-app.js');

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
