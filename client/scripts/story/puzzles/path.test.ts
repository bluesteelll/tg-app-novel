// The `path` puzzle's build half (engine plan §7.1 "BUILD", §7.4; GM7p D4, D5, D7): the bounded search, the solution
// check, and the three equalities of H1 that keep a drawn path from ever posting what the server does not hold.
import { expect, test } from 'vitest';

import { PATH_PLAY, advance, touch } from '../../../src/puzzles/play/path.ts';
import { PUZZLE_TYPES, instanceOf, shapeProblem } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleTypes } from '../../../src/puzzles/rules/index.ts';
import { PATH_RULES } from '../../../src/puzzles/rules/path.ts';
import type { PathParams } from '../../../src/puzzles/rules/path.ts';
import type { ChapterId, PuzzleLocalId } from '../../../src/story/staging.ts';
import { decodeWorldSource, toServer } from '../../../src/world/decode.ts';
import { PATH_LINT, PATH_SEARCH_STEPS, countPaths, searchPaths } from './path.ts';

/** 3 x 2, ends 0 and 3: `0 1 2 / 3 4 5`; one path, 0 1 2 5 4 3. */
const P32: PathParams = { cols: 3, rows: 2, ends: [0, 3], blocked: [] };
/** 3 x 2, ends 0 and 5: one path, 0 3 4 1 2 5. */
const P32_WRAP: PathParams = { cols: 3, rows: 2, ends: [0, 5], blocked: [] };
/** 3 x 3, ends 0 and 8: two paths, 0 1 2 5 4 3 6 7 8 and 0 3 6 7 4 1 2 5 8. */
const P33: PathParams = { cols: 3, rows: 3, ends: [0, 8], blocked: [] };
/** 3 x 3, ends 1 and 0, the centre blocked: one path around the ring, 0 3 6 7 8 5 2 1. */
const P33_RING: PathParams = { cols: 3, rows: 3, ends: [1, 0], blocked: [4] };
/** 2 x 2, ends 0 and 3: both ends on one colour of an even grid, so no path (the parity check). */
const P22_PARITY: PathParams = { cols: 2, rows: 2, ends: [0, 3], blocked: [] };
/** 3 x 3, ends 0 and 8, 4 and 5 blocked: the parity holds, but cell 2's only open neighbour is 1 (walled in). */
const P33_DEAD: PathParams = { cols: 3, rows: 3, ends: [0, 8], blocked: [4, 5] };
/**
 * 4 x 4, ends 0 and 3, 5 and 6 blocked: the parity holds, but 1 and 2 are a corridor between the two ends, so no line
 * through every cell exists; the search needs 61 extensions to exhaust it.
 */
const P44_CORRIDOR: PathParams = { cols: 4, rows: 4, ends: [0, 3], blocked: [5, 6] };
/**
 * The bound's instance on the largest decode-legal grid: 47 open cells, both ends on the majority colour (the parity
 * holds), but cell 6's only open neighbour is 5, so no path exists, and an unpruned search walks until its bound.
 */
const P77_BOUND: PathParams = { cols: 7, rows: 7, ends: [0, 48], blocked: [13, 24] };

test('path: solve finds the one path from the lower-index end', () => {
  expect(PATH_LINT.solve(P32)).toEqual([0, 1, 2, 5, 4, 3]);
  // The ends' listed order does not matter: the path starts at the lower index.
  expect(PATH_LINT.solve({ ...P32, ends: [3, 0] })).toEqual([0, 1, 2, 5, 4, 3]);
  expect(PATH_LINT.solve(P32_WRAP)).toEqual([0, 3, 4, 1, 2, 5]);
  expect(PATH_LINT.solve(P33_RING)).toEqual([0, 3, 6, 7, 8, 5, 2, 1]);
  // No path: by the parity, and by a walled-in cell the search exhausts.
  expect(PATH_LINT.solve(P22_PARITY)).toBeNull();
  expect(PATH_LINT.solve(P33_DEAD)).toBeNull();
  expect(searchPaths(P22_PARITY)).toEqual({ paths: [], complete: true, steps: 0 });
  expect(searchPaths(P33_DEAD)).toMatchObject({ paths: [], complete: true });
  // Whatever it returns reaches, in the play half's own rule, and is its canonical form.
  for (const p of [P32, P32_WRAP, P33_RING, P33]) {
    const s = PATH_LINT.solve(p);
    expect(s, JSON.stringify(p)).not.toBeNull();
    expect(PATH_PLAY.reached(p, s ?? []), JSON.stringify(p)).toBe(true);
    expect(PATH_PLAY.canonical(p, s ?? []), JSON.stringify(p)).toEqual(s);
  }
});

