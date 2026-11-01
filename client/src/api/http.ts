// The API client (PROTOTYPE-PLAN K4, "HTTP API", the client token rules): every `/api` call and every asset byte goes
// through here. The token lives in api/session.ts's closure only. A `401 token_*` re-auths once - single flight, with
// the same raw initData - and retries once; a refused exchange ends the session for the page, since initData is fixed.
// `fetchAsset` is story/catalog.ts's FetchAsset: the bearer goes to `/api/` URLs only, never to a static or other host.
import type { AssetFetchError, FetchAsset, Result } from '../story/catalog.ts';
import type { Unsubscribe } from '../telegram/index.ts';
import { decodeApiErrorBody, decodeAuthResponse } from './decode.ts';
import type { Decoder } from './decode.ts';
import type { ApiErrorBody, ErrorCode } from './generated/api.ts';
import { createSessionStore } from './session.ts';
import type { Session } from './session.ts';

export type { Decoder } from './decode.ts';

/**
 * Why a call failed. `http` keeps a non-JSON error (a proxy's 502) with `code` and `body` null; `retryAfter` is the
 * `Retry-After` delta-seconds, else null.
 */
export type ApiError =
  | { kind: 'http'; status: number; code: ErrorCode | null; body: ApiErrorBody | null; retryAfter: number | null }
  | { kind: 'network'; detail: string }
  | { kind: 'decode'; detail: string }
  | { kind: 'session-expired' }
  | { kind: 'aborted' };

/** Time and timers, injected so tests drive them by hand. */
export type Clock = { now(): number; setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };

/** The page's clock; the globals are read at call time. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** One JSON call; `body` is serialized here. */
export type ApiRequest = {
  method: 'GET' | 'POST' | 'PUT';
  path: `/api/${string}`;
  body?: unknown;
  keepalive?: boolean;
  signal?: AbortSignal;
};

/**
 * A JSON call's limit per attempt, to the response headers: a stalled PUT would otherwise hold the saves queue (one in
 * flight) and an invoice creation forever. The body read is not timed; asset fetches end through their signal only.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

export interface Http {
  /** The current session, or the one exchange in flight (started if none): boot calls it at F1 step 3. */
  auth(): Promise<Result<Session, ApiError>>;
  request<T>(r: ApiRequest, decode: Decoder<T>): Promise<Result<T, ApiError>>;
  readonly fetchAsset: FetchAsset;
  /** Fires once, when the page's session ends (initData refused): the "reopen the app" screen. */
  onSessionExpired(fn: () => void): Unsubscribe;
}

/** The 401 codes a fresh token can cure; `initdata_*` cannot (the same initData would be refused again). */
const TOKEN_REJECTIONS: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['token_missing', 'token_invalid', 'token_expired']);
const DELTA_SECONDS = /^\d+$/;
const SESSION_EXPIRED: ApiError = { kind: 'session-expired' };
const ABORTED: ApiError = { kind: 'aborted' };

/** A response read to its end: the text of a JSON call or an error, or the bytes of a successful asset. */
type Reply = { readonly status: number; readonly headers: Headers; readonly text: string; readonly blob: Blob | null };

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
const network = (detail: string): ApiError => ({ kind: 'network', detail });
const is2xx = (status: number): boolean => status >= 200 && status < 300;

function describe(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

function errorBody(text: string): ApiErrorBody | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const d = decodeApiErrorBody(raw);
  return d.ok ? d.value : null;
}

function httpError(reply: Reply): ApiError {
  const body = errorBody(reply.text);
  const header = reply.headers.get('retry-after');
  const seconds = header !== null && DELTA_SECONDS.test(header) ? Number(header) : null;
  return {
    kind: 'http',
    status: reply.status,
    code: body?.error ?? null,
    body,
    retryAfter: seconds !== null && Number.isSafeInteger(seconds) ? seconds : null,
  };
}

function isTokenRejection(reply: Reply): boolean {
  const code = reply.status === 401 ? errorBody(reply.text)?.error : undefined;
  return code !== undefined && TOKEN_REJECTIONS.has(code);
}

function decoded<T>(text: string, decode: Decoder<T>): Result<T, ApiError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return err({ kind: 'decode', detail: `not JSON: ${describe(e)}` });
  }
  const d = decode(raw);
  return d.ok ? d : err({ kind: 'decode', detail: d.error });
}

function assetError(e: ApiError): AssetFetchError {
  switch (e.kind) {
    case 'http':
      return { kind: 'http', status: e.status };
    case 'network':
    case 'session-expired':
    case 'aborted':
      return e;
    case 'decode':
      // Only the auth exchange decodes on an asset's path: an unreadable answer is as good as none.
      return { kind: 'network', detail: e.detail };
    default: {
      const _never: never = e;
      return _never;
    }
  }
}

