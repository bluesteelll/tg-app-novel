// L7: the Telegram facade, the performance class, the inset variables, the dev mock and its plugin, and the fake
// Stars sheet, over fakes: the unit project runs in node, which has no WebView. The real telegram-web-app.js runs
// only in the e2e (e2e/boot.spec.ts), against the pinned fixture.
import { expect, test } from 'vitest';

import type { Lifecycle } from './index.ts';
import { perfClassFromUa } from './perf.ts';
import { createTelegramClient, type TgEnv, type TwaHandler, type TwaWebApp, type VisibilitySource } from './webapp.ts';

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
 * once, as TWA's `indexOf` check does. A name in `throws` makes that method throw `Error(<code>)`, as TWA does.
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

  emit(type: string, data?: unknown): void {
    for (const fn of [...(this.#handlers.get(type) ?? [])]) {
      fn(data);
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
  // The same function twice is two subscriptions, though TWA's onEvent would keep one identical callback.
  const first = tg.onLifecycle(fn);
  const second = tg.onLifecycle(fn);
  expect([twa.live('activated'), twa.live('deactivated')]).toEqual([2, 2]);
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
  expect(twa.live('backButtonClicked')).toBe(2);
  twa.emit('backButtonClicked');
  expect(presses).toBe(2);
  offA();
  expect(twa.live('backButtonClicked')).toBe(1);
  offB();
  expect(twa.live('backButtonClicked')).toBe(0);
  twa.emit('backButtonClicked');
  expect(presses).toBe(2);
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
