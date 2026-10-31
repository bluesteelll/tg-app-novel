// The only reader of `window.Telegram` outside telegram/dev/ (arch rule window-telegram): types the subset of the
// official telegram-web-app.js (TWA) the facade uses and wraps it so that nothing throws. TWA throws `Error(<code>)`
// on a version or an argument it refuses; a void method drops that, a Result method returns it as a value.
import type { Result } from '../story/catalog.ts';
import type {
  InvoiceStatus,
  Lifecycle,
  ShareError,
  TelegramClient,
  TgError,
  Unsubscribe,
} from './index.ts';

/** A TWA event handler; TWA passes the event's data object, or nothing. */
export type TwaHandler = (data?: unknown) => void;

/** The subset of `window.Telegram.WebApp` the facade calls (pinned TWA: e2e/fixtures/telegram-web-app.js). */
export type TwaWebApp = {
  readonly initData: string;
  readonly version: string;
  readonly platform: string;
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes(): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  onEvent(type: string, fn: TwaHandler): void;
  offEvent(type: string, fn: TwaHandler): void;
  readonly BackButton: {
    show(): void;
    hide(): void;
    onClick(fn: () => void): void;
    offClick(fn: () => void): void;
  };
  openInvoice(url: string, callback: (status: string) => void): void;
  readonly CloudStorage: {
    getItem(key: string, callback: (error: string | null, value?: string) => void): void;
    setItem(key: string, value: string, callback: (error: string | null, stored?: boolean) => void): void;
  };
  readonly DeviceStorage: {
    getItem(key: string, callback: (error: string | null, value?: string | null) => void): void;
    setItem(key: string, value: string, callback: (error: string | null, stored?: boolean) => void): void;
    removeItem(key: string, callback: (error: string | null, removed?: boolean) => void): void;
  };
  readonly HapticFeedback: {
    impactOccurred(style: 'light' | 'medium'): void;
    selectionChanged(): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  shareMessage(id: string, callback?: (sent: boolean) => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
};

/** The document's page visibility, the lifecycle source below 8.0. */
export type VisibilitySource = {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

/** What the facade reads from the page besides TWA: the unit-test seam. */
export type TgEnv = {
  readonly userAgent: string;
  readonly doc: VisibilitySource;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

type TwaWindow = Window & { Telegram?: { WebApp?: unknown } };

/** CloudStorage's value limit (core.telegram.org/bots/webapps#cloudstorage). */
const CLOUD_VALUE_MAX = 4096;
/** A share that neither succeeds nor fails within this ends as `unknown` (META M16). */
const SHARE_GUARD_MS = 60_000;
/** The startapp envelope (META "Telegram facts"): what Telegram passes through as `start_param`. */
const START_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const SHARE_ERRORS: ReadonlyMap<string, ShareError['kind']> = new Map([
  ['UNSUPPORTED', 'unsupported'],
  ['MESSAGE_EXPIRED', 'expired'],
  ['USER_DECLINED', 'declined'],
  ['MESSAGE_SEND_FAILED', 'send-failed'],
]);

/** `window.Telegram.WebApp` as telegram-web-app.js defines it, or `null` when the script did not run. */
export function readWebApp(): TwaWebApp | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const app: unknown = (window as TwaWindow).Telegram?.WebApp;
  if (
    typeof app !== 'object' ||
    app === null ||
    !('isVersionAtLeast' in app) ||
    typeof app.isVersionAtLeast !== 'function' ||
    !('initData' in app) ||
    typeof app.initData !== 'string'
  ) {
    return null;
  }
  // TWA defines the whole object at once; its shape is pinned by the e2e against the pinned script.
  return app as TwaWebApp;
}

/** The page's own environment. */
export function browserEnv(): TgEnv {
  return {
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    doc: document,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };
}

/** The facade over a loaded TWA, or an inert client when it did not load. */
export function createTelegramClient(w: TwaWebApp | null, env: TgEnv): TelegramClient {
  return w === null ? inertClient(env) : webAppClient(w, env);
}

/** One TWA call whose throw has no channel: a void method. */
function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // TWA refused the version or the argument; the facade never throws.
  }
}

/** TWA's thrown `Error(<code>)` as a value. */
function thrownError(method: string, e: unknown): TgError {
  const detail = e instanceof Error ? e.message : String(e);
  return detail === 'WebAppMethodUnsupported' ? { kind: 'unsupported', method } : { kind: 'invalid', method, detail };
}

function unsupported(method: string): { ok: false; error: TgError } {
  return { ok: false, error: { kind: 'unsupported', method } };
}

/** One synchronous TWA call as a Result. */
function call(method: string, fn: () => void): Result<void, TgError> {
  try {
    fn();
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: thrownError(method, e) };
  }
}

