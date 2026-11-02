import { expect, test } from 'vitest';

import type { PostStatsResponse, StatEventDto } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { EndingName, Result } from '../story/catalog.ts';
import type { DeviceStore } from '../saves/pending.ts';
import { KEEPALIVE_BODY_MAX } from '../saves/service.ts';
import type { ChapterId, LineId, PuzzleLocalId, StoryVersion } from '../story/staging.ts';
import type { TgError } from '../telegram/index.ts';
import { FLUSH_DELAY_MS, STATS_AGE_MS_MAX, STATS_BODY_MAX, STATS_QUEUE_KEY, STATS_QUEUE_MAX, createStatsReporter } from './reporter.ts';
import type { StatEvent, StatsReporter } from './reporter.ts';

/**
 * Timers the test advances by hand (http.test.ts's), plus `jump`: the clock moves on and no timer fires, as when the
 * page sleeps. Promise chains settle between timers, so chained timers fire in order.
 */
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
  jump(ms: number): void {
    this.#now += ms;
  }
  async advance(ms: number): Promise<void> {
    const end = this.#now + ms;
    await tick();
    for (;;) {
      const due = [...this.#timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (due === undefined) {
        break;
      }
      this.#timers.delete(due[0]);
      this.#now = Math.max(this.#now, due[1].at);
      due[1].fn();
      await tick();
    }
    this.#now = end;
  }
}

/** Lets every pending promise chain run: one real macrotask. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Answer = Result<PostStatsResponse, ApiError>;
/** One `postStatEvents` call as the server saw it; `answer` settles a call the script left hanging. */
type Call = { events: readonly StatEventDto[]; keepalive: boolean; at: number; answer: (r: Answer) => void };
/** How the fake server answers a call: a value at once, never (`hang`), a synchronous throw, or a rejection. */
type Script = (c: Call) => Answer | 'hang' | 'throw' | 'reject';

const okAll: Script = (c) => ({ ok: true, value: { recorded: c.events.length, duplicates: 0, rejected: [] } });
const fail =
  (error: ApiError): Script =>
  () => ({ ok: false, error });
const hang: Script = () => 'hang';
const NETWORK: ApiError = { kind: 'network', detail: 'offline' };
const httpError = (status: number, retryAfter: number | null = null): ApiError => ({
  kind: 'http',
  status,
  code: null,
  body: null,
  retryAfter,
});

/** A scripted `postStatEvents`: it records every call; `script` may be swapped between calls. */
function fakeServer(clock: FakeClock, script: Script) {
  const calls: Call[] = [];
  const server = {
    calls,
    script,
    api: {
      postStatEvents(events: readonly StatEventDto[], o?: { keepalive?: boolean }): Promise<Answer> {
        const d = deferred<Answer>();
        const call: Call = { events: [...events], keepalive: o?.keepalive === true, at: clock.now(), answer: d.resolve };
        calls.push(call);
        const r = server.script(call);
        if (r === 'throw') {
          throw new Error('boom');
        }
        if (r === 'reject') {
          return Promise.reject(new Error('boom'));
        }
        if (r !== 'hang') {
          d.resolve(r);
        }
        return d.promise;
      },
    },
  };
  return server;
}

/** The n-th lower-case UUID v4, as `crypto.randomUUID` would give one. */
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function counterIds(first = 1): () => string {
  let n = first - 1;
  return () => uuid(++n);
}

type DeviceCall = { op: 'get'; key: string } | { op: 'set'; key: string; value: string | null };

/** A Map-backed DeviceStorage; `holdReads` makes reads wait until the returned release is called. */
function fakeDevice() {
  const map = new Map<string, string>();
  const calls: DeviceCall[] = [];
  let gate: Promise<void> | null = null;
  const device: DeviceStore = {
    async get(key) {
      calls.push({ op: 'get', key });
      await gate;
      return { ok: true, value: map.get(key) ?? null };
    },
    async set(key, value) {
      calls.push({ op: 'set', key, value });
      if (value === null) {
        map.delete(key);
      } else {
        map.set(key, value);
      }
      return { ok: true, value: undefined };
    },
  };
  const holdReads = (): (() => void) => {
    const d = deferred<undefined>();
    gate = d.promise;
    return () => {
      gate = null;
      d.resolve(undefined);
    };
  };
  const sets = (): number => calls.filter((c) => c.op === 'set').length;
  /** The event ids of the stored queue, oldest first. */
  const stored = (): string[] => {
    const raw = map.get(STATS_QUEUE_KEY);
    // The reporter wrote it: a parse failure fails the test, which is the point.
    return raw === undefined ? [] : (JSON.parse(raw) as { events: { eventId: string }[] }).events.map((e) => e.eventId);
  };
  return { map, calls, device, holdReads, sets, stored };
}

