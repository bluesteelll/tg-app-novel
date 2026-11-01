// L7: the Telegram facade, the performance class, the inset variables, the dev mock and its plugin, and the fake
// Stars sheet, over fakes: the unit project runs in node, which has no WebView. The real telegram-web-app.js runs
// only in the e2e (e2e/boot.spec.ts), against the pinned fixture.
import { expect, test, vi } from 'vitest';

import { bootstrapScript, tgDevMock } from '../../vite-plugins/tg-dev-mock.ts';
import { runInvoiceSheet, type SheetButton, type SheetDetails, type SheetRender } from './dev/invoice-sheet.ts';
import {
  createMockTransport,
  installMockTransport,
  withLaunchVersion,
  type BootstrapWindow,
  type KeyValueStore,
  type MockDeps,
} from './dev/mock-transport.ts';
import type { Lifecycle } from './index.ts';
import { perfClassFromUa } from './perf.ts';
import { applyInsetVars } from './viewport.ts';
import { createTelegramClient, type TgEnv, type TwaHandler, type TwaWebApp, type VisibilitySource } from './webapp.ts';

// The browser program declares no Node globals. This file imports the Vite plugin, so a plugin that imported
// 'vite' (whose types reference @types/node) would bring them in; svelte-check then fails on an unused directive.
// @ts-expect-error `process` is not declared in the browser program.
void (null as unknown as typeof process);

type Call = readonly [method: string, ...args: unknown[]];

/** TWA's `versionCompare`: numeric per dot-separated part, a missing part is 0 (so 7.10 is above 7.7). */
function versionAtLeast(have: string, want: string): boolean {
  const a = have.split('.');
  const b = want.split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number.parseInt(a[i] ?? '', 10) || 0;
    const y = Number.parseInt(b[i] ?? '', 10) || 0;
    if (x !== y) {
      return x > y;
    }
  }
  return true;
}

/**
 * `window.Telegram.WebApp` as the facade uses it. Events live in one registry keyed by TWA's own event names
 * (`backButtonClicked` included, as `BackButton.onClick` registers it), and `onEvent` keeps an identical callback
 * once, as TWA's `indexOf` check does. `emit` dispatches the way TWA's `callEventCallbacks` does. A name in `throws`
 * makes that method throw `Error(<code>)`, as TWA does.
 */
class FakeTwa implements TwaWebApp {
  readonly version: string;
  readonly initData: string;
  readonly platform = 'android';
  readonly calls: Call[] = [];
  readonly throws = new Map<string, string>();
  storageError: string | null = null;
  readonly #handlers = new Map<string, TwaHandler[]>();
  readonly #cloud = new Map<string, string>();
  readonly #device = new Map<string, string>();
  #invoice: ((status: string) => void) | null = null;

  constructor(version: string, initData = 'auth_date=1&hash=00') {
    this.version = version;
    this.initData = initData;
  }

