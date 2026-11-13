// The searches (engine plan §3.2 "search", §3.3; docs/PUZZLES-PLAN.md X4, X9): the successor relation, the section
// key, the one section search of the build's soft-lock checker and the resume, and the guarded section entries that
// prove an unproved section at its first entry. The search's one budget (X9) has two bounds, shared by the build and
// the resume: at most RESUME_STATE_CAP distinct states, and at most RESUME_WORK_PER_STATE successor evaluations per
// state of that cap. The key abstracts the free views (the place quotient, engine plan §6.3, synthesis §3.7): a view
// the player enters and leaves freely keys under its parent's place, and the search expands a place's state over every
// member of the place, so a view adds no state where its parent's state already decides every edge. The rules half of
// the mechanics engine: explore-ui chunk code that only the explore controller imports (the `rules-lazy` arch rule);
// the story tool runs the same functions. Never throws on save data. Pure.
import { RESUME_STATE_CAP, hotspotKey, lockOf, own, runOf, sectionScope, worldIndex } from '../../explore/reduce.ts';
import type { ExploreAction, ExploreEffect, SectionScope, Step, Successor } from '../../explore/reduce.ts';
import type { PuzzleOutcome, PuzzleRun, WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId, SectionId } from '../../story/staging.ts';
import type { HotspotKey, ItemId, Lock, RoomId } from '../../world/types.ts';
import type { KernelWorld, RulesRegistry, SectionAction, TriggerKey } from '../contract.ts';
import { reduce } from './core.ts';
import { MECHANIC_RULES } from './index.ts';
import { gated } from './flags.ts';
import { viewActions, viewParent } from './view.ts';
import { isKernelEffect, moduleEffects } from './writer.ts';

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
export function successors(w: KernelWorld, s: WorldState, rules: RulesRegistry = MECHANIC_RULES): Successor[] {
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
 * Every fact the registry's gating rules read in one section, grouped by fact kind: what `sectionKey` encodes. The
 * groups of the four kernel kinds no core rule reads, and module `flags`' `flag`, are null until a module reads them,
 * so core's key keeps its bytes.
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
  /** The flags read by `flag` (module `flags`' fact kind, kept in `WorldState.flags`). */
  readonly flags: ReadonlySet<string> | null;
  /** Each merged view's place root (`placesOf`); a room absent here is a place of its own. */
  readonly root: ReadonlyMap<RoomId, RoomId>;
  /** The free moves inside the places: per merged view, the zoom tap into it and its `leave-view`. */
  readonly moves: readonly PlaceMove[];
};

/** A free move between two members of one place. */
type PlaceMove = { readonly from: RoomId; readonly step: SectionAction; readonly to: RoomId };

/**
 * The place quotient of section S (engine plan §6.3, synthesis §3.7). A view V of room P **merges** into P's place iff
 * - (a) its entry is ungated: (a2) every exit of S's rooms into V lies in P and has no lock and no `when` (module
 *   `flags`' presence), and at least one does (a locked exit opens on state, a `when` shows it on state; a view no exit
 *   enters is reached by no move), so (a1) P is a room of S; (a3) no module
 *   of the registry has a `tap` hook (core hands every tap to the hooks first, and one may take the entering tap on
 *   data this rule cannot read);
 * - (b) V's arrival writes nothing: `enter:V` has no kernel effect (by key, `isKernelEffect`: the proof world keeps a
 *   module's owned effect in the list) and no module effect (every arrival fires `enter:V`, and a trigger with an effect
 *   writes `fired` and its effects);
 * - (c) its only way out is `leave-view`: (c1) every exit of V leads into a view of V (a child view, entered only from
 *   V), and (c2) the registry offers `leave-view` (`reduce` dispatches it whatever the registry: the walk up would apply
 *   a move a registry without the view module never offers);
 * - (d) no module reads `visited: V` (`visited` is the one kernel fact that names a room; `visitedReads` is the plan's).
 *
 * An arrival in V then writes nothing the key encodes: `room` is the place, `lastRoom` is outside the key, `visited`
 * by (d), `enter:V` by (b), and `arrived` hooks write no state. The walk up (`leave-view`, core's `arrive` at P)
 * writes `visited P` and fires `enter:P`, which already hold in every reachable member state (I-P: a view is entered
 * only by an exit of its parent, and a section never starts in a view). A merged view of a merged view joins the
 * same place (depth 2); a view that does not merge is a place of its own, and a merged view under it joins its place.
 * The walk to a root takes at most one hop per candidate, so the views of a cycle (`world/view-depth` refuses one, and
 * the story tool searches the same world in the same run) stay places of their own.
 */
