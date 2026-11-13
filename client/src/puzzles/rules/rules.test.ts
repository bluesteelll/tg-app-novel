import { expect, test } from 'vitest';

import { PUZZLE_LINTS } from '../../../scripts/story/puzzles/index.ts';
import { UI_MOTIONS, uiMotion } from '../../cues/stage/motions.ts';
import type { ControlCue, GestureCue } from '../../cues/types.ts';
import type { ChapterId, LineId, PuzzleLocalId } from '../../story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toServer } from '../../world/decode.ts';
import type { ItemId, SourcePuzzle } from '../../world/types.ts';
import { CODE_PLAY } from '../play/code.ts';
import { ORDER_PLAY } from '../play/order.ts';
import { PATH_PLAY, advance, cellAt, cellsAlong, touch } from '../play/path.ts';
import { PUZZLE_UI } from '../registry.ts';
import { PUZZLE_RULES, PUZZLE_TYPES } from './index.ts';
import type { PuzzleTypeData, PuzzleTypes } from './index.ts';
import { PATH_RULES } from './path.ts';
import type { PathParams } from './path.ts';

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
// The `path` type (engine plan §7.2; GM7p D1-D3): its data half and its play half's step rules, read directly.

/** 3 x 2, ends 0 and 3: `0 1 2 / 3 4 5`; its one path is 0 1 2 5 4 3. */
const P32: PathParams = { cols: 3, rows: 2, ends: [0, 3], blocked: [] };
/** 3 x 2, ends 0 and 5: its one path is 0 3 4 1 2 5; 0 1 2 3 4 5 would wrap from row 0 to row 1. */
const P32_WRAP: PathParams = { cols: 3, rows: 2, ends: [0, 5], blocked: [] };
/** 2 x 2, ends 0 and 1: its one path is 0 2 3 1. */
const P22: PathParams = { cols: 2, rows: 2, ends: [0, 1], blocked: [] };
/** 3 x 3, ends 0 and 7, the centre blocked: no path (the open ring holds 0 and 7 apart). */
const P33_HOLE: PathParams = { cols: 3, rows: 3, ends: [0, 7], blocked: [4] };
/** 3 x 3, ends 0 and 8: two paths, 0 1 2 5 4 3 6 7 8 and 0 3 6 7 4 1 2 5 8. */
const P33: PathParams = { cols: 3, rows: 3, ends: [0, 8], blocked: [] };
const P32_SOLVE = [0, 1, 2, 5, 4, 3];

test('rules: path params decode strictly', () => {
  const ok = (raw: unknown): PathParams => {
    const r = PATH_RULES.decodeParams(raw);
    if (!r.ok) {
      throw new Error(`expected ${JSON.stringify(raw)} to decode: ${r.error}`);
    }
    return r.value;
  };
  expect(ok({ cols: 3, rows: 2, ends: [0, 3], blocked: [] })).toEqual(P32);
  expect(ok({ cols: 2, rows: 7, ends: [13, 0], blocked: [1, 12] })).toEqual({ cols: 2, rows: 7, ends: [13, 0], blocked: [1, 12] });
  expect(ok({ cols: 7, rows: 7, ends: [0, 48], blocked: [13, 24] })).toEqual({ cols: 7, rows: 7, ends: [0, 48], blocked: [13, 24] });
  const refused: ReadonlyArray<readonly [unknown, string]> = [
    [{ cols: 1, rows: 2, ends: [0, 1], blocked: [] }, 'cols must be an integer in 2..7'],
    [{ cols: 8, rows: 2, ends: [0, 1], blocked: [] }, 'cols must be an integer in 2..7'],
    [{ cols: 3, rows: 2.5, ends: [0, 1], blocked: [] }, 'rows must be an integer in 2..7'],
    [{ cols: 3, rows: '2', ends: [0, 1], blocked: [] }, 'rows must be an integer in 2..7'],
    [{ cols: 3, rows: 2, ends: [0], blocked: [] }, 'ends must be exactly two distinct cells'],
    [{ cols: 3, rows: 2, ends: [0, 1, 2], blocked: [] }, 'ends must be exactly two distinct cells'],
    [{ cols: 3, rows: 2, ends: [1, 1], blocked: [] }, 'ends: cell 1 is listed twice'],
    [{ cols: 3, rows: 2, ends: [0, 6], blocked: [] }, 'ends: 6 is not a cell in 0..5'],
    [{ cols: 3, rows: 2, ends: [0, 1.5], blocked: [] }, 'ends: 1.5 is not a cell in 0..5'],
    [{ cols: 3, rows: 2, ends: 3, blocked: [] }, 'ends must be an array of cells'],
    [{ cols: 3, rows: 2, ends: [0, 3], blocked: [3] }, 'blocked: cell 3 is an end'],
    [{ cols: 3, rows: 2, ends: [0, 3], blocked: [4, 4] }, 'blocked: cell 4 is listed twice'],
    [{ cols: 3, rows: 2, ends: [0, 3], blocked: [-1] }, 'blocked: -1 is not a cell in 0..5'],
    [{ cols: 3, rows: 2, ends: [0, 3] }, 'missing key blocked'],
    [{ cols: 3, rows: 2, ends: [0, 3], blocked: [], visit: [1] }, "unknown key visit (a path puzzle has 'cols', 'rows', 'ends', 'blocked')"],
    [null, 'params is not an object'],
    [[3, 2], 'params is not an object'],
    ['3x2', 'params is not an object'],
  ];
  for (const [raw, error] of refused) {
    expect(PATH_RULES.decodeParams(raw), JSON.stringify(raw)).toEqual({ ok: false, error });
  }
});

