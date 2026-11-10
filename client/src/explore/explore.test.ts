import { expect, test } from 'vitest';

import { SILENT_FIELDS } from '../mechanics/contract.ts';
import type { FactAtom, FactKind, FlagId, MechanicRules, SectionAction } from '../mechanics/contract.ts';
import { actions, reduce } from '../mechanics/rules/core.ts';
import { MECHANIC_RULES } from '../mechanics/rules/index.ts';
import { admitSection, inSectionReach, searchSection, sectionEntry, sectionKey, successors } from '../mechanics/rules/search.ts';
import type { KnotName, PuzzleLocalId, SectionId, VarName } from '../story/staging.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { DocId, HotspotKey, ItemId, RoomId, WorldPublic, WorldPublicBody } from '../world/types.ts';
import { project } from './project.ts';
import { reconcile } from './reconcile.ts';
import { RESUME_STATE_CAP, RULES_VERSION, own, runOf, runReduce, sectionScope, worldIndex } from './reduce.ts';
import type { ExploreAction, ExploreEffect } from './reduce.ts';
import { EMPTY_WORLD_STATE } from './state.ts';
import type { PuzzleRun, WorldState } from './state.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture worlds: written in the source format and decoded, so every fixture is a world the decoder accepts.

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (owner = 'w'): Json => ({ id: `ch1.${owner}.${(lineCounter++).toString(36).padStart(4, '0')}`, ru: owner });
const RECT = [100, 200, 200, 200];
const exit = (id: string, to: string | { story: string }, lock: Json | null = null, sfx: string | null = null): Json => ({
  id,
  kind: 'exit',
  rect: RECT,
  label: txt(),
  to: typeof to === 'string' ? { room: to } : to,
  lock,
  sfx,
});
const take = (id: string, gives: { item: string } | { doc: string }, then: Json[] = []): Json => ({
  id,
  kind: 'take',
  rect: RECT,
  label: txt(),
  gives,
  prop: null,
  then,
});
const look = (id: string, then: Json[] = []): Json => ({ id, kind: 'look', rect: RECT, label: txt(), look: txt(id), then });
const object = (id: string, lock: Json | null, then: Json[] = [], withLook = false): Json => ({
  id,
  kind: 'object',
  rect: RECT,
  label: txt(),
  lock,
  then,
  look: withLook ? txt(id) : null,
  prop: null,
});
const lock = (accepts: string[], puzzle: string | null = null, onFail: Json[] = [], onOpen: Json[] = []): Json => ({
  slots: accepts.map((a) => ({ accepts: a })),
  puzzle,
  locked: txt(),
  onOpen,
  onFail,
});
const room = (hotspots: Json[], onEnter: Json[] = []): Json => ({ bg: 'room', title: txt(), onEnter, hotspots });
const code = (dials: number, maxAttempts: number | null = null): Json => ({
  type: 'code',
  title: txt(),
  prompt: txt(),
  closeup: null,
  params: { dials },
  maxAttempts,
  giveUp: false,
  solution: new Array<number>(dials).fill(1),
  hints: [txt(), txt()],
});
const order = (pieces: string[], maxAttempts: number | null = null): Json => ({
  type: 'order',
  title: txt(),
  prompt: txt(),
  closeup: null,
  params: { pieces },
  maxAttempts,
  giveUp: false,
  solution: pieces.map((_, i) => (i + 1) % pieces.length),
  hints: [txt()],
});

type WorldSpec = {
  items?: string[];
  docs?: string[];
  puzzles?: Record<string, Json>;
  sections: Record<string, { start: string; rooms: Record<string, Json> }>;
};

function world(spec: WorldSpec): WorldPublicBody {
  const named = (ids: string[], body: () => Json) => Object.fromEntries(ids.map((id) => [id, body()]));
  const raw = {
    format: 1,
    items: named(spec.items ?? [], () => ({ name: txt(), desc: txt(), glyph: 'key' })),
    docs: named(spec.docs ?? [], () => ({ title: txt(), body: [txt()] })),
    puzzles: spec.puzzles ?? {},
    sections: Object.fromEntries(Object.entries(spec.sections).map(([id, s]) => [id, { start: s.start, bgm: null, rooms: s.rooms }])),
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return toPublic(r.value);
}

// Fixture ids, typed as the brands the decoder gives them.
const k = (s: string) => s as HotspotKey;
const it = (s: string) => s as ItemId;
const sec = (s: string) => s as SectionId;
const pz = (s: string) => s as PuzzleLocalId;
const rm = (s: string) => s as RoomId;
const kn = (s: string) => s as KnotName;

const MEDALS = ['medal_sun', 'medal_moon', 'medal_star'];

type ManorVariant = {
  /** The gate's slot order (the puzzle's pieces stay MEDALS). */
  gate?: string[];
  /** The id of the cellar's medallion (a v2 rename). */
  star?: string;
  /** v2: the cellar door is a zero-slot lock that a lever in the study unlocks. */
  leverCellar?: boolean;
  /** The golden fixture: the drawer's onOpen and then stories, a take's then, a remote unlock of an object. */
  golden?: boolean;
  /** v2 of step 0 (engine plan §5.3): the diary is `journal`, the cellar `crypt`, the section `estate`, the drawer
   *  hotspot `desk` (its puzzle stays `drawer`), the inscription `plaque`. */
  renamedIds?: boolean;
};

/** The demo section of PUZZLES-PLAN "Demo content outline" (ch1 `manor`), and its v2 edits. */
function manor(v: ManorVariant = {}): WorldPublicBody {
  const star = v.star ?? 'medal_star';
  const medals = ['medal_sun', 'medal_moon', star];
  const golden = v.golden === true;
  const renamed = v.renamedIds === true;
  const [diary, cellar] = renamed ? ['journal', 'crypt'] : ['diary', 'cellar'];
  return world({
    items: medals,
    docs: ['letter', diary],
    puzzles: { drawer: code(4), gate: order(medals, 3) },
    sections: {
      [renamed ? 'estate' : 'manor']: {
        start: 'hall',
        rooms: {
          hall: room([
            exit('to_study', 'study', null, 'door'),
            exit('to_cellar', cellar, v.leverCellar === true ? lock([]) : null),
            exit('gate', { story: 'manor_out' }, lock(v.gate ?? medals, 'gate', [{ story: 'manor_gate_forced' }, { unlock: 'hall.gate' }])),
            look(renamed ? 'plaque' : 'inscription'),
          ]),
          study: room([
            take('medal', { item: 'medal_sun' }),
            object(
              renamed ? 'desk' : 'drawer',
              lock([], 'drawer', [], golden ? [{ story: 'drawer_open' }] : []),
              golden ? [{ give: 'medal_moon' }, { story: 'drawer_then' }] : [{ give: 'medal_moon' }],
            ),
            take('letter', { doc: 'letter' }, golden ? [{ story: 'letter_read' }] : []),
            ...(golden ? [object('cabinet', lock([]), [{ story: 'cabinet_then' }])] : []),
            ...(v.leverCellar === true ? [object('lever', null, [{ unlock: 'hall.to_cellar' }])] : []),
            exit('to_hall', 'hall'),
          ]),
          [cellar]: room(
            [
              take('star', { item: star }),
              take('diary', { doc: diary }),
              ...(golden ? [object('lever', null, [{ unlock: 'study.cabinet' }])] : []),
              exit('to_hall', 'hall'),
            ],
            [{ story: 'manor_cellar_voice' }],
          ),
        },
      },
    },
  });
}

function frozen<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    for (const child of Object.values(v)) {
      frozen(child);
    }
    Object.freeze(v);
  }
  return v;
}

/** A deep-frozen state in `room` of section `section`, so a reducer that mutates its input throws. */
function at(roomId: string, extra: Partial<WorldState> = {}, section = 'manor'): WorldState {
  return frozen({
    ...structuredClone(EMPTY_WORLD_STATE),
    section: sec(section),
    room: rm(roomId),
    lastRoom: { [section]: rm(roomId) },
    visited: [rm(roomId)],
    ...extra,
  });
}

const tap = (hotspot: string): ExploreAction => ({ kind: 'tap', hotspot: k(hotspot) });
const insert = (hotspot: string, item: string): ExploreAction => ({ kind: 'insert', hotspot: k(hotspot), item: it(item) });
const ended = (puzzle: string, outcome: 'solved' | 'failed' | 'abandoned'): ExploreAction => ({ kind: 'puzzle-ended', puzzle: pz(puzzle), outcome });
const DIRTY: ExploreEffect = { kind: 'dirty' };
/** The kernel's effects of a list, in order: every effect but the writer's `cue` effects. */
const kernelEffects = <E extends { readonly kind: string }>(effects: readonly E[]): E[] => effects.filter((e) => e.kind !== 'cue');

