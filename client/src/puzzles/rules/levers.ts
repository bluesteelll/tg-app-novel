// The `levers` device (engine plan §7.2, §7.5; GM8a D3, D6, D10, B2): `parts` levers of `positions` positions, every
// one at 0 at the start. A throw of lever i moves it and each lever `couples[i]` names one position on, wrapping at
// `positions` (directed: lever j moves at a throw of i only when `couples[i]` names j). The goal, a position per lever, is
// drawn on the device; the answer is the configuration, which posts itself once it equals `target`. The data half
// (engine plan §7.1): a reach type in its room's view with no wrong state, whose saved work fits while the throws reach
// it from the start. The params decoders here are `setting`'s too (rules/setting.ts).
import type { Result } from '../../story/catalog.ts';
import type { Rect } from '../../story/staging.ts';
import type { PuzzleTypeData } from './index.ts';

export type LeversParams = {
  readonly parts: number;
  readonly positions: number;
  /** Per lever, the other levers a throw of it moves too: each a lever index, none twice, never the lever itself. */
  readonly couples: readonly (readonly number[])[];
  /** The goal: a position per lever. */
  readonly target: readonly number[];
  /** Per lever, its part's rect in room source px. */
  readonly rects: readonly Rect[];
};

const KEYS: readonly string[] = ['parts', 'positions', 'couples', 'target', 'rects'];

const show = (v: unknown): string => JSON.stringify(v) ?? 'undefined';

/** `raw` as a record holding exactly `keys`; else why not (a `type` puzzle names its keys). */
export function keyed(raw: unknown, type: string, keys: readonly string[]): Result<Record<string, unknown>, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'params is not an object' };
  }
  const own = Object.keys(raw);
  const extra = own.filter((k) => !keys.includes(k));
  if (extra.length > 0) {
    return { ok: false, error: `unknown key ${extra.join(', ')} (a ${type} puzzle has ${keys.map((k) => `'${k}'`).join(', ')})` };
  }
  const missing = keys.filter((k) => !own.includes(k));
  if (missing.length > 0) {
    return { ok: false, error: `missing key ${missing.join(', ')}` };
  }
  return { ok: true, value: { ...raw } };
}

/** An integer in `lo`..`hi`; else why not. */
export function count(name: string, v: unknown, lo: number, hi: number): Result<number, string> {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? { ok: true, value: v } : { ok: false, error: `${name} must be an integer in ${lo}..${hi}` };
}

/** A rect in integer source px, x, y ≥ 0 and w, h > 0 (the world decoder's hotspot rule; the frame is the lint's). */
export function rect(name: string, v: unknown): Result<Rect, string> {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n: unknown) => typeof n === 'number' && Number.isInteger(n))) {
    return { ok: false, error: `${name}: ${show(v)} is not [x, y, w, h] in integers` };
  }
  const [x, y, w, h] = v as [number, number, number, number]; // four integers, checked above
  return x < 0 || y < 0 || w <= 0 || h <= 0 ? { ok: false, error: `${name}: ${show(v)}: x, y must be ≥ 0 and w, h > 0` } : { ok: true, value: [x, y, w, h] };
}

/** One rect per part, in part order; else why not. */
export function rectList(v: unknown, parts: number): Result<Rect[], string> {
  if (!Array.isArray(v) || v.length !== parts) {
    return { ok: false, error: `rects must be an array of ${parts} rects` };
  }
  const out: Rect[] = [];
  for (const [i, r] of v.entries()) {
    const one = rect(`rects ${i}`, r);
    if (!one.ok) {
      return one;
    }
    out.push(one.value);
  }
  return { ok: true, value: out };
}

/** Lever `i`'s couples: distinct levers in 0..`parts - 1`, never `i`; else why not. */
function couplesOf(i: number, v: unknown, parts: number): Result<number[], string> {
  if (!Array.isArray(v)) {
    return { ok: false, error: `couples ${i} must be an array of levers` };
  }
  const out: number[] = [];
  for (const j of v) {
    if (typeof j !== 'number' || !Number.isInteger(j) || j < 0 || j >= parts) {
      return { ok: false, error: `couples ${i}: ${show(j)} is not a lever in 0..${parts - 1}` };
    }
    if (j === i) {
      return { ok: false, error: `couples ${i}: lever ${i} couples itself` };
    }
    if (out.includes(j)) {
      return { ok: false, error: `couples ${i}: lever ${j} is listed twice` };
    }
    out.push(j);
  }
  return { ok: true, value: out };
}

