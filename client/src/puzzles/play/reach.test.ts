// The reach report's edge (engine plan §7.1 round 5 W3; GM7r): a reach type UI reports once per turn to reached.
import { expect, test } from 'vitest';

import { reachEdge } from './reach.ts';

test('reach: the edge reports a reached start once and each later turn to reached once', () => {
  const steps = (edge: ReturnType<typeof reachEdge>, reached: readonly boolean[]): boolean[] => reached.map((r) => edge.step(r));
  // A start answer already reached reports at the first call; staying reached reports nothing; each later turn to
  // reached (a turn back after a restart included) reports once.
  const one = reachEdge();
  expect(steps(one, [true, true, false, true, true, false, false, true])).toEqual([true, false, false, true, false, false, false, true]);
  // An unreached start reports nothing until the answer turns reached.
  expect(steps(reachEdge(), [false, true])).toEqual([false, true]);
  // One edge per mount: two edges are independent.
  const a = reachEdge();
  const b = reachEdge();
  expect([a.step(true), b.step(false), a.step(true), b.step(true)]).toEqual([true, false, false, true]);
});