test('rules: path answer is every open cell from end to end', () => {
  // The shape is a function of params: every open cell, so every solution has exactly `len` cells (H1 (1)).
  expect(PATH_RULES.answerShape(P32)).toEqual({ len: 6, max: 5 });
  expect(PATH_RULES.answerShape(P33_HOLE)).toEqual({ len: 8, max: 8 });
  expect(PATH_RULES.initial(P32)).toEqual([]);
  expect(PATH_RULES.startShown(P32)).toBeNull();
  const { reached } = PATH_PLAY;
  expect(reached(P32, P32_SOLVE)).toBe(true);
  expect(reached(P32, [3, 4, 5, 2, 1, 0])).toBe(true);
  expect(reached(P32_WRAP, [0, 3, 4, 1, 2, 5])).toBe(true);
  expect(reached(P22, [0, 2, 3, 1])).toBe(true);
  // Each case breaks one rule only: the others hold for it.
  expect(reached(P32, [0, 1, 4, 3]), 'shorter').toBe(false);
  expect(reached(P22, [0, 3, 2, 1]), 'diagonal steps').toBe(false);
  expect(reached(P32_WRAP, [0, 1, 2, 3, 4, 5]), 'the row end 2 is not next to the row start 3').toBe(false);
  expect(reached(P33_HOLE, [0, 1, 2, 5, 4, 3, 6, 7]), 'through the blocked cell').toBe(false);
  expect(reached(P32, [0, 1, 2, 1, 4, 3]), 'a repeat').toBe(false);
  expect(reached(P32, [1, 2, 5, 4, 3, 0]), 'starts off an end').toBe(false);
  expect(reached(P32, [0, 3, 4, 1, 2, 5]), 'ends off an end').toBe(false);
  expect(reached(P32, []), 'empty').toBe(false);
  // A reached answer is the only one the path posts.
  expect(PATH_PLAY.validAnswer(P32, P32_SOLVE)).toBe(true);
  expect(PATH_PLAY.validAnswer(P32, [0, 1, 2])).toBe(false);
});

test('rules: path canonical form starts at the lower-index end', () => {
  const { canonical } = PATH_PLAY;
  expect(canonical(P32, [3, 4, 5, 2, 1, 0])).toEqual(P32_SOLVE);
  expect(canonical(P32, P32_SOLVE)).toEqual(P32_SOLVE);
  // The order `ends` lists them in does not matter: the lower index starts.
  expect(canonical({ ...P32, ends: [3, 0] }, [3, 4, 5, 2, 1, 0])).toEqual(P32_SOLVE);
  expect(canonical(P33, [8, 5, 2, 1, 4, 7, 6, 3, 0])).toEqual([0, 3, 6, 7, 4, 1, 2, 5, 8]);
});

