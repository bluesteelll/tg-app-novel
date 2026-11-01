// One open puzzle (docs/PUZZLES-PLAN.md "Module API", X5, X8, F6, F8; META-PLAN M21, M27, F24), created and disposed by
// GameSession (app/yields.ts, L15). The server checks every answer (X5). A hint text comes only from the server - the
// unlocked tiers of `getPuzzle`, or the hint port's answer - and lives in this session's memory only: it is never
// written to any storage, and no tier is unlocked from client state (principles 0, 1). The session never prices a
// hint and never starts a purchase (M27). It dispatches `attempt-failed` and `hint-opened`; `puzzle-ended` is
// GameSession's, from `onEnd` (PZ F6 step 6), because an explore close ends the session with no outcome.
import { puzzleId } from '../api/endpoints.ts';
import type { Endpoints, PuzzleId } from '../api/endpoints.ts';
import type { PuzzleStatus } from '../api/generated/api.ts';
import type { ApiError } from '../api/http.ts';
import type { ExploreAction } from '../explore/reduce.ts';
import type { PuzzleRun } from '../explore/state.ts';
import type { Lang } from '../i18n/index.ts';
import type { Result } from '../story/catalog.ts';
import type { ChapterId, PuzzleLocalId } from '../story/staging.ts';
import type { Unsubscribe } from '../telegram/index.ts';
import type { PublicPuzzle, WorldPublic } from '../world/types.ts';
import { PUZZLE_RULES } from './rules/index.ts';

/** An exploration puzzle is an overlay that closes; a linear puzzle is a mode with no BackButton (X8). */
export type PuzzleMode = 'linear' | 'explore';
/** What one Try answered; `attemptsLeft` is null without an attempt limit. */
export type AttemptResult = { kind: 'correct' } | { kind: 'wrong'; attemptsLeft: number | null } | { kind: 'failed' };
/**
 * Why a call has no answer. `network` counts nothing; `invalid`: the shape pre-check refused the answer and nothing
 * was sent; `closed`: the session ended or was disposed, and a late answer was dropped.
 */
export type PuzzleError =
  | { kind: 'network' }
  | { kind: 'rate-limited'; retryAfterSecs: number }
  | { kind: 'not-entitled' }
  | { kind: 'busy' }
  | { kind: 'closed' }
  | { kind: 'invalid' };
/**
 * One tier, from server truth only. `unlocked`: the last status says so, or the port answered it in this session;
 * `unavailable`: not unlocked and the puzzle is solved; `usable`: tier 1 or the tier before it unlocked, unsolved.
 */
export type HintTierView = { tier: number; text: string | null; state: 'unlocked' | 'usable' | 'locked' | 'unavailable' };
/** The ladder; `wallet` is null iff the session has no hint port, and its values are the port's (null = unknown). */
export type HintLadder = {
  tiers: readonly HintTierView[];
  wallet: { cost: number | null; balance: number | null } | null;
};
/** Why a hint was not used: `insufficient` has opened the port's get-more, `unavailable` has refreshed the ladder. */
export type HintError = { kind: 'busy' | 'locked' | 'no-port' | 'closed' | 'insufficient' | 'unavailable' | 'failed' };
/** How the session ended (once); `closed` is an explore close and records no outcome. */
export type PuzzleEnd = { outcome: 'solved' | 'failed' | 'abandoned' | 'closed'; hintsOpened: number };

/** META-PLAN `MetaError`'s shape: LMD's error type stays assignable to it. */
export type HintPortError = {
  kind: 'network' | 'auth' | 'insufficient' | 'unavailable' | 'limit' | 'rate-limited' | 'not-found';
  retryAfter?: number;
};
/** The hint spend (META-PLAN M21, M27): LMI passes the wallet's port, L15 passes none. */
export interface HintPort {
  /** The last server balance; null = unknown. */
  balance(): number | null;
  /** `WalletResponse.hintTierCost`; null = unknown. */
  tierCost(): number | null;
  /** `POST /api/puzzles/{id}/hints/{tier}?lang`; a repeat of an unlocked tier is free on the server. */
  use(puzzle: PuzzleId, tier: number, lang: Lang): Promise<Result<{ text: string; balance: number }, HintPortError>>;
  /** Opens the wallet overlay. */
  getMore(): void;
}

