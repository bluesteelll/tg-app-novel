// The soft-lock model checker (docs/PUZZLES-PLAN.md T9; lint codes `world/softlock`, `world/state-cap`): in each
// section, every state the player can reach from the section's entry can still reach a `leave`. It runs the
// runtime's own successor relation and search kernel from the runtime's start, with the runtime's one cap (X4, X9),
// so the build proves exactly what a resume can meet. LW3 wires it into the story gate. A receiving chapter's section
// is proved from each start its inherited items allow; given the items a later chapter inherits as required, each
// leave must hold them (`world/carry-leave`; engine plan §6.6; the code is the carry module's, mechanics/carry.ts,
// which never imports this file). No node:*, like lint.ts.
import { RESUME_STATE_CAP } from '../../src/explore/reduce.ts';
import type { ExploreAction, Step } from '../../src/explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../../src/explore/state.ts';
import type { WorldState } from '../../src/explore/state.ts';
import type { KernelWorld, RulesRegistry } from '../../src/mechanics/contract.ts';
import { MECHANIC_DATA } from '../../src/mechanics/data/index.ts';
import type { DataRegistry } from '../../src/mechanics/data/index.ts';
import { actions, reduce } from '../../src/mechanics/rules/core.ts';
import { MECHANIC_RULES } from '../../src/mechanics/rules/index.ts';
import { RESUME_WORK_PER_STATE, searchSection, sectionEntry } from '../../src/mechanics/rules/search.ts';
import type { SearchStats, Walk } from '../../src/mechanics/rules/search.ts';
import type { ChapterId, PuzzleLocalId, SectionId } from '../../src/story/staging.ts';
import type { ItemId } from '../../src/world/types.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding, LintCode } from './lint.ts';
import { CARRY_PROOF_CODES, MAX_OPTIONAL_INHERITS } from './mechanics/carry.ts';

/** One section's verdict; `states` is the count of distinct section states (summed over its starts), null when a
 *  start's search hit the cap or when the section was not searched (`gatesVisualOnly`, or more than
 *  MAX_OPTIONAL_INHERITS optional inherited items). */
export type SectionCheck = { section: SectionId; states: number | null; findings: Finding[] };

function finding(code: LintCode, file: string, message: string): Finding {
  return { code, severity: LINT_CODES[code], file, line: 0, message };
}

/** The action of `from` that opened `puzzle` (a `closed` or `puzzle-ended` step stands for it). */
function opener(w: KernelWorld, from: WorldState, puzzle: PuzzleLocalId): ExploreAction | undefined {
  return actions(w, from).find((a) => reduce(w, from, a).effects.some((e) => e.kind === 'puzzle' && e.puzzle === puzzle));
}

function describe(w: KernelWorld, from: WorldState, step: Step): string {
  switch (step.kind) {
    case 'tap':
      return `tap ${step.hotspot}`;
    case 'insert':
      return `insert ${step.hotspot} ${step.item}`;
    case 'event-returned':
      return `return from ${from.pendingStory[0] ?? '?'}`;
    case 'use':
      return `use ${step.item} on ${step.target}`;
    case 'closed':
    case 'puzzle-ended': {
      const opened = opener(w, from, step.puzzle);
      const how = opened === undefined ? `open ${step.puzzle}` : describe(w, from, opened);
      return `${how} → ${step.puzzle} ${step.kind === 'closed' ? 'closed' : step.outcome}`;
    }
    case 'leave-view':
      return `leave view ${from.room ?? '?'}`;
    case 'combine':
      return `combine ${step.a} + ${step.b}`;
    case 'enter-section':
    case 'attempt-failed':
    case 'hint-opened':
    case 'device-moved':
      // Not steps of the successor relation; printed as data should a future relation add them.
      return JSON.stringify(step);
    default: {
      const never: never = step;
      return never;
    }
  }
}

