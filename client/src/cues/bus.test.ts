// The cue bus (engine plan §8.1 "Loading"): a cue emitted before the stage subscribes is held and replayed once, in
// order; a hold past its limit, and anything still held at dispose, counts as an orphan.
import { expect, test } from 'vitest';

import type { PuzzleLocalId } from '../story/staging.ts';
import { createCueBus, CUE_HOLD_MAX } from './bus.ts';
import type { CueEvent } from './types.ts';

function event(index: number): CueEvent {
  // A fixture puzzle id; the brand is the world decoder's.
  const puzzle = 'drawer' as PuzzleLocalId;
  return { cue: { kind: 'puzzle', puzzle, name: 'input', index }, box: null, point: null, diff: [], el: null };
}

const indexOf = (e: CueEvent): number | null => (e.cue.kind === 'puzzle' ? e.cue.index : null);

test('bus: a cue emitted before the overlay subscribes plays once, in order, at subscribe', () => {
  const bus = createCueBus();
  const scene: (number | null)[] = [];
  const first: (number | null)[] = [];
  const second: (number | null)[] = [];
  bus.subscribe('scene', (e) => scene.push(indexOf(e)));
  bus.emit(event(0));
  bus.emit(event(1));
  bus.emit(event(2));
  const unsubscribeFirst = bus.subscribe('overlay', (e) => first.push(indexOf(e)));
  expect(first).toEqual([0, 1, 2]);
  bus.emit(event(3));
  expect(first).toEqual([0, 1, 2, 3]);
  // A re-mount replaces the first subscriber: nothing is replayed twice, and each cue plays once.
  bus.subscribe('overlay', (e) => second.push(indexOf(e)));
  expect(second).toEqual([]);
  bus.emit(event(4));
  // A stale unsubscribe of the replaced subscriber leaves the new one.
  unsubscribeFirst();
  bus.emit(event(5));
  expect(first).toEqual([0, 1, 2, 3]);
  expect(second).toEqual([4, 5]);
  expect(scene).toEqual([0, 1, 2, 3, 4, 5]);
  expect(bus.orphans()).toBe(0);
});

test('bus: a hold past CUE_HOLD_MAX counts the dropped cues as orphans', () => {
  const bus = createCueBus();
  for (let i = 0; i < CUE_HOLD_MAX + 2; i += 1) {
    bus.emit(event(i));
  }
  expect(bus.orphans()).toBe(2);
  const got: (number | null)[] = [];
  const unsubscribe = bus.subscribe('overlay', (e) => got.push(indexOf(e)));
  expect(got).toEqual(Array.from({ length: CUE_HOLD_MAX }, (_, i) => i + 2));
  // Held again once the stage is gone; three still held at dispose are orphans too.
  unsubscribe();
  bus.emit(event(100));
  bus.emit(event(101));
  bus.emit(event(102));
  bus.dispose();
  expect(bus.orphans()).toBe(5);
  expect(got).toHaveLength(CUE_HOLD_MAX);
  // A cue a yield emits after the session's teardown reaches no subscriber, live or replayed, and is not held.
  const scene: (number | null)[] = [];
  bus.subscribe('scene', (e) => scene.push(indexOf(e)));
  bus.emit(event(103));
  const late: (number | null)[] = [];
  bus.subscribe('overlay', (e) => late.push(indexOf(e)));
  expect(late).toEqual([]);
  expect(scene).toEqual([]);
  expect(bus.orphans()).toBe(5);
});
