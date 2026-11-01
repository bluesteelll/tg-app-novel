import { expect, test } from 'vitest';

import type { Endpoints } from '../api/endpoints.ts';
import type { PutSaveRequest, PutSaveResponse, SaveFull, SaveListResponse, SaveSlot, SaveSummary } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { Result, StoryId } from '../story/catalog.ts';
import type { ChapterId, LineId, StoryVersion } from '../story/staging.ts';
import type { TgError } from '../telegram/index.ts';
import { decodePending, encodePending } from './pending.ts';
import type { DeviceStore, PendingEntry } from './pending.ts';
import { KEEPALIVE_BODY_MAX, createSaveService, summaryOf } from './service.ts';
import type { SaveService, SaveState, SaveWrite } from './service.ts';

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

const SAVED_AT = 1_800_000_000;
const manor = 'manor' as StoryId;
const tide = 'tide' as StoryId;

/** The facade's DeviceStorage over a map; while `held` is set, non-null writes wait there for `release()`. */
class FakeDevice implements DeviceStore {
  readonly items = new Map<string, string>();
  readonly calls: Array<readonly [op: 'get' | 'set', key: string, value: string | null]> = [];
  held: Array<() => void> | null = null;
  readonly log: string[];

  constructor(log: string[] = []) {
    this.log = log;
  }

  get = async (k: string): Promise<Result<string | null, TgError>> => {
    this.calls.push(['get', k, null]);
    return { ok: true, value: this.items.get(k) ?? null };
  };
  set = (k: string, v: string | null): Promise<Result<void, TgError>> => {
    this.calls.push(['set', k, v]);
    this.log.push(`device.set ${k}`);
    const apply = (): Result<void, TgError> => {
      if (v === null) {
        this.items.delete(k);
      } else {
        this.items.set(k, v);
      }
      return { ok: true, value: undefined };
    };
    const held = this.held;
    if (held !== null && v !== null) {
      return new Promise((resolve) => held.push(() => resolve(apply())));
    }
    return Promise.resolve(apply());
  };
  release(): void {
    const held = this.held ?? [];
    this.held = null;
    for (const fn of held) {
      fn();
    }
  }
  /** The decoded entries written to `key`, oldest first (`null` = a clear). */
  writes(key: string): Array<PendingEntry | null> {
    return this.calls.filter(([op, k]) => op === 'set' && k === key).map(([, , v]) => (v === null ? null : decodePending(v)));
  }
}

type Row = SaveSummary & { body: string };
/** One scripted PUT: wait for `gate`, then answer normally, or lose the answer after storing ('lost'), or never store ('down'). */
type Step = { gate?: Promise<void>; then?: 'lost' | 'down' };
type Put = { story: string; slot: SaveSlot; req: PutSaveRequest; keepalive: boolean; at: number };

const networkDown: ApiError = { kind: 'network', detail: 'offline' };

/** PROTOTYPE-PLAN "HTTP API" PUT contract per (story, slot): the same writeId replays 200; another expectedRev is 409. */
class FakeSaves implements Pick<Endpoints, 'getSave' | 'putSave'> {
  readonly rows = new Map<string, Row>();
  readonly puts: Put[] = [];
  script: Step[] = [];
  inFlight = 0;
  maxInFlight = 0;

  /** Stamps each PUT. */
  readonly clock: FakeClock | null;
  /** The order of PUTs and device calls across both fakes. */
  readonly log: string[];

  constructor(clock: FakeClock | null = null, log: string[] = []) {
    this.clock = clock;
    this.log = log;
  }

