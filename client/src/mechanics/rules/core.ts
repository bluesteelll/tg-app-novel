// The explore rules (engine plan §3.2 "core", §3.3): the one writer of WorldState while a section is current - taps,
// inserts, triggers, section entries, event returns and a lock puzzle's outcome - and `actions`, the player actions it
// accepts (docs/PUZZLES-PLAN.md "World state and the reducer contract", X3, X4). The rules half of the mechanics
// engine: explore-ui chunk code that only the explore controller imports (the `rules-lazy` arch rule); the engine
// keeps the kernel (explore/reduce.ts), whose `runReduce` writes a linear puzzle's run with the same run rules. Pure:
// the runtime, the soft-lock checker and the seeded playthroughs call these same functions, so the build proves the
// rules the player runs.
//
// Module `core` of the rules registry: rules/index.ts builds its entry from `actions`, `applyCore` and `reads`, and
// `reduce` hands every action a writer over the registry (rules/writer.ts), every rule's write path, core's too: each
// fact write carries the action's cause, and `reduce` appends the writer's record as `cue` effects (plan (2)).
//
// An action that changes no state returns the same state object and no `dirty`, but keeps the effects its rule emits
// (a lock panel, a reopened puzzle, a re-read text, a resume `room`, `refused`). A change ends with exactly one
// `dirty`. A reference the story gate would reject (a missing room, item or hotspot) makes the action a no-op, never
// a throw.
import { hotspotKey, lockOf, own, runOf, runStep, sectionScope, set, worldIndex } from '../../explore/reduce.ts';
import type { Draft, ExploreAction, ExploreEffect, HotspotEntry, RunAction, WorldIndex } from '../../explore/reduce.ts';
import type { PuzzleOutcome, WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId, SectionId } from '../../story/staging.ts';
import type { Effect, Hotspot, HotspotKey, ItemId, Lock, RoomId, WorldPublicBody } from '../../world/types.ts';
import type { ArrivalOut, Cause, CauseVerb, FactAtom, KernelWorld, RulesRegistry, SectionAction } from '../contract.ts';
import { present } from './flags.ts';
import { APPLY, MECHANIC_RULES } from './index.ts';
import { keepsSlot } from './use.ts';
import { moveHow } from './view.ts';
import { added, arrivalOut, createWriter, fire, isKernelEffect, openKey } from './writer.ts';
import type { KernelWriter } from './writer.ts';

/** Core's module cue names (its rules entry's `cues`), declared here: derived from the entry, the type would circle
 *  back through `applyCore`'s own signature. */
export type CoreCue = 'look' | 'locked' | 'refused' | 'reset';
/** The writer core's rules write through: a cue it emits is one of its own names. */
type CoreWriter = KernelWriter<'core', CoreCue>;

function removed<T>(list: readonly T[], v: T): readonly T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : list;
}

function cellsOf(s: WorldState, key: HotspotKey, lock: Lock): Array<ItemId | null> {
  const stored = own(s.slots, key);
  return lock.slots.map((_, i) => stored?.[i] ?? null);
}

/**
 * The opening action happened at this hotspot (its last insert, its puzzle solved): `onOpen`, then an object's
 * `then` at once. After a remote `unlock` an object's `then` waits for the next tap instead.
 */
function openAt(out: CoreWriter, key: HotspotKey, hotspot: Hotspot, cause: Cause): void {
  openKey(out, key, cause);
  if (hotspot.kind === 'object') {
    fire(out, `then:${key}`, hotspot.then, key, cause);
  }
}

/** The arrival hook of every module, once per `room` effect: after the room's onEnter, never while a knot is pending. */
function arrived(out: CoreWriter, room: RoomId): void {
  if (out.draft.s.pendingStory.length > 0) {
    return;
  }
  let view: ArrivalOut | null = null;
  for (const m of out.rules) {
    if (m.arrived !== undefined) {
      m.arrived(out.world, out.draft.s, room, (view ??= arrivalOut(out)));
    }
  }
}

/** How a `room` effect enters its room: the move's sound, the room left, the exit taken, the kind of move. */
type Move = Omit<Extract<ExploreEffect, { kind: 'room' }>, 'kind' | 'room'>;

