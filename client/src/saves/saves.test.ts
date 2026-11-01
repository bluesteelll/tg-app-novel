import { expect, test } from 'vitest';

import type { Endpoints } from '../api/endpoints.ts';
import type { PutSaveRequest, PutSaveResponse, SaveFull, SaveListResponse, SaveSlot, SaveSummary } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { Result, StoryId } from '../story/catalog.ts';
import type { ChapterId, LineId, StoryVersion } from '../story/staging.ts';
import { createSaveService } from './service.ts';
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

type Row = SaveSummary & { body: string };
/** One scripted PUT: wait for `gate`, then answer normally, or lose the answer after storing ('lost'), or never store ('down'). */
type Step = { gate?: Promise<void>; then?: 'lost' | 'down' };
type Put = { story: string; slot: SaveSlot; req: PutSaveRequest; keepalive: boolean };

const networkDown: ApiError = { kind: 'network', detail: 'offline' };

/** PROTOTYPE-PLAN "HTTP API" PUT contract per (story, slot): the same writeId replays 200; another expectedRev is 409. */
class FakeSaves implements Pick<Endpoints, 'getSave' | 'putSave'> {
  readonly rows = new Map<string, Row>();
  readonly puts: Put[] = [];
  script: Step[] = [];
  inFlight = 0;
  maxInFlight = 0;

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
    this.puts.push({ story, slot, req, keepalive: o?.keepalive === true });
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

function service(api: FakeSaves, clock: FakeClock, story = manor): { s: SaveService; states: SaveState[] } {
  const s = createSaveService({ api, clock, story, newId: ids() });
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
