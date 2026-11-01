// The saves of one story session (PROTOTYPE-PLAN F3, STORIES-PLAN Y7): one SaveService per game session, writing
// `/api/saves/<story>/<slot>`. Autosave keeps at most one PUT in flight, newer bodies superseding the queued one. A
// retry of an unchanged body replays its `writeId` (the server answers 200 if it had landed); `sentIds` remembers the
// writeIds sent since the last acknowledged rev, so a 409 whose `current` is one of ours is adopted, never a prompt. Any
// other 409 pauses autosave until the player chooses: progress is never overwritten silently (principle 1: the server
// copy is the truth). No player-facing text here: states and error values only.
import type { Endpoints } from '../api/endpoints.ts';
import type { PutSaveRequest, PutSaveResponse, SaveFull, SaveListResponse, SaveSlot, SaveSummary } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { Result, StoryId } from '../story/catalog.ts';
import type { ChapterId, LineId, StoryVersion } from '../story/staging.ts';
import type { Unsubscribe } from '../telegram/index.ts';

export type ManualSlot = Exclude<SaveSlot, 'auto'>;
/** One body to store, with the envelope the server lists. */
export type SaveWrite = { chapterId: ChapterId; storyVersion: StoryVersion; lineId: LineId | null; body: string };
/** The autosave lane: `paused` waits for `resolveConflict`, `failed` for the next autosave. */
export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'retrying'; attempt: number; inMs: number }
  | { kind: 'paused'; current: SaveSummary }
  | { kind: 'failed'; error: ApiError };
/** A manual save's failure: a conflict asks "Overwrite?" (then `overwrite(slot, w, current)`). */
export type SaveError = ApiError | { kind: 'conflict'; current: SaveSummary };

export interface SaveService {
  /** F3 for this story: seeds the known revs from the boot list by (story, slot). Re-callable after an error. */
  start(list: SaveListResponse): Promise<Result<void, ApiError>>;
  /** Coalescing; never throws. Queued until `start` succeeds. */
  autosave(w: SaveWrite, o?: { keepalive?: boolean }): void;
  /** One PUT per call; a 409 is `conflict` and never pauses autosave. */
  save(slot: ManualSlot, w: SaveWrite): Promise<Result<PutSaveResponse, SaveError>>;
  /** The player's "Overwrite?": a PUT against `current.rev`. */
  overwrite(slot: ManualSlot, w: SaveWrite, current: SaveSummary): Promise<Result<PutSaveResponse, SaveError>>;
  /** F3 step 4, the player's explicit choice while `paused`: re-PUT here, or drop the local queue for theirs. */
  resolveConflict(choice: 'keep-here' | 'load-theirs'): void;
  /** The stored save, or `null` for an empty slot (404); adopts its rev when nothing of ours is waiting for the slot. */
  load(slot: SaveSlot): Promise<Result<SaveFull | null, ApiError>>;
  state(): SaveState;
  onState(fn: (s: SaveState) => void): Unsubscribe;
  /** The app came back: a waiting retry runs now. */
  onActivated(): void;
  /** Timers cleared, listeners dropped, late answers ignored. A PUT in flight may still land. */
  dispose(): void;
}

/** The writeIds remembered since the last acknowledged rev (F3 step 1); the oldest is dropped past this. */
export const SENT_IDS_MAX = 16;
/** F3 step 3: the waits after the 1st, 2nd, … transient failure; the last one repeats. */
export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000, 30000];

const SLOTS: readonly SaveSlot[] = ['auto', 's1', 's2', 's3'];

/** The summary of (story, slot) in the boot list: a lookup by key, never by position (the order is the collation's). */
export function summaryOf(list: SaveListResponse, story: StoryId, slot: SaveSlot): SaveSummary | null {
  return list.slots.find((s) => s.storyId === story && s.slot === slot) ?? null;
}

/** 128 random bits as hex: `crypto.getRandomValues` needs no secure context, unlike `randomUUID`. */
function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A body with its idempotency key: retries of the same body reuse it. */
type Pending = { readonly write: SaveWrite; readonly writeId: string };

type Conflict = { kind: 'ours' } | { kind: 'theirs'; current: SaveSummary } | { kind: 'no-row' };