function setup(script: Script = okAll, o: { device?: DeviceStore | null; clock?: FakeClock; firstId?: number } = {}) {
  const clock = o.clock ?? new FakeClock();
  const server = fakeServer(clock, script);
  const logs: string[] = [];
  const reporter: StatsReporter = createStatsReporter({
    api: server.api,
    device: o.device ?? null,
    clock,
    newId: counterIds(o.firstId),
    log: (m) => logs.push(m),
  });
  return { clock, server, logs, reporter };
}

const CH = 'ch1' as ChapterId;
const SV = '0123456789abcdef' as StoryVersion;
const started = (): StatEvent => ({ kind: 'chapter_started', chapterId: CH, storyVersion: SV });
const completed = (): StatEvent => ({ kind: 'chapter_completed', chapterId: CH, storyVersion: SV });
const ending = (name = 'truth'): StatEvent => ({ kind: 'ending_reached', chapterId: CH, storyVersion: SV, ending: name as EndingName });
const solved = (): StatEvent => ({
  kind: 'puzzle_ended',
  chapterId: CH,
  storyVersion: SV,
  puzzle: 'drawer' as PuzzleLocalId,
  outcome: 'solved',
});
const choice = (option: string): StatEvent => ({ kind: 'choice_made', chapterId: CH, storyVersion: SV, option: option as LineId });
const idsOf = (c: Call | undefined): string[] => (c === undefined ? [] : c.events.map((e) => e.eventId));
/** `uuid(from)` … `uuid(to)`. */
const uuids = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => uuid(from + i));
const utf8 = new TextEncoder();
/** The UTF-8 bytes of the POST body, as http.ts serializes it. */
const bodyBytes = (events: readonly StatEventDto[]): number => utf8.encode(JSON.stringify({ events })).length;
/** An option line ID whose knot name is `n` characters long. */
const longOption = (n: number): string => `ch1.${'k'.repeat(n)}.a1b2`;

test('reporter: retried batch keeps event ids', async () => {
  const { clock, server, reporter } = setup(fail(NETWORK));
  reporter.record(started());
  reporter.record(completed());
  await clock.advance(FLUSH_DELAY_MS - 1);
  expect(server.calls).toHaveLength(0);
  await clock.advance(1);
  expect(server.calls).toHaveLength(1);
  expect(idsOf(server.calls[0])).toEqual([uuid(1), uuid(2)]);
  expect(server.calls[0]?.events.map((e) => e.ageMs)).toEqual([5_000, 5_000]);

  // Each failure waits the next step; the last step repeats. Ids stay, ages are recomputed per attempt.
  let at = 5_000;
  for (const wait of [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]) {
    const before = server.calls.length;
    await clock.advance(wait - 1);
    expect(server.calls, `nothing before ${wait} ms`).toHaveLength(before);
    await clock.advance(1);
    at += wait;
    const retry = server.calls.at(-1);
    expect(server.calls).toHaveLength(before + 1);
    expect(retry?.at).toBe(at);
    expect(idsOf(retry)).toEqual([uuid(1), uuid(2)]);
    expect(retry?.events.map((e) => e.ageMs)).toEqual([at, at]);
  }

  // A 200 resets the steps: the next failure waits 5 s again.
  server.script = okAll;
  await clock.advance(300_000);
  expect(server.calls.at(-1)?.at).toBe(at + 300_000);
  server.script = fail(NETWORK);
  reporter.record(started());
  await clock.advance(FLUSH_DELAY_MS);
  const failedAt = clock.now();
  const count = server.calls.length;
  await clock.advance(4_999);
  expect(server.calls).toHaveLength(count);
  await clock.advance(1);
  expect(server.calls.at(-1)?.at).toBe(failedAt + 5_000);
  expect(idsOf(server.calls.at(-1))).toEqual([uuid(3)]);
});