export function createHttp(deps: { initData: string; clock: Clock; fetch?: FetchFn; timeoutMs?: number }): Http {
  const { initData, clock } = deps;
  // Called as a plain function: `deps.fetch(…)` would run the browser's fetch with `this = deps` (Illegal invocation).
  const send: FetchFn = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const store = createSessionStore();
  let exchange: Promise<Result<Session, ApiError>> | null = null;

  /** The response headers, or why not: whichever of the fetch, the timeout and an abort of `ctl` comes first. */
  function headersOf(url: string, init: RequestInit, ctl: AbortController, timeout: number | null): Promise<Result<Response, ApiError>> {
    return new Promise((resolve) => {
      let timedOut = false;
      const stopped = (): ApiError => (timedOut ? network('timeout') : ABORTED);
      const timer =
        timeout === null
          ? null
          : clock.setTimeout(() => {
              timedOut = true;
              ctl.abort();
            }, timeout);
      // Settling twice is harmless: the promise keeps the first value, and both clean-ups are idempotent.
      const done = (r: Result<Response, ApiError>): void => {
        if (timer !== null) {
          clock.clearTimeout(timer);
        }
        ctl.signal.removeEventListener('abort', onAbort);
        resolve(r);
      };
      const onAbort = (): void => done(err(stopped()));
      ctl.signal.addEventListener('abort', onAbort);
      let pending: Promise<Response>;
      try {
        pending = send(url, { ...init, signal: ctl.signal });
      } catch (e) {
        done(err(network(describe(e))));
        return;
      }
      pending.then(
        (res) => done(ok(res)),
        (e: unknown) => done(err(ctl.signal.aborted ? stopped() : network(describe(e)))),
      );
    });
  }

  /** One fetch on its own controller, which the caller's signal aborts until the body is read. */
  async function attempt(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    timeout: number | null,
    asset: boolean,
  ): Promise<Result<Reply, ApiError>> {
    if (signal?.aborted === true) {
      return err(ABORTED);
    }
    const ctl = new AbortController();
    const forward = (): void => ctl.abort();
    signal?.addEventListener('abort', forward);
    try {
      const head = await headersOf(url, init, ctl, timeout);
      if (!head.ok) {
        return head;
      }
      const res = head.value;
      try {
        return asset && res.ok
          ? ok({ status: res.status, headers: res.headers, text: '', blob: await res.blob() })
          : ok({ status: res.status, headers: res.headers, text: await res.text(), blob: null });
      } catch (e) {
        return err(ctl.signal.aborted ? ABORTED : network(`body: ${describe(e)}`));
      }
    } finally {
      signal?.removeEventListener('abort', forward);
    }
  }

  async function authExchange(): Promise<Result<Session, ApiError>> {
    const reply = await attempt(
      '/api/auth',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) },
      undefined,
      timeoutMs,
      false,
    );
    if (!reply.ok) {
      // A network error or a timeout is transient: the next call exchanges again.
      return reply;
    }
    if (is2xx(reply.value.status)) {
      const auth = decoded(reply.value.text, decodeAuthResponse);
      return auth.ok ? ok(store.accept(auth.value)) : auth;
    }
    if (reply.value.status >= 400 && reply.value.status < 500) {
      // initData is fixed for the page: an exchange refused now is refused forever (D4).
      store.expire();
      return err(SESSION_EXPIRED);
    }
    return err(httpError(reply.value));
  }

  /** Joins the exchange in flight, or starts one: one `POST /api/auth` at a time per page. */
  function joinExchange(): Promise<Result<Session, ApiError>> {
    if (store.expired()) {
      return Promise.resolve(err(SESSION_EXPIRED));
    }
    exchange ??= authExchange().finally(() => {
      exchange = null;
    });
    return exchange;
  }

  function auth(): Promise<Result<Session, ApiError>> {
    const s = store.current();
    return s !== null ? Promise.resolve(ok(s)) : joinExchange();
  }

  /** After `used` was rejected: a newer session if another call already re-authed (a late 401), else the exchange. */
  function renewed(used: Session): Promise<Result<Session, ApiError>> {
    const s = store.current();
    return s !== null && s.gen > used.gen ? Promise.resolve(ok(s)) : joinExchange();
  }

  /** A call with the bearer: a token rejection re-auths once and retries once; a second rejection is returned. */
  async function authorized(
    url: string,
    init: (bearer: string) => RequestInit,
    signal: AbortSignal | undefined,
    timeout: number | null,
    asset: boolean,
  ): Promise<Result<Reply, ApiError>> {
    const first = await auth();
    if (!first.ok) {
      return first;
    }
    const reply = await attempt(url, init(`Bearer ${first.value.token}`), signal, timeout, asset);
    if (!reply.ok || !isTokenRejection(reply.value)) {
      return reply;
    }
    const next = await renewed(first.value);
    return next.ok ? attempt(url, init(`Bearer ${next.value.token}`), signal, timeout, asset) : next;
  }

  async function request<T>(r: ApiRequest, decode: Decoder<T>): Promise<Result<T, ApiError>> {
    const body = r.body === undefined ? undefined : JSON.stringify(r.body);
    const reply = await authorized(
      r.path,
      (bearer): RequestInit => ({
        method: r.method,
        headers: body === undefined ? { Authorization: bearer } : { Authorization: bearer, 'Content-Type': 'application/json' },
        body,
        keepalive: r.keepalive === true,
      }),
      r.signal,
      timeoutMs,
      false,
    );
    if (!reply.ok) {
      return reply;
    }
    return is2xx(reply.value.status) ? decoded(reply.value.text, decode) : err(httpError(reply.value));
  }

  const fetchAsset: FetchAsset = async (url, signal) => {
    const reply = url.startsWith('/api/')
      ? await authorized(url, (bearer) => ({ method: 'GET', headers: { Authorization: bearer } }), signal, null, true)
      : await attempt(url, { method: 'GET' }, signal, null, true);
    if (!reply.ok) {
      return err(assetError(reply.error));
    }
    return reply.value.blob !== null ? ok(reply.value.blob) : err({ kind: 'http', status: reply.value.status });
  };

  return { auth, request, fetchAsset, onSessionExpired: (fn) => store.onExpired(fn) };
}
