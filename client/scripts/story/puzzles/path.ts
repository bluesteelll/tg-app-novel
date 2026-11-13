// The `path` puzzle's lint half (engine plan §7.1 "BUILD", §7.4; GM7p D5, D7; build only, no node:*): a bounded
// search for the lines through every open cell, the source solution's check, and the play half's own `reached` /
// `canonical` for the reach pass (mechanics/clues.ts), so the build checks what the player's device posts.
import { PATH_PLAY } from '../../../src/puzzles/play/path.ts';
import type { PathParams } from '../../../src/puzzles/rules/path.ts';
import type { PuzzleTypeLint } from './index.ts';

/**
 * The search's bound, in extensions per instance (CQ-f): hitting it is a result (`countSolutions` null, refused as
 * `world/unique-solution`), never a hang. Proving uniqueness on a 7 x 7 grid would otherwise walk a huge space;
 * dead-end pruning is GM7g's, with the first path over 16 cells.
 */
export const PATH_SEARCH_STEPS = 1_000_000;

/** What one search found: up to two paths, each from the lower-index end, and whether it ended before its bound. */
export type PathSearch = {
  readonly paths: readonly (readonly number[])[];
  /** False when the bound stopped it before it could tell 0, 1 or 2. */
  readonly complete: boolean;
  /** The extensions it made. */
  readonly steps: number;
};

const CAP = 2;

function colour(p: PathParams, c: number): number {
  return (Math.floor(c / p.cols) + (c % p.cols)) % 2;
}

/**
 * The grid's two colours alternate along any line: with an even open count the ends differ in colour and the colours
 * are even, with an odd one both ends are on the colour that has one more cell. Else no line exists.
 */
function parityAllows(p: PathParams, open: readonly boolean[]): boolean {
  const counts = [0, 0];
  open.forEach((o, c) => {
    if (o) {
      counts[colour(p, c)] = (counts[colour(p, c)] ?? 0) + 1;
    }
  });
  const [even = 0, odd = 0] = counts;
  const [a, b] = p.ends;
  if ((even + odd) % 2 === 0) {
    return even === odd && colour(p, a) !== colour(p, b);
  }
  const major = even > odd ? 0 : 1;
  return Math.abs(even - odd) === 1 && colour(p, a) === major && colour(p, b) === major;
}

/**
 * One depth-first search from the lower-index end to the higher one through every open cell, stopped at two paths or
 * after `budget` extensions. Each path is found from the lower-index end only, so one line counts once.
 */
export function searchPaths(p: PathParams, budget: number = PATH_SEARCH_STEPS): PathSearch {
  const cells = p.cols * p.rows;
  const open = Array.from({ length: cells }, (_, c) => !p.blocked.includes(c));
  if (!parityAllows(p, open)) {
    return { paths: [], complete: true, steps: 0 };
  }
  const neighbours = open.map((_, c) =>
    [c - p.cols, c % p.cols === 0 ? -1 : c - 1, c % p.cols === p.cols - 1 ? -1 : c + 1, c + p.cols].filter((n) => n >= 0 && n < cells && open[n] === true),
  );
  const total = cells - p.blocked.length;
  const start = Math.min(p.ends[0], p.ends[1]);
  const goal = Math.max(p.ends[0], p.ends[1]);
  const used = new Uint8Array(cells);
  const line = [start];
  used[start] = 1;
  const paths: number[][] = [];
  let steps = 0;
  let stopped = false;
  const walk = (c: number): void => {
    if (c === goal) {
      if (line.length === total) {
        paths.push([...line]);
      }
      return; // the other end closes the line, complete or not
    }
    for (const n of neighbours[c] ?? []) {
      if (used[n] === 1) {
        continue;
      }
      if (steps >= budget) {
        stopped = true;
        return;
      }
      steps++;
      used[n] = 1;
      line.push(n);
      walk(n);
      line.pop();
      used[n] = 0;
      if (stopped || paths.length >= CAP) {
        return;
      }
    }
  };
  walk(start);
  return { paths, complete: !stopped, steps };
}

/** 0, 1 or 2 canonical paths; null when the bound stopped the search before it could tell. */
function countOf(s: PathSearch): 0 | 1 | 2 | null {
  if (s.paths.length >= CAP) {
    return 2;
  }
  if (!s.complete) {
    return null;
  }
  return s.paths.length === 0 ? 0 : 1;
}

/** One search per decoded `params` object: `solve`, `countSolutions`, `validateSolution` and the shape pass share it. */
const SEARCHED = new WeakMap<PathParams, PathSearch>();

function search(p: PathParams): PathSearch {
  const known = SEARCHED.get(p);
  if (known !== undefined) {
    return known;
  }
  const s = searchPaths(p);
  SEARCHED.set(p, s);
  return s;
}

/** The count under a given bound (`countSolutions` takes the default one). */
export function countPaths(p: PathParams, budget: number = PATH_SEARCH_STEPS): 0 | 1 | 2 | null {
  return countOf(budget === PATH_SEARCH_STEPS ? search(p) : searchPaths(p, budget));
}

function solve(p: PathParams): readonly number[] | null {
  // A path found before the bound counts.
  return search(p).paths[0] ?? null;
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const PATH_LINT = Object.freeze({
  solve,
  /**
   * Null when the source `solution` is the posted answer: the unique path, from its lower-index end (H1 (2), R8b). A
   * wrong one would make every correct draw a mismatch, so the lock would open for no player. No path, two paths or a
   * stopped search are the reach pass's findings, not this one's (one root cause, one finding).
   */
  validateSolution(p: PathParams, s: readonly number[]): string | null {
    const solved = solve(p);
    if (solved === null || countOf(search(p)) !== 1 || same(s, solved)) {
      return null;
    }
    const shown = `[${solved.join(', ')}]`;
    return same([...s].reverse(), solved)
      ? `the solution is written from its higher-index end: a path is posted from its lower-index end, ${shown}`
      : `the solution is not the path's solve ${shown}`;
  },
  countSolutions: (p: PathParams, _cap: 2): 0 | 1 | 2 | null => countOf(search(p)),
  reached: PATH_PLAY.reached,
  canonical: PATH_PLAY.canonical,
  // The reach codes are the reach pass's (mechanics/clues.ts), shared by every reach type.
  codes: {},
}) satisfies PuzzleTypeLint<PathParams>;
