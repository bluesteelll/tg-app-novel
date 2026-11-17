// The `sequence` device's lint half (engine plan §7.1 "BUILD", §7.4; GM8b D1, D7; build only, no node:*): its one
// canonical answer, the order the device shows; the source solution's check; the hint refusal (a device that shows its
// order sells no hints); the parts' rects for the frame check, the replay's last; and the play half's own `reached` /
// `canonical` for the reach pass (mechanics/clues.ts), so the build checks what the player's device posts.
import { SEQUENCE_PLAY } from '../../../src/puzzles/play/sequence.ts';
import type { SequenceParams } from '../../../src/puzzles/rules/sequence.ts';
import type { PuzzleTypeLint } from './index.ts';

/** Whether `a` and `b` hold the same entries in the same order. */
function same(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export const SEQUENCE_LINT = Object.freeze({
  /** The posted canonical answer: the order, which decode holds in range and 2 entries or more, so it always reaches. */
  solve: (p: SequenceParams): readonly number[] => p.order,
  // One canonical answer reaches, the order itself.
  countSolutions: (): 1 => 1,
  /** Null when the source `solution` is the order, the one press list the device posts (`levers`' rule). */
  validateSolution(p: SequenceParams, s: readonly number[]): string | null {
    return same(s, p.order) ? null : `the solution [${s.join(', ')}] is not the order [${p.order.join(', ')}]`;
  },
  /**
   * D1 (Q15b): a sequence device shows its order, so it sells no hint: an empty ladder renders as it is, any other is a
   * throw that quotes the first tier (the error carries no puzzle id, RULINGS 389 A10).
   */
  renderHints(_p: SequenceParams, hints: readonly { ru: string; en: string }[]): readonly { ru: string; en: string }[] {
    const first = hints[0];
    if (first === undefined) {
      return hints;
    }
    throw new Error(`sequence hints: tier 1 of ${hints.length} (ru) is sold, but a sequence device shows its order and sells no hints: "${first.ru}"`);
  },
  // The parts in part order, then the replay: a tap target the frame check judges too, with no `data-cue-part` (it is no
  // part of the answer). Each entry is the decoded params' own rect object, which the frame check locates by identity.
  partRects: (p: SequenceParams) => [...p.rects, p.replay],
  reached: SEQUENCE_PLAY.reached,
  canonical: SEQUENCE_PLAY.canonical,
  // The reach codes are the reach pass's (mechanics/clues.ts), shared by every reach type.
  codes: {},
}) satisfies PuzzleTypeLint<SequenceParams>;