export interface PuzzleSession {
  readonly id: PuzzleId;
  readonly local: PuzzleLocalId;
  readonly mode: PuzzleMode;
  answer(): readonly number[];
  setAnswer(a: readonly number[]): void;
  /** Single-flight; a wrong answer dispatches `attempt-failed`, and the attempt limit ends the session `failed`. */
  attempt(): Promise<Result<AttemptResult, PuzzleError>>;
  /** `GET /api/puzzles/{id}`, single-flight; the texts stay in this session's memory. */
  hints(): Promise<Result<HintLadder, PuzzleError>>;
  /** The ladder as last learned, with the port's current wallet; no request. */
  ladder(): HintLadder;
  /** A re-read of an unlocked tier: dispatches `hint-opened` (the reducer counts the highest tier once). */
  openHint(tier: number): void;
  /** Single-flight through the port; a success dispatches `hint-opened`. Nothing is priced or bought here. */
  useHint(tier: number): Promise<Result<HintLadder, HintError>>;
  /** A linear puzzle whose `giveUp` is set ends `abandoned`; deferred while an attempt is in flight. */
  giveUp(): void;
  /** Explore: ends `closed` (deferred while an attempt is in flight) and returns true; linear: false. */
  close(): boolean;
  onEnd(fn: (e: PuzzleEnd) => void): Unsubscribe;
  /** Aborts the requests in flight, drops the texts and every later answer; idempotent. Emits no end. */
  dispose(): void;
}

export type PuzzleSessionDeps = {
  api: Pick<Endpoints, 'getPuzzle' | 'postAttempt'>;
  hints: HintPort | null;
  world: WorldPublic;
  chapter: ChapterId;
  puzzle: PuzzleLocalId;
  mode: PuzzleMode;
  /** The saved run: its attempts count toward the limit; its hint count is a count only and unlocks nothing. */
  run: PuzzleRun;
  lang: () => Lang;
  dispatch: (a: ExploreAction) => void;
};

/** A puzzle id the world does not hold: GameSession shows the story-error notice. */
export type SessionError = { kind: 'unknown-puzzle'; puzzle: PuzzleLocalId };

/** The server always sends Retry-After with its 429 (X5); a proxy's 429 without one waits this long. */
const RETRY_AFTER_FALLBACK_S = 30;

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

function puzzleError(e: ApiError): PuzzleError {
  switch (e.kind) {
    case 'http':
      if (e.status === 429) {
        return { kind: 'rate-limited', retryAfterSecs: e.retryAfter ?? RETRY_AFTER_FALLBACK_S };
      }
      return e.status === 403 ? { kind: 'not-entitled' } : { kind: 'network' };
    case 'aborted':
      return { kind: 'closed' };
    case 'network':
    case 'decode':
    case 'session-expired':
      return { kind: 'network' };
    default: {
      const never: never = e;
      return never;
    }
  }
}

function initialAnswer(p: PublicPuzzle): readonly number[] {
  switch (p.type) {
    case 'code':
      return PUZZLE_RULES.code.initial(p.params);
    case 'order':
      return PUZZLE_RULES.order.initial(p.params);
    default: {
      const never: never = p;
      return never;
    }
  }
}

function validAnswer(p: PublicPuzzle, a: readonly number[]): boolean {
  switch (p.type) {
    case 'code':
      return PUZZLE_RULES.code.validAnswer(p.params, a);
    case 'order':
      return PUZZLE_RULES.order.validAnswer(p.params, a);
    default: {
      const never: never = p;
      return never;
    }
  }
}

class Session implements PuzzleSession {
  readonly id: PuzzleId;
  readonly local: PuzzleLocalId;
  readonly mode: PuzzleMode;
  readonly #deps: PuzzleSessionDeps;
  readonly #puzzle: PublicPuzzle;
  #answer: readonly number[];
  /** The saved run's attempts plus this session's wrong answers. */
  #attempts: number;
  /** The highest tier counted as opened: the saved count, then this session's `hint-opened`. */
  #hintsOpened: number;
  #ended = false;
  #disposed = false;
  #attempt: AbortController | null = null;
  /** A close or give up asked for while an attempt was in flight; a decisive answer wins over it. */
  #deferred: 'closed' | 'abandoned' | null = null;
  #status: Promise<Result<HintLadder, PuzzleError>> | null = null;
  readonly #statusAborts = new Set<AbortController>();
  #hintInFlight = false;
  /** The tiers as the server lists them (its count wins over the world's `hintTiers`); empty before the first status. */
  #tiers: readonly number[] = [];
  #serverUnlocked: ReadonlySet<number> = new Set();
  readonly #usedHere = new Set<number>();
  #solved = false;
  readonly #texts = new Map<number, string>();
  readonly #listeners = new Set<(e: PuzzleEnd) => void>();

