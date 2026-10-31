// The dev mock's native side (R1 §5b). telegram-web-app.js (TWA) posts through `window.TelegramWebviewProxy`
// whenever it exists, so a queueing proxy defined before the script (`bootstrapMock`, inlined into index.html by
// vite-plugins/tg-dev-mock.ts) and this transport behind it run TWA's real code path in the dev server and the e2e.
// DEV / e2e only: main.ts imports it under `if (__TG_MOCK__)`, which production compiles out (scan-dist's
// dev-canary proves it). No top-level side effects: the Vite config loader imports this module in Node.
import type { InvoiceStatus } from '../index.ts';
import {
  domSheetRender,
  pressButton,
  presetButton,
  runInvoiceSheet,
  type SheetRender,
} from './invoice-sheet.ts';

/** One recorded `postEvent`, its JSON parsed; `mock_app_closed` marks a back press the client would not deliver. */
export type MockEvent = { type: string; data: unknown };

export type Insets = { top: number; bottom: number; left: number; right: number };

/** `prepared_message_failed`'s codes (core.telegram.org/bots/webapps#events-available-for-mini-apps). */
export type ShareFailure = 'UNSUPPORTED' | 'MESSAGE_EXPIRED' | 'USER_DECLINED' | 'MESSAGE_SEND_FAILED' | 'UNKNOWN_ERROR';

/** `window.__tgMock`: what tests and the developer drive. */
export type MockControls = {
  readonly events: MockEvent[];
  /** `visibility_changed { is_visible: false }` -> TWA's `deactivated`. */
  minimize(): void;
  /** `visibility_changed { is_visible: true }` -> TWA's `activated`. */
  restore(): void;
  /** `back_button_pressed` while the BackButton is shown; otherwise Android closes the app (R1 §2). */
  pressBack(): void;
  setSafeArea(safe: Insets, content?: Insets): void;
  setViewport(height: number): void;
  /** Answers the next invoices without the sheet: 'paid' / 'pending' POST as their buttons do; `null` shows it. */
  setInvoiceOutcome(outcome: InvoiceStatus | null): void;
  setShareOutcome(outcome: 'sent' | ShareFailure): void;
  /** Reloads the page with `tgWebAppVersion=<v>` in the hash (hash params override TWA's stored ones). */
  setVersion(v: string): void;
};

/** A JSON object of strings persisted somewhere (`localStorage` in the page). */
export type KeyValueStore = { load(): Record<string, string>; save(items: Record<string, string>): void };

export type MockDeps = {
  /** `window.Telegram.WebView.receiveEvent`: the native -> TWA direction. */
  receive(type: string, data: unknown): void;
  /** How an answer is scheduled: a native client always answers asynchronously. */
  defer(fn: () => void): void;
  /** `localStorage['__mock_cloud__']`. */
  cloud: KeyValueStore;
  /** `localStorage['__mock_device__']`. */
  device: KeyValueStore;
  innerHeight(): number;
  /** The launch theme, parsed from TWA's own `initParams.tgWebAppThemeParams` (the `/dev/launch` hash). */
  themeParams(): unknown;
  setVersion(v: string): void;
  /** The fake Stars sheet's dev-route fetch and a fresh overlay per invoice. */
  sheet: { fetch: typeof fetch; render(): SheetRender };
};

/** The inline script's own window: only what `bootstrapMock` touches. */
export type BootstrapWindow = {
  readonly location: { readonly hash: string; replace(url: string): void };
  readonly sessionStorage: { getItem(key: string): string | null };
  TelegramWebviewProxy?: { postEvent(type: string, json: string): void };
  __tgMockQueue?: Array<readonly [type: string, json: string]>;
};

type MockWindow = Window &
  BootstrapWindow & {
    Telegram?: { WebView?: { receiveEvent(type: string, data: unknown): void; initParams?: Record<string, unknown> } };
    __tgMock?: MockControls;
  };

const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