function decodeParams(raw: unknown): Result<LeversParams, string> {
  const r = keyed(raw, 'levers', KEYS);
  if (!r.ok) {
    return r;
  }
  const { couples, target } = r.value;
  // At most 4^8 configurations: every search over them (the reach pass's, workFits') is small.
  const parts = count('parts', r.value.parts, 2, 8);
  if (!parts.ok) {
    return parts;
  }
  const positions = count('positions', r.value.positions, 2, 4);
  if (!positions.ok) {
    return positions;
  }
  const n = parts.value;
  if (!Array.isArray(couples) || couples.length !== n) {
    return { ok: false, error: `couples must be an array of ${n} lists` };
  }
  const links: number[][] = [];
  for (const [i, c] of couples.entries()) {
    const one = couplesOf(i, c, n);
    if (!one.ok) {
      return one;
    }
    links.push(one.value);
  }
  if (!Array.isArray(target) || target.length !== n) {
    return { ok: false, error: `target must be an array of ${n} positions` };
  }
  const bad = target.findIndex((v: unknown) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= positions.value);
  if (bad !== -1) {
    return { ok: false, error: `target: ${show(target[bad])} at lever ${bad} is not a position in 0..${positions.value - 1}` };
  }
  const rects = rectList(r.value.rects, n);
  if (!rects.ok) {
    return rects;
  }
  const goal = target as number[]; // every entry an integer position, checked above
  return { ok: true, value: { parts: n, positions: positions.value, couples: links, target: [...goal], rects: rects.value } };
}

/**
 * Whether `work` is a configuration of `parts` positions in 0..`positions - 1`, each a safe integer. Total over the
 * save codec's domain (D10): a hole, a non-number or a huge value is a misfit, never a throw.
 */
export function fitsConfiguration(work: readonly number[], parts: number, positions: number): boolean {
  if (work.length !== parts) {
    return false;
  }
  for (let i = 0; i < parts; i++) {
    const v = work[i];
    if (v === undefined || !Number.isSafeInteger(v) || v < 0 || v >= positions) {
      return false;
    }
  }
  return true;
}

/** Every part at 0: what a device's session starts from and what it shows before any input (`setting`'s too). */
export function zeros(p: { readonly parts: number }): readonly number[] {
  return new Array<number>(p.parts).fill(0);
}

/**
 * `reachable`'s bound, in throws tried: every throw from every configuration of the largest decode-legal instance
 * (4^8 configurations x 8 throws), so the shipped bound never stops on a decode-legal one.
 */
export const LEVERS_FIT_STEPS = 524_288;

/**
 * Whether the throws reach `work` (a fitting configuration) from the start: a breadth-first walk over the configurations,
 * each a number in base `positions` (lever i its i-th digit), until it meets `work`; null when it tried `budget` throws
 * first. It answers reached or not, never a throw order (the method is the server's tier 3).
 */
export function reachable(p: LeversParams, work: readonly number[], budget: number = LEVERS_FIT_STEPS): boolean | null {
  const { parts, positions } = p;
  const unit = Array.from({ length: parts }, (_, i) => positions ** i);
  const moves = p.couples.map((c, i) => [i, ...c]);
  const goal = work.reduce((n, v, i) => n + v * (unit[i] ?? 0), 0);
  const seen = new Uint8Array(positions ** parts);
  const queue = [0];
  seen[0] = 1;
  let steps = 0;
  for (let head = 0; head < queue.length; head++) {
    const s = queue[head] ?? 0;
    if (s === goal) {
      return true;
    }
    for (const moved of moves) {
      if (steps >= budget) {
        return null;
      }
      steps++;
      let next = s;
      for (const j of moved) {
        const u = unit[j] ?? 0;
        // Lever j's digit one on, wrapping at `positions` (the lever moves once per throw: no lever is listed twice).
        next += Math.floor(s / u) % positions === positions - 1 ? u - u * positions : u;
      }
      if (seen[next] === 0) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return false;
}

export const LEVERS_RULES = Object.freeze({
  type: 'levers',
  check: 'reach',
  goal: 'shown',
  presentation: 'view',
  wrong: 'none',
  // Unused for a reach type: the configuration posts itself once it reaches the goal.
  commit: 'control',
  decodeParams,
  answerShape: (p: LeversParams): { len: number; max: number } => ({ len: p.parts, max: p.positions - 1 }),
  initial: zeros,
  startShown: zeros,
  // A work an older version left may fit the shape and still lie beyond every throw from the start (B2): the device
  // could then never reach its goal, so that work goes and the device starts over. A stopped search is no fit too.
  workFits: (p: LeversParams, work: readonly number[]): boolean => fitsConfiguration(work, p.parts, p.positions) && reachable(p, work) === true,
  controls: [{ name: 'lever', on: 'click' }],
} as const satisfies PuzzleTypeData<'levers', LeversParams>);