test('reporter: ending flushes at once', async () => {
  const { clock, server, reporter } = setup(hang);
  reporter.record(started());
  await clock.advance(4_999);
  expect(server.calls).toHaveLength(0);
  reporter.record(ending());
  expect(server.calls).toHaveLength(1);
  expect(server.calls[0]?.at).toBe(4_999);
  expect(server.calls[0]?.events.map((e) => e.kind)).toEqual(['chapter_started', 'ending_reached']);
  expect(server.calls[0]?.keepalive).toBe(false);
  expect(clock.pending()).toBe(0);

  // One request at a time: everything during the flight only marks a follow-up.
  reporter.record(ending('ashes'));
  reporter.flush();
  reporter.flush({ keepalive: true });
  await clock.advance(0);
  expect(server.calls).toHaveLength(1);
  expect(clock.pending()).toBe(0);

  server.calls[0]?.answer({ ok: true, value: { recorded: 2, duplicates: 0, rejected: [] } });
  await clock.advance(0);
  expect(server.calls).toHaveLength(2);
  expect(idsOf(server.calls[1])).toEqual([uuid(3)]);
  // A keepalive flush during the flight makes the follow-up keepalive.
  expect(server.calls[1]?.keepalive).toBe(true);
  server.calls[1]?.answer({ ok: true, value: { recorded: 1, duplicates: 0, rejected: [] } });
  await clock.advance(60_000);
  expect(server.calls).toHaveLength(2);
  expect(clock.pending()).toBe(0);
});

test('reporter: records flush 5 s after the first', async () => {
  const { clock, server, reporter } = setup();
  reporter.record(started());
  await clock.advance(3_000);
  reporter.record(solved());
  await clock.advance(1_999);
  // A later record does not push the send back.
  expect(server.calls).toHaveLength(0);
  await clock.advance(1);
  expect(server.calls).toHaveLength(1);
  expect(server.calls[0]?.at).toBe(5_000);
  expect(idsOf(server.calls[0])).toEqual([uuid(1), uuid(2)]);

  await clock.advance(1_000);
  reporter.record(completed());
  await clock.advance(4_999);
  expect(server.calls).toHaveLength(1);
  await clock.advance(1);
  expect(server.calls).toHaveLength(2);
  expect(server.calls[1]?.at).toBe(11_000);
  expect(idsOf(server.calls[1])).toEqual([uuid(3)]);
});

test('reporter: 429 waits retry-after', async () => {
  const { clock, server, reporter } = setup(fail(httpError(429, 600)));
  reporter.record(ending());
  await clock.advance(0);
  expect(server.calls).toHaveLength(1);

  // The wait governs: neither an ending nor a flush sends before it ends.
  reporter.record(ending('ashes'));
  reporter.flush();
  reporter.flush({ keepalive: true });
  await clock.advance(599_999);
  expect(server.calls).toHaveLength(1);
  server.script = fail(httpError(429, 10_000_000));
  await clock.advance(1);
  expect(server.calls).toHaveLength(2);
  expect(server.calls[1]?.at).toBe(600_000);
  expect(idsOf(server.calls[1])).toEqual([uuid(1), uuid(2)]);

  // A huge Retry-After is capped at an hour.
  await clock.advance(3_599_999);
  expect(server.calls).toHaveLength(2);
  server.script = okAll;
  await clock.advance(1);
  expect(server.calls).toHaveLength(3);
  expect(server.calls[2]?.at).toBe(4_200_000);
  expect(idsOf(server.calls[2])).toEqual([uuid(1), uuid(2)]);

  // No Retry-After: the backoff.
  const b = setup(fail(httpError(429, null)));
  b.reporter.record(ending());
  await b.clock.advance(4_999);
  expect(b.server.calls).toHaveLength(1);
  b.server.script = okAll;
  await b.clock.advance(1);
  expect(b.server.calls).toHaveLength(2);
  expect(b.server.calls[1]?.at).toBe(5_000);
});

