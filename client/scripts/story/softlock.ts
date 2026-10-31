// The soft-lock model checker (docs/PUZZLES-PLAN.md T9; lint codes `world/softlock`, `world/state-cap`): in each
// section, every state the player can reach from the section's entry can still reach a `leave`. It runs the
// runtime's own successor relation and search kernel from the runtime's start, with the runtime's one cap (X4, X9),
// so the build proves exactly what a resume can meet. LW3 wires it into the story gate. No node:*, like lint.ts.
import { searchSection, sectionEntry } from '../../src/explore/reconcile.ts';
import { RESUME_STATE_CAP, actions, reduce } from '../../src/explore/reduce.ts';
import type { ExploreAction, Step } from '../../src/explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../../src/explore/state.ts';
import type { WorldState } from '../../src/explore/state.ts';
import type { PuzzleLocalId, SectionId } from '../../src/story/staging.ts';
import type { WorldPublicBody } from '../../src/world/types.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding, LintCode } from './lint.ts';

/** One section's verdict; `states` is the count of distinct section states, null when the search hit the cap. */
export type SectionCheck = { section: SectionId; states: number | null; findings: Finding[] };

function finding(code: LintCode, file: string, message: string): Finding {
  return { code, severity: LINT_CODES[code], file, line: 0, message };
}

/** The action of `from` that opened `puzzle` (a `closed` or `puzzle-ended` step stands for it). */
function opener(w: WorldPublicBody, from: WorldState, puzzle: PuzzleLocalId): ExploreAction | undefined {
  return actions(w, from).find((a) => reduce(w, from, a).effects.some((e) => e.kind === 'puzzle' && e.puzzle === puzzle));
}

function describe(w: WorldPublicBody, from: WorldState, step: Step): string {
  switch (step.kind) {
    case 'tap':
      return `tap ${step.hotspot}`;
    case 'insert':
      return `insert ${step.hotspot} ${step.item}`;
    case 'event-returned':
      return `return from ${from.pendingStory[0] ?? '?'}`;
    case 'closed':
    case 'puzzle-ended': {
      const opened = opener(w, from, step.puzzle);
      const how = opened === undefined ? `open ${step.puzzle}` : describe(w, from, opened);
      return `${how} → ${step.puzzle} ${step.kind === 'closed' ? 'closed' : step.outcome}`;
    }
    case 'enter-section':
    case 'attempt-failed':
    case 'hint-opened':
      // Not steps of the successor relation; printed as data should a future relation add them.
      return JSON.stringify(step);
    default: {
      const never: never = step;
      return never;
    }
  }
}

/**
 * Proves section S of a public world body (the build has no `version`; LW3 stamps it on emit). `file` is the
 * finding's file (`story/<ch>/world.json`). The `world/softlock` message carries the shortest action path from the
 * entry to the first stuck state in BFS order.
 */
export function checkSection(w: WorldPublicBody, section: SectionId, file: string): SectionCheck {
  const start = sectionEntry(w, EMPTY_WORLD_STATE, section);
  const states: WorldState[] = [start];
  const parent: Array<{ from: number; step: Step } | undefined> = [undefined];
  const into: number[][] = [[]];
  const leaving = new Set<number>();
  const r = searchSection(w, start, section, RESUME_STATE_CAP, {
    onEdge: (from, succ, to, isNew) => {
      if (to === null) {
        leaving.add(from);
        return;
      }
      if (isNew) {
        states[to] = succ.state;
        parent[to] = { from, step: succ.step };
        into[to] = [];
      }
      into[to]?.push(from);
    },
  });
  if (r.result === 'cap') {
    const message = `section ${section}: more than ${RESUME_STATE_CAP} states (RESUME_STATE_CAP), too large to prove at resume (X9); split it into sections`;
    return { section, states: null, findings: [finding('world/state-cap', file, message)] };
  }
  // Backwards from every state with a leave edge: whatever this does not reach is stuck.
  const exits = new Uint8Array(r.states);
  const queue = [...leaving];
  for (const i of queue) {
    exits[i] = 1;
  }
  for (let q = 0; q < queue.length; q++) {
    const reached = queue[q];
    for (const from of reached === undefined ? [] : (into[reached] ?? [])) {
      if (exits[from] === 0) {
        exits[from] = 1;
        queue.push(from);
      }
    }
  }
  const stuck = exits.indexOf(0);
  if (stuck === -1) {
    return { section, states: r.states, findings: [] };
  }
  const steps: string[] = [];
  for (let at = parent[stuck]; at !== undefined; at = parent[at.from]) {
    const from = states[at.from];
    steps.push(from === undefined ? JSON.stringify(at.step) : describe(w, from, at.step));
  }
  const path = steps.length === 0 ? '(the section entry itself)' : steps.reverse().join(' → ');
  const room = states[stuck]?.room ?? 'no room';
  const message = `section ${section}: a reachable state cannot reach a leave (stuck in ${room}): ${path}`;
  return { section, states: r.states, findings: [finding('world/softlock', file, message)] };
}

/** Every section of the world, in key order. */
export function checkWorld(w: WorldPublicBody, file: string): SectionCheck[] {
  return (Object.keys(w.sections) as SectionId[]).sort().map((s) => checkSection(w, s, file)); // the keys are ids
}
