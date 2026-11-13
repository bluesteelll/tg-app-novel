// The puzzle type lint registry (engine plan §7.1 "BUILD", round 4 m5; build only): every puzzle type's lint half,
// keyed by type, so a type without one fails tsc. Pure, no node:*: world.ts imports it and scan-dist.ts imports
// world.ts. Its imports from lint.ts and the halves' from here are `import type`, erased at run time, so the value
// graph is world.ts -> index.ts -> the lint halves with no edge back. Each type lane appends its entry.
import type { ParamsOf, PuzzleType } from '../../../src/puzzles/rules/index.ts';
import type { Severity } from '../lint.ts';
import { CODE_LINT } from './code.ts';
import { ORDER_LINT } from './order.ts';
import { PATH_LINT } from './path.ts';

/** The build half of one puzzle type: what the story gate checks of its instances. */
export interface PuzzleTypeLint<P> {
  /** Commit types: null when the source `solution` is valid for `p`, else why not (`world/solution`). */
  validateSolution?(p: P, s: readonly number[]): string | null;
  /** Reach types: the posted canonical answer, or null when `p` has none. */
  solve?(p: P): readonly number[] | null;
  /**
   * Reach types: the play half's own `reached` (the UI's rule), so the reach pass checks `solve` against what the
   * player's device posts on (engine plan §7.4).
   */
  reached?(p: P, a: readonly number[]): boolean;
  /** Reach types: the play half's own `canonical`, what a reaching answer posts. */
  canonical?(p: P, a: readonly number[]): readonly number[];
  /** Reach types whose goal is drawn: the hidden method, the shortest move list from `initial`. */
  witness?(p: P): readonly number[] | null;
  /** Server hint texts after build-time rendering; identity when absent. */
  renderHints?(p: P, hints: readonly { ru: string; en: string }[]): readonly { ru: string; en: string }[];
  /**
   * The canonical answers that reach the goal, counted up to `cap`; null when a bounded search stopped before it could
   * answer (a finding, never a hang: `world/unique-solution`).
   */
  countSolutions(p: P, cap: 2): 0 | 1 | 2 | null;
}

type PuzzleLints = {
  readonly [T in PuzzleType]: PuzzleTypeLint<ParamsOf<T>> & { readonly codes: { readonly [code: string]: Severity } };
};

/** One lint half per type. `satisfies`, not an annotation: each entry keeps its own members, so the defined ones are
 *  callable without `?.` where the half is named. */
export const PUZZLE_LINTS = Object.freeze({ code: CODE_LINT, order: ORDER_LINT, path: PATH_LINT }) satisfies PuzzleLints;

type CodesOf<L> = L extends { readonly codes: infer C } ? keyof C & string : never;
/** Every code of every PUZZLE_LINTS entry (none yet: `code` and `order` report through the core's, `path` through the
 *  core's and the reach pass's). */
export type PuzzleLintCode = CodesOf<(typeof PUZZLE_LINTS)[PuzzleType]>;
