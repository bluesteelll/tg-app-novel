// The explore rules (engine plan §3.2 "core", §3.3): the one writer of WorldState while a section is current - taps,
// inserts, triggers, section entries, event returns and a lock puzzle's outcome - and `actions`, the player actions it
// accepts (docs/PUZZLES-PLAN.md "World state and the reducer contract", X3, X4). The rules half of the mechanics
// engine: explore-ui chunk code that only the explore controller imports (the `rules-lazy` arch rule); the engine
// keeps the kernel (explore/reduce.ts), whose `runReduce` writes a linear puzzle's run with the same run rules. Pure:
// the runtime, the soft-lock checker and the seeded playthroughs call these same functions, so the build proves the
// rules the player runs.
//
// Module `core` of the rules registry: rules/index.ts builds its entry from `actions`, `applyCore` and `reads`, and
// `reduce` hands every action a writer over the registry (rules/writer.ts), the other modules' write path.
//
// An action that changes no state returns the same state object and no `dirty`, but keeps the effects its rule emits
// (a lock panel, a reopened puzzle, a re-read text, a resume `room`, `refused`). A change ends with exactly one
// `dirty`. A reference the story gate would reject (a missing room, item or hotspot) makes the action a no-op, never
// a throw.
import { hotspotKey, lockOf, own, runOf, runStep, sectionScope, set, setRun, worldIndex } from '../../explore/reduce.ts';
import type { Draft, ExploreAction, ExploreEffect, HotspotEntry, WorldIndex } from '../../explore/reduce.ts';
import type { PuzzleOutcome, WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId, SectionId } from '../../story/staging.ts';
import type { Hotspot, HotspotKey, ItemId, Lock, RoomId, WorldPublicBody } from '../../world/types.ts';
import type { ArrivalOut, FactAtom, RulesRegistry, SectionAction } from '../contract.ts';
import { MECHANIC_RULES } from './index.ts';
import { added, arrivalOut, createWriter, fire, openKey } from './writer.ts';
import type { KernelWriter } from './writer.ts';

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
function openAt(d: Draft, key: HotspotKey, hotspot: Hotspot): void {
  openKey(d, key);
  if (hotspot.kind === 'object') {
    fire(d, `then:${key}`, hotspot.then, key);
  }
}

/** The arrival hook of every module, once per `room` effect: after the room's onEnter, never while a knot is pending. */
function arrived(out: KernelWriter, room: RoomId): void {
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

function arrive(out: KernelWriter, room: RoomId, move: Move): void {
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
  set(d, 'visited', added(d.s.visited, room));
  d.effects.push({ kind: 'room', room, ...move });
  fire(d, `enter:${room}`, entry.room.onEnter, null);
  arrived(out, room);
}

function enterSection(out: KernelWriter, sid: SectionId): void {
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
  arrive(out, room, { sfx: null, from: null, via: null, how: 'enter' });
}

function eventReturned(out: KernelWriter, sid: SectionId): void {
  const d = out.draft;
  if (d.s.pendingStory.length === 0 || d.s.section !== sid) {
    return;
  }
  const rest = d.s.pendingStory.slice(1);
  set(d, 'pendingStory', rest);
  const next = rest[0];
  if (next !== undefined) {
    d.effects.push({ kind: 'story', knot: next });
  } else if (d.s.room !== null) {
    d.effects.push({ kind: 'room', room: d.s.room, sfx: null, from: d.s.room, via: null, how: 'return' });
    arrived(out, d.s.room);
  }
}

/** The hotspot when it is in the current room of a current section and no event knot runs; else undefined. */
function here(d: Draft, key: HotspotKey): HotspotEntry | undefined {
  if (d.s.section === null || d.s.room === null || d.s.pendingStory.length > 0) {
    return undefined;
  }
  const entry = d.ix.hotspots.get(key);
  return entry !== undefined && entry.room === d.s.room ? entry : undefined;
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

function tap(out: KernelWriter, key: HotspotKey): void {
  const d = out.draft;
  const entry = here(d, key);
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
      set(d, 'examined', added(d.s.examined, key));
      fire(d, `then:${key}`, h.then, key);
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
        set(d, 'held', added(d.s.held, g.item));
      } else {
        set(d, 'docs', added(d.s.docs, g.doc));
      }
      set(d, 'taken', [...d.s.taken, key]);
      d.effects.push({ kind: 'got', gift: g, at: key });
      fire(d, `then:${key}`, h.then, key);
      return;
    }
    case 'exit':
      if (h.lock !== null && !d.s.open.includes(key)) {
        lockTap(d, key, h.lock);
      } else if ('room' in h.to) {
        arrive(out, h.to.room, { sfx: h.sfx, from: entry.room, via: key, how: 'walk' });
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
      fire(d, `then:${key}`, h.then, key);
      return;
    default: {
      const never: never = h;
      return never;
    }
  }
}

/**
 * The slot an insert fills: the first free slot of an unopened lock in the current room that accepts the held
 * item; null when the insert is refused. `actions` lists exactly the inserts this accepts.
 */
