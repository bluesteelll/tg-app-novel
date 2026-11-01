// LP2 puzzle sessions (PUZZLES-PLAN "Module API", X5, X8, F6, F8; META-PLAN M21, M27, F24): attempts against a fake
// server, the attempt limit, the deferred close, give up, and the hint ladder over `getPuzzle` and a fake hint port.
// Every request is a fake that the test settles by hand, so each ordering (double tap, close or dispose before the
// answer) is exact.
import { afterEach, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { Endpoints } from '../api/endpoints.ts';
import type { AttemptResponse, PuzzleStatus } from '../api/generated/api.ts';
import type { ApiError } from '../api/http.ts';
import type { ExploreAction } from '../explore/reduce.ts';
import type { PuzzleRun } from '../explore/state.ts';
import type { Lang } from '../i18n/index.ts';
import type { Result } from '../story/catalog.ts';
import type { ChapterId, PuzzleLocalId } from '../story/staging.ts';
import { decodeWorldPublic } from '../world/decode.ts';
import type { WorldPublic } from '../world/types.ts';
import { createPuzzleSession } from './session.ts';
import type { HintPort, HintPortError, PuzzleEnd, PuzzleMode, PuzzleSession } from './session.ts';

// The Telegram facade with recording storage: a session that reached for CloudStorage or DeviceStorage would write
// here (`hints: texts never written to storage`). session.ts imports nothing from it at runtime.
const storage = vi.hoisted(() => ({ writes: [] as string[] }));
vi.mock('../telegram/index.ts', () => ({
  getTelegram: () => ({
    cloud: {
      get: () => Promise.resolve({ ok: true, value: null }),
      set: (_k: string, v: string) => {
        storage.writes.push(`cloud ${v}`);
        return Promise.resolve({ ok: true, value: undefined });
      },
    },
    device: {
      get: () => Promise.resolve({ ok: true, value: null }),
      set: (_k: string, v: string | null) => {
        storage.writes.push(`device ${String(v)}`);
        return Promise.resolve({ ok: true, value: undefined });
      },
    },
  }),
}));

afterEach(() => {
  storage.writes.length = 0;
  vi.unstubAllGlobals();
});

const CHAPTER = 'ch1' as ChapterId;
const pz = (s: string) => s as PuzzleLocalId;

type RawPuzzle = {
  type: 'code' | 'order';
  params: Record<string, unknown>;
  maxAttempts: number | null;
  giveUp: boolean;
  hintTiers: 0 | 1 | 2 | 3;
};

/** A public world with the puzzle `gate`, decoded by the real decoder. */
function worldWith(over: Partial<RawPuzzle> = {}): WorldPublic {
  const puzzle: RawPuzzle = { type: 'code', params: { dials: 4 }, maxAttempts: null, giveUp: false, hintTiers: 3, ...over };
  const r = decodeWorldPublic({
    format: 1,
    version: '0123456789abcdef',
    items: {},
    docs: {},
    sections: {},
    puzzles: {
      gate: { ...puzzle, title: { id: 'ch1.gate.0001', ru: 'Замок' }, prompt: { id: 'ch1.gate.0002', ru: 'Код' }, closeup: null },
    },
  });
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => {
    throw new Error('invariant: the executor runs synchronously');
  };
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Api = {
  getPuzzle: Mock<Endpoints['getPuzzle']>;
  postAttempt: Mock<Endpoints['postAttempt']>;
};
type FakePort = {
  balance: Mock<HintPort['balance']>;
  tierCost: Mock<HintPort['tierCost']>;
  use: Mock<HintPort['use']>;
  getMore: Mock<HintPort['getMore']>;
};
type Rig = { s: PuzzleSession; api: Api; dispatch: Mock<(a: ExploreAction) => void>; ends: PuzzleEnd[]; port: FakePort };

/** The server's status: tier n unlocked iff `texts` names it. */
function status(solved: boolean, texts: Readonly<Record<number, string>> = {}, tiers = 3): PuzzleStatus {
  return {
    puzzleId: 'ch1.gate',
    solved,
    hints: Array.from({ length: tiers }, (_, i) => ({ tier: i + 1, unlocked: (i + 1) in texts, text: texts[i + 1] ?? null })),
  };
}

function fakePort(balance: number | null = 2, cost: number | null = 1): FakePort {
  return {
    balance: vi.fn(() => balance).mockName('balance'),
    tierCost: vi.fn(() => cost).mockName('tierCost'),
    use: vi.fn<HintPort['use']>(() => Promise.resolve(ok({ text: 'PORT-HINT', balance: 1 }))).mockName('use'),
    getMore: vi.fn().mockName('getMore'),
  };
}

function rig(o: { puzzle?: Partial<RawPuzzle>; mode?: PuzzleMode; run?: Partial<PuzzleRun>; port?: 'none' | FakePort; lang?: Lang } = {}): Rig {
  const api: Api = {
    getPuzzle: vi.fn<Endpoints['getPuzzle']>(() => Promise.resolve(ok(status(false)))).mockName('getPuzzle'),
    postAttempt: vi.fn<Endpoints['postAttempt']>(() => Promise.resolve(ok({ correct: false, solved: false }))).mockName('postAttempt'),
  };
  const port = o.port === undefined || o.port === 'none' ? fakePort() : o.port;
  const dispatch = vi.fn<(a: ExploreAction) => void>().mockName('dispatch');
  const r = createPuzzleSession({
    api,
    hints: o.port === 'none' ? null : port,
    world: worldWith(o.puzzle),
    chapter: CHAPTER,
    puzzle: pz('gate'),
    mode: o.mode ?? 'explore',
    run: { outcome: null, attempts: 0, hintsOpened: 0, ...o.run },
    lang: () => o.lang ?? 'ru',
    dispatch,
  });
  if (!r.ok) {
    throw new Error(`invariant: the fixture puzzle exists: ${JSON.stringify(r.error)}`);
  }
  const ends: PuzzleEnd[] = [];
  r.value.onEnd((e) => ends.push(e));
  return { s: r.value, api, dispatch, ends, port };
}

const WRONG: Result<AttemptResponse, ApiError> = ok({ correct: false, solved: false });
const CORRECT: Result<AttemptResponse, ApiError> = ok({ correct: true, solved: true });
const FAILED_ATTEMPT = { kind: 'attempt-failed', puzzle: 'gate' };

// ---------------------------------------------------------------------------------------------------------------
// Attempts

test('session: double try sends one attempt', async () => {
  const { s, api } = rig();
  const answer = deferred<Result<AttemptResponse, ApiError>>();
  api.postAttempt.mockReturnValueOnce(answer.promise);
  s.setAnswer([1, 2, 3, 4]);
  const first = s.attempt();
  const second = s.attempt();
  expect(api.postAttempt).toHaveBeenCalledTimes(1);
  expect(await second).toEqual(err({ kind: 'busy' }));
  answer.resolve(WRONG);
  expect(await first).toEqual(ok({ kind: 'wrong', attemptsLeft: null }));
  expect(api.postAttempt.mock.calls).toEqual([['ch1.gate', [1, 2, 3, 4], { signal: expect.any(AbortSignal) }]]);
  // Settled: the next Try goes out.
  await s.attempt();
  expect(api.postAttempt).toHaveBeenCalledTimes(2);
});

test('session: max attempts yields failed', async () => {
  // The saved run already used one of two attempts (X8: the counter survives a reload).
  const { s, dispatch, ends } = rig({ puzzle: { maxAttempts: 2 }, run: { attempts: 1 } });
  const result = await s.attempt();
  expect(ends).toEqual([{ outcome: 'failed', hintsOpened: 0 }]);
  expect(result).toEqual(ok({ kind: 'failed' }));
  expect(dispatch.mock.calls).toEqual([[FAILED_ATTEMPT]]);
  // One end per session: nothing after it is answered or ends it again.
  expect(await s.attempt()).toEqual(err({ kind: 'closed' }));
  expect(s.close()).toBe(true);
  expect(ends).toHaveLength(1);
  // Control: below the limit a wrong answer says how many are left and ends nothing.
  const fresh = rig({ puzzle: { maxAttempts: 2 } });
  expect(await fresh.s.attempt()).toEqual(ok({ kind: 'wrong', attemptsLeft: 1 }));
  expect(fresh.ends).toEqual([]);
});

test('session: stale attempt response after dispose is dropped', async () => {
  const { s, api, dispatch, ends } = rig({ puzzle: { maxAttempts: 1 } });
  const answer = deferred<Result<AttemptResponse, ApiError>>();
  api.postAttempt.mockReturnValueOnce(answer.promise);
  const pending = s.attempt();
  s.dispose();
  // The fake answers anyway: a response already on its way when the abort came.
  answer.resolve(WRONG);
  const result = await pending;
  expect(dispatch).not.toHaveBeenCalled();
  expect(ends).toEqual([]);
  expect(result).toEqual(err({ kind: 'closed' }));
  // A correct answer after dispose ends nothing either (the server's `solved_at` is harmless, PZ:1575).
  const other = rig();
  const late = deferred<Result<AttemptResponse, ApiError>>();
  other.api.postAttempt.mockReturnValueOnce(late.promise);
  const lateResult = other.s.attempt();
  other.s.dispose();
  late.resolve(CORRECT);
  expect(await lateResult).toEqual(err({ kind: 'closed' }));
  expect(other.ends).toEqual([]);
});

test('session: dispose aborts the attempt', async () => {
  const { s, api } = rig();
  let attemptSignal: AbortSignal | undefined;
  api.postAttempt.mockImplementationOnce((_id, _answer, o) => {
    attemptSignal = o?.signal;
    return new Promise(() => {});
  });
  let statusSignal: AbortSignal | undefined;
  api.getPuzzle.mockImplementationOnce((_id, _lang, o) => {
    statusSignal = o?.signal;
    return new Promise(() => {});
  });
  void s.attempt(); // never settles: the fake ignores the abort
  void s.hints();
  expect(attemptSignal?.aborted).toBe(false);
  s.dispose();
  expect(attemptSignal?.aborted).toBe(true);
  expect(statusSignal?.aborted).toBe(true);
  // Idempotent, and everything after it answers closed.
  s.dispose();
  expect(await s.attempt()).toEqual(err({ kind: 'closed' }));
  expect(await s.hints()).toEqual(err({ kind: 'closed' }));
  expect(await s.useHint(1)).toEqual(err({ kind: 'closed' }));
  expect(api.postAttempt).toHaveBeenCalledTimes(1);
});

test('session: wrong answer dispatches attempt-failed, a network error counts nothing', async () => {
  const { s, api, dispatch, ends } = rig({ puzzle: { maxAttempts: 3 } });
  const failures: ReadonlyArray<readonly [ApiError, string]> = [
    [{ kind: 'network', detail: 'offline' }, 'network'],
    [{ kind: 'decode', detail: 'bad body' }, 'network'],
    [{ kind: 'session-expired' }, 'network'],
    [{ kind: 'http', status: 502, code: null, body: null, retryAfter: null }, 'network'],
    [{ kind: 'http', status: 403, code: 'not_entitled', body: { error: 'not_entitled' }, retryAfter: null }, 'not-entitled'],
  ];
  for (const [error, kind] of failures) {
    api.postAttempt.mockResolvedValueOnce(err(error));
    expect(await s.attempt(), error.kind).toEqual(err({ kind }));
  }
  api.postAttempt.mockResolvedValueOnce(WRONG);
  expect(await s.attempt()).toEqual(ok({ kind: 'wrong', attemptsLeft: 2 }));
  expect(dispatch.mock.calls).toEqual([[FAILED_ATTEMPT]]);
  // The client's shape pre-check: an answer of the wrong length is refused before any request.
  s.setAnswer([1, 2]);
  expect(await s.attempt()).toEqual(err({ kind: 'invalid' }));
  expect(api.postAttempt).toHaveBeenCalledTimes(failures.length + 1);
  expect(dispatch.mock.calls).toEqual([[FAILED_ATTEMPT]]);
  expect(ends).toEqual([]);
  // The answer starts at the type's initial state.
  expect(rig().s.answer()).toEqual([0, 0, 0, 0]);
  expect(rig({ puzzle: { type: 'order', params: { pieces: ['sun', 'moon', 'star'] } } }).s.answer()).toEqual([0, 1, 2]);
});

test('session: close waits for the attempt in flight', async () => {
  // A decisive answer wins over the close (PZ:1575): solved, not closed.
  const solved = rig();
  const a1 = deferred<Result<AttemptResponse, ApiError>>();
  solved.api.postAttempt.mockReturnValueOnce(a1.promise);
  const p1 = solved.s.attempt();
  expect(solved.s.close()).toBe(true);
  expect(solved.ends).toEqual([]);
  a1.resolve(CORRECT);
  expect(await p1).toEqual(ok({ kind: 'correct' }));
  expect(solved.ends).toEqual([{ outcome: 'solved', hintsOpened: 0 }]);
  // The last attempt's wrong answer fails the puzzle: failed, not closed.
  const failed = rig({ puzzle: { maxAttempts: 1 } });
  const a2 = deferred<Result<AttemptResponse, ApiError>>();
  failed.api.postAttempt.mockReturnValueOnce(a2.promise);
  const p2 = failed.s.attempt();
  failed.s.close();
  a2.resolve(WRONG);
  await p2;
  expect(failed.ends).toEqual([{ outcome: 'failed', hintsOpened: 0 }]);
  expect(failed.dispatch.mock.calls).toEqual([[FAILED_ATTEMPT]]);
  // A wrong answer with attempts left, or a network error, lets the close through once the answer is in.
  for (const answer of [WRONG, err<ApiError>({ kind: 'network', detail: 'x' })]) {
    const closed = rig();
    const a3 = deferred<Result<AttemptResponse, ApiError>>();
    closed.api.postAttempt.mockReturnValueOnce(a3.promise);
    const p3 = closed.s.attempt();
    closed.s.close();
    expect(closed.ends).toEqual([]);
    a3.resolve(answer);
    await p3;
    expect(closed.ends).toEqual([{ outcome: 'closed', hintsOpened: 0 }]);
  }
  // Nothing in flight: the close ends the session at once.
  const idle = rig();
  expect(idle.s.close()).toBe(true);
  expect(idle.ends).toEqual([{ outcome: 'closed', hintsOpened: 0 }]);
  // A linear puzzle is a mode, not an overlay: it does not close (X8).
  const linear = rig({ mode: 'linear' });
  expect(linear.s.close()).toBe(false);
  expect(linear.ends).toEqual([]);
});

test('session: give up only in a linear puzzle that allows it', async () => {
  const explore = rig({ puzzle: { giveUp: true } });
  explore.s.giveUp();
  const refused = rig({ mode: 'linear', puzzle: { giveUp: false } });
  refused.s.giveUp();
  expect([...explore.ends, ...refused.ends]).toEqual([]);
  const linear = rig({ mode: 'linear', puzzle: { giveUp: true }, run: { attempts: 2, hintsOpened: 1 } });
  linear.s.giveUp();
  expect(linear.ends).toEqual([{ outcome: 'abandoned', hintsOpened: 1 }]);
  // One end per session: a second Yes, or a Try after it, does nothing.
  linear.s.giveUp();
  expect(await linear.s.attempt()).toEqual(err({ kind: 'closed' }));
  expect(linear.ends).toHaveLength(1);
  // A give up while an attempt is in flight waits for its answer, which wins when decisive.
  const racing = rig({ mode: 'linear', puzzle: { giveUp: true } });
  const answer = deferred<Result<AttemptResponse, ApiError>>();
  racing.api.postAttempt.mockReturnValueOnce(answer.promise);
  const pending = racing.s.attempt();
  racing.s.giveUp();
  expect(racing.ends).toEqual([]);
  answer.resolve(CORRECT);
  await pending;
  expect(racing.ends).toEqual([{ outcome: 'solved', hintsOpened: 0 }]);
});

test('session: rate limit carries retry after', async () => {
  const { s, api, dispatch } = rig();
  api.postAttempt.mockResolvedValueOnce(err({ kind: 'http', status: 429, code: 'rate_limited', body: { error: 'rate_limited' }, retryAfter: 17 }));
  expect(await s.attempt()).toEqual(err({ kind: 'rate-limited', retryAfterSecs: 17 }));
  // A 429 without Retry-After (a proxy's) waits the fallback.
  api.postAttempt.mockResolvedValueOnce(err({ kind: 'http', status: 429, code: null, body: null, retryAfter: null }));
  expect(await s.attempt()).toEqual(err({ kind: 'rate-limited', retryAfterSecs: 30 }));
  // The status fetch maps its errors the same way; an abort that is not ours is closed.
  api.getPuzzle.mockResolvedValueOnce(err({ kind: 'http', status: 429, code: 'rate_limited', body: null, retryAfter: 5 }));
  expect(await s.hints()).toEqual(err({ kind: 'rate-limited', retryAfterSecs: 5 }));
  api.postAttempt.mockResolvedValueOnce(err({ kind: 'aborted' }));
  expect(await s.attempt()).toEqual(err({ kind: 'closed' }));
  expect(dispatch).not.toHaveBeenCalled();
});

test('session: unknown puzzle is an error value', () => {
  const api = { getPuzzle: vi.fn<Endpoints['getPuzzle']>(), postAttempt: vi.fn<Endpoints['postAttempt']>() };
  for (const id of ['nope', 'constructor', '__proto__']) {
    const r = createPuzzleSession({
      api,
      hints: null,
      world: worldWith(),
      chapter: CHAPTER,
      puzzle: pz(id),
      mode: 'linear',
      run: { outcome: null, attempts: 0, hintsOpened: 0 },
      lang: () => 'ru',
      dispatch: () => {},
    });
    expect(r, id).toEqual({ ok: false, error: { kind: 'unknown-puzzle', puzzle: id } });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Hints

/** A Storage that records every write. */
function recordingStorage(name: string): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      storage.writes.push(`${name} clear`);
      data.clear();
    },
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => {
      storage.writes.push(`${name} remove ${k}`);
      data.delete(k);
    },
    setItem: (k: string, v: string) => {
      storage.writes.push(`${name} ${v}`);
      data.set(k, v);
    },
  };
}

test('hints: texts never written to storage', async () => {
  vi.stubGlobal('localStorage', recordingStorage('local'));
  vi.stubGlobal('sessionStorage', recordingStorage('session'));
  const SERVER_TEXT = 'SERVER-HINT-ONE';
  const PORT_TEXT = 'PORT-HINT-TWO';
  const port = fakePort();
  port.use.mockResolvedValueOnce(ok({ text: PORT_TEXT, balance: 1 }));
  const { s, api, dispatch, ends } = rig({ port });
  api.getPuzzle.mockResolvedValueOnce(ok(status(false, { 1: SERVER_TEXT })));
  const ladder = await s.hints();
  expect(ladder.ok && ladder.value.tiers[0]).toEqual({ tier: 1, text: SERVER_TEXT, state: 'unlocked' });
  s.openHint(1);
  const used = await s.useHint(2);
  expect(used.ok && used.value.tiers[1]).toEqual({ tier: 2, text: PORT_TEXT, state: 'unlocked' });
  await s.attempt();
  expect(s.close()).toBe(true);
  s.dispose();
  // The texts are in memory only: nothing was written, and no action, end or request carries one.
  expect(storage.writes).toEqual([]);
  const carried = JSON.stringify([dispatch.mock.calls, ends, api.postAttempt.mock.calls, api.getPuzzle.mock.calls, port.use.mock.calls]);
  expect(carried).not.toContain(SERVER_TEXT);
  expect(carried).not.toContain(PORT_TEXT);
  // Non-vacuous: the run counted both tiers, and the requests did go out.
  expect(dispatch.mock.calls).toEqual([
    [{ kind: 'hint-opened', puzzle: 'gate', tier: 1 }],
    [{ kind: 'hint-opened', puzzle: 'gate', tier: 2 }],
    [FAILED_ATTEMPT],
  ]);
  expect(ends).toEqual([{ outcome: 'closed', hintsOpened: 2 }]);
  expect(port.use.mock.calls).toEqual([['ch1.gate', 2, 'ru']]);
});

test('hints: next tier usable only after previous unlocked', async () => {
  const { s, api, port, dispatch } = rig();
  const fresh = await s.hints();
  if (!fresh.ok) {
    throw new Error('expected a ladder');
  }
  expect(fresh.value.tiers[1]?.state).toBe('locked');
  expect(fresh.value.tiers.map((t) => t.state)).toEqual(['usable', 'locked', 'locked']);
  expect(await s.useHint(2)).toEqual(err({ kind: 'locked' }));
  expect(port.use).not.toHaveBeenCalled();
  // Tier 1 unlocked on the server (another device): tier 2 is next.
  api.getPuzzle.mockResolvedValueOnce(ok(status(false, { 1: 'one' })));
  const next = await s.hints();
  expect(next.ok && next.value.tiers.map((t) => [t.state, t.text])).toEqual([
    ['unlocked', 'one'],
    ['usable', null],
    ['locked', null],
  ]);
  const used = await s.useHint(2);
  expect(used.ok && used.value.tiers.map((t) => t.state)).toEqual(['unlocked', 'unlocked', 'usable']);
  expect(port.use.mock.calls).toEqual([['ch1.gate', 2, 'ru']]);
  expect(dispatch.mock.calls).toEqual([[{ kind: 'hint-opened', puzzle: 'gate', tier: 2 }]]);
  // A solved puzzle offers nothing more: every tier not unlocked is unavailable.
  api.getPuzzle.mockResolvedValueOnce(ok(status(true, { 1: 'one' })));
  const done = await s.hints();
  expect(done.ok && done.value.tiers.map((t) => t.state)).toEqual(['unlocked', 'unlocked', 'unavailable']);
  expect(await s.useHint(3)).toEqual(err({ kind: 'unavailable' }));
  // An unlocked tier needs no port call; the ladder carries the port's wallet.
  const again = await s.useHint(1);
  expect(again.ok && again.value.wallet).toEqual({ cost: 1, balance: 2 });
  expect(port.use).toHaveBeenCalledTimes(1);
  // Without a port nothing is usable through it, and the ladder has no wallet.
  const bare = rig({ port: 'none' });
  const plain = await bare.s.hints();
  expect(plain.ok && plain.value.wallet).toBeNull();
  expect(await bare.s.useHint(1)).toEqual(err({ kind: 'no-port' }));
});

test('hints: use without balance offers get more', async () => {
  const port = fakePort(0, 1);
  port.use.mockResolvedValueOnce(err<HintPortError>({ kind: 'insufficient' }));
  const { s, dispatch } = rig({ port });
  await s.hints();
  const r = await s.useHint(1);
  expect(port.getMore).toHaveBeenCalledTimes(1);
  expect(r).toEqual(err({ kind: 'insufficient' }));
  expect(s.ladder().tiers.map((t) => t.state)).toEqual(['usable', 'locked', 'locked']);
  expect(dispatch).not.toHaveBeenCalled();
  // Every other refusal of the port is a failure to show (hint.failed), not an offer.
  for (const kind of ['network', 'auth', 'limit', 'rate-limited', 'not-found'] as const) {
    port.use.mockResolvedValueOnce(err<HintPortError>({ kind }));
    expect(await s.useHint(1), kind).toEqual(err({ kind: 'failed' }));
  }
  expect(port.getMore).toHaveBeenCalledTimes(1);
});

test('hints: double use calls the port once', async () => {
  const port = fakePort();
  const answer = deferred<Awaited<ReturnType<HintPort['use']>>>();
  port.use.mockReturnValueOnce(answer.promise);
  const { s } = rig({ port });
  await s.hints();
  const first = s.useHint(1);
  const second = s.useHint(1);
  expect(port.use).toHaveBeenCalledTimes(1);
  expect(await second).toEqual(err({ kind: 'busy' }));
  answer.resolve(ok({ text: 'one', balance: 1 }));
  const r = await first;
  expect(r.ok && r.value.tiers[0]).toEqual({ tier: 1, text: 'one', state: 'unlocked' });
  // A use answered after dispose is dropped: the server's unlock stands (a repeat is free, M21), nothing is counted.
  const late = rig({ port: fakePort() });
  const lateAnswer = deferred<Awaited<ReturnType<HintPort['use']>>>();
  late.port.use.mockReturnValueOnce(lateAnswer.promise);
  await late.s.hints();
  const pending = late.s.useHint(1);
  late.s.dispose();
  lateAnswer.resolve(ok({ text: 'one', balance: 1 }));
  expect(await pending).toEqual(err({ kind: 'closed' }));
  expect(late.dispatch).not.toHaveBeenCalled();
});

test('hints: a saved hint count unlocks nothing', async () => {
  // The save says three hints were opened; the server says none is unlocked: the server wins (principle 1).
  const { s, dispatch, ends } = rig({ run: { hintsOpened: 3 } });
  const r = await s.hints();
  expect(r.ok && r.value.tiers.map((t) => [t.state, t.text])).toEqual([
    ['usable', null],
    ['locked', null],
    ['locked', null],
  ]);
  s.openHint(1);
  expect(dispatch).not.toHaveBeenCalled();
  // The count itself is kept: it is the story's `pz_<id>_hints`, not an unlock.
  s.close();
  expect(ends).toEqual([{ outcome: 'closed', hintsOpened: 3 }]);
});

test('hints: unavailable refreshes the ladder from the server', async () => {
  const port = fakePort();
  port.use.mockResolvedValueOnce(err<HintPortError>({ kind: 'unavailable' }));
  const { s, api } = rig({ port });
  await s.hints();
  // Solved on another device in between: the server refuses the tier (409 hint_unavailable).
  api.getPuzzle.mockResolvedValueOnce(ok(status(true)));
  expect(await s.useHint(1)).toEqual(err({ kind: 'unavailable' }));
  expect(api.getPuzzle).toHaveBeenCalledTimes(2);
  expect(s.ladder().tiers.map((t) => t.state)).toEqual(['unavailable', 'unavailable', 'unavailable']);
  expect(api.getPuzzle.mock.calls[1]).toEqual(['ch1.gate', 'ru', { signal: expect.any(AbortSignal) }]);
});
