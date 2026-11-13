// The `grid` puzzle's lint half (engine plan §7.1 "BUILD", §7.4; GM7g D4; build only, no node:*): a bounded search for
// the fills that keep the givens, the source solution's check, and the play half's own `reached` / `canonical` for the
// reach pass (mechanics/clues.ts), so the build checks what the player's device posts.
import { GRID_PLAY } from '../../../src/puzzles/play/grid.ts';
import type { GridParams } from '../../../src/puzzles/rules/grid.ts';
import type { PuzzleTypeLint } from './index.ts';

/**
 * The search's bound, in extensions per instance: hitting it is a result (`countSolutions` null, refused as
 * `world/unique-solution`), never a hang.
 */
export const GRID_SEARCH_STEPS = 1_000_000;

/** What one search found: up to two fills, and whether it ended before its bound. */
export type GridSearch = {
  readonly fills: readonly (readonly number[])[];
  /** False when the bound stopped it before it could tell 0, 1 or 2. */
  readonly complete: boolean;
  /** The extensions it made: one symbol written into one empty cell. */
  readonly steps: number;
};

const CAP = 2;

function bitCount(mask: number): number {
  let n = 0;
  for (let m = mask; m !== 0; m &= m - 1) {
    n++;
  }
  return n;
}

/**
 * One depth-first search for the fills of `p`, stopped at two fills or after `budget` extensions. Symbol `v` is bit `v`
 * of a line's mask. The next cell is the empty one with the fewest candidates (the lowest index on a tie), its symbols
 * tried ascending; a node is a dead end when an empty cell has no candidate, or when a line that holds every symbol
 * (`symbols` equal to its length) lacks one that none of its empty cells can take. Givens that repeat a symbol in a line
 * have no fill, found before any extension.
 */
export function searchFills(p: GridParams, budget: number = GRID_SEARCH_STEPS): GridSearch {
  const { rows, cols, symbols } = p;
  const all = ((1 << (symbols + 1)) - 1) & ~1;
  const a = [...p.given];
  const rowUsed: number[] = Array.from({ length: rows }, () => 0);
  const colUsed: number[] = Array.from({ length: cols }, () => 0);
  /** Symbol `v` into or out of cell `c`'s lines (a toggle: each call pairs with its undo). */
  const flip = (c: number, v: number): void => {
    const r = Math.floor(c / cols);
    const k = c % cols;
    rowUsed[r] = (rowUsed[r] ?? 0) ^ (1 << v);
    colUsed[k] = (colUsed[k] ?? 0) ^ (1 << v);
  };
  for (const [c, v] of a.entries()) {
    if (v !== 0) {
      if ((((rowUsed[Math.floor(c / cols)] ?? 0) | (colUsed[c % cols] ?? 0)) & (1 << v)) !== 0) {
        return { fills: [], complete: true, steps: 0 };
      }
      flip(c, v);
    }
  }
  const fills: number[][] = [];
  let steps = 0;
  let stopped = false;
  const walk = (): void => {
    const rowCan: number[] = Array.from({ length: rows }, () => 0);
    const colCan: number[] = Array.from({ length: cols }, () => 0);
    let best = -1;
    let bestMask = 0;
    let bestCount = symbols + 1;
    for (const [c, v] of a.entries()) {
      if (v !== 0) {
        continue;
      }
      const r = Math.floor(c / cols);
      const k = c % cols;
      const mask = all & ~((rowUsed[r] ?? 0) | (colUsed[k] ?? 0));
      if (mask === 0) {
        return;
      }
      rowCan[r] = (rowCan[r] ?? 0) | mask;
      colCan[k] = (colCan[k] ?? 0) | mask;
      const n = bitCount(mask);
      if (n < bestCount) {
        best = c;
        bestMask = mask;
        bestCount = n;
      }
    }
    if (best === -1) {
      fills.push([...a]);
      return;
    }
    // A line as long as the symbol set holds each symbol once: each symbol it lacks must fit one of its empty cells.
    if (symbols === cols && rowUsed.some((u, r) => (rowCan[r] ?? 0) !== (all & ~u))) {
      return;
    }
    if (symbols === rows && colUsed.some((u, k) => (colCan[k] ?? 0) !== (all & ~u))) {
      return;
    }
    for (let v = 1; v <= symbols; v++) {
      if ((bestMask & (1 << v)) === 0) {
        continue;
      }
      if (steps >= budget) {
        stopped = true;
        return;
      }
      steps++;
      a[best] = v;
      flip(best, v);
      walk();
      flip(best, v);
      a[best] = 0;
      if (stopped || fills.length >= CAP) {
        return;
      }
    }
  };
  walk();
  return { fills, complete: !stopped, steps };
}

/** 0, 1 or 2 fills; null when the bound stopped the search before it could tell. */
function countOf(s: GridSearch): 0 | 1 | 2 | null {
  if (s.fills.length >= CAP) {
    return 2;
  }
  if (!s.complete) {
    return null;
  }
  return s.fills.length === 0 ? 0 : 1;
}

/** One search per decoded `params` object: `solve`, `countSolutions`, `validateSolution` and the shape pass share it. */
const SEARCHED = new WeakMap<GridParams, GridSearch>();

function search(p: GridParams): GridSearch {
  const known = SEARCHED.get(p);
  if (known !== undefined) {
    return known;
  }
  const s = searchFills(p);
  SEARCHED.set(p, s);
  return s;
}

/** The count under a given bound (`countSolutions` takes the default one). */
export function countFills(p: GridParams, budget: number = GRID_SEARCH_STEPS): 0 | 1 | 2 | null {
  return countOf(budget === GRID_SEARCH_STEPS ? search(p) : searchFills(p, budget));
}

function solve(p: GridParams): readonly number[] | null {
  // A fill found before the bound counts.
  return search(p).fills[0] ?? null;
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const GRID_LINT = Object.freeze({
  solve,
  /**
   * Null when the source `solution` is the posted answer: the grid's one fill (H1 (2)). Any other would make every
   * correct fill a mismatch, so the lock would open for no player. No fill, two fills or a stopped search are the reach
   * pass's findings, not this one's (one root cause, one finding).
   */
  validateSolution(p: GridParams, s: readonly number[]): string | null {
    const solved = solve(p);
    if (solved === null || countOf(search(p)) !== 1 || same(s, solved)) {
      return null;
    }
    return `the solution is not the grid's fill [${solved.join(', ')}]`;
  },
  countSolutions: (p: GridParams, _cap: 2): 0 | 1 | 2 | null => countOf(search(p)),
  reached: GRID_PLAY.reached,
  canonical: GRID_PLAY.canonical,
  // The reach codes are the reach pass's (mechanics/clues.ts), shared by every reach type.
  codes: {},
}) satisfies PuzzleTypeLint<GridParams>;
