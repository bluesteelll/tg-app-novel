// The session (PROTOTYPE-PLAN "Token format", the client rules): the server's own token, held in this closure and
// nowhere else - never a storage API (principle 1) - with the verified user and the default UI language derived once,
// when `POST /api/auth` answers (K29). A generation number tells a late 401 for an old token from a fresh rejection.
import type { Lang } from '../i18n/index.ts';
import type { Unsubscribe } from '../telegram/index.ts';
import type { AuthResponse, UserDto } from './generated/api.ts';

/** One accepted `POST /api/auth`; `gen` counts the exchanges of the page, 1 first. */
export type Session = { readonly token: string; readonly gen: number; readonly user: UserDto; readonly lang: Lang };

/** The primary subtags whose speakers get Russian (K29); server/src/api/orders.rs and telegram/payments.rs agree. */
const RUSSIAN_PRIMARY: ReadonlySet<string> = new Set(['ru', 'uk', 'be', 'kk']);
const ASCII_UPPER = /[A-Z]/g;

/**
 * K29: the default language of a Telegram language tag. The primary subtag (split on '-'), compared ASCII
 * case-insensitively, in ru|uk|be|kk is Russian; anything else, or no tag, is English. ASCII folding only, as the
 * server's `eq_ignore_ascii_case`: `toLowerCase` would fold the Kelvin sign into 'k'.
 */
export function langOfTag(tag: string | null): Lang {
  const primary = (tag ?? '').split('-')[0] ?? '';
  const folded = primary.replace(ASCII_UPPER, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
  return RUSSIAN_PRIMARY.has(folded) ? 'ru' : 'en';
}

/** The page's session state. */
export interface SessionStore {
  /** The newest accepted session, or `null` before the first exchange or after expiry. */
  current(): Session | null;
  /** Keeps a verified auth response as the next generation. */
  accept(r: AuthResponse): Session;
  /** Ends the session for the page's life (initData refused); fires `onExpired` once. */
  expire(): void;
  expired(): boolean;
  onExpired(fn: () => void): Unsubscribe;
}

export function createSessionStore(): SessionStore {
  let session: Session | null = null;
  let gen = 0;
  let ended = false;
  const listeners = new Set<() => void>();
  return {
    current: () => session,
    accept(r) {
      gen += 1;
      session = { token: r.token, gen, user: r.user, lang: langOfTag(r.user.languageCode) };
      return session;
    },
    expire() {
      if (ended) {
        return;
      }
      ended = true;
      session = null;
      for (const fn of [...listeners]) {
        fn();
      }
    },
    expired: () => ended,
    onExpired(fn) {
      // A wrapper per subscription, so the same function subscribed twice is undone one at a time.
      const entry = (): void => fn();
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
}
