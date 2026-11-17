// The push devices' build halves (engine plan §7.1 "BUILD", §7.4; GM8b D1, D7, D11): the `sequence` hint refusal and
// solution check, the `ritual` solution check and per-player domain size, and the part rects the frame check reads.
import { expect, test } from 'vitest';

import { RITUAL_RULES } from '../../../src/puzzles/rules/ritual.ts';
import type { RitualParams } from '../../../src/puzzles/rules/ritual.ts';
import { SEQUENCE_RULES } from '../../../src/puzzles/rules/sequence.ts';
import type { SequenceParams } from '../../../src/puzzles/rules/sequence.ts';
import type { Rect } from '../../../src/story/staging.ts';
import { RITUAL_LINT, ritualDomainSize } from './ritual.ts';
import { SEQUENCE_LINT } from './sequence.ts';

/** Slot `i` of a 5-column grid of 150 px squares inside HOTSPOT_SAFE_FRAME and the device band, none overlapping (B4). */
const slot = (i: number): Rect => [80 + (i % 5) * 190, 760 + Math.floor(i / 5) * 200, 150, 150];
/** `n` part rects, slots 0..`n - 1`; slot `n` is the replay's. */
const rowRects = (n: number): Rect[] => Array.from({ length: n }, (_, i) => slot(i));
/** 3 parts, the order 0 2 1, the replay in slot 3. */
const SQ3: SequenceParams = { parts: 3, order: [0, 2, 1], rects: rowRects(3), replay: slot(3) };
/** 3 parts, 5 presses. */
const RT35: RitualParams = { parts: 3, length: 5, rects: rowRects(3) };

const ladder = (...tiers: ReadonlyArray<readonly [string, string]>): { ru: string; en: string }[] => tiers.map(([ru, en]) => ({ ru, en }));
const T1: readonly [string, string] = ['Колокола звонят по порядку.', 'The bells ring in turn.'];
const T2: readonly [string, string] = ['Первый — левый.', 'The left one is first.'];
const T3: readonly [string, string] = ['Слева, справа, середина.', 'Left, right, middle.'];

/** The message `renderHints` throws for `hints`, or null when it renders them. */
function refusal(hints: readonly { ru: string; en: string }[]): string | null {
  try {
    SEQUENCE_LINT.renderHints(SQ3, hints);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

test('story: sequence hints are refused', () => {
  // c6 (D1): the device shows its order (a demonstration), so it sells no hint: any ladder is a build error that quotes
  // its first tier, a one-tier ladder and a longer one alike.
  expect(refusal(ladder(T1))).toBe(`sequence hints: tier 1 of 1 (ru) is sold, but a sequence device shows its order and sells no hints: "${T1[0]}"`);
  expect(refusal(ladder(T1, T2, T3))).toBe(`sequence hints: tier 1 of 3 (ru) is sold, but a sequence device shows its order and sells no hints: "${T1[0]}"`);
  // The control: no tier sold, nothing mis-sold; the empty ladder is returned as it is.
  const none: { ru: string; en: string }[] = [];
  expect(SEQUENCE_LINT.renderHints(SQ3, none)).toBe(none);
  expect(refusal([])).toBeNull();
});

test('sequence: the solution check refuses any answer but the order', () => {
  const v = (s: readonly number[]): string | null => SEQUENCE_LINT.validateSolution(SQ3, s);
  expect(v([0, 2, 1])).toBeNull();
  expect(v([0, 1, 2])).toBe('the solution [0, 1, 2] is not the order [0, 2, 1]');
  expect(v([0, 2])).toBe('the solution [0, 2] is not the order [0, 2, 1]');
  expect(v([0, 2, 1, 0])).toBe('the solution [0, 2, 1, 0] is not the order [0, 2, 1]');
  // One canonical answer, the order: the reach pass's solution.
  expect(SEQUENCE_LINT.solve(SQ3)).toEqual([0, 2, 1]);
  expect(SEQUENCE_LINT.countSolutions()).toBe(1);
});

test('ritual: the solution check refuses a misshapen answer', () => {
  const v = (s: readonly number[]): string | null => RITUAL_LINT.validateSolution(RT35, s);
  expect(v([2, 0, 1, 1, 2])).toBeNull();
  // No start clause: the device shows nothing before input, so a list of zeros is a secret like any other.
  expect(v([0, 0, 0, 0, 0])).toBeNull();
  expect(v([2, 0, 1, 1])).toBe('length 4, expected 5');
  expect(v([2, 0, 1, 1, 3])).toBe('3 at index 4 is out of range: an integer in 0..2');
  expect(v([2, 0, 1, 1, 0.5])).toBe('0.5 at index 4 is out of range: an integer in 0..2');
  // A commit type's goal is its one source solution.
  expect(RITUAL_LINT.countSolutions()).toBe(1);
});

test("sequence, ritual: partRects gives each part's own rect, the replay last", () => {
  // D7 (GM8b-B3): the frame check (GM8a2) reads every tap target's rect through the lint half and locates each among the
  // decoded params by identity, so each entry is the decoder's own rect object, the replay's last.
  const decodedSequence = SEQUENCE_RULES.decodeParams(SQ3);
  const decodedRitual = RITUAL_RULES.decodeParams(RT35);
  if (!decodedSequence.ok || !decodedRitual.ok) {
    throw new Error(`invariant: the fixtures decode: ${JSON.stringify([decodedSequence, decodedRitual])}`);
  }
  const s = decodedSequence.value;
  const sr = SEQUENCE_LINT.partRects(s);
  expect(sr).toHaveLength(s.parts + 1);
  s.rects.forEach((r, i) => expect(sr[i], `part ${i}`).toBe(r));
  expect(sr.at(-1)).toBe(s.replay);
  expect(sr).toEqual([...rowRects(3), slot(3)]);
  const r = decodedRitual.value;
  const rr = RITUAL_LINT.partRects(r);
  expect(rr).toHaveLength(r.parts);
  r.rects.forEach((x, i) => expect(rr[i], `part ${i}`).toBe(x));
  expect(rr).toEqual(rowRects(3));
});

test('ritual: the per-player domain counts every press sequence of its length', () => {
  // D11 (c8): a per-player `ritual` draws its secret from every list of `length` presses of `parts` parts: parts ^ length.
  // Exact values, not a comparison with the server's floor of 1,000 (729 and 1,024 lie either side of it).
  const presses = (parts: number, length: number): RitualParams => ({ parts, length, rects: rowRects(parts) });
  expect(ritualDomainSize(presses(3, 6))).toBe(729);
  expect(ritualDomainSize(presses(4, 5))).toBe(1024);
  expect(ritualDomainSize(presses(6, 4))).toBe(1296);
  expect(ritualDomainSize(presses(2, 3))).toBe(8);
  expect(ritualDomainSize(presses(6, 12))).toBe(2_176_782_336);
});
