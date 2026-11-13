// The `grid` puzzle's build half (engine plan §7.1 "BUILD", §7.4; GM7g D4): the bounded fill search, the solution
// check, and the equalities of H1 that keep a filled grid from ever posting what the server does not hold.
import { expect, test } from 'vitest';

import { GRID_PLAY } from '../../../src/puzzles/play/grid.ts';
import { GRID_RULES } from '../../../src/puzzles/rules/grid.ts';
import type { GridParams } from '../../../src/puzzles/rules/grid.ts';
import { PUZZLE_TYPES, instanceOf, shapeProblem } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleTypeData, PuzzleTypes } from '../../../src/puzzles/rules/index.ts';
import type { ChapterId, PuzzleLocalId } from '../../../src/story/staging.ts';
import { decodeWorldSource, toServer } from '../../../src/world/decode.ts';
import { GRID_LINT, GRID_SEARCH_STEPS, countFills, searchFills } from './grid.ts';
import { PUZZLE_LINTS } from './index.ts';
import { answerLenIssues, postedLength } from './shape.ts';
import type { PuzzleLintRegistry } from './shape.ts';

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

/** The cyclic square `(r + c) mod n + 1` of side `n` and, as its params, the same with the diagonal blank: each row
 *  and column lacks one symbol only, so the square is the one fill. */
function cyclic(n: number): { readonly params: GridParams; readonly fill: readonly number[] } {
  const fill = Array.from({ length: n * n }, (_, c) => ((Math.floor(c / n) + (c % n)) % n) + 1);
  const given = fill.map((v, c) => (Math.floor(c / n) === c % n ? 0 : v));
  return { params: { rows: n, cols: n, symbols: n, given }, fill };
}

/** 2 x 2 over 2 symbols, cell 0 given 1: one fill, 1 2 / 2 1. */
const G22: GridParams = { rows: 2, cols: 2, symbols: 2, given: [1, 0, 0, 0] };
/** 2 x 2 over 2 symbols, nothing given: two fills, 1 2 / 2 1 and 2 1 / 1 2. */
const G22_EMPTY: GridParams = { rows: 2, cols: 2, symbols: 2, given: zeros(4) };
/** 2 x 2 over 2 symbols, 1 given twice in row 0: no fill. */
const G22_CLASH: GridParams = { rows: 2, cols: 2, symbols: 2, given: [1, 1, 0, 0] };
/**
 * The same clash over 3 symbols: with more symbols than a line holds no line is full, so only the givens pre-check sees
 * it (without it the search fills row 1 twice, 2 3 and 3 2, under the clash).
 */
const G22_CLASH_WIDE: GridParams = { rows: 2, cols: 2, symbols: 3, given: [1, 1, 0, 0] };
/** 2 x 2 over 2 symbols, every cell given: its own fill, with no extension. */
const G22_FULL: GridParams = { rows: 2, cols: 2, symbols: 2, given: [1, 2, 2, 1] };
/** 2 rows x 3 columns over 3 symbols: one fill, 1 2 3 / 2 3 1. */
const G23: GridParams = { rows: 2, cols: 3, symbols: 3, given: [1, 2, 0, 0, 0, 1] };
const G23_FILL = [1, 2, 3, 2, 3, 1];
/** 3 x 3 over 3 symbols: one fill, 1 2 3 / 2 3 1 / 3 1 2. */
const G33: GridParams = { rows: 3, cols: 3, symbols: 3, given: [1, 2, 0, 0, 0, 1, 0, 1, 0] };
const G33_FILL = [1, 2, 3, 2, 3, 1, 3, 1, 2];
/** 3 x 3 over 3 symbols, nothing given: the search stops at its second fill. */
const G33_EMPTY: GridParams = { rows: 3, cols: 3, symbols: 3, given: zeros(9) };
/**
 * 4 x 4 over 4 symbols, 1 at cells 0, 5 and 10 and 2 at cell 15: every empty cell has a candidate, but row 3 has no
 * place for 1 (columns 0-2 hold one), so the line-symbol check proves it has no fill at the root.
 */
const G44_HIDDEN: GridParams = { rows: 4, cols: 4, symbols: 4, given: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2] };
/** 5 x 5 over 5 symbols: the cyclic square with its diagonal blank (25 cells, one fill). */
const G55 = cyclic(5);
/** The largest decode-legal grid, 6 x 6 over 6 symbols, as the cyclic square with its diagonal blank (one fill). */
const G66_UNIQUE = cyclic(6);
/** 6 x 6 over 6 symbols, nothing given: two fills or more. */
const G66_EMPTY: GridParams = { rows: 6, cols: 6, symbols: 6, given: zeros(36) };

