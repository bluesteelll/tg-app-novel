// The statistics reporter (STORIES-PLAN Y13 and F11; META-PLAN M1 and M9): each event gets its id and its time at `record`,
// waits in a queue and goes out in batches through `postStatEvents`, one request at a time. A retry resends the same
// ids, so the server counts an event once. Statistics grant and unlock nothing (principle 1): the server judges every
// event, and the reporter drops whatever it rejected. It never throws (principle 5): a failure is a retry, a drop or a
// log line.
//
// A `rate_limited` rejection may also answer a resend of a choice already on record, once the batch is past the
// server's choice budget (LS3 review M1): a logged `rate_limited` is not proof that a pick was lost.
import { puzzleId } from '../api/endpoints.ts';
import type { Endpoints } from '../api/endpoints.ts';
import type { PostStatsResponse, StatEventDto } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { PuzzleOutcome } from '../explore/state.ts';
import type { EndingName, Result } from '../story/catalog.ts';
import type { ChapterId, LineId, PuzzleLocalId, StoryVersion } from '../story/staging.ts';

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
    clearTimer();
    again = null;
    const { batch, leftover, oversized } = buildBatch(queue, clock.now());
    if (oversized.length > 0) {
      for (const q of oversized) {
        log(`stats: ${q.eventId} dropped, its body alone is over ${STATS_BODY_MAX} B`);
      }
      queue = queue.filter((q) => !oversized.includes(q));
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
    if (e.kind === 'ending_reached') {
      trigger(false);
    } else if (timer === null && !flying && !halted) {
      arm('delay', FLUSH_DELAY_MS);
    }
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
