// The statistics reporter (STORIES-PLAN Y13 and F11; META-PLAN M1 and M9): each event gets its id and its time at `record`,
// waits in a queue and goes out in batches through `postStatEvents`, one request at a time. A retry resends the same
// ids, so the server counts an event once. Statistics grant and unlock nothing (principle 1): the server judges every
// event, and the reporter drops whatever it rejected. It never throws (principle 5): a failure is a retry, a drop or a
// log line. From Bot API 9.0 the queue has a DeviceStorage copy, so unsent events survive a reload: a cache of claims
// the server has not judged yet, never a source of truth.
//
// A `rate_limited` rejection may also answer a resend of a choice already on record, once the batch is past the
// server's choice budget (LS3 review M1): a logged `rate_limited` is not proof that a pick was lost.
import { puzzleId } from '../api/endpoints.ts';
import type { Endpoints } from '../api/endpoints.ts';
import type { PostStatsResponse, StatEventDto, StatKind, StatOutcome } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { PuzzleOutcome } from '../explore/state.ts';
import type { DeviceStore } from '../saves/pending.ts';
import type { EndingName, Result } from '../story/catalog.ts';
import type { ChapterId, LineId, PuzzleLocalId, StoryVersion } from '../story/staging.ts';
import type { TgError } from '../telegram/index.ts';

/** What the game session reports (STORIES-PLAN "StatEvent"; META-PLAN M1: the picked option of a choice). */
export type StatEvent =
  | { kind: 'chapter_started' | 'chapter_completed'; chapterId: ChapterId; storyVersion: StoryVersion }
  | { kind: 'ending_reached'; chapterId: ChapterId; storyVersion: StoryVersion; ending: EndingName }
  | { kind: 'puzzle_ended'; chapterId: ChapterId; storyVersion: StoryVersion; puzzle: PuzzleLocalId; outcome: PuzzleOutcome }
  | { kind: 'choice_made'; chapterId: ChapterId; storyVersion: StoryVersion; option: LineId };

export interface StatsReporter {
  /** Queues the event; an ending is sent at once, anything else within 5 s. Synchronous; never throws. */
  record(e: StatEvent): void;
  /** Sends now (`keepalive` on `deactivated` / `pagehide`); during a request it only asks for one more after it. */
  flush(o?: { keepalive?: boolean }): void;
  /** Clears every timer and ignores a late answer; the calls after it do nothing. */
  dispose(): void;
}

/** The server's batch limit (`STATS_BATCH_MAX`). */
export const STATS_BATCH_MAX = 32;
/**
 * D1: the largest POST body, in UTF-8 bytes of its JSON, for every batch. The server's body limit is the same 16 KiB,
 * and with the save PUT's `KEEPALIVE_BODY_MAX` it fills the 64 KiB keepalive quota of the two `pagehide` requests.
 */
export const STATS_BODY_MAX = 16_384;
/** The DeviceStorage key of the queue's copy (D7): `{"v":1,"events":[…]}`. */
export const STATS_QUEUE_KEY = 'stats_queue';
/** STORIES-PLAN Y13: the queue's bound; a record past it evicts the oldest choice first (revision 1, W2). */
export const STATS_QUEUE_MAX = 64;
/** The server's oldest accepted event (`STATS_AGE_MS_MAX`, 30 days): an older one would fail its whole batch. */
export const STATS_AGE_MS_MAX = 2_592_000_000;
/** D2: the wait from the first unsent record; later records do not push it back. */
export const FLUSH_DELAY_MS = 5_000;
/** The waits after the 1st, 2nd, … failure in a row; the last one repeats. */
export const STATS_BACKOFF_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000];
/** A `Retry-After` past an hour waits an hour: a broken header must not reach `setTimeout`'s 2^31 ms overflow. */
export const RETRY_AFTER_MAX_MS = 3_600_000;