/**
 * Whether a gating rule of section S reads a visual-only atom (a module atom its data declares `gating: false`): the
 * facts the modules' `reads` hand the section key, which cannot encode one (`keyPlan`'s invariant, rules/search.ts).
 * Each such read comes from a gating site the flags, use or combine lint passes to `condFindings`, so the world is
 * refused at the author's line (`world/visual-only-atom`, E; for a recipe whose `gives` or `keep` names no item, the
 * recipe's `world/recipe-unknown-ref`, E) and S is not searched. The atom test repeats
 * scripts/story/mechanics/conditions.ts:94's (Q-F3: its export is the next holder's).
 */
export function gatesVisualOnly(w: KernelWorld, section: SectionId, rules: RulesRegistry = MECHANIC_RULES, data: DataRegistry = MECHANIC_DATA): boolean {
  const visualOnly = (kind: string): boolean => data.some((d) => d.atoms !== undefined && Object.hasOwn(d.atoms, kind) && d.atoms[kind]?.gating === false);
  return rules.some((m) => m.reads(w, section).some((a) => visualOnly(a.kind)));
}

/** One start's search: capped (its `world/state-cap`), or its state count, its first stuck state's `world/softlock`
 *  and, per required item, its first leave without it. */
type StartRun =
  | { readonly states: null; readonly findings: readonly Finding[] }
  | { readonly states: number; readonly softlock: Finding | null; readonly leaves: ReadonlyMap<ItemId, Finding> };

/**
 * Proves section S of the proof world: the public body and its decoded `mods` (the build has no `version`; LW3 stamps
 * it on emit). `file` is the finding's file (`story/<ch>/world.json`). The `world/softlock` message carries the
 * shortest action path from the entry to the first stuck state in BFS order: per hop, the free moves that reach the
 * member of the place it was taken in (the search's walk), then its step, each described from the state before it.
 * `required` (story.ts's carry pass; the per-world run passes none): each item S gives that a later chapter inherits as
 * required, with its first receiver; every leave edge must hold it, and its first leave without it, in BFS order, is a
 * `world/carry-leave` with that path. A section not searched, or capped, checks no leave: its own error fails it.
 *
 * The world's inherited items (`mods.carry.inherits`, engine plan §6.6) set its starts: each required one held in every
 * start, the k optional ones in each of their 2^k subsets, from all absent up; each start is searched under its own cap
 * (what one resume meets, X9), the count is their sum, the first capped start caps the section, and the findings are
 * the first failing start's. With more than one start a message names its start: `section S (start: no a, b): ...`.
 * Above MAX_OPTIONAL_INHERITS optional items no start is searched: `world/inherit-count` (E) refuses the world.
 */
export function checkSection(w: KernelWorld, section: SectionId, file: string, required: ReadonlyMap<ItemId, ChapterId> = new Map()): SectionCheck {
  if (gatesVisualOnly(w, section)) {
    // Not searched, so not proved: `states: null` keeps world.ts's second search off S, as at the cap.
    return { section, states: null, findings: [] };
  }
  // A body without `mods` or without `carry` (a hand-built kernel world) is carry-less.
  const inherits = w.mods?.carry?.inherits ?? [];
  const optional = inherits.filter((e) => !e.required);
  if (optional.length > MAX_OPTIONAL_INHERITS) {
    return { section, states: null, findings: [] };
  }
  let states = 0;
  let softlock: Finding | null = null;
  const leaves = new Map<ItemId, Finding>();
  for (let mask = 0; mask < 2 ** optional.length; mask++) {
    const present = new Set(optional.filter((_, b) => ((mask >> b) & 1) === 1).map((e) => e.id));
    // In `inherits` order, as the runtime's chapter start injects them.
    const held = inherits.filter((e) => e.required || present.has(e.id)).map((e) => e.id);
    const label = optional.length === 0 ? '' : ` (start: ${optional.map((e) => (present.has(e.id) ? e.id : `no ${e.id}`)).join(', ')})`;
    const entry = sectionEntry(w, held.length === 0 ? EMPTY_WORLD_STATE : { ...EMPTY_WORLD_STATE, held }, section);
    const run = searchStart(w, section, file, entry, `section ${section}${label}`, required);
    if (run.states === null) {
      return { section, states: null, findings: [...run.findings] };
    }
    states += run.states;
    softlock ??= run.softlock;
    for (const [item, f] of run.leaves) {
      if (!leaves.has(item)) {
        leaves.set(item, f);
      }
    }
  }
  return { section, states, findings: [...(softlock === null ? [] : [softlock]), ...leaves.values()] };
}

