// The searches (engine plan §3.2 "search", §3.3; docs/PUZZLES-PLAN.md X4, X9): the successor relation, the section
// key, the one section search of the build's soft-lock checker and the resume, and the guarded section entries that
// prove an unproved section at its first entry. The rules half of the mechanics engine: explore-ui chunk code that
// only the explore controller imports (the `rules-lazy` arch rule); the story tool runs the same functions. Never
// throws on save data. Pure.
import { RESUME_STATE_CAP, own, runOf, sectionScope, worldIndex } from '../../explore/reduce.ts';
import type { ExploreAction, ExploreEffect, Successor } from '../../explore/reduce.ts';
import type { PuzzleOutcome, PuzzleRun, WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId, SectionId } from '../../story/staging.ts';
import type { HotspotKey, ItemId, RoomId, WorldPublicBody } from '../../world/types.ts';
import { actions, reduce } from './core.ts';

/** A record's own entries keyed by its id brand (a save's keys are checked against the world before any use). */
function entriesOf<K extends string, V>(r: Readonly<Record<K, V>>): Array<[K, V]> {
  return Object.entries(r) as Array<[K, V]>; // keys of a WorldState record are ids of their kind
}

// ---------------------------------------------------------------------------------------------------------------
// The successor relation

const hasLeave = (effects: readonly ExploreEffect[]): boolean => effects.some((e) => e.kind === 'leave');

/**
 * THE successor relation of the soft-lock checker, the seeded playthroughs and reconcile: every action through
 * `reduce`; an action whose effects open puzzle p expands into `closed` (the post-action state: Back, or a reload,
 * since the puzzle is an overlay) and one successor per outcome (`solved`; `failed` when p has `maxAttempts`).
 */
export function successors(w: WorldPublicBody, s: WorldState): Successor[] {
  const out: Successor[] = [];
  for (const a of actions(w, s)) {
    const r = reduce(w, s, a);
    const opened = r.effects.find((e) => e.kind === 'puzzle');
    if (opened === undefined) {
      out.push({ step: a, state: r.state, leaves: hasLeave(r.effects) });
      continue;
    }
    const puzzle = opened.puzzle;
    out.push({ step: { kind: 'closed', puzzle }, state: r.state, leaves: false });
    const limited = (worldIndex(w).puzzles.get(puzzle)?.maxAttempts ?? null) !== null;
    const outcomes: PuzzleOutcome[] = limited ? ['solved', 'failed'] : ['solved'];
    for (const outcome of outcomes) {
      const step: ExploreAction = { kind: 'puzzle-ended', puzzle, outcome };
      const end = reduce(w, r.state, step);
      out.push({ step, state: end.state, leaves: hasLeave(end.effects) });
    }
  }
  return out;
}

/** The members of `list` in `keep`, sorted and joined: a set's encoding, whatever order play added them in. */
function setPart(list: readonly string[], keep: ReadonlySet<string>): string {
  const members: string[] = [];
  for (const x of list) {
    if (keep.has(x)) {
      members.push(x);
    }
  }
  return members.length > 1 ? members.sort().join(',') : (members[0] ?? '');
}

/**
 * The canonical key of `s` restricted to section S, the one dedup key of both searches: room, pendingStory (an
 * ordered queue), S's keys in taken / open / slots / fired, the outcomes of S's lock puzzles, the items and docs S
 * gives in held / used / docs. The set-valued fields are sorted, so the order play added them in never splits one
 * state into two. Abstracted (read by no rule): examined, visited, attempts, hints opened; ignored: section,
 * lastRoom, unproved, everything outside S (X15). Ids never hold `|`, `;`, `=` or `,`, so the joins are unambiguous.
 */
