// The `sequence` device's play half (engine plan §7.1, §7.5; GM8b): chunk code, imported only by its type UI
// (`rules-lazy`) and by the build's lint half, so the player's press is the build's press. Pure. Its value import is the
// data half's prefix rule, an engine module the chunk's UI already reads.
import type { PuzzleTypePlay } from '../rules/index.ts';
import { onOrder } from '../rules/sequence.ts';
import type { SequenceParams } from '../rules/sequence.ts';

/**
 * The least side of a push part, in CSS px: the room's hotspots' (`MIN_TARGET_PX`, explore/controller.ts). A literal,
 * held equal to the controller's by a test: the controller is the explore family's chunk, and `play/levers.ts` is
 * LeverDevice's, never this one's (D10).
 */
export const PART_MIN_PX = 44;

/**
 * The press of part `part` on the presses `a`: a right one (`a` on the order and `part` its next) appends `part` in a
 * fresh array; any other resets to `[]` with `wrong`. Null for no part `part` or a full `a` (the device refuses it).
 */
export function pressSequence(p: SequenceParams, a: readonly number[], part: number): { readonly work: readonly number[]; readonly wrong: boolean } | null {
  if (!Number.isInteger(part) || part < 0 || part >= p.parts || a.length >= p.order.length) {
    return null;
  }
  return onOrder(p.order, a) && p.order[a.length] === part ? { work: [...a, part], wrong: false } : { work: [], wrong: true };
}

/** Whether `a` is the whole order. */
export function reached(p: SequenceParams, a: readonly number[]): boolean {
  return a.length === p.order.length && onOrder(p.order, a);
}

/** What a reached press list posts: the list itself (one order, one answer). */
export function canonical(_p: SequenceParams, a: readonly number[]): readonly number[] {
  return a;
}

export const SEQUENCE_PLAY = Object.freeze({
  // The only answer a sequence device posts is a reached one: it posts itself, there is no Try.
  validAnswer: reached,
  reached,
  canonical,
  // A press the device refuses (no part, a full answer) keeps the work and is no wrong press.
  press: (p: SequenceParams, work: readonly number[], part: number): { work: readonly number[]; wrong: boolean } => pressSequence(p, work, part) ?? { work, wrong: false },
} satisfies PuzzleTypePlay<SequenceParams>);
