// The `order` puzzle's lint half (engine plan §7.1 "BUILD"; build only, no node:*): its source `solution`'s rules.
import { shapeProblem } from '../../../src/puzzles/rules/index.ts';
import { ORDER_RULES } from '../../../src/puzzles/rules/order.ts';
import type { OrderParams } from '../../../src/puzzles/rules/order.ts';
import type { PuzzleTypeLint } from './index.ts';

export const ORDER_LINT = Object.freeze({
  /** Null when `s` is a valid solution: shape, a permutation, and different from the listed order (`world/solution`). */
  validateSolution(p: OrderParams, s: readonly number[]): string | null {
    const n = p.pieces.length;
    const shape = shapeProblem(s, ORDER_RULES.answerShape(p));
    if (shape !== null) {
      return shape;
    }
    if (new Set(s).size !== n) {
      return `not a permutation of 0..${n - 1}: an index repeats`;
    }
    return s.every((v, i) => v === i) ? 'the solution equals the initial state (the listed order)' : null;
  },
  // A commit type's goal is its one source `solution`, which the server compares by equality (X5).
  countSolutions: (): 1 => 1,
  // Its `world/solution*` codes are the core's (LINT_CODES).
  codes: {},
}) satisfies PuzzleTypeLint<OrderParams>;