function placesOf(w: KernelWorld, section: SectionId, rules: RulesRegistry, visitedReads: ReadonlySet<string> | null): Pick<KeyPlan, 'root' | 'moves'> {
  const root = new Map<RoomId, RoomId>();
  const moves: PlaceMove[] = [];
  const ix = worldIndex(w);
  const rooms = sectionScope(w, section).rooms;
  // One pass over the exits of S's rooms: the first lockless entry of each view from its parent (the zoom tap of the
  // walk), and every room an exit disqualifies, as the view it enters (a2) or the view it leaves (c1).
  const unfree = new Set<RoomId | null>();
  const zoom = new Map<RoomId, HotspotKey>();
  for (const r of rooms) {
    for (const h of ix.rooms.get(r)?.room.hotspots ?? []) {
      if (h.kind === 'exit') {
        const v = 'room' in h.to ? h.to.room : null;
        const zoomIn = v !== null && viewParent(w, v) === r;
        if (!zoomIn) {
          // (c1) for r: its exit leads out of its own views; (a2) for v: an entry from a room that is not its parent.
          unfree.add(r).add(v);
        } else if (h.lock !== null || gated(w, hotspotKey(r, h.id))) {
          unfree.add(v); // (a2): a gated entry (a lock, or a presence `when`)
        } else if (!zoom.has(v)) {
          zoom.set(v, hotspotKey(r, h.id));
        }
      }
    }
  }
  // Each view that passes every condition of its own, with its parent.
  const candidates = new Map<RoomId, RoomId>();
  for (const v of rooms) {
    const of = viewParent(w, v);
    if (
      of !== null &&
      !rules.some((m) => m.tap !== undefined) && // (a3)
      rules.some((m) => m.actions === viewActions) && // (c2)
      zoom.has(v) && // (a2)'s "at least one", and so (a1)
      !unfree.has(v) && // (a2), (c1)
      quiet(w, v, rules) && // (b)
      !visitedReads?.has(v) // (d)
    ) {
      candidates.set(v, of);
    }
  }
  for (const [v, of] of candidates) {
    // Up through candidates, one hop per candidate: an acyclic chain ends on its root, a room no candidate is.
    let r = v;
    for (let hops = 0; hops < candidates.size; hops++) {
      r = candidates.get(r) ?? r;
    }
    if (!candidates.has(r)) {
      root.set(v, r);
      // A candidate has its zoom entry (`zoom.has` above): the tap into it, and the leave back.
      moves.push({ from: of, step: { kind: 'tap', hotspot: zoom.get(v) as HotspotKey }, to: v }, { from: v, step: { kind: 'leave-view' }, to: of });
    }
  }
  return { root, moves };
}

/** (b): an arrival in room `v` writes nothing, since `enter:v` has neither a kernel nor a module effect. */
function quiet(w: KernelWorld, v: RoomId, rules: RulesRegistry): boolean {
  const onEnter = worldIndex(w).rooms.get(v)?.room.onEnter;
  return onEnter !== undefined && !onEnter.some(isKernelEffect) && moduleEffects(rules, w, `enter:${v}` as TriggerKey).length === 0; // a room's trigger key
}

// Built once per (registry, world, section): the searches call `sectionKey` once per successor.
const PLANS = new WeakMap<RulesRegistry, WeakMap<KernelWorld, Map<SectionId, KeyPlan>>>();

