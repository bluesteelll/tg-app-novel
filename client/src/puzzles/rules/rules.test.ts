import { expect, test } from 'vitest';

import type { ItemId } from '../../world/types.ts';
import { PUZZLE_RULES } from './index.ts';

const code = PUZZLE_RULES.code;
const order = PUZZLE_RULES.order;
const DIALS4 = { dials: 4 };
const MEDALS = { pieces: ['medal_sun', 'medal_moon', 'medal_star'] as ItemId[] }; // a fixture's ids, as decoded

test('rules: code validateSolution rejects out-of-range', () => {
  expect(code.validateSolution(DIALS4, [1, 8, 4, 10])).not.toBeNull();
  expect(code.validateSolution(DIALS4, [1, 8, 4, -1])).not.toBeNull();
  expect(code.validateSolution(DIALS4, [1, 8, 4, 7.5])).not.toBeNull();
  expect(code.validateSolution(DIALS4, [1, 8, 4])).not.toBeNull();
  expect(code.validateSolution(DIALS4, [1, 8, 4, 7, 0])).not.toBeNull();
  // The control: an in-range solution of the right length.
  expect(code.validateSolution(DIALS4, [1, 8, 4, 7])).toBeNull();
  expect(code.validAnswer(DIALS4, [1, 8, 4, 10])).toBe(false);
  expect(code.validAnswer(DIALS4, [9, 9, 9, 9])).toBe(true);
});

test('rules: code initial is all zeros', () => {
  expect(code.initial(DIALS4)).toEqual([0, 0, 0, 0]);
  expect(code.initial({ dials: 2 })).toEqual([0, 0]);
  expect(code.answerShape(DIALS4)).toEqual({ len: 4, max: 9 });
  expect(code.decodeParams({ dials: 4 })).toEqual({ ok: true, value: DIALS4 });
  expect(code.decodeParams({ dials: 7 }).ok).toBe(false);
  expect(code.decodeParams({ dials: 1 }).ok).toBe(false);
});

test('rules: order solution must be a permutation', () => {
  expect(order.validateSolution(MEDALS, [0, 0, 1])).not.toBeNull();
  expect(order.validateSolution(MEDALS, [0, 1, 3])).not.toBeNull();
  expect(order.validateSolution(MEDALS, [1, 0])).not.toBeNull();
  // The control: the demo gate's order (the moon before the sun, the star last).
  expect(order.validateSolution(MEDALS, [1, 0, 2])).toBeNull();
  expect(order.initial(MEDALS)).toEqual([0, 1, 2]);
  expect(order.answerShape(MEDALS)).toEqual({ len: 3, max: 2 });
  expect(order.decodeParams({ pieces: ['medal_sun', 'medal_sun'] }).ok).toBe(false);
  expect(order.decodeParams({ pieces: ['a', 'b', 'c', 'd', 'e', 'f'] }).ok).toBe(false);
});

test('rules: solution equal to initial rejected', () => {
  // Both fixtures are shape-valid answers, so only the "differs from initial" rule can reject them.
  expect(code.validAnswer(DIALS4, [0, 0, 0, 0])).toBe(true);
  const sameCode = code.validateSolution(DIALS4, [0, 0, 0, 0]);
  expect(sameCode).not.toBeNull();
  expect(sameCode).toContain('initial');
  expect(order.validAnswer(MEDALS, [0, 1, 2])).toBe(true);
  const sameOrder = order.validateSolution(MEDALS, [0, 1, 2]);
  expect(sameOrder).not.toBeNull();
  expect(sameOrder).toContain('initial');
});