export function sectionKey(w: WorldPublicBody, s: WorldState, section: SectionId): string {
  const scope = sectionScope(w, section);
  const slots: string[] = [];
  for (const { key, lock } of scope.locks) {
    const stored = own(s.slots, key);
    if (stored !== undefined && stored.some((c) => c !== null)) {
      slots.push(`${key}=${lock.slots.map((_, i) => stored[i] ?? '').join(',')}`);
    }
  }
  return [
    s.room ?? '',
    s.pendingStory.join(','),
    setPart(s.taken, scope.hotspots),
    setPart(s.open, scope.hotspots),
    slots.join(';'),
    setPart(s.fired, scope.fired),
    scope.puzzles.map((p) => runOf(s, p).outcome ?? '').join(','),
    setPart(s.held, scope.items),
    setPart(s.used, scope.items),
    setPart(s.docs, scope.docs),
  ].join('|');
}

// ---------------------------------------------------------------------------------------------------------------
// The section entries and the section search

function outside<T extends string>(list: readonly T[], keys: ReadonlySet<T>): T[] {
  return list.filter((x) => !keys.has(x));
}

/**
 * Restarts section S: every key of S's rooms and hotspots leaves taken / examined / open / slots / fired / visited,
 * the runs of S's lock puzzles and the items and docs S gives are removed, `section` and `room` become null,
 * `lastRoom[S]` and `pendingStory` are cleared, and S leaves `unproved`. Callers pass a state whose section is S or
 * null, so the cleared `section` / `room` / `pendingStory` are never another section's.
 */
export function resetSection(w: WorldPublicBody, s: WorldState, section: SectionId): WorldState {
  const scope = sectionScope(w, section);
  const slots: Record<HotspotKey, ReadonlyArray<ItemId | null>> = {};
  for (const [key, cells] of entriesOf(s.slots)) {
    if (!scope.hotspots.has(key)) {
      slots[key] = cells;
    }
  }
  const dropRuns = new Set<PuzzleLocalId>(scope.puzzles);
  const puzzles: Record<PuzzleLocalId, PuzzleRun> = {};
  for (const [p, run] of entriesOf(s.puzzles)) {
    if (!dropRuns.has(p)) {
      puzzles[p] = run;
    }
  }
  const lastRoom: Record<SectionId, RoomId> = {};
  for (const [sid, rid] of entriesOf(s.lastRoom)) {
    if (sid !== section) {
      lastRoom[sid] = rid;
    }
  }
  return {
    ...s,
    section: null,
    room: null,
    lastRoom,
    visited: outside(s.visited, scope.rooms),
    held: outside(s.held, scope.items),
    used: outside(s.used, scope.items),
    docs: outside(s.docs, scope.docs),
    taken: outside(s.taken, scope.hotspots),
    examined: outside(s.examined, scope.hotspots),
    slots,
    open: outside(s.open, scope.hotspots),
    fired: outside(s.fired, scope.fired),
    pendingStory: [],
    puzzles,
    unproved: s.unproved.filter((x) => x !== section),
  };
}

function enter(section: SectionId): ExploreAction {
  return { kind: 'enter-section', section };
}

/** `reduce(w, resetSection(w, s, S), enter-section S).state`: the start of both searches (build: s = empty). */
export function sectionEntry(w: WorldPublicBody, s: WorldState, section: SectionId): WorldState {
  return reduce(w, resetSection(w, s, section), enter(section)).state;
}

export type SearchOptions = {
  /** Stop with 'found' when a state with this `sectionKey` is discovered. */
  readonly target?: string;
  /**
   * Every edge: `from` and `to` are discovery indices (0 = start); `to` is null for a `leaves` successor, which is a
   * goal edge and never enqueued; `isNew` marks the edge that discovered `to`.
   */
  readonly onEdge?: (from: number, succ: Successor, to: number | null, isNew: boolean) => void;
};
export type SearchResult = { readonly result: 'found' | 'exhausted' | 'cap'; readonly states: number };

/**
 * THE section search of the soft-lock checker and the resume (X9 "one cap"): a BFS over `successors` from `start`,
 * deduplicated by `sectionKey(S)`. Discovering a (cap+1)-th distinct state stops with 'cap', so the runtime never
 * searches past a count the build accepted.
 */