test('rules: path strokes extend, take back and restart only at an end', () => {
  // An empty path starts only on an end.
  expect(touch(P32, [], 1)).toBeNull();
  expect(advance(P32, [], 0)).toBeNull();
  expect(touch(P32, [], 0)).toEqual([0]);
  expect(touch(P32, [], 3)).toEqual([3]);
  // Extend onto an open neighbour of the end the path does not hold.
  expect(advance(P32, [0], 1)).toEqual([0, 1]);
  expect(advance(P32, [0, 1], 4)).toEqual([0, 1, 4]);
  // Back onto the previous cell takes the last cell back.
  expect(advance(P32, [0, 1, 2], 1)).toEqual([0, 1]);
  expect(touch(P32, [0, 1, 2], 1)).toEqual([0, 1]);
  // Nothing changes: the end itself, a used cell, a blocked cell, a diagonal, the row wrap 2 -> 3.
  expect(advance(P32, [0, 1], 1)).toBeNull();
  expect(advance(P32, [0, 1, 4, 5, 2], 1)).toBeNull();
  expect(advance({ ...P32, blocked: [4] }, [0, 1], 4)).toBeNull();
  expect(advance(P32, [0, 1], 5)).toBeNull();
  expect(advance(P32, [0, 1, 2], 3)).toBeNull();
  // The far end stops the line: on 3 x 3 with ends 0 and 1, a path that reached 1 does not go on to its neighbour 2.
  const ends01: PathParams = { cols: 3, rows: 3, ends: [0, 1], blocked: [] };
  expect(advance(ends01, [0, 3, 4, 1], 2)).toBeNull();
  expect(advance(ends01, [0, 3, 4, 1], 4)).toEqual([0, 3, 4]);
  // A touch on the other end restarts there; on the start end of a longer path too; on the end itself, nothing.
  expect(touch(P32, [0, 1, 2], 3)).toEqual([3]);
  expect(touch(P32, [0, 1, 2], 0)).toEqual([0]);
  expect(touch(P32, [0], 0)).toBeNull();
  expect(touch(P32, [0, 1], 1)).toBeNull();
  // A non-end cell that is no step changes nothing on a touch either.
  expect(touch(P32, [0, 1], 5)).toBeNull();
});

test('rules: path cells along a segment are the cells it crosses', () => {
  const pt = (x: number, y: number): { x: number; y: number } => ({ x, y });
  // A fast move enters every cell it crosses, in order, without the start's own cell.
  expect(cellsAlong(P32, pt(0.5, 0.5), pt(2.5, 0.5))).toEqual([1, 2]);
  expect(cellsAlong(P32, pt(2.5, 1.5), pt(0.5, 1.5))).toEqual([4, 3]);
  expect(cellsAlong(P32, pt(0.5, 0.5), pt(0.5, 1.5))).toEqual([3]);
  expect(cellsAlong(P32, pt(0.2, 0.2), pt(0.8, 0.8))).toEqual([]);
  // Through an exact corner the horizontal neighbour comes first.
  expect(cellsAlong(P32, pt(0.5, 0.5), pt(1.5, 1.5))).toEqual([1, 4]);
  expect(cellsAlong(P32, pt(1.5, 1.5), pt(0.5, 0.5))).toEqual([3, 0]);
  // A long diagonal: (0.1, 0.1) -> (2.9, 1.9) crosses x = 1 (at y 0.68), y = 1 (at x 1.5), then x = 2 (at y 1.32).
  expect(cellsAlong(P32, pt(0.1, 0.1), pt(2.9, 1.9))).toEqual([1, 4, 5]);
  // Off-grid stretches add nothing.
  expect(cellsAlong(P32, pt(-1.5, 0.5), pt(1.5, 0.5))).toEqual([0, 1]);
  expect(cellsAlong(P32, pt(1.5, 0.5), pt(4.5, 0.5))).toEqual([2]);
  expect(cellsAlong(P32, pt(0.5, 0.5), pt(0.5, 3.5))).toEqual([3]);
  // No start: the cell at the point, if any.
  expect(cellsAlong(P32, null, pt(1.5, 1.5))).toEqual([4]);
  expect(cellsAlong(P32, null, pt(-0.5, 0.5))).toEqual([]);
  expect(cellsAlong(P32, pt(0.5, 0.5), pt(Number.NaN, 0.5))).toEqual([]);
  expect(cellsAlong(P32, pt(Number.NaN, 0.5), pt(1.5, 0.5))).toEqual([1]);
  // cellAt: the far edges are off the grid, a non-finite point is no cell.
  expect(cellAt(P32, 0, 0)).toBe(0);
  expect(cellAt(P32, 2.999, 1.999)).toBe(5);
  expect(cellAt(P32, 3, 0)).toBeNull();
  expect(cellAt(P32, 0, 2)).toBeNull();
  expect(cellAt(P32, -0.001, 0)).toBeNull();
  expect(cellAt(P32, Number.NaN, 0)).toBeNull();
  expect(cellAt(P32, 0, Number.POSITIVE_INFINITY)).toBeNull();
});