test('reporter: 400 drops the batch', async () => {
  const { clock, server, reporter, logs } = setup(fail(httpError(400)));
  reporter.record(started());
  reporter.record(ending());
  await clock.advance(0);
  expect(idsOf(server.calls[0])).toEqual([uuid(1), uuid(2)]);
  expect(logs.some((l) => l.includes('400'))).toBe(true);
  await clock.advance(3_600_000);
  expect(server.calls).toHaveLength(1);
  expect(clock.pending()).toBe(0);

  server.script = okAll;
  reporter.record(completed());
  await clock.advance(FLUSH_DELAY_MS);
  expect(server.calls).toHaveLength(2);
  expect(idsOf(server.calls[1])).toEqual([uuid(3)]);

  server.script = fail(httpError(413));
  reporter.record(ending());
  await clock.advance(0);
  expect(idsOf(server.calls[2])).toEqual([uuid(4)]);
  expect(logs.some((l) => l.includes('413'))).toBe(true);
  await clock.advance(3_600_000);
  expect(server.calls).toHaveLength(3);

  server.script = okAll;
  reporter.record(ending('ashes'));
  await clock.advance(0);
  expect(idsOf(server.calls[3])).toEqual([uuid(5)]);
});

test('reporter: rejected events are dropped', async () => {
  const { clock, server, reporter, logs } = setup((c) => ({
    ok: true,
    value: {
      recorded: 1,
      duplicates: 0,
      rejected: [
        { eventId: c.events[2]?.eventId ?? '', reason: 'unknown_ending' },
        { eventId: c.events[1]?.eventId ?? '', reason: 'rate_limited' },
      ],
    },
  }));
  reporter.record(started());
  reporter.record(solved());
  reporter.record(ending('nope'));
  await clock.advance(0);
  expect(idsOf(server.calls[0])).toEqual([uuid(1), uuid(2), uuid(3)]);
  await clock.advance(3_600_000);
  expect(server.calls).toHaveLength(1);
  expect(clock.pending()).toBe(0);
  expect(logs.some((l) => l.includes(`${uuid(3)} unknown_ending`))).toBe(true);
  expect(logs.some((l) => l.includes(`${uuid(2)} rate_limited`))).toBe(true);
});

