// The `ritual` device's play half (engine plan §7.1, §7.5; GM8b): chunk code, imported only by its type UI
// (`rules-lazy`). Pure.
import { shapeProblem } from '../rules/index.ts';
import type { PuzzleTypePlay } from '../rules/index.ts';
import type { RitualParams } from '../rules/ritual.ts';

/** The presses `a` with `part` appended, in a fresh array; null for no part `part` or a full `a` (the device refuses it). */
export function pressRitual(p: RitualParams, a: readonly number[], part: number): readonly number[] | null {
  if (!Number.isInteger(part) || part < 0 || part >= p.parts || a.length >= p.length) {
    return null;
  }
  return [...a, part];
}

export const RITUAL_PLAY = Object.freeze({
  // Any full list of in-range presses may be posted: whether it opens is the server's (X5).
  validAnswer: (p: RitualParams, a: readonly number[]): boolean => shapeProblem(a, { len: p.length, max: p.parts - 1 }) === null,
  // A press is never wrong by itself: a wrong ritual is the server's reply to the full answer. A refused press keeps the work.
  press: (p: RitualParams, work: readonly number[], part: number): { work: readonly number[]; wrong: boolean } => ({ work: pressRitual(p, work, part) ?? work, wrong: false }),
} satisfies PuzzleTypePlay<RitualParams>);