test('rules: no path step turns one reached answer into another', () => {
  // D3: from a reached answer every step goes back or restarts at an end, so the reach edge needs no reset.
  const solutions: ReadonlyArray<readonly [PathParams, readonly number[]]> = [
    [P32, P32_SOLVE],
    [P32_WRAP, [0, 3, 4, 1, 2, 5]],
    [P33, [0, 1, 2, 5, 4, 3, 6, 7, 8]],
    [P33, [0, 3, 6, 7, 4, 1, 2, 5, 8]],
  ];
  let steps = 0;
  for (const [p, forward] of solutions) {
    for (const a of [forward, [...forward].reverse()]) {
      expect(PATH_PLAY.reached(p, a)).toBe(true);
      for (let c = 0; c < p.cols * p.rows; c++) {
        for (const next of [advance(p, a, c), touch(p, a, c)]) {
          if (next !== null) {
            steps++;
            expect(PATH_PLAY.reached(p, next), `${JSON.stringify(a)} @${c} -> ${JSON.stringify(next)}`).toBe(false);
          }
        }
      }
    }
  }
  // Not vacuous: the reached answers do step (back, and restarts at the other end).
  expect(steps).toBeGreaterThan(8);
});

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** The gesture set derives from the registry: `path-stroke` is its one member (tsc: `never` before the type lands). */
const PATH_GESTURE: Equal<GestureCue, 'path-stroke'> = true;
/** The cell's control joins `ControlCue` through the registry, with no cues/types.ts edit. */
const PATH_CELL: 'path-cell' extends ControlCue ? true : false = true;

