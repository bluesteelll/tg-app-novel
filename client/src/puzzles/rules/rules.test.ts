import { expect, test } from 'vitest';

import { PUZZLE_LINTS } from '../../../scripts/story/puzzles/index.ts';
import type { ItemId } from '../../world/types.ts';
import { CODE_PLAY } from '../play/code.ts';
import { ORDER_PLAY } from '../play/order.ts';
import { PUZZLE_UI } from '../registry.ts';
import { PUZZLE_RULES, PUZZLE_TYPES } from './index.ts';
import type { PuzzleTypeData, PuzzleTypes } from './index.ts';

const code = PUZZLE_RULES.code;
const order = PUZZLE_RULES.order;
const codeLint = PUZZLE_LINTS.code;
const orderLint = PUZZLE_LINTS.order;
const DIALS4 = { dials: 4 };
const MEDALS = { pieces: ['medal_sun', 'medal_moon', 'medal_star'] as ItemId[] }; // a fixture's ids, as decoded

test('rules: code validateSolution rejects out-of-range', () => {
  expect(codeLint.validateSolution(DIALS4, [1, 8, 4, 10])).not.toBeNull();
  expect(codeLint.validateSolution(DIALS4, [1, 8, 4, -1])).not.toBeNull();
  expect(codeLint.validateSolution(DIALS4, [1, 8, 4, 7.5])).not.toBeNull();
  expect(codeLint.validateSolution(DIALS4, [1, 8, 4])).not.toBeNull();
  expect(codeLint.validateSolution(DIALS4, [1, 8, 4, 7, 0])).not.toBeNull();
  // The control: an in-range solution of the right length.
  expect(codeLint.validateSolution(DIALS4, [1, 8, 4, 7])).toBeNull();
  expect(CODE_PLAY.validAnswer(DIALS4, [1, 8, 4, 10])).toBe(false);
  expect(CODE_PLAY.validAnswer(DIALS4, [9, 9, 9, 9])).toBe(true);
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
  expect(orderLint.validateSolution(MEDALS, [0, 0, 1])).not.toBeNull();
  expect(orderLint.validateSolution(MEDALS, [0, 1, 3])).not.toBeNull();
  expect(orderLint.validateSolution(MEDALS, [1, 0])).not.toBeNull();
  // The control: the demo gate's order (the moon before the sun, the star last).
  expect(orderLint.validateSolution(MEDALS, [1, 0, 2])).toBeNull();
  expect(order.initial(MEDALS)).toEqual([0, 1, 2]);
  expect(order.answerShape(MEDALS)).toEqual({ len: 3, max: 2 });
  expect(order.decodeParams({ pieces: ['medal_sun', 'medal_sun'] }).ok).toBe(false);
  expect(order.decodeParams({ pieces: ['a', 'b', 'c', 'd', 'e', 'f'] }).ok).toBe(false);
});

test('rules: solution equal to initial rejected', () => {
  // Both fixtures are shape-valid answers, so only the "differs from initial" rule can reject them.
  expect(CODE_PLAY.validAnswer(DIALS4, [0, 0, 0, 0])).toBe(true);
  const sameCode = codeLint.validateSolution(DIALS4, [0, 0, 0, 0]);
  expect(sameCode).not.toBeNull();
  expect(sameCode).toContain('initial');
  expect(ORDER_PLAY.validAnswer(MEDALS, [0, 1, 2])).toBe(true);
  const sameOrder = orderLint.validateSolution(MEDALS, [0, 1, 2]);
  expect(sameOrder).not.toBeNull();
  expect(sameOrder).toContain('initial');
});

// ---------------------------------------------------------------------------------------------------------------
// The type registry (engine plan §7.1, §7.3): the pins every type's data half keeps, each checked against fixtures
// that break it, so a checker that lost a rule is red here and not only on a future type.

/** A valid commit type to break one field at a time: an overlay with a secret goal, posted wrong answers. */
const COMMIT: PuzzleTypeData<string, unknown> = Object.freeze({
  type: 'fixture',
  check: 'commit',
  goal: 'secret',
  presentation: 'overlay',
  wrong: 'posted',
  commit: 'control',
  decodeParams: (raw: unknown) => ({ ok: true, value: raw }) as const,
  answerShape: () => ({ len: 3, max: 1 }),
  initial: () => [0, 0, 0],
  startShown: () => [0, 0, 0],
});
/** A valid reach view type: a shown goal, no wrong state, a saved working configuration, a demonstration. */
const REACH_VIEW: PuzzleTypeData<string, unknown> = Object.freeze({
  ...COMMIT,
  check: 'reach',
  goal: 'shown',
  presentation: 'view',
  wrong: 'none',
  workFits: () => true,
  demo: () => [0, 1],
});
const fixture = (over: Partial<PuzzleTypeData<string, unknown>>): PuzzleTypes => [{ ...COMMIT, ...over }];