  seed(story: string, slot: SaveSlot, rev: number, writeId: string, body = '{}'): Row {
    const row: Row = { storyId: story, slot, rev, chapterId: 'ch1', storyVersion: 'v1', lineId: null, savedAt: SAVED_AT, writeId, body };
    this.rows.set(`${story}/${slot}`, row);
    return row;
  }
  summary(story: string, slot: SaveSlot): SaveSummary | null {
    const row = this.rows.get(`${story}/${slot}`);
    if (row === undefined) {
      return null;
    }
    const { body: _body, ...summary } = row;
    return summary;
  }
  getSave = async (story: StoryId, slot: SaveSlot): Promise<Result<SaveFull, ApiError>> => {
    const row = this.rows.get(`${story}/${slot}`);
    const summary = this.summary(story, slot);
    return row !== undefined && summary !== null
      ? { ok: true, value: { summary, body: row.body } }
      : { ok: false, error: { kind: 'http', status: 404, code: 'not_found', body: { error: 'not_found' }, retryAfter: null } };
  };
  putSave = async (story: StoryId, slot: SaveSlot, req: PutSaveRequest, o?: { keepalive?: boolean }): Promise<Result<PutSaveResponse, ApiError>> => {
    this.puts.push({ story, slot, req, keepalive: o?.keepalive === true, at: this.clock?.now() ?? 0 });
    this.log.push(`put ${story}/${slot}`);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const step = this.script.shift() ?? {};
    try {
      if (step.gate !== undefined) {
        await step.gate;
      }
      if (step.then === 'down') {
        return { ok: false, error: networkDown };
      }
      const r = this.apply(story, slot, req);
      return step.then === 'lost' ? { ok: false, error: networkDown } : r;
    } finally {
      this.inFlight -= 1;
    }
  };
  apply(story: string, slot: SaveSlot, req: PutSaveRequest): Result<PutSaveResponse, ApiError> {
    const row = this.rows.get(`${story}/${slot}`);
    if (row !== undefined && row.writeId === req.writeId) {
      return { ok: true, value: { rev: row.rev, savedAt: row.savedAt } };
    }
    if ((row?.rev ?? null) !== req.expectedRev) {
      const current = this.summary(story, slot);
      return {
        ok: false,
        error: {
          kind: 'http',
          status: 409,
          code: 'save_conflict',
          body: current === null ? { error: 'save_conflict' } : { error: 'save_conflict', current },
          retryAfter: null,
        },
      };
    }
    const next = this.seed(story, slot, (row?.rev ?? 0) + 1, req.writeId, req.body);
    return { ok: true, value: { rev: next.rev, savedAt: next.savedAt } };
  }
}

function write(n: number, body = `{"n":${n}}`): SaveWrite {
  return { chapterId: 'ch1' as ChapterId, storyVersion: 'v1' as StoryVersion, lineId: `ch1.k1.l${n}` as LineId, body };
}

function summary(story: string, slot: SaveSlot, rev: number, writeId: string): SaveSummary {
  return { storyId: story, slot, rev, chapterId: 'ch1', storyVersion: 'v1', lineId: null, savedAt: SAVED_AT, writeId };
}

const list = (...slots: SaveSummary[]): SaveListResponse => ({ slots });

