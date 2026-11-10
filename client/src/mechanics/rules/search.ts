// The searches (engine plan §3.2 "search", §3.3; docs/PUZZLES-PLAN.md X4, X9): the successor relation, the section
// key, the one section search of the build's soft-lock checker and the resume, and the guarded section entries that
// prove an unproved section at its first entry. The rules half of the mechanics engine: explore-ui chunk code that
// only the explore controller imports (the `rules-lazy` arch rule); the story tool runs the same functions. Never
// throws on save data. Pure.
import { RESUME_STATE_CAP, lockOf, own, runOf, sectionScope, worldIndex } from '../../explore/reduce.ts';
import type { ExploreAction, ExploreEffect, SectionScope, Step, Successor } from '../../explore/reduce.ts';
import type { PuzzleOutcome, PuzzleRun, WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId, SectionId } from '../../story/staging.ts';
import type { HotspotKey, ItemId, Lock, RoomId, WorldPublicBody } from '../../world/types.ts';
import type { RulesRegistry, SectionAction } from '../contract.ts';
import { reduce } from './core.ts';
import { MECHANIC_RULES } from './index.ts';

/** A record's own entries keyed by its id brand (a save's keys are checked against the world before any use). */
function entriesOf<K extends string, V>(r: Readonly<Record<K, V>>): Array<[K, V]> {
  return Object.entries(r) as Array<[K, V]>; // keys of a WorldState record are ids of their kind
}

// ---------------------------------------------------------------------------------------------------------------
// The successor relation

const hasLeave = (effects: readonly ExploreEffect[]): boolean => effects.some((e) => e.kind === 'leave');

/**
 * THE successor relation of the soft-lock checker, the seeded playthroughs and reconcile: every module's actions, core
 * first, through `reduce`; an action whose effects open puzzle p expands into `closed` (the post-action state: Back,
 * or a reload, since the puzzle is an overlay) and one successor per outcome (`solved`; `failed` when p has
 * `maxAttempts`).
 */