test('reporter: failure never throws', async () => {
  // A throwing `newId` drops that event; a throwing `log` is ignored.
  {
    const clock = new FakeClock();
    const server = fakeServer(clock, okAll);
    let n = 0;
    const reporter = createStatsReporter({
      api: server.api,
      device: null,
      clock,
      newId: () => {
        n += 1;
        if (n === 1) {
          throw new Error('no randomness');
        }
        return uuid(n);
      },
      log: () => {
        throw new Error('log broke');
      },
    });
    expect(() => reporter.record(ending())).not.toThrow();
    await clock.advance(FLUSH_DELAY_MS);
    expect(server.calls).toHaveLength(0);
    expect(clock.pending()).toBe(0);
    expect(() => reporter.record(ending())).not.toThrow();
    expect(idsOf(server.calls[0])).toEqual([uuid(2)]);
  }

  // An endpoint that throws or rejects is a transient failure: retried with the same ids.
  {
    const { clock, server, reporter } = setup(() => 'throw');
    expect(() => reporter.record(ending())).not.toThrow();
    await clock.advance(0);
    expect(server.calls).toHaveLength(1);
    server.script = () => 'reject';
    await clock.advance(4_999);
    expect(server.calls).toHaveLength(1);
    await clock.advance(1);
    expect(idsOf(server.calls[1])).toEqual([uuid(1)]);
    server.script = okAll;
    await clock.advance(9_999);
    expect(server.calls).toHaveLength(2);
    await clock.advance(1);
    expect(idsOf(server.calls[2])).toEqual([uuid(1)]);
  }

  // DeviceStorage that answers an error, rejects or throws: memory only, the events still sent.
  const refused: Result<never, TgError> = { ok: false, error: { kind: 'storage', detail: 'full' } };
  for (const broken of ['error', 'reject', 'throw'] as const) {
    const answer = (): Promise<Result<never, TgError>> => {
      if (broken === 'throw') {
        throw new Error('no storage');
      }
      return broken === 'reject' ? Promise.reject(new Error('no storage')) : Promise.resolve(refused);
    };
    const device: DeviceStore = { get: answer, set: answer };
    const { clock, server, reporter } = setup(okAll, { device });
    await tick();
    expect(() => reporter.record(ending())).not.toThrow();
    expect(idsOf(server.calls[0]), broken).toEqual([uuid(1)]);
    await clock.advance(0);
    expect(clock.pending()).toBe(0);
  }

  // A failed read leaves the key alone for the page: writing over it could erase the last session's events.
  {
    const written: (string | null)[] = [];
    const device: DeviceStore = {
      get: () => Promise.resolve(refused),
      set: (_k, v) => {
        written.push(v);
        return Promise.resolve({ ok: true, value: undefined });
      },
    };
    const { clock, server, reporter } = setup(fail(NETWORK), { device });
    await tick();
    reporter.record(started());
    reporter.record(ending());
    await clock.advance(FLUSH_DELAY_MS);
    expect(server.calls).toHaveLength(2);
    expect(written).toEqual([]);
  }

  // A failed write is that write only: the next change is written again.
  {
    const written: (string | null)[] = [];
    let refuse = true;
    const device: DeviceStore = {
      get: () => Promise.resolve({ ok: true, value: null }),
      set: (_k, v) => {
        if (refuse) {
          refuse = false;
          return Promise.resolve(refused);
        }
        written.push(v);
        return Promise.resolve({ ok: true, value: undefined });
      },
    };
    const { reporter } = setup(fail(NETWORK), { device });
    await tick();
    reporter.record(started());
    await tick();
    reporter.record(completed());
    await tick();
    expect(written.at(-1)).toContain(uuid(1));
    expect(written.at(-1)).toContain(uuid(2));
  }

  // The session ended for the page: no further request and no timer; the calls still return.
  {
    const { clock, server, reporter } = setup(fail({ kind: 'session-expired' }));
    reporter.record(ending());
    await clock.advance(0);
    expect(server.calls).toHaveLength(1);
    expect(clock.pending()).toBe(0);
    expect(() => {
      reporter.record(started());
      reporter.record(ending('ashes'));
      reporter.flush();
      reporter.flush({ keepalive: true });
    }).not.toThrow();
    expect(clock.pending()).toBe(0);
    await clock.advance(3_600_000);
    expect(server.calls).toHaveLength(1);
  }
});

test('reporter: dispose clears timers', async () => {
  // The 5 s timer.
  {
    const { clock, server, reporter } = setup();
    reporter.record(started());
    expect(clock.pending()).toBe(1);
    reporter.dispose();
    expect(clock.pending()).toBe(0);
    await clock.advance(60_000);
    expect(server.calls).toHaveLength(0);
    // Calls after dispose are no-ops.
    reporter.record(started());
    reporter.record(ending());
    reporter.flush({ keepalive: true });
    expect(clock.pending()).toBe(0);
    expect(server.calls).toHaveLength(0);
  }

  // A backoff.
  {
    const { clock, server, reporter } = setup(fail(NETWORK));
    reporter.record(ending());
    await clock.advance(0);
    expect(clock.pending()).toBe(1);
    reporter.dispose();
    expect(clock.pending()).toBe(0);
    await clock.advance(600_000);
    expect(server.calls).toHaveLength(1);
  }

  // A 429 wait.
  {
    const { clock, server, reporter } = setup(fail(httpError(429, 600)));
    reporter.record(ending());
    await clock.advance(0);
    expect(clock.pending()).toBe(1);
    reporter.dispose();
    expect(clock.pending()).toBe(0);
    await clock.advance(3_600_000);
    expect(server.calls).toHaveLength(1);
  }

  // A late answer arms nothing.
  {
    const { clock, server, reporter } = setup(hang);
    reporter.record(ending());
    reporter.record(started());
    reporter.dispose();
    server.calls[0]?.answer({ ok: true, value: { recorded: 1, duplicates: 0, rejected: [] } });
    await clock.advance(0);
    expect(clock.pending()).toBe(0);
    await clock.advance(60_000);
    expect(server.calls).toHaveLength(1);

    const late = setup(hang);
    late.reporter.record(ending());
    late.reporter.dispose();
    late.server.calls[0]?.answer({ ok: false, error: NETWORK });
    await late.clock.advance(0);
    expect(late.clock.pending()).toBe(0);
  }

  // A late 200 writes nothing: the unsent copy stays for the next launch.
  {
    const dev = fakeDevice();
    const { clock, server, reporter } = setup(hang, { device: dev.device });
    await tick();
    reporter.record(ending());
    await tick();
    expect(dev.stored()).toEqual([uuid(1)]);
    const sets = dev.sets();
    reporter.dispose();
    server.calls[0]?.answer({ ok: true, value: { recorded: 1, duplicates: 0, rejected: [] } });
    await clock.advance(60_000);
    expect(dev.sets()).toBe(sets);
    expect(dev.stored()).toEqual([uuid(1)]);
  }
});