/** A parsed JSON value's fields, each read as `unknown`. */
function fields(data: unknown): Readonly<Record<string, unknown>> {
  // A JSON object from TWA's own JSON.stringify; nothing is trusted beyond `unknown`.
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The transport: TWA's `postEvent(type, json)` in, native events out through `deps.receive`. Pure. */
export function createMockTransport(d: MockDeps): {
  postEvent(type: string, json: string): void;
  controls: MockControls;
} {
  const events: MockEvent[] = [];
  let viewportHeight: number | null = null;
  let safe = NO_INSETS;
  let content = NO_INSETS;
  let backVisible = false;
  let shareOutcome: 'sent' | ShareFailure = 'sent';
  let invoiceOutcome: InvoiceStatus | null = null;
  let invoiceOpen = false;

  const answer = (type: string, data: unknown): void => d.defer(() => d.receive(type, data));
  const viewport = (): void =>
    answer('viewport_changed', { height: viewportHeight ?? d.innerHeight(), is_expanded: true, is_state_stable: true });

  const customMethod = (f: Readonly<Record<string, unknown>>): void => {
    const reqId = f['req_id'];
    const params = fields(f['params']);
    const items = d.cloud.load();
    switch (f['method']) {
      case 'saveStorageValue': {
        const key = params['key'];
        if (typeof key === 'string' && typeof params['value'] === 'string') {
          d.cloud.save({ ...items, [key]: params['value'] });
        }
        answer('custom_method_invoked', { req_id: reqId, result: true });
        return;
      }
      case 'getStorageValues': {
        // A key never set reads as '' (TWA's facade maps it to null).
        const result = Object.fromEntries(strings(params['keys']).map((k) => [k, items[k] ?? '']));
        answer('custom_method_invoked', { req_id: reqId, result });
        return;
      }
      case 'deleteStorageValues': {
        const drop = new Set(strings(params['keys']));
        d.cloud.save(Object.fromEntries(Object.entries(items).filter(([k]) => !drop.has(k))));
        answer('custom_method_invoked', { req_id: reqId, result: true });
        return;
      }
      case 'getStorageKeys':
        answer('custom_method_invoked', { req_id: reqId, result: Object.keys(items) });
        return;
      default:
        answer('custom_method_invoked', { req_id: reqId, error: 'UNKNOWN_METHOD' });
    }
  };

  const deviceStorage = (type: string, f: Readonly<Record<string, unknown>>): void => {
    const reqId = f['req_id'];
    const key = f['key'];
    const items = d.device.load();
    if (type === 'web_app_device_storage_clear') {
      d.device.save({});
      answer('device_storage_cleared', { req_id: reqId });
    } else if (typeof key !== 'string') {
      answer('device_storage_failed', { req_id: reqId, error: 'KEY_INVALID' });
    } else if (type === 'web_app_device_storage_get_key') {
      answer('device_storage_key_received', { req_id: reqId, value: items[key] ?? null });
    } else {
      const value = f['value'];
      const rest = Object.fromEntries(Object.entries(items).filter(([k]) => k !== key));
      d.device.save(typeof value === 'string' ? { ...rest, [key]: value } : rest);
      answer('device_storage_key_saved', { req_id: reqId });
    }
  };

  // One invoice at a time: a second one while the sheet (or a preset outcome's POST) runs is closed 'failed' at once.
  const openInvoice = (slug: unknown): void => {
    if (typeof slug !== 'string') {
      return;
    }
    if (invoiceOpen) {
      answer('invoice_closed', { slug, status: 'failed' });
      return;
    }
    invoiceOpen = true;
    const run =
      invoiceOutcome === null
        ? runInvoiceSheet(slug, { fetch: d.sheet.fetch, render: d.sheet.render() })
        : pressButton(slug, presetButton(invoiceOutcome), d.sheet.fetch);
    // Neither rejects: every failure of the dev routes closes the invoice 'failed'.
    void run.then((status) => {
      invoiceOpen = false;
      answer('invoice_closed', { slug, status });
    });
  };

  const postEvent = (type: string, json: string): void => {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      data = json;
    }
    events.push({ type, data });
    const f = fields(data);
    switch (type) {
      case 'web_app_request_viewport':
      case 'web_app_expand':
        viewport();
        return;
      case 'web_app_request_theme':
        answer('theme_changed', { theme_params: d.themeParams() ?? {} });
        return;
      case 'web_app_request_safe_area':
        answer('safe_area_changed', { ...safe });
        return;
      case 'web_app_request_content_safe_area':
        answer('content_safe_area_changed', { ...content });
        return;
      case 'web_app_setup_back_button':
        backVisible = f['is_visible'] === true;
        return;
      case 'web_app_invoke_custom_method':
        customMethod(f);
        return;
      case 'web_app_device_storage_save_key':
      case 'web_app_device_storage_get_key':
      case 'web_app_device_storage_clear':
        deviceStorage(type, f);
        return;
      case 'web_app_open_invoice':
        openInvoice(f['slug']);
        return;
      case 'web_app_send_prepared_message':
        if (shareOutcome === 'sent') {
          answer('prepared_message_sent', {});
        } else {
          answer('prepared_message_failed', { error: shareOutcome });
        }
        return;
      default:
        // web_app_open_link / web_app_open_tg_link and the rest: recorded only, never navigated.
        return;
    }
  };

  const controls: MockControls = {
    events,
    minimize: () => answer('visibility_changed', { is_visible: false }),
    restore: () => answer('visibility_changed', { is_visible: true }),
    pressBack: () => {
      if (backVisible) {
        answer('back_button_pressed', null);
      } else {
        events.push({ type: 'mock_app_closed', data: null });
      }
    },
    setSafeArea: (nextSafe, nextContent) => {
      safe = { ...nextSafe };
      answer('safe_area_changed', { ...safe });
      if (nextContent !== undefined) {
        content = { ...nextContent };
        answer('content_safe_area_changed', { ...content });
      }
    },
    setViewport: (height) => {
      viewportHeight = height;
      viewport();
    },
    setInvoiceOutcome: (outcome) => {
      invoiceOutcome = outcome;
    },
    setShareOutcome: (outcome) => {
      shareOutcome = outcome;
    },
    setVersion: (v) => d.setVersion(v),
  };
  return { postEvent, controls };
}

