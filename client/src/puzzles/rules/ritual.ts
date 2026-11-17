// The `ritual` device (engine plan §7.2, §7.5; GM8b D3, D5, D6, D7, D9): `parts` push buttons; the player presses
// `length` of them in a secret order. A press appends its part to the working answer and is never right or wrong by
// itself; the full answer posts itself, and the server's reply says whether it opens. The data half (engine plan §7.1): a
// commit type in its room's view whose secret goal the server checks, posted at full length; any list of in-range presses
// no longer than `length` is a saved work that fits.
import type { Result } from '../../story/catalog.ts';
import type { Rect } from '../../story/staging.ts';
import type { PuzzleTypeData } from './index.ts';
import { count, keyed, rectList } from './levers.ts';

export type RitualParams = {
  readonly parts: number;
  /** How many presses the full answer holds. */
  readonly length: number;
  /** Per part, its rect in room source px. */
  readonly rects: readonly Rect[];
};

const KEYS: readonly string[] = ['parts', 'length', 'rects'];

function decodeParams(raw: unknown): Result<RitualParams, string> {
  const r = keyed(raw, 'ritual', KEYS);
  if (!r.ok) {
    return r;
  }
  const parts = count('parts', r.value.parts, 2, 6);
  if (!parts.ok) {
    return parts;
  }
  const length = count('length', r.value.length, 3, 12);
  if (!length.ok) {
    return length;
  }
  const rects = rectList(r.value.rects, parts.value);
  if (!rects.ok) {
    return rects;
  }
  return { ok: true, value: { parts: parts.value, length: length.value, rects: rects.value } };
}

/**
 * Whether `work` is a list of at most `length` presses, each a part in 0..`parts - 1` and a safe integer. Total over the
 * save codec's domain (GM8a D10): an index loop, so a hole, a non-number or a huge value is a misfit, never a throw.
 */
export function fitsPresses(work: readonly number[], length: number, parts: number): boolean {
  if (work.length > length) {
    return false;
  }
  for (let i = 0; i < work.length; i++) {
    const v = work[i];
    if (v === undefined || !Number.isSafeInteger(v) || v < 0 || v >= parts) {
      return false;
    }
  }
  return true;
}

export const RITUAL_RULES = Object.freeze({
  type: 'ritual',
  check: 'commit',
  goal: 'secret',
  presentation: 'view',
  wrong: 'posted',
  // The full answer posts itself: the device has no commit part.
  commit: 'full',
  decodeParams,
  answerShape: (p: RitualParams): { len: number; max: number } => ({ len: p.length, max: p.parts - 1 }),
  initial: (_p: RitualParams): readonly number[] => [],
  // No full-length configuration shows before input: the presses start empty.
  startShown: (_p: RitualParams): readonly number[] | null => null,
  // Any in-shape list fits; a full-length one restarts at the open (app/yields.ts), as a posted wrong answer does.
  workFits: (p: RitualParams, work: readonly number[]): boolean => fitsPresses(work, p.length, p.parts),
  controls: [{ name: 'push', on: 'pointerdown' }],
} as const satisfies PuzzleTypeData<'ritual', RitualParams>);