test('reporter: choice event carries the option line id', async () => {
  const { clock, server, reporter } = setup();
  reporter.record({ kind: 'choice_made', chapterId: CH, storyVersion: SV, option: 'ch1.intro.a1b2' as LineId });
  reporter.record(solved());
  reporter.record(started());
  reporter.record(completed());
  await clock.advance(1_200);
  reporter.record(ending('truth'));
  const sent = [...(server.calls[0]?.events ?? [])].sort((a, b) => a.eventId.localeCompare(b.eventId));
  expect(sent[0]?.subject).toBe('ch1.intro.a1b2');
  expect(sent).toEqual([
    { eventId: uuid(1), kind: 'choice_made', chapterId: 'ch1', storyVersion: SV, subject: 'ch1.intro.a1b2', outcome: null, ageMs: 1_200 },
    { eventId: uuid(2), kind: 'puzzle_ended', chapterId: 'ch1', storyVersion: SV, subject: 'ch1.drawer', outcome: 'solved', ageMs: 1_200 },
    { eventId: uuid(3), kind: 'chapter_started', chapterId: 'ch1', storyVersion: SV, subject: null, outcome: null, ageMs: 1_200 },
    { eventId: uuid(4), kind: 'chapter_completed', chapterId: 'ch1', storyVersion: SV, subject: null, outcome: null, ageMs: 1_200 },
    { eventId: uuid(5), kind: 'ending_reached', chapterId: 'ch1', storyVersion: SV, subject: 'truth', outcome: null, ageMs: 0 },
  ]);
  // Exactly StatEventDto's keys: the server answers an unknown field (a `storyId`, say) with a 400 for the batch.
  for (const e of sent) {
    expect(Object.keys(e).sort()).toEqual(['ageMs', 'chapterId', 'eventId', 'kind', 'outcome', 'storyVersion', 'subject']);
  }
});

test('reporter: batch sends facts first', async () => {
  const { clock, server, reporter } = setup();
  for (let i = 1; i <= 40; i += 1) {
    reporter.record(choice(`ch1.intro.c${i}`));
  }
  reporter.record(ending());
  expect(server.calls).toHaveLength(1);
  expect(server.calls[0]?.events[0]?.kind).toBe('ending_reached');
  expect(idsOf(server.calls[0])).toEqual([uuid(41), ...uuids(1, 31)]);
  await clock.advance(0);
  expect(server.calls).toHaveLength(2);
  expect(idsOf(server.calls[1])).toEqual(uuids(32, 40));
});