function fit(ix: WorldIndex, s: WorldState, key: HotspotKey, item: ItemId): { hotspot: Hotspot; lock: Lock; index: number } | null {
  const entry = ix.hotspots.get(key);
  if (entry === undefined || entry.room !== s.room || !s.held.includes(item) || s.open.includes(key)) {
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

function insert(d: Draft, key: HotspotKey, item: ItemId): void {
  if (d.s.section === null || d.s.room === null || d.s.pendingStory.length > 0) {
    return;
  }
  const f = fit(d.ix, d.s, key, item);
  if (f === null) {
    d.effects.push({ kind: 'refused', at: key, item, reason: 'no-fit' });
    return;
  }
  const cells = cellsOf(d.s, key, f.lock).map((c, i) => (i === f.index ? item : c));
  set(d, 'slots', { ...d.s.slots, [key]: cells });
  set(d, 'held', removed(d.s.held, item));
  set(d, 'used', added(d.s.used, item));
  if (cells.some((c) => c === null)) {
    return;
  }
  const p = f.lock.puzzle;
  if (p === null) {
    openAt(d, key, f.hotspot);
  } else if (d.ix.puzzles.has(p) && runOf(d.s, p).outcome === null) {
    d.effects.push({ kind: 'puzzle', puzzle: p, hotspot: key });
  }
}

function puzzleEnded(d: Draft, p: PuzzleLocalId, outcome: PuzzleOutcome): void {
  if (!d.ix.puzzles.has(p)) {
    return;
  }
  const key = d.ix.puzzleLock.get(p);
  if (key === undefined) {
    runStep(d, { kind: 'puzzle-ended', puzzle: p, outcome }); // a linear puzzle: the kernel's run rule
    return;
  }
  const run = runOf(d.s, p);
  // A lock puzzle's outcome is final for its run, and only a linear puzzle can be abandoned (X8).
  if (run.outcome !== null || outcome === 'abandoned') {
    return;
  }
  setRun(d, p, { ...run, outcome });
  const entry = d.ix.hotspots.get(key);
  const lock = entry === undefined ? null : lockOf(entry.hotspot);
  if (entry === undefined || lock === null) {
    return;
  }
  if (outcome === 'solved') {
    openAt(d, entry.key, entry.hotspot);
  } else {
    fire(d, `fail:${entry.key}`, lock.onFail, entry.key);
  }
}

/** Core's `apply`: its rules write the draft directly (the writer is the write path of the other modules). */
export function applyCore(_w: WorldPublicBody, a: ExploreAction, out: KernelWriter): void {
  const d = out.draft;
  switch (a.kind) {
    case 'enter-section':
      return enterSection(out, a.section);
    case 'event-returned':
      return eventReturned(out, a.section);
    case 'tap':
      return tap(out, a.hotspot);
    case 'insert':
      return insert(d, a.hotspot, a.item);
    case 'attempt-failed':
    case 'hint-opened':
      return runStep(d, a); // the kernel's run rules, shared with runReduce
    case 'puzzle-ended':
      return puzzleEnded(d, a.puzzle, a.outcome);
    default: {
      const never: never = a;
      return never;
    }
  }
}

/**
 * The one writer of WorldState while a section is current (a linear puzzle's run: the kernel's `runReduce`). `rules`
 * is the registry whose hooks run (a fixture registry in tests).
 */
export function reduce(
  w: WorldPublicBody,
  s: WorldState,
  a: SectionAction,
  rules: RulesRegistry = MECHANIC_RULES,
): { state: WorldState; effects: ExploreEffect[] } {
  const d: Draft = { s, effects: [], ix: worldIndex(w) };
  const idle = s.pendingStory.length === 0;
  applyCore(w, a, createWriter(d, w, rules));
  const head = d.s.pendingStory[0];
  if (idle && head !== undefined) {
    d.effects.push({ kind: 'story', knot: head });
  }
  if (d.s !== s) {
    d.effects.push({ kind: 'dirty' });
  }
  return { state: d.s, effects: d.effects };
}

/**
 * Every fact core's gating rules read in `section`, the atoms `sectionKey` is derived from: from S's scope (the one
 * definition the key and `resetSection` share), `taken` and `open` per hotspot, `slot` per lock (by key), `fired` per
 * trigger S can write, `solved` per lock puzzle (its whole outcome), `held` and `used` per item S gives, `doc` per doc
 * S gives. `examined` and `visited` stay out: no core rule reads them.
 */
export function reads(w: WorldPublicBody, section: SectionId): readonly FactAtom[] {
  const scope = sectionScope(w, section);
  const atoms: FactAtom[] = [];
  for (const key of scope.hotspots) {
    atoms.push({ kind: 'taken', id: key }, { kind: 'open', id: key });
  }
  for (const { key } of scope.locks) {
    atoms.push({ kind: 'slot', id: key });
  }
  for (const fired of scope.fired) {
    atoms.push({ kind: 'fired', id: fired });
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
 * Every enabled player action: a tap on each hotspot of the current room except a taken `take`, and each insert
 * `reduce` would accept, while `pendingStory` is empty; only `event-returned` while it is not. Puzzle outcomes are
 * not actions here: see `successors`.
 */
export function actions(w: WorldPublicBody, s: WorldState): ExploreAction[] {
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
    if (!(h.kind === 'take' && s.taken.includes(key))) {
      out.push({ kind: 'tap', hotspot: key });
    }
  }
  // Sorted, so two states that differ only in the order items were taken list the same actions.
  const held = [...s.held].sort();
  for (const key of keys) {
    for (const item of held) {
      if (fit(ix, s, key, item) !== null) {
        out.push({ kind: 'insert', hotspot: key, item });
      }
    }
  }
  return out;
}