/** Searches section S from `start`; `head` opens each message (`section S`, with the start's label if any). */
function searchStart(w: KernelWorld, section: SectionId, file: string, start: WorldState, head: string, required: ReadonlyMap<ItemId, ChapterId>): StartRun {
  const states: WorldState[] = [start];
  const parent: Array<{ from: number; step: Step; walk: Walk } | undefined> = [undefined];
  const into: number[][] = [[]];
  const leaving = new Set<number>();
  // Per required item, its first leave without it: the state it is taken from, the walk there and the leave step.
  const without = new Map<ItemId, { from: number; step: Step; walk: Walk }>();
  // An object, not a `let`: TS narrows a `let` to its initializer, and the callback's write is invisible to it.
  const spent: { bound: SearchStats['bound'] } = { bound: null };
  const r = searchSection(w, start, section, RESUME_STATE_CAP, {
    onEdge: (from, succ, to, isNew, walk) => {
      if (to === null) {
        leaving.add(from);
        for (const item of required.keys()) {
          if (!without.has(item) && !succ.state.held.includes(item)) {
            without.set(item, { from, step: succ.step, walk });
          }
        }
        return;
      }
      if (isNew) {
        states[to] = succ.state;
        parent[to] = { from, step: succ.step, walk };
        into[to] = [];
      }
      into[to]?.push(from);
    },
    onStats: (stats) => {
      spent.bound = stats.bound;
    },
  });
  if (r.result === 'cap') {
    const message =
      spent.bound === 'work'
        ? `${head}: more than ${RESUME_STATE_CAP * RESUME_WORK_PER_STATE} successor evaluations (${RESUME_WORK_PER_STATE} per state of RESUME_STATE_CAP), too large to prove at resume (X9); split it into sections`
        : `${head}: more than ${RESUME_STATE_CAP} states (RESUME_STATE_CAP), too large to prove at resume (X9); split it into sections`;
    return { states: null, findings: [finding('world/state-cap', file, message)] };
  }
  const said = (before: WorldState | undefined, step: Step): string => (before === undefined ? JSON.stringify(step) : describe(w, before, step));
  /** The free moves from state `from` to the member its step is taken in, then the step: one hop's texts in order. */
  const hop = (from: number, walk: Walk, step: Step): string[] => {
    const out: string[] = [];
    let before = states[from];
    for (const move of walk) {
      out.push(said(before, move.step));
      before = move.state;
    }
    out.push(said(before, step));
    return out;
  };
  /** Every hop from the entry to state `to`, in path order. */
  const pathTo = (to: number): string[] => {
    const hops: string[][] = [];
    for (let at = parent[to]; at !== undefined; at = parent[at.from]) {
      hops.push(hop(at.from, at.walk, at.step));
    }
    return hops.reverse().flat();
  };
  const leaves = new Map<ItemId, Finding>();
  for (const [item, v] of without) {
    const path = [...pathTo(v.from), ...hop(v.from, v.walk, v.step)].join(' → ');
    const message = `${head}: a leave without '${item}', which ${required.get(item) ?? '?'} inherits as required (§6.6): ${path}`;
    leaves.set(item, { code: 'world/carry-leave', severity: CARRY_PROOF_CODES['world/carry-leave'], file, line: 0, message });
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
    return { states: r.states, softlock: null, leaves };
  }
  const steps = pathTo(stuck);
  const path = steps.length === 0 ? '(the section entry itself)' : steps.join(' → ');
  const room = states[stuck]?.room ?? 'no room';
  const message = `${head}: a reachable state cannot reach a leave (stuck in ${room}): ${path}`;
  return { states: r.states, softlock: finding('world/softlock', file, message), leaves };
}

/** Every section of the world, in key order. */
export function checkWorld(w: KernelWorld, file: string): SectionCheck[] {
  return (Object.keys(w.sections) as SectionId[]).sort().map((s) => checkSection(w, s, file)); // the keys are ids
}