const sortedIds = <T extends string>(ids: ReadonlySet<T>): T[] => [...ids].sort();

function keyPlan(w: KernelWorld, section: SectionId, rules: RulesRegistry): KeyPlan {
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
  let flags: Set<string> | null = null;
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
        case 'flag':
          (flags ??= new Set()).add(id);
          break;
        default: {
          // A module fact kind has no WorldState storage before its module declares a save slice (`flag` is kept in
          // `WorldState.flags`).
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
    flags,
    ...placesOf(w, section, rules, visited),
  };
  perWorld.set(section, plan);
  return plan;
}

/** Each merged view of section S with its place root (`placesOf`): what `sectionKey` names a merged view's state by. */
export function sectionPlaces(w: KernelWorld, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): Record<string, RoomId> {
  return Object.fromEntries(keyPlan(w, section, rules).root);
}

/**
 * The canonical key of `s` restricted to section S, the one dedup key of both searches, derived from the facts every
 * module of `rules` reads in S (engine plan §3.2): room, pendingStory (an ordered queue), then the read facts in
 * taken / open / slots / fired, the outcomes of the read puzzles, held / used / docs, and examined / visited /
 * attempts / hints / flags only when some module reads them. Core reads S's keys of the first eight, so its key abstracts
 * examined, visited, attempts and hints opened and ignores section, lastRoom, unproved and everything outside S
 * (X15). The set-valued fields are sorted, so the order play added them in never splits one state into two. Ids
 * never hold `|`, `;`, `=` or `,`, so the joins are unambiguous. The room part names the room's place: a merged
 * view keys as its place root (`placesOf`), so a world without one keys every state byte for byte as before.
 */
export function sectionKey(w: KernelWorld, s: WorldState, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): string {
  return planKey(keyPlan(w, section, rules), s);
}

