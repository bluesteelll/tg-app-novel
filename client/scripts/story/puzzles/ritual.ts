// The `ritual` device's lint half (engine plan §7.1 "BUILD"; GM8b D7, D11; build only, no node:*): its source
// `solution`'s rules and the parts' rects for the frame check.
import { shapeProblem } from '../../../src/puzzles/rules/index.ts';
import { RITUAL_RULES } from '../../../src/puzzles/rules/ritual.ts';
import type { RitualParams } from '../../../src/puzzles/rules/ritual.ts';
import type { PuzzleTypeLint } from './index.ts';

export const RITUAL_LINT = Object.freeze({
  /**
   * Null when `s` is a valid solution: `length` presses, each a part (lint `world/solution`). No start clause: the device
   * shows no configuration before input (`startShown` null), so no solution is seen before it is pressed.
   */
  validateSolution: (p: RitualParams, s: readonly number[]): string | null => shapeProblem(s, RITUAL_RULES.answerShape(p)),
  // A commit type's goal is its one source solution, which the server compares by equality (X5).
  countSolutions: (): 1 => 1,
  // The parts in part order, each the decoded params' own rect object.
  partRects: (p: RitualParams) => p.rects,
  // Its `world/solution*` codes are the core's (LINT_CODES).
  codes: {},
}) satisfies PuzzleTypeLint<RitualParams>;

/**
 * D11: how many answers a per-player `ritual`'s secret may be drawn from: every press list of `length` presses of
 * `parts` parts (the device shows nothing before input, so none is excluded). Per-player's own lint (GM6c1a) wires it
 * to the server's floor (`size >= 1,000`, server/src/puzzles/values.rs); no decode-legal instance gives exactly 1,000.
 */
export function ritualDomainSize(p: RitualParams): number {
  return p.parts ** p.length;
}