/** A `save_conflict` 409, by what it found: one of our writes, another device's, or no row at all. */
function conflictOf(e: ApiError, ours: (writeId: string) => boolean): Conflict | null {
  if (e.kind !== 'http' || e.status !== 409 || e.code !== 'save_conflict') {
    return null;
  }
  const current = e.body?.current;
  if (current === undefined) {
    return { kind: 'no-row' };
  }
  return ours(current.writeId) ? { kind: 'ours' } : { kind: 'theirs', current };
}

/**
 * What a non-conflict failure means for the write: `transient` retries with backoff (network, timeout, 5xx, 429);
 * `rejected` can never succeed and is dropped (400, 404, 413, any other 4xx); `unsaved` stops without a retry loop and
 * keeps the body (the session ended, a token refused twice, an unreadable 2xx).
 */
function failureOf(e: ApiError): 'transient' | 'rejected' | 'unsaved' {
  switch (e.kind) {
    case 'network':
      return 'transient';
    case 'http':
      if (e.status >= 500 || e.status === 429) {
        return 'transient';
      }
      return e.status === 401 ? 'unsaved' : 'rejected';
    case 'decode':
    case 'session-expired':
    case 'aborted':
      return 'unsaved';
    default: {
      const _never: never = e;
      return _never;
    }
  }
}

