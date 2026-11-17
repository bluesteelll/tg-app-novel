// The `levers` device's lint half (engine plan §7.1 "BUILD", §7.4; GM8a D2-D5; build only, no node:*): a bounded
// breadth-first search from the start over the play half's own throws, which proves the target reachable and gives
// the throw order the server's last hint tier names; the source solution's check; the hint ladder's `[moves]`
// invariant (D2); the parts' rects for the frame check (D3); and the play half's own `reached` / `canonical` for the
// reach pass (mechanics/clues.ts), so the build checks what the player's device posts.
import { LEVERS_PLAY, throwPart } from '../../../src/puzzles/play/levers.ts';
import { LEVERS_RULES } from '../../../src/puzzles/rules/levers.ts';
import type { LeversParams } from '../../../src/puzzles/rules/levers.ts';
import type { PuzzleTypeLint } from './index.ts';

/**
 * The search's bound, in throws tried per instance: hitting it is a result (`countSolutions` null, refused as
 * `world/unique-solution`), never a hang. The largest decode-legal instance needs at most 4^8 configurations x 8 throws
 * (524,288), so the shipped bound never stops on one.
 */
export const LEVERS_SEARCH_STEPS = 1_000_000;

/** What one search found. */
export type LeversSearch = {
  /** Whether the throws reach the target from the start. */
  readonly found: boolean;
  /** The shortest throw order to the target, lever indexes from 0, the lowest index first on a tie; null when not found. */
  readonly witness: readonly number[] | null;
  /** The throws it tried. */
  readonly steps: number;
  /** True when the bound stopped it before it could tell. */
  readonly stopped: boolean;
};

/**
 * One breadth-first search from the start: each configuration taken from the queue tries every lever's throw in
 * ascending index, and the search ends when it takes the target, when the queue runs out, or before a throw past
 * `budget`. A configuration's first discovery is its way back, so the witness is the shortest order, and among the
 * shortest the lowest (server content is byte-stable).
 */
export function searchLevers(p: LeversParams, budget: number = LEVERS_SEARCH_STEPS): LeversSearch {
  const start = LEVERS_RULES.initial(p);
  const key = (a: readonly number[]): string => a.join(',');
  const goal = key(p.target);
  /** Each configuration found, with the one it was thrown from and the lever thrown. */
  const back = new Map<string, { readonly from: string; readonly part: number } | null>([[key(start), null]]);
  const queue: (readonly number[])[] = [start];
  let steps = 0;
  for (const a of queue) {
    if (key(a) === goal) {
      const order: number[] = [];
      for (let at = back.get(goal); at !== undefined && at !== null; at = back.get(at.from)) {
        order.push(at.part);
      }
      return { found: true, witness: order.reverse(), steps, stopped: false };
    }
    for (let part = 0; part < p.parts; part++) {
      if (steps >= budget) {
        return { found: false, witness: null, steps, stopped: true };
      }
      steps++;
      const next = throwPart(p, a, part);
      if (next !== null && !back.has(key(next))) {
        back.set(key(next), { from: key(a), part });
        queue.push(next);
      }
    }
  }
  return { found: false, witness: null, steps, stopped: false };
}

const MOVES = '[moves]';

/**
 * D2: the last tier, the sold method, holds `[moves]` exactly once in ru and in en, and no earlier tier holds it;
 * otherwise a throw naming the tier and the language and quoting the text (the emit path gives no puzzle id: the text
 * is what the author finds). An empty ladder sells nothing and passes.
 */
function checkLadder(hints: readonly { ru: string; en: string }[]): void {
  hints.forEach((h, i) => {
    const last = i === hints.length - 1;
    for (const lang of ['ru', 'en'] as const) {
      const times = h[lang].split(MOVES).length - 1;
      const why = last
        ? times === 0
          ? `holds no ${MOVES}`
          : times > 1
            ? `holds ${MOVES} ${times} times, not once`
            : null
        : times > 0
          ? `holds ${MOVES}, which only the last tier may`
          : null;
      if (why !== null) {
        throw new Error(`levers hints: tier ${i + 1} of ${hints.length} (${lang}) ${why}: "${h[lang]}"`);
      }
    }
  });
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The lint half under a search bound (`LEVERS_LINT` takes the shipped one): a test builds one with a smaller bound and
 * passes it to the reach pass. Each half keeps its own searches, one per decoded `params` object.
 */
export function leversLint(budget: number = LEVERS_SEARCH_STEPS) {
  const searched = new WeakMap<LeversParams, LeversSearch>();
  const search = (p: LeversParams): LeversSearch => {
    const known = searched.get(p);
    if (known !== undefined) {
      return known;
    }
    const s = searchLevers(p, budget);
    searched.set(p, s);
    return s;
  };
  return Object.freeze({
    /** The posted canonical answer: the target, when the throws reach it. */
    solve: (p: LeversParams): readonly number[] | null => (search(p).found ? p.target : null),
    witness: (p: LeversParams): readonly number[] | null => search(p).witness,
    // D4: one canonical answer reaches, the target; 0 when no throw order does; null when the bound stopped the search.
    countSolutions: (p: LeversParams, _cap: 2): 0 | 1 | null => {
      const s = search(p);
      return s.stopped ? null : s.found ? 1 : 0;
    },
    /**
     * Null when the source `solution` is the target, the one configuration the device posts. An unreachable target or a
     * stopped search is the reach pass's finding, not this one's (one root cause, one finding).
     */
    validateSolution(p: LeversParams, s: readonly number[]): string | null {
      return !search(p).found || same(s, p.target) ? null : `the solution [${s.join(', ')}] is not the target [${p.target.join(', ')}]`;
    },
    renderHints(_p: LeversParams, hints: readonly { ru: string; en: string }[]): readonly { ru: string; en: string }[] {
      checkLadder(hints);
      return hints;
    },
    partRects: (p: LeversParams) => p.rects,
    reached: LEVERS_PLAY.reached,
    canonical: LEVERS_PLAY.canonical,
    // The reach codes are the reach pass's (mechanics/clues.ts), shared by every reach type.
    codes: {},
  }) satisfies PuzzleTypeLint<LeversParams>;
}

export const LEVERS_LINT = leversLint();