/** One callback-style TWA call as a Promise of a Result: TWA's throw and its callback's error are values. */
function request<T>(
  method: string,
  start: (done: (error: string | null, value: T) => void) => void,
): Promise<Result<T, TgError>> {
  return new Promise((resolve) => {
    try {
      start((error, value) => {
        resolve(error !== null ? { ok: false, error: { kind: 'storage', detail: String(error) } } : { ok: true, value });
      });
    } catch (e) {
      resolve({ ok: false, error: thrownError(method, e) });
    }
  });
}

function parsedUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function invoiceStatus(status: unknown): InvoiceStatus {
  // Anything else is 'failed': the purchase flow polls the server either way (principle 1).
  return status === 'paid' || status === 'cancelled' || status === 'pending' ? status : 'failed';
}

function shareErrorKind(data: unknown): ShareError['kind'] {
  const code = typeof data === 'object' && data !== null && 'error' in data ? data.error : undefined;
  return (typeof code === 'string' ? SHARE_ERRORS.get(code) : undefined) ?? 'unknown';
}

function startParamOf(initData: string): string | null {
  const value = new URLSearchParams(initData).get('start_param');
  return value !== null && START_PARAM.test(value) ? value : null;
}

function visibilityLifecycle(doc: VisibilitySource, fn: (e: Lifecycle) => void): Unsubscribe {
  const listener = (): void => fn(doc.visibilityState === 'visible' ? 'activated' : 'deactivated');
  doc.addEventListener('visibilitychange', listener);
  return () => doc.removeEventListener('visibilitychange', listener);
}

function inertClient(env: TgEnv): TelegramClient {
  const none = (): void => {};
  return {
    inTelegram: false,
    initData: '',
    version: '',
    platform: 'unknown',
    perfClass: 'AVERAGE',
    isVersionAtLeast: () => false,
    ready: none,
    expand: none,
    disableVerticalSwipes: none,
    setClosingConfirmation: none,
    setChromeColors: none,
    onLifecycle: (fn) => visibilityLifecycle(env.doc, fn),
    backButton: { setVisible: none, onPress: () => none },
    openInvoice: () => Promise.resolve(unsupported('openInvoice')),
    cloud: {
      get: () => Promise.resolve(unsupported('cloud.get')),
      set: () => Promise.resolve(unsupported('cloud.set')),
    },
    device: null,
    haptic: { impact: none, selection: none, notify: none },
    supportsShareMessage: () => false,
    shareMessage: () => Promise.resolve({ ok: false, error: { kind: 'unsupported' } }),
    openTelegramLink: () => unsupported('openTelegramLink'),
    openLink: () => unsupported('openLink'),
    startParam: () => null,
  };
}