test('reporter: keepalive flush stays within 16 KiB', async () => {
  // The two `pagehide` requests share the 64 KiB keepalive quota; raising the save cap must fail here.
  expect(STATS_BODY_MAX).toBe(16_384);
  expect(STATS_BODY_MAX + KEEPALIVE_BODY_MAX).toBe(65_536);

  {
    const { clock, server, reporter } = setup();
    for (let i = 0; i < 32; i += 1) {
      reporter.record(choice(longOption(600)));
    }
    reporter.flush({ keepalive: true });
    const first = server.calls[0];
    expect(first?.keepalive).toBe(true);
    expect(bodyBytes(first?.events ?? [])).toBeLessThanOrEqual(STATS_BODY_MAX);
    expect(first?.events.length).toBeLessThan(32);
    await clock.advance(0);
    expect(server.calls).toHaveLength(2);
    expect(bodyBytes(server.calls[1]?.events ?? [])).toBeLessThanOrEqual(STATS_BODY_MAX);
    expect(server.calls.flatMap(idsOf)).toEqual(uuids(1, 32));
  }

  // The boundary: 20 events of exactly 16,384 B go as one batch; one byte more leaves the 20th for the next.
  for (const extra of [0, 1]) {
    const { clock, server, reporter } = setup();
    const at = (subject: string, n: number): StatEventDto => ({
      eventId: uuid(n),
      kind: 'choice_made',
      chapterId: 'ch1',
      storyVersion: SV,
      subject,
      outcome: null,
      ageMs: 0,
    });
    const head = Array.from({ length: 19 }, (_, i) => at(longOption(660), i + 1));
    const short = longOption(1);
    const pad = STATS_BODY_MAX - bodyBytes([...head, at(short, 20)]);
    const twentieth = longOption(1 + pad + extra);
    expect(bodyBytes([...head, at(twentieth, 20)])).toBe(STATS_BODY_MAX + extra);
    for (const e of head) {
      reporter.record(choice(e.subject ?? ''));
    }
    reporter.record(choice(twentieth));
    reporter.record(choice('ch1.intro.c21'));
    reporter.flush();
    expect(server.calls[0]?.events).toHaveLength(20 - extra);
    expect(bodyBytes(server.calls[0]?.events ?? [])).toBe(extra === 0 ? STATS_BODY_MAX : bodyBytes(head));
    await clock.advance(0);
    expect(idsOf(server.calls[1])).toEqual(uuids(21 - extra, 21));
  }

  // An event too large for any batch is dropped, never retried, and the rest still go.
  {
    const { clock, server, reporter, logs } = setup();
    reporter.record(choice('ch1.intro.c1'));
    reporter.record(choice(longOption(STATS_BODY_MAX)));
    reporter.record(choice('ch1.intro.c3'));
    reporter.flush();
    expect(idsOf(server.calls[0])).toEqual([uuid(1), uuid(3)]);
    expect(logs.some((l) => l.includes(uuid(2)))).toBe(true);
    await clock.advance(3_600_000);
    expect(server.calls).toHaveLength(1);
  }
});

test('reporter: queue capped at 64 drops oldest', async () => {
  const { clock, server, reporter } = setup();
  for (let i = 1; i <= 65; i += 1) {
    reporter.record(choice(`ch1.intro.c${i}`));
  }
  await clock.advance(FLUSH_DELAY_MS);
  expect(server.calls.flatMap(idsOf)).toEqual(uuids(2, 65));
  await clock.advance(3_600_000);
  expect(server.calls.flatMap(idsOf)).toEqual(uuids(2, 65));

  // With no choice queued, the oldest event goes.
  const facts = setup();
  for (let i = 0; i < STATS_QUEUE_MAX + 1; i += 1) {
    facts.reporter.record(started());
  }
  await facts.clock.advance(FLUSH_DELAY_MS);
  expect(facts.server.calls.flatMap(idsOf)).toEqual(uuids(2, 65));
});

test('reporter: queue full of choices keeps ending_reached', async () => {
  const { clock, server, reporter } = setup(fail(NETWORK));
  reporter.record(ending());
  await clock.advance(0);
  expect(idsOf(server.calls[0])).toEqual([uuid(1)]);
  for (let i = 1; i <= 64; i += 1) {
    reporter.record(choice(`ch1.intro.c${i}`));
  }
  server.script = okAll;
  await clock.advance(FLUSH_DELAY_MS);
  const sent = server.calls.slice(1).flatMap(idsOf);
  // The 65th record evicted the oldest choice (c1), never the ending.
  expect([...sent].sort()).toEqual([uuid(1), ...uuids(3, 65)]);
  expect(sent[0]).toBe(uuid(1));
});