export function arrive(out: KernelWriter, room: RoomId, move: Move, cause: Cause): void {
  const d = out.draft;
  const entry = d.ix.rooms.get(room);
  const section = d.s.section;
  if (entry === undefined || section === null) {
    return;
  }
  set(d, 'room', room);
  if (own(d.s.lastRoom, section) !== room) {
    set(d, 'lastRoom', { ...d.s.lastRoom, [section]: room });
  }
  out.set('visited', added(d.s.visited, room), cause);
  d.effects.push({ kind: 'room', room, ...move });
  fire(out, `enter:${room}`, entry.room.onEnter, null, cause);
  arrived(out, room);
}

function enterSection(out: CoreWriter, sid: SectionId, cause: Cause): void {
  const d = out.draft;
  const section = d.ix.sections.get(sid);
  if (section === undefined) {
    return;
  }
  if (d.s.section === sid && d.s.room !== null) {
    d.effects.push({ kind: 'room', room: d.s.room, sfx: null, from: d.s.room, via: null, how: 'resume' });
    arrived(out, d.s.room);
    return;
  }
  const last = own(d.s.lastRoom, sid);
  const room = last !== undefined && d.ix.rooms.get(last)?.section === sid ? last : section.start;
  if (!d.ix.rooms.has(room)) {
    return;
  }
  set(d, 'section', sid);
  arrive(out, room, { sfx: null, from: null, via: null, how: 'enter' }, cause);
}

function eventReturned(out: CoreWriter, sid: SectionId, cause: Cause): void {
  const d = out.draft;
  if (d.s.pendingStory.length === 0 || d.s.section !== sid) {
    return;
  }
  const rest = d.s.pendingStory.slice(1);
  out.set('pendingStory', rest, cause);
  const next = rest[0];
  if (next !== undefined) {
    d.effects.push({ kind: 'story', knot: next });
  } else if (d.s.room !== null) {
    d.effects.push({ kind: 'room', room: d.s.room, sfx: null, from: d.s.room, via: null, how: 'return' });
    arrived(out, d.s.room);
  }
}

/**
 * The hotspot when it is in the current room of a current section, present (its `when`, module `flags`) and no event
 * knot runs; else undefined, so a stale tap on a hidden hotspot is refused as one on another room's.
 */
function here(w: KernelWorld, d: Draft, key: HotspotKey): HotspotEntry | undefined {
  if (d.s.section === null || d.s.room === null || d.s.pendingStory.length > 0) {
    return undefined;
  }
  const entry = d.ix.hotspots.get(key);
  return entry !== undefined && entry.room === d.s.room && present(w, d.s, key) ? entry : undefined;
}

/** A tap on a locked hotspot: its puzzle when every slot is filled and the run has no outcome, else the panel. */
function lockTap(d: Draft, key: HotspotKey, lock: Lock): void {
  const p = lock.puzzle;
  if (p !== null && d.ix.puzzles.has(p) && cellsOf(d.s, key, lock).every((c) => c !== null) && runOf(d.s, p).outcome === null) {
    d.effects.push({ kind: 'puzzle', puzzle: p, hotspot: key });
  } else {
    d.effects.push({ kind: 'lock', hotspot: key });
  }
}

