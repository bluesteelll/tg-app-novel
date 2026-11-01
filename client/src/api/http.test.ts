import { expect, test } from 'vitest';

import type { StoryId } from '../story/catalog.ts';
import type { ChapterId, OrderId, ProductId, PuzzleLocalId } from '../story/staging.ts';
import { decodeAttemptResponse, decodeEntitlementsResponse } from './decode.ts';
import type { DecodedDto } from './decode.ts';
import { createEndpoints, puzzleId } from './endpoints.ts';
import samplesText from './fixtures/dto-samples.json?raw';
import { createHttp } from './http.ts';
import type { ApiError, Clock, FetchFn } from './http.ts';
import { langOfTag } from './session.ts';

const RAW = 'query_id=AAH1&user=%7B%22id%22%3A1001%7D&auth_date=1800000000&hash=0123abcd';

/** Timers the test advances by hand; promise chains settle between timers, so chained timers fire in order. */
class FakeClock implements Clock {
  #now = 0;
  #next = 1;
  readonly #timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.#now;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.#next++;
    this.#timers.set(id, { at: this.#now + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }
  pending(): number {
    return this.#timers.size;
  }
  async advance(ms: number): Promise<void> {
    const end = this.#now + ms;
    await settle();
    for (;;) {
      const due = [...this.#timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (due === undefined) {
        break;
      }
      this.#timers.delete(due[0]);
      this.#now = due[1].at;
      due[1].fn();
      await settle();
    }
    this.#now = end;
  }
}

/** Lets every pending promise chain run: one real macrotask. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Seen = { url: string; method: string; headers: Record<string, string>; body: string | null; keepalive: boolean; signal: AbortSignal | null };
type Answer = (s: Seen) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const rejected = (code: string) => json(401, { error: code });
const entitlements = { products: [{ productId: 'chapter:ch2', chapterId: 'ch2', priceStars: 50, owned: true }] };

/**
 * A scripted server: `POST /api/auth` answers token `tok-<n>` for the n-th exchange unless `auth` overrides it; every
 * other call goes to `route`. It records each call and honours `init.signal` as the real fetch does.
 */
function fakeServer(route: Answer, auth?: (n: number) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  let exchanges = 0;
  const fetch: FetchFn = (input, init) => {
    const s: Seen = {
      url: input,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === 'string' ? init.body : null,
      keepalive: init.keepalive === true,
      signal: init.signal ?? null,
    };
    seen.push(s);
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (signal?.aborted === true) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      const answer =
        input === '/api/auth'
          ? (auth ?? ((n: number) => json(200, { token: `tok-${n}`, expiresAt: 1800001800, user: { id: 1001, firstName: 'Аня', languageCode: 'ru' } })))(++exchanges)
          : route(s);
      Promise.resolve(answer).then(resolve, reject);
    });
  };
  const auths = () => seen.filter((s) => s.url === '/api/auth');
  return { fetch, seen, auths, calls: (url: string) => seen.filter((s) => s.url === url) };
}

const bearer = (s: Seen | undefined) => s?.headers['authorization'] ?? null;
const GET_ENTITLEMENTS = { method: 'GET', path: '/api/entitlements' } as const;

test('http: 401 re-auths once', async () => {
  const srv = fakeServer((s) => (bearer(s) === 'Bearer tok-1' ? rejected('token_expired') : json(200, entitlements)));
  const http = createHttp({ initData: RAW, clock: new FakeClock(), fetch: srv.fetch });
  const r = await http.request(GET_ENTITLEMENTS, decodeEntitlementsResponse);
  expect(r).toEqual({ ok: true, value: entitlements });
  expect(srv.seen.map((s) => [s.method, s.url, bearer(s)])).toEqual([
    ['POST', '/api/auth', null],
    ['GET', '/api/entitlements', 'Bearer tok-1'],
    ['POST', '/api/auth', null],
    ['GET', '/api/entitlements', 'Bearer tok-2'],
  ]);
  expect(srv.auths().map((s) => JSON.parse(s.body ?? 'null'))).toEqual([{ initData: RAW }, { initData: RAW }]);

  // A second 401 after the one re-auth is the caller's error: no third exchange.
  const always = fakeServer(() => rejected('token_expired'));
  const http2 = createHttp({ initData: RAW, clock: new FakeClock(), fetch: always.fetch });
  const r2 = await http2.request(GET_ENTITLEMENTS, decodeEntitlementsResponse);
  expect(r2).toEqual({
    ok: false,
    error: { kind: 'http', status: 401, code: 'token_expired', body: { error: 'token_expired' }, retryAfter: null },
  });
  expect(always.auths()).toHaveLength(2);
  expect(always.calls('/api/entitlements')).toHaveLength(2);
});