test('path: countSolutions counts canonical paths up to two', () => {
  expect(PATH_LINT.countSolutions(P22_PARITY, 2)).toBe(0);
  expect(PATH_LINT.countSolutions(P33_DEAD, 2)).toBe(0);
  // One line, drawn either way, counts once.
  expect(PATH_LINT.countSolutions(P32, 2)).toBe(1);
  expect(PATH_LINT.countSolutions({ ...P32, ends: [3, 0] }, 2)).toBe(1);
  expect(PATH_LINT.countSolutions(P32_WRAP, 2)).toBe(1);
  expect(PATH_LINT.countSolutions(P33_RING, 2)).toBe(1);
  expect(PATH_LINT.countSolutions(P33, 2)).toBe(2);
  expect(searchPaths(P33).paths).toEqual([
    [0, 1, 2, 5, 4, 3, 6, 7, 8],
    [0, 3, 6, 7, 4, 1, 2, 5, 8],
  ]);
});

test('path: a search past its bound stops, never hangs', () => {
  // The bound on a small instance first: a budget below what the exhaustive search needs answers null, and the same
  // search without a bound answers its count. A search with no bound fails here, before the 7 x 7 below runs.
  const full = searchPaths(P44_CORRIDOR, Number.POSITIVE_INFINITY);
  expect(full.complete).toBe(true);
  expect(full.paths).toEqual([]);
  expect(full.steps).toBeGreaterThan(20);
  expect(countPaths(P44_CORRIDOR, Number.POSITIVE_INFINITY)).toBe(0);
  expect(searchPaths(P44_CORRIDOR, 20)).toEqual({ paths: [], complete: false, steps: 20 });
  expect(countPaths(P44_CORRIDOR, 20)).toBeNull();
  // A path found before the bound counts for solve, and the count stays unknown.
  const twoAtBound = searchPaths(P33, searchPaths(P33, Number.POSITIVE_INFINITY).steps - 1);
  expect(twoAtBound.paths).toHaveLength(1);
  expect(twoAtBound.complete).toBe(false);
  // The bound's instance on 7 x 7, at the shipped bound: stopped, not hung (its time per instance is in the lane's
  // report).
  expect(PATH_SEARCH_STEPS).toBe(1_000_000);
  expect(PATH_LINT.countSolutions(P77_BOUND, 2)).toBeNull();
  expect(PATH_LINT.solve(P77_BOUND)).toBeNull();
  expect(searchPaths(P77_BOUND, PATH_SEARCH_STEPS)).toMatchObject({ paths: [], complete: false, steps: PATH_SEARCH_STEPS });
});

test('path: the solution check refuses a reversed path and any other', () => {
  const v = (p: PathParams, s: readonly number[]): string | null => PATH_LINT.validateSolution(p, s);
  expect(v(P32, [0, 1, 2, 5, 4, 3])).toBeNull();
  // R8b: the reversed path is the same line, but the server compares the posted canonical form by equality.
  expect(v(P32, [3, 4, 5, 2, 1, 0])).toBe(
    'the solution is written from its higher-index end: a path is posted from its lower-index end, [0, 1, 2, 5, 4, 3]',
  );
  expect(v(P32, [0, 1, 4, 3])).toBe("the solution is not the path's solve [0, 1, 2, 5, 4, 3]");
  expect(v(P33_RING, [0, 3, 6, 7, 8, 5, 2, 1])).toBeNull();
  expect(v(P33_RING, [1, 2, 5, 8, 7, 6, 3, 0])).toContain('higher-index end');
  // No path, two paths: the reach pass reports them; this check adds nothing whatever the solution.
  expect(v(P33_DEAD, [0, 1, 2])).toBeNull();
  for (const s of [[0, 1, 2, 5, 4, 3, 6, 7, 8], [0, 3, 6, 7, 4, 1, 2, 5, 8], [8, 7, 6, 3, 4, 5, 2, 1, 0], [1, 2, 3]]) {
    expect(v(P33, s), JSON.stringify(s)).toBeNull();
  }
});