function tap(out: CoreWriter, key: HotspotKey, cause: Cause): void {
  const d = out.draft;
  const entry = here(out.world, d, key);
  if (entry === undefined) {
    return;
  }
  // A module that owns a key of this hotspot handles the tap instead of core's kinds.
  for (const m of out.rules) {
    if (m.tap?.(out.world, d.s, key, out) === true) {
      return;
    }
  }
  const h = entry.hotspot;
  switch (h.kind) {
    case 'look':
      d.effects.push({ kind: 'look', text: h.look, at: key });
      out.cue('core', 'look', key, null);
      out.set('examined', added(d.s.examined, key), cause);
      fire(out, `then:${key}`, h.then, key, cause);
      return;
    case 'take': {
      if (d.s.taken.includes(key)) {
        return;
      }
      const g = h.gives;
      if ('item' in g ? !d.ix.items.has(g.item) : !d.ix.docs.has(g.doc)) {
        return;
      }
      if ('item' in g) {
        out.set('held', added(d.s.held, g.item), cause);
      } else {
        out.set('docs', added(d.s.docs, g.doc), cause);
      }
      out.set('taken', [...d.s.taken, key], cause);
      d.effects.push({ kind: 'got', gift: g, at: key });
      fire(out, `then:${key}`, h.then, key, cause);
      return;
    }
    case 'exit':
      if (h.lock !== null && !d.s.open.includes(key)) {
        lockTap(d, key, h.lock);
      } else if ('room' in h.to) {
        arrive(out, h.to.room, { sfx: h.sfx, from: entry.room, via: key, how: moveHow(out.world, entry.room, h.to.room) }, cause);
      } else {
        // I-W's re-entry rule: a leave changes only `section` (sectionKey ignores it and lastRoom).
        set(d, 'section', null);
        d.effects.push({ kind: 'leave', knot: h.to.story, from: entry.room, via: key });
      }
      return;
    case 'object':
      if (h.lock !== null && !d.s.open.includes(key)) {
        lockTap(d, key, h.lock);
        return;
      }
      if (h.look !== null) {
        d.effects.push({ kind: 'look', text: h.look, at: key });
      }
      // Every tap of an open or lockless object plays its look, with or without a text (an opened drawer whose `then`
      // has fired still answers the tap: plan (4), every step yields a cue).
      out.cue('core', 'look', key, null);
      fire(out, `then:${key}`, h.then, key, cause);
      return;
    default: {
      const never: never = h;
      return never;
    }
  }
}

/**
 * The slot an insert fills: the first free slot of an unopened, present lock in the current room that accepts the held
 * item; null when the insert is refused. `actions` lists exactly the inserts this accepts.
 */
function fit(w: KernelWorld, ix: WorldIndex, s: WorldState, key: HotspotKey, item: ItemId): { hotspot: Hotspot; lock: Lock; index: number } | null {
  const entry = ix.hotspots.get(key);
  if (entry === undefined || entry.room !== s.room || !s.held.includes(item) || s.open.includes(key) || !present(w, s, key)) {
    return null;
  }
  const lock = lockOf(entry.hotspot);
  if (lock === null) {
    return null;
  }
  const cells = cellsOf(s, key, lock);
  const index = lock.slots.findIndex((slot, i) => slot.accepts === item && cells[i] === null);
  return index === -1 ? null : { hotspot: entry.hotspot, lock, index };
}

/**
 * The fit and the writes of an insert, shared with `use`'s lock fallback (engine plan §6.1): the item fills the first
 * free slot that accepts it (a keeping slot, `keepsSlot`, records it and leaves it held, never used), and the last
 * filled slot opens the lock or offers its puzzle. False, with nothing written or emitted: no slot takes it.
 */
export function insertItem(out: KernelWriter, key: HotspotKey, item: ItemId, cause: Cause): boolean {
  const d = out.draft;
  const f = fit(out.world, d.ix, d.s, key, item);
  if (f === null) {
    return false;
  }
  const cells = cellsOf(d.s, key, f.lock).map((c, i) => (i === f.index ? item : c));
  out.slots(key, cells, cause);
  if (!keepsSlot(out.world, key, f.index)) {
    out.set('held', removed(d.s.held, item), cause);
    out.set('used', added(d.s.used, item), cause);
  }
  if (cells.some((c) => c === null)) {
    return true;
  }
  const p = f.lock.puzzle;
  if (p === null) {
    openAt(out, key, f.hotspot, cause);
  } else if (d.ix.puzzles.has(p) && runOf(d.s, p).outcome === null) {
    d.effects.push({ kind: 'puzzle', puzzle: p, hotspot: key });
  }
  return true;
}

/** An insert from the lock panel: refused (and nothing written) when no slot takes the item. */
function insert(out: CoreWriter, key: HotspotKey, item: ItemId): void {
  const d = out.draft;
  if (d.s.section === null || d.s.room === null || d.s.pendingStory.length > 0) {
    return;
  }
  if (!insertItem(out, key, item, { verb: 'insert', at: key, item, via: null })) {
    d.effects.push({ kind: 'refused', at: key, item, reason: 'no-fit' });
    out.cue('core', 'refused', key, item);
  }
}

/**
 * The kernel's run rules (`runStep`, shared with `runReduce`) over a scratch draft of the same state, the run they write
 * then recorded through the writer: one run definition, and the change still a fact cue.
 */