  constructor(deps: PuzzleSessionDeps, puzzle: PublicPuzzle) {
    this.#deps = deps;
    this.#puzzle = puzzle;
    this.id = puzzleId(deps.chapter, deps.puzzle);
    this.local = deps.puzzle;
    this.mode = deps.mode;
    this.#answer = initialAnswer(puzzle);
    this.#attempts = deps.run.attempts;
    this.#hintsOpened = deps.run.hintsOpened;
  }

  answer(): readonly number[] {
    return this.#answer;
  }

  setAnswer(a: readonly number[]): void {
    if (!this.#disposed) {
      this.#answer = Object.freeze([...a]);
    }
  }

  async attempt(): Promise<Result<AttemptResult, PuzzleError>> {
    if (this.#over()) {
      return err({ kind: 'closed' });
    }
    if (this.#attempt !== null) {
      return err({ kind: 'busy' });
    }
    const answer = this.#answer;
    if (!validAnswer(this.#puzzle, answer)) {
      return err({ kind: 'invalid' });
    }
    const abort = new AbortController();
    this.#attempt = abort;
    const r = await this.#deps.api.postAttempt(this.id, answer, { signal: abort.signal });
    this.#attempt = null;
    if (this.#disposed) {
      return err({ kind: 'closed' });
    }
    const result = this.#settle(r);
    const deferred = this.#deferred;
    this.#deferred = null;
    if (deferred !== null) {
      this.#end(deferred); // a no-op when the answer already ended the session
    }
    return result;
  }

  #settle(r: Result<{ correct: boolean; solved: boolean }, ApiError>): Result<AttemptResult, PuzzleError> {
    if (!r.ok) {
      return err(puzzleError(r.error));
    }
    this.#solved ||= r.value.solved;
    if (r.value.correct) {
      this.#solved = true;
      this.#end('solved');
      return ok({ kind: 'correct' });
    }
    this.#attempts += 1;
    this.#deps.dispatch({ kind: 'attempt-failed', puzzle: this.local });
    const max = this.#puzzle.maxAttempts;
    if (max !== null && this.#attempts >= max) {
      this.#end('failed');
      return ok({ kind: 'failed' });
    }
    return ok({ kind: 'wrong', attemptsLeft: max === null ? null : max - this.#attempts });
  }

  hints(): Promise<Result<HintLadder, PuzzleError>> {
    if (this.#over()) {
      return Promise.resolve(err({ kind: 'closed' }));
    }
    this.#status ??= this.#fetchStatus().finally(() => {
      this.#status = null;
    });
    return this.#status;
  }

