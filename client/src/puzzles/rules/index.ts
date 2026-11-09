// The puzzle type registry (docs/PUZZLES-PLAN.md "Puzzle types", X17; engine plan §7.1): one data half per type,
// shared by the world decoder, the story lint, the server content emitter and the session. Pure (X4). Every answer is
// an array of small integers, so the server compares it with the solution without knowing the type (X5). A type's
// play half (`puzzles/play/`, its UI chunk) and lint half (`scripts/story/puzzles/`, the build) live beside it.
import type { ControlDecl } from '../../cues/types.ts';
import type { PuzzleRun } from '../../explore/state.ts';
import type { Result } from '../../story/catalog.ts';
import { CODE_RULES } from './code.ts';
import { ORDER_RULES } from './order.ts';

/**
 * The data half of one puzzle type: what the engine reads without loading the type's UI. Every member that takes
 * `P` is a method, so a `PuzzleTypeData<'code', CodeParams>` is a `PuzzleTypeData<string, unknown>` (strict function
 * types spare method parameters), which is what `PuzzleTypes` holds.
 */
export interface PuzzleTypeData<T extends string, P> {
  readonly type: T;
  /** When an attempt is posted: 'commit' on the player's Try, 'reach' when the working answer reaches the goal. */
  readonly check: 'commit' | 'reach';
  /** 'shown': the type's own UI draws its goal (I4); a reach type and only a reach type has one. */
  readonly goal: 'secret' | 'shown';
  readonly presentation: 'overlay' | 'view';
  /** Where a wrong input is known: 'none' = no wrong state; 'posted' = the server's reply; 'local' = the device. */
  readonly wrong: 'none' | 'posted' | 'local';
  /** What posts a commit type's attempt: 'control' = a Try or the device's commit part; 'full' = the full answer. */
  readonly commit: 'control' | 'full';
  /** The instance's `params` (world/schema reports the error). */
  decodeParams(raw: unknown): Result<P, string>;
  /** Emitted to the server content as `answerLen` / `answerMax`; the session's shape pre-check. */
  answerShape(p: P): { len: number; max: number };
  /** The working answer a session starts from. */
  initial(p: P): readonly number[];
  /** The full-length configuration the device shows before any input, or null when it shows none. */
  startShown(p: P): readonly number[] | null;
  /** View types: whether a saved working configuration still fits `p`. Absent: the type saves no work. */
  workFits?(p: P, work: readonly number[]): boolean;
  /** A shown-goal device that demonstrates its goal: the parts to play, in order. Absent: no demonstration. */
  demo?(p: P): readonly number[];
  /** The type UI's controls and triggers (engine plan §8.3); `ControlCue` derives from these, so a type lane never edits
   *  cues/types.ts, and each control's motion is `UI_MOTIONS`' default or its `motion`, so it never edits motions.ts.
   *  `code` / `order` declare none (their controls are `CORE_CONTROLS`). A type that declares controls keeps its
   *  literal type (`satisfies`): annotated as `PuzzleTypeData<...>`, its names would widen out of `ControlCue`. */
  readonly controls?: readonly ControlDecl[];
}

/** The runtime type registry's shape: production reads `PUZZLE_TYPES`, a test passes a fixture type beside them. */
export type PuzzleTypes = readonly PuzzleTypeData<string, unknown>[];

/** Every puzzle type, one data half each; `PuzzleType` derives from it. */
export const PUZZLE_TYPES = [CODE_RULES, ORDER_RULES] as const satisfies PuzzleTypes;

export type PuzzleType = (typeof PUZZLE_TYPES)[number]['type'];
/** The decoded `params` of type `T`: what its data half's `decodeParams` returns. */
export type ParamsOf<T extends PuzzleType> =
  Extract<(typeof PUZZLE_TYPES)[number], { readonly type: T }> extends PuzzleTypeData<T, infer P> ? P : never;

/** `PUZZLE_TYPES` keyed by type, each value the registry's own entry; a missing or extra key is a tsc error. */
export const PUZZLE_RULES: { readonly [T in PuzzleType]: PuzzleTypeData<T, ParamsOf<T>> } = Object.freeze({
  code: CODE_RULES,
  order: ORDER_RULES,
});

/** One puzzle as the runtime sees its type, built once from the type's data half: no consumer switches on type. */
export type PuzzleInstance = {
  readonly type: PuzzleType;
  readonly shape: { len: number; max: number };
  readonly check: 'commit' | 'reach';
  readonly goal: 'secret' | 'shown';
  readonly presentation: 'overlay' | 'view';
  readonly wrong: 'none' | 'posted' | 'local';
  readonly commit: 'control' | 'full';
  initial(): readonly number[];
  /** The answer a session starts from (the session's constructor calls it). */
  start(run: PuzzleRun): readonly number[];
  /** The demonstration order, or null. */
  demo(): readonly number[] | null;
};

/** The instance of one puzzle from its type's data half: the one runtime place that builds an instance. */
export function instanceOf(data: PuzzleTypeData<string, unknown>, params: unknown): PuzzleInstance {
  const initial = (): readonly number[] => data.initial(params);
  return Object.freeze({
    // A type outside PuzzleType is a test's fixture, passed as `types` (engine plan §7.1 round 5).
    type: data.type as PuzzleType,
    shape: data.answerShape(params),
    check: data.check,
    goal: data.goal,
    presentation: data.presentation,
    wrong: data.wrong,
    commit: data.commit,
    initial,
    // Every type starts from `initial()`: no type saves a working configuration yet (round 5 m1; GM8h adds `run.work`).
    start: initial,
    demo: () => data.demo?.(params) ?? null,
  });
}

/** The instance of a decoded puzzle, its type looked up in `types`; null for a type `types` lacks (decode refused it). */
export function puzzleInstance(
  p: { readonly type: string; readonly params: unknown },
  types: PuzzleTypes = PUZZLE_TYPES,
): PuzzleInstance | null {
  const data = types.find((t) => t.type === p.type);
  return data === undefined ? null : instanceOf(data, p.params);
}

/** The play half of one puzzle type (`puzzles/play/<type>.ts`): loaded with the type's UI chunk only. */
export interface PuzzleTypePlay<P> {
  /** Whether `a` may be posted: enables the commit control. */
  validAnswer(p: P, a: readonly number[]): boolean;
  /** Reach types: whether `a` reaches the goal. */
  reached?(p: P, a: readonly number[]): boolean;
  /** Reach types: what is posted for a reaching `a`. */
  canonical?(p: P, a: readonly number[]): readonly number[];
  /** Devices: the working answer after pressing `part`, and whether that press was wrong. */
  press?(p: P, work: readonly number[], part: number): { work: readonly number[]; wrong: boolean };
}

/** Null when `a` has the shape: `len` entries, each an integer in 0..`max`; else why not (lint `world/solution`). */
export function shapeProblem(a: readonly number[], shape: { len: number; max: number }): string | null {
  if (a.length !== shape.len) {
    return `length ${a.length}, expected ${shape.len}`;
  }
  const bad = a.findIndex((v) => !Number.isInteger(v) || v < 0 || v > shape.max);
  return bad === -1 ? null : `${String(a[bad])} at index ${bad} is out of range: an integer in 0..${shape.max}`;
}