test('http: only a token 401 re-auths', async () => {
  // A paywalled chapter or asset the player does not own: a fresh token cannot change the answer.
  const forbidden = fakeServer(() => json(403, { error: 'not_entitled' }));
  const http = createHttp({ initData: RAW, clock: new FakeClock(), fetch: forbidden.fetch });
  expect(await http.request({ method: 'GET', path: '/api/chapters/ch2' }, (raw) => ({ ok: true, value: raw }))).toEqual({
    ok: false,
    error: { kind: 'http', status: 403, code: 'not_entitled', body: { error: 'not_entitled' }, retryAfter: null },
  });
  expect(forbidden.auths(), 'a 403 must not trigger a re-auth').toHaveLength(1);
  expect(forbidden.calls('/api/chapters/ch2'), 'a 403 is not retried').toHaveLength(1);
  const asset = '/api/assets/bg-hall-0123abcd.avif';
  expect(await http.fetchAsset(asset, new AbortController().signal)).toEqual({ ok: false, error: { kind: 'http', status: 403 } });
  expect(forbidden.auths(), 'a 403 on an asset must not trigger a re-auth').toHaveLength(1);
  expect(forbidden.calls(asset), 'a 403 on an asset is not retried').toHaveLength(1);

  // A 401 whose code is not a token rejection (a proxy, say) is the caller's error too.
  const odd = fakeServer(() => json(401, { error: 'initdata_invalid' }));
  const http2 = createHttp({ initData: RAW, clock: new FakeClock(), fetch: odd.fetch });
  expect(await http2.request(GET_ENTITLEMENTS, decodeEntitlementsResponse)).toEqual({
    ok: false,
    error: { kind: 'http', status: 401, code: 'initdata_invalid', body: { error: 'initdata_invalid' }, retryAfter: null },
  });
  expect(odd.auths(), 'a 401 with a non-token code must not trigger a re-auth').toHaveLength(1);
  expect(odd.calls('/api/entitlements'), 'a 401 with a non-token code is not retried').toHaveLength(1);
});

test('http: concurrent 401s share one auth', async () => {
  const reauth = deferred<Response>();
  const srv = fakeServer(
    (s) =>
      bearer(s) === 'Bearer tok-1'
        ? rejected('token_expired')
        : s.url === '/api/saves'
          ? json(200, { slots: [] })
          : new Response(new Uint8Array([7, 7]), { status: 200 }),
    (n) => (n === 1 ? json(200, { token: 'tok-1', expiresAt: 1, user: { id: 1, firstName: 'A', languageCode: null } }) : reauth.promise),
  );
  const http = createHttp({ initData: RAW, clock: new FakeClock(), fetch: srv.fetch });
  expect((await http.auth()).ok).toBe(true);
  const both = Promise.all([
    http.request({ method: 'GET', path: '/api/saves' }, (raw) => ({ ok: true, value: raw })),
    http.fetchAsset('/api/assets/bg-hall-0123abcd.avif', new AbortController().signal),
  ]);
  await settle();
  // Both 401s are in before the one re-auth answers.
  expect(srv.auths()).toHaveLength(2);
  reauth.resolve(json(200, { token: 'tok-2', expiresAt: 2, user: { id: 1, firstName: 'A', languageCode: null } }));
  const [a, b] = await both;
  expect(a.ok && b.ok).toBe(true);
  expect(srv.auths()).toHaveLength(2);
  expect(srv.seen.filter((s) => s.url !== '/api/auth').map(bearer).sort()).toEqual(['Bearer tok-1', 'Bearer tok-1', 'Bearer tok-2', 'Bearer tok-2']);
});