test('puzzles: path declares its cell and its stroke', () => {
  expect([PATH_GESTURE, PATH_CELL]).toEqual([true, true]);
  expect(PATH_RULES.controls).toEqual([
    { name: 'path-cell', on: 'click' },
    { name: 'path-stroke', on: 'gesture' },
  ]);
  // Each resolves its trigger kind's default motion: the stroke's step a gesture's, the cell's activation a control's.
  expect(uiMotion('path-stroke')).toEqual(UI_MOTIONS.gesture);
  expect(uiMotion('path-cell')).toEqual(UI_MOTIONS.control);
  expect(UI_MOTIONS.gesture).not.toEqual(UI_MOTIONS.control);
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
  expect(sorted).toEqual(['code', 'order', 'path']);
  expect(Object.keys(PUZZLE_RULES).sort()).toEqual(sorted);
  expect(Object.keys(PUZZLE_UI).sort()).toEqual(sorted);
  expect(Object.keys(PUZZLE_LINTS).sort()).toEqual(sorted);
  for (const t of PUZZLE_TYPES) {
    // The keyed view is the registry's own object, not a copy that could drift from it.
    expect(PUZZLE_RULES[t.type], t.type).toBe(t);
    expect(PUZZLE_UI[t.type], t.type).toBeTypeOf('function');
    // `code`, `order` and `path` save no working configuration and demonstrate nothing (§7.2).
    expect('workFits' in t, t.type).toBe(false);
    expect('demo' in t, t.type).toBe(false);
  }
  // The commit types' start configuration is shown before any input (§7.1 `startShown`; per-player's floor excludes
  // it); a path shows no full-length configuration before input.
  expect(code.startShown(DIALS4)).toEqual(code.initial(DIALS4));
  expect(order.startShown(MEDALS)).toEqual(order.initial(MEDALS));
  expect(PUZZLE_RULES.path.startShown(P32)).toBeNull();
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

// ---------------------------------------------------------------------------------------------------------------
// The runtime seam for fixture types (engine plan §7.1 round 5) and the build's hint renderer, through the decoder.

const GATE = 'gate' as PuzzleLocalId;
/** What the fixture type's `decodeParams` returns: its own object, so a decoded world is seen to keep it. */
const TUMBLER_PARAMS = Object.freeze({ pins: 3 });
/** A fixture type outside PUZZLE_TYPES: three pins, each down (0) or up (1). */
const TUMBLER: PuzzleTypeData<'tumbler', typeof TUMBLER_PARAMS> = {
  type: 'tumbler',
  check: 'commit',
  goal: 'secret',
  presentation: 'overlay',
  wrong: 'posted',
  commit: 'control',
  decodeParams: (raw) =>
    JSON.stringify(raw) === '{"pins":3}' ? { ok: true, value: TUMBLER_PARAMS } : { ok: false, error: 'a tumbler has { "pins": 3 }' },
  answerShape: () => ({ len: 3, max: 1 }),
  initial: () => [1, 1, 1],
  startShown: () => [1, 1, 1],
};

test('puzzles: a fixture type passed as types decodes in a world', () => {
  const types: PuzzleTypes = [...PUZZLE_TYPES, TUMBLER];
  const gate = {
    type: 'tumbler',
    title: { id: 'ch1.gate.0001', ru: 'Засов' },
    prompt: { id: 'ch1.gate.0002', ru: 'Штифты' },
    closeup: null,
    params: { pins: 3 },
    maxAttempts: null,
    giveUp: false,
  };
  const body = { format: 1, items: {}, docs: {}, sections: {} };
  const publicRaw = { ...body, version: '0123456789abcdef', puzzles: { gate: { ...gate, hintTiers: 0 } } };
  const sourceRaw = { ...body, puzzles: { gate: { ...gate, solution: [0, 1, 0], hints: [] } } };
  for (const r of [decodeWorldPublic(publicRaw, { types }), decodeWorldSource(sourceRaw, { types })]) {
    if (!r.ok) {
      throw new Error(`expected the fixture world to decode: ${JSON.stringify(r.error)}`);
    }
    expect(r.value.puzzles[GATE]?.type).toBe('tumbler');
    expect(r.value.puzzles[GATE]?.params).toBe(TUMBLER_PARAMS);
  }
  // Without `types` the decoder knows PUZZLE_TYPES only, and names them.
  const issue = { ok: false, error: [{ path: 'puzzles.gate.type', reason: 'shape', detail: '"tumbler" is not code or order or path' }] };
  expect(decodeWorldPublic(publicRaw)).toEqual(issue);
  expect(decodeWorldSource(sourceRaw)).toEqual(issue);
});

test('puzzles: toServer passes hint texts through the renderer it is given', () => {
  const drawer = {
    type: 'code',
    title: { id: 'ch1.drawer.0001', ru: 'Ящик' },
    prompt: { id: 'ch1.drawer.0002', ru: 'Код' },
    closeup: null,
    params: { dials: 3 },
    maxAttempts: null,
    giveUp: false,
    solution: [1, 2, 3],
    hints: [
      { id: 'ch1.drawer.0003', ru: 'один' },
      { id: 'ch1.drawer.0004', ru: 'два' },
    ],
  };
  const src = decodeWorldSource({ format: 1, items: {}, docs: {}, sections: {}, puzzles: { drawer } });
  if (!src.ok) {
    throw new Error(`expected the world to decode: ${JSON.stringify(src.error)}`);
  }
  const en = { ['ch1.drawer.0001' as LineId]: 'Drawer', ['ch1.drawer.0003' as LineId]: 'one' }; // fixture ids
  const chapter = 'ch1' as ChapterId;
  const plain = toServer(src.value, en, chapter);
  // The default renderer is the identity: the bilingual texts as they are (a missing en falls back to ru).
  expect(plain.puzzles['drawer' as PuzzleLocalId]?.hints).toEqual([
    { ru: 'один', en: 'one' },
    { ru: 'два', en: 'два' },
  ]);
  const seen: SourcePuzzle[] = [];
  const upper = (p: SourcePuzzle, hints: readonly { ru: string; en: string }[]): readonly { ru: string; en: string }[] => {
    seen.push(p);
    return hints.map((h) => ({ ru: h.ru.toUpperCase(), en: h.en }));
  };
  const rendered = toServer(src.value, en, chapter, upper);
  // Only the hints change; the renderer saw the source puzzle.
  const plainDrawer = plain.puzzles['drawer' as PuzzleLocalId];
  expect(rendered).toEqual({
    ...plain,
    puzzles: {
      drawer: {
        ...plainDrawer,
        hints: [
          { ru: 'ОДИН', en: 'one' },
          { ru: 'ДВА', en: 'два' },
        ],
      },
    },
  });
  expect(seen).toEqual([src.value.puzzles['drawer' as PuzzleLocalId]]);
});