function runIn(out: CoreWriter, a: RunAction, cause: Cause): void {
  const d = out.draft;
  const scratch: Draft = { s: d.s, effects: d.effects, ix: d.ix };
  runStep(scratch, a);
  out.run(a.puzzle, runOf(scratch.s, a.puzzle), cause);
}

function puzzleEnded(out: CoreWriter, p: PuzzleLocalId, outcome: PuzzleOutcome, cause: Cause): void {
  const d = out.draft;
  if (!d.ix.puzzles.has(p)) {
    return;
  }
  const key = d.ix.puzzleLock.get(p);
  if (key === undefined) {
    runIn(out, { kind: 'puzzle-ended', puzzle: p, outcome }, cause); // a linear puzzle: the kernel's run rule
    return;
  }
  const run = runOf(d.s, p);
  // A lock puzzle's outcome is final for its run, and only a linear puzzle can be abandoned (X8).
  if (run.outcome !== null || outcome === 'abandoned') {
    return;
  }
  out.run(p, { ...run, outcome }, cause);
  const entry = d.ix.hotspots.get(key);
  const lock = entry === undefined ? null : lockOf(entry.hotspot);
  if (entry === undefined || lock === null) {
    return;
  }
  if (outcome === 'solved') {
    openAt(out, entry.key, entry.hotspot, cause);
  } else {
    fire(out, `fail:${entry.key}`, lock.onFail, entry.key, cause);
  }
}

/**
 * Core's `apply`, the handler of every kernel action kind (`APPLY`, rules/index.ts): every fact write goes through the
 * writer with the action's cause (a puzzle's run acts at its lock, null for a linear one). The dispatch never hands it
 * another module's action.
 */
export function applyCore(_w: WorldPublicBody, a: ExploreAction, out: CoreWriter): void {
  const d = out.draft;
  const cause = (verb: CauseVerb, at: HotspotKey | null): Cause => ({ verb, at, item: null, via: null });
  switch (a.kind) {
    case 'enter-section':
      return enterSection(out, a.section, cause('enter', null));
    case 'event-returned':
      return eventReturned(out, a.section, cause('return', null));
    case 'tap':
      return tap(out, a.hotspot, cause('tap', a.hotspot));
    case 'insert':
      return insert(out, a.hotspot, a.item);
    case 'attempt-failed':
    case 'hint-opened':
      return runIn(out, a, cause('fail', d.ix.puzzleLock.get(a.puzzle) ?? null));
    case 'puzzle-ended':
      return puzzleEnded(out, a.puzzle, a.outcome, cause(a.outcome === 'solved' ? 'solve' : 'fail', d.ix.puzzleLock.get(a.puzzle) ?? null));
    default: {
      const never: never = a;
      return never;
    }
  }
}

/**
 * The one writer of WorldState while a section is current (a linear puzzle's run: the kernel's `runReduce`). `rules`
 * is the registry whose hooks run (a fixture registry in tests); the action goes to its kind's handler (`APPLY`).
 * `w` is the kernel world, whose `mods` the modules' rules read.
 */
export function reduce(
  w: KernelWorld,
  s: WorldState,
  a: SectionAction,
  rules: RulesRegistry = MECHANIC_RULES,
): { state: WorldState; effects: ExploreEffect[] } {
  const d: Draft = { s, effects: [], ix: worldIndex(w) };
  const idle = s.pendingStory.length === 0;
  // Read here, never at load (the core.ts <-> index.ts cycle); TS cannot correlate `APPLY[a.kind]` with `a`.
  const apply = APPLY[a.kind] as (w: KernelWorld, a: SectionAction, out: KernelWriter) => void;
  const out = createWriter(d, w, rules);
  apply(w, a, out);
  for (const cue of out.record) {
    d.effects.push({ kind: 'cue', cue });
  }
  const head = d.s.pendingStory[0];
  if (idle && head !== undefined) {
    d.effects.push({ kind: 'story', knot: head });
  }
  if (d.s !== s) {
    d.effects.push({ kind: 'dirty' });
  }
  return { state: d.s, effects: d.effects };
}

