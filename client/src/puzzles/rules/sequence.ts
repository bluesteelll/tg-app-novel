// The `sequence` device (engine plan §7.2, §7.5; GM8b D3, D5, D6, D7, D9): `parts` push buttons and an `order` the
// device demonstrates; the player presses the parts in that order. A right press appends its part to the working
// answer, a wrong one resets it to empty and counts one attempt on the device itself, and the answer posts itself once it
// equals `order`. The data half (engine plan §7.1): a reach type in its room's view with a local wrong state, whose saved
// work fits while it is a prefix of `order`.
import type { Result } from '../../story/catalog.ts';
import type { Rect } from '../../story/staging.ts';
import type { PuzzleTypeData } from './index.ts';
import { count, keyed, rect, rectList } from './levers.ts';

export type SequenceParams = {
  readonly parts: number;
  /** The order the device shows and the player repeats: part indexes, repeats and parts it never names allowed. */
  readonly order: readonly number[];
  /** Per part, its rect in room source px. */
  readonly rects: readonly Rect[];
  /** The replay control's rect: it asks for the demonstration again and is no part. */
  readonly replay: Rect;
};

const KEYS: readonly string[] = ['parts', 'order', 'rects', 'replay'];

const show = (v: unknown): string => JSON.stringify(v) ?? 'undefined';

/** `order` as decoded: 2..12 parts, each an integer in 0..`parts - 1`; else why not. */
function orderOf(v: unknown, parts: number): Result<number[], string> {
  if (!Array.isArray(v) || v.length < 2 || v.length > 12) {
    return { ok: false, error: 'order must be an array of 2..12 parts' };
  }
  const out: number[] = [];
  for (const [i, part] of v.entries()) {
    if (typeof part !== 'number' || !Number.isInteger(part) || part < 0 || part >= parts) {
      return { ok: false, error: `order: ${show(part)} at ${i} is not a part in 0..${parts - 1}` };
    }
    out.push(part);
  }
  return { ok: true, value: out };
}

function decodeParams(raw: unknown): Result<SequenceParams, string> {
  const r = keyed(raw, 'sequence', KEYS);
  if (!r.ok) {
    return r;
  }
  const parts = count('parts', r.value.parts, 2, 8);
  if (!parts.ok) {
    return parts;
  }
  const order = orderOf(r.value.order, parts.value);
  if (!order.ok) {
    return order;
  }
  const rects = rectList(r.value.rects, parts.value);
  if (!rects.ok) {
    return rects;
  }
  const replay = rect('replay', r.value.replay);
  if (!replay.ok) {
    return replay;
  }
  return { ok: true, value: { parts: parts.value, order: order.value, rects: rects.value, replay: replay.value } };
}

/**
 * Whether `work` is a prefix of `order`, the whole order included. Total over the save codec's domain (GM8a D10): an
 * index loop, so a hole reads `undefined` and fits nothing; a non-number or an out-of-range value equals no part.
 */
export function onOrder(order: readonly number[], work: readonly number[]): boolean {
  if (work.length > order.length) {
    return false;
  }
  for (let i = 0; i < work.length; i++) {
    if (work[i] !== order[i]) {
      return false;
    }
  }
  return true;
}

export const SEQUENCE_RULES = Object.freeze({
  type: 'sequence',
  check: 'reach',
  goal: 'shown',
  presentation: 'view',
  // A press off the order is wrong on the device itself: it resets the presses and counts one attempt, with no POST.
  wrong: 'local',
  // Unused for a reach type: the presses post themselves once they equal the order.
  commit: 'control',
  decodeParams,
  // The answer is the order pressed in full (GM7r Q-08: the server takes exactly `answer_len` entries).
  answerShape: (p: SequenceParams): { len: number; max: number } => ({ len: p.order.length, max: p.parts - 1 }),
  initial: (_p: SequenceParams): readonly number[] => [],
  // No full-length configuration shows before input: the presses start empty.
  startShown: (_p: SequenceParams): readonly number[] | null => null,
  // A work off the order (an older version's) could fill to full length unreached, and a full press is refused: a soft
  // lock. A prefix of the order fits; anything else goes and the device starts over (D3).
  workFits: (p: SequenceParams, work: readonly number[]): boolean => onOrder(p.order, work),
  // The device plays its order (§7.5 "Demonstration"): the decoded own array.
  demo: (p: SequenceParams): readonly number[] => p.order,
  controls: [
    { name: 'push', on: 'pointerdown' },
    { name: 'sequence-replay', on: 'click' },
  ],
} as const satisfies PuzzleTypeData<'sequence', SequenceParams>);
