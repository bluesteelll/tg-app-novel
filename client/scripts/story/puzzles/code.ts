// The `code` lock's lint half (engine plan §7.1 "BUILD"; build only, no node:*): its source `solution`'s rules.
import { CODE_RULES } from '../../../src/puzzles/rules/code.ts';
import type { CodeParams } from '../../../src/puzzles/rules/code.ts';
import { shapeProblem } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleTypeLint } from './index.ts';

export const CODE_LINT = Object.freeze({
  /** Null when `s` is a valid solution: shape, range, and different from `initial` (lint `world/solution`). */
  validateSolution(p: CodeParams, s: readonly number[]): string | null {
    const shape = shapeProblem(s, CODE_RULES.answerShape(p));
    if (shape !== null) {
      return shape;
    }
    return s.every((d) => d === 0) ? 'the solution equals the initial state (all zeros)' : null;
  },
  // A commit type's goal is its one source `solution`, which the server compares by equality (X5).
  countSolutions: (): 1 => 1,
  // Its `world/solution*` codes are the core's (LINT_CODES).
  codes: {},
}) satisfies PuzzleTypeLint<CodeParams>;