/** Runs actions in order and returns the last result. */
function run(w: WorldPublicBody, s: WorldState, ...steps: ExploreAction[]): { state: WorldState; effects: ExploreEffect[] } {
  let r = { state: s, effects: [] as ExploreEffect[] };
  for (const a of steps) {
    r = reduce(w, frozen(r.state), a);
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// The reducer rules

test('reduce: take moves item to held once', () => {
  const w = manor();
  const s = at('study');
  const r = reduce(w, s, tap('study.medal'));
  expect(r.state.held).toEqual(['medal_sun']);
  expect(r.state.taken).toEqual(['study.medal']);
  expect(kernelEffects(r.effects)).toEqual([{ kind: 'got', gift: { item: 'medal_sun' }, at: 'study.medal' }, DIRTY]);
  const again = reduce(w, frozen(r.state), tap('study.medal'));
  expect(again.state).toBe(r.state);
  expect(kernelEffects(again.effects)).toEqual([]);
  const doc = reduce(w, frozen(r.state), tap('study.letter'));
  expect(doc.state.docs).toEqual(['letter']);
  expect(doc.state.held).toEqual(['medal_sun']);
});

test('reduce: wrong item refused, state unchanged', () => {
  const w = manor();
  const s = at('hall', { held: [it('medal_sun'), it('medal_moon')] });
  const refused = (hotspot: string, item: string): ExploreEffect[] => [{ kind: 'refused', at: k(hotspot), item: it(item), reason: 'no-fit' }];
  for (const [hotspot, item] of [['hall.gate', 'medal_star'], ['hall.to_study', 'medal_sun'], ['study.drawer', 'medal_sun']] as const) {
    const a = insert(hotspot, item);
    const r = reduce(w, s, a);
    expect(kernelEffects(r.effects), JSON.stringify(a)).toEqual(refused(hotspot, item));
    expect(r.state).toBe(s);
  }
  // The positive control: the right held item fills its slot.
  const right = reduce(w, s, insert('hall.gate', 'medal_sun'));
  expect(right.state.slots).toEqual({ 'hall.gate': ['medal_sun', null, null] });
  expect(right.state.held).toEqual(['medal_moon']);
  expect(right.state.used).toEqual(['medal_sun']);
  expect(kernelEffects(right.effects)).toEqual([DIRTY]);
  // A slot takes one item: the same item again does not fit.
  const twice = reduce(w, frozen({ ...right.state, held: [it('medal_sun')] }), insert('hall.gate', 'medal_sun'));
  expect(kernelEffects(twice.effects)).toEqual(refused('hall.gate', 'medal_sun'));
});

test('reduce: lock opens after last slot then puzzle', () => {
  const w = manor();
  const s = at('hall', { held: MEDALS.map(it) });
  const two = run(w, s, insert('hall.gate', 'medal_sun'), insert('hall.gate', 'medal_moon'));
  expect(kernelEffects(two.effects)).toEqual([DIRTY]);
  const last = reduce(w, frozen(two.state), insert('hall.gate', 'medal_star'));
  expect(kernelEffects(last.effects)).toEqual([{ kind: 'puzzle', puzzle: 'gate', hotspot: 'hall.gate' }, DIRTY]);
  expect(last.state.open).toEqual([]);
  const solved = reduce(w, frozen(last.state), ended('gate', 'solved'));
  expect(solved.state.open).toEqual(['hall.gate']);
  expect(solved.state.puzzles).toEqual({ gate: { outcome: 'solved', attempts: 0, hintsOpened: 0 } });
  const out = reduce(w, frozen(solved.state), tap('hall.gate'));
  expect(kernelEffects(out.effects)).toEqual([{ kind: 'leave', knot: 'manor_out', from: 'hall', via: 'hall.gate' }, DIRTY]);
  // A lock without a puzzle opens at its last insert.
  const plain = world({
    items: ['key'],
    sections: { s: { start: 'a', rooms: { a: room([exit('door', { story: 'out' }, lock(['key']))]) } } },
  });
  const opened = reduce(plain, at('a', { held: [it('key')] }, 's'), insert('a.door', 'key'));
  expect(opened.state.open).toEqual(['a.door']);
  expect(kernelEffects(opened.effects)).toEqual([DIRTY]);
});

test('reduce: slots persist in any order', () => {
  const w = manor();
  const s = at('hall', { held: MEDALS.map(it) });
  const reversed = run(w, s, insert('hall.gate', 'medal_star'), insert('hall.gate', 'medal_sun'));
  expect(reversed.state.slots).toEqual({ 'hall.gate': ['medal_sun', null, 'medal_star'] });
  // A walk away and back keeps the filled slots.
  const walked = run(w, reversed.state, tap('hall.to_study'), tap('study.to_hall'));
  expect(walked.state.slots).toEqual(reversed.state.slots);
  const last = reduce(w, frozen(walked.state), insert('hall.gate', 'medal_moon'));
  expect(last.state.slots).toEqual({ 'hall.gate': ['medal_sun', 'medal_moon', 'medal_star'] });
  expect(kernelEffects(last.effects)).toEqual([{ kind: 'puzzle', puzzle: 'gate', hotspot: 'hall.gate' }, DIRTY]);
});

test('reduce: tap on a filled unsolved lock reopens its puzzle', () => {
  const w = manor();
  const filled = at('hall', { slots: { [k('hall.gate')]: MEDALS.map(it) }, used: MEDALS.map(it) });
  const r = reduce(w, filled, tap('hall.gate'));
  expect(kernelEffects(r.effects)).toEqual([{ kind: 'puzzle', puzzle: 'gate', hotspot: 'hall.gate' }]);
  expect(r.state).toBe(filled);
  // Attempts are kept: the run exists but has no outcome.
  const tried = at('hall', { slots: filled.slots, used: filled.used, puzzles: { [pz('gate')]: { outcome: null, attempts: 2, hintsOpened: 1 } } });
  expect(kernelEffects(reduce(w, tried, tap('hall.gate')).effects)).toEqual([{ kind: 'puzzle', puzzle: 'gate', hotspot: 'hall.gate' }]);
  // A zero-slot lock counts as filled.
  expect(kernelEffects(reduce(w, at('study'), tap('study.drawer')).effects)).toEqual([{ kind: 'puzzle', puzzle: 'drawer', hotspot: 'study.drawer' }]);
  // A failed puzzle whose onFail did not unlock shows the panel.
  const failed = at('hall', { slots: filled.slots, used: filled.used, puzzles: { [pz('gate')]: { outcome: 'failed', attempts: 3, hintsOpened: 0 } } });
  expect(kernelEffects(reduce(w, failed, tap('hall.gate')).effects)).toEqual([{ kind: 'lock', hotspot: 'hall.gate' }]);
});

test('reduce: take runs its then once', () => {
  const w = world({
    items: ['key', 'map'],
    sections: { s: { start: 'a', rooms: { a: room([take('key', { item: 'key' }, [{ give: 'map' }, { story: 'found_key' }]), exit('out', { story: 'end' })]) } } },
  });
  const r = reduce(w, at('a', {}, 's'), tap('a.key'));
  expect(kernelEffects(r.effects)).toEqual([
    { kind: 'got', gift: { item: 'key' }, at: 'a.key' },
    { kind: 'got', gift: { item: 'map' }, at: 'a.key' },
    { kind: 'story', knot: 'found_key' },
    DIRTY,
  ]);
  expect(r.state.held).toEqual(['key', 'map']);
  expect(r.state.fired).toEqual(['then:a.key']);
  expect(r.state.pendingStory).toEqual(['found_key']);
  const back = run(w, r.state, { kind: 'event-returned', section: sec('s') }, tap('a.key'));
  expect(kernelEffects(back.effects)).toEqual([]);
  expect(back.state.pendingStory).toEqual([]);
  expect(back.state.held).toEqual(['key', 'map']);
});

test('reduce: lock opening runs onOpen once', () => {
  const w = world({
    items: ['key'],
    sections: {
      s: {
        start: 'a',
        rooms: {
          a: room([
            object('lever', null, [{ unlock: 'a.door' }]),
            object('lever2', null, [{ unlock: 'a.door' }]),
            exit('door', 'b', lock([], null, [], [{ story: 'door_opens' }])),
            object('chest', lock(['key'], null, [], [{ story: 'chest_opens' }]), [{ story: 'chest_then' }]),
          ]),
          b: room([exit('back', 'a')]),
        },
      },
    },
  });
  const pulled = reduce(w, at('a', {}, 's'), tap('a.lever'));
  expect(pulled.state.open).toEqual(['a.door']);
  expect(pulled.state.pendingStory).toEqual(['door_opens']);
  expect(pulled.state.fired).toEqual(['then:a.lever', 'open:a.door']);
  // A second unlock of an open key runs nothing again.
  const second = run(w, pulled.state, { kind: 'event-returned', section: sec('s') }, tap('a.lever2'));
  expect(second.state.pendingStory).toEqual([]);
  expect(second.state.fired).toEqual(['then:a.lever', 'open:a.door', 'then:a.lever2']);
  // The last insert opens the chest: onOpen first, then the object's own `then`.
  const chest = reduce(w, at('a', { held: [it('key')] }, 's'), insert('a.chest', 'key'));
  expect(chest.state.pendingStory).toEqual(['chest_opens', 'chest_then']);
  expect(kernelEffects(chest.effects)).toEqual([{ kind: 'story', knot: 'chest_opens' }, DIRTY]);
});

test('reduce: tap while an event is pending is refused', () => {
  const w = manor();
  const busy = at('hall', { pendingStory: [kn('manor_cellar_voice')], held: [it('medal_sun')] });
  for (const a of [tap('hall.to_study'), tap('hall.inscription'), insert('hall.gate', 'medal_sun')]) {
    const r = reduce(w, busy, a);
    expect(r.state, JSON.stringify(a)).toBe(busy);
    expect(kernelEffects(r.effects), JSON.stringify(a)).toEqual([]);
  }
  // The positive control: the same tap with no event running moves.
  const idle = reduce(w, at('hall', { held: [it('medal_sun')] }), tap('hall.to_study'));
  expect(idle.state.room).toBe('study');
  expect(kernelEffects(idle.effects)).toEqual([{ kind: 'room', room: 'study', sfx: 'door', from: 'hall', via: 'hall.to_study', how: 'walk' }, DIRTY]);
});

test('reduce: failed runs onFail once', () => {
  const w = manor();
  const filled = at('hall', { slots: { [k('hall.gate')]: MEDALS.map(it) }, used: MEDALS.map(it) });
  const failed = reduce(w, filled, ended('gate', 'failed'));
  expect(failed.state.puzzles).toEqual({ gate: { outcome: 'failed', attempts: 0, hintsOpened: 0 } });
  expect(failed.state.fired).toEqual(['fail:hall.gate']);
  expect(failed.state.pendingStory).toEqual(['manor_gate_forced']);
  expect(failed.state.open).toEqual(['hall.gate']);
  expect(kernelEffects(failed.effects)).toEqual([{ kind: 'story', knot: 'manor_gate_forced' }, DIRTY]);
  // The outcome is final: a second end changes nothing.
  const again = reduce(w, frozen(failed.state), ended('gate', 'failed'));
  expect(again.state).toBe(failed.state);
  expect(kernelEffects(again.effects)).toEqual([]);
  // Attempts count while the run is open.
  const tried = run(w, filled, { kind: 'attempt-failed', puzzle: pz('gate') }, { kind: 'attempt-failed', puzzle: pz('gate') });
  expect(tried.state.puzzles).toEqual({ gate: { outcome: null, attempts: 2, hintsOpened: 0 } });
});

test('reduce: onEnter fires once', () => {
  const w = manor();
  const r = reduce(w, at('hall'), tap('hall.to_cellar'));
  const cellar: ExploreEffect = { kind: 'room', room: rm('cellar'), sfx: null, from: rm('hall'), via: k('hall.to_cellar'), how: 'walk' };
  expect(kernelEffects(r.effects)).toEqual([cellar, { kind: 'story', knot: 'manor_cellar_voice' }, DIRTY]);
  expect(r.state.fired).toEqual(['enter:cellar']);
  const again = run(w, r.state, { kind: 'event-returned', section: sec('manor') }, tap('cellar.to_hall'), tap('hall.to_cellar'));
  expect(kernelEffects(again.effects)).toEqual([cellar, DIRTY]);
  expect(again.state.pendingStory).toEqual([]);
  // A section entry fires its room's onEnter too.
  const entered = reduce(w, frozen(structuredClone(EMPTY_WORLD_STATE)), { kind: 'enter-section', section: sec('manor') });
  expect(entered.state.section).toBe('manor');
  expect(entered.state.room).toBe('hall');
  expect(kernelEffects(entered.effects)).toEqual([{ kind: 'room', room: 'hall', sfx: null, from: null, via: null, how: 'enter' }, DIRTY]);
});

test('reduce: story effects queue and pop on return', () => {
  const w = world({
    sections: { s: { start: 'a', rooms: { a: room([look('sign', [{ story: 'first' }, { story: 'second' }]), exit('out', { story: 'end' })]) } } },
  });
  const r = reduce(w, at('a', {}, 's'), tap('a.sign'));
  expect(r.state.pendingStory).toEqual(['first', 'second']);
  expect(r.effects.filter((e) => e.kind === 'story')).toEqual([{ kind: 'story', knot: 'first' }]);
  const one = reduce(w, frozen(r.state), { kind: 'event-returned', section: sec('s') });
  expect(one.state.pendingStory).toEqual(['second']);
  expect(kernelEffects(one.effects)).toEqual([{ kind: 'story', knot: 'second' }, DIRTY]);
  const two = reduce(w, frozen(one.state), { kind: 'event-returned', section: sec('s') });
  expect(two.state.pendingStory).toEqual([]);
  expect(kernelEffects(two.effects)).toEqual([{ kind: 'room', room: 'a', sfx: null, from: 'a', via: null, how: 'return' }, DIRTY]);
});

test('reduce: leave clears the section', () => {
  const w = manor();
  const s = at('hall', { open: [k('hall.gate')], fired: ['fail:hall.gate'] });
  const r = reduce(w, s, tap('hall.gate'));
  expect(kernelEffects(r.effects)).toEqual([{ kind: 'leave', knot: 'manor_out', from: 'hall', via: 'hall.gate' }, DIRTY]);
  expect(r.state.section).toBeNull();
  // Only `section` changes (I-W's re-entry rule), so the section key is the one that left.
  expect({ ...r.state, section: s.section }).toEqual(s);
  expect(sectionKey(w, r.state, sec('manor'))).toBe(sectionKey(w, s, sec('manor')));
  expect(actions(w, r.state)).toEqual([]);
  // Re-entry resumes in the room the section was left from.
  const back = reduce(w, frozen(r.state), { kind: 'enter-section', section: sec('manor') });
  expect(back.state.room).toBe('hall');
  expect(back.state.section).toBe('manor');
});

test('reduce: a kernel effect names where it acts', () => {
  const w = manor();
  const first = (r: { effects: ExploreEffect[] }): ExploreEffect | undefined => kernelEffects(r.effects)[0];
  // A walk: the room left and the exit taken; a section's fresh entry: neither.
  expect(first(reduce(w, at('hall'), tap('hall.to_study')))).toEqual({ kind: 'room', room: 'study', sfx: 'door', from: 'hall', via: 'hall.to_study', how: 'walk' });
  const fresh = reduce(w, frozen(structuredClone(EMPTY_WORLD_STATE)), { kind: 'enter-section', section: sec('manor') });
  expect(first(fresh)).toEqual({ kind: 'room', room: 'hall', sfx: null, from: null, via: null, how: 'enter' });
  // A resume of the current section and an event knot's return re-show the room they are in.
  expect(first(reduce(w, at('study'), { kind: 'enter-section', section: sec('manor') }))).toEqual({ kind: 'room', room: 'study', sfx: null, from: 'study', via: null, how: 'resume' });
  const voice = at('cellar', { pendingStory: [kn('manor_cellar_voice')], fired: ['enter:cellar'] });
  expect(first(reduce(w, voice, { kind: 'event-returned', section: sec('manor') }))).toEqual({ kind: 'room', room: 'cellar', sfx: null, from: 'cellar', via: null, how: 'return' });
  // A leave: the room left and the exit.
  expect(first(reduce(w, at('hall', { open: [k('hall.gate')] }), tap('hall.gate')))).toEqual({ kind: 'leave', knot: 'manor_out', from: 'hall', via: 'hall.gate' });
  // A take names itself; a `then` gift names the hotspot whose trigger gave it (the solved drawer's).
  expect(first(reduce(w, at('study'), tap('study.medal')))).toEqual({ kind: 'got', gift: { item: 'medal_sun' }, at: 'study.medal' });
  expect(first(reduce(w, at('study'), ended('drawer', 'solved')))).toEqual({ kind: 'got', gift: { item: 'medal_moon' }, at: 'study.drawer' });
  // A room's onEnter gift has no hotspot.
  const porch = world({ items: ['coin'], sections: { s: { start: 'a', rooms: { a: room([exit('out', { story: 'end' })], [{ give: 'coin' }]) } } } });
  const entered = reduce(porch, frozen(structuredClone(EMPTY_WORLD_STATE)), { kind: 'enter-section', section: sec('s') });
  expect(kernelEffects(entered.effects)[1]).toEqual({ kind: 'got', gift: { item: 'coin' }, at: null });
  // A look names the hotspot read; a refused insert names the lock and the item.
  expect(first(reduce(w, at('hall'), tap('hall.inscription')))).toEqual({ kind: 'look', text: { id: expect.any(String), ru: 'inscription' }, at: 'hall.inscription' });
  expect(first(reduce(w, at('hall', { held: [it('medal_sun')] }), insert('hall.gate', 'medal_star')))).toEqual({ kind: 'refused', at: 'hall.gate', item: 'medal_star', reason: 'no-fit' });
});

test('reduce: an action that changes no state keeps its effects', () => {
  const w = manor();
  // A lock with a free slot: the panel opens (the only UI that sends `insert`).
  const hall = at('hall', { held: [it('medal_sun')] });
  const panel = reduce(w, hall, tap('hall.gate'));
  expect(kernelEffects(panel.effects)).toEqual([{ kind: 'lock', hotspot: 'hall.gate' }]);
  expect(panel.state).toBe(hall);
  // A re-read shows the text again.
  const read = at('hall', { examined: [k('hall.inscription')] });
  const reread = reduce(w, read, tap('hall.inscription'));
  expect(kernelEffects(reread.effects)).toHaveLength(1);
  expect(kernelEffects(reread.effects)[0]?.kind).toBe('look');
  expect(reread.state).toBe(read);
  // A resume of the current section re-shows its room.
  const resumed = reduce(w, hall, { kind: 'enter-section', section: sec('manor') });
  expect(kernelEffects(resumed.effects)).toEqual([{ kind: 'room', room: 'hall', sfx: null, from: 'hall', via: null, how: 'resume' }]);
  expect(resumed.state).toBe(hall);
  // A re-read hint tier counts nothing.
  const hinted = at('study', { puzzles: { [pz('drawer')]: { outcome: null, attempts: 0, hintsOpened: 2 } } });
  const reHint = reduce(w, hinted, { kind: 'hint-opened', puzzle: pz('drawer'), tier: 1 });
  expect(reHint.state).toBe(hinted);
  expect(kernelEffects(reHint.effects)).toEqual([]);
});

test("explore: runReduce leaves a lock puzzle's outcome alone", () => {
  // (a) The gate is a lock puzzle with a hint tier: the run reducer (a linear puzzle's writer) changes nothing of it,
  // while the explore rules record each action. The contrast keeps a guard misplaced into the shared run step visible.
  const w = manor();
  const s = at('hall');
  const gate = pz('gate');
  const onLock = [
    { kind: 'attempt-failed', puzzle: gate },
    { kind: 'hint-opened', puzzle: gate, tier: 1 },
    { kind: 'puzzle-ended', puzzle: gate, outcome: 'solved' },
  ] as const;
  for (const a of onLock) {
    const r = runReduce(w, s, a);
    expect(r.state, JSON.stringify(a)).toBe(s);
    expect(r.effects, JSON.stringify(a)).toEqual([]);
  }
  const [failed, hint, solved] = onLock.map((a) => reduce(w, s, a));
  expect(failed?.state.puzzles).toEqual({ gate: { outcome: null, attempts: 1, hintsOpened: 0 } });
  expect(hint?.state.puzzles).toEqual({ gate: { outcome: null, attempts: 0, hintsOpened: 1 } });
  expect(solved?.state.puzzles).toEqual({ gate: { outcome: 'solved', attempts: 0, hintsOpened: 0 } });
  expect(solved?.state.open).toEqual(['hall.gate']);
  // A puzzle the world lacks is a no-op too.
  const absent = runReduce(w, s, { kind: 'attempt-failed', puzzle: pz('safe') });
  expect(absent.state).toBe(s);
  expect(absent.effects).toEqual([]);
  // (b) A puzzle no lock holds: step for step the same state and effects as the explore rules.
  const linear = world({
    puzzles: { lin: code(2, 2) },
    sections: { s: { start: 'r', rooms: { r: room([exit('out', { story: 'end' })]) } } },
  });
  const lin = pz('lin');
  const steps = [
    { kind: 'attempt-failed', puzzle: lin },
    { kind: 'attempt-failed', puzzle: lin },
    { kind: 'hint-opened', puzzle: lin, tier: 1 },
    { kind: 'hint-opened', puzzle: lin, tier: 1 },
    { kind: 'hint-opened', puzzle: lin, tier: 3 },
    { kind: 'hint-opened', puzzle: lin, tier: 0 },
    { kind: 'hint-opened', puzzle: lin, tier: 2 },
    { kind: 'puzzle-ended', puzzle: lin, outcome: 'failed' },
    { kind: 'puzzle-ended', puzzle: lin, outcome: 'failed' },
    { kind: 'puzzle-ended', puzzle: lin, outcome: 'abandoned' },
    { kind: 'puzzle-ended', puzzle: lin, outcome: 'solved' },
  ] as const;
  let state = frozen(structuredClone(EMPTY_WORLD_STATE));
  for (const a of steps) {
    const ran = runReduce(linear, state, a);
    const reduced = reduce(linear, state, a);
    expect({ state: ran.state, effects: ran.effects }, JSON.stringify(a)).toEqual({ state: reduced.state, effects: kernelEffects(reduced.effects) });
    state = frozen(ran.state);
  }
  expect(state.puzzles).toEqual({ lin: { outcome: 'solved', attempts: 2, hintsOpened: 2 } });
});

test('explore: a repeated outcome and an abandoned lock puzzle change nothing', () => {
  // The step-for-step comparison above cannot fail on the shared run step (both sides take it), so each no-op is
  // pinned against the state object itself: a repeated outcome of a linear puzzle saves nothing again (the D18 branch
  // re-sends `failed` for a run at its limit), a hint tier read again (the session re-reads a held tier as the same
  // `hint-opened`) saves nothing either, and a lock puzzle cannot be abandoned (X8).
  const linear = world({
    puzzles: { lin: code(2, 2) },
    sections: { s: { start: 'r', rooms: { r: room([exit('out', { story: 'end' })]) } } },
  });
  const failed = { kind: 'puzzle-ended', puzzle: pz('lin'), outcome: 'failed' } as const;
  const first = runReduce(linear, frozen(structuredClone(EMPTY_WORLD_STATE)), failed);
  expect(first.effects).toEqual([DIRTY]);
  const ended1 = frozen(first.state);
  for (const step of [runReduce, reduce]) {
    const again = step(linear, ended1, failed);
    expect(again.state, step.name).toBe(ended1);
    expect(kernelEffects(again.effects), step.name).toEqual([]);
  }
  const hint = { kind: 'hint-opened', puzzle: pz('lin'), tier: 1 } as const;
  const hinted = runReduce(linear, frozen(structuredClone(EMPTY_WORLD_STATE)), hint);
  expect(hinted.effects).toEqual([DIRTY]);
  const opened = frozen(hinted.state);
  for (const step of [runReduce, reduce]) {
    const again = step(linear, opened, hint);
    expect(again.state, step.name).toBe(opened);
    expect(kernelEffects(again.effects), step.name).toEqual([]);
  }
  const s = at('hall');
  const abandoned = reduce(manor(), s, ended('gate', 'abandoned'));
  expect(abandoned.state).toBe(s);
  expect(kernelEffects(abandoned.effects)).toEqual([]);
});

test('explore: a fractional hint tier changes nothing', () => {
  // Tiers are whole: 1.5 lies inside the 2-tier range and above the 1 opened, so only the integer guard of the run
  // step keeps it from being stored as `hintsOpened: 1.5` (GM1a tester r3 N9). Both writers share that step.
  const linear = world({
    puzzles: { lin: code(2, 2) },
    sections: { s: { start: 'r', rooms: { r: room([exit('out', { story: 'end' })]) } } },
  });
  const lin = pz('lin');
  const fractional = { kind: 'hint-opened', puzzle: lin, tier: 1.5 } as const;
  const opened = frozen({ ...structuredClone(EMPTY_WORLD_STATE), puzzles: { [lin]: { outcome: null, attempts: 0, hintsOpened: 1 } } });
  const ran = runReduce(linear, opened, fractional);
  expect(ran.state).toBe(opened);
  expect(ran.effects).toEqual([]);
  const inSection = at('r', { puzzles: { [lin]: { outcome: null, attempts: 0, hintsOpened: 1 } } }, 's');
  const reduced = reduce(linear, inSection, fractional);
  expect(reduced.state).toBe(inSection);
  expect(kernelEffects(reduced.effects)).toEqual([]);
});

test('actions: enumerates enabled taps and inserts', () => {
  const w = manor();
  const hall = at('hall', { held: [it('medal_sun'), it('medal_star')] });
  expect(actions(w, hall)).toEqual([
    tap('hall.to_study'),
    tap('hall.to_cellar'),
    tap('hall.gate'),
    tap('hall.inscription'),
    insert('hall.gate', 'medal_star'),
    insert('hall.gate', 'medal_sun'),
  ]);
  // A taken item is no tap; a filled slot takes no second item.
  const study = at('study', { taken: [k('study.medal')], held: [it('medal_sun')] });
  expect(actions(w, study)).toEqual([tap('study.drawer'), tap('study.letter'), tap('study.to_hall')]);
  // Only the return while an event runs; nothing outside a section.
  expect(actions(w, at('cellar', { pendingStory: [kn('manor_cellar_voice')] }))).toEqual([{ kind: 'event-returned', section: 'manor' }]);
  expect(actions(w, at('hall', { section: null }))).toEqual([]);
  // Every listed action is one reduce accepts: no refused insert.
  for (const a of actions(w, hall)) {
    expect(kernelEffects(reduce(w, hall, a).effects).some((e) => e.kind === 'refused'), JSON.stringify(a)).toBe(false);
  }
});

test('successors: puzzle effect expands to closed and outcomes', () => {
  const w = manor();
  const s = at('hall', { held: [it('medal_star')], used: [it('medal_sun'), it('medal_moon')], slots: { [k('hall.gate')]: [it('medal_sun'), it('medal_moon'), null] } });
  const succ = successors(w, s);
  const steps = succ.map((x) => x.step.kind);
  expect(succ.some((x) => x.step.kind === 'closed'), "no successor with step.kind 'closed'").toBe(true);
  const closed = succ.find((x) => x.step.kind === 'closed');
  expect(closed?.step).toEqual({ kind: 'closed', puzzle: 'gate' });
  expect(closed?.state.slots).toEqual({ 'hall.gate': MEDALS });
  expect(closed?.state.open).toEqual([]);
  const solved = succ.find((x) => x.step.kind === 'puzzle-ended' && x.step.outcome === 'solved');
  expect(solved?.state.open).toEqual(['hall.gate']);
  const failed = succ.find((x) => x.step.kind === 'puzzle-ended' && x.step.outcome === 'failed');
  expect(failed?.state.pendingStory).toEqual(['manor_gate_forced']);
  // The insert that opened the puzzle is not a successor of its own: closed stands for it.
  expect(steps.filter((x) => x === 'insert')).toEqual([]);
  // No maxAttempts: closed and solved only.
  const drawer = successors(w, at('study')).filter((x) => x.step.kind === 'closed' || x.step.kind === 'puzzle-ended');
  expect(drawer.map((x) => x.step)).toEqual([{ kind: 'closed', puzzle: 'drawer' }, ended('drawer', 'solved')]);
  expect(drawer[1]?.state.held).toEqual(['medal_moon']);
  // A leave marks its successor.
  const open = successors(w, at('hall', { open: [k('hall.gate')] }));
  expect(open.filter((x) => x.leaves).map((x) => x.step)).toEqual([tap('hall.gate')]);
});

test('sectionKey: ignores section, lastRoom, unproved and other sections', () => {
  const w = world({
    items: ['a1', 'a2', 'b1'],
    sections: {
      a: { start: 'ra', rooms: { ra: room([take('t1', { item: 'a1' }), take('t2', { item: 'a2' }), exit('out', { story: 'end' })]) } },
      b: { start: 'rb', rooms: { rb: room([take('t3', { item: 'b1' }), exit('out', { story: 'end' })]) } },
    },
  });
  const A = sec('a');
  const s = at('ra', { held: [it('a1'), it('a2')], taken: [k('ra.t1'), k('ra.t2')] }, 'a');
  const key = sectionKey(w, s, A);
  const same = (patch: Partial<WorldState>) => sectionKey(w, frozen({ ...s, ...patch }), A);
  expect(same({ section: null })).toBe(key);
  expect(same({ lastRoom: { [A]: rm('ra'), [sec('b')]: rm('rb') } })).toBe(key);
  expect(same({ unproved: [A, sec('b')] })).toBe(key);
  expect(same({ examined: [k('ra.out')], visited: [rm('ra'), rm('rb')] })).toBe(key);
  // Another section's keys are not S's.
  expect(same({ held: [it('a1'), it('a2'), it('b1')], taken: [k('ra.t1'), k('ra.t2'), k('rb.t3')] })).toBe(key);
  // Sets: the order play added them in does not matter.
  expect(same({ held: [it('a2'), it('a1')], taken: [k('ra.t2'), k('ra.t1')] })).toBe(key);
  // What S's rules read does.
  expect(same({ held: [it('a1')], used: [it('a2')] })).not.toBe(key);
  expect(same({ room: rm('rb') })).not.toBe(key);
  const queued = same({ pendingStory: [kn('x'), kn('y')] });
  expect(same({ pendingStory: [kn('y'), kn('x')] })).not.toBe(queued);
  // An absent slots entry is the all-empty one.
  const gated = world({
    items: ['key'],
    sections: { g: { start: 'r', rooms: { r: room([exit('door', { story: 'end' }, lock(['key', 'key']))]) } } },
  });
  const empty = at('r', {}, 'g');
  expect(sectionKey(gated, frozen({ ...empty, slots: { [k('r.door')]: [null, null] } }), sec('g'))).toBe(sectionKey(gated, empty, sec('g')));
});

// ---------------------------------------------------------------------------------------------------------------
// The projection

const declared = (...names: string[]): ReadonlySet<VarName> => new Set(names as VarName[]); // fixture var names
const dc = (s: string) => s as DocId; // a fixture doc id

test('project: writes only declared vars', () => {
  const w = manor();
  const s = at('study', {
    held: [it('medal_sun')],
    used: [it('medal_moon')],
    docs: [dc('diary')],
    puzzles: { [pz('drawer')]: { outcome: 'solved', attempts: 3, hintsOpened: 2 } },
  });
  const names = ['pz_drawer', 'pz_drawer_hints', 'it_medal_sun', 'it_medal_moon', 'it_medal_star', 'dc_diary', 'dc_letter', 'g_trust'];
  expect(project(w, s, declared(...names))).toEqual({
    pz_drawer: 1,
    pz_drawer_hints: 2,
    it_medal_sun: true,
    it_medal_moon: true,
    it_medal_star: false,
    dc_diary: true,
    dc_letter: false,
  });
  expect(project(w, s, declared())).toEqual({});
});

test('project: puzzle outcome codes', () => {
  const w = world({
    puzzles: { a: code(2), b: code(2), c: code(2), d: code(2) },
    sections: { s: { start: 'r', rooms: { r: room([exit('out', { story: 'end' })]) } } },
  });
  const s = at(
    'r',
    {
      puzzles: {
        [pz('a')]: { outcome: 'solved', attempts: 0, hintsOpened: 0 },
        [pz('b')]: { outcome: 'failed', attempts: 3, hintsOpened: 1 },
        [pz('c')]: { outcome: 'abandoned', attempts: 1, hintsOpened: 0 },
      },
    },
    's',
  );
  const all = declared('pz_a', 'pz_b', 'pz_c', 'pz_d', 'pz_a_hints', 'pz_b_hints', 'pz_d_hints');
  expect(project(w, s, all)).toEqual({ pz_a: 1, pz_b: 2, pz_c: 3, pz_d: 0, pz_a_hints: 0, pz_b_hints: 1, pz_d_hints: 0 });
});

// ---------------------------------------------------------------------------------------------------------------
// Reconcile (X9)

const stamped = (w: WorldPublicBody, version: string): WorldPublic => ({ ...w, version });
const V1 = '1111111111111111';
const V2 = '2222222222222222';
const MANOR = sec('manor');
const MANOR_KNOTS: ReadonlySet<KnotName> = new Set(['manor_out', 'manor_gate_forced', 'manor_cellar_voice'].map(kn));
const enterAction = (section: string): ExploreAction => ({ kind: 'enter-section', section: sec(section) });
const returned = (section: string): ExploreAction => ({ kind: 'event-returned', section: sec(section) });

/** Whether some path from `s` leaves section S (the search kernel's goal edges). */
function exitable(w: WorldPublicBody, s: WorldState, section: SectionId): boolean {
  let leaves = 0;
  searchSection(w, s, section, RESUME_STATE_CAP, {
    onEdge: (_from, _succ, to) => {
      leaves += to === null ? 1 : 0;
    },
  });
  return leaves > 0;
}

test('reconcile: unknown ids dropped', () => {
  const w = stamped(manor(), V2);
  const s = at('hall', {
    held: [it('medal_comet'), it('medal_sun')],
    docs: [dc('map')],
    taken: [k('attic.box'), k('study.medal')],
    examined: [k('attic.sign')],
    open: [k('attic.door')],
    fired: ['enter:attic', 'then:attic.box'],
    puzzles: { [pz('safe')]: { outcome: 'solved', attempts: 0, hintsOpened: 0 } },
    lastRoom: { [MANOR]: rm('hall'), [sec('tower')]: rm('top') },
    visited: [rm('hall'), rm('attic')],
    slots: { [k('attic.door')]: [it('medal_comet')] },
  });
  const r = reconcile(w, s, MANOR_KNOTS, V1);
  expect(r.state.held).toEqual(['medal_sun']);
  expect([...r.dropped].sort()).toEqual(
    [
      'held:medal_comet',
      'docs:map',
      'taken:attic.box',
      'examined:attic.sign',
      'open:attic.door',
      'fired:enter:attic',
      'fired:then:attic.box',
      'puzzles:safe',
      'lastRoom:tower',
      'visited:attic',
      'slots:attic.door',
    ].sort(),
  );
  expect(r.state.taken).toEqual(['study.medal']);
  expect(r.state.docs).toEqual([]);
  expect(r.state.open).toEqual([]);
  expect(r.state.fired).toEqual([]);
  expect(r.state.puzzles).toEqual({});
  expect(r.state.slots).toEqual({});
  expect(r.state.lastRoom).toEqual({ manor: 'hall' });
  expect(r.state.room).toBe('hall');
  expect(r.reset).toBeNull();
});

test('reconcile: missing room falls back to section start', () => {
  const w = stamped(manor(), V2);
  const r = reconcile(w, at('attic'), MANOR_KNOTS, V1);
  expect(r.state.room).toBe('hall');
  expect(r.state.section).toBe('manor');
  expect(r.dropped).toContain('room:attic');
  expect(r.reset).toBeNull();
});

test('reconcile: missing pending knot dropped', () => {
  const w = stamped(manor(), V2);
  const s = at('cellar', { fired: ['enter:cellar'], pendingStory: [kn('manor_cellar_voice'), kn('old_knot')] });
  const r = reconcile(w, s, MANOR_KNOTS, V1);
  expect(r.state.pendingStory).toEqual(['manor_cellar_voice']);
  expect(r.dropped).toEqual(['pendingStory:old_knot']);
  expect(r.reset).toBeNull();
});

test('reconcile: same world version returns the state unchanged', () => {
  const w = stamped(manor(), V1);
  const s = at('hall', { held: [it('medal_comet')], pendingStory: [kn('old_knot')] });
  const r = reconcile(w, s, MANOR_KNOTS, V1);
  expect(r.state).toBe(s);
  expect(r.dropped).toEqual([]);
  expect(r.reset).toBeNull();
});

test('reconcile: changed slot shape returns the items to held', () => {
  const v1 = manor();
  const v2 = stamped(manor({ gate: ['medal_moon', 'medal_sun', 'medal_star'] }), V2);
  const s = run(
    v1,
    EMPTY_WORLD_STATE,
    enterAction('manor'),
    tap('hall.to_study'),
    tap('study.medal'),
    tap('study.drawer'),
    ended('drawer', 'solved'),
    tap('study.to_hall'),
    insert('hall.gate', 'medal_sun'),
    insert('hall.gate', 'medal_moon'),
  ).state;
  expect(s.slots).toEqual({ 'hall.gate': ['medal_sun', 'medal_moon', null] });
  const r = reconcile(v2, s, MANOR_KNOTS, V1);
  expect(inSectionReach(v2, r.state, MANOR, RESUME_STATE_CAP)).toBe('yes');
  expect([...r.state.held].sort()).toEqual(['medal_moon', 'medal_sun']);
  expect(r.state.used).toEqual([]);
  expect(r.state.slots).toEqual({});
  expect(r.reset).toBeNull();
  // A slot that still accepts its item keeps it.
  const kept = reconcile(stamped(manor({ gate: ['medal_sun', 'medal_star', 'medal_moon'] }), V2), s, MANOR_KNOTS, V1);
  expect(kept.state.slots).toEqual({ 'hall.gate': ['medal_sun', null, null] });
  expect(kept.state.held).toEqual(['medal_moon']);
});

test('reconcile: renamed held item keeps the section exitable', () => {
  const v1 = manor();
  const v2 = stamped(manor({ star: 'medal_comet' }), V2);
  const s = run(v1, EMPTY_WORLD_STATE, enterAction('manor'), tap('hall.to_cellar'), returned('manor'), tap('cellar.star'), tap('cellar.to_hall')).state;
  expect(s.held).toEqual(['medal_star']);
  const r = reconcile(v2, s, MANOR_KNOTS, V1);
  expect(inSectionReach(v2, r.state, MANOR, RESUME_STATE_CAP)).toBe('yes');
  expect(r.dropped).toContain('held:medal_star');
  expect(r.state.taken).toEqual([]);
  expect(r.reset).toBeNull();
  // The gift is re-armed under its new id, and a way out exists.
  expect(run(v2, r.state, tap('hall.to_cellar'), returned('manor'), tap('cellar.star')).state.held).toEqual(['medal_comet']);
  expect(exitable(v2, r.state, MANOR)).toBe(true);
});

test('reconcile: step 0 maps renamed items, docs, rooms, sections and hotspots before normalize', () => {
  // A save played on v1: the inscription read, both docs, the star in the gate's slot, the drawer open by its puzzle
  // (its then gave the moon), back in the cellar. Its lists are out of sorted order on purpose.
  const s = run(
    manor(),
    EMPTY_WORLD_STATE,
    enterAction('manor'),
    tap('hall.inscription'),
    tap('hall.to_cellar'),
    returned('manor'),
    tap('cellar.star'),
    tap('cellar.diary'),
    tap('cellar.to_hall'),
    tap('hall.to_study'),
    tap('study.medal'),
    tap('study.drawer'),
    ended('drawer', 'solved'),
    tap('study.letter'),
    tap('study.to_hall'),
    insert('hall.gate', 'medal_star'),
    tap('hall.to_cellar'),
  ).state;
  expect([s.room, s.held, s.used, s.open, s.fired]).toEqual(['cellar', ['medal_sun', 'medal_moon'], ['medal_star'], ['study.drawer'], ['enter:cellar', 'then:study.drawer']]);
  // v2 renames one id of every kind step 0 maps; the cellar's hotspots move by their own entries (a room's rename
  // carries none). The map is the public world's: resolved, one lookup per id.
  const bare = manor({ star: 'medal_comet', renamedIds: true });
  const renamed = {
    items: { [it('medal_star')]: it('medal_comet') },
    docs: { [dc('diary')]: dc('journal') },
    rooms: { [rm('cellar')]: rm('crypt') },
    sections: { [MANOR]: sec('estate') },
    hotspots: {
      [k('hall.inscription')]: k('hall.plaque'),
      [k('study.drawer')]: k('study.desk'),
      [k('cellar.star')]: k('crypt.star'),
      [k('cellar.diary')]: k('crypt.diary'),
      [k('cellar.to_hall')]: k('crypt.to_hall'),
    },
  };
  const v2 = stamped({ ...bare, renamed }, V2);
  const r = reconcile(v2, s, MANOR_KNOTS, V1);
  expect(r.dropped).toEqual([]);
  // Every field holds the new ids, in the save's order; the run and the rest pass.
  expect(r.state).toEqual({
    ...s,
    section: 'estate',
    room: 'crypt',
    lastRoom: { estate: 'crypt' },
    visited: ['hall', 'crypt', 'study'],
    held: ['medal_sun', 'medal_moon'],
    used: ['medal_comet'],
    docs: ['journal', 'letter'],
    taken: ['crypt.star', 'crypt.diary', 'study.medal', 'study.letter'],
    examined: ['hall.plaque'],
    slots: { 'hall.gate': [null, null, 'medal_comet'] },
    open: ['study.desk'],
    fired: ['enter:crypt', 'then:study.desk'],
    unproved: ['estate'],
  });
  expect(r.reset).toBeNull();
  // No restart: the renamed state is one v2 reaches.
  expect(inSectionReach(v2, r.state, sec('estate'), RESUME_STATE_CAP)).toBe('yes');

  // The control: the same v2 without `renamed` drops the old ids as normalize always has, and keeps the rest in order.
  const control = reconcile(stamped(bare, V2), s, MANOR_KNOTS, V1);
  expect(control.dropped).toEqual([
    'used:medal_star',
    'docs:diary',
    'taken:cellar.star',
    'taken:cellar.diary',
    'examined:hall.inscription',
    'open:study.drawer',
    'fired:enter:cellar',
    'fired:then:study.drawer',
    'visited:cellar',
    'lastRoom:manor',
    'section:manor',
    'room:cellar',
  ]);
  expect([control.state.held, control.state.visited, control.state.taken]).toEqual([['medal_sun', 'medal_moon'], ['hall', 'study'], ['study.medal', 'study.letter']]);

  // Merges: two held ids onto one keep one entry; of two slot keys (or two lastRoom sections) onto one, the first in
  // save order stays and the other is dropped, its slot's item back in held; flags map too.
  const merging = stamped(
    {
      ...bare,
      renamed: {
        items: { [it('medal_old')]: it('medal_comet'), [it('medal_star')]: it('medal_comet') },
        sections: { [sec('house')]: sec('estate'), [MANOR]: sec('estate') },
        hotspots: { [k('hall.gate_old')]: k('hall.gate') },
        flags: { [fl('fl_old')]: fl('fl_new') },
      },
    },
    V2,
  );
  const saved = frozen({
    ...structuredClone(EMPTY_WORLD_STATE),
    section: MANOR,
    room: rm('hall'),
    lastRoom: { [sec('house')]: rm('study'), [MANOR]: rm('hall') },
    visited: [rm('hall')],
    held: [it('medal_old'), it('medal_star')],
    used: [it('medal_moon'), it('medal_sun')],
    slots: { [k('hall.gate_old')]: [null, it('medal_moon'), null], [k('hall.gate')]: [it('medal_sun'), null, null] },
    flags: [fl('fl_old'), fl('fl_keep')],
  });
  const m = reconcile(merging, saved, MANOR_KNOTS, V1);
  expect(m.dropped).toEqual(['slots:hall.gate', 'lastRoom:manor']);
  expect([m.state.held, m.state.used, m.state.slots, m.state.lastRoom, m.state.section, m.state.flags]).toEqual([
    ['medal_comet', 'medal_sun'],
    ['medal_moon'],
    { 'hall.gate': [null, 'medal_moon', null] },
    { estate: 'study' },
    'estate',
    ['fl_new', 'fl_keep'],
  ]);

  // A room's rename moves the room, never its hotspots onto the target's: the study has its own drawer, so a merged
  // attic's open `attic.drawer` is dropped (and its lock re-arms), not carried onto `study.drawer`.
  const merged = reconcile(stamped({ ...manor(), renamed: { rooms: { [rm('attic')]: rm('study') } } }, V2), at('attic', { open: [k('attic.drawer')], fired: ['then:attic.drawer'] }), MANOR_KNOTS, V1);
  expect(merged.dropped).toEqual(['open:attic.drawer', 'fired:then:attic.drawer']);
  expect([merged.state.room, merged.state.visited, merged.state.lastRoom, merged.state.open, merged.state.fired]).toEqual(['study', ['study'], { manor: 'study' }, [], []]);

  // A map is read by own keys only: an item named `constructor` is no rename.
  const tiny = world({ items: ['constructor', 'medal_sun'], sections: { manor: { start: 'hall', rooms: { hall: room([take('a', { item: 'constructor' })]) } } } });
  const plain = reconcile(stamped({ ...tiny, renamed: { items: { [it('medal_old')]: it('medal_sun') } } }, V2), at('hall', { held: [it('constructor'), it('medal_old')] }), MANOR_KNOTS, V1);
  expect([plain.dropped, plain.state.held]).toEqual([[], ['constructor', 'medal_sun']]);

  // An item merge leaves the item in a lock or in hand, never both, so it never fills a second lock.
  const comet = (hotspots: Readonly<Record<HotspotKey, HotspotKey>> = {}) =>
    stamped({ ...bare, renamed: { items: { [it('medal_old')]: it('medal_comet'), [it('medal_star')]: it('medal_comet') }, hotspots } }, V2);
  // (a) A held id merged onto one a lock holds goes; the lock keeps the item.
  const inLock = reconcile(comet(), at('hall', { held: [it('medal_old')], used: [it('medal_star')], slots: { [k('hall.gate')]: [null, null, it('medal_star')] } }, 'estate'), MANOR_KNOTS, V1);
  expect([inLock.state.held, inLock.state.used]).toEqual([[], ['medal_comet']]);
  expect([inLock.dropped, inLock.state.slots]).toEqual([['held:medal_old'], { 'hall.gate': [null, null, 'medal_comet'] }]);
  // (b) Step 0's give-back of a slot key merged away skips an item the kept key's cell still holds.
  const twoKeys = at('hall', { used: [it('medal_old'), it('medal_star')], slots: { [k('hall.gate_old')]: [null, null, it('medal_old')], [k('hall.gate')]: [null, null, it('medal_star')] } }, 'estate');
  const keyMerge = reconcile(comet({ [k('hall.gate_old')]: k('hall.gate') }), twoKeys, MANOR_KNOTS, V1);
  expect([keyMerge.state.held, keyMerge.state.used, keyMerge.state.slots]).toEqual([[], ['medal_comet'], { 'hall.gate': [null, null, 'medal_comet'] }]);
  expect(keyMerge.dropped).toEqual(['slots:hall.gate']);
  // (c) Normalize's give-back of a cell that no longer fits skips an item another kept cell still holds: the gate's
  // cell 0 (it accepts the sun) and cell 2 both held a medal that became the comet.
  const misfit = reconcile(comet(), at('hall', { used: [it('medal_old'), it('medal_moon'), it('medal_star')], slots: { [k('hall.gate')]: [it('medal_old'), it('medal_moon'), it('medal_star')] } }, 'estate'), MANOR_KNOTS, V1);
  expect([misfit.state.held, misfit.state.used, misfit.state.slots]).toEqual([[], ['medal_comet', 'medal_moon'], { 'hall.gate': [null, 'medal_moon', 'medal_comet'] }]);
  expect(misfit.dropped).toEqual([]);
});

test('reconcile: a slot of a lost lock gives its items back to held', () => {
  const w = stamped(manor(), V2);
  const r = reconcile(w, at('hall', { used: [it('medal_sun')], slots: { [k('hall.gone')]: [it('medal_sun')] } }), MANOR_KNOTS, V1);
  expect([r.state.held, r.state.used, r.state.slots, r.dropped]).toEqual([['medal_sun'], [], {}, ['slots:hall.gone']]);
});

test('reconcile: two lost cells that held one merged item give it back once', () => {
  const w = stamped({ ...manor({ star: 'medal_comet', renamedIds: true }), renamed: { items: { [it('medal_old')]: it('medal_comet'), [it('medal_star')]: it('medal_comet') } } }, V2);
  const r = reconcile(w, at('hall', { used: [it('medal_old'), it('medal_star')], slots: { [k('hall.gone_a')]: [it('medal_old')], [k('hall.gone_b')]: [it('medal_star')] } }, 'estate'), MANOR_KNOTS, V1);
  expect([r.state.held, r.state.used, r.state.slots]).toEqual([['medal_comet'], [], {}]);
  expect(r.dropped).toEqual(['slots:hall.gone_a', 'slots:hall.gone_b']);
});

test('reconcile: step 0 keeps an item the save both holds and uses when no rename merged it', () => {
  // A world that gives one item twice reaches a state that holds it while a lock holds it too; step 0 drops a held id
  // only for an overlap the item map made (two saved ids, one target).
  const saved = at('hall', { held: [it('medal_sun')], used: [it('medal_sun')], slots: { [k('hall.gate')]: [it('medal_sun'), null, null] } });
  const r = reconcile(stamped({ ...manor(), renamed: { hotspots: { [k('hall.sign')]: k('hall.inscription') } } }, V2), saved, MANOR_KNOTS, V1);
  expect([r.state.held, r.state.used, r.dropped]).toEqual([['medal_sun'], ['medal_sun'], []]);
  // As on the same world without `renamed`.
  expect(r.state).toEqual(reconcile(stamped(manor(), V2), saved, MANOR_KNOTS, V1).state);
  // One saved id in both lists that the map renames is still the save's own overlap: it moves, nothing drops.
  const star = at('hall', { held: [it('medal_star')], used: [it('medal_star')], slots: { [k('hall.gate')]: [null, null, it('medal_star')] } });
  const moved = reconcile(stamped({ ...manor({ star: 'medal_comet' }), renamed: { items: { [it('medal_star')]: it('medal_comet') } } }, V2), star, MANOR_KNOTS, V1);
  expect([moved.state.held, moved.state.used, moved.state.slots, moved.dropped]).toEqual([['medal_comet'], ['medal_comet'], { 'hall.gate': [null, null, 'medal_comet'] }, []]);
});

test('reconcile: a lost lock with two items gives both back', () => {
  const r = reconcile(stamped(manor(), V2), at('hall', { used: [it('medal_sun'), it('medal_moon')], slots: { [k('hall.gone')]: [it('medal_sun'), it('medal_moon')] } }), MANOR_KNOTS, V1);
  expect([r.state.held, r.state.used, r.state.slots, r.dropped]).toEqual([['medal_sun', 'medal_moon'], [], {}, ['slots:hall.gone']]);
});

test('reconcile: a slot key merged away gives back every item of its cells but the one a kept cell holds', () => {
  const w = stamped({ ...manor({ star: 'medal_comet' }), renamed: { items: { [it('medal_old')]: it('medal_comet'), [it('medal_star')]: it('medal_comet') }, hotspots: { [k('hall.gate_old')]: k('hall.gate') } } }, V2);
  const r = reconcile(w, at('hall', { used: [it('medal_old'), it('medal_star'), it('medal_moon')], slots: { [k('hall.gate')]: [null, null, it('medal_star')], [k('hall.gate_old')]: [it('medal_old'), it('medal_moon'), null] } }), MANOR_KNOTS, V1);
  expect([r.state.held, r.state.used, r.state.slots, r.dropped]).toEqual([['medal_moon'], ['medal_comet'], { 'hall.gate': [null, null, 'medal_comet'] }, ['slots:hall.gate_old']]);
});

test('reconcile: a lost cell of an item the save also holds leaves it once in held and out of used', () => {
  const r = reconcile(stamped(manor(), V2), at('hall', { held: [it('medal_sun')], used: [it('medal_sun')], slots: { [k('hall.gone')]: [it('medal_sun')] } }), MANOR_KNOTS, V1);
  expect([r.state.held, r.state.used, r.state.slots, r.dropped]).toEqual([['medal_sun'], [], {}, ['slots:hall.gone']]);
});

test('reconcile: step 0 drops a held id that is already the target of a rename it merges with a used id', () => {
  const w = stamped({ ...manor({ star: 'medal_comet', renamedIds: true }), renamed: { items: { [it('medal_old')]: it('medal_comet'), [it('medal_star')]: it('medal_comet') } } }, V2);
  const r = reconcile(w, at('hall', { held: [it('medal_comet')], used: [it('medal_old')], slots: { [k('hall.gate')]: [null, null, it('medal_old')] } }, 'estate'), MANOR_KNOTS, V1);
  expect([r.state.held, r.state.used, r.state.slots, r.dropped]).toEqual([[], ['medal_comet'], { 'hall.gate': [null, null, 'medal_comet'] }, ['held:medal_comet']]);
});

test('reconcile: unprovable state restarts the section', () => {
  const v1 = manor();
  const v2 = stamped(manor({ leverCellar: true }), V2);
  // In the cellar, which v2 reaches only through a lever-opened door this save never opened.
  const s = run(v1, EMPTY_WORLD_STATE, enterAction('manor'), tap('hall.to_cellar'), returned('manor'), tap('cellar.star')).state;
  expect(inSectionReach(v2, s, MANOR, RESUME_STATE_CAP)).toBe('no');
  const r = reconcile(v2, s, MANOR_KNOTS, V1);
  // The load searches nothing (engine plan §3.4): the section restarts at its first entry.
  expect(r.reset).toBeNull();
  expect(r.state.unproved).toEqual(['manor']);
  const a = admitSection(v2, frozen(r.state), MANOR);
  expect(kernelEffects(a.effects)[0]).toEqual({ kind: 'reset', section: 'manor' });
  expect(a.state.held).toEqual([]);
  expect(a.state.taken).toEqual([]);
  expect(a.state.fired).toEqual([]);
  expect(a.state).toEqual(sectionEntry(v2, EMPTY_WORLD_STATE, MANOR));
});

/** The round-2 triage world: a lever opens the vault in v1; in v2 the altar does, and the vault has a shrine. */
function temple(version: 1 | 2): WorldPublicBody {
  return world({
    items: ['k', 'g'],
    sections: {
      temple: {
        start: 'hall',
        rooms: {
          hall: room([
            ...(version === 1 ? [object('lever', null, [{ unlock: 'hall.to_vault' }])] : []),
            take('key', { item: 'k' }),
            object('altar', lock(['k']), version === 1 ? [{ give: 'g' }] : [{ give: 'g' }, { unlock: 'hall.to_vault' }]),
            exit('gate', { story: 'temple_out' }, lock(['g'])),
            exit('to_vault', 'vault', lock([])),
          ]),
          vault: room([exit('to_hall', 'hall'), ...(version === 2 ? [object('shrine', lock(['k']))] : [])]),
        },
      },
    },
  });
}

test('reconcile: a dead end reachable from the reconciled state restarts the section', () => {
  const TEMPLE = sec('temple');
  const s = run(temple(1), EMPTY_WORLD_STATE, enterAction('temple'), tap('hall.lever')).state;
  expect(s.open).toEqual(['hall.to_vault']);
  const v2 = stamped(temple(2), V2);
  const r = reconcile(v2, s, new Set([kn('temple_out')]), V1);
  expect(r.reset).toBeNull();
  expect(r.dropped).toEqual(['fired:then:hall.lever']);
  // Kept as saved until the section's first entry proves it.
  expect(r.state.section).toBe('temple');
  expect(r.state.open).toEqual(['hall.to_vault']);
  expect(r.state.unproved).toEqual(['temple']);
  const a = admitSection(v2, frozen(r.state), TEMPLE);
  expect(kernelEffects(a.effects)[0]).toEqual({ kind: 'reset', section: 'temple' });
  expect(a.state.open).toEqual([]);
  // The restart is the state the build proved.
  expect(a.state).toEqual(sectionEntry(v2, EMPTY_WORLD_STATE, TEMPLE));
});

test("reconcile: reset section fires the start room's onEnter on resume", () => {
  const crypt = (version: 1 | 2): WorldPublicBody =>
    world({
      items: ['torch'],
      sections: {
        crypt: {
          start: 'tomb',
          rooms: {
            tomb: room(
              [...(version === 1 ? [take('torch', { item: 'torch' })] : []), exit('out', { story: 'crypt_out' }, lock(['torch']))],
              version === 2 ? [{ give: 'torch' }] : [],
            ),
          },
        },
      },
    });
  const s = run(crypt(1), EMPTY_WORLD_STATE, enterAction('crypt'), tap('tomb.torch')).state;
  const v2 = stamped(crypt(2), V2);
  const r = reconcile(v2, s, new Set([kn('crypt_out')]), V1);
  expect(r.reset).toBeNull();
  const resumed = admitSection(v2, frozen(r.state), sec('crypt'));
  expect(kernelEffects(resumed.effects)).toContainEqual({ kind: 'got', gift: { item: 'torch' }, at: null });
  expect(resumed.state.held).toEqual(['torch']);
  expect(kernelEffects(resumed.effects)[0]).toEqual({ kind: 'reset', section: 'crypt' });
  expect(kernelEffects(resumed.effects)[1]).toEqual({ kind: 'room', room: 'tomb', sfx: null, from: null, via: null, how: 'enter' });
  expect(exitable(v2, resumed.state, sec('crypt'))).toBe(true);
});

/** The round-3 triage world: a lever (v1) or the key's own `then` (v2) opens the vault; v2 locks the way back. */
function house(version: 1 | 2, withYard = false): WorldPublicBody {
  return world({
    items: ['k'],
    sections: {
      house: {
        start: 'hall',
        rooms: {
          hall: room([
            exit('to_vault', 'vault', lock([])),
            exit('to_garden', { story: 'garden' }),
            ...(version === 1 ? [object('lever', null, [{ unlock: 'hall.to_vault' }])] : []),
            take('k', { item: 'k' }, version === 2 ? [{ unlock: 'hall.to_vault' }] : []),
          ]),
          vault: room([exit('to_hall', 'hall', version === 2 ? lock(['k']) : null)]),
        },
      },
      ...(withYard ? { yard: { start: 'yard', rooms: { yard: room([exit('out', { story: 'yard_out' })]) } } } : {}),
    },
  });
}
const HOUSE_KNOTS: ReadonlySet<KnotName> = new Set(['garden', 'yard_out'].map(kn));

test('reconcile: a section left through a leave restarts on re-entry after a version change', () => {
  const HOUSE = sec('house');
  const s = run(house(1), EMPTY_WORLD_STATE, enterAction('house'), tap('hall.lever'), tap('hall.to_garden')).state;
  expect(s.section).toBeNull();
  expect(s.open).toEqual(['hall.to_vault']);
  const v2 = stamped(house(2), V2);
  const r = reconcile(v2, s, HOUSE_KNOTS, V1);
  expect(r.reset).toBeNull();
  const admitted = admitSection(v2, frozen(r.state), HOUSE);
  expect(kernelEffects(admitted.effects)[0]).toEqual({ kind: 'reset', section: 'house' });
  expect(admitted.state.open).not.toContain('hall.to_vault');
  expect(admitted.state).toEqual(sectionEntry(v2, EMPTY_WORLD_STATE, HOUSE));
  expect(admitted.state.unproved).toEqual([]);
  expect(r.state.unproved).toEqual(['house']);
  // Once proved, the section is entered by reduce alone.
  const again = admitSection(v2, frozen({ ...admitted.state, section: null }), HOUSE);
  expect(kernelEffects(again.effects)).not.toContainEqual({ kind: 'reset', section: 'house' });
});

test('reconcile: a version change marks every other section unproved and keeps the current section and room', () => {
  const s = run(house(1, true), EMPTY_WORLD_STATE, enterAction('house'), tap('hall.lever'), tap('hall.to_garden'), enterAction('yard')).state;
  expect(s.section).toBe('yard');
  const v2 = stamped(house(2, true), V2);
  const r = reconcile(v2, s, HOUSE_KNOTS, V1);
  // The current section is marked too: its proof waits for its first entry like every other's (engine plan §3.4).
  expect(r.state.unproved).toEqual(['house', 'yard']);
  expect(r.reset).toBeNull();
  expect(r.state.section).toBe('yard');
  expect(r.state.room).toBe('yard');
  // The house progress waits for its proof at the next entry.
  expect(r.state.open).toEqual(['hall.to_vault']);
  const admitted = admitSection(v2, frozen({ ...r.state, section: null }), sec('house'));
  expect(kernelEffects(admitted.effects)[0]).toEqual({ kind: 'reset', section: 'house' });
});

test('reconcile: a re-versioned save leaves every section unproved', () => {
  // A save the new world can produce: only `unproved` changes, the current section included.
  const provable = reconcile(stamped(manor(), V2), at('hall'), MANOR_KNOTS, V1);
  expect(provable.state.unproved).toEqual(['manor']);
  expect(provable.reset).toBeNull();
  expect([provable.state.section, provable.state.room]).toEqual(['manor', 'hall']);
  // One it cannot (the cellar behind v2's lever door): the load keeps it as saved and searches nothing.
  const v2 = stamped(manor({ leverCellar: true }), V2);
  const s = run(manor(), EMPTY_WORLD_STATE, enterAction('manor'), tap('hall.to_cellar'), returned('manor'), tap('cellar.star')).state;
  const r = reconcile(v2, s, MANOR_KNOTS, V1);
  expect(r.reset).toBeNull();
  expect([r.state.section, r.state.room]).toEqual(['manor', 'cellar']);
  expect(r.state.unproved).toEqual(['manor']);
});

const fl = (s: string) => s as FlagId; // a fixture flag id

test('reconcile: a saved work goes only with a puzzle the world lost', () => {
  // Engine plan §5.2: a run's `work` is part of its run, so it stays with a kept puzzle and goes with a lost one;
  // `flags` pass (the flags module's own normalize drops theirs).
  const kept: PuzzleRun = { outcome: null, attempts: 1, hintsOpened: 0, work: [2, 0] };
  const lost: PuzzleRun = { outcome: 'solved', attempts: 0, hintsOpened: 0, work: [1] };
  const s = at('study', { puzzles: { [pz('drawer')]: kept, [pz('safe')]: lost }, flags: [fl('fl_a')] });
  const r = reconcile(stamped(manor(), V2), s, MANOR_KNOTS, V1);
  expect(r.state.puzzles).toEqual({ drawer: kept });
  expect(r.dropped).toEqual(['puzzles:safe']);
  expect(r.state.flags).toEqual(['fl_a']);
});

test('search: work and flags stay outside the section key', () => {
  // Engine plan §5.2: a device's working configuration and the flags are no part of the proof key.
  const w = manor();
  const s = at('study', { puzzles: { [pz('drawer')]: { outcome: null, attempts: 1, hintsOpened: 0 } } });
  const key = sectionKey(w, s, MANOR);
  expect(sectionKey(w, frozen({ ...s, puzzles: { [pz('drawer')]: { outcome: null, attempts: 1, hintsOpened: 0, work: [2, 0] } } }), MANOR)).toBe(key);
  expect(sectionKey(w, frozen({ ...s, flags: [fl('fl_a')] }), MANOR)).toBe(key);
});

// ---------------------------------------------------------------------------------------------------------------
// PE7: the rules golden. A rules edit that changes any edge of this fixture's section graph must bump RULES_VERSION
// and add its row, so every world's version changes and old saves go through reconcile. Rows are append-only.

const GOLDEN: Readonly<Record<number, { states: number; digest: string }>> = {
  1: { states: 1637, digest: 'd7c827dd' },
};

/** FNV-1a, 32 bit, hex (test-local: the app program has no node types). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

test('reduce: rules golden pinned to RULES_VERSION', () => {
  const w = manor({ golden: true });
  const start = sectionEntry(w, EMPTY_WORLD_STATE, MANOR);
  const keys: string[] = [sectionKey(w, start, MANOR)];
  const reached: WorldState[] = [start];
  const lines: string[] = [];
  const r = searchSection(w, start, MANOR, RESUME_STATE_CAP, {
    onEdge: (from, succ, to, isNew) => {
      if (isNew && to !== null) {
        keys[to] = sectionKey(w, succ.state, MANOR);
        reached.push(succ.state);
      }
      lines.push(`${keys[from] ?? '?'}\t${JSON.stringify(succ.step)}\t${to === null ? 'LEAVE' : (keys[to] ?? '?')}`);
    },
  });
  expect(r.result).toBe('exhausted');
  const got = { states: r.states, digest: fnv1a(lines.sort().join('\n')) };
  const pinned = GOLDEN[RULES_VERSION];
  if (pinned?.states !== got.states || pinned.digest !== got.digest) {
    expect.fail(`rules changed: bump RULES_VERSION and add a row (expected ${JSON.stringify(pinned)} got ${JSON.stringify(got)})`);
  }
  // X9's start premise: re-entering S from any state play reaches gives the state the build started from.
  const off = reached.filter((s) => sectionKey(w, sectionEntry(w, s, MANOR), MANOR) !== keys[0]);
  expect(off.length, `the first: ${off.slice(0, 2).map((s) => sectionKey(w, s, MANOR)).join(' / ')}`).toBe(0);
});

/** Each list field with its members' fact kind (the writer's `FACT_OF`, restated as the oracle's). */
const LIST_FACTS = [
  ['visited', 'visited'],
  ['held', 'held'],
  ['used', 'used'],
  ['docs', 'doc'],
  ['taken', 'taken'],
  ['examined', 'examined'],
  ['open', 'open'],
  ['fired', 'fired'],
  ['pendingStory', 'story'],
] as const;

/** The fact changes from `a` to `b` as `kind:id:change`, sorted: every non-silent field's diff. */
function factDiff(a: WorldState, b: WorldState): string[] {
  const out: string[] = [];
  for (const [field, kind] of LIST_FACTS) {
    const before: readonly string[] = a[field];
    const after: readonly string[] = b[field];
    out.push(...before.filter((x) => !after.includes(x)).map((x) => `${kind}:${x}:removed`));
    out.push(...after.filter((x) => !before.includes(x)).map((x) => `${kind}:${x}:added`));
  }
  const filled = (c: ReadonlyArray<ItemId | null>): number => c.filter((x) => x !== null).length;
  for (const key of new Set([...Object.keys(a.slots), ...Object.keys(b.slots)]) as Set<HotspotKey>) {
    const before = own(a.slots, key) ?? [];
    const after = own(b.slots, key) ?? [];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out.push(`slot:${key}:${filled(after) >= filled(before) ? 'added' : 'removed'}`);
    }
  }
  for (const p of new Set([...Object.keys(a.puzzles), ...Object.keys(b.puzzles)]) as Set<PuzzleLocalId>) {
    const [x, y] = [runOf(a, p), runOf(b, p)];
    if (x.outcome !== y.outcome) {
      out.push(...(x.outcome === null ? [] : [`${x.outcome}:${p}:removed`]), ...(y.outcome === null ? [] : [`${y.outcome}:${p}:added`]));
    }
    if (x.attempts !== y.attempts) {
      out.push(`attempt:${p}:${y.attempts > x.attempts ? 'added' : 'removed'}`);
    }
    if (x.hintsOpened !== y.hintsOpened) {
      out.push(`hint:${p}:${y.hintsOpened > x.hintsOpened ? 'added' : 'removed'}`);
    }
  }
  // Any other field that changed has no fact kind: the oracle names it, so a new field cannot pass unseen.
  const known = new Set<string>([...LIST_FACTS.map(([f]) => f), 'slots', 'puzzles', ...Object.keys(SILENT_FIELDS)]);
  for (const field of Object.keys(b) as Array<keyof WorldState>) {
    if (!known.has(field) && JSON.stringify(a[field]) !== JSON.stringify(b[field])) {
      out.push(`${field}:?:unrecorded`);
    }
  }
  return out.sort();
}

test('writer: every fact write emits a fact cue with its cause', () => {
  const w = manor({ golden: true });
  const ix = worldIndex(w);
  const start = sectionEntry(w, EMPTY_WORLD_STATE, MANOR);
  const reached: WorldState[] = [start];
  searchSection(w, start, MANOR, RESUME_STATE_CAP, {
    onEdge: (_from, succ, to, isNew) => {
      if (isNew && to !== null) {
        reached.push(succ.state);
      }
    },
  });
  // The cause each step's fact cues carry: the action's verb and hotspot (a puzzle's run: its lock).
  const lockOfRun = (p: PuzzleLocalId): HotspotKey | null => ix.puzzleLock.get(p) ?? null;
  const causeOf = (a: SectionAction): string => {
    switch (a.kind) {
      case 'tap':
        return `tap@${a.hotspot}`;
      case 'insert':
        return `insert@${a.hotspot}`;
      case 'use':
        return `use@${a.target}`;
      case 'enter-section':
        return 'enter@null';
      case 'event-returned':
        return 'return@null';
      case 'puzzle-ended':
        return `${a.outcome === 'solved' ? 'solve' : 'fail'}@${String(lockOfRun(a.puzzle))}`;
      default:
        return `fail@${String('puzzle' in a ? lockOfRun(a.puzzle) : null)}`;
    }
  };
  const problems: string[] = [];
  let cues = 0;
  const check = (s: WorldState, a: SectionAction): ReturnType<typeof reduce> => {
    const r = reduce(w, s, a);
    const facts = r.effects.flatMap((e) => (e.kind === 'cue' && e.cue.kind === 'fact' ? [e.cue] : []));
    cues += facts.length;
    const got = facts.map((c) => `${c.fact.kind}:${c.fact.id}:${c.change}`).sort();
    const want = factDiff(s, r.state);
    const label = `${a.kind} ${'hotspot' in a ? a.hotspot : 'target' in a ? a.target : 'puzzle' in a ? a.puzzle : 'section' in a ? a.section : ''}`;
    problems.push(...want.filter((x) => !got.includes(x)).map((x) => `${label}: fact:${x} missing`));
    problems.push(...got.filter((x) => !want.includes(x)).map((x) => `${label}: fact:${x} extra`));
    problems.push(...facts.filter((c) => `${c.cause.verb}@${String(c.cause.at)}` !== causeOf(a)).map((c) => `${label}: cause ${c.cause.verb}@${String(c.cause.at)}`));
    return r;
  };
  check({ ...EMPTY_WORLD_STATE, unproved: [] }, { kind: 'enter-section', section: MANOR });
  for (const s of reached) {
    for (const a of MECHANIC_RULES.flatMap((m): readonly SectionAction[] => m.actions(w, s))) {
      const r = check(s, a);
      const opened = r.effects.find((e) => e.kind === 'puzzle');
      if (opened !== undefined) {
        check(r.state, ended(opened.puzzle, 'solved'));
        check(r.state, ended(opened.puzzle, 'failed'));
      }
    }
    // A run's attempt and hint (O1: no search edge takes them).
    for (const p of ['drawer', 'gate'].map(pz)) {
      check(s, { kind: 'attempt-failed', puzzle: p });
      check(s, { kind: 'hint-opened', puzzle: p, tier: runOf(s, p).hintsOpened + 1 });
    }
  }
  expect(problems.slice(0, 5)).toEqual([]);
  // The positive control: the walk saw every state and many fact cues.
  expect([reached.length, cues > reached.length]).toEqual([GOLDEN[RULES_VERSION]?.states, true]);
});

// ---------------------------------------------------------------------------------------------------------------
// The derived section key (engine plan §3.2, §12 GM1b commit 3): built from every module's `reads`, byte for byte the
// hand-written key while core is the only module (the golden above hashes key strings).

/** The hand-written key of the searches before the registry (mechanics/rules/search.ts at ef8b4dc): the oracle. */
function handKey(w: WorldPublicBody, s: WorldState, section: SectionId): string {
  const scope = sectionScope(w, section);
  const part = <T extends string>(list: readonly T[], keep: ReadonlySet<T>): string => {
    const members = list.filter((x) => keep.has(x));
    return members.length > 1 ? members.sort().join(',') : (members[0] ?? '');
  };
  const slots: string[] = [];
  for (const { key, lock: l } of scope.locks) {
    const stored = own(s.slots, key);
    if (stored !== undefined && stored.some((c) => c !== null)) {
      slots.push(`${key}=${l.slots.map((_, i) => stored[i] ?? '').join(',')}`);
    }
  }
  return [
    s.room ?? '',
    s.pendingStory.join(','),
    part(s.taken, scope.hotspots),
    part(s.open, scope.hotspots),
    slots.join(';'),
    part(s.fired, scope.fired),
    scope.puzzles.map((p) => runOf(s, p).outcome ?? '').join(','),
    part(s.held, scope.items),
    part(s.used, scope.items),
    part(s.docs, scope.docs),
  ].join('|');
}

/** Every chapter's source world (story/<ch>/world.json), as the story tool reads it. */
const STORY_WORLDS = import.meta.glob<string>('../../../story/*/world.json', { eager: true, query: '?raw', import: 'default' });

const [CORE] = MECHANIC_RULES;
/** A fixture module that only reads: its `reads` returns `atoms` in every section. */
const reader = (...atoms: FactAtom[]): MechanicRules<'reader', never, never> => ({
  id: 'reader',
  actions: () => [],
  apply: () => undefined,
  reads: () => atoms,
  cues: [],
});

test('search: derived sectionKey equals the hand key on ch1 and ch2', () => {
  const chapters = Object.entries(STORY_WORLDS).map(([path, text]): [string, WorldPublicBody] => {
    const r = decodeWorldSource(JSON.parse(text));
    if (!r.ok) {
      throw new Error(`invariant: ${path} decodes: ${JSON.stringify(r.error)}`);
    }
    return [path.replace('../../../', ''), toPublic(r.value)];
  });
  expect(chapters.map(([path]) => path)).toEqual(expect.arrayContaining(['story/ch1/world.json', 'story/ch2/world.json']));
  // Every state each section's search discovers, in every chapter and in the golden fixture. No count of story content
  // is pinned here (the story gate prints those): the two keys must split the states alike, and some must be seen.
  let searched = 0;
  for (const [path, w] of [...chapters, ['the golden manor fixture', manor({ golden: true })] as const]) {
    const sections = Object.keys(w.sections) as SectionId[];
    if (sections.length === 0) {
      console.log(`sectionKey pin: ${path} has no section`);
    }
    for (const S of sections) {
      const start = sectionEntry(w, EMPTY_WORLD_STATE, S);
      const reached: WorldState[] = [start];
      const r = searchSection(w, start, S, RESUME_STATE_CAP, {
        onEdge: (_from, succ, to, isNew) => {
          if (isNew && to !== null) {
            reached.push(succ.state);
          }
        },
      });
      const off = reached.filter((s) => sectionKey(w, s, S) !== handKey(w, s, S));
      expect(off.slice(0, 2).map((s) => `${sectionKey(w, s, S)} / ${handKey(w, s, S)}`), `${path} ${S}`).toEqual([]);
      expect(new Set(reached.map((s) => handKey(w, s, S))).size, `${path} ${S}`).toBe(r.states);
      searched += r.states;
    }
  }
  expect(searched).toBeGreaterThan(0);
  // The key is the registry's: a module that reads one more fact splits the states that differ in it.
  const w = manor();
  const s = at('hall');
  const turned = frozen({ ...s, fired: ['turn:hall.inscription'] });
  expect(sectionKey(w, turned, MANOR)).toBe(sectionKey(w, s, MANOR));
  const registry = [CORE, reader({ kind: 'fired', id: 'turn:hall.inscription' })];
  expect(sectionKey(w, turned, MANOR, registry)).not.toBe(sectionKey(w, s, MANOR, registry));
});

test("search: a module's read of every kernel fact kind enters the derived key", () => {
  // Core reads 8 of the 15 kernel kinds. Each other kind a module may read has its rule: `examined`, `visited`,
  // `attempt` and `hint` add a part (only when some module reads them, so core's key stays byte-identical); `failed` /
  // `abandoned` name a puzzle whose whole outcome joins the outcome part; `story` adds nothing, since the queue is
  // always in the key; a kind with no kernel storage is a bug and throws.
  const w = world({
    items: ['key'],
    puzzles: { lin: code(2, 2), lk: code(2) },
    sections: {
      s: { start: 'r', rooms: { r: room([look('glass'), object('box', lock(['key'], 'lk')), exit('out', { story: 'end' })]), r2: room([exit('back', 'r')]) } },
    },
  });
  const S = sec('s');
  const s = at('r', {}, 's');
  const cases: ReadonlyArray<readonly [FactAtom, Partial<WorldState>]> = [
    [{ kind: 'examined', id: 'r.glass' }, { examined: [k('r.glass')] }],
    [{ kind: 'visited', id: 'r2' }, { visited: [rm('r'), rm('r2')] }],
    [{ kind: 'attempt', id: 'lk' }, { puzzles: { [pz('lk')]: { outcome: null, attempts: 1, hintsOpened: 0 } } }],
    [{ kind: 'hint', id: 'lin' }, { puzzles: { [pz('lin')]: { outcome: null, attempts: 0, hintsOpened: 1 } } }],
    [{ kind: 'failed', id: 'lin' }, { puzzles: { [pz('lin')]: { outcome: 'failed', attempts: 0, hintsOpened: 0 } } }],
    [{ kind: 'abandoned', id: 'lin' }, { puzzles: { [pz('lin')]: { outcome: 'abandoned', attempts: 0, hintsOpened: 0 } } }],
  ];
  for (const [atom, patch] of cases) {
    const t = frozen({ ...s, ...patch });
    expect(sectionKey(w, t, S), atom.kind).toBe(sectionKey(w, s, S));
    const registry = [CORE, reader(atom)];
    expect(sectionKey(w, t, S, registry), atom.kind).not.toBe(sectionKey(w, s, S, registry));
  }
  // Read by core already: a module's `failed` of a lock puzzle changes no key, nor does `story`.
  const queued = frozen({ ...s, pendingStory: [kn('x')] });
  for (const atom of [{ kind: 'failed', id: 'lk' }, { kind: 'story', id: 'x' }] as const) {
    for (const t of [s, queued]) {
      expect(sectionKey(w, t, S, [CORE, reader(atom)]), atom.kind).toBe(sectionKey(w, t, S));
    }
  }
  expect(() => sectionKey(w, s, S, [CORE, reader({ kind: 'flag' as FactKind, id: 'lit' })])).toThrow(/invariant/);
});

/** mulberry32 (test-local): a seeded generator, so a red names a reproducible state. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('search: equal section keys have equal successor keys', () => {
  // Soundness of the key both searches deduplicate by: two states with one key have the same steps to the same keys.
  // Each random state comes with twins: one that differs only in what the key abstracts (examined, visited, attempts,
  // hints, lastRoom, unproved, list order, another section's facts), so pairs with one key always exist; and one per
  // fact kind the key reads, toggling one fact of S, so a key that drops a kind merges a pair whose steps differ (held,
  // taken, open, slot, fired and solved gate a rule; used and doc gate none, so the pin above is their guard).
  const w = manor({ golden: true });
  const ix = worldIndex(w);
  const scope = sectionScope(w, MANOR);
  const rooms = [...scope.rooms];
  const hotspots = [...scope.hotspots];
  const takes = hotspots.filter((key) => ix.hotspots.get(key)?.hotspot.kind === 'take');
  const items = [...scope.items];
  const docs = [...scope.docs];
  const fired = [...scope.fired];
  const lockKeys = scope.locks.map((l) => l.key);
  const slotted = scope.locks.filter((l) => l.lock.slots.length > 0);
  const knots = ['manor_cellar_voice', 'drawer_open'].map(kn);
  const lines = (s: WorldState): string =>
    successors(w, s)
      .map((x) => `${JSON.stringify(x.step)}\t${x.leaves ? 'LEAVE' : sectionKey(w, x.state, MANOR)}`)
      .sort()
      .join('\n');
  const toggled = <T>(list: readonly T[], x: T): T[] => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  let compared = 0;
  for (const seed of [1, 2, 3, 4]) {
    const rnd = mulberry32(seed);
    const some = <T>(xs: readonly T[]): T[] => xs.filter(() => rnd() < 0.5);
    const pick = <T>(xs: readonly T[]): T => {
      const x = xs[Math.floor(rnd() * xs.length)];
      if (x === undefined) {
        throw new Error('invariant: a pick from a non-empty list');
      }
      return x;
    };
    const groups = new Map<string, string>();
    const visit = (s: WorldState): void => {
      const key = sectionKey(w, s, MANOR);
      const got = lines(s);
      const first = groups.get(key);
      if (first === undefined) {
        groups.set(key, got);
      } else {
        compared++;
        expect(got, `seed ${seed}, key ${key}`).toBe(first);
      }
    };
    for (let n = 0; n < 200; n++) {
      const slots: Record<HotspotKey, Array<ItemId | null>> = {};
      for (const { key, lock: l } of slotted) {
        if (rnd() < 0.6) {
          slots[key] = l.slots.map((slot) => (rnd() < 0.5 ? slot.accepts : null));
        }
      }
      const runs: Record<PuzzleLocalId, { outcome: 'solved' | 'failed' | null; attempts: number; hintsOpened: number }> = {};
      for (const p of scope.puzzles) {
        if (rnd() < 0.6) {
          runs[p] = { outcome: pick(['solved', 'failed', null] as const), attempts: 0, hintsOpened: 0 };
        }
      }
      const s: WorldState = frozen({
        ...structuredClone(EMPTY_WORLD_STATE),
        section: MANOR,
        room: pick(rooms),
        held: some(items),
        used: some(items),
        docs: some(docs),
        taken: some(hotspots),
        slots,
        open: some(lockKeys),
        fired: some(fired),
        pendingStory: rnd() < 0.2 ? [pick(knots)] : [],
        puzzles: runs,
      });
      visit(s);
      // What the key abstracts.
      visit(
        frozen({
          ...s,
          lastRoom: { [MANOR]: pick(rooms), [sec('yard')]: rm('yard') },
          visited: some(rooms),
          examined: some(hotspots),
          held: [...s.held].reverse().concat([it('yard_coin')]),
          used: [...s.used].reverse(),
          docs: [...s.docs].reverse(),
          taken: [...s.taken].reverse().concat([k('yard.chest')]),
          open: [...s.open].reverse(),
          fired: [...s.fired].reverse().concat(['enter:yard']),
          puzzles: Object.fromEntries(scope.puzzles.map((p) => [p, { ...runOf(s, p), attempts: pick([0, 1, 2]), hintsOpened: pick([0, 1, 2]) }])),
          unproved: [MANOR],
        }),
      );
      // One fact of each kind the key reads.
      const slot = pick(slotted);
      const cell = Math.floor(rnd() * slot.lock.slots.length);
      const cells = slot.lock.slots.map((x, i) => {
        const c = own(s.slots, slot.key)?.[i] ?? null;
        return i !== cell ? c : c === null ? x.accepts : null;
      });
      const p = pick(scope.puzzles);
      const patches: Array<Partial<WorldState>> = [
        { held: toggled(s.held, pick(items)) },
        { used: toggled(s.used, pick(items)) },
        { docs: toggled(s.docs, pick(docs)) },
        { taken: toggled(s.taken, pick(takes)) },
        { open: toggled(s.open, pick(lockKeys)) },
        { fired: toggled(s.fired, pick(fired)) },
        { slots: { ...s.slots, [slot.key]: cells } },
        { puzzles: { ...s.puzzles, [p]: { ...runOf(s, p), outcome: runOf(s, p).outcome === null ? 'solved' : null } } },
      ];
      for (const patch of patches) {
        visit(frozen({ ...s, ...patch }));
      }
    }
  }
  // Every random state's abstract twin shares its key, so at least that many pairs were compared.
  expect(compared).toBeGreaterThanOrEqual(4 * 200);
}, 60_000);