test('http: late 401 retries with the newer token', async () => {
  const late = deferred<Response>();
  let entitlementCalls = 0;
  const srv = fakeServer((s) => {
    if (s.url === '/api/saves') {
      return bearer(s) === 'Bearer tok-1' ? late.promise : json(200, { slots: [] });
    }
    entitlementCalls += 1;
    return bearer(s) === 'Bearer tok-1' ? rejected('token_expired') : json(200, entitlements);
  });
  const http = createHttp({ initData: RAW, clock: new FakeClock(), fetch: srv.fetch });
  expect((await http.auth()).ok).toBe(true);
  const slow = http.request({ method: 'GET', path: '/api/saves' }, (raw) => ({ ok: true, value: raw }));
  // The fast call is rejected, re-auths and succeeds while the slow call still waits on its tok-1 answer.
  expect(await http.request(GET_ENTITLEMENTS, decodeEntitlementsResponse)).toEqual({ ok: true, value: entitlements });
  expect(entitlementCalls).toBe(2);
  expect(srv.auths()).toHaveLength(2);
  late.resolve(rejected('token_expired'));
  expect(await slow).toEqual({ ok: true, value: { slots: [] } });
  // The late 401 was for tok-1, older than the session: it retries with tok-2 and no exchange.
  expect(srv.auths()).toHaveLength(2);
  expect(srv.calls('/api/saves').map(bearer)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
});

test('loader: expired token re-auths once then loads', async () => {
  const bytes = new Uint8Array([0x00, 0x61, 0x76, 0x69, 0x66, 0xff]);
  const srv = fakeServer((s) => (bearer(s) === 'Bearer tok-1' ? rejected('token_expired') : new Response(bytes, { status: 200 })));
  const http = createHttp({ initData: RAW, clock: new FakeClock(), fetch: srv.fetch });
  expect((await http.auth()).ok).toBe(true);
  const r = await http.fetchAsset('/api/assets/bg-hall-0123abcd.avif', new AbortController().signal);
  if (!r.ok) {
    expect.unreachable(`expected ok, got ${JSON.stringify(r.error)}`);
  }
  expect(new Uint8Array(await r.value.arrayBuffer())).toEqual(bytes);
  // One exchange at boot, then exactly one re-auth after the 401.
  expect(srv.auths()).toHaveLength(2);
  expect(srv.calls('/api/assets/bg-hall-0123abcd.avif').map(bearer)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
});

test('http: public asset fetch sends no bearer', async () => {
  const srv = fakeServer(() => new Response(new Uint8Array([1]), { status: 200 }));
  const http = createHttp({ initData: RAW, clock: new FakeClock(), fetch: srv.fetch });
  const signal = new AbortController().signal;
  expect((await http.fetchAsset('/assets/bg-room-0123abcd.avif', signal)).ok).toBe(true);
  expect((await http.fetchAsset('https://cdn.example.org/api/assets/x.avif', signal)).ok).toBe(true);
  // Neither public fetch needed a session.
  expect(srv.auths()).toHaveLength(0);
  expect((await http.fetchAsset('/api/assets/bg-hall-0123abcd.avif', signal)).ok).toBe(true);
  expect(srv.seen.map((s) => [s.url, bearer(s)])).toEqual([
    ['/assets/bg-room-0123abcd.avif', null],
    ['https://cdn.example.org/api/assets/x.avif', null],
    ['/api/auth', null],
    ['/api/assets/bg-hall-0123abcd.avif', 'Bearer tok-1'],
  ]);
  const missing = fakeServer(() => new Response('no', { status: 404 }));
  const http2 = createHttp({ initData: RAW, clock: new FakeClock(), fetch: missing.fetch });
  expect(await http2.fetchAsset('/assets/missing-0123abcd.avif', signal)).toEqual({ ok: false, error: { kind: 'http', status: 404 } });
});

test('http: aborted fetch reports aborted', async () => {
  const srv = fakeServer(() => new Promise<Response>(() => {}));
  const clock = new FakeClock();
  const http = createHttp({ initData: RAW, clock, fetch: srv.fetch });
  expect((await http.auth()).ok).toBe(true);

  const asset = new AbortController();
  const a = http.fetchAsset('/api/assets/bg-hall-0123abcd.avif', asset.signal);
  const call = new AbortController();
  const b = http.request({ method: 'GET', path: '/api/chapters/ch2', signal: call.signal }, (raw) => ({ ok: true, value: raw }));
  await settle();
  asset.abort();
  call.abort();
  expect(await a).toEqual({ ok: false, error: { kind: 'aborted' } });
  expect(await b).toEqual({ ok: false, error: { kind: 'aborted' } });
  // The fetch itself was cancelled, and the request's header timer is gone.
  expect(srv.seen.filter((s) => s.url !== '/api/auth').map((s) => s.signal?.aborted)).toEqual([true, true]);
  expect(clock.pending()).toBe(0);

  // An already-aborted signal sends nothing.
  const before = srv.seen.length;
  expect(await http.fetchAsset('/assets/bg-room-0123abcd.avif', AbortSignal.abort())).toEqual({ ok: false, error: { kind: 'aborted' } });
  expect(srv.seen).toHaveLength(before);
});

test('http: 429 carries retryAfter', async () => {
  const headers: Array<Record<string, string>> = [{ 'Retry-After': '42' }, {}, { 'Retry-After': 'soon' }, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }];
  let n = 0;
  const srv = fakeServer(() => json(429, { error: 'rate_limited' }, headers[n++] ?? {}));
  const http = createHttp({ initData: RAW, clock: new FakeClock(), fetch: srv.fetch });
  const errorOf = async (): Promise<ApiError | null> => {
    const r = await http.request(
      { method: 'POST', path: '/api/puzzles/ch1.drawer/attempts', body: { answer: [1, 2, 3] } },
      decodeAttemptResponse,
    );
    return r.ok ? null : r.error;
  };
  const limited = { kind: 'http', status: 429, code: 'rate_limited', body: { error: 'rate_limited' } };
  expect(await errorOf()).toEqual({ ...limited, retryAfter: 42 });
  // Missing, not delta-seconds, an HTTP-date: no number to wait for.
  expect(await errorOf()).toEqual({ ...limited, retryAfter: null });
  expect(await errorOf()).toEqual({ ...limited, retryAfter: null });
  expect(await errorOf()).toEqual({ ...limited, retryAfter: null });
  // A proxy's non-JSON error is still an http error, with no code.
  const proxy = fakeServer(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
  const http2 = createHttp({ initData: RAW, clock: new FakeClock(), fetch: proxy.fetch });
  expect(await http2.request(GET_ENTITLEMENTS, decodeEntitlementsResponse)).toEqual({
    ok: false,
    error: { kind: 'http', status: 502, code: null, body: null, retryAfter: null },
  });
});

test('http: initdata expired ends the session once', async () => {
  const srv = fakeServer(() => json(200, entitlements), () => rejected('initdata_expired'));
  const http = createHttp({ initData: RAW, clock: new FakeClock(), fetch: srv.fetch });
  let fired = 0;
  http.onSessionExpired(() => {
    fired += 1;
  });
  expect(await http.request(GET_ENTITLEMENTS, decodeEntitlementsResponse)).toEqual({ ok: false, error: { kind: 'session-expired' } });
  expect(fired).toBe(1);
  const calls = srv.seen.length;
  expect(await http.request(GET_ENTITLEMENTS, decodeEntitlementsResponse)).toEqual({ ok: false, error: { kind: 'session-expired' } });
  expect(await http.auth()).toEqual({ ok: false, error: { kind: 'session-expired' } });
  expect(await http.fetchAsset('/api/assets/bg-hall-0123abcd.avif', new AbortController().signal)).toEqual({
    ok: false,
    error: { kind: 'session-expired' },
  });
  expect(srv.seen).toHaveLength(calls);
  expect(fired).toBe(1);

  // A 5xx on the exchange is transient: the session is not ended and the next call exchanges again.
  let down = true;
  const flaky = fakeServer(
    () => json(200, entitlements),
    (n) => (down ? json(503, { error: 'internal' }) : json(200, { token: `tok-${n}`, expiresAt: 1, user: { id: 1, firstName: 'A', languageCode: null } })),
  );
  const http2 = createHttp({ initData: RAW, clock: new FakeClock(), fetch: flaky.fetch });
  expect(await http2.request(GET_ENTITLEMENTS, decodeEntitlementsResponse)).toMatchObject({ ok: false, error: { kind: 'http', status: 503 } });
  down = false;
  expect(await http2.request(GET_ENTITLEMENTS, decodeEntitlementsResponse)).toEqual({ ok: true, value: entitlements });
});

test('http: request timeout is a network error', async () => {
  const srv = fakeServer(() => new Promise<Response>(() => {}));
  const clock = new FakeClock();
  const http = createHttp({ initData: RAW, clock, fetch: srv.fetch });
  expect((await http.auth()).ok).toBe(true);
  let settled: unknown = null;
  void http.request(GET_ENTITLEMENTS, decodeEntitlementsResponse).then((r) => {
    settled = r;
  });
  await clock.advance(19_999);
  expect(settled).toBe(null);
  await clock.advance(1);
  expect(settled).toEqual({ ok: false, error: { kind: 'network', detail: 'timeout' } });
  expect(srv.calls('/api/entitlements')[0]?.signal?.aborted).toBe(true);
  expect(clock.pending()).toBe(0);
});

test('session: language follows K29', async () => {
  // server/src/telegram/payments.rs `payer_lang_matches_k29`, case for case.
  const cases: ReadonlyArray<readonly [string | null, 'ru' | 'en']> = [
    ['ru', 'ru'],
    ['uk', 'ru'],
    ['be', 'ru'],
    ['kk-KZ', 'ru'],
    ['en', 'en'],
    ['de', 'en'],
    [null, 'en'],
    ['RU', 'ru'],
    ['Kk-KZ', 'ru'],
    ['ru-RU', 'ru'],
    ['UK', 'ru'],
    ['', 'en'],
    ['rus', 'en'],
    ['kk_KZ', 'en'],
    ['en-RU', 'en'],
  ];
  expect(cases.map(([tag]) => [tag, langOfTag(tag)])).toEqual(cases);
  // ASCII case folding only, as Rust's eq_ignore_ascii_case: the Kelvin sign is not a 'k'.
  expect(langOfTag('Kk')).toBe('en');

  // The session's language comes from the verified auth response, never from initDataUnsafe.
  const srv = fakeServer(
    () => json(200, entitlements),
    () => json(200, { token: 't', expiresAt: 1, user: { id: 7, firstName: 'Аян', languageCode: 'kk-KZ' } }),
  );
  const http = createHttp({ initData: RAW, clock: new FakeClock(), fetch: srv.fetch });
  const s = await http.auth();
  expect(s.ok && { lang: s.value.lang, user: s.value.user }).toEqual({
    lang: 'ru',
    user: { id: 7, firstName: 'Аян', languageCode: 'kk-KZ' },
  });
});

/** The `index`-th Rust-written sample of `dto`, by name (decode.test.ts reads the same file). */
function sample(dto: DecodedDto, index = 0): unknown {
  const all: unknown = JSON.parse(samplesText);
  const list = typeof all === 'object' && all !== null && Object.hasOwn(all, dto) ? (all as Record<string, unknown>)[dto] : undefined;
  const value: unknown = Array.isArray(list) ? list[index] : undefined;
  if (value === undefined) {
    throw new Error(`dto-samples.json has no ${dto}[${index}]`);
  }
  return value;
}

test('endpoints: routes carry story, slot and lang', async () => {
  // Every call answers the sample of its DTO whatever the path, so a wrong route fails on the path, not the decode.
  let answer: unknown = null;
  const srv = fakeServer(() => json(200, answer));
  const api = createEndpoints(createHttp({ initData: RAW, clock: new FakeClock(), fetch: srv.fetch }));
  const manor = 'manor' as StoryId;
  const drawer = puzzleId('ch1' as ChapterId, 'drawer' as PuzzleLocalId);
  const put = { expectedRev: 3, writeId: 'w-4', chapterId: 'ch1', storyVersion: 'v1', lineId: 'ch1.k1.l3', body: '{"rev":4}' };
  const cases: ReadonlyArray<{
    name: string;
    call: () => Promise<{ ok: boolean }>;
    dto: DecodedDto;
    index?: number;
    method: string;
    path: string;
    body: unknown;
    keepalive?: boolean;
  }> = [
    { name: 'getEntitlements', call: () => api.getEntitlements(), dto: 'EntitlementsResponse', method: 'GET', path: '/api/entitlements', body: null },
    { name: 'listSaves', call: () => api.listSaves(), dto: 'SaveListResponse', method: 'GET', path: '/api/saves', body: null },
    { name: 'getSave', call: () => api.getSave(manor, 'auto'), dto: 'SaveFull', method: 'GET', path: '/api/saves/manor/auto', body: null },
    {
      name: 'putSave',
      call: () => api.putSave(manor, 's1', put, { keepalive: true }),
      dto: 'PutSaveResponse',
      method: 'PUT',
      path: '/api/saves/manor/s1',
      body: put,
      keepalive: true,
    },
    {
      name: 'createInvoice',
      call: () => api.createInvoice('chapter:ch2' as ProductId),
      dto: 'CreateInvoiceResponse',
      method: 'POST',
      path: '/api/invoices',
      body: { productId: 'chapter:ch2' },
    },
    {
      name: 'getOrder',
      call: () => api.getOrder('o_0123456789abcdef0123456789abcdef' as OrderId),
      dto: 'OrderResponse',
      index: 2,
      method: 'GET',
      path: '/api/orders/o_0123456789abcdef0123456789abcdef',
      body: null,
    },
    { name: 'getChapter', call: () => api.getChapter('ch2' as ChapterId), dto: 'ChapterPayload', method: 'GET', path: '/api/chapters/ch2', body: null },
    { name: 'getPuzzle', call: () => api.getPuzzle(drawer, 'ru'), dto: 'PuzzleStatus', method: 'GET', path: '/api/puzzles/ch1.drawer?lang=ru', body: null },
    {
      name: 'postAttempt',
      call: () => api.postAttempt(drawer, [1, 2, 3]),
      dto: 'AttemptResponse',
      method: 'POST',
      path: '/api/puzzles/ch1.drawer/attempts',
      body: { answer: [1, 2, 3] },
    },
  ];
  for (const c of cases) {
    answer = sample(c.dto, c.index);
    const r = await c.call();
    const sent = srv.seen[srv.seen.length - 1];
    expect(sent?.url, c.name).toBe(c.path);
    expect(sent?.method, c.name).toBe(c.method);
    expect(sent?.body === null || sent?.body === undefined ? null : JSON.parse(sent.body), c.name).toEqual(c.body);
    expect(sent?.keepalive, c.name).toBe(c.keepalive === true);
    expect(sent?.headers['authorization'], c.name).toBe('Bearer tok-1');
    expect(r, c.name).toEqual({ ok: true, value: answer });
  }
  expect(srv.auths()).toHaveLength(1);

  // The chapter and puzzle calls take the caller's signal: an aborted one sends nothing.
  const before = srv.seen.length;
  const gone = AbortSignal.abort();
  expect(await api.getChapter('ch2' as ChapterId, { signal: gone })).toEqual({ ok: false, error: { kind: 'aborted' } });
  expect(await api.getPuzzle(drawer, 'en', { signal: gone })).toEqual({ ok: false, error: { kind: 'aborted' } });
  expect(await api.postAttempt(drawer, [4], { signal: gone })).toEqual({ ok: false, error: { kind: 'aborted' } });
  expect(srv.seen).toHaveLength(before);
});