/** Whether trigger `fired` (`<kind>:<target>`, a key of S's scope) has a kernel effect in `w`'s lists, by key (A1). */
function hasKernelEffect(ix: WorldIndex, fired: string): boolean {
  const colon = fired.indexOf(':');
  const kind = fired.slice(0, colon);
  const target = fired.slice(colon + 1);
  let effects: readonly Effect[] = [];
  if (kind === 'enter') {
    effects = ix.rooms.get(target as RoomId)?.room.onEnter ?? []; // a lookup key
  } else {
    const h = ix.hotspots.get(target as HotspotKey)?.hotspot; // a lookup key
    const lock = h === undefined ? null : lockOf(h);
    if (kind === 'then') {
      effects = h === undefined || h.kind === 'exit' ? [] : h.then;
    } else if (lock !== null) {
      effects = kind === 'open' ? lock.onOpen : lock.onFail;
    }
  }
  return effects.some(isKernelEffect);
}

/**
 * Every fact core's gating rules read in `section`, the atoms `sectionKey` is derived from: from S's scope (the one
 * definition the key and `resetSection` share), `taken` and `open` per hotspot, `slot` per lock (by key), `fired` per
 * trigger of S with a kernel effect, `solved` per lock puzzle (its whole outcome), `held` and `used` per item S gives,
 * `doc` per doc S gives. `examined` and `visited` stay out: no core rule reads them.
 *
 * GM5f D7: a trigger whose effects are all a module's has no `fired` key fact. No condition atom reads `fired`, such a
 * trigger writes only its module's facts, and flags' one effect, an idempotent `set`, is keyed by flags' own `reads`
 * wherever a gating rule reads its flag; so two states that differ only in its `fired` key (and an unread flag) have the
 * same gating successors. The test is by key (`isKernelEffect`): the proof form keeps a raw `{ set }` in its list, the
 * runtime form does not, and both key alike (X9: one key, one cap). In a world without module effects such a trigger
 * never fires, so every key is as before.
 */
export function reads(w: WorldPublicBody, section: SectionId): readonly FactAtom[] {
  const scope = sectionScope(w, section);
  const ix = worldIndex(w);
  const atoms: FactAtom[] = [];
  for (const key of scope.hotspots) {
    atoms.push({ kind: 'taken', id: key }, { kind: 'open', id: key });
  }
  for (const { key } of scope.locks) {
    atoms.push({ kind: 'slot', id: key });
  }
  for (const fired of scope.fired) {
    if (hasKernelEffect(ix, fired)) {
      atoms.push({ kind: 'fired', id: fired });
    }
  }
  for (const p of scope.puzzles) {
    atoms.push({ kind: 'solved', id: p });
  }
  for (const item of scope.items) {
    atoms.push({ kind: 'held', id: item }, { kind: 'used', id: item });
  }
  for (const doc of scope.docs) {
    atoms.push({ kind: 'doc', id: doc });
  }
  return atoms;
}

// ---------------------------------------------------------------------------------------------------------------
// The successor relation

/**
 * Every enabled player action: a tap on each present hotspot of the current room except a taken `take`, and each
 * insert `reduce` would accept, while `pendingStory` is empty; only `event-returned` while it is not. Puzzle outcomes
 * are not actions here: see `successors`.
 */
export function actions(w: KernelWorld, s: WorldState): ExploreAction[] {
  if (s.section === null || s.room === null) {
    return [];
  }
  if (s.pendingStory.length > 0) {
    return [{ kind: 'event-returned', section: s.section }];
  }
  const ix = worldIndex(w);
  const current = s.room;
  const room = ix.rooms.get(current);
  if (room === undefined) {
    return [];
  }
  const out: ExploreAction[] = [];
  const keys: HotspotKey[] = [];
  for (const h of room.room.hotspots) {
    const key = hotspotKey(current, h.id);
    keys.push(key);
    if (!(h.kind === 'take' && s.taken.includes(key)) && present(w, s, key)) {
      out.push({ kind: 'tap', hotspot: key });
    }
  }
  // Sorted, so two states that differ only in the order items were taken list the same actions.
  const held = [...s.held].sort();
  for (const key of keys) {
    for (const item of held) {
      if (fit(w, ix, s, key, item) !== null) {
        out.push({ kind: 'insert', hotspot: key, item });
      }
    }
  }
  return out;
}
