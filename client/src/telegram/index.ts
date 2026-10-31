// The Mini App facade (principle 6): the one Telegram surface the rest of the client sees. Every method returns a
// value and nothing throws; a method below its Mini App API version does nothing or answers `unsupported`.
// `openInvoice`'s 'paid' is a hint to refetch entitlements, never a grant (principles 1-2), and `startParam()` is
// a UX hint the server re-reads from the signed initData (principle 3).
import type { Result } from '../story/catalog.ts';
import { browserEnv, createTelegramClient, readWebApp } from './webapp.ts';

/** How Telegram closed an invoice; 'paid' only tells the purchase flow to poll the server. */
export type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending';

/** A refused or failed Mini App call. */
export type TgError =
  | { kind: 'unsupported'; method: string }
  | { kind: 'invalid'; method: string; detail: string }
  | { kind: 'storage'; detail: string };

/** Why a prepared message was not shared (META M16). */
export type ShareError = { kind: 'unsupported' | 'expired' | 'declined' | 'send-failed' | 'unknown' };

/** The Android client's device class (R1 §6); 'AVERAGE' everywhere else. Never used for security. */
export type PerfClass = 'LOW' | 'AVERAGE' | 'HIGH';

/** The Mini App left (`deactivated`) or came back to (`activated`) the foreground. */
export type Lifecycle = 'activated' | 'deactivated';

/** Undoes exactly one subscription. */
export type Unsubscribe = () => void;

/** The facade contract (PROTOTYPE-PLAN "Module API", META-PLAN M16). */
export interface TelegramClient {
  /** `initData !== ''`: opened by Telegram (or the dev launch), not by a plain browser. */
  readonly inTelegram: boolean;
  /** The raw signed launch string; sent only to `POST /api/auth`. */
  readonly initData: string;
  readonly version: string;
  readonly platform: string;
  readonly perfClass: PerfClass;
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  /** 7.7. */
  disableVerticalSwipes(): void;
  /** 6.2. */
  setClosingConfirmation(on: boolean): void;
  /** 6.1; a header hex other than the theme's needs 6.9. */
  setChromeColors(header: `#${string}`, background: `#${string}`): void;
  /** `activated` / `deactivated` from 8.0; `visibilitychange` below it. */
  onLifecycle(fn: (e: Lifecycle) => void): Unsubscribe;
  /** 6.1. */
  backButton: { setVisible(v: boolean): void; onPress(fn: () => void): Unsubscribe };
  /** 6.1; TWA's throws become `TgError` values. */
  openInvoice(url: string): Promise<Result<InvoiceStatus, TgError>>;
  /** 6.9; a value over 4096 characters is refused before the call. */
  cloud: {
    get(k: string): Promise<Result<string | null, TgError>>;
    set(k: string, v: string): Promise<Result<void, TgError>>;
  };
  /** 9.0, otherwise `null`; `set(k, null)` removes the key. */
  device: {
    get(k: string): Promise<Result<string | null, TgError>>;
    set(k: string, v: string | null): Promise<Result<void, TgError>>;
  } | null;
  /** 6.1. */
  haptic: {
    impact(s: 'light' | 'medium'): void;
    selection(): void;
    notify(t: 'error' | 'success' | 'warning'): void;
  };
  /** `isVersionAtLeast('8.0')`. */
  supportsShareMessage(): boolean;
  /** 8.0; settles on the first share event or after a 60 s guard. */
  shareMessage(preparedId: string): Promise<Result<void, ShareError>>;
  /** 6.1; `https://t.me/` links only. */
  openTelegramLink(url: string): Result<void, TgError>;
  /** 6.1 (below it TWA would call `window.open`); `https:` only, from a tap. */
  openLink(url: string): Result<void, TgError>;
  /** The launch's `start_param` inside the startapp envelope, or `null`. UX only, never trusted. */
  startParam(): string | null;
}

let client: TelegramClient | null = null;

/** The page's one facade, created on first use from the loaded `telegram-web-app.js`. */
export function getTelegram(): TelegramClient {
  client ??= createTelegramClient(readWebApp(), browserEnv());
  return client;
}

declare global {
  /** Vite `define`: true in the dev server and `--mode e2e` (the dev mock), false in production (compiled out). */
  const __TG_MOCK__: boolean;
}
