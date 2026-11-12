// Module `view` (engine plan §6.3): a room with `view: { of }` is a zoom view of its parent, entered through an ordinary
// exit of the parent and left back to it. A move into a view is a zoom-in and a move out of one a zoom-out; `leave-view`
// returns to the parent and is offered only in a view; the soft-lock proof takes it; the data round-trips; and the
// story gate refuses a view entered from elsewhere, a view's exit to a sibling, a chain deeper than two, and a parent of
// another section or of no room. Fixture worlds are written in the source format and decoded with the real registries;
// a proof world carries the decoded `mods`, as the explore controller's and the story gate's do.
import { expect, test } from 'vitest';

import type { WorldLintInput } from '../../scripts/story/mechanics/index.ts';
import { VIEW_LINT } from '../../scripts/story/mechanics/view.ts';
import { checkWorld } from '../../scripts/story/softlock.ts';
import { RESUME_STATE_CAP } from '../explore/reduce.ts';
import type { ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { AssetCatalog } from '../story/catalog.ts';
import type { ChapterId, KnotName, SectionId } from '../story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toPublic } from '../world/decode.ts';
import type { WorldIssue } from '../world/decode.ts';
import type { HotspotKey, RoomId, WorldSource } from '../world/types.ts';
import type { KernelWorld, SectionAction } from './contract.ts';
import { MECHANIC_DATA } from './data/index.ts';
import { reduce } from './rules/core.ts';
import { RESUME_WORK_PER_STATE, inSectionReach, searchSection, sectionEntry, successors } from './rules/search.ts';
import type { SearchStats } from './rules/search.ts';
import { nearRooms, viewActions } from './rules/view.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture worlds, in the source format

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (owner = 'w'): Json => ({ id: `ch1.${owner}.${(lineCounter++).toString(36).padStart(4, '0')}`, ru: owner });
const RECT = [100, 200, 200, 200];
const exit = (id: string, to: string | { story: string }, lock: Json | null = null): Json => ({
  id,
  kind: 'exit',
  rect: RECT,
  label: txt(),
  to: typeof to === 'string' ? { room: to } : to,
  lock,
  sfx: null,
});
const take = (id: string, item: string): Json => ({ id, kind: 'take', rect: RECT, label: txt(), gives: { item }, prop: null, then: [] });
const object = (id: string, extra: Json = {}): Json => ({ id, kind: 'object', rect: RECT, label: txt(), lock: null, then: [], look: null, prop: null, ...extra });
/** A lock without a puzzle whose slots accept `accepts`. */
const lock = (accepts: readonly string[]): Json => ({ slots: accepts.map((a) => ({ accepts: a })), puzzle: null, locked: txt(), onOpen: [], onFail: [] });
const room = (hotspots: readonly Json[], extra: Json = {}): Json => ({ bg: 'room', title: txt(), onEnter: [], hotspots, ...extra });
/** A view of `of`: a room with the module's key. */
const view = (of: string, hotspots: readonly Json[]): Json => room(hotspots, { view: { of } });

/** The source world of `sections` (each `[start, rooms]`), with an item per id of `items`. */
function rawWorld(sections: Readonly<Record<string, readonly [string, Readonly<Record<string, Json>>]>>, items: readonly string[] = []): Json {
  return {
    format: 1,
    items: Object.fromEntries(items.map((id) => [id, { name: txt(id), desc: txt(id), glyph: 'key' }])),
    docs: {},
    puzzles: {},
    sections: Object.fromEntries(Object.entries(sections).map(([id, [start, rooms]]) => [id, { start, bgm: null, rooms }])),
  };
}

function source(raw: Json): WorldSource {
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** The proof world: the public body with the decoded `mods`. */
const kernel = (src: WorldSource): KernelWorld => ({ ...toPublic(src), mods: src.mods });

const S = 's' as SectionId;
const k = (s: string) => s as HotspotKey;
const rm = (s: string) => s as RoomId;
const tap = (hotspot: string): SectionAction => ({ kind: 'tap', hotspot: k(hotspot) });
const LEAVE: SectionAction = { kind: 'leave-view' };

/** A state in `roomId` of section `s`. */
function at(roomId: string, extra: Partial<WorldState> = {}): WorldState {
  return { ...structuredClone(EMPTY_WORLD_STATE), section: S, room: rm(roomId), lastRoom: { [S]: rm(roomId) }, visited: [rm(roomId)], ...extra };
}

/** The `room` effects of a list. */
const moves = (effects: readonly ExploreEffect[]): ExploreEffect[] => effects.filter((e) => e.kind === 'room');

/** The hall with the desk (a view of it, an exit back) and the study (a plain room); an exit out of the section. */
function deskWorld(): KernelWorld {
  return kernel(
    source(
      rawWorld({
        s: [
          'hall',
          {
            hall: room([exit('to_desk', 'desk'), exit('to_study', 'study'), exit('out', { story: 'end' })]),
            desk: view('hall', [exit('back', 'hall')]),
            study: room([exit('to_hall', 'hall')]),
          },
        ],
      }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The data half

test('view: decode and encode round-trip', () => {
  const raw = rawWorld({
    s: [
      'hall',
      {
        hall: room([exit('to_desk', 'desk'), exit('out', { story: 'end' })]),
        desk: view('hall', [exit('back', 'hall'), exit('to_drawer', 'drawer')]),
        drawer: view('desk', []),
      },
    ],
  });
  const src = source(raw);
  const d = src.mods.view;
  // Each view's parent, in source order; a room that is no view is absent.
  expect(d.of).toEqual({ desk: 'hall', drawer: 'desk' });
  expect(d.paths).toEqual({ desk: 'sections.s.rooms.desk', drawer: 'sections.s.rooms.drawer' });
  // The decoded data is plain JSON.
  expect(JSON.parse(JSON.stringify(d))).toStrictEqual(d);
  // Through the public body and back: the same data, the key back in its room.
  const pub = toPublic(src);
  const back = decodeWorldPublic({ ...pub, version: '0123456789abcdef' });
  expect(back.ok ? back.value.mods.view : back.error).toEqual(d);
  const desk = JSON.parse(JSON.stringify(pub.sections[S]?.rooms[rm('desk')])) as Json; // the body's JSON, owned keys untyped there
  expect(desk['view']).toEqual({ of: 'hall' });
  expect(Object.hasOwn(JSON.parse(JSON.stringify(pub.sections[S]?.rooms[rm('hall')])) as Json, 'view')).toBe(false);
  // A world without views encodes nothing, so its emitted body and version are the kernel's.
  const plain = source(rawWorld({ s: ['hall', { hall: room([exit('out', { story: 'end' })]) }] }));
  expect(MECHANIC_DATA[3].encode(plain.mods.view)).toEqual([]);
  // Strict: an extra key, a parent that is no room id, a `view` that is no object; each at its room's `view`, in the
  // decoder's walk order.
  const bad = rawWorld({
    s: [
      'hall',
      {
        hall: room([exit('out', { story: 'end' })]),
        desk: room([], { view: { of: 'hall', zoom: 2 } }),
        drawer: room([], { view: { of: 'Desk!' } }),
        shelf: room([], { view: 'hall' }),
      },
    ],
  });
  const issues = decodeWorldSource(bad);
  expect(issues.ok ? [] : issues.error.map((e: WorldIssue) => [e.path, e.reason])).toEqual([
    ['sections.s.rooms.desk.view', 'shape'],
    ['sections.s.rooms.drawer.view', 'id'],
    ['sections.s.rooms.shelf.view', 'shape'],
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// The rules half

test('view: an exit into a view emits a zoom-in move', () => {
  const w = deskWorld();
  expect(moves(reduce(w, at('hall'), tap('hall.to_desk')).effects)).toEqual([{ kind: 'room', room: 'desk', sfx: null, from: 'hall', via: 'hall.to_desk', how: 'zoom-in' }]);
  // The view's exit back zooms out; a move between two plain rooms stays a walk.
  expect(moves(reduce(w, at('desk'), tap('desk.back')).effects)).toEqual([{ kind: 'room', room: 'hall', sfx: null, from: 'desk', via: 'desk.back', how: 'zoom-out' }]);
  expect(moves(reduce(w, at('hall'), tap('hall.to_study')).effects)).toEqual([{ kind: 'room', room: 'study', sfx: null, from: 'hall', via: 'hall.to_study', how: 'walk' }]);
  expect(moves(reduce(w, at('study'), tap('study.to_hall')).effects)).toEqual([{ kind: 'room', room: 'hall', sfx: null, from: 'study', via: 'study.to_hall', how: 'walk' }]);
});

test('view: leave-view returns to the parent and is enabled only in a view', () => {
  const w = deskWorld();
  // In the parent: not offered (the proof takes no such edge), and a reduce changes nothing (the same state object,
  // no effect).
  const hall = at('hall');
  expect(viewActions(w, hall)).toEqual([]);
  expect(successors(w, hall).map((x) => x.step)).not.toContainEqual(LEAVE);
  const none = reduce(w, hall, LEAVE);
  expect(none.state).toBe(hall);
  expect(none.effects).toEqual([]);
  // In the view: offered, and it moves to the parent by no exit, a zoom-out whose writes carry its own cause.
  const desk = at('desk');
  expect(viewActions(w, desk)).toEqual([LEAVE]);
  expect(successors(w, desk).map((x) => x.step)).toContainEqual(LEAVE);
  const r = reduce(w, desk, LEAVE);
  expect([r.state.room, r.state.lastRoom, r.state.visited]).toEqual(['hall', { s: 'hall' }, ['desk', 'hall']]);
  expect(moves(r.effects)).toEqual([{ kind: 'room', room: 'hall', sfx: null, from: 'desk', via: null, how: 'zoom-out' }]);
  expect(r.effects.flatMap((e) => (e.kind === 'cue' && e.cue.kind === 'fact' ? [[e.cue.fact.kind, e.cue.cause.verb]] : []))).toEqual([['visited', 'leave-view']]);
  expect(r.effects.at(-1)).toEqual({ kind: 'dirty' });
  // While an event knot is pending: neither offered nor applied.
  const knot = at('desk', { pendingStory: ['desk_voice' as KnotName] });
  expect(viewActions(w, knot)).toEqual([]);
  const held = reduce(w, knot, LEAVE);
  expect(held.state).toBe(knot);
  expect(held.effects).toEqual([]);
});

test('view: the soft-lock proof takes a leave-view edge', () => {
  // The desk has no exit back, and the key the hall's way out needs lies in it: only `leave-view` brings it out.
  const src = source(
    rawWorld(
      {
        s: [
          'hall',
          {
            hall: room([exit('to_desk', 'desk'), exit('out', { story: 'end' }, lock(['key']))]),
            desk: view('hall', [take('key', 'key')]),
          },
        ],
      },
      ['key'],
    ),
  );
  expect(checkWorld(kernel(src), 'story/ch1/world.json').flatMap((c) => c.findings)).toEqual([]);
});

test('view: a soft-lock path names its leave-view step', () => {
  // The key lies in the desk (no exit back); the well in the hall swallows it, and the way out needs it.
  const src = source(
    rawWorld(
      {
        s: [
          'hall',
          {
            hall: room([exit('to_desk', 'desk'), object('well', { lock: lock(['key']) }), exit('out', { story: 'end' }, lock(['key']))]),
            desk: view('hall', [take('key', 'key')]),
          },
        ],
      },
      ['key'],
    ),
  );
  expect(checkWorld(kernel(src), 'story/ch1/world.json').flatMap((c) => c.findings.map((f) => f.message))).toEqual([
    'section s: a reachable state cannot reach a leave (stuck in hall): tap hall.to_desk → tap desk.key → leave view desk → insert hall.well key',
  ]);
});

test("view: a room's neighbour rooms are its exits' rooms in hotspot order, a view's parent first", () => {
  // An oracle written out by hand: a duplicate exit lists its room once, a locked exit counts, a story exit, an exit to
  // the room itself and one to another section's room do not; a view lists its parent first, then its own exits' rooms.
  const w = kernel(
    source(
      rawWorld({
        s: [
          'hall',
          {
            hall: room([
              exit('to_study', 'study'),
              exit('to_desk', 'desk'),
              exit('again', 'study'),
              exit('self', 'hall'),
              exit('to_attic', 'attic', lock(['key'])),
              exit('out', { story: 'end' }),
            ]),
            study: room([exit('to_yard', 'yard'), exit('to_hall', 'hall')]),
            attic: room([exit('to_hall', 'hall')]),
            desk: view('hall', [exit('to_drawer', 'drawer'), exit('back', 'hall')]),
            drawer: view('desk', []),
          },
        ],
        t: ['yard', { yard: room([exit('out', { story: 'end' })]) }],
      }, ['key']),
    ),
  );
  expect(nearRooms(w, rm('hall'))).toEqual(['study', 'desk', 'attic']);
  expect(nearRooms(w, rm('study'))).toEqual(['hall']);
  expect(nearRooms(w, rm('attic'))).toEqual(['hall']);
  expect(nearRooms(w, rm('desk'))).toEqual(['hall', 'drawer']);
  expect(nearRooms(w, rm('drawer'))).toEqual(['desk']);
  expect(nearRooms(w, rm('cellar'))).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// The section search's budget (X9; docs/PUZZLES-PLAN.md "The cost"): at most `cap` states and at most
// cap x RESUME_WORK_PER_STATE successor evaluations, one budget for the build and the resume.

/** `n` ids `<prefix>0` .. `<prefix>n-1`. */
const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test('search: a section past the work bound answers cap whatever its places', () => {
  // One room: nine lockless objects (a tap writes nothing the key reads, so each is a known edge) and a way out. Every
  // search expands the start alone and evaluates its 10 successors, against a work bound of cap x 8.
  const w = kernel(source(rawWorld({ s: ['hall', { hall: room([...ids('o', 9).map((id) => object(id)), exit('out', { story: 'end' })]) }] })));
  const start = sectionEntry(w, EMPTY_WORLD_STATE, S);
  // Cap 1: one state fits the place bound, 10 evaluations pass the work bound 8.
  expect(searchSection(w, start, S, 1)).toEqual({ result: 'cap', states: 1 });
  const spent: SearchStats[] = [];
  const onStats = (stats: SearchStats): void => {
    spent.push(stats);
  };
  expect(searchSection(w, start, S, 1, { onStats })).toEqual({ result: 'cap', states: 1 });
  // Cap 2: the work bound is 16, so the search ends.
  expect(searchSection(w, start, S, 2, { onStats })).toEqual({ result: 'exhausted', states: 1 });
  expect(spent).toEqual([
    { expansions: 1, work: 10, bound: 'work' },
    { expansions: 1, work: 10, bound: null },
  ]);
  // The runtime's entry shares the bound: a save in a room no state has is searched for from the section's start.
  const nowhere: WorldState = { ...EMPTY_WORLD_STATE, section: S, room: rm('nowhere') };
  expect(inSectionReach(w, nowhere, S, 1)).toBe('cap');
  expect(inSectionReach(w, nowhere, S, 2)).toBe('no');
  // The product's bound, derived from the one cap.
  expect(RESUME_STATE_CAP * RESUME_WORK_PER_STATE).toBe(40_000);
});

test('softlock: world/state-cap names the bound the section passed', () => {
  const world = (hotspots: readonly Json[], items: readonly string[]): KernelWorld =>
    kernel(source(rawWorld({ s: ['hall', { hall: room([...hotspots, exit('out', { story: 'end' })]) }] }, items)));
  const verdict = (w: KernelWorld): [Array<[string, string]>, Array<number | null>] => {
    const checks = checkWorld(w, 'story/ch1/world.json');
    return [checks.flatMap((c) => c.findings.map((f): [string, string] => [f.code, f.message])), checks.map((c) => c.states)];
  };
  const items13 = ids('i', 13);
  const items10 = ids('i', 10);
  // The count: 13 takes, 2^13 = 8,192 states. The 5,001st is discovered within 36,726 evaluations (levels 0-5 of the
  // BFS cost 22,998, the 1,716 level-6 states 8 each), so the place bound comes first, with today's text.
  const [countFindings, countStates] = verdict(world(items13.map((id, i) => take(`t${i}`, id)), items13));
  expect(countFindings).toEqual([
    ['world/state-cap', 'section s: more than 5000 states (RESUME_STATE_CAP), too large to prove at resume (X9); split it into sections'],
  ]);
  expect(countStates).toEqual([null]);
  // The work: 10 takes and 40 lockless objects, 1,024 states; exhausting them costs 1,024 x 41 + 10 x 512 = 47,104
  // evaluations, so the work bound 40,000 comes first.
  const [workFindings, workStates] = verdict(world([...items10.map((id, i) => take(`t${i}`, id)), ...ids('o', 40).map((id) => object(id))], items10));
  expect(workFindings).toEqual([
    ['world/state-cap', 'section s: more than 40000 successor evaluations (8 per state of RESUME_STATE_CAP), too large to prove at resume (X9); split it into sections'],
  ]);
  expect(workStates).toEqual([null]);
}, 60_000);

// ---------------------------------------------------------------------------------------------------------------
// The story gate

const CATALOG: AssetCatalog = { bg: {}, chars: {}, cg: {}, bgm: {}, sfx: {}, prop: {}, cover: {} };

/** `VIEW_LINT` over `src`: each finding as its code, its path (a finding's line is its path's index in `paths` + 1)
 *  and its severity. */
function lint(src: WorldSource): Array<[string, string, string]> {
  const paths: string[] = [];
  const input: WorldLintInput = {
    chapter: { id: 'ch1' as ChapterId, paid: false, entry: 'ch1/main.ink' },
    file: 'story/ch1/world.json',
    text: '',
    world: src,
    catalog: CATALOG,
    knots: null,
    yielded: null,
    declared: new Map(),
    line: (path) => (paths.includes(path) ? paths.indexOf(path) : paths.push(path) - 1) + 1,
    moduleLines: new Map(),
  };
  return VIEW_LINT.lint(input).map((f) => [f.code, paths[f.line - 1] ?? '', f.severity]);
}

test('story: an exit into a view from another room is refused', () => {
  const src = source(
    rawWorld({
      s: [
        'hall',
        {
          hall: room([exit('to_desk', 'desk'), exit('to_study', 'study'), exit('out', { story: 'end' })]),
          desk: view('hall', [exit('back', 'hall')]),
          study: room([exit('to_desk', 'desk'), exit('to_hall', 'hall')]),
        },
      ],
    }),
  );
  // The study's exit into the desk, on its `to.room` line; the parent's own exit into it passes.
  expect(lint(src)).toEqual([['world/view-entry', 'sections.s.rooms.study.hotspots.0.to.room', 'E']]);
});

test('story: a section that starts in a view is refused', () => {
  const src = source(
    rawWorld({
      s: [
        'desk',
        {
          hall: room([exit('to_desk', 'desk'), exit('out', { story: 'end' })]),
          desk: view('hall', [exit('back', 'hall')]),
        },
      ],
    }),
  );
  // A start is an entry that is no exit of the parent, on the section's `start` line; the parent's exit into the view
  // and the view's exit back both pass.
  expect(lint(src)).toEqual([['world/view-entry', 'sections.s.start', 'E']]);
});

test('story: a view exit to a sibling room is refused', () => {
  const src = source(
    rawWorld({
      s: [
        'hall',
        {
          hall: room([exit('to_desk', 'desk'), exit('to_study', 'study'), exit('out', { story: 'end' })]),
          study: room([exit('to_hall', 'hall')]),
          desk: view('hall', [exit('back', 'hall'), exit('to_study', 'study'), exit('to_drawer', 'drawer'), exit('away', { story: 'end' })]),
          drawer: view('desk', []),
        },
      ],
    }),
  );
  // The desk's exit to the study, a sibling of its parent; its exit back, its own child view and a story exit pass.
  expect(lint(src)).toEqual([['world/view-exits', 'sections.s.rooms.desk.hotspots.1.to.room', 'E']]);
});

test('story: a view deeper than two levels is refused', () => {
  const deep = source(
    rawWorld({
      s: [
        'hall',
        {
          hall: room([exit('to_desk', 'desk'), exit('out', { story: 'end' })]),
          desk: view('hall', [exit('back', 'hall'), exit('to_drawer', 'drawer')]),
          drawer: view('desk', [exit('to_box', 'box')]),
          box: view('drawer', []),
        },
      ],
    }),
  );
  // The drawer is two levels deep (hall -> desk -> drawer) and passes; the box is three. A view of a view has no exit
  // back (`world/view-entry`: only `of` has an exit into a view); `leave-view` is its way out.
  expect(lint(deep)).toEqual([['world/view-depth', 'sections.s.rooms.box.view', 'E']]);
  // Two views whose parents name each other: a cycle, at each of them.
  const cycle = source(
    rawWorld({
      s: [
        'hall',
        {
          hall: room([exit('out', { story: 'end' })]),
          left: view('right', []),
          right: view('left', []),
        },
      ],
    }),
  );
  expect(lint(cycle)).toEqual([
    ['world/view-depth', 'sections.s.rooms.left.view', 'E'],
    ['world/view-depth', 'sections.s.rooms.right.view', 'E'],
  ]);
});

test("story: a view of another section's room or of no room is refused", () => {
  const src = source(
    rawWorld({
      s: [
        'hall',
        {
          hall: room([exit('out', { story: 'end' })]),
          desk: view('yard', []),
          lamp: view('attic', []),
        },
      ],
      t: ['yard', { yard: room([exit('out', { story: 'end' })]) }],
    }),
  );
  expect(lint(src)).toEqual([
    ['world/view-section', 'sections.s.rooms.desk.view', 'E'],
    ['world/unknown-ref', 'sections.s.rooms.lamp.view', 'E'],
  ]);
});