export function createSaveService(deps: {
  api: Pick<Endpoints, 'getSave' | 'putSave'>;
  clock: Clock;
  story: StoryId;
  newId?: () => string;
}): SaveService {
  const { api, clock, story } = deps;
  const newId = deps.newId ?? randomId;
  /** lastKnownRev per slot; `null` = no row known. */
  const revs = new Map<SaveSlot, number | null>();
  const listeners = new Set<(s: SaveState) => void>();
  let state: SaveState = { kind: 'idle' };
  let started = false;
  let starting: Promise<Result<void, ApiError>> | null = null;
  let disposed = false;
  /** The newest autosave body not yet acknowledged: sent next, or being sent. */
  let newest: Pending | null = null;
  let inFlight: Pending | null = null;
  let sentIds: string[] = [];
  let attempt = 0;
  let retryTimer: number | null = null;
  /** The no-row 409 gets one re-PUT with `expectedRev: null` until the next acknowledgement. */
  let noRowRetried = false;
  let conflict: SaveSummary | null = null;

  const setState = (next: SaveState): void => {
    state = next;
    for (const fn of [...listeners]) {
      fn(next);
    }
  };
  const ours = (writeId: string): boolean => sentIds.includes(writeId);
  const remember = (writeId: string): void => {
    if (!sentIds.includes(writeId)) {
      sentIds = [...sentIds, writeId].slice(-SENT_IDS_MAX);
    }
  };
  const requestFor = (p: Pending): PutSaveRequest => ({
    expectedRev: revs.get('auto') ?? null,
    writeId: p.writeId,
    chapterId: p.write.chapterId,
    storyVersion: p.write.storyVersion,
    lineId: p.write.lineId,
    body: p.write.body,
  });
  const cancelRetry = (): void => {
    if (retryTimer !== null) {
      clock.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  /** Sends `newest` when nothing blocks it: started, not paused, no PUT in flight and no retry waiting. */
  function pump(): void {
    if (disposed || !started || conflict !== null || inFlight !== null || retryTimer !== null || newest === null) {
      return;
    }
    send(newest);
  }

  function send(p: Pending): void {
    inFlight = p;
    remember(p.writeId);
    setState({ kind: 'saving' });
    // putSave answers every failure as a value; a rejection (a bug) is treated as a network failure, never lost.
    void api.putSave(story, 'auto', requestFor(p)).then(
      (r) => settled(p, r),
      (e: unknown) => settled(p, { ok: false, error: { kind: 'network', detail: String(e) } }),
    );
  }

  function settled(p: Pending, r: Result<PutSaveResponse, ApiError>): void {
    if (disposed) {
      return;
    }
    inFlight = null;
    if (r.ok) {
      revs.set('auto', r.value.rev);
      sentIds = [];
      attempt = 0;
      noRowRetried = false;
      if (newest === p) {
        newest = null;
        setState({ kind: 'idle' });
      } else {
        pump();
      }
      return;
    }
    const c = conflictOf(r.error, ours);
    if (c !== null) {
      attempt = 0;
      switch (c.kind) {
        case 'ours': {
          // An earlier write of ours landed and its answer was lost: adopt its rev and re-PUT the newest body.
          const current = r.error.kind === 'http' ? r.error.body?.current : undefined;
          revs.set('auto', current?.rev ?? null);
          pump();
          return;
        }
        case 'theirs':
          conflict = c.current;
          setState({ kind: 'paused', current: c.current });
          return;
        case 'no-row':
          if (!noRowRetried) {
            // The slot has no row: nothing exists to overwrite, so create it.
            noRowRetried = true;
            revs.set('auto', null);
            pump();
            return;
          }
          break;
        default: {
          const _never: never = c;
          return _never;
        }
      }
    }
    switch (failureOf(r.error)) {
      case 'transient': {
        attempt += 1;
        const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1] ?? 30_000;
        const wait = r.error.kind === 'http' && r.error.retryAfter !== null ? Math.max(base, r.error.retryAfter * 1000) : base;
        setState({ kind: 'retrying', attempt, inMs: wait });
        retryTimer = clock.setTimeout(() => {
          retryTimer = null;
          pump();
        }, wait);
        return;
      }
      case 'rejected':
        if (newest === p) {
          newest = null;
        }
        break;
      case 'unsaved':
        break;
    }
    attempt = 0;
    setState({ kind: 'failed', error: r.error });
    if (newest !== p) {
      // A newer body is waiting: it is a different write, so sending it is no retry loop.
      pump();
    }
  }

  async function manualPut(slot: ManualSlot, w: SaveWrite, expectedRev: number | null, noRow = false): Promise<Result<PutSaveResponse, SaveError>> {
    const r = await api.putSave(story, slot, { expectedRev, writeId: newId(), ...w });
    if (r.ok) {
      revs.set(slot, r.value.rev);
      return r;
    }
    const c = conflictOf(r.error, () => false);
    if (c?.kind === 'theirs') {
      return { ok: false, error: { kind: 'conflict', current: c.current } };
    }
    if (c?.kind === 'no-row' && !noRow) {
      revs.set(slot, null);
      return manualPut(slot, w, null, true);
    }
    return r;
  }

  async function run(list: SaveListResponse): Promise<Result<void, ApiError>> {
    for (const slot of SLOTS) {
      revs.set(slot, summaryOf(list, story, slot)?.rev ?? null);
    }
    if (!disposed) {
      started = true;
      pump();
    }
    return { ok: true, value: undefined };
  }

  return {
    start(list) {
      if (started || disposed) {
        return Promise.resolve({ ok: true, value: undefined });
      }
      starting ??= run(list).finally(() => {
        starting = null;
      });
      return starting;
    },
    autosave(w) {
      if (disposed) {
        return;
      }
      newest = { write: w, writeId: newId() };
      pump();
    },
    save: (slot, w) => manualPut(slot, w, revs.get(slot) ?? null),
    overwrite: (slot, w, current) => manualPut(slot, w, current.rev),
    resolveConflict(choice) {
      if (disposed || conflict === null) {
        return;
      }
      revs.set('auto', conflict.rev);
      conflict = null;
      if (choice === 'load-theirs') {
        newest = null;
        sentIds = [];
      }
      setState({ kind: 'idle' });
      pump();
    },
    async load(slot) {
      const r = await api.getSave(story, slot);
      const quiet = slot !== 'auto' || (newest === null && inFlight === null);
      if (r.ok) {
        if (quiet) {
          revs.set(slot, r.value.summary.rev);
        }
        return r;
      }
      if (r.error.kind === 'http' && r.error.status === 404) {
        if (quiet) {
          revs.set(slot, null);
        }
        return { ok: true, value: null };
      }
      return r;
    },
    state: () => state,
    onState(fn) {
      const entry = (s: SaveState): void => fn(s);
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    onActivated() {
      if (retryTimer !== null) {
        cancelRetry();
        pump();
      }
    },
    dispose() {
      disposed = true;
      cancelRetry();
      listeners.clear();
    },
  };
}