/** An event as queued: its wire form, without the age that every attempt computes from `at` (epoch ms). */
type Queued = Omit<StatEventDto, 'ageMs'> & { readonly at: number };

/**
 * What a failed batch means (D3): `transient` keeps it and backs off; `wait` keeps it for the 429's `Retry-After`;
 * `rejected` can never be accepted as it is, so it is dropped; `halted` ends sending for the page.
 */
type Failure = 'transient' | 'wait' | 'rejected' | 'halted';

function failureOf(e: ApiError): Failure {
  switch (e.kind) {
    case 'network':
    case 'aborted':
    // An unreadable 2xx cannot be told from an unreadable auth answer before the POST: the events may be unsent.
    case 'decode':
      return 'transient';
    case 'session-expired':
      return 'halted';
    case 'http':
      if (e.status === 429) {
        return 'wait';
      }
      // A 401 here came back after http.ts's one re-auth: anomalous, so backed off rather than dropped.
      return e.status >= 400 && e.status < 500 && e.status !== 401 ? 'rejected' : 'transient';
    default: {
      const _never: never = e;
      return _never;
    }
  }
}

/** The wire `subject` and `outcome` of each kind (STORIES-PLAN "StatEventDto"). */
function subjectOf(e: StatEvent): Pick<Queued, 'subject' | 'outcome'> {
  switch (e.kind) {
    case 'chapter_started':
    case 'chapter_completed':
      return { subject: null, outcome: null };
    case 'ending_reached':
      return { subject: e.ending, outcome: null };
    case 'puzzle_ended':
      return { subject: puzzleId(e.chapterId, e.puzzle), outcome: e.outcome };
    case 'choice_made':
      // The option's line ID: stable across translations, so picks compare between languages.
      return { subject: e.option, outcome: null };
    default: {
      const _never: never = e;
      return _never;
    }
  }
}

/** D6: the age at this attempt; a clock set back gives 0, never a negative age the server refuses. */
function wire(q: Queued, now: number): StatEventDto {
  return {
    eventId: q.eventId,
    kind: q.kind,
    chapterId: q.chapterId,
    storyVersion: q.storyVersion,
    subject: q.subject,
    outcome: q.outcome,
    ageMs: Math.max(0, now - q.at),
  };
}

const utf8 = new TextEncoder();
/** `{"events":[]}`: the body around the events; each event after the first adds a comma. */
const BODY_FRAME_BYTES = utf8.encode(JSON.stringify({ events: [] })).length;

const isChoice = (q: Queued): boolean => q.kind === 'choice_made';

/**
 * The next batch (D1, D8): the facts (chapters, endings, puzzles) oldest first, then the choices oldest first, within
 * `STATS_BATCH_MAX` events and `STATS_BODY_MAX` bytes; `leftover` when events stay behind. `oversized` are the events
 * whose body alone passes the bound: no batch can ever carry them, so they must not hold up the queue.
 */
function buildBatch(queue: readonly Queued[], now: number): { batch: StatEventDto[]; leftover: boolean; oversized: Queued[] } {
  const batch: StatEventDto[] = [];
  const oversized: Queued[] = [];
  let bytes = BODY_FRAME_BYTES;
  for (const q of [...queue.filter((x) => !isChoice(x)), ...queue.filter(isChoice)]) {
    const e = wire(q, now);
    const size = utf8.encode(JSON.stringify(e)).length;
    if (BODY_FRAME_BYTES + size > STATS_BODY_MAX) {
      oversized.push(q);
      continue;
    }
    const grown = bytes + size + (batch.length > 0 ? 1 : 0);
    if (batch.length === STATS_BATCH_MAX || grown > STATS_BODY_MAX) {
      return { batch, leftover: true, oversized };
    }
    batch.push(e);
    bytes = grown;
  }
  return { batch, leftover: false, oversized };
}