/** Deterministic write ids: w1, w2, … */
function ids(prefix = 'w'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function service(api: FakeSaves, clock: FakeClock, story = manor, device: DeviceStore | null = null): { s: SaveService; states: SaveState[] } {
  const s = createSaveService({ api, device, clock, story, newId: ids() });
  const states: SaveState[] = [];
  s.onState((st) => states.push(st));
  return { s, states };
}

const sent = (srv: FakeSaves) => srv.puts.map((p) => [p.slot, p.req.writeId, p.req.expectedRev]);

test('saves: 409 pauses autosave', async () => {
  const srv = new FakeSaves();
  const theirs = srv.seed('manor', 'auto', 5, 'other-device');
  const clock = new FakeClock();
  const { s } = service(srv, clock);
  expect(await s.start(list(summary('manor', 'auto', 3, 'w0')))).toEqual({ ok: true, value: undefined });
  s.autosave(write(1));
  await settle();
  const { body: _b, ...current } = theirs;
  expect(s.state()).toEqual({ kind: 'paused', current });
  // Paused: nothing is sent until the player chooses, however long the session runs.
  s.autosave(write(2));
  s.autosave(write(3));
  await clock.advance(60_000);
  expect(sent(srv)).toEqual([['auto', 'w1', 3]]);

  s.resolveConflict('keep-here');
  await settle();
  expect(sent(srv)).toEqual([
    ['auto', 'w1', 3],
    ['auto', 'w3', 5],
  ]);
  expect(srv.puts[1]?.req.body).toBe(write(3).body);
  expect(s.state()).toEqual({ kind: 'idle' });
  expect(srv.rows.get('manor/auto')?.rev).toBe(6);

  // A 409 without `current` (the slot has no row): one re-PUT that creates it, no prompt.
  const empty = new FakeSaves();
  const second = service(empty, new FakeClock());
  await second.s.start(list(summary('manor', 'auto', 2, 'w0')));
  second.s.autosave(write(1));
  await settle();
  expect(sent(empty)).toEqual([
    ['auto', 'w1', 2],
    ['auto', 'w1', null],
  ]);
  expect(second.s.state()).toEqual({ kind: 'idle' });
  expect(second.states.some((st) => st.kind === 'paused')).toBe(false);
});

test('saves: retried write with same writeId is success', async () => {
  const srv = new FakeSaves();
  srv.seed('manor', 'auto', 3, 'w0');
  srv.script = [{ then: 'lost' }];
  const clock = new FakeClock();
  const { s, states } = service(srv, clock);
  await s.start(list(summary('manor', 'auto', 3, 'w0')));
  s.autosave(write(1));
  await settle();
  expect(s.state()).toEqual({ kind: 'retrying', attempt: 1, inMs: 1000 });
  await clock.advance(1000);
  // The first attempt landed (rev 4) but its answer was lost: the retry replays w1 and gets the stored rev.
  expect(sent(srv)).toEqual([
    ['auto', 'w1', 3],
    ['auto', 'w1', 3],
  ]);
  expect(srv.rows.get('manor/auto')).toMatchObject({ rev: 4, writeId: 'w1' });
  expect(s.state()).toEqual({ kind: 'idle' });
  expect(states.some((st) => st.kind === 'paused' || st.kind === 'failed')).toBe(false);
});

test('saves: lost response then newer body is not a conflict', async () => {
  const srv = new FakeSaves();
  srv.seed('manor', 'auto', 3, 'w0');
  const first = deferred<void>();
  srv.script = [{ gate: first.promise, then: 'lost' }];
  const clock = new FakeClock();
  const { s, states } = service(srv, clock);
  await s.start(list(summary('manor', 'auto', 3, 'w0')));
  s.autosave(write(1));
  s.autosave(write(2));
  first.resolve();
  await settle();
  // W1 landed as rev 4, its answer lost; B goes out as w2 against rev 3 and meets our own w1.
  await clock.advance(1000);
  // One device never conflicts with itself: no prompt at any point.
  expect(states.filter((st) => st.kind === 'paused')).toEqual([]);
  expect(s.state()).toEqual({ kind: 'idle' });
  expect(sent(srv)).toEqual([
    ['auto', 'w1', 3],
    ['auto', 'w2', 3],
    ['auto', 'w2', 4],
  ]);
  expect(srv.rows.get('manor/auto')).toMatchObject({ rev: 5, writeId: 'w2', body: write(2).body });
});

test('saves_one_in_flight', async () => {
  const srv = new FakeSaves();
  const gate = deferred<void>();
  srv.script = [{ gate: gate.promise }];
  const clock = new FakeClock();
  const { s } = service(srv, clock);
  await s.start(list());
  s.autosave(write(1));
  s.autosave(write(2));
  s.autosave(write(3));
  await settle();
  expect(srv.puts).toHaveLength(1);
  gate.resolve();
  await settle();
  // A answered: only the newest queued body follows; B was superseded.
  expect(srv.puts.map((p) => p.req.body)).toEqual([write(1).body, write(3).body]);
  expect(srv.maxInFlight).toBe(1);
  expect(s.state()).toEqual({ kind: 'idle' });
  expect(clock.pending()).toBe(0);
});

test('saves: manual 409 asks to overwrite', async () => {
  const srv = new FakeSaves();
  const theirs = srv.seed('manor', 's1', 2, 'other-device');
  const clock = new FakeClock();
  const { s, states } = service(srv, clock);
  await s.start(list());
  const { body: _b, ...current } = theirs;
  expect(await s.save('s1', write(1))).toEqual({ ok: false, error: { kind: 'conflict', current } });
  expect(await s.overwrite('s1', write(1), current)).toEqual({ ok: true, value: { rev: 3, savedAt: SAVED_AT } });
  expect(sent(srv)).toEqual([
    ['s1', 'w1', null],
    ['s1', 'w2', 2],
  ]);
  // A manual conflict never pauses autosave.
  s.autosave(write(2));
  await settle();
  expect(sent(srv)[2]).toEqual(['auto', 'w3', null]);
  expect(s.state()).toEqual({ kind: 'idle' });
  expect(states.some((st) => st.kind === 'paused')).toBe(false);
});

const started = { ok: true, value: undefined };

test('saves: reload uploads pending when server writeId is ours', async () => {
  // The server holds w4 (rev 4), an earlier write of ours; the entry is the newer w5, based on rev 3.
  const srv = new FakeSaves();
  srv.seed('manor', 'auto', 4, 'w4');
  const device = new FakeDevice();
  device.items.set('pending_manor', encodePending({ v: 1, baseRev: 3, sentIds: ['w4', 'w5'], writeId: 'w5', write: write(5) }));
  const { s } = service(srv, new FakeClock(), manor, device);
  expect(await s.start(list(summary('manor', 'auto', 4, 'w4')))).toEqual(started);
  expect(sent(srv)).toEqual([['auto', 'w5', 4]]);
  expect(srv.rows.get('manor/auto')).toMatchObject({ rev: 5, writeId: 'w5', body: write(5).body });
  await settle();
  expect(device.items.has('pending_manor')).toBe(false);
  // Autosave goes on from the uploaded rev.
  s.autosave(write(6));
  await settle();
  expect(sent(srv)[1]).toEqual(['auto', 'w1', 5]);

  // baseRev equal to the server's rev: the server still holds what the entry was based on.
  const same = new FakeSaves();
  same.seed('manor', 'auto', 4, 'other-device');
  const d2 = new FakeDevice();
  d2.items.set('pending_manor', encodePending({ v: 1, baseRev: 4, sentIds: ['w9'], writeId: 'w9', write: write(9) }));
  expect(await service(same, new FakeClock(), manor, d2).s.start(list(summary('manor', 'auto', 4, 'other-device')))).toEqual(started);
  expect(sent(same)).toEqual([['auto', 'w9', 4]]);
  await settle();
  expect(d2.items.has('pending_manor')).toBe(false);

  // A newer rev written by another device: the server wins, and the entry is discarded unsent.
  const theirs = new FakeSaves();
  theirs.seed('manor', 'auto', 5, 'x9');
  const d3 = new FakeDevice();
  d3.items.set('pending_manor', encodePending({ v: 1, baseRev: 3, sentIds: ['w4'], writeId: 'w4', write: write(4) }));
  expect(await service(theirs, new FakeClock(), manor, d3).s.start(list(summary('manor', 'auto', 5, 'x9')))).toEqual(started);
  expect(theirs.puts).toEqual([]);
  await settle();
  expect(d3.items.has('pending_manor')).toBe(false);
});

test('saves: pending entry is per story', async () => {
  const device = new FakeDevice();
  const srv = new FakeSaves();
  srv.seed('manor', 'auto', 2, 'm0');
  srv.seed('tide', 'auto', 2, 't0');
  const boot = list(summary('manor', 'auto', 2, 'm0'), summary('tide', 'auto', 2, 't0'));
  srv.script = [{ then: 'down' }];
  const first = service(srv, new FakeClock(), manor, device);
  await first.s.start(boot);
  first.s.autosave(write(7, '{"manor":7}'));
  await settle();
  first.s.dispose();

  // Another story at the same rev: manor's entry is not its to upload.
  expect(await service(srv, new FakeClock(), tide, device).s.start(boot)).toEqual(started);
  expect(srv.puts.filter((p) => p.story === 'tide')).toEqual([]);
  expect(decodePending(device.items.get('pending_manor') ?? '')).toMatchObject({ baseRev: 2, writeId: 'w1' });
  // manor's next session uploads it, to manor.
  expect(await service(srv, new FakeClock(), manor, device).s.start(boot)).toEqual(started);
  expect(srv.puts.map((p) => [p.story, p.slot, p.req.writeId, p.req.expectedRev, p.req.body])).toEqual([
    ['manor', 'auto', 'w1', 2, '{"manor":7}'],
    ['manor', 'auto', 'w1', 2, '{"manor":7}'],
  ]);
  await settle();
  expect(device.items.has('pending_manor')).toBe(false);
  expect(srv.rows.get('manor/auto')).toMatchObject({ rev: 3, body: '{"manor":7}' });
  expect(srv.rows.get('tide/auto')).toMatchObject({ rev: 2, writeId: 't0' });
});

test('saves: list spans stories', async () => {
  const slots = [summary('tide', 'auto', 7, 't7'), summary('manor', 's1', 2, 'm2'), summary('manor', 'auto', 3, 'm3')];
  for (const order of [slots, [...slots].reverse()]) {
    const boot = list(...order);
    expect(summaryOf(boot, manor, 'auto')).toEqual(slots[2]);
    expect(summaryOf(boot, tide, 'auto')).toEqual(slots[0]);
    expect(summaryOf(boot, manor, 's2')).toBe(null);
    const srv = new FakeSaves();
    srv.seed('tide', 'auto', 7, 't7');
    srv.seed('manor', 's1', 2, 'm2');
    srv.seed('manor', 'auto', 3, 'm3');
    const { s } = service(srv, new FakeClock(), manor);
    expect(await s.start(boot)).toEqual(started);
    s.autosave(write(1));
    await settle();
    expect((await s.save('s1', write(2))).ok).toBe(true);
    expect(sent(srv)).toEqual([
      ['auto', 'w1', 3],
      ['s1', 'w2', 2],
    ]);
    expect(srv.puts.every((p) => p.story === 'manor')).toBe(true);
    // A slot the list does not name is empty: its 404 is a value, not an error.
    expect(await s.load('s2')).toEqual({ ok: true, value: null });
  }
});

test('saves: network failure keeps pending and backs off', async () => {
  const clock = new FakeClock();
  const srv = new FakeSaves(clock);
  srv.seed('manor', 'auto', 3, 'w0');
  srv.script = [{ then: 'down' }, { then: 'down' }, { then: 'down' }, { then: 'down' }];
  const device = new FakeDevice();
  const { s } = service(srv, clock, manor, device);
  await s.start(list(summary('manor', 'auto', 3, 'w0')));
  // From here the device acknowledges a write only on release().
  device.held = [];
  s.autosave(write(1));
  await settle();
  expect(device.writes('pending_manor')).toEqual([{ v: 1, baseRev: 3, sentIds: ['w1'], writeId: 'w1', write: write(1) }]);
  expect(s.state()).toEqual({ kind: 'retrying', attempt: 1, inMs: 1000 });
  await clock.advance(1000 + 2000 + 4000 + 8000);
  expect(srv.puts.map((p) => [p.at, p.req.writeId, p.req.expectedRev])).toEqual([
    [0, 'w1', 3],
    [1000, 'w1', 3],
    [3000, 'w1', 3],
    [7000, 'w1', 3],
    [15_000, 'w1', 3],
  ]);
  expect(s.state()).toEqual({ kind: 'idle' });
  // The clear was issued after the writes, so it lands after them although the device acknowledged them late.
  device.release();
  await settle();
  expect(device.items.has('pending_manor')).toBe(false);
  expect(device.writes('pending_manor').at(-1)).toBe(null);
  s.dispose();
  expect(clock.pending()).toBe(0);

  // No DeviceStorage (below 9.0): the same retries without a cache; dispose in the middle of a backoff.
  const c2 = new FakeClock();
  const srv2 = new FakeSaves(c2);
  srv2.seed('manor', 'auto', 3, 'w0');
  srv2.script = [{ then: 'down' }, { then: 'down' }, { then: 'down' }];
  const two = service(srv2, c2, manor, null);
  await two.s.start(list(summary('manor', 'auto', 3, 'w0')));
  two.s.autosave(write(1));
  await c2.advance(1000 + 2000);
  expect(srv2.puts.map((p) => [p.at, p.req.writeId])).toEqual([
    [0, 'w1'],
    [1000, 'w1'],
    [3000, 'w1'],
  ]);
  expect(two.s.state()).toEqual({ kind: 'retrying', attempt: 3, inMs: 4000 });
  two.s.dispose();
  expect(c2.pending()).toBe(0);
  await c2.advance(60_000);
  expect(srv2.puts).toHaveLength(3);
});

test('saves: autosave during a backoff waits for the timer', async () => {
  const clock = new FakeClock();
  const srv = new FakeSaves(clock);
  srv.seed('manor', 'auto', 3, 'w0');
  srv.script = [{ then: 'down' }];
  const device = new FakeDevice();
  const { s } = service(srv, clock, manor, device);
  await s.start(list(summary('manor', 'auto', 3, 'w0')));
  s.autosave(write(1));
  await clock.advance(10);
  expect(s.state()).toEqual({ kind: 'retrying', attempt: 1, inMs: 1000 });
  // Offline, the next autosave comes long before the network does: it is cached and waits for the timer.
  s.autosave(write(2));
  await clock.advance(10);
  expect(srv.puts.length, 'no PUT before the backoff timer fires').toBe(1);
  expect(s.state()).toEqual({ kind: 'retrying', attempt: 1, inMs: 1000 });
  expect(decodePending(device.items.get('pending_manor') ?? '')).toMatchObject({ baseRev: 3, writeId: 'w2', write: write(2) });
  await clock.advance(1000);
  // The timer sends the newest body; w1 was superseded.
  expect(srv.puts.map((p) => [p.at, p.req.writeId, p.req.expectedRev, p.req.body])).toEqual([
    [0, 'w1', 3, write(1).body],
    [1000, 'w2', 3, write(2).body],
  ]);
  expect(s.state()).toEqual({ kind: 'idle' });
  expect(srv.rows.get('manor/auto')).toMatchObject({ rev: 4, writeId: 'w2', body: write(2).body });
  expect(device.items.has('pending_manor')).toBe(false);
  expect(clock.pending()).toBe(0);
});

test('saves: keepalive put only under the shared quota', async () => {
  // The request JSON around an empty body, in the service's field order; the PUT's real size is checked below.
  const empty = { expectedRev: null, writeId: 'w1', chapterId: 'ch1', storyVersion: 'v1', lineId: 'ch1.k1.l1', body: '' };
  const overhead = new TextEncoder().encode(JSON.stringify(empty)).byteLength;
  const cases: ReadonlyArray<readonly [label: string, body: string, sends: boolean]> = [
    ['exactly the cap', 'a'.repeat(KEEPALIVE_BODY_MAX - overhead), true],
    ['one byte over', 'a'.repeat(KEEPALIVE_BODY_MAX - overhead + 1), false],
    ['25,000 Cyrillic characters, 50,000 bytes', 'я'.repeat(25_000), false],
  ];
  for (const [label, body, sends] of cases) {
    const log: string[] = [];
    const srv = new FakeSaves(null, log);
    const device = new FakeDevice(log);
    const { s } = service(srv, new FakeClock(), manor, device);
    await s.start(list());
    // The device never answers in this test: nothing may wait for it.
    device.held = [];
    s.autosave(write(1, body), { keepalive: true });
    // Synchronously, before any microtask: the cache write is issued first, the PUT right after it.
    expect(log, label).toEqual(sends ? ['device.set pending_manor', 'put manor/auto'] : ['device.set pending_manor']);
    expect(srv.puts.map((p) => p.keepalive), label).toEqual(sends ? [true] : []);
    if (sends) {
      expect(new TextEncoder().encode(JSON.stringify(srv.puts[0]?.req)).byteLength, label).toBe(KEEPALIVE_BODY_MAX);
    }
    expect(device.writes('pending_manor').map((e) => e?.write.body), label).toEqual([body]);
  }
});

test('saves: flush waits for the ack or leaves the pending entry', async () => {
  const clock = new FakeClock();
  const srv = new FakeSaves(clock);
  srv.script = [{ gate: new Promise<void>((resolve) => clock.setTimeout(resolve, 1500)) }];
  const device = new FakeDevice();
  const { s } = service(srv, clock, manor, device);
  await s.start(list());
  s.autosave(write(1));
  let result: string | null = null;
  void s.flush({ timeoutMs: 2000 }).then((r) => {
    result = r;
  });
  await settle();
  expect(device.writes('pending_manor').map((e) => e?.writeId ?? null)).toEqual(['w1']);
  await clock.advance(1499);
  expect(result).toBe(null);
  await clock.advance(1);
  expect(result).toBe('saved');
  expect(device.items.has('pending_manor')).toBe(false);
  expect(clock.pending()).toBe(0);
  expect(await s.flush({ timeoutMs: 2000 })).toBe('saved');

  // A hung PUT: 'pending' at the timeout, with the newest body in the cache.
  const c2 = new FakeClock();
  const srv2 = new FakeSaves(c2);
  srv2.script = [{ gate: new Promise<void>(() => {}) }];
  const d2 = new FakeDevice();
  const two = service(srv2, c2, manor, d2);
  await two.s.start(list());
  two.s.autosave(write(1));
  two.s.autosave(write(2));
  let r2: string | null = null;
  void two.s.flush({ timeoutMs: 2000 }).then((r) => {
    r2 = r;
  });
  await c2.advance(1999);
  expect(r2).toBe(null);
  await c2.advance(1);
  expect(r2).toBe('pending');
  expect(decodePending(d2.items.get('pending_manor') ?? '')).toMatchObject({ writeId: 'w2', write: write(2) });
  two.s.dispose();
  expect(c2.pending()).toBe(0);
});