function webAppClient(w: TwaWebApp, env: TgEnv): TelegramClient {
  const at = (v: string): boolean => {
    try {
      return w.isVersionAtLeast(v);
    } catch {
      return false;
    }
  };
  // A wrapper per subscription: TWA keeps an identical callback once, so two subscribers of one function would
  // share one registration and the first unsubscribe would remove both.
  const subscribe = (type: string, fn: TwaHandler): Unsubscribe => {
    const handler: TwaHandler = (data) => fn(data);
    attempt(() => w.onEvent(type, handler));
    return () => attempt(() => w.offEvent(type, handler));
  };
  // One owner for both listeners and the guard: whichever settles first removes all three.
  const share = (id: string): Promise<Result<void, ShareError>> =>
    new Promise((resolve) => {
      let settled = false;
      const settle = (result: Result<void, ShareError>): void => {
        if (settled) {
          return;
        }
        settled = true;
        offSent();
        offFailed();
        env.clearTimeout(guard);
        resolve(result);
      };
      // Registered before the call: the answer may arrive inside it.
      const offSent = subscribe('shareMessageSent', () => settle({ ok: true, value: undefined }));
      const offFailed = subscribe('shareMessageFailed', (data) =>
        settle({ ok: false, error: { kind: shareErrorKind(data) } }),
      );
      const guard = env.setTimeout(() => settle({ ok: false, error: { kind: 'unknown' } }), SHARE_GUARD_MS);
      try {
        w.shareMessage(id);
      } catch (e) {
        // WebAppShareMessageOpened (a share is already open) is 'unknown': the caller offers "Send as link".
        const kind = e instanceof Error && e.message === 'WebAppMethodUnsupported' ? 'unsupported' : 'unknown';
        settle({ ok: false, error: { kind } });
      }
    });
  const link = (
    method: string,
    url: string,
    allowed: (u: URL) => boolean,
    detail: string,
    open: () => void,
  ): Result<void, TgError> => {
    if (!at('6.1')) {
      return unsupported(method);
    }
    const parsed = parsedUrl(url);
    if (parsed === null || !allowed(parsed)) {
      return { ok: false, error: { kind: 'invalid', method, detail } };
    }
    return call(method, open);
  };
  const initData = w.initData;
  return {
    inTelegram: initData !== '',
    initData,
    version: w.version,
    platform: w.platform,
    perfClass: 'AVERAGE',
    isVersionAtLeast: at,
    ready: () => attempt(() => w.ready()),
    expand: () => attempt(() => w.expand()),
    disableVerticalSwipes: () => {
      if (at('7.7')) {
        attempt(() => w.disableVerticalSwipes());
      }
    },
    setClosingConfirmation: (on) => {
      if (at('6.2')) {
        attempt(() => (on ? w.enableClosingConfirmation() : w.disableClosingConfirmation()));
      }
    },
    setChromeColors: (header, background) => {
      if (!at('6.1')) {
        return;
      }
      // Two calls: below 6.9 TWA throws on a header hex that is not the theme's, and the background still applies.
      attempt(() => w.setHeaderColor(header));
      attempt(() => w.setBackgroundColor(background));
    },
    onLifecycle: (fn) => {
      if (!at('8.0')) {
        return visibilityLifecycle(env.doc, fn);
      }
      const offActivated = subscribe('activated', () => fn('activated'));
      const offDeactivated = subscribe('deactivated', () => fn('deactivated'));
      return () => {
        offActivated();
        offDeactivated();
      };
    },
    backButton: {
      setVisible: (v) => {
        if (at('6.1')) {
          attempt(() => (v ? w.BackButton.show() : w.BackButton.hide()));
        }
      },
      onPress: (fn) => {
        if (!at('6.1')) {
          return () => {};
        }
        const handler = (): void => fn();
        attempt(() => w.BackButton.onClick(handler));
        return () => attempt(() => w.BackButton.offClick(handler));
      },
    },
    openInvoice: (url) =>
      !at('6.1')
        ? Promise.resolve(unsupported('openInvoice'))
        : new Promise((resolve) => {
            try {
              w.openInvoice(url, (status) => resolve({ ok: true, value: invoiceStatus(status) }));
            } catch (e) {
              // WebAppInvoiceUrlInvalid / WebAppInvoiceOpened -> invalid, WebAppMethodUnsupported -> unsupported.
              resolve({ ok: false, error: thrownError('openInvoice', e) });
            }
          }),
    cloud: {
      get: (k) =>
        !at('6.9')
          ? Promise.resolve(unsupported('cloud.get'))
          : request<string | null>('cloud.get', (done) =>
              w.CloudStorage.getItem(k, (error, value) => done(error, typeof value === 'string' && value !== '' ? value : null)),
            ),
      set: (k, v) => {
        if (!at('6.9')) {
          return Promise.resolve(unsupported('cloud.set'));
        }
        if (v.length > CLOUD_VALUE_MAX) {
          return Promise.resolve({
            ok: false,
            error: { kind: 'invalid', method: 'cloud.set', detail: `value over ${CLOUD_VALUE_MAX} characters` },
          });
        }
        return request<void>('cloud.set', (done) => w.CloudStorage.setItem(k, v, (error) => done(error, undefined)));
      },
    },
    device: at('9.0')
      ? {
          get: (k) =>
            request<string | null>('device.get', (done) =>
              w.DeviceStorage.getItem(k, (error, value) => done(error, typeof value === 'string' ? value : null)),
            ),
          set: (k, v) =>
            request<void>('device.set', (done) =>
              v === null
                ? w.DeviceStorage.removeItem(k, (error) => done(error, undefined))
                : w.DeviceStorage.setItem(k, v, (error) => done(error, undefined)),
            ),
        }
      : null,
    haptic: {
      impact: (s) => {
        if (at('6.1')) {
          attempt(() => w.HapticFeedback.impactOccurred(s));
        }
      },
      selection: () => {
        if (at('6.1')) {
          attempt(() => w.HapticFeedback.selectionChanged());
        }
      },
      notify: (t) => {
        if (at('6.1')) {
          attempt(() => w.HapticFeedback.notificationOccurred(t));
        }
      },
    },
    supportsShareMessage: () => at('8.0'),
    shareMessage: (id) => (at('8.0') ? share(id) : Promise.resolve({ ok: false, error: { kind: 'unsupported' } })),
    // Both refused below 6.1, where TWA's openLink calls window.open and openTelegramLink sets location.href.
    openTelegramLink: (url) =>
      link(
        'openTelegramLink',
        url,
        (u) => u.protocol === 'https:' && u.hostname === 't.me',
        'not an https://t.me/ link',
        () => w.openTelegramLink(url),
      ),
    openLink: (url) => link('openLink', url, (u) => u.protocol === 'https:', 'not an https: URL', () => w.openLink(url)),
    startParam: () => startParamOf(initData),
  };
}
