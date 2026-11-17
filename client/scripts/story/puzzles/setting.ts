// The `setting` device's lint half (engine plan §7.1 "BUILD"; GM8a D3; build only, no node:*): its source
// `solution`'s rules and the parts' rects for the frame check, the pull's last.
import { shapeProblem } from '../../../src/puzzles/rules/index.ts';
import { SETTING_RULES } from '../../../src/puzzles/rules/setting.ts';
import type { SettingParams } from '../../../src/puzzles/rules/setting.ts';
import type { PuzzleTypeLint } from './index.ts';

export const SETTING_LINT = Object.freeze({
  /** Null when `s` is a valid solution: shape, range, and different from the start shown (lint `world/solution`). */
  validateSolution(p: SettingParams, s: readonly number[]): string | null {
    const shape = shapeProblem(s, SETTING_RULES.answerShape(p));
    if (shape !== null) {
      return shape;
    }
    return s.every((v) => v === 0) ? 'the solution equals the initial state (all zeros)' : null;
  },
  // A commit type's goal is its one source `solution`, which the server compares by equality (X5).
  countSolutions: (): 1 => 1,
  // The knobs in part order, then the pull: a part too, with no `data-cue-part` (it is no position of the answer).
  partRects: (p: SettingParams) => [...p.rects, p.pull],
  // Its `world/solution*` codes are the core's (LINT_CODES).
  codes: {},
}) satisfies PuzzleTypeLint<SettingParams>;

/**
 * D1: how many configurations a per-player `setting`'s secret may be drawn from: every one the knobs hold but the start
 * the device shows (all zeros, `startShown`). Per-player's own lint (GM6c1a) wires it to the server's floor
 * (`size >= 1,000`, server/src/puzzles/values.rs); no decode-legal instance gives exactly 1,000.
 */
export function settingDomainSize(p: SettingParams): number {
  return p.positions ** p.parts - 1;
}
