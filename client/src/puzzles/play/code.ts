// The `code` lock's play half (engine plan §7.1): chunk code, imported only by its type UI (`rules-lazy`). Pure.
import { CODE_RULES } from '../rules/code.ts';
import type { CodeParams } from '../rules/code.ts';
import { shapeProblem } from '../rules/index.ts';
import type { PuzzleTypePlay } from '../rules/index.ts';

export const CODE_PLAY: PuzzleTypePlay<CodeParams> = Object.freeze({
  // Any digit per dial may be tried: whether it opens is the server's (X5).
  validAnswer: (p: CodeParams, a: readonly number[]) => shapeProblem(a, CODE_RULES.answerShape(p)) === null,
});