export function searchSection(w: WorldPublicBody, start: WorldState, section: SectionId, cap: number, opts: SearchOptions = {}): SearchResult {
  const seen = new Map<string, number>();
  const queue: WorldState[] = [start];
  const startKey = sectionKey(w, start, section);
  seen.set(startKey, 0);
  if (startKey === opts.target) {
    return { result: 'found', states: 1 };
  }
  for (let from = 0; from < queue.length; from++) {
    const state = queue[from];
    if (state === undefined) {
      break;
    }
    for (const succ of successors(w, state)) {
      if (succ.leaves) {
        opts.onEdge?.(from, succ, null, false);
        continue;
      }
      const key = sectionKey(w, succ.state, section);
      const known = seen.get(key);
      if (known !== undefined) {
        opts.onEdge?.(from, succ, known, false);
        continue;
      }
      if (seen.size + 1 > cap) {
        return { result: 'cap', states: seen.size };
      }
      const to = seen.size;
      seen.set(key, to);
      queue.push(succ.state);
      opts.onEdge?.(from, succ, to, true);
      if (key === opts.target) {
        return { result: 'found', states: seen.size };
      }
    }
  }
  return { result: 'exhausted', states: seen.size };
}

/** Whether the current world can produce `s` from S's entry: 'yes' when the search meets `sectionKey(s)`. */
export function inSectionReach(w: WorldPublicBody, s: WorldState, section: SectionId, cap: number): 'yes' | 'no' | 'cap' {
  const r = searchSection(w, sectionEntry(w, s, section), section, cap, { target: sectionKey(w, s, section) });
  return r.result === 'found' ? 'yes' : r.result === 'cap' ? 'cap' : 'no';
}

type Admitted = { state: WorldState; effects: ExploreEffect[] };

/** The search said 'yes': the outcome stands, S leaves `unproved`, and the save notices the change. */
function proved(out: Admitted, section: SectionId): Admitted {
  const state = { ...out.state, unproved: out.state.unproved.filter((x) => x !== section) };
  const dirty = out.effects.some((e) => e.kind === 'dirty');
  return { state, effects: dirty ? out.effects : [...out.effects, { kind: 'dirty' }] };
}

/** The search said 'no' or 'cap': S restarts (a `reset` effect, then `sectionEntry` and its entry effects). */
function restart(w: WorldPublicBody, s: WorldState, section: SectionId): Admitted {
  const restarted = reduce(w, resetSection(w, s, section), enter(section));
  return { state: restarted.state, effects: [{ kind: 'reset', section }, ...restarted.effects] };
}

/**
 * X9 step 5, the explore controller's way to enter a section with no event knot pending. S not in `unproved`: plain
 * `reduce`. Otherwise enter with `reduce` and search the entered state: 'yes' keeps it, 'no' / 'cap' restarts S. S
 * leaves `unproved` either way.
 */
export function admitSection(w: WorldPublicBody, s: WorldState, section: SectionId): Admitted {
  const entered = reduce(w, s, enter(section));
  if (!s.unproved.includes(section)) {
    return entered;
  }
  return inSectionReach(w, entered.state, section, RESUME_STATE_CAP) === 'yes' ? proved(entered, section) : restart(w, s, section);
}

/**
 * The event knot's return into section S (engine plan §3.4: step 4 at the first entry, the event return included).
 * S not in `unproved`, no knot pending, or S not the state's current section: plain `reduce(event-returned)`.
 * Otherwise the saved state itself is searched, its pending knot included: 'yes' returns as `event-returned` does,
 * 'no' / 'cap' restarts S (`resetSection` drops the knot, so it never resumes on a reset state). S leaves `unproved`
 * either way.
 */
export function admitEvent(w: WorldPublicBody, s: WorldState, section: SectionId): Admitted {
  const returned = reduce(w, s, { kind: 'event-returned', section });
  if (!s.unproved.includes(section) || s.pendingStory.length === 0 || s.section !== section) {
    return returned;
  }
  return inSectionReach(w, s, section, RESUME_STATE_CAP) === 'yes' ? proved(returned, section) : restart(w, s, section);
}