/**
 * The inline classic script that runs before telegram-web-app.js. Serialised by the plugin with
 * `Function.prototype.toString`, so it stays self-contained: it reads nothing but its argument and globals.
 * It defines the queueing proxy TWA posts through until `installMockTransport` drains it, and sends a page opened
 * without signed launch params to `/dev/launch`. TWA stores its init params in sessionStorage even when they are
 * empty (`{}`), so the stored params count only with a non-empty `tgWebAppData`.
 */
export function bootstrapMock(win: BootstrapWindow): void {
  const queue: Array<readonly [string, string]> = [];
  win.__tgMockQueue = queue;
  win.TelegramWebviewProxy = {
    postEvent(type: string, json: string): void {
      queue.push([type, json]);
    },
  };
  let stored: unknown = null;
  try {
    stored = JSON.parse(win.sessionStorage.getItem('__telegram__initParams') ?? 'null');
  } catch {
    stored = null;
  }
  const fromHash = new URLSearchParams(win.location.hash.replace(/^#/, '')).get('tgWebAppData') ?? '';
  const fromSession =
    typeof stored === 'object' && stored !== null && 'tgWebAppData' in stored && typeof stored.tgWebAppData === 'string'
      ? stored.tgWebAppData
      : '';
  if (fromHash === '' && fromSession === '') {
    win.location.replace('/dev/launch');
  }
}

/** `href` with `tgWebAppVersion=<v>` in its hash, every other hash param kept byte for byte. */
export function withLaunchVersion(href: string, version: string): string {
  const cut = href.indexOf('#');
  const base = cut === -1 ? href : href.slice(0, cut);
  const hash = cut === -1 ? '' : href.slice(cut + 1);
  const pair = `tgWebAppVersion=${encodeURIComponent(version)}`;
  const param = /(^|&)tgWebAppVersion=[^&]*/;
  const next = param.test(hash) ? hash.replace(param, `$1${pair}`) : hash === '' ? pair : `${hash}&${pair}`;
  return `${base}#${next}`;
}

function localStore(key: string): KeyValueStore {
  return {
    load: () => {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
        const items = fields(value);
        return Object.fromEntries(Object.entries(items).filter((e): e is [string, string] => typeof e[1] === 'string'));
      } catch {
        return {};
      }
    },
    save: (items) => {
      try {
        localStorage.setItem(key, JSON.stringify(items));
      } catch {
        // Storage full or blocked: the mock keeps no state across reloads then.
      }
    },
  };
}

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Puts the transport behind the bootstrap's proxy, answers what TWA queued at load, and exposes `window.__tgMock`. */
export function installMockTransport(): MockControls {
  const win = window as MockWindow;
  if (win.__tgMock !== undefined) {
    return win.__tgMock;
  }
  const transport = createMockTransport({
    receive: (type, data) => win.Telegram?.WebView?.receiveEvent(type, data),
    defer: (fn) => {
      win.setTimeout(fn, 0);
    },
    cloud: localStore('__mock_cloud__'),
    device: localStore('__mock_device__'),
    innerHeight: () => win.innerHeight,
    themeParams: () => parseJson(win.Telegram?.WebView?.initParams?.['tgWebAppThemeParams']),
    setVersion: (v) => {
      // A hash-only replace navigates within the document; the reload makes TWA read the new version.
      win.location.replace(withLaunchVersion(win.location.href, v));
      win.location.reload();
    },
    sheet: {
      // Same origin: the dev and preview servers proxy /dev/ to server-dev.
      fetch: (input, init) => win.fetch(input, init),
      render: () => domSheetRender(win.document),
    },
  });
  const queued = win.__tgMockQueue ?? [];
  win.TelegramWebviewProxy = { postEvent: transport.postEvent };
  for (const [type, json] of queued.splice(0)) {
    transport.postEvent(type, json);
  }
  win.__tgMock = transport.controls;
  return transport.controls;
}