test('reporter: events older than 30 days are dropped', async () => {
  // Exactly 30 days old is sent; 1 ms older is not (the server refuses the whole batch for it).
  {
    const { clock, server, reporter, logs } = setup();
    reporter.record(started());
    clock.jump(1);
    reporter.record(completed());
    clock.jump(STATS_AGE_MS_MAX);
    await clock.advance(0);
    expect(server.calls).toHaveLength(1);
    expect(idsOf(server.calls[0])).toEqual([uuid(2)]);
    expect(server.calls[0]?.events[0]?.ageMs).toBe(2_592_000_000);
    expect(logs.some((l) => l.includes(uuid(1)))).toBe(true);
    await clock.advance(3_600_000);
    expect(server.calls).toHaveLength(1);
  }

  // Only too-old events: no request at all.
  {
    const { clock, server, reporter } = setup();
    reporter.record(started());
    reporter.record(completed());
    clock.jump(STATS_AGE_MS_MAX + 1);
    await clock.advance(0);
    reporter.flush();
    await clock.advance(3_600_000);
    expect(server.calls).toHaveLength(0);
    expect(clock.pending()).toBe(0);
  }

  // A clock set back dates the event after `now`: age 0, never a negative age.
  {
    const { server, reporter, clock } = setup();
    clock.jump(1_000_000);
    reporter.record(started());
    clock.jump(-60_000);
    reporter.flush();
    expect(server.calls[0]?.events[0]?.ageMs).toBe(0);
  }
});

test('reporter: queue survives reload through device storage', async () => {
  const dev = fakeDevice();
  const clock = new FakeClock();
  // A records offline, then the page goes away.
  const a = setup(fail(NETWORK), { device: dev.device, clock });
  await tick();
  a.reporter.record(started());
  a.reporter.record(solved());
  await clock.advance(FLUSH_DELAY_MS);
  expect(a.server.calls).toHaveLength(1);
  expect(dev.stored()).toEqual([uuid(1), uuid(2)]);
  a.reporter.dispose();
  expect(dev.stored()).toEqual([uuid(1), uuid(2)]);

  // B records before its read answers: nothing is written over A's events, and nothing is sent yet.
  const release = dev.holdReads();
  const b = setup(okAll, { device: dev.device, clock, firstId: 101 });
  b.reporter.record(completed());
  const sets = dev.sets();
  await clock.advance(10_000);
  expect(b.server.calls).toHaveLength(0);
  expect(dev.sets()).toBe(sets);
  expect(dev.stored()).toEqual([uuid(1), uuid(2)]);

  // After the read: one request at once, the stored events first; its 200 removes the key.
  release();
  await clock.advance(0);
  await clock.advance(0);
  expect(b.server.calls).toHaveLength(1);
  expect(b.server.calls[0]?.at).toBe(15_000);
  expect(idsOf(b.server.calls[0])).toEqual([uuid(1), uuid(2), uuid(101)]);
  expect(dev.calls.at(-1)).toEqual({ op: 'set', key: STATS_QUEUE_KEY, value: null });
  expect(dev.map.has(STATS_QUEUE_KEY)).toBe(false);
  b.reporter.dispose();

  // A then B again: B ages and caps the merged queue at load.
  {
    const dev2 = fakeDevice();
    const clock2 = new FakeClock();
    const a2 = setup(hang, { device: dev2.device, clock: clock2 });
    await tick();
    a2.reporter.record(started());
    clock2.jump(STATS_AGE_MS_MAX);
    for (let i = 2; i <= STATS_QUEUE_MAX; i += 1) {
      a2.reporter.record(choice(`ch1.intro.c${i}`));
    }
    await tick();
    expect(dev2.stored()).toEqual(uuids(1, 64));
    a2.reporter.dispose();
    clock2.jump(1);

    const release2 = dev2.holdReads();
    const b2 = setup(okAll, { device: dev2.device, clock: clock2, firstId: 101 });
    b2.reporter.record(choice('ch1.intro.b1'));
    b2.reporter.record(choice('ch1.intro.b2'));
    const before = dev2.sets();
    release2();
    await clock2.advance(0);
    await clock2.advance(0);
    // The 30-days-and-1-ms `chapter_started` is gone, then the 65th event evicted the oldest choice.
    const written = dev2.calls.filter((c) => c.op === 'set')[before];
    const events = written?.op === 'set' && written.value !== null ? (JSON.parse(written.value) as { events: unknown[] }).events : [];
    expect(events).toHaveLength(64);
    expect(b2.server.calls.flatMap(idsOf)).toEqual([...uuids(3, 64), uuid(101), uuid(102)]);
    b2.reporter.dispose();
  }

  // No DeviceStorage (below Bot API 9.0): nothing to wait for; the queue lives in memory.
  const none = setup(okAll, { device: null });
  none.reporter.record(ending());
  expect(idsOf(none.server.calls[0])).toEqual([uuid(1)]);
});
