import { expect, test } from 'vitest';

import type { ChapterId, PuzzleLocalId } from '../story/staging.ts';
import type { DecodedDto, Decoder } from './decode.ts';
import { createEndpoints, puzzleId } from './endpoints.ts';
import samplesText from './fixtures/dto-samples.json?raw';
import { createHttp } from './http.ts';
import type { ApiRequest, Clock, FetchFn, Http } from './http.ts';

// Parsed here, so the decoders see `unknown`, as at the real edge.
const SAMPLES: unknown = JSON.parse(samplesText);

function samplesOf(name: DecodedDto): readonly unknown[] {
  const all = typeof SAMPLES === 'object' && SAMPLES !== null ? (SAMPLES as Record<string, unknown>) : {};
  const list = Object.hasOwn(all, name) ? all[name] : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`dto-samples.json has no samples of ${name}`);
  }
  return list;
}

/** Timers that never fire: no call here reaches the request timeout. */
const INERT_CLOCK: Clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('endpoints: values and restart routes', async () => {
  const calls: { r: ApiRequest; decode: Decoder<unknown> }[] = [];
  const http: Pick<Http, 'request'> = {
    request: (r, decode) => {
      calls.push({ r, decode });
      return Promise.resolve({ ok: false, error: { kind: 'aborted' } });
    },
  };
  const api = createEndpoints(http);
  const ch1 = 'ch1' as ChapterId;
  const drawer = puzzleId(ch1, 'drawer' as PuzzleLocalId);
  const signal = new AbortController().signal;

  // The fake answers at once; the requests and their decoders matter here.
  void api.getValues(ch1, { signal });
  void api.restartPuzzle(drawer, 3);
  void api.postAttempt(drawer, [1, 8, 4, 7]);
  void api.postAttempt(drawer, [1, 8, 4, 7], { run: 4 });

  expect(calls.map((c) => c.r)).toEqual([
    { method: 'GET', path: '/api/chapters/ch1/values', signal },
    { method: 'POST', path: '/api/puzzles/ch1.drawer/restart', body: { from: 3 } },
    { method: 'POST', path: '/api/puzzles/ch1.drawer/attempts', body: { answer: [1, 8, 4, 7] } },
    { method: 'POST', path: '/api/puzzles/ch1.drawer/attempts', body: { answer: [1, 8, 4, 7], run: 4 } },
  ]);
  // A static puzzle's attempt names no run: the body holds `answer` alone, never a `run` of null.
  const bodyKeys = calls.map(({ r }) => (typeof r.body === 'object' && r.body !== null ? Object.keys(r.body) : null));
  expect(bodyKeys).toEqual([null, ['from'], ['answer'], ['answer', 'run']]);

  const decoders: ReadonlyArray<readonly [Decoder<unknown> | undefined, DecodedDto]> = [
    [calls[0]?.decode, 'ValuesResponse'],
    [calls[1]?.decode, 'PlayerValue'],
    [calls[2]?.decode, 'AttemptResponse'],
    [calls[3]?.decode, 'AttemptResponse'],
  ];
  for (const [decode, dto] of decoders) {
    for (const sample of samplesOf(dto)) {
      expect(decode?.(sample), dto).toEqual({ ok: true, value: sample });
    }
  }

  // Through the real client: a 409 `value_changed` is an `ApiError` http whose body carries the decoded value.
  const conflict = samplesOf('ApiErrorBody').find(
    (b) => typeof b === 'object' && b !== null && Object.hasOwn(b, 'value'),
  );
  const fetch: FetchFn = (input) =>
    Promise.resolve(
      input === '/api/auth'
        ? json(200, { token: 'tok-1', expiresAt: 1800001800, user: { id: 1001, firstName: 'Аня', languageCode: 'ru' } })
        : json(409, conflict),
    );
  const real = createEndpoints(createHttp({ initData: 'query_id=AAH1&hash=0123abcd', clock: INERT_CLOCK, fetch }));
  const r = await real.postAttempt(drawer, [1, 8, 4, 7], { run: 2 });
  expect(r).toEqual({
    ok: false,
    error: { kind: 'http', status: 409, code: 'value_changed', body: conflict, retryAfter: null },
  });
  expect(r.ok ? null : r.error.kind === 'http' ? r.error.body?.value : null).toEqual(samplesOf('PlayerValue')[2]);
});
