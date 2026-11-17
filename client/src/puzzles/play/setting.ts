// The `setting` device's play half (engine plan §7.1, §7.5; GM8a): chunk code, imported only by its type UI
// (`rules-lazy`). Pure.
import { shapeProblem } from '../rules/index.ts';
import type { PuzzleTypePlay } from '../rules/index.ts';
import type { SettingParams } from '../rules/setting.ts';
import { advance } from './levers.ts';

/** The configuration after a turn of knob `part`, in a fresh array; null for no knob `part` or another length. */
export function turnKnob(p: SettingParams, a: readonly number[], part: number): readonly number[] | null {
  if (!Number.isInteger(part) || part < 0 || part >= p.parts || a.length !== p.parts) {
    return null;
  }
  const next = [...a];
  next[part] = advance(next[part] ?? 0, p.positions);
  return next;
}

export const SETTING_PLAY = Object.freeze({
  // Any configuration may be pulled, the start too: whether it opens is the server's (X5).
  validAnswer: (p: SettingParams, a: readonly number[]): boolean => shapeProblem(a, { len: p.parts, max: p.positions - 1 }) === null,
  // A turn is never wrong by itself: a wrong setting is the server's reply to the pull.
  press: (p: SettingParams, work: readonly number[], part: number): { work: readonly number[]; wrong: boolean } => ({ work: turnKnob(p, work, part) ?? work, wrong: false }),
} satisfies PuzzleTypePlay<SettingParams>);