test("path: the posted answer has the instance's shape and the server's length", () => {
  const samples: readonly PathParams[] = [P32, P32_WRAP, P33_RING, P33, { cols: 4, rows: 4, ends: [0, 3], blocked: [] }, { cols: 2, rows: 7, ends: [0, 1], blocked: [] }];
  for (const p of samples) {
    const s = PATH_LINT.solve(p);
    if (s === null) {
      throw new Error(`expected a path for ${JSON.stringify(p)}`);
    }
    // H1 (1): the shape's length is every solution's length, and the solve fits the instance the session builds.
    expect(s.length, JSON.stringify(p)).toBe(PATH_RULES.answerShape(p).len);
    expect(shapeProblem(s, instanceOf(PATH_RULES, p).shape), JSON.stringify(p)).toBeNull();
  }
  // What the server receives: through the fixture seam, so the type need not be registered for the build to emit it.
  const types: PuzzleTypes = [PATH_RULES, ...PUZZLE_TYPES];
  const fuse = {
    type: 'path',
    title: { id: 'ch1.fuse.0001', ru: 'Щиток' },
    prompt: { id: 'ch1.fuse.0002', ru: 'Провод' },
    closeup: null,
    params: { cols: 3, rows: 3, ends: [1, 0], blocked: [4] },
    maxAttempts: null,
    giveUp: false,
    solution: [0, 3, 6, 7, 8, 5, 2, 1],
    hints: [],
  };
  const src = decodeWorldSource({ format: 1, items: {}, docs: {}, sections: {}, puzzles: { fuse } }, { types });
  if (!src.ok) {
    throw new Error(`expected the world to decode: ${JSON.stringify(src.error)}`);
  }
  const decoded = src.value.puzzles['fuse' as PuzzleLocalId];
  const server = toServer(src.value, {}, 'ch1' as ChapterId, undefined, { types }).puzzles['fuse' as PuzzleLocalId];
  if (decoded === undefined || server === undefined) {
    throw new Error('expected the fuse puzzle in both');
  }
  const params = PATH_RULES.decodeParams(fuse.params);
  if (!params.ok) {
    throw new Error(`expected the fuse params to decode: ${params.error}`);
  }
  expect(server.answerLen).toBe(server.solution.length);
  expect(server.solution).toEqual(PATH_LINT.solve(params.value));
  expect(PATH_LINT.validateSolution(params.value, decoded.solution)).toBeNull();
});

test('path: every drawn answer that reaches the end posts the solve', () => {
  // H1 (3), D4: every answer the step rules can draw from an empty path that reaches posts `solve`, both ways.
  for (const p of [P32, P33_RING]) {
    const seen = new Set<string>(['[]']);
    const queue: (readonly number[])[] = [[]];
    const reachedFrom = new Set<number>();
    let reached = 0;
    for (let a = queue.shift(); a !== undefined; a = queue.shift()) {
      if (PATH_PLAY.reached(p, a)) {
        reached++;
        reachedFrom.add(a[0] ?? -1);
        expect(PATH_PLAY.canonical(p, a), JSON.stringify(a)).toEqual(PATH_LINT.solve(p));
      }
      for (let c = 0; c < p.cols * p.rows; c++) {
        for (const next of [touch(p, a, c), advance(p, a, c)]) {
          if (next !== null && !seen.has(JSON.stringify(next))) {
            seen.add(JSON.stringify(next));
            queue.push(next);
          }
        }
      }
    }
    // Drawn from each end, and the walk was not vacuous.
    expect(reached, JSON.stringify(p)).toBe(2);
    expect([...reachedFrom].sort((x, y) => x - y), JSON.stringify(p)).toEqual([...p.ends].sort((x, y) => x - y));
    expect(seen.size, JSON.stringify(p)).toBeGreaterThan(10);
  }
});
