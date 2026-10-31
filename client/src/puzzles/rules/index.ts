// The puzzle type rules (docs/PUZZLES-PLAN.md "Puzzle types", X17): one module per type, shared by the world
// decoder, the story lint, the server content emitter and the client's shape pre-check. Pure (X4). Every answer is
// an array of small integers, so the server compares it with the solution without knowing the type (X5).
import type { Result } from '../../story/catalog.ts';
import { CODE_RULES } from './code.ts';
import type { CodeParams } from './code.ts';
import { ORDER_RULES } from './order.ts';
import type { OrderParams } from './order.ts';

export type PuzzleType = 'code' | 'order';

/** The contract of one puzzle type. */
export interface PuzzleRules<P> {
  readonly type: PuzzleType;
  /** The instance's `params` (world/schema reports the error). */
  decodeParams(raw: unknown): Result<P, string>;
  /** Emitted to the server content as `answerLen` / `answerMax`. */
  answerShape(p: P): { len: number; max: number };
  /** The deterministic starting state of the puzzle UI. */
  initial(p: P): readonly number[];
  /** Null when `s` is a valid solution: shape, range, and different from `initial` (lint `world/solution`). */
  validateSolution(p: P, s: readonly number[]): string | null;
  /** The client's shape pre-check of an answer before the attempt request. */
  validAnswer(p: P, a: readonly number[]): boolean;
}

export const PUZZLE_RULES: { readonly code: PuzzleRules<CodeParams>; readonly order: PuzzleRules<OrderParams> } =
  Object.freeze({ code: CODE_RULES, order: ORDER_RULES });

export function isPuzzleType(v: unknown): v is PuzzleType {
  return v === 'code' || v === 'order';
}