  async #fetchStatus(): Promise<Result<HintLadder, PuzzleError>> {
    const abort = new AbortController();
    this.#statusAborts.add(abort);
    const r = await this.#deps.api.getPuzzle(this.id, this.#deps.lang(), { signal: abort.signal });
    this.#statusAborts.delete(abort);
    if (this.#over()) {
      return err({ kind: 'closed' });
    }
    if (!r.ok) {
      return err(puzzleError(r.error));
    }
    this.#learn(r.value);
    return ok(this.ladder());
  }

  #learn(s: PuzzleStatus): void {
    this.#solved ||= s.solved;
    this.#tiers = s.hints.map((h) => h.tier);
    this.#serverUnlocked = new Set(s.hints.filter((h) => h.unlocked).map((h) => h.tier));
    for (const h of s.hints) {
      if (h.unlocked && h.text !== null) {
        this.#texts.set(h.tier, h.text);
      } else if (!this.#usedHere.has(h.tier)) {
        this.#texts.delete(h.tier); // revoked on the server (a refund)
      }
    }
  }

  ladder(): HintLadder {
    const unlocked = (tier: number): boolean => this.#serverUnlocked.has(tier) || this.#usedHere.has(tier);
    const tiers = this.#tiers.map((tier): HintTierView => {
      if (unlocked(tier)) {
        return { tier, text: this.#texts.get(tier) ?? null, state: 'unlocked' };
      }
      if (this.#solved) {
        return { tier, text: null, state: 'unavailable' };
      }
      return { tier, text: null, state: tier === 1 || unlocked(tier - 1) ? 'usable' : 'locked' };
    });
    const port = this.#deps.hints;
    return { tiers, wallet: port === null ? null : { cost: port.tierCost(), balance: port.balance() } };
  }

  openHint(tier: number): void {
    if (!this.#over() && this.#texts.has(tier)) {
      this.#opened(tier);
    }
  }

  async useHint(tier: number): Promise<Result<HintLadder, HintError>> {
    if (this.#over()) {
      return err({ kind: 'closed' });
    }
    const port = this.#deps.hints;
    if (port === null) {
      return err({ kind: 'no-port' });
    }
    if (this.#hintInFlight) {
      return err({ kind: 'busy' });
    }
    const state = this.ladder().tiers.find((t) => t.tier === tier)?.state;
    if (state === 'unlocked') {
      return ok(this.ladder());
    }
    if (state === 'unavailable') {
      return err({ kind: 'unavailable' });
    }
    if (state !== 'usable') {
      return err({ kind: 'locked' });
    }
    this.#hintInFlight = true;
    try {
      return await this.#use(port, tier);
    } finally {
      this.#hintInFlight = false;
    }
  }

  async #use(port: HintPort, tier: number): Promise<Result<HintLadder, HintError>> {
    const r = await port.use(this.id, tier, this.#deps.lang());
    if (this.#over()) {
      return err({ kind: 'closed' }); // the server's unlock stands: a repeat of the tier is free (M21)
    }
    if (r.ok) {
      this.#usedHere.add(tier);
      this.#texts.set(tier, r.value.text);
      this.#opened(tier);
      return ok(this.ladder());
    }
    switch (r.error.kind) {
      case 'insufficient':
        port.getMore();
        return err({ kind: 'insufficient' });
      case 'unavailable':
        // 409 hint_unavailable: the ladder was stale (solved, or a tier revoked); `ladder()` reads the refresh.
        await this.hints();
        return err({ kind: 'unavailable' });
      case 'network':
      case 'auth':
      case 'limit':
      case 'rate-limited':
      case 'not-found':
        return err({ kind: 'failed' });
      default: {
        const never: never = r.error.kind;
        return never;
      }
    }
  }

  #opened(tier: number): void {
    this.#hintsOpened = Math.max(this.#hintsOpened, tier);
    this.#deps.dispatch({ kind: 'hint-opened', puzzle: this.local, tier });
  }

  giveUp(): void {
    if (this.mode !== 'linear' || !this.#puzzle.giveUp || this.#over()) {
      return;
    }
    if (this.#attempt !== null) {
      this.#deferred = 'abandoned';
      return;
    }
    this.#end('abandoned');
  }

  close(): boolean {
    if (this.mode === 'linear') {
      return false;
    }
    if (this.#over()) {
      return true;
    }
    if (this.#attempt !== null) {
      this.#deferred = 'closed'; // bounded by the request timeout (api/http.ts)
      return true;
    }
    this.#end('closed');
    return true;
  }

  onEnd(fn: (e: PuzzleEnd) => void): Unsubscribe {
    if (this.#disposed) {
      return () => {};
    }
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#attempt?.abort();
    for (const abort of this.#statusAborts) {
      abort.abort();
    }
    this.#statusAborts.clear();
    this.#texts.clear();
    this.#usedHere.clear();
    this.#serverUnlocked = new Set();
    this.#tiers = [];
    this.#listeners.clear();
  }

  /** Ended or disposed: every later call answers `closed`, and every late answer is dropped. */
  #over(): boolean {
    return this.#ended || this.#disposed;
  }

  #end(outcome: PuzzleEnd['outcome']): void {
    if (this.#ended) {
      return;
    }
    this.#ended = true;
    // A status fetch of an ended session has no reader; the attempt in flight, if any, has already answered.
    for (const abort of this.#statusAborts) {
      abort.abort();
    }
    const e: PuzzleEnd = { outcome, hintsOpened: this.#hintsOpened };
    for (const fn of [...this.#listeners]) {
      fn(e);
    }
  }
}

/** A session for `deps.puzzle`, or `unknown-puzzle` when the world holds no such own entry. */
export function createPuzzleSession(deps: PuzzleSessionDeps): Result<PuzzleSession, SessionError> {
  const puzzle = Object.hasOwn(deps.world.puzzles, deps.puzzle) ? deps.world.puzzles[deps.puzzle] : undefined;
  if (puzzle === undefined) {
    return err({ kind: 'unknown-puzzle', puzzle: deps.puzzle });
  }
  return ok(new Session(deps, puzzle));
}
