import { expect, test } from 'vitest';

import type { PostStatsResponse, StatEventDto } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { EndingName, Result } from '../story/catalog.ts';
import type { ChapterId, PuzzleLocalId, StoryVersion } from '../story/staging.ts';
import { FLUSH_DELAY_MS, createStatsReporter } from './reporter.ts';
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

function counterIds(): () => string {
  let n = 0;
  return () => uuid(++n);
}

function setup(script: Script = okAll) {
  const clock = new FakeClock();
  const server = fakeServer(clock, script);
  const logs: string[] = [];
  const reporter: StatsReporter = createStatsReporter({
    api: server.api,
    clock,
    newId: counterIds(),
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
const idsOf = (c: Call | undefined): string[] => (c === undefined ? [] : c.events.map((e) => e.eventId));

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
});