  #call(name: string, ...args: unknown[]): void {
    this.calls.push([name, ...args]);
    const code = this.throws.get(name);
    if (code !== undefined) {
      throw new Error(code);
    }
  }

  names(): string[] {
    return this.calls.map(([name]) => name);
  }

  live(type: string): number {
    return this.#handlers.get(type)?.length ?? 0;
  }

  /** Over the live array by index, each callback in its own try/catch: an `offEvent` inside a callback shifts it. */
  emit(type: string, data?: unknown): void {
    const list = this.#handlers.get(type) ?? [];
    for (let i = 0; i < list.length; i++) {
      try {
        list[i]?.(data);
      } catch {
        // TWA swallows a callback's throw and goes on with the next index.
      }
    }
  }

  closeInvoice(status: string): void {
    const callback = this.#invoice;
    this.#invoice = null;
    callback?.(status);
  }

  isVersionAtLeast(v: string): boolean {
    return versionAtLeast(this.version, v);
  }
  ready(): void {
    this.#call('ready');
  }
  expand(): void {
    this.#call('expand');
  }
  disableVerticalSwipes(): void {
    this.#call('disableVerticalSwipes');
  }
  enableClosingConfirmation(): void {
    this.#call('enableClosingConfirmation');
  }
  disableClosingConfirmation(): void {
    this.#call('disableClosingConfirmation');
  }
  setHeaderColor(color: string): void {
    this.#call('setHeaderColor', color);
  }
  setBackgroundColor(color: string): void {
    this.#call('setBackgroundColor', color);
  }
  onEvent(type: string, fn: TwaHandler): void {
    const list = this.#handlers.get(type) ?? [];
    if (!list.includes(fn)) {
      list.push(fn);
    }
    this.#handlers.set(type, list);
  }
  offEvent(type: string, fn: TwaHandler): void {
    const list = this.#handlers.get(type) ?? [];
    const index = list.indexOf(fn);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }
  readonly BackButton = {
    show: (): void => this.#call('BackButton.show'),
    hide: (): void => this.#call('BackButton.hide'),
    onClick: (fn: () => void): void => this.onEvent('backButtonClicked', fn),
    offClick: (fn: () => void): void => this.offEvent('backButtonClicked', fn),
  };
  openInvoice(url: string, callback: (status: string) => void): void {
    this.#call('openInvoice', url);
    this.#invoice = callback;
  }
  readonly CloudStorage = {
    getItem: (key: string, callback: (error: string | null, value?: string) => void): void => {
      this.#call('CloudStorage.getItem', key);
      if (this.storageError !== null) {
        callback(this.storageError);
      } else {
        callback(null, this.#cloud.get(key) ?? '');
      }
    },
    setItem: (key: string, value: string, callback: (error: string | null, stored?: boolean) => void): void => {
      this.#call('CloudStorage.setItem', key, value);
      this.#cloud.set(key, value);
      callback(this.storageError, this.storageError === null);
    },
  };
  readonly DeviceStorage = {
    getItem: (key: string, callback: (error: string | null, value?: string | null) => void): void => {
      this.#call('DeviceStorage.getItem', key);
      if (this.storageError !== null) {
        callback(this.storageError);
      } else {
        callback(null, this.#device.get(key) ?? null);
      }
    },
    setItem: (key: string, value: string, callback: (error: string | null, stored?: boolean) => void): void => {
      this.#call('DeviceStorage.setItem', key, value);
      this.#device.set(key, value);
      callback(null, true);
    },
    removeItem: (key: string, callback: (error: string | null, removed?: boolean) => void): void => {
      this.#call('DeviceStorage.removeItem', key);
      this.#device.delete(key);
      callback(null, true);
    },
  };
  readonly HapticFeedback = {
    impactOccurred: (style: 'light' | 'medium'): void => this.#call('HapticFeedback.impactOccurred', style),
    selectionChanged: (): void => this.#call('HapticFeedback.selectionChanged'),
    notificationOccurred: (type: 'error' | 'success' | 'warning'): void =>
      this.#call('HapticFeedback.notificationOccurred', type),
  };
  shareMessage(id: string): void {
    this.#call('shareMessage', id);
  }
  openTelegramLink(url: string): void {
    this.#call('openTelegramLink', url);
  }
  openLink(url: string): void {
    this.#call('openLink', url);
  }
}

/** Timers the test advances by hand. */
class FakeClock {
  #now = 0;
  #next = 1;
  readonly #timers = new Map<number, { at: number; fn: () => void }>();

  get pending(): number {
    return this.#timers.size;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.#next++;
    this.#timers.set(id, { at: this.#now + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }
  advance(ms: number): void {
    this.#now += ms;
    for (const [id, timer] of [...this.#timers]) {
      if (timer.at <= this.#now) {
        this.#timers.delete(id);
        timer.fn();
      }
    }
  }
}

class FakeDoc implements VisibilitySource {
  visibilityState: DocumentVisibilityState = 'visible';
  readonly listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.delete(listener);
  }
  set(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

function fakeEnv(userAgent = ''): { env: TgEnv; clock: FakeClock; doc: FakeDoc } {
  const clock = new FakeClock();
  const doc = new FakeDoc();
  return {
    env: {
      userAgent,
      doc,
      setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
      clearTimeout: (id) => clock.clearTimeout(id),
    },
    clock,
    doc,
  };
}

const PENDING = Symbol('pending');

/** The promise's value if it settles within the current macrotask, `PENDING` otherwise. */
function peek<T>(p: Promise<T>): Promise<T | typeof PENDING> {
  return Promise.race([p, new Promise<typeof PENDING>((resolve) => setTimeout(() => resolve(PENDING), 0))]);
}

const INVOICE = 'https://t.me/$dev-s1';

// ---------------------------------------------------------------------------------------------------------------
// The facade (C1)

test('invoice: openInvoice throw maps to a TgError value', async () => {
  const twa = new FakeTwa('9.6');
  const tg = createTelegramClient(twa, fakeEnv().env);
  twa.throws.set('openInvoice', 'WebAppInvoiceUrlInvalid');
  expect(await tg.openInvoice('https://example.com/x')).toEqual({
    ok: false,
    error: { kind: 'invalid', method: 'openInvoice', detail: 'WebAppInvoiceUrlInvalid' },
  });
  twa.throws.set('openInvoice', 'WebAppInvoiceOpened');
  expect(await tg.openInvoice(INVOICE)).toEqual({
    ok: false,
    error: { kind: 'invalid', method: 'openInvoice', detail: 'WebAppInvoiceOpened' },
  });
  twa.throws.set('openInvoice', 'WebAppMethodUnsupported');
  expect(await tg.openInvoice(INVOICE)).toEqual({ ok: false, error: { kind: 'unsupported', method: 'openInvoice' } });
});

test('invoice: closed status resolves the promise', async () => {
  const twa = new FakeTwa('9.6');
  const tg = createTelegramClient(twa, fakeEnv().env);
  const cases = [
    ['paid', 'paid'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['pending', 'pending'],
    // A status outside the four is 'failed': the purchase flow polls the server either way.
    ['refunded', 'failed'],
    ['', 'failed'],
  ] as const;
  for (const [given, expected] of cases) {
    const result = tg.openInvoice(INVOICE);
    expect(await peek(result)).toBe(PENDING);
    expect(twa.calls.at(-1)).toEqual(['openInvoice', INVOICE]);
    twa.closeInvoice(given);
    expect(await result).toEqual({ ok: true, value: expected });
  }
});

test('facade_unsubscribe_removes_handler', () => {
  const twa = new FakeTwa('9.6');
  const tg = createTelegramClient(twa, fakeEnv().env);
  const seen: Lifecycle[] = [];
  const fn = (e: Lifecycle): void => {
    seen.push(e);
  };
  // The same function twice is two subscriptions, though TWA's onEvent would keep one identical callback. TWA holds
  // one facade dispatcher per event name, registered while that name has a subscriber.
  const first = tg.onLifecycle(fn);
  const second = tg.onLifecycle(fn);
  expect([twa.live('activated'), twa.live('deactivated')]).toEqual([1, 1]);
  twa.emit('deactivated');
  expect(seen).toEqual(['deactivated', 'deactivated']);
  first();
  expect([twa.live('activated'), twa.live('deactivated')]).toEqual([1, 1]);
  twa.emit('activated');
  expect(seen).toEqual(['deactivated', 'deactivated', 'activated']);
  second();
  second();
  expect([twa.live('activated'), twa.live('deactivated')]).toEqual([0, 0]);
  twa.emit('deactivated');
  expect(seen).toHaveLength(3);

  let presses = 0;
  const press = (): void => {
    presses++;
  };
  const offA = tg.backButton.onPress(press);
  const offB = tg.backButton.onPress(press);
  expect(twa.live('backButtonClicked')).toBe(1);
  twa.emit('backButtonClicked');
  expect(presses).toBe(2);
  offA();
  expect(twa.live('backButtonClicked')).toBe(1);
  offB();
  expect(twa.live('backButtonClicked')).toBe(0);
  twa.emit('backButtonClicked');
  expect(presses).toBe(2);
});

test('facade: unsubscribe inside a lifecycle handler keeps the other subscribers', () => {
  const twa = new FakeTwa('9.6');
  const tg = createTelegramClient(twa, fakeEnv().env);
  const seen: string[] = [];
  const offA = tg.onLifecycle((e) => {
    seen.push(`A:${e}`);
    offA();
  });
  tg.onLifecycle((e) => {
    seen.push(`B:${e}`);
  });
  twa.emit('activated');
  expect(seen).toEqual(['A:activated', 'B:activated']);
  twa.emit('activated');
  expect(seen).toEqual(['A:activated', 'B:activated', 'B:activated']);
});

test('facade: unsubscribe inside a back press keeps the other press handlers', () => {
  const twa = new FakeTwa('9.6');
  const tg = createTelegramClient(twa, fakeEnv().env);
  const presses: string[] = [];
  const offX = tg.backButton.onPress(() => {
    presses.push('X');
    offX();
  });
  tg.backButton.onPress(() => {
    presses.push('Y');
  });
  twa.emit('backButtonClicked');
  expect(presses).toEqual(['X', 'Y']);
  twa.emit('backButtonClicked');
  expect(presses).toEqual(['X', 'Y', 'Y']);
});

test('facade: subscriber added inside a dispatch waits for the next event', () => {
  const twa = new FakeTwa('9.6');
  const tg = createTelegramClient(twa, fakeEnv().env);
  const presses: string[] = [];
  let added = false;
  tg.backButton.onPress(() => {
    presses.push('A');
    if (!added) {
      added = true;
      tg.backButton.onPress(() => {
        presses.push('C');
      });
    }
  });
  tg.backButton.onPress(() => {
    presses.push('B');
  });
  twa.emit('backButtonClicked');
  expect(presses).toEqual(['A', 'B']);
  twa.emit('backButtonClicked');
  expect(presses).toEqual(['A', 'B', 'A', 'B', 'C']);
});

test('facade: a throwing subscriber does not stop the others', () => {
  const twa = new FakeTwa('9.6');
  const tg = createTelegramClient(twa, fakeEnv().env);
  const presses: string[] = [];
  tg.backButton.onPress(() => {
    throw new Error('press handler bug');
  });
  tg.backButton.onPress(() => {
    presses.push('B');
  });
  twa.emit('backButtonClicked');
  expect(presses).toEqual(['B']);

  const seen: Lifecycle[] = [];
  tg.onLifecycle(() => {
    throw new Error('lifecycle handler bug');
  });
  tg.onLifecycle((e) => {
    seen.push(e);
  });
  twa.emit('deactivated');
  expect(seen).toEqual(['deactivated']);
});

test('lifecycle: visibilitychange fallback below 8.0', () => {
  const { env, doc } = fakeEnv();
  const twa = new FakeTwa('7.10');
  const tg = createTelegramClient(twa, env);
  const seen: Lifecycle[] = [];
  const off = tg.onLifecycle((e) => {
    seen.push(e);
  });
  expect([twa.live('activated'), twa.live('deactivated'), doc.listeners.size]).toEqual([0, 0, 1]);
  doc.set('hidden');
  doc.set('visible');
  expect(seen).toEqual(['deactivated', 'activated']);
  off();
  expect(doc.listeners.size).toBe(0);
  doc.set('hidden');
  expect(seen).toHaveLength(2);

  // From 8.0 the events are TWA's, and the document is not listened to.
  const twa8 = new FakeTwa('8.0');
  const off8 = createTelegramClient(twa8, env).onLifecycle(() => {});
  expect([twa8.live('activated'), twa8.live('deactivated'), doc.listeners.size]).toEqual([1, 1, 0]);
  off8();
});

test('gates: methods below their version are not called', async () => {
  const v60 = new FakeTwa('6.0');
  const t60 = createTelegramClient(v60, fakeEnv().env);
  t60.ready();
  t60.expand();
  t60.disableVerticalSwipes();
  t60.setClosingConfirmation(true);
  t60.setChromeColors('#000000', '#000000');
  t60.backButton.setVisible(true);
  t60.backButton.onPress(() => {});
  t60.haptic.impact('light');
  t60.haptic.selection();
  t60.haptic.notify('success');
  expect(await t60.openInvoice(INVOICE)).toEqual({ ok: false, error: { kind: 'unsupported', method: 'openInvoice' } });
  expect(await t60.cloud.get('k')).toEqual({ ok: false, error: { kind: 'unsupported', method: 'cloud.get' } });
  expect(await t60.cloud.set('k', 'v')).toEqual({ ok: false, error: { kind: 'unsupported', method: 'cloud.set' } });
  expect(v60.names()).toEqual(['ready', 'expand']);
  expect(v60.live('backButtonClicked')).toBe(0);

  // 6.1: colours, BackButton, haptics; still no swipes (7.7) and no closing confirmation (6.2). Below 6.9 TWA
  // throws on a header hex that is not the theme's: the background colour is still set.
  const v61 = new FakeTwa('6.1');
  v61.throws.set('setHeaderColor', 'WebAppHeaderColorKeyInvalid');
  const t61 = createTelegramClient(v61, fakeEnv().env);
  t61.disableVerticalSwipes();
  t61.setClosingConfirmation(true);
  t61.setChromeColors('#000000', '#111111');
  t61.backButton.setVisible(true);
  t61.backButton.setVisible(false);
  t61.haptic.impact('medium');
  expect(v61.calls).toEqual([
    ['setHeaderColor', '#000000'],
    ['setBackgroundColor', '#111111'],
    ['BackButton.show'],
    ['BackButton.hide'],
    ['HapticFeedback.impactOccurred', 'medium'],
  ]);

  const v77 = new FakeTwa('7.7');
  const t77 = createTelegramClient(v77, fakeEnv().env);
  t77.disableVerticalSwipes();
  t77.setClosingConfirmation(true);
  t77.setClosingConfirmation(false);
  expect(v77.names()).toEqual(['disableVerticalSwipes', 'enableClosingConfirmation', 'disableClosingConfirmation']);
});

test('cloud: value over 4096 chars refused before the call', async () => {
  const twa = new FakeTwa('6.9');
  const tg = createTelegramClient(twa, fakeEnv().env);
  expect(await tg.cloud.set('k', 'x'.repeat(4097))).toEqual({
    ok: false,
    error: { kind: 'invalid', method: 'cloud.set', detail: 'value over 4096 characters' },
  });
  expect(twa.calls).toEqual([]);
  expect(await tg.cloud.set('k', 'x'.repeat(4096))).toEqual({ ok: true, value: undefined });
  expect(await tg.cloud.get('k')).toEqual({ ok: true, value: 'x'.repeat(4096) });
  // TWA answers '' for a key that was never set: the facade says null.
  expect(await tg.cloud.get('absent')).toEqual({ ok: true, value: null });
  twa.storageError = 'STORAGE_KEY_INVALID';
  expect(await tg.cloud.get('k')).toEqual({ ok: false, error: { kind: 'storage', detail: 'STORAGE_KEY_INVALID' } });
  expect(twa.names()).toEqual(['CloudStorage.setItem', 'CloudStorage.getItem', 'CloudStorage.getItem', 'CloudStorage.getItem']);
});

test('device: absent below 9.0', async () => {
  expect(createTelegramClient(new FakeTwa('8.9'), fakeEnv().env).device).toBeNull();
  const twa = new FakeTwa('9.0');
  const device = createTelegramClient(twa, fakeEnv().env).device;
  expect(device).not.toBeNull();
  if (device === null) {
    return;
  }
  expect(await device.get('k')).toEqual({ ok: true, value: null });
  expect(await device.set('k', 'v')).toEqual({ ok: true, value: undefined });
  expect(await device.get('k')).toEqual({ ok: true, value: 'v' });
  expect(await device.set('k', null)).toEqual({ ok: true, value: undefined });
  expect(await device.get('k')).toEqual({ ok: true, value: null });
  twa.storageError = 'UNKNOWN_ERROR';
  expect(await device.get('k')).toEqual({ ok: false, error: { kind: 'storage', detail: 'UNKNOWN_ERROR' } });
  expect(twa.names()).toEqual([
    'DeviceStorage.getItem',
    'DeviceStorage.setItem',
    'DeviceStorage.getItem',
    'DeviceStorage.removeItem',
    'DeviceStorage.getItem',
    'DeviceStorage.getItem',
  ]);
});

test('facade: no WebApp is an inert client', async () => {
  const { env, doc } = fakeEnv();
  const tg = createTelegramClient(null, env);
  expect([tg.inTelegram, tg.initData, tg.isVersionAtLeast('6.0'), tg.device, tg.startParam()]).toEqual([
    false,
    '',
    false,
    null,
    null,
  ]);
  expect(tg.supportsShareMessage()).toBe(false);
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes();
  tg.setClosingConfirmation(true);
  tg.setChromeColors('#000000', '#000000');
  tg.backButton.setVisible(true);
  tg.backButton.onPress(() => {})();
  tg.haptic.impact('light');
  tg.haptic.selection();
  tg.haptic.notify('error');
  expect(await tg.openInvoice(INVOICE)).toEqual({ ok: false, error: { kind: 'unsupported', method: 'openInvoice' } });
  expect(await tg.cloud.get('k')).toEqual({ ok: false, error: { kind: 'unsupported', method: 'cloud.get' } });
  expect(await tg.cloud.set('k', 'v')).toEqual({ ok: false, error: { kind: 'unsupported', method: 'cloud.set' } });
  expect(await tg.shareMessage('m1')).toEqual({ ok: false, error: { kind: 'unsupported' } });
  expect(tg.openLink('https://example.com/')).toEqual({ ok: false, error: { kind: 'unsupported', method: 'openLink' } });
  expect(tg.openTelegramLink('https://t.me/x')).toEqual({
    ok: false,
    error: { kind: 'unsupported', method: 'openTelegramLink' },
  });
  // The page lifecycle still arrives, through the document.
  const seen: Lifecycle[] = [];
  const off = tg.onLifecycle((e) => {
    seen.push(e);
  });
  doc.set('hidden');
  off();
  expect([seen, doc.listeners.size]).toEqual([['deactivated'], 0]);
  // A loaded script without launch params is not "in Telegram" either.
  expect(createTelegramClient(new FakeTwa('9.6', ''), env).inTelegram).toBe(false);
});

test('share: failed event maps to a typed error', async () => {
  const cases = [
    ['MESSAGE_EXPIRED', 'expired'],
    ['UNSUPPORTED', 'unsupported'],
    ['USER_DECLINED', 'declined'],
    ['MESSAGE_SEND_FAILED', 'send-failed'],
    ['UNKNOWN_ERROR', 'unknown'],
    ['A_FUTURE_CODE', 'unknown'],
    ['toString', 'unknown'],
  ] as const;
  for (const [code, kind] of cases) {
    const twa = new FakeTwa('8.0');
    const result = createTelegramClient(twa, fakeEnv().env).shareMessage('m1');
    expect(twa.calls).toEqual([['shareMessage', 'm1']]);
    twa.emit('shareMessageFailed', { error: code });
    expect(await result).toEqual({ ok: false, error: { kind } });
  }
});

test('share: below 8.0 is unsupported', async () => {
  const twa = new FakeTwa('7.10');
  const tg = createTelegramClient(twa, fakeEnv().env);
  expect(tg.supportsShareMessage()).toBe(false);
  const result = tg.shareMessage('m1');
  expect(twa.calls).toHaveLength(0);
  expect(await result).toEqual({ ok: false, error: { kind: 'unsupported' } });
  expect(createTelegramClient(new FakeTwa('8.0'), fakeEnv().env).supportsShareMessage()).toBe(true);
});

test('share: listeners removed after the event', async () => {
  const twa = new FakeTwa('8.0');
  const { env, clock } = fakeEnv();
  const tg = createTelegramClient(twa, env);
  const live = (): number => twa.live('shareMessageSent') + twa.live('shareMessageFailed');
  const sent = tg.shareMessage('m1');
  twa.emit('shareMessageSent');
  expect(await sent).toEqual({ ok: true, value: undefined });
  expect(live()).toBe(0);
  expect(clock.pending).toBe(0);

  // A second share while one is open: TWA throws, and only that call's listeners and timer go at once.
  const first = tg.shareMessage('m2');
  expect([live(), clock.pending]).toEqual([2, 1]);
  twa.throws.set('shareMessage', 'WebAppShareMessageOpened');
  expect(await tg.shareMessage('m3')).toEqual({ ok: false, error: { kind: 'unknown' } });
  expect([live(), clock.pending]).toEqual([2, 1]);
  twa.emit('shareMessageFailed', { error: 'USER_DECLINED' });
  expect(await first).toEqual({ ok: false, error: { kind: 'declined' } });
  expect([live(), clock.pending]).toEqual([0, 0]);

  twa.throws.set('shareMessage', 'WebAppMethodUnsupported');
  expect(await tg.shareMessage('m4')).toEqual({ ok: false, error: { kind: 'unsupported' } });
  expect([live(), clock.pending]).toEqual([0, 0]);
});

test('share: 60 s guard ends a silent wait', async () => {
  const twa = new FakeTwa('8.0');
  const { env, clock } = fakeEnv();
  const result = createTelegramClient(twa, env).shareMessage('m1');
  clock.advance(59_999);
  expect(await peek(result)).toBe(PENDING);
  clock.advance(1);
  expect(await result).toEqual({ ok: false, error: { kind: 'unknown' } });
  expect([twa.live('shareMessageSent'), twa.live('shareMessageFailed'), clock.pending]).toEqual([0, 0, 0]);
});

test('links: open link refuses non-https', () => {
  const twa = new FakeTwa('6.1');
  const tg = createTelegramClient(twa, fakeEnv().env);
  const notHttps = { ok: false, error: { kind: 'invalid', method: 'openLink', detail: 'not an https: URL' } };
  expect(tg.openLink('http://example.com/')).toEqual(notHttps);
  expect(tg.openLink('tg://resolve?domain=x')).toEqual(notHttps);
  expect(tg.openLink('not a url')).toEqual(notHttps);
  const notTme = { ok: false, error: { kind: 'invalid', method: 'openTelegramLink', detail: 'not an https://t.me/ link' } };
  expect(tg.openTelegramLink('https://example.com/x')).toEqual(notTme);
  expect(tg.openTelegramLink('http://t.me/x')).toEqual(notTme);
  expect(tg.openTelegramLink('https://t.me.example.com/x')).toEqual(notTme);
  expect(tg.openTelegramLink('https://t.me@example.com/x')).toEqual(notTme);
  expect(twa.calls).toEqual([]);

  expect(tg.openLink('https://example.com/a')).toEqual({ ok: true, value: undefined });
  expect(tg.openTelegramLink('https://t.me/share/url?url=x')).toEqual({ ok: true, value: undefined });
  expect(twa.calls).toEqual([
    ['openLink', 'https://example.com/a'],
    ['openTelegramLink', 'https://t.me/share/url?url=x'],
  ]);
  twa.throws.set('openLink', 'WebAppTgUrlInvalid');
  expect(tg.openLink('https://example.com/b')).toEqual({
    ok: false,
    error: { kind: 'invalid', method: 'openLink', detail: 'WebAppTgUrlInvalid' },
  });

  // Below 6.1 TWA's openLink calls window.open and openTelegramLink sets location.href: refused before the call.
  const v60 = new FakeTwa('6.0');
  const t60 = createTelegramClient(v60, fakeEnv().env);
  expect(t60.openLink('https://example.com/')).toEqual({ ok: false, error: { kind: 'unsupported', method: 'openLink' } });
  expect(t60.openTelegramLink('https://t.me/x')).toEqual({
    ok: false,
    error: { kind: 'unsupported', method: 'openTelegramLink' },
  });
  expect(v60.calls).toEqual([]);
});

test('start param: read from the raw initData, envelope only', () => {
  const at = (initData: string): string | null =>
    createTelegramClient(new FakeTwa('9.6', initData), fakeEnv().env).startParam();
  expect(at('auth_date=1&start_param=inv_AB-12&hash=00')).toBe('inv_AB-12');
  expect(at(`start_param=${'a'.repeat(64)}`)).toBe('a'.repeat(64));
  expect(at('auth_date=1&hash=00')).toBeNull();
  expect(at('start_param=&hash=00')).toBeNull();
  expect(at(`start_param=${'a'.repeat(65)}`)).toBeNull();
  expect(at('start_param=a%20b')).toBeNull();
  expect(at('start_param=a%2Fb')).toBeNull();
  expect(at('')).toBeNull();
});

// ---------------------------------------------------------------------------------------------------------------
// Performance class (C2)

test('perf: performance class from UA vectors', () => {
  const vectors = [
    // R1 §6's example.
    ['Mozilla/5.0 (Linux; Android 14) Telegram-Android/11.3.3 (Google sdk_gphone64_arm64; Android 14; SDK 34; LOW)', 'LOW'],
    // A model name with spaces: the class is the last `;` token, never a space-split word.
    ['Mozilla/5.0 Telegram-Android/12.1.1 (Samsung SM-S918B Galaxy S23 Ultra; Android 15; SDK 35; HIGH)', 'HIGH'],
    ['Mozilla/5.0 Telegram-Android/12.1.1 (Xiaomi 2201117TG; Android 13; SDK 33; AVERAGE)', 'AVERAGE'],
    ['Mozilla/5.0 Telegram-Android/12.1.1 (Xiaomi 2201117TG; Android 13; SDK 33)', 'AVERAGE'],
    ['Mozilla/5.0 Telegram-Android/12.1.1 (Xiaomi 2201117TG; Android 13; SDK 33; low)', 'AVERAGE'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', 'AVERAGE'],
    ['', 'AVERAGE'],
  ] as const;
  expect(vectors.map(([ua]) => perfClassFromUa(ua))).toEqual(vectors.map(([, cls]) => cls));
  expect(createTelegramClient(new FakeTwa('9.6'), fakeEnv(vectors[0][0]).env).perfClass).toBe('LOW');
  expect(createTelegramClient(null, fakeEnv(vectors[1][0]).env).perfClass).toBe('HIGH');
});

// ---------------------------------------------------------------------------------------------------------------
// Inset variables (C3)

test('viewport: inset vars sum safe and content areas', () => {
  const written: Array<[string, string]> = [];
  applyInsetVars({ setProperty: (name, value) => written.push([name, value]) });
  const sum = (side: string): string =>
    `calc(var(--tg-safe-area-inset-${side}, 0px) + var(--tg-content-safe-area-inset-${side}, 0px))`;
  expect(written).toEqual([
    ['--app-inset-top', sum('top')],
    ['--app-inset-bottom', sum('bottom')],
    ['--app-inset-left', sum('left')],
    ['--app-inset-right', sum('right')],
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// Dev mock transport, bootstrap and plugin (C4)

const THEME = { bg_color: '#17212b', text_color: '#f5f5f5' };
const ZERO = { top: 0, bottom: 0, left: 0, right: 0 };

function memoryStore(): KeyValueStore & { items: Record<string, string> } {
  const store = {
    items: {} as Record<string, string>,
    load: (): Record<string, string> => ({ ...store.items }),
    save: (items: Record<string, string>): void => {
      store.items = { ...items };
    },
  };
  return store;
}

/** A transport over recording fakes; `defer` is synchronous unless a test passes its own. */
function harness(over: Partial<MockDeps> = {}) {
  const received: Array<[string, unknown]> = [];
  const versions: string[] = [];
  const cloud = memoryStore();
  const device = memoryStore();
  const transport = createMockTransport({
    receive: (type, data) => {
      received.push([type, data]);
    },
    defer: (fn) => fn(),
    cloud,
    device,
    innerHeight: () => 812,
    themeParams: () => THEME,
    setVersion: (v) => {
      versions.push(v);
    },
    sheet: { fetch: fakeFetch().fetch, render: () => fakeRender().render },
    ...over,
  });
  // TWA posts JSON.stringify(eventData), with '' for an event without data.
  const post = (type: string, data: unknown = ''): void => transport.postEvent(type, JSON.stringify(data));
  return { transport, controls: transport.controls, post, received, versions, cloud, device };
}

type BootWindow = BootstrapWindow & { __TG_DEV_MOCK__?: boolean; replaced: string[] };

function bootWindow(hash: string, stored: string | null): BootWindow {
  const replaced: string[] = [];
  return {
    replaced,
    location: {
      hash,
      replace: (url) => {
        replaced.push(url);
      },
    },
    sessionStorage: {
      getItem: (key) => {
        if (stored === 'throws') {
          throw new Error('SecurityError');
        }
        return key === '__telegram__initParams' ? stored : null;
      },
    },
  };
}

/** The plugin's text, run as the browser runs an inline classic script: with only `window` in scope. */
function runInjected(text: string, win: object): void {
  new Function('window', text)(win);
}

test('mock: prepared message sent event', () => {
  const m = harness();
  m.post('web_app_send_prepared_message', { id: 'm1' });
  expect(m.received).toEqual([['prepared_message_sent', {}]]);
});

test('mock: share outcome failure answers prepared_message_failed', () => {
  const m = harness();
  m.controls.setShareOutcome('USER_DECLINED');
  m.post('web_app_send_prepared_message', { id: 'm1' });
  m.controls.setShareOutcome('MESSAGE_EXPIRED');
  m.post('web_app_send_prepared_message', { id: 'm2' });
  m.controls.setShareOutcome('sent');
  m.post('web_app_send_prepared_message', { id: 'm3' });
  expect(m.received).toEqual([
    ['prepared_message_failed', { error: 'USER_DECLINED' }],
    ['prepared_message_failed', { error: 'MESSAGE_EXPIRED' }],
    ['prepared_message_sent', {}],
  ]);
});

test('mock: answers the TWA load requests', () => {
  const deferred: Array<() => void> = [];
  const m = harness({ defer: (fn) => void deferred.push(fn) });
  for (const type of [
    'web_app_request_theme',
    'web_app_request_viewport',
    'web_app_request_safe_area',
    'web_app_request_content_safe_area',
  ]) {
    m.post(type);
  }
  // A native client answers asynchronously, never inside postEvent.
  expect(m.received).toEqual([]);
  for (const fn of deferred.splice(0)) {
    fn();
  }
  const viewport = ['viewport_changed', { height: 812, is_expanded: true, is_state_stable: true }];
  expect(m.received).toEqual([
    ['theme_changed', { theme_params: THEME }],
    viewport,
    ['safe_area_changed', ZERO],
    ['content_safe_area_changed', ZERO],
  ]);
  m.post('web_app_expand');
  for (const fn of deferred.splice(0)) {
    fn();
  }
  expect(m.received.at(-1)).toEqual(viewport);
  // Without parseable launch theme params, theme_changed still carries an object for TWA's check.
  const bare = harness({ themeParams: () => null });
  bare.post('web_app_request_theme');
  expect(bare.received).toEqual([['theme_changed', { theme_params: {} }]]);
});

test('mock: records every postEvent in order', () => {
  const m = harness();
  m.transport.postEvent('web_app_ready', '""');
  m.post('web_app_setup_swipe_behavior', { allow_vertical_swipe: false });
  m.transport.postEvent('web_app_odd', 'not json');
  m.post('web_app_expand');
  expect(m.controls.events).toEqual([
    { type: 'web_app_ready', data: '' },
    { type: 'web_app_setup_swipe_behavior', data: { allow_vertical_swipe: false } },
    { type: 'web_app_odd', data: 'not json' },
    { type: 'web_app_expand', data: '' },
  ]);
  // One answer per request, and none for a plain setting.
  expect(m.received).toEqual([['viewport_changed', { height: 812, is_expanded: true, is_state_stable: true }]]);

  // The page install: drains what TWA queued at load through one transport, in order, and is idempotent.
  const received: Array<[string, unknown]> = [];
  const queue: Array<readonly [string, string]> = [
    ['web_app_request_viewport', '""'],
    ['web_app_ready', '""'],
  ];
  const win = {
    __tgMockQueue: queue,
    TelegramWebviewProxy: { postEvent: (type: string, json: string): void => void queue.push([type, json]) },
    Telegram: {
      WebView: {
        receiveEvent: (type: string, data: unknown): void => void received.push([type, data]),
        initParams: { tgWebAppThemeParams: JSON.stringify(THEME) },
      },
    },
    setTimeout: (fn: () => void): number => {
      fn();
      return 0;
    },
    innerHeight: 700,
  };
  vi.stubGlobal('window', win);
  try {
    const controls = installMockTransport();
    expect(installMockTransport()).toBe(controls);
    expect(controls.events.map((e) => e.type)).toEqual(['web_app_request_viewport', 'web_app_ready']);
    expect(queue).toEqual([]);
    win.TelegramWebviewProxy.postEvent('web_app_request_theme', '""');
    expect(queue).toEqual([]);
    expect(received).toEqual([
      ['viewport_changed', { height: 700, is_expanded: true, is_state_stable: true }],
      ['theme_changed', { theme_params: THEME }],
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('mock: cloud and device storage round trip', () => {
  const m = harness();
  const cloud = (reqId: string, method: string, params: object): void =>
    m.post('web_app_invoke_custom_method', { req_id: reqId, method, params });
  cloud('c1', 'saveStorageValue', { key: 'k', value: 'v' });
  cloud('c2', 'getStorageValues', { keys: ['k', 'absent'] });
  cloud('c3', 'getStorageKeys', {});
  cloud('c4', 'deleteStorageValues', { keys: ['k'] });
  cloud('c5', 'getStorageValues', { keys: ['k'] });
  cloud('c6', 'nope', {});
  expect(m.received.splice(0)).toEqual([
    ['custom_method_invoked', { req_id: 'c1', result: true }],
    ['custom_method_invoked', { req_id: 'c2', result: { k: 'v', absent: '' } }],
    ['custom_method_invoked', { req_id: 'c3', result: ['k'] }],
    ['custom_method_invoked', { req_id: 'c4', result: true }],
    ['custom_method_invoked', { req_id: 'c5', result: { k: '' } }],
    ['custom_method_invoked', { req_id: 'c6', error: 'UNKNOWN_METHOD' }],
  ]);
  expect(m.cloud.items).toEqual({});

  m.post('web_app_device_storage_save_key', { req_id: 'd1', key: 'k', value: 'v' });
  expect(m.device.items).toEqual({ k: 'v' });
  m.post('web_app_device_storage_get_key', { req_id: 'd2', key: 'k' });
  m.post('web_app_device_storage_save_key', { req_id: 'd3', key: 'k', value: null });
  m.post('web_app_device_storage_get_key', { req_id: 'd4', key: 'k' });
  m.post('web_app_device_storage_save_key', { req_id: 'd5', key: 'a', value: '1' });
  m.post('web_app_device_storage_clear', { req_id: 'd6' });
  m.post('web_app_device_storage_get_key', { req_id: 'd7', key: 'a' });
  expect(m.received).toEqual([
    ['device_storage_key_saved', { req_id: 'd1' }],
    ['device_storage_key_received', { req_id: 'd2', value: 'v' }],
    ['device_storage_key_saved', { req_id: 'd3' }],
    ['device_storage_key_received', { req_id: 'd4', value: null }],
    ['device_storage_key_saved', { req_id: 'd5' }],
    ['device_storage_cleared', { req_id: 'd6' }],
    ['device_storage_key_received', { req_id: 'd7', value: null }],
  ]);
  expect(m.device.items).toEqual({});
});

test('mock: controls send their native events', () => {
  const m = harness();
  m.controls.minimize();
  m.controls.restore();
  // Hidden BackButton: Android back would close the app, so no event reaches TWA.
  m.controls.pressBack();
  m.post('web_app_setup_back_button', { is_visible: true });
  m.controls.pressBack();
  m.post('web_app_setup_back_button', { is_visible: false });
  m.controls.pressBack();
  m.controls.setSafeArea({ top: 24, bottom: 34, left: 0, right: 0 }, { top: 46, bottom: 0, left: 0, right: 0 });
  m.controls.setSafeArea({ top: 20, bottom: 0, left: 0, right: 0 });
  m.controls.setViewport(700);
  m.post('web_app_request_viewport');
  m.post('web_app_request_safe_area');
  m.post('web_app_request_content_safe_area');
  m.controls.setVersion('7.0');
  const viewport = ['viewport_changed', { height: 700, is_expanded: true, is_state_stable: true }];
  expect(m.received).toEqual([
    ['visibility_changed', { is_visible: false }],
    ['visibility_changed', { is_visible: true }],
    ['back_button_pressed', null],
    ['safe_area_changed', { top: 24, bottom: 34, left: 0, right: 0 }],
    ['content_safe_area_changed', { top: 46, bottom: 0, left: 0, right: 0 }],
    ['safe_area_changed', { top: 20, bottom: 0, left: 0, right: 0 }],
    viewport,
    viewport,
    ['safe_area_changed', { top: 20, bottom: 0, left: 0, right: 0 }],
    ['content_safe_area_changed', { top: 46, bottom: 0, left: 0, right: 0 }],
  ]);
  expect(m.controls.events.filter((e) => e.type === 'mock_app_closed')).toEqual([
    { type: 'mock_app_closed', data: null },
    { type: 'mock_app_closed', data: null },
  ]);
  expect(m.versions).toEqual(['7.0']);
  // setVersion's reload target: only tgWebAppVersion changes, the signed tgWebAppData stays byte for byte.
  expect(
    withLaunchVersion(
      'http://127.0.0.1:4173/#tgWebAppData=a%3D1%26b%3D%2B&tgWebAppVersion=9.6&tgWebAppPlatform=android',
      '7.0',
    ),
  ).toBe('http://127.0.0.1:4173/#tgWebAppData=a%3D1%26b%3D%2B&tgWebAppVersion=7.0&tgWebAppPlatform=android');
  expect(withLaunchVersion('http://h/#tgWebAppVersion=9.6', '8.0')).toBe('http://h/#tgWebAppVersion=8.0');
  expect(withLaunchVersion('http://h/#a=1', '8.0')).toBe('http://h/#a=1&tgWebAppVersion=8.0');
  expect(withLaunchVersion('http://h/', '8.0')).toBe('http://h/#tgWebAppVersion=8.0');
});

test('mock: link opens recorded without navigating', () => {
  const m = harness();
  m.post('web_app_open_link', { url: 'https://example.com/' });
  m.post('web_app_open_tg_link', { path_full: '/share/url?url=x' });
  expect(m.controls.events).toEqual([
    { type: 'web_app_open_link', data: { url: 'https://example.com/' } },
    { type: 'web_app_open_tg_link', data: { path_full: '/share/url?url=x' } },
  ]);
  expect([m.received, m.versions]).toEqual([[], []]);
});

test('bootstrap: redirects to /dev/launch without signed launch params', () => {
  const cases = [
    ['', null],
    ['#tgWebAppVersion=9.6&tgWebAppPlatform=android', null],
    ['#tgWebAppData=&tgWebAppVersion=9.6', null],
    // TWA stores its init params even on a load without any: `{}` alone is no launch.
    ['', '{}'],
    ['', '{"tgWebAppData":""}'],
    ['', '{"tgWebAppData":7}'],
    ['', 'not json'],
    ['', 'throws'],
  ] as const;
  for (const [hash, stored] of cases) {
    const win = bootWindow(hash, stored);
    runInjected(bootstrapScript(), win);
    expect({ hash, stored, replaced: win.replaced }).toEqual({ hash, stored, replaced: ['/dev/launch'] });
    expect(win.__TG_DEV_MOCK__).toBe(true);
  }
});

test('bootstrap: stays with launch params in the hash or the session', () => {
  const cases = [
    ['#tgWebAppData=auth_date%3D1%26hash%3D00&tgWebAppVersion=9.6', null],
    ['', '{"tgWebAppData":"auth_date=1&hash=00","tgWebAppVersion":"9.6"}'],
  ] as const;
  for (const [hash, stored] of cases) {
    const win = bootWindow(hash, stored);
    runInjected(bootstrapScript(), win);
    expect({ hash, stored, replaced: win.replaced }).toEqual({ hash, stored, replaced: [] });
  }
  // The proxy TWA posts through queues every call until the transport drains it.
  const win = bootWindow(cases[0][0], null);
  runInjected(bootstrapScript(), win);
  win.TelegramWebviewProxy?.postEvent('web_app_request_theme', '""');
  win.TelegramWebviewProxy?.postEvent('web_app_ready', '""');
  expect(win.__tgMockQueue).toEqual([
    ['web_app_request_theme', '""'],
    ['web_app_ready', '""'],
  ]);
});

test('plugin: bootstrap injected as a classic head-prepend script', () => {
  const plugin = tgDevMock();
  expect(plugin.name).toBe('tg-dev-mock');
  // No attrs: no type="module", so it runs synchronously, in document order, before the TWA tag it precedes.
  expect(plugin.transformIndexHtml()).toEqual([{ tag: 'script', children: bootstrapScript(), injectTo: 'head-prepend' }]);
  const text = bootstrapScript();
  expect(text.startsWith('window.__TG_DEV_MOCK__=true;(')).toBe(true);
  expect(text.endsWith(')(window)')).toBe(true);
  // Self-contained: run alone, a closure over a module binding would throw a ReferenceError here.
  const win = bootWindow('#tgWebAppData=a', null);
  expect(() => runInjected(text, win)).not.toThrow();
  expect([win.__TG_DEV_MOCK__, typeof win.TelegramWebviewProxy?.postEvent]).toEqual([true, 'function']);
});

// ---------------------------------------------------------------------------------------------------------------
// Fake Stars sheet (C5). The request bodies are L8b's live contract (l8b-webhook-grant cut D8: `outcome` is
// required, `webhookDelayMs` 0..=60000) and its Q12 reading of "Pending": the paid POST with the delay.

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const INVOICE_BODY = { orderId: 'o1', title: 'Chapter 2', description: 'The archive', amount: 50 };
const SIMULATED = { precheckoutOk: true, chargeId: 'dev_0123' };

/** `fetch` over the two dev routes; each answer is made per call (a Response body reads once). */
function fakeFetch(answer: (method: string, url: string) => Response | Error = defaultAnswer): {
  fetch: typeof fetch;
  log: string[][];
} {
  const log: string[][] = [];
  const fetchFake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    log.push(typeof init?.body === 'string' ? [method, url, init.body] : [method, url]);
    const result = answer(method, url);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { fetch: fetchFake, log };
}

function defaultAnswer(method: string): Response {
  return method === 'GET' ? json(200, INVOICE_BODY) : json(200, SIMULATED);
}

/** The overlay as calls: one mount and one remove per run, the details it was shown, and a tap. */
function fakeRender(): {
  render: SheetRender;
  press(button: SheetButton): void;
  views: SheetDetails[];
  counts: { mounts: number; removes: number };
} {
  const views: SheetDetails[] = [];
  const counts = { mounts: 0, removes: 0 };
  let press: ((button: SheetButton) => void) | null = null;
  return {
    render: {
      mount: (onPress) => {
        counts.mounts++;
        press = onPress;
      },
      details: (view) => {
        views.push(view);
      },
      remove: () => {
        counts.removes++;
      },
    },
    press: (button) => press?.(button),
    views,
    counts,
  };
}

const GET_INVOICE = ['GET', '/dev/invoices/s1'];

test('sheet: pay posts simulate-payment then closes paid', async () => {
  const net = fakeFetch();
  const sheet = fakeRender();
  const status = runInvoiceSheet('s1', { fetch: net.fetch, render: sheet.render });
  sheet.press('pay');
  expect(await status).toBe('paid');
  expect(net.log).toEqual([GET_INVOICE, ['POST', '/dev/simulate-payment', '{"slug":"s1","outcome":"paid"}']]);
});

test('sheet: each button sends its table row', async () => {
  const rows = [
    ['pay', '{"slug":"s1","outcome":"paid"}', 'paid'],
    ['pay-delayed', '{"slug":"s1","outcome":"paid","webhookDelayMs":3000}', 'paid'],
    ['pay-twice', '{"slug":"s1","outcome":"paid_twice"}', 'paid'],
    ['pending', '{"slug":"s1","outcome":"paid","webhookDelayMs":3000}', 'pending'],
    ['cancel', null, 'cancelled'],
    ['fail', null, 'failed'],
  ] as const;
  for (const [button, body, status] of rows) {
    const net = fakeFetch();
    const sheet = fakeRender();
    const result = runInvoiceSheet('s1', { fetch: net.fetch, render: sheet.render });
    await vi.waitFor(() => expect(sheet.views).toEqual([{ title: 'Chapter 2', amount: 50 }]));
    sheet.press(button);
    // A second tap on a closing sheet changes nothing.
    sheet.press('fail');
    expect({ button, status: await result }).toEqual({ button, status });
    const log = body === null ? [GET_INVOICE] : [GET_INVOICE, ['POST', '/dev/simulate-payment', body]];
    expect({ button, log: net.log, counts: sheet.counts }).toEqual({ button, log, counts: { mounts: 1, removes: 1 } });
  }
});

test('sheet: refused or failed simulate closes failed', async () => {
  const refusals: Array<() => Response | Error> = [
    () => json(400, { error: 'bad_request' }),
    () => json(404, { error: 'not_found' }),
    () => json(500, { error: 'internal' }),
    () => json(200, { precheckoutOk: false }),
    () => json(200, 'not an object'),
    () => new Response('not json', { status: 200 }),
    () => new TypeError('Failed to fetch'),
  ];
  for (const [index, refusal] of refusals.entries()) {
    const net = fakeFetch((method) => (method === 'POST' ? refusal() : json(200, INVOICE_BODY)));
    const sheet = fakeRender();
    const result = runInvoiceSheet('s1', { fetch: net.fetch, render: sheet.render });
    sheet.press('pay');
    expect({ index, status: await result }).toEqual({ index, status: 'failed' });
  }
  // The invoice route's 404, a malformed body or a network error is shown; the buttons stay usable.
  const unreadable: Array<() => Response | Error> = [
    () => json(404, { error: 'not_found' }),
    () => json(200, { title: 'no amount' }),
    () => new TypeError('Failed to fetch'),
  ];
  for (const [index, invoice] of unreadable.entries()) {
    const net = fakeFetch((method) => (method === 'GET' ? invoice() : json(200, SIMULATED)));
    const sheet = fakeRender();
    const result = runInvoiceSheet('s1', { fetch: net.fetch, render: sheet.render });
    await vi.waitFor(() => expect(sheet.views).toHaveLength(1));
    expect({ index, error: sheet.views.every((v) => 'error' in v) }).toEqual({ index, error: true });
    sheet.press('pay');
    expect({ index, status: await result }).toEqual({ index, status: 'paid' });
  }
});

test('mock: invoice outcome set skips the sheet', async () => {
  const net = fakeFetch();
  const sheet = fakeRender();
  let renders = 0;
  const m = harness({
    sheet: {
      fetch: net.fetch,
      render: () => {
        renders++;
        return sheet.render;
      },
    },
  });
  const closed = (slug: string, status: string): [string, unknown] => ['invoice_closed', { slug, status }];
  m.controls.setInvoiceOutcome('paid');
  m.post('web_app_open_invoice', { slug: 'dev-a' });
  await vi.waitFor(() => expect(m.received).toEqual([closed('dev-a', 'paid')]));
  m.controls.setInvoiceOutcome('pending');
  m.post('web_app_open_invoice', { slug: 'dev-b' });
  await vi.waitFor(() => expect(m.received).toHaveLength(2));
  m.controls.setInvoiceOutcome('cancelled');
  m.post('web_app_open_invoice', { slug: 'dev-c' });
  await vi.waitFor(() => expect(m.received).toHaveLength(3));
  m.controls.setInvoiceOutcome('failed');
  m.post('web_app_open_invoice', { slug: 'dev-d' });
  await vi.waitFor(() => expect(m.received).toHaveLength(4));
  expect(m.received).toEqual([
    closed('dev-a', 'paid'),
    closed('dev-b', 'pending'),
    closed('dev-c', 'cancelled'),
    closed('dev-d', 'failed'),
  ]);
  expect(net.log).toEqual([
    ['POST', '/dev/simulate-payment', '{"slug":"dev-a","outcome":"paid"}'],
    ['POST', '/dev/simulate-payment', '{"slug":"dev-b","outcome":"paid","webhookDelayMs":3000}'],
  ]);
  expect(renders).toBe(0);

  // `null` shows the sheet again; a second invoice while it is open is closed 'failed' at once.
  m.controls.setInvoiceOutcome(null);
  m.received.length = 0;
  m.post('web_app_open_invoice', { slug: 'dev-e' });
  expect(renders).toBe(1);
  m.post('web_app_open_invoice', { slug: 'dev-f' });
  expect([renders, m.received]).toEqual([1, [closed('dev-f', 'failed')]]);
  sheet.press('cancel');
  await vi.waitFor(() => expect(m.received).toEqual([closed('dev-f', 'failed'), closed('dev-e', 'cancelled')]));
});