test('grid: solve finds the one fill', () => {
  expect(GRID_LINT.solve(G22)).toEqual([1, 2, 2, 1]);
  expect(GRID_LINT.solve(G23)).toEqual(G23_FILL);
  expect(GRID_LINT.solve(G33)).toEqual(G33_FILL);
  expect(GRID_LINT.solve(G55.params)).toEqual(G55.fill);
  expect(GRID_LINT.solve(G66_UNIQUE.params)).toEqual(G66_UNIQUE.fill);
  // A fully given grid is its own fill, found with no extension.
  expect(GRID_LINT.solve(G22_FULL)).toEqual([1, 2, 2, 1]);
  expect(searchFills(G22_FULL)).toEqual({ fills: [[1, 2, 2, 1]], complete: true, steps: 0 });
  // No fill, each proven at the root: equal givens in a line (the pre-check; G22_CLASH_WIDE has no full line), and a
  // symbol with no place in a line (the line-symbol check).
  for (const p of [G22_CLASH, G22_CLASH_WIDE, G44_HIDDEN]) {
    expect(GRID_LINT.solve(p), JSON.stringify(p)).toBeNull();
    expect(searchFills(p), JSON.stringify(p)).toEqual({ fills: [], complete: true, steps: 0 });
  }
  // Whatever it returns reaches, in the play half's own rule, and is its canonical form.
  for (const p of [G22, G23, G33, G22_FULL, G55.params, G66_UNIQUE.params]) {
    const s = GRID_LINT.solve(p);
    expect(s, JSON.stringify(p)).not.toBeNull();
    expect(GRID_PLAY.reached(p, s ?? []), JSON.stringify(p)).toBe(true);
    expect(GRID_PLAY.canonical(p, s ?? []), JSON.stringify(p)).toEqual(s);
  }
});

test('grid: countSolutions counts fills up to two', () => {
  expect(GRID_LINT.countSolutions(G22_EMPTY, 2)).toBe(2);
  // Both fills, in search order: the lowest empty cell first, the symbols ascending.
  expect(searchFills(G22_EMPTY).fills).toEqual([
    [1, 2, 2, 1],
    [2, 1, 1, 2],
  ]);
  expect(GRID_LINT.countSolutions(G22, 2)).toBe(1);
  expect(GRID_LINT.countSolutions(G22_FULL, 2)).toBe(1);
  expect(GRID_LINT.countSolutions(G22_CLASH, 2)).toBe(0);
  expect(GRID_LINT.countSolutions(G44_HIDDEN, 2)).toBe(0);
});

test('grid: a search past its bound stops, never hangs', () => {
  // The bound on a small instance, every budget finite: one extension below what the search takes to its second fill
  // finds the first and stops, so the count is unknown; a search with no bound fails here.
  const full = searchFills(G33_EMPTY, GRID_SEARCH_STEPS);
  expect(full.fills).toHaveLength(2);
  expect(full.complete).toBe(true);
  expect(full.steps).toBeGreaterThan(2);
  const cut = searchFills(G33_EMPTY, full.steps - 1);
  expect(cut.fills).toHaveLength(1);
  expect(cut.complete).toBe(false);
  expect(countFills(G33_EMPTY, full.steps - 1)).toBeNull();
  expect(searchFills(G33_EMPTY, 0)).toEqual({ fills: [], complete: false, steps: 0 });
  // The largest decode-legal grids at the shipped bound: answered, not stopped (their times are in the lane's report).
  expect(GRID_SEARCH_STEPS).toBe(1_000_000);
  expect(GRID_LINT.countSolutions(G66_EMPTY, 2)).toBe(2);
  expect(GRID_LINT.countSolutions(G66_UNIQUE.params, 2)).toBe(1);
});

test("grid: the solution check refuses any fill but the grid's one", () => {
  const v = (p: GridParams, s: readonly number[]): string | null => GRID_LINT.validateSolution(p, s);
  expect(v(G23, G23_FILL)).toBeNull();
  // H1 (2): a Latin fill that changes a given, and an answer that is no fill, are not what the device posts.
  expect(v(G23, [1, 2, 3, 3, 1, 2])).toBe("the solution is not the grid's fill [1, 2, 3, 2, 3, 1]");
  expect(v(G23, [1, 2, 0, 0, 0, 1])).toBe("the solution is not the grid's fill [1, 2, 3, 2, 3, 1]");
  // Two fills, no fill: the reach pass reports them; this check adds nothing whatever the solution.
  for (const s of [
    [1, 2, 2, 1],
    [2, 1, 1, 2],
    [1, 1, 1, 1],
  ]) {
    expect(v(G22_EMPTY, s), JSON.stringify(s)).toBeNull();
  }
  expect(v(G22_CLASH, [1, 1, 2, 2])).toBeNull();
});

