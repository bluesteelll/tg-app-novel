// Per-player GM6t: the toast motion table against the cue gate, and the ghost stack `Toast.svelte` renders.
import { expect, test } from 'vitest';

import { MIN_VISIBLE_MS } from '../cues/types.ts';
import { keyframesVisible } from '../cues/visible.ts';
import type { ToastEntry } from './state.svelte.ts';
import { stackOf, TOAST_MOTIONS, type ToastSlot } from './toast-motion.ts';

const note = (key: string): ToastEntry => ({ kind: 'note', key, message: `note ${key}`, sticky: false });
const live = (...keys: string[]): ToastSlot[] => keys.map((key) => ({ entry: note(key), leave: null }));
/** A stack as `key` (live) or `key:token` (a ghost under its leave token). */
const shape = (slots: readonly ToastSlot[]): string[] =>
  slots.map((s) => (s.leave === null ? s.entry.key : `${s.entry.key}:${s.leave}`));

test('toast-motion: every toast motion changes a visible property for >= 120 ms', () => {
  expect(Object.keys(TOAST_MOTIONS).sort()).toEqual(['in', 'out', 'swap']);
  for (const [kind, { full, reduced }] of Object.entries(TOAST_MOTIONS)) {
    for (const [form, def] of [
      ['full', full],
      ['reduced', reduced],
    ] as const) {
      expect(keyframesVisible(def.keyframes), `${kind} ${form}`).toBe(true);
      expect(def.ms, `${kind} ${form}`).toBeGreaterThanOrEqual(MIN_VISIBLE_MS);
    }
  }
});

test('toast-motion: reduced motion animates opacity only', () => {
  for (const [kind, { reduced }] of Object.entries(TOAST_MOTIONS)) {
    expect(reduced.keyframes.length, kind).toBeGreaterThanOrEqual(2);
    for (const frame of reduced.keyframes) {
      expect(Object.keys(frame).filter((k) => k !== 'offset'), kind).toEqual(['opacity']);
    }
    expect(new Set(reduced.keyframes.map((f) => f.opacity)).size, kind).toBeGreaterThan(1);
  }
});

test('toast-motion: a removed entry stays a ghost at its index until its token ends', () => {
  const first = stackOf(live('a', 'b', 'c'), [note('a'), note('c')], new Set(), 0);
  expect([shape(first.slots), first.token]).toEqual([['a', 'b:0', 'c'], 1]);
  // The ghost keeps its last live entry, so it renders what it showed.
  expect(first.slots[1]?.entry.message).toBe('note b');
  // A ghost keeps its token while it waits; its token ending drops it.
  const waiting = stackOf(first.slots, [note('a'), note('c')], new Set(), first.token);
  expect([shape(waiting.slots), waiting.token]).toEqual([['a', 'b:0', 'c'], 1]);
  const dropped = stackOf(first.slots, [note('a'), note('c')], new Set([0]), first.token);
  expect([shape(dropped.slots), dropped.token]).toEqual([['a', 'c'], 1]);

  // Two leaves at once take their tokens in the previous stack's order, each at its own index.
  const two = stackOf(live('a', 'b', 'c'), [note('c')], new Set(), 5);
  expect([shape(two.slots), two.token]).toEqual([['a:5', 'b:6', 'c'], 7]);
  // An index past the new stack's end is clamped to it: x's drop leaves y's index 1 past the end.
  const tail = stackOf([{ entry: note('x'), leave: 9 }, ...live('y')], [], new Set([9]), 0);
  expect([shape(tail.slots), tail.token]).toEqual([['y:0'], 1]);
});

test('toast-motion: a key shown again is never a ghost', () => {
  const prev: ToastSlot[] = [{ entry: note('a'), leave: 3 }];
  const again = { ...note('a'), message: 'again' };
  const next = stackOf(prev, [again], new Set(), 4);
  expect([shape(next.slots), next.token]).toEqual([['a'], 4]);
  expect(next.slots[0]?.entry).toBe(again);
  // A ghost and a live entry under one key never both render: the keys stay distinct.
  const mixed = stackOf([...prev, ...live('b')], [note('b'), note('a')], new Set(), 4);
  expect(shape(mixed.slots)).toEqual(['b', 'a']);
});

test('toast-motion: a key that left, came back and leaves again is a new ghost until its own leave ends', () => {
  const left = stackOf(live('a'), [], new Set(), 0);
  expect([shape(left.slots), left.token]).toEqual([['a:0'], 1]);
  const back = stackOf(left.slots, [note('a')], new Set(), left.token);
  expect([shape(back.slots), back.token]).toEqual([['a'], 1]);
  // The first leave's end arrives only after the key is live again: it must not end the second leave.
  const again = stackOf(back.slots, [], new Set([0]), back.token);
  expect([shape(again.slots), again.token]).toEqual([['a:1'], 2]);
  const still = stackOf(again.slots, [], new Set([0]), again.token);
  expect(shape(still.slots)).toEqual(['a:1']);
  const gone = stackOf(still.slots, [], new Set([0, 1]), still.token);
  expect([shape(gone.slots), gone.token]).toEqual([[], 2]);
});