// Exhaustive by type: a kind or an outcome added to api.ts fails `check` here until it is listed.
const STAT_KINDS = {
  chapter_started: true,
  chapter_completed: true,
  ending_reached: true,
  puzzle_ended: true,
  choice_made: true,
} as const satisfies Record<StatKind, true>;
const STAT_OUTCOMES = { solved: true, failed: true, abandoned: true } as const satisfies Record<StatOutcome, true>;

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isMember<T extends string>(set: Readonly<Record<T, true>>, v: unknown): v is T {
  return typeof v === 'string' && Object.hasOwn(set, v);
}

/** One stored event, or `null` for anything this version did not write. */
function decodeQueued(v: unknown): Queued | null {
  if (!isRecord(v)) {
    return null;
  }
  const { eventId, kind, chapterId, storyVersion, subject, outcome, at } = v;
  return typeof eventId === 'string' &&
    isMember(STAT_KINDS, kind) &&
    typeof chapterId === 'string' &&
    typeof storyVersion === 'string' &&
    (subject === null || typeof subject === 'string') &&
    (outcome === null || isMember(STAT_OUTCOMES, outcome)) &&
    typeof at === 'number' &&
    Number.isSafeInteger(at)
    ? { eventId, kind, chapterId, storyVersion, subject, outcome, at }
    : null;
}

/** D7: the stored queue, oldest first. A value this version did not write is empty; an unreadable event goes alone. */
function decodeStored(raw: string): Queued[] {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  const events = isRecord(v) && v['v'] === 1 ? v['events'] : null;
  return Array.isArray(events) ? events.flatMap((e) => decodeQueued(e) ?? []) : [];
}

/** D8: the events a queue past `STATS_QUEUE_MAX` gives up, oldest choice first, else the oldest event. */
function overCap(queue: readonly Queued[]): Queued[] {
  const out: Queued[] = [];
  const kept = [...queue];
  while (kept.length > STATS_QUEUE_MAX) {
    const i = kept.findIndex(isChoice);
    out.push(...kept.splice(i === -1 ? 0 : i, 1));
  }
  return out;
}

/** For the log only; a value whose own conversion throws is described as such, never rethrown. */
function describe(e: unknown): string {
  try {
    return e instanceof Error ? e.message || e.name : String(e);
  } catch {
    return 'an unprintable error';
  }
}

function describeError(e: ApiError): string {
  return e.kind === 'http' ? `http ${e.status}` : e.kind;
}