/** Round 3: where a type's wrong input is known follows from when it posts. */
function wrongProblems(types: PuzzleTypes): string[] {
  return types.flatMap((t) => {
    if (t.check === 'commit' && t.wrong !== 'posted') {
      return [`${t.type}: a commit type posts its wrong answers, wrong is '${t.wrong}'`];
    }
    if (t.check === 'reach' && t.wrong === 'posted') {
      return [`${t.type}: a reach type posts no wrong answer, wrong is 'posted'`];
    }
    return [];
  });
}

/** Round 4 and §7.3 (I4): a full commit is a view's, a demonstration never plays a secret, a view saves its work. */
function shapeProblems(types: PuzzleTypes): string[] {
  return types.flatMap((t) => {
    const out: string[] = [];
    if (t.commit === 'full' && (t.check !== 'commit' || t.presentation !== 'view')) {
      out.push(`${t.type}: commit 'full' needs check 'commit' and presentation 'view'`);
    }
    if (t.demo !== undefined && t.goal !== 'shown') {
      out.push(`${t.type}: a demonstration plays a ${t.goal} goal`);
    }
    if ((t.workFits !== undefined) !== (t.presentation === 'view')) {
      out.push(`${t.type}: workFits ${t.workFits === undefined ? 'missing on a view' : 'on an overlay'}`);
    }
    if ((t.check === 'reach') !== (t.goal === 'shown')) {
      out.push(`${t.type}: check '${t.check}' with goal '${t.goal}' (reach iff shown)`);
    }
    return out;
  });
}

test('puzzles: every type has a data half, a loader and a lint', () => {
  const types = PUZZLE_TYPES.map((t) => t.type);
  expect(new Set(types).size).toBe(types.length);
  const sorted = [...types].sort();
  expect(sorted).toEqual(['code', 'order']);
  expect(Object.keys(PUZZLE_RULES).sort()).toEqual(sorted);
  expect(Object.keys(PUZZLE_UI).sort()).toEqual(sorted);
  expect(Object.keys(PUZZLE_LINTS).sort()).toEqual(sorted);
  for (const t of PUZZLE_TYPES) {
    // The keyed view is the registry's own object, not a copy that could drift from it.
    expect(PUZZLE_RULES[t.type], t.type).toBe(t);
    expect(PUZZLE_UI[t.type], t.type).toBeTypeOf('function');
    // `code` and `order` save no working configuration and demonstrate nothing (§7.2).
    expect('workFits' in t, t.type).toBe(false);
    expect('demo' in t, t.type).toBe(false);
  }
  // Their start configuration is shown before any input (§7.1 `startShown`; per-player's floor excludes it).
  expect(code.startShown(DIALS4)).toEqual(code.initial(DIALS4));
  expect(order.startShown(MEDALS)).toEqual(order.initial(MEDALS));
});

test('puzzles: a commit type posts its wrong answers; a reach type has none or a local one', () => {
  expect(wrongProblems(PUZZLE_TYPES)).toEqual([]);
  // The checker against its own fixtures: each breaks the rule once; the valid ones pass.
  expect(wrongProblems(fixture({ wrong: 'none' }))).toEqual(["fixture: a commit type posts its wrong answers, wrong is 'none'"]);
  expect(wrongProblems(fixture({ wrong: 'local' }))).toEqual(["fixture: a commit type posts its wrong answers, wrong is 'local'"]);
  expect(wrongProblems([{ ...REACH_VIEW, wrong: 'posted' }])).toEqual(["fixture: a reach type posts no wrong answer, wrong is 'posted'"]);
  expect(wrongProblems([COMMIT, REACH_VIEW, { ...REACH_VIEW, wrong: 'local' }])).toEqual([]);
});

test('puzzles: a full-commit type is a view commit type and a demonstration shows only a shown goal', () => {
  expect(shapeProblems(PUZZLE_TYPES)).toEqual([]);
  // The checker against its own fixtures: each breaks one rule; the valid ones pass.
  expect(shapeProblems(fixture({ demo: () => [0] }))).toEqual(['fixture: a demonstration plays a secret goal']);
  expect(shapeProblems(fixture({ commit: 'full' }))).toEqual(["fixture: commit 'full' needs check 'commit' and presentation 'view'"]);
  expect(shapeProblems([{ ...REACH_VIEW, commit: 'full' }])).toEqual(["fixture: commit 'full' needs check 'commit' and presentation 'view'"]);
  expect(shapeProblems(fixture({ workFits: () => true }))).toEqual(['fixture: workFits on an overlay']);
  expect(shapeProblems(fixture({ presentation: 'view' }))).toEqual(['fixture: workFits missing on a view']);
  expect(shapeProblems(fixture({ goal: 'shown' }))).toEqual(["fixture: check 'commit' with goal 'shown' (reach iff shown)"]);
  expect(shapeProblems([{ ...REACH_VIEW, goal: 'secret', demo: undefined }])).toEqual([
    "fixture: check 'reach' with goal 'secret' (reach iff shown)",
  ]);
  // A full-commit device (`ritual`'s shape) and a shown reach view (`sequence`'s) are both valid.
  const ritual = { ...COMMIT, commit: 'full', presentation: 'view', workFits: () => true } as const;
  expect(shapeProblems([COMMIT, REACH_VIEW, ritual])).toEqual([]);
});