/** `sectionKey` over its plan. */
function planKey(plan: KeyPlan, s: WorldState): string {
  const slots: string[] = [];
  for (const { key, lock } of plan.slots) {
    const stored = own(s.slots, key);
    if (stored !== undefined && stored.some((c) => c !== null)) {
      slots.push(`${key}=${lock.slots.map((_, i) => stored[i] ?? '').join(',')}`);
    }
  }
  const parts = [
    s.room === null ? '' : (plan.root.get(s.room) ?? s.room),
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
  if (plan.flags !== null) {
    parts.push(setPart(s.flags, plan.flags));
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
export function ownScope(w: KernelWorld, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): SectionScope {
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
 * the runs of S's lock puzzles, the items and docs S gives and the flags S declares (each module's `scope` hook's
 * `flags`: a flag is cleared only by its section's reset) are removed, `section` and `room` become null,
 * `lastRoom[S]` and `pendingStory` are cleared, and S leaves `unproved`. "S gives" and S's `fired` keys are S's own
 * facts (`ownScope`): a module rule's gift and key go too, so a restart reaches the state the build started from (X9).
 * Callers pass a state whose section is S or null, so the cleared `section` / `room` / `pendingStory` are never
 * another section's.
 */
export function resetSection(w: KernelWorld, s: WorldState, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): WorldState {
  const scope = ownScope(w, section, rules);
  const flags = new Set(rules.flatMap((m) => m.scope?.(w, section).flags ?? []));
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
    flags: outside(s.flags, flags),
  };
}

function enter(section: SectionId): ExploreAction {
  return { kind: 'enter-section', section };
}

/**
 * `reduce(w, resetSection(w, s, S), enter-section S).state`: the start of both searches (build: s = empty). `rules` is
 * the registry whose hooks the entry runs (a fixture registry in tests; `searchSection` takes it in its options).
 */
export function sectionEntry(w: KernelWorld, s: WorldState, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): WorldState {
  return reduce(w, resetSection(w, s, section, rules), enter(section), rules).state;
}

/** The free moves from a discovered state to one member of its place, each with the state it reaches (in order). */
export type Walk = ReadonlyArray<{ readonly step: SectionAction; readonly state: WorldState }>;

const NO_WALK: Walk = [];

/** A member of a state's place: its state, and the walk that reaches it from the state. */
type Member = { readonly state: WorldState; readonly walk: Walk };

/**
 * `s` first (an empty walk), then every other member of its place, breadth first over the place's free moves, each
 * move one `reduce` (a room already reached costs none). Only `s` while a knot is pending: no move is free then.
 */
function members(w: KernelWorld, s: WorldState, plan: KeyPlan, rules: RulesRegistry): Member[] {
  const out: Member[] = [{ state: s, walk: NO_WALK }];
  if (s.pendingStory.length > 0) {
    return out;
  }
  const reached = new Set([s.room]);
  // `for of` over an array reads its length at every step, so the members pushed here are walked from too.
  for (const m of out) {
    for (const move of plan.moves) {
      if (move.from === m.state.room && !reached.has(move.to)) {
        reached.add(move.to);
        const state = reduce(w, m.state, move.step, rules).state;
        out.push({ state, walk: [...m.walk, { step: move.step, state }] });
      }
    }
  }
  return out;
}

/** The union the search expands a state by: every member's `successors` (the place quotient's soundness property). */
export function placeSuccessors(w: KernelWorld, s: WorldState, section: SectionId, rules: RulesRegistry = MECHANIC_RULES): Successor[] {
  return members(w, s, keyPlan(w, section, rules), rules).flatMap((m) => successors(w, m.state, rules));
}

export type SearchOptions = {
  /** Stop with 'found' when a state with this `sectionKey` is discovered. */
  readonly target?: string;
  /** The rules registry whose actions, hooks and reads the search runs (default: MECHANIC_RULES; a fixture in tests). */
  readonly rules?: RulesRegistry;
  /**
   * Every edge: `from` and `to` are discovery indices (0 = start); `to` is null for a `leaves` successor, which is a
   * goal edge and never enqueued; `isNew` marks the edge that discovered `to`. `walk` is the free moves from the state
   * `from` indexes to the member of its place the edge's step is taken in (empty: the state itself), so the walk and
   * then the step are the player's path. A zoom move is an edge of its own whose `to` is `from`.
   */
  readonly onEdge?: (from: number, succ: Successor, to: number | null, isNew: boolean, walk: Walk) => void;
  /**
   * A member's own step the search never takes: a successor it accepts is never enqueued and never reported (the
   * build's clue check removes a puzzle's end), though its evaluation counts as work. It filters each member's
   * `successors` only, not the place's free moves: the walk's zoom taps and `leave-view` steps between the members are
   * taken whatever it accepts. Absent: every step. No runtime caller passes it.
   */
  readonly exclude?: (step: Step) => boolean;
  /**
   * False: every room is a place of its own, and a state expands only itself (the search before the place quotient,
   * spike P2's rows without it). No runtime caller passes it, nor any caller with a `target` (a target is a place key).
   */
  readonly places?: boolean;
  /** What the search spent, reported once just before it returns (the story tool words its cap message by `bound`). */
  readonly onStats?: (stats: SearchStats) => void;
};
export type SearchResult = { readonly result: 'found' | 'exhausted' | 'cap'; readonly states: number };
/**
 * What one search spent: the states it expanded, its successor evaluations (one concrete `reduce` each, an excluded
 * successor included), and the bound it stopped at (null unless the result is 'cap').
 */
export type SearchStats = { readonly expansions: number; readonly work: number; readonly bound: 'places' | 'work' | null };

/**
 * The work bound per state of the cap (docs/PUZZLES-PLAN.md "The cost": the cap's time budget models about 8 successor
 * evaluations per state). A search may evaluate at most `cap` times this many successors, so a section whose states
 * fit the cap but whose work does not answers 'cap' too: 40,000 evaluations at RESUME_STATE_CAP, build and resume alike.
 */
export const RESUME_WORK_PER_STATE = 8;

/**
 * THE section search of the soft-lock checker and the resume (X9 "one cap"): a BFS from `start` deduplicated by
 * `sectionKey(S)`, which keys a state by its place, so each dequeued state is expanded over every member of its place:
 * the `successors` of each (but the steps `opts.exclude` accepts), the walk to each counted as work, one evaluation per
 * move. Discovering a (cap+1)-th distinct place, or passing cap x RESUME_WORK_PER_STATE successor evaluations, stops
 * with 'cap', so the runtime never searches past a budget the build accepted. The work is checked after each
 * member's successors are evaluated, before its edges.
 */
export function searchSection(w: KernelWorld, start: WorldState, section: SectionId, cap: number, opts: SearchOptions = {}): SearchResult {
  const rules = opts.rules ?? MECHANIC_RULES;
  const placed = keyPlan(w, section, rules);
  // Without places: the same plan with no merged view, so every room keys as itself and has no free move.
  const plan: KeyPlan = opts.places === false ? { ...placed, root: new Map(), moves: [] } : placed;
  const seen = new Map<string, number>();
  const queue: WorldState[] = [start];
  let expansions = 0;
  let work = 0;
  const done = (result: SearchResult['result'], bound: SearchStats['bound'] = null): SearchResult => {
    opts.onStats?.({ expansions, work, bound });
    return { result, states: seen.size };
  };
  const startKey = planKey(plan, start);
  seen.set(startKey, 0);
  if (startKey === opts.target) {
    return done('found');
  }
  for (let from = 0; from < queue.length; from++) {
    const state = queue[from];
    if (state === undefined) {
      break;
    }
    const ms = members(w, state, plan, rules);
    expansions += ms.length;
    work += ms.length - 1;
    for (const m of ms) {
      const succs = successors(w, m.state, rules);
      work += succs.length;
      if (work > cap * RESUME_WORK_PER_STATE) {
        return done('cap', 'work');
      }
      for (const succ of succs) {
        if (opts.exclude?.(succ.step) === true) {
          continue;
        }
        if (succ.leaves) {
          opts.onEdge?.(from, succ, null, false, m.walk);
          continue;
        }
        const key = planKey(plan, succ.state);
        const known = seen.get(key);
        if (known !== undefined) {
          opts.onEdge?.(from, succ, known, false, m.walk);
          continue;
        }
        if (seen.size + 1 > cap) {
          return done('cap', 'places');
        }
        const to = seen.size;
        seen.set(key, to);
        queue.push(succ.state);
        opts.onEdge?.(from, succ, to, true, m.walk);
        if (key === opts.target) {
          return done('found');
        }
      }
    }
  }
  return done('exhausted');
}

/** Whether the current world can produce `s` from S's entry: 'yes' when the search meets `sectionKey(s)`. */
export function inSectionReach(w: KernelWorld, s: WorldState, section: SectionId, cap: number): 'yes' | 'no' | 'cap' {
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
function restart(w: KernelWorld, s: WorldState, section: SectionId): Admitted {
  const restarted = reduce(w, resetSection(w, s, section), enter(section));
  return { state: restarted.state, effects: [{ kind: 'reset', section }, ...restarted.effects] };
}

/**
 * X9 step 5, the explore controller's way to enter a section with no event knot pending. S not in `unproved`: plain
 * `reduce`. Otherwise enter with `reduce` and search the entered state: 'yes' keeps it, 'no' / 'cap' restarts S. S
 * leaves `unproved` either way.
 */
export function admitSection(w: KernelWorld, s: WorldState, section: SectionId): Admitted {
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
export function admitEvent(w: KernelWorld, s: WorldState, section: SectionId): Admitted {
  const returned = reduce(w, s, { kind: 'event-returned', section });
  if (!s.unproved.includes(section) || s.pendingStory.length === 0 || s.section !== section) {
    return returned;
  }
  return inSectionReach(w, s, section, RESUME_STATE_CAP) === 'yes' ? proved(returned, section) : restart(w, s, section);
}
