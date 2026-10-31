import { expect, test } from 'vitest';

import type { KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, ItemId, RoomId, WorldPublicBody } from '../world/types.ts';
import { actions, reduce, sectionKey, successors } from './reduce.ts';
import type { ExploreAction, ExploreEffect } from './reduce.ts';
import { EMPTY_WORLD_STATE } from './state.ts';
import type { WorldState } from './state.ts';

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

/** The demo section of PUZZLES-PLAN "Demo content outline" (ch1 `manor`). */
function manor(): WorldPublicBody {
  return world({
    items: MEDALS,
    docs: ['letter', 'diary'],
    puzzles: { drawer: code(4), gate: order(MEDALS, 3) },
    sections: {
      manor: {
        start: 'hall',
        rooms: {
          hall: room([
            exit('to_study', 'study', null, 'door'),
            exit('to_cellar', 'cellar'),
            exit('gate', { story: 'manor_out' }, lock(MEDALS, 'gate', [{ story: 'manor_gate_forced' }, { unlock: 'hall.gate' }])),
            look('inscription'),
          ]),
          study: room([
            take('medal', { item: 'medal_sun' }),
            object('drawer', lock([], 'drawer'), [{ give: 'medal_moon' }]),
            take('letter', { doc: 'letter' }),
            exit('to_hall', 'hall'),
          ]),
          cellar: room(
            [take('star', { item: 'medal_star' }), take('diary', { doc: 'diary' }), exit('to_hall', 'hall')],
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
  expect(r.effects).toEqual([{ kind: 'got', gift: { item: 'medal_sun' } }, DIRTY]);
  const again = reduce(w, frozen(r.state), tap('study.medal'));
  expect(again.state).toBe(r.state);
  expect(again.effects).toEqual([]);
  const doc = reduce(w, frozen(r.state), tap('study.letter'));
  expect(doc.state.docs).toEqual(['letter']);
  expect(doc.state.held).toEqual(['medal_sun']);
});

test('reduce: wrong item refused, state unchanged', () => {
  const w = manor();
  const s = at('hall', { held: [it('medal_sun'), it('medal_moon')] });
  const refused: ExploreEffect[] = [{ kind: 'refused', reason: 'no-fit' }];
  for (const a of [insert('hall.gate', 'medal_star'), insert('hall.to_study', 'medal_sun'), insert('study.drawer', 'medal_sun')]) {
    const r = reduce(w, s, a);
    expect(r.effects, JSON.stringify(a)).toEqual(refused);
    expect(r.state).toBe(s);
  }
  // The positive control: the right held item fills its slot.
  const right = reduce(w, s, insert('hall.gate', 'medal_sun'));
  expect(right.state.slots).toEqual({ 'hall.gate': ['medal_sun', null, null] });
  expect(right.state.held).toEqual(['medal_moon']);
  expect(right.state.used).toEqual(['medal_sun']);
  expect(right.effects).toEqual([DIRTY]);
  // A slot takes one item: the same item again does not fit.
  const twice = reduce(w, frozen({ ...right.state, held: [it('medal_sun')] }), insert('hall.gate', 'medal_sun'));
  expect(twice.effects).toEqual(refused);
});

test('reduce: lock opens after last slot then puzzle', () => {
  const w = manor();
  const s = at('hall', { held: MEDALS.map(it) });
  const two = run(w, s, insert('hall.gate', 'medal_sun'), insert('hall.gate', 'medal_moon'));
  expect(two.effects).toEqual([DIRTY]);
  const last = reduce(w, frozen(two.state), insert('hall.gate', 'medal_star'));
  expect(last.effects).toEqual([{ kind: 'puzzle', puzzle: 'gate', hotspot: 'hall.gate' }, DIRTY]);
  expect(last.state.open).toEqual([]);
  const solved = reduce(w, frozen(last.state), ended('gate', 'solved'));
  expect(solved.state.open).toEqual(['hall.gate']);
  expect(solved.state.puzzles).toEqual({ gate: { outcome: 'solved', attempts: 0, hintsOpened: 0 } });
  const out = reduce(w, frozen(solved.state), tap('hall.gate'));
  expect(out.effects).toEqual([{ kind: 'leave', knot: 'manor_out' }, DIRTY]);
  // A lock without a puzzle opens at its last insert.
  const plain = world({
    items: ['key'],
    sections: { s: { start: 'a', rooms: { a: room([exit('door', { story: 'out' }, lock(['key']))]) } } },
  });
  const opened = reduce(plain, at('a', { held: [it('key')] }, 's'), insert('a.door', 'key'));
  expect(opened.state.open).toEqual(['a.door']);
  expect(opened.effects).toEqual([DIRTY]);
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
  expect(last.effects).toEqual([{ kind: 'puzzle', puzzle: 'gate', hotspot: 'hall.gate' }, DIRTY]);
});

test('reduce: tap on a filled unsolved lock reopens its puzzle', () => {
  const w = manor();
  const filled = at('hall', { slots: { [k('hall.gate')]: MEDALS.map(it) }, used: MEDALS.map(it) });
  const r = reduce(w, filled, tap('hall.gate'));
  expect(r.effects).toEqual([{ kind: 'puzzle', puzzle: 'gate', hotspot: 'hall.gate' }]);
  expect(r.state).toBe(filled);
  // Attempts are kept: the run exists but has no outcome.
  const tried = at('hall', { slots: filled.slots, used: filled.used, puzzles: { [pz('gate')]: { outcome: null, attempts: 2, hintsOpened: 1 } } });
  expect(reduce(w, tried, tap('hall.gate')).effects).toEqual([{ kind: 'puzzle', puzzle: 'gate', hotspot: 'hall.gate' }]);
  // A zero-slot lock counts as filled.
  expect(reduce(w, at('study'), tap('study.drawer')).effects).toEqual([{ kind: 'puzzle', puzzle: 'drawer', hotspot: 'study.drawer' }]);
  // A failed puzzle whose onFail did not unlock shows the panel.
  const failed = at('hall', { slots: filled.slots, used: filled.used, puzzles: { [pz('gate')]: { outcome: 'failed', attempts: 3, hintsOpened: 0 } } });
  expect(reduce(w, failed, tap('hall.gate')).effects).toEqual([{ kind: 'lock', hotspot: 'hall.gate' }]);
});

test('reduce: take runs its then once', () => {
  const w = world({
    items: ['key', 'map'],
    sections: { s: { start: 'a', rooms: { a: room([take('key', { item: 'key' }, [{ give: 'map' }, { story: 'found_key' }]), exit('out', { story: 'end' })]) } } },
  });
  const r = reduce(w, at('a', {}, 's'), tap('a.key'));
  expect(r.effects).toEqual([
    { kind: 'got', gift: { item: 'key' } },
    { kind: 'got', gift: { item: 'map' } },
    { kind: 'story', knot: 'found_key' },
    DIRTY,
  ]);
  expect(r.state.held).toEqual(['key', 'map']);
  expect(r.state.fired).toEqual(['then:a.key']);
  expect(r.state.pendingStory).toEqual(['found_key']);
  const back = run(w, r.state, { kind: 'event-returned', section: sec('s') }, tap('a.key'));
  expect(back.effects).toEqual([]);
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
  expect(chest.effects).toEqual([{ kind: 'story', knot: 'chest_opens' }, DIRTY]);
});

test('reduce: tap while an event is pending is refused', () => {
  const w = manor();
  const busy = at('hall', { pendingStory: [kn('manor_cellar_voice')], held: [it('medal_sun')] });
  for (const a of [tap('hall.to_study'), tap('hall.inscription'), insert('hall.gate', 'medal_sun')]) {
    const r = reduce(w, busy, a);
    expect(r.state, JSON.stringify(a)).toBe(busy);
    expect(r.effects, JSON.stringify(a)).toEqual([]);
  }
  // The positive control: the same tap with no event running moves.
  const idle = reduce(w, at('hall', { held: [it('medal_sun')] }), tap('hall.to_study'));
  expect(idle.state.room).toBe('study');
  expect(idle.effects).toEqual([{ kind: 'room', room: 'study', sfx: 'door' }, DIRTY]);
});

test('reduce: failed runs onFail once', () => {
  const w = manor();
  const filled = at('hall', { slots: { [k('hall.gate')]: MEDALS.map(it) }, used: MEDALS.map(it) });
  const failed = reduce(w, filled, ended('gate', 'failed'));
  expect(failed.state.puzzles).toEqual({ gate: { outcome: 'failed', attempts: 0, hintsOpened: 0 } });
  expect(failed.state.fired).toEqual(['fail:hall.gate']);
  expect(failed.state.pendingStory).toEqual(['manor_gate_forced']);
  expect(failed.state.open).toEqual(['hall.gate']);
  expect(failed.effects).toEqual([{ kind: 'story', knot: 'manor_gate_forced' }, DIRTY]);
  // The outcome is final: a second end changes nothing.
  const again = reduce(w, frozen(failed.state), ended('gate', 'failed'));
  expect(again.state).toBe(failed.state);
  expect(again.effects).toEqual([]);
  // Attempts count while the run is open.
  const tried = run(w, filled, { kind: 'attempt-failed', puzzle: pz('gate') }, { kind: 'attempt-failed', puzzle: pz('gate') });
  expect(tried.state.puzzles).toEqual({ gate: { outcome: null, attempts: 2, hintsOpened: 0 } });
});

test('reduce: onEnter fires once', () => {
  const w = manor();
  const r = reduce(w, at('hall'), tap('hall.to_cellar'));
  expect(r.effects).toEqual([{ kind: 'room', room: 'cellar', sfx: null }, { kind: 'story', knot: 'manor_cellar_voice' }, DIRTY]);
  expect(r.state.fired).toEqual(['enter:cellar']);
  const again = run(w, r.state, { kind: 'event-returned', section: sec('manor') }, tap('cellar.to_hall'), tap('hall.to_cellar'));
  expect(again.effects).toEqual([{ kind: 'room', room: 'cellar', sfx: null }, DIRTY]);
  expect(again.state.pendingStory).toEqual([]);
  // A section entry fires its room's onEnter too.
  const entered = reduce(w, frozen(structuredClone(EMPTY_WORLD_STATE)), { kind: 'enter-section', section: sec('manor') });
  expect(entered.state.section).toBe('manor');
  expect(entered.state.room).toBe('hall');
  expect(entered.effects).toEqual([{ kind: 'room', room: 'hall', sfx: null }, DIRTY]);
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
  expect(one.effects).toEqual([{ kind: 'story', knot: 'second' }, DIRTY]);
  const two = reduce(w, frozen(one.state), { kind: 'event-returned', section: sec('s') });
  expect(two.state.pendingStory).toEqual([]);
  expect(two.effects).toEqual([{ kind: 'room', room: 'a', sfx: null }, DIRTY]);
});

test('reduce: leave clears the section', () => {
  const w = manor();
  const s = at('hall', { open: [k('hall.gate')], fired: ['fail:hall.gate'] });
  const r = reduce(w, s, tap('hall.gate'));
  expect(r.effects).toEqual([{ kind: 'leave', knot: 'manor_out' }, DIRTY]);
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

test('reduce: an action that changes no state keeps its effects', () => {
  const w = manor();
  // A lock with a free slot: the panel opens (the only UI that sends `insert`).
  const hall = at('hall', { held: [it('medal_sun')] });
  const panel = reduce(w, hall, tap('hall.gate'));
  expect(panel.effects).toEqual([{ kind: 'lock', hotspot: 'hall.gate' }]);
  expect(panel.state).toBe(hall);
  // A re-read shows the text again.
  const read = at('hall', { examined: [k('hall.inscription')] });
  const reread = reduce(w, read, tap('hall.inscription'));
  expect(reread.effects).toHaveLength(1);
  expect(reread.effects[0]?.kind).toBe('look');
  expect(reread.state).toBe(read);
  // A resume of the current section re-shows its room.
  const resumed = reduce(w, hall, { kind: 'enter-section', section: sec('manor') });
  expect(resumed.effects).toEqual([{ kind: 'room', room: 'hall', sfx: null }]);
  expect(resumed.state).toBe(hall);
  // A re-read hint tier counts nothing.
  const hinted = at('study', { puzzles: { [pz('drawer')]: { outcome: null, attempts: 0, hintsOpened: 2 } } });
  const reHint = reduce(w, hinted, { kind: 'hint-opened', puzzle: pz('drawer'), tier: 1 });
  expect(reHint.state).toBe(hinted);
  expect(reHint.effects).toEqual([]);
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
    expect(reduce(w, hall, a).effects, JSON.stringify(a)).not.toContainEqual({ kind: 'refused', reason: 'no-fit' });
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