export function successors(w: WorldPublicBody, s: WorldState, rules: RulesRegistry = MECHANIC_RULES): Successor[] {
  const out: Successor[] = [];
  for (const m of rules) {
    for (const action of m.actions(w, s)) {
      const a = action as SectionAction; // the registry widens each module's actions to { kind }; they are SectionAction's
      const r = reduce(w, s, a, rules);
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
        const end = reduce(w, r.state, step, rules);
        out.push({ step, state: end.state, leaves: hasLeave(end.effects) });
      }
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
 * Every fact the registry's gating rules read in one section, grouped by kernel kind: what `sectionKey` encodes. The
 * groups of the four kinds no core rule reads are null until a module reads them, so core's key keeps its bytes.
 */
type KeyPlan = {
  readonly taken: ReadonlySet<string>;
  readonly open: ReadonlySet<string>;
  /** The locks read by `slot`, sorted by key. */
  readonly slots: ReadonlyArray<{ readonly key: HotspotKey; readonly lock: Lock }>;
  readonly fired: ReadonlySet<string>;
  /** The puzzles read by `solved`, `failed` or `abandoned`, sorted: each one's whole outcome is read. */
  readonly outcomes: readonly PuzzleLocalId[];
  readonly held: ReadonlySet<string>;
  readonly used: ReadonlySet<string>;
  readonly docs: ReadonlySet<string>;
  readonly examined: ReadonlySet<string> | null;
  readonly visited: ReadonlySet<string> | null;
  readonly attempts: readonly PuzzleLocalId[] | null;
  readonly hints: readonly PuzzleLocalId[] | null;
};

// Built once per (registry, world, section): the searches call `sectionKey` once per successor.
const PLANS = new WeakMap<RulesRegistry, WeakMap<WorldPublicBody, Map<SectionId, KeyPlan>>>();

const sortedIds = <T extends string>(ids: ReadonlySet<T>): T[] => [...ids].sort();

function keyPlan(w: WorldPublicBody, section: SectionId, rules: RulesRegistry): KeyPlan {
  let perRegistry = PLANS.get(rules);
  if (perRegistry === undefined) {
    perRegistry = new WeakMap();
    PLANS.set(rules, perRegistry);
  }
  let perWorld = perRegistry.get(w);
  if (perWorld === undefined) {
    perWorld = new Map();
    perRegistry.set(w, perWorld);
  }
  const cached = perWorld.get(section);
  if (cached !== undefined) {
    return cached;
  }
  const ix = worldIndex(w);
  const taken = new Set<string>();
  const open = new Set<string>();
  const slots = new Set<HotspotKey>();
  const fired = new Set<string>();
  const outcomes = new Set<PuzzleLocalId>();
  const held = new Set<string>();
  const used = new Set<string>();
  const docs = new Set<string>();
  let examined: Set<string> | null = null;
  let visited: Set<string> | null = null;
  let attempts: Set<PuzzleLocalId> | null = null;
  let hints: Set<PuzzleLocalId> | null = null;
  for (const m of rules) {
    for (const atom of m.reads(w, section)) {
      const id = atom.id;
      switch (atom.kind) {
        case 'taken':
          taken.add(id);
          break;
        case 'open':
          open.add(id);
          break;
        case 'slot':
          slots.add(id as HotspotKey); // a slot atom's id is its lock's hotspot key
          break;
        case 'fired':
          fired.add(id);
          break;
        case 'solved':
        case 'failed':
        case 'abandoned':
          outcomes.add(id as PuzzleLocalId); // an outcome atom's id is its puzzle
          break;
        case 'held':
          held.add(id);
          break;
        case 'used':
          used.add(id);
          break;
        case 'doc':
          docs.add(id);
          break;
        case 'examined':
          (examined ??= new Set()).add(id);
          break;
        case 'visited':
          (visited ??= new Set()).add(id);
          break;
        case 'attempt':
          (attempts ??= new Set()).add(id as PuzzleLocalId); // a run atom's id is its puzzle
          break;
        case 'hint':
          (hints ??= new Set()).add(id as PuzzleLocalId);
          break;
        case 'story':
          break; // the queue is always in the key, whole
        default: {
          // A module fact kind has no WorldState storage before its module declares a save slice.
          const kind: never = atom.kind;
          throw new Error(`invariant: ${m.id} reads a '${String(kind)}' fact, which the section key cannot encode`);
        }
      }
    }
  }
  const locks = sortedIds(slots).map((key) => {
    const entry = ix.hotspots.get(key);
    const lock = entry === undefined ? null : lockOf(entry.hotspot);
    if (lock === null) {
      throw new Error(`invariant: a slot atom names a lock, not '${key}'`);
    }
    return { key, lock };
  });
  const plan: KeyPlan = {
    taken,
    open,
    slots: locks,
    fired,
    outcomes: sortedIds(outcomes),
    held,
    used,
    docs,
    examined,
    visited,
    attempts: attempts === null ? null : sortedIds(attempts),
    hints: hints === null ? null : sortedIds(hints),
  };
  perWorld.set(section, plan);
  return plan;
}

/**
 * The canonical key of `s` restricted to section S, the one dedup key of both searches, derived from the facts every
 * module of `rules` reads in S (engine plan §3.2): room, pendingStory (an ordered queue), then the read facts in
 * taken / open / slots / fired, the outcomes of the read puzzles, held / used / docs, and examined / visited /
 * attempts / hints only when some module reads them. Core reads S's keys of the first eight, so its key abstracts
 * examined, visited, attempts and hints opened and ignores section, lastRoom, unproved and everything outside S
 * (X15). The set-valued fields are sorted, so the order play added them in never splits one state into two. Ids
 * never hold `|`, `;`, `=` or `,`, so the joins are unambiguous.
 */
export function sectionKey(w: WorldPublicBody, s: WorldState, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): string {
  const plan = keyPlan(w, section, rules);
  const slots: string[] = [];
  for (const { key, lock } of plan.slots) {
    const stored = own(s.slots, key);
    if (stored !== undefined && stored.some((c) => c !== null)) {
      slots.push(`${key}=${lock.slots.map((_, i) => stored[i] ?? '').join(',')}`);
    }
  }
  const parts = [
    s.room ?? '',
    s.pendingStory.join(','),
    setPart(s.taken, plan.taken),
    setPart(s.open, plan.open),
    slots.join(';'),
    setPart(s.fired, plan.fired),
    plan.outcomes.map((p) => runOf(s, p).outcome ?? '').join(','),
    setPart(s.held, plan.held),
    setPart(s.used, plan.used),
    setPart(s.docs, plan.docs),
  ];
  if (plan.examined !== null) {
    parts.push(setPart(s.examined, plan.examined));
  }
  if (plan.visited !== null) {
    parts.push(setPart(s.visited, plan.visited));
  }
  if (plan.attempts !== null) {
    parts.push(plan.attempts.map((p) => runOf(s, p).attempts).join(','));
  }
  if (plan.hints !== null) {
    parts.push(plan.hints.map((p) => runOf(s, p).hintsOpened).join(','));
  }
  return parts.join('|');
}

// ---------------------------------------------------------------------------------------------------------------
// The section entries and the section search

function outside<T extends string>(list: readonly T[], keys: ReadonlySet<T>): T[] {
  return list.filter((x) => !keys.has(x));
}

/**
 * S's own facts (engine plan §4 "Two scopes"): the kernel's `sectionScope` plus, from each module of `rules`, its
 * `scope` hook's items and `fired` keys (the items its data gives in S, the keys its triggers there write). The
 * `sectionScope` object itself when no module adds one; not cached (a hook scans its module's data in S). The reset
 * and the gating lints read it; a module's `reads` compose the same hook, so the section key and the reset agree.
 */
export function ownScope(w: WorldPublicBody, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): SectionScope {
  const scope = sectionScope(w, section);
  const items: ItemId[] = [];
  const fired: string[] = [];
  for (const m of rules) {
    const extra = m.scope?.(w, section);
    if (extra !== undefined) {
      items.push(...extra.items.filter((x) => !scope.items.has(x)));
      fired.push(...extra.fired.filter((x) => !scope.fired.has(x)));
    }
  }
  if (items.length === 0 && fired.length === 0) {
    return scope;
  }
  return { ...scope, items: new Set([...scope.items, ...items]), fired: new Set([...scope.fired, ...fired]) };
}

/**
 * Restarts section S: every key of S's rooms and hotspots leaves taken / examined / open / slots / fired / visited,
 * the runs of S's lock puzzles and the items and docs S gives are removed, `section` and `room` become null,
 * `lastRoom[S]` and `pendingStory` are cleared, and S leaves `unproved`. "S gives" and S's `fired` keys are S's own
 * facts (`ownScope`): a module rule's gift and key go too, so a restart reaches the state the build started from (X9).
 * Callers pass a state whose section is S or null, so the cleared `section` / `room` / `pendingStory` are never
 * another section's.
 */
export function resetSection(w: WorldPublicBody, s: WorldState, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): WorldState {
  const scope = ownScope(w, section, rules);
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

/**
 * `reduce(w, resetSection(w, s, S), enter-section S).state`: the start of both searches (build: s = empty). `rules` is
 * the registry whose hooks the entry runs (a fixture registry in tests; `searchSection` takes it in its options).
 */
export function sectionEntry(w: WorldPublicBody, s: WorldState, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): WorldState {
  return reduce(w, resetSection(w, s, section, rules), enter(section), rules).state;
}

export type SearchOptions = {
  /** Stop with 'found' when a state with this `sectionKey` is discovered. */
  readonly target?: string;
  /** The rules registry whose actions, hooks and reads the search runs (default: MECHANIC_RULES; a fixture in tests). */
  readonly rules?: RulesRegistry;
  /**
   * Every edge: `from` and `to` are discovery indices (0 = start); `to` is null for a `leaves` successor, which is a
   * goal edge and never enqueued; `isNew` marks the edge that discovered `to`.
   */
  readonly onEdge?: (from: number, succ: Successor, to: number | null, isNew: boolean) => void;
  /**
   * A step the search never takes: never enqueued, never reported (the build's clue check removes a puzzle's end).
   * Absent: every step. No runtime caller passes it.
   */
  readonly exclude?: (step: Step) => boolean;
};
export type SearchResult = { readonly result: 'found' | 'exhausted' | 'cap'; readonly states: number };

/**
 * THE section search of the soft-lock checker and the resume (X9 "one cap"): a BFS over `successors` from `start`
 * (but the steps `opts.exclude` accepts), deduplicated by `sectionKey(S)`. Discovering a (cap+1)-th distinct state
 * stops with 'cap', so the runtime never searches past a count the build accepted.
 */
export function searchSection(w: WorldPublicBody, start: WorldState, section: SectionId, cap: number, opts: SearchOptions = {}): SearchResult {
  const seen = new Map<string, number>();
  const queue: WorldState[] = [start];
  const startKey = sectionKey(w, start, section, opts.rules);
  seen.set(startKey, 0);
  if (startKey === opts.target) {
    return { result: 'found', states: 1 };
  }
  for (let from = 0; from < queue.length; from++) {
    const state = queue[from];
    if (state === undefined) {
      break;
    }
    for (const succ of successors(w, state, opts.rules)) {
      if (opts.exclude?.(succ.step) === true) {
        continue;
      }
      if (succ.leaves) {
        opts.onEdge?.(from, succ, null, false);
        continue;
      }
      const key = sectionKey(w, succ.state, section, opts.rules);
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
