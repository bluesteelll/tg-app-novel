import { expect, test } from 'vitest';

import type { KnotName, PuzzleLocalId, SectionId, VarName } from '../story/staging.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { DocId, HotspotKey, ItemId, RoomId, WorldPublic, WorldPublicBody } from '../world/types.ts';
import { project } from './project.ts';
import { admitSection, inSectionReach, reconcile, searchSection, sectionEntry } from './reconcile.ts';
import { RESUME_STATE_CAP, RULES_VERSION, actions, reduce, sectionKey, successors } from './reduce.ts';
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

type ManorVariant = {
  /** The gate's slot order (the puzzle's pieces stay MEDALS). */
  gate?: string[];
  /** The id of the cellar's medallion (a v2 rename). */
  star?: string;
  /** v2: the cellar door is a zero-slot lock that a lever in the study unlocks. */
  leverCellar?: boolean;
  /** The golden fixture: the drawer's onOpen and then stories, a take's then, a remote unlock of an object. */
  golden?: boolean;
};

/** The demo section of PUZZLES-PLAN "Demo content outline" (ch1 `manor`), and its v2 edits. */
function manor(v: ManorVariant = {}): WorldPublicBody {
  const star = v.star ?? 'medal_star';
  const medals = ['medal_sun', 'medal_moon', star];
  const golden = v.golden === true;
  return world({
    items: medals,
    docs: ['letter', 'diary'],
    puzzles: { drawer: code(4), gate: order(medals, 3) },
    sections: {
      manor: {
        start: 'hall',
        rooms: {
          hall: room([
            exit('to_study', 'study', null, 'door'),
            exit('to_cellar', 'cellar', v.leverCellar === true ? lock([]) : null),
            exit('gate', { story: 'manor_out' }, lock(v.gate ?? medals, 'gate', [{ story: 'manor_gate_forced' }, { unlock: 'hall.gate' }])),
            look('inscription'),
          ]),
          study: room([
            take('medal', { item: 'medal_sun' }),
            object(
              'drawer',
              lock([], 'drawer', [], golden ? [{ story: 'drawer_open' }] : []),
              golden ? [{ give: 'medal_moon' }, { story: 'drawer_then' }] : [{ give: 'medal_moon' }],
            ),
            take('letter', { doc: 'letter' }, golden ? [{ story: 'letter_read' }] : []),
            ...(golden ? [object('cabinet', lock([]), [{ story: 'cabinet_then' }])] : []),
            ...(v.leverCellar === true ? [object('lever', null, [{ unlock: 'hall.to_cellar' }])] : []),
            exit('to_hall', 'hall'),
          ]),
          cellar: room(
            [
              take('star', { item: star }),
              take('diary', { doc: 'diary' }),
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

test('reconcile: unprovable state restarts the section', () => {
  const v1 = manor();
  const v2 = stamped(manor({ leverCellar: true }), V2);
  // In the cellar, which v2 reaches only through a lever-opened door this save never opened.
  const s = run(v1, EMPTY_WORLD_STATE, enterAction('manor'), tap('hall.to_cellar'), returned('manor'), tap('cellar.star')).state;
  expect(inSectionReach(v2, s, MANOR, RESUME_STATE_CAP)).toBe('no');
  const r = reconcile(v2, s, MANOR_KNOTS, V1);
  expect(r.reset).toBe('manor');
  expect(r.state.section).toBeNull();
  expect(r.state.room).toBeNull();
  expect(r.state.held).toEqual([]);
  expect(r.state.taken).toEqual([]);
  expect(r.state.fired).toEqual([]);
  expect(reduce(v2, frozen(r.state), enterAction('manor')).state).toEqual(sectionEntry(v2, EMPTY_WORLD_STATE, MANOR));
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
  expect(r.reset).toBe('temple');
  expect(r.dropped).toEqual(['fired:then:hall.lever']);
  expect(r.state.section).toBeNull();
  expect(r.state.open).toEqual([]);
  expect(r.state.unproved).toEqual([]);
  // The restart is the state the build proved.
  expect(reduce(v2, frozen(r.state), enterAction('temple')).state).toEqual(sectionEntry(v2, EMPTY_WORLD_STATE, TEMPLE));
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
  expect(r.reset).toBe('crypt');
  const resumed = reduce(v2, frozen(r.state), enterAction('crypt'));
  expect(resumed.effects).toContainEqual({ kind: 'got', gift: { item: 'torch' } });
  expect(resumed.state.held).toEqual(['torch']);
  expect(resumed.effects[0]).toEqual({ kind: 'room', room: 'tomb', sfx: null });
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
  expect(admitted.effects[0]).toEqual({ kind: 'reset', section: 'house' });
  expect(admitted.state.open).not.toContain('hall.to_vault');
  expect(admitted.state).toEqual(sectionEntry(v2, EMPTY_WORLD_STATE, HOUSE));
  expect(admitted.state.unproved).toEqual([]);
  expect(r.state.unproved).toEqual(['house']);
  // Once proved, the section is entered by reduce alone.
  const again = admitSection(v2, frozen({ ...admitted.state, section: null }), HOUSE);
  expect(again.effects).not.toContainEqual({ kind: 'reset', section: 'house' });
});

test('reconcile: a version change marks every other section unproved and keeps the current section and room', () => {
  const s = run(house(1, true), EMPTY_WORLD_STATE, enterAction('house'), tap('hall.lever'), tap('hall.to_garden'), enterAction('yard')).state;
  expect(s.section).toBe('yard');
  const v2 = stamped(house(2, true), V2);
  const r = reconcile(v2, s, HOUSE_KNOTS, V1);
  expect(r.state.unproved).toEqual(['house']);
  expect(r.reset).toBeNull();
  expect(r.state.section).toBe('yard');
  expect(r.state.room).toBe('yard');
  // The house progress waits for its proof at the next entry.
  expect(r.state.open).toEqual(['hall.to_vault']);
  const admitted = admitSection(v2, frozen({ ...r.state, section: null }), sec('house'));
  expect(admitted.effects[0]).toEqual({ kind: 'reset', section: 'house' });
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