test("grid: the posted answer has the instance's shape and the server's length", () => {
  for (const p of [G22, G23, G33, G55.params, G66_UNIQUE.params]) {
    const s = GRID_LINT.solve(p);
    if (s === null) {
      throw new Error(`expected a fill for ${JSON.stringify(p)}`);
    }
    // H1 (1): the shape's length is every solution's length, and the solve fits the instance the session builds.
    expect(s.length, JSON.stringify(p)).toBe(GRID_RULES.answerShape(p).len);
    expect(shapeProblem(s, instanceOf(GRID_RULES, p).shape), JSON.stringify(p)).toBeNull();
  }
  // H1 (4), what the server receives: through the fixture seam, so the type need not be registered for the build to
  // emit it.
  const types: PuzzleTypes = [GRID_RULES, ...PUZZLE_TYPES];
  const chart = {
    type: 'grid',
    title: { id: 'ch1.chart.0001', ru: 'Карта' },
    prompt: { id: 'ch1.chart.0002', ru: 'Сигналы' },
    closeup: null,
    params: { rows: 3, cols: 3, symbols: 3, given: [1, 2, 0, 0, 0, 1, 0, 1, 0] },
    maxAttempts: null,
    giveUp: false,
    solution: G33_FILL,
    hints: [],
  };
  const src = decodeWorldSource({ format: 1, items: {}, docs: {}, sections: {}, puzzles: { chart } }, { types });
  if (!src.ok) {
    throw new Error(`expected the world to decode: ${JSON.stringify(src.error)}`);
  }
  const decoded = src.value.puzzles['chart' as PuzzleLocalId];
  const server = toServer(src.value, {}, 'ch1' as ChapterId, undefined, { types }).puzzles['chart' as PuzzleLocalId];
  if (decoded === undefined || server === undefined) {
    throw new Error('expected the chart puzzle in both');
  }
  const params = GRID_RULES.decodeParams(chart.params);
  if (!params.ok) {
    throw new Error(`expected the chart params to decode: ${params.error}`);
  }
  expect(server.answerLen).toBe(server.solution.length);
  expect(server.answerMax).toBe(3);
  expect(server.solution).toEqual(GRID_LINT.solve(params.value));
  expect(GRID_LINT.validateSolution(params.value, decoded.solution)).toBeNull();
});

// ---------------------------------------------------------------------------------------------------------------
// Solver F3 (RULINGS 350, 354): the answer bound measures a reach type by its `solve`, or by its answer shape when the
// lint half has no `solve` or its `solve` returns null, so no reach instance goes unmeasured.

/** `params.n` of the fixture type's instance (its params decode as written). */
function nOf(params: unknown): number {
  const n = (params as { n?: unknown }).n; // the fixture type's params: { n }
  if (typeof n !== 'number') {
    throw new Error('invariant: a fixture instance writes params.n');
  }
  return n;
}

/** A fixture reach type whose answer shape posts `params.n` entries. */
const TALL: PuzzleTypeData<string, unknown> = Object.freeze({
  type: 'tall',
  check: 'reach',
  goal: 'shown',
  presentation: 'overlay',
  wrong: 'none',
  commit: 'control',
  decodeParams: (raw: unknown) => ({ ok: true, value: raw }) as const,
  answerShape: (p: unknown) => ({ len: nOf(p), max: 1 }),
  initial: () => [],
  startShown: () => null,
});

test('story: a reach type without a solve is bounded by its answer shape', () => {
  const types: PuzzleTypes = [...PUZZLE_TYPES, TALL];
  /** A one-puzzle source world whose puzzle `fuse` is a TALL of `n` entries, decoded beside the real types. */
  const world = (n: number) => {
    const fuse = {
      type: 'tall',
      title: { id: 'ch1.fuse.0001', ru: 'Щиток' },
      prompt: { id: 'ch1.fuse.0002', ru: 'Провод' },
      closeup: null,
      params: { n },
      maxAttempts: null,
      giveUp: false,
      solution: [1],
      hints: [],
    };
    const r = decodeWorldSource({ format: 1, items: {}, docs: {}, sections: {}, puzzles: { fuse } }, { types });
    if (!r.ok) {
      throw new Error(`invariant: the fixture decodes: ${JSON.stringify(r.error)}`);
    }
    return r.value;
  };
  // Both readings of "no solve", each its own lints entry beside the real ones: the hook absent, and a solve that
  // returns null (F3's own case).
  const readings: ReadonlyArray<readonly [string, PuzzleLintRegistry]> = [
    ['no solve', { ...PUZZLE_LINTS, tall: { countSolutions: () => 1 } }],
    ['a solve that returns null', { ...PUZZLE_LINTS, tall: { solve: () => null, countSolutions: () => 1 } }],
  ];
  for (const [reading, lints] of readings) {
    const w = world(65);
    expect(answerLenIssues(w, lints, types), reading).toEqual([
      { path: 'puzzles.fuse.params', reason: 'range', detail: "puzzle 'fuse' posts 65 entries: 1..64 (the server refuses longer, §7.4)" },
    ]);
    const fuse = w.puzzles['fuse' as PuzzleLocalId];
    expect(fuse === undefined ? 'no fuse' : postedLength(fuse, lints, types), reading).toBe(65);
    expect(answerLenIssues(world(64), lints, types), reading).toEqual([]);
  }
});