export function createStatsReporter(deps: {
  api: Pick<Endpoints, 'postStatEvents'>;
  /** The facade's DeviceStorage, `null` below Bot API 9.0 (the queue then lives in memory only). */
  device: DeviceStore | null;
  clock: Clock;
  /** A lower-case UUID v4 per event (the server's `is_event_id`); boot injects `crypto.randomUUID`. */
  newId: () => string;
  log?: (msg: string) => void;
}): StatsReporter {
  const { api, clock } = deps;
  /** In record order; the batch in flight stays here until its answer. */
  let queue: Queued[] = [];
  let flying = false;
  /** An explicit send asked for during the flight: one more request once it ends, keepalive if any asked for it. */
  let again: { keepalive: boolean } | null = null;
  /** At most one: the 5 s delay, a backoff or a 429 wait. */
  let timer: { id: number; kind: 'delay' | 'backoff' | 'wait' } | null = null;
  /** Failures in a row; a 200 or a dropped batch resets it. */
  let failures = 0;
  let halted = false;
  let disposed = false;
  /** The queue's copy; `null` without DeviceStorage, or for the page once its read failed. */
  let mirror: DeviceStore | null = deps.device;
  /** D7: until the stored queue is read, nothing is written over it and nothing is sent. */
  let loaded = mirror === null;
  let writing = false;
  let dirty = false;

  const log = (msg: string): void => {
    try {
      deps.log?.(msg);
    } catch {
      // The log is a debugging aid: a broken one must not break reporting.
    }
  };
  const clearTimer = (): void => {
    if (timer !== null) {
      clock.clearTimeout(timer.id);
      timer = null;
    }
  };
  const arm = (kind: 'delay' | 'backoff' | 'wait', ms: number): void => {
    clearTimer();
    const id = clock.setTimeout(() => {
      timer = null;
      send(false);
    }, ms);
    timer = { id, kind };
  };
  const backoffMs = (): number => STATS_BACKOFF_MS[Math.min(Math.max(failures, 1), STATS_BACKOFF_MS.length) - 1] ?? FLUSH_DELAY_MS;
  const drop = (sent: readonly StatEventDto[]): void => {
    const ids = new Set(sent.map((e) => e.eventId));
    queue = queue.filter((q) => !ids.has(q.eventId));
  };
  /** Events that can never be sent, or must give way: dropped from the queue with a log line each. */
  const discard = (gone: readonly Queued[], why: string): boolean => {
    if (gone.length === 0) {
      return false;
    }
    for (const q of gone) {
      log(`stats: ${q.eventId} dropped, ${why}`);
    }
    queue = queue.filter((q) => !gone.includes(q));
    return true;
  };
  // Exactly 30 days old is still accepted; one older would fail its whole batch.
  const dropStale = (now: number): boolean => discard(queue.filter((q) => now - q.at > STATS_AGE_MS_MAX), 'older than 30 days');

  /** One `set` at a time, then the newest queue if it changed meanwhile; a failed write loses only the cache. */
  async function write(device: DeviceStore): Promise<void> {
    writing = true;
    while (dirty) {
      dirty = false;
      const value = queue.length === 0 ? null : JSON.stringify({ v: 1, events: queue });
      try {
        const r = await device.set(STATS_QUEUE_KEY, value);
        if (!r.ok) {
          log(`stats: DeviceStorage write failed (${r.error.kind})`);
        }
      } catch (e) {
        log(`stats: DeviceStorage write failed (${describe(e)})`);
      }
    }
    writing = false;
  }

  /** After every change of the queue (D7): its copy follows. A write that started before `dispose` still lands. */
  function changed(): void {
    if (mirror === null || !loaded || disposed) {
      return;
    }
    dirty = true;
    if (!writing) {
      // Never rejects: each `set` is caught inside.
      void write(mirror);
    }
  }

  /** D7: the stored queue (oldest first) before this page's records, de-duplicated, aged, capped and written back. */
  async function load(device: DeviceStore): Promise<void> {
    let read: Result<string | null, TgError>;
    try {
      read = await device.get(STATS_QUEUE_KEY);
    } catch (e) {
      read = { ok: false, error: { kind: 'storage', detail: describe(e) } };
    }
    if (disposed) {
      return;
    }
    if (!read.ok) {
      // A failed read says nothing about the key: writing over it could erase the last session's unsent events.
      log(`stats: no DeviceStorage copy for this page (${read.error.kind})`);
      mirror = null;
    }
    const merged: Queued[] = [];
    const seen = new Set<string>();
    for (const q of [...(read.ok && read.value !== null ? decodeStored(read.value) : []), ...queue]) {
      if (!seen.has(q.eventId)) {
        seen.add(q.eventId);
        merged.push(q);
      }
    }
    queue = merged;
    loaded = true;
    dropStale(clock.now());
    discard(overCap(queue), 'the queue is full');
    changed();
    if (queue.length > 0) {
      // The flush after boot (STORIES-PLAN F1' step 3), with whatever a flush during the read asked for.
      trigger(again?.keepalive ?? false);
    }
  }

  /** D4's explicit trigger: an ending, `flush`. */
  function trigger(keepalive: boolean): void {
    if (disposed || halted) {
      return;
    }
    if (flying) {
      again = { keepalive: (again?.keepalive ?? false) || keepalive };
      return;
    }
    if (timer?.kind === 'wait') {
      // The server refuses every batch until the 429's wait ends: sending now would only be refused again.
      return;
    }
    send(keepalive);
  }

  function send(keepalive: boolean): void {
    if (!loaded) {
      // Remembered: the flush after the read sends it.
      again = { keepalive: (again?.keepalive ?? false) || keepalive };
      return;
    }
    clearTimer();
    again = null;
    const now = clock.now();
    const stale = dropStale(now);
    const { batch, leftover, oversized } = buildBatch(queue, now);
    if (discard(oversized, `its body alone is over ${STATS_BODY_MAX} B`) || stale) {
      changed();
    }
    if (batch.length === 0) {
      return;
    }
    flying = true;
    let answer: Promise<Result<PostStatsResponse, ApiError>>;
    try {
      answer = api.postStatEvents(batch, { keepalive });
    } catch (e) {
      answer = Promise.resolve({ ok: false, error: { kind: 'network', detail: describe(e) } });
    }
    // Settled here, never awaited: `record` and `flush` are synchronous, and `answered` does not throw.
    void answer.then(
      (r) => answered(batch, leftover, r),
      (e: unknown) => answered(batch, leftover, { ok: false, error: { kind: 'network', detail: describe(e) } }),
    );
  }

  /** After a 200 or a dropped batch: the follow-up asked for or left behind goes at once, else the 5 s delay. */
  function next(leftover: boolean): void {
    if (again !== null || leftover) {
      send(again?.keepalive ?? false);
    } else if (queue.length > 0) {
      arm('delay', FLUSH_DELAY_MS);
    }
  }

  function answered(sent: readonly StatEventDto[], leftover: boolean, r: Result<PostStatsResponse, ApiError>): void {
    flying = false;
    if (disposed) {
      return;
    }
    if (r.ok) {
      // Every event of the batch is answered: recorded, a duplicate, or rejected for good (D9).
      for (const x of r.value.rejected) {
        log(`stats: rejected ${x.eventId} ${x.reason}`);
      }
      drop(sent);
      changed();
      failures = 0;
      next(leftover);
      return;
    }
    const failure = failureOf(r.error);
    switch (failure) {
      case 'transient':
        failures += 1;
        if (again !== null) {
          send(again.keepalive);
        } else {
          arm('backoff', backoffMs());
        }
        return;
      case 'wait': {
        failures += 1;
        again = null;
        const retryAfter = r.error.kind === 'http' ? r.error.retryAfter : null;
        arm('wait', Math.min(Math.max((retryAfter ?? 0) * 1000, backoffMs()), RETRY_AFTER_MAX_MS));
        return;
      }
      case 'rejected':
        log(`stats: batch of ${sent.length} dropped (${describeError(r.error)})`);
        drop(sent);
        changed();
        failures = 0;
        next(leftover);
        return;
      case 'halted':
        // The page's session ended (http.ts): no request can succeed again, so none is made.
        halted = true;
        again = null;
        clearTimer();
        return;
      default: {
        const _never: never = failure;
        return _never;
      }
    }
  }

  function record(e: StatEvent): void {
    if (disposed) {
      return;
    }
    let eventId: string;
    try {
      eventId = deps.newId();
    } catch (err) {
      log(`stats: ${e.kind} dropped, no event id (${describe(err)})`);
      return;
    }
    queue.push({ eventId, kind: e.kind, chapterId: e.chapterId, storyVersion: e.storyVersion, ...subjectOf(e), at: clock.now() });
    // An evicted event of the batch in flight is simply not found at its answer.
    discard(overCap(queue), 'the queue is full');
    changed();
    if (e.kind === 'ending_reached') {
      trigger(false);
    } else if (timer === null && !flying && !halted) {
      arm('delay', FLUSH_DELAY_MS);
    }
  }

  if (mirror !== null) {
    // Never rejects: the read's failure is a value, and everything after it is caught or cannot throw.
    void load(mirror);
  }

  return {
    record,
    flush: (o) => trigger(o?.keepalive === true),
    dispose: () => {
      disposed = true;
      again = null;
      clearTimer();
    },
  };
}
