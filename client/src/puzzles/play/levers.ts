// The `levers` device's play half (engine plan §7.1, §7.5; GM8a): chunk code, imported only by its type UI
// (`rules-lazy`) and by the build's lint half, so the player's throw is the build's throw. Pure. It value-imports
// nothing: the chunk's engine bindings stay the ones its UI already reads.
import type { PuzzleTypePlay } from '../rules/index.ts';
import type { LeversParams } from '../rules/levers.ts';

/**
 * The least side of a device part, in CSS px: the room's hotspots' (`MIN_TARGET_PX`, explore/controller.ts). A literal,
 * held equal to the controller's by a test: the controller is the explore family's chunk, never this one's (A3).
 */
export const PART_MIN_PX = 44;

/** Position `v` one on, wrapping at `positions`. */
export function advance(v: number, positions: number): number {
  return (v + 1) % positions;
}

/**
 * The configuration after a throw of lever `part`: it and each lever it couples one position on, in a fresh array; null
 * for no lever `part` or a configuration of another length.
 */
export function throwPart(p: LeversParams, a: readonly number[], part: number): readonly number[] | null {
  const couples = p.couples[part];
  if (couples === undefined || a.length !== p.parts) {
    return null;
  }
  const next = [...a];
  for (const j of [part, ...couples]) {
    next[j] = advance(next[j] ?? 0, p.positions);
  }
  return next;
}

/** Whether `a` stands on the goal: one position per lever, each its target's. */
export function reached(p: LeversParams, a: readonly number[]): boolean {
  return a.length === p.parts && p.target.every((t, i) => a[i] === t);
}

/** What a reached configuration posts: the configuration itself (one configuration, one answer). */
export function canonical(_p: LeversParams, a: readonly number[]): readonly number[] {
  return a;
}

export const LEVERS_PLAY = Object.freeze({
  // The only answer a levers device posts is a reached one: it posts itself, there is no Try.
  validAnswer: reached,
  reached,
  canonical,
  // A throw is never wrong (`wrong: 'none'`); a press that throws nothing keeps the work.
  press: (p: LeversParams, work: readonly number[], part: number): { work: readonly number[]; wrong: boolean } => ({ work: throwPart(p, work, part) ?? work, wrong: false }),
} satisfies PuzzleTypePlay<LeversParams>);
