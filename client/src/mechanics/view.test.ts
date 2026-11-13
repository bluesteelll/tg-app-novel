// Module `view` (engine plan §6.3): a room with `view: { of }` is a zoom view of its parent, entered through an ordinary
// exit of the parent and left back to it. A move into a view is a zoom-in and a move out of one a zoom-out; `leave-view`
// returns to the parent and is offered only in a view; the soft-lock proof takes it; the data round-trips; and the
// story gate refuses a view entered from elsewhere, a view's exit to a sibling, a chain deeper than two, and a parent of
// another section or of no room. The section search over views (GM5q, synthesis §3.7): a free view keys under its
// parent's place, a place's state is expanded over every member, an edge from another member carries the walk to it,
// the soundness property holds over places and turns red when a membership condition is dropped, a soft-lock path
// prints each walk, and the search's two bounds (places and work) answer 'cap' at the build and the resume alike (the
// work checked before a member's edges, an excluded successor counted).
// Fixture worlds are written in the source format and decoded with the real registries; a proof world carries the
// decoded `mods`, as the explore controller's and the story gate's do.
import { expect, test } from 'vitest';

import type { WorldLintInput } from '../../scripts/story/mechanics/index.ts';
import { VIEW_LINT } from '../../scripts/story/mechanics/view.ts';
import { checkWorld } from '../../scripts/story/softlock.ts';
import { RESUME_STATE_CAP, own, sectionScope, worldIndex } from '../explore/reduce.ts';
import type { ExploreEffect, Step } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { AssetCatalog } from '../story/catalog.ts';
import type { ChapterId, KnotName, SectionId } from '../story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toPublic } from '../world/decode.ts';
import type { WorldIssue } from '../world/decode.ts';
import type { HotspotKey, ItemId, RoomId, WorldSource } from '../world/types.ts';
import type { FactAtom, KernelWorld, MechanicRules, RulesRegistry, SectionAction } from './contract.ts';
import { MECHANIC_DATA } from './data/index.ts';
import { reduce } from './rules/core.ts';
import { MECHANIC_RULES } from './rules/index.ts';
import {
  RESUME_WORK_PER_STATE,
  admitSection,
  inSectionReach,
  placeSuccessors,
  searchSection,
  sectionEntry,
  sectionKey,
  sectionPlaces,
  successors,
} from './rules/search.ts';
import type { SearchStats, Walk } from './rules/search.ts';
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

/** The source world of `sections` (each `[start, rooms]`), with an item per id of `items` and the `puzzles` given. */
function rawWorld(sections: Readonly<Record<string, readonly [string, Readonly<Record<string, Json>>]>>, items: readonly string[] = [], puzzles: Json = {}): Json {
  return {
    format: 1,
    items: Object.fromEntries(items.map((id) => [id, { name: txt(id), desc: txt(id), glyph: 'key' }])),
    docs: {},
    puzzles,
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

/** The key lies in the desk (a view of the hall with no exit back); the well in the hall swallows it, and the way out
 *  needs it. */
function wellWorld(): KernelWorld {
  return kernel(
    source(
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
    ),
  );
}

test('view: a soft-lock path names its leave-view step', () => {
  // The key lies in the desk (no exit back); the well in the hall swallows it, and the way out needs it.
  expect(checkWorld(wellWorld(), 'story/ch1/world.json').flatMap((c) => c.findings.map((f) => f.message))).toEqual([
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

test("search: the work bound is checked before a member's edges", () => {
  // One room: sixteen lockless objects (known edges), a take (a new place) and a way out, so the start's one member
  // evaluates 18 successors. The work is checked after a member's successors are evaluated and before its edges: a
  // member whose evaluation passed the bound hands no edge, neither the take's new place nor a target.
  const w = kernel(source(rawWorld({ s: ['hall', { hall: room([...ids('o', 16).map((id) => object(id)), take('t', 'i'), exit('out', { story: 'end' })]) }] }, ['i'])));
  const start = sectionEntry(w, EMPTY_WORLD_STATE, S);
  const target = sectionKey(w, reduce(w, start, tap('hall.t')).state, S);
  const spent: SearchStats[] = [];
  let edges = 0;
  const onStats = (stats: SearchStats): void => {
    spent.push(stats);
  };
  const onEdge = (): void => {
    edges++;
  };
  // Cap 1, work bound 8: both bounds pass on the start's member (18 evaluations; the take's place would be the 2nd).
  // The work is checked first, so the search stops at the work bound.
  expect(searchSection(w, start, S, 1, { onStats, onEdge })).toEqual({ result: 'cap', states: 1 });
  expect(spent).toEqual([{ expansions: 1, work: 18, bound: 'work' }]);
  // Cap 2, work bound 16: the take's place is the target, but it lies behind the member's edges.
  expect(searchSection(w, start, S, 2, { onStats, onEdge, target })).toEqual({ result: 'cap', states: 1 });
  expect(spent.at(-1)).toEqual({ expansions: 1, work: 18, bound: 'work' });
  expect(edges).toBe(0);
  // Cap 3, work bound 24: the 18 evaluations fit, and the take finds the target.
  expect(searchSection(w, start, S, 3, { target })).toEqual({ result: 'found', states: 2 });
});

test('search: an excluded successor counts as work', () => {
  // One room: nine lockless objects and a way out, so the start evaluates 10 successors. The search never takes a step
  // `exclude` accepts (here every tap but the way out), but it evaluated it: it counts against the work bound.
  const w = kernel(source(rawWorld({ s: ['hall', { hall: room([...ids('o', 9).map((id) => object(id)), exit('out', { story: 'end' })]) }] })));
  const start = sectionEntry(w, EMPTY_WORLD_STATE, S);
  const exclude = (step: Step): boolean => !(step.kind === 'tap' && step.hotspot === k('hall.out'));
  const spent: SearchStats[] = [];
  const steps: Step[] = [];
  const onStats = (stats: SearchStats): void => {
    spent.push(stats);
  };
  // Cap 1, work bound 8: the 10 evaluations pass it, 9 of them excluded.
  expect(searchSection(w, start, S, 1, { exclude, onStats })).toEqual({ result: 'cap', states: 1 });
  // Cap 2, work bound 16: they fit, and the only edge is the way out.
  const r = searchSection(w, start, S, 2, {
    exclude,
    onStats,
    onEdge: (_from, succ) => {
      steps.push(succ.step);
    },
  });
  expect(r).toEqual({ result: 'exhausted', states: 1 });
  expect(steps).toEqual([tap('hall.out')]);
  expect(spent).toEqual([
    { expansions: 1, work: 10, bound: 'work' },
    { expansions: 1, work: 10, bound: null },
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// The place quotient (synthesis §3.7, engine plan §6.3; rules/search.ts `placesOf`): a view the player enters by a
// lockless exit of its parent and leaves only by `leave-view`, with no `onEnter` and no module reading its `visited`,
// keys under its parent's place; the search expands a place's state over every member.

const ITEMS_PL = ['coin', 'key', 'gem', 'pen', 'ring', 'note', 'gold', 'cup', 'nail', 'shell', 'rope', 'dust', 'book'];

/**
 * Fixture PL: a view per membership condition, merged and not, each with a take of its own. Merged: `desk` and `drawer`
 * (depth 2) and `bay` into the hall, `crate` into the nook, `shelf` into the study. Not: `safe` (a locked entry, a2),
 * `attic` (no exit enters it, a2), `box` (an `onEnter`, b), `nook` (an exit back, c1), `loft` (a story exit, c1); `bay`
 * too under a registry that reads its `visited` (d). The hall's `onEnter` gives the coin, so I-P matters.
 */
function placesWorld(): KernelWorld {
  return kernel(
    source(
      rawWorld(
        {
          s: [
            'hall',
            {
              hall: room(
                [
                  exit('to_desk', 'desk'),
                  exit('to_safe', 'safe', lock(['key'])),
                  exit('to_nook', 'nook'),
                  exit('to_bay', 'bay'),
                  exit('to_loft', 'loft'),
                  exit('to_study', 'study'),
                  exit('out', { story: 'end' }, lock(['gem'])),
                  take('key', 'key'),
                ],
                { onEnter: [{ give: 'coin' }] },
              ),
              desk: view('hall', [take('pen', 'pen'), exit('to_drawer', 'drawer'), exit('to_box', 'box')]),
              drawer: view('desk', [take('gem', 'gem')]),
              box: room([take('ring', 'ring')], { onEnter: [{ give: 'note' }], view: { of: 'desk' } }),
              safe: view('hall', [take('gold', 'gold')]),
              nook: view('hall', [exit('back', 'hall'), exit('to_crate', 'crate'), take('cup', 'cup')]),
              crate: view('nook', [take('nail', 'nail')]),
              bay: view('hall', [take('shell', 'shell')]),
              loft: view('hall', [exit('away', { story: 'end' }), take('rope', 'rope')]),
              attic: view('hall', [take('dust', 'dust')]),
              study: room([exit('to_hall', 'hall'), exit('to_shelf', 'shelf')]),
              shelf: view('study', [take('book', 'book')]),
            },
          ],
        },
        ITEMS_PL,
      ),
    ),
  );
}

/** A fixture module that only reads: its `reads` returns `atoms` in every section (explore.test.ts's `reader`). */
const reader = (...atoms: FactAtom[]): MechanicRules<'reader', never, never> => ({
  id: 'reader',
  actions: () => [],
  apply: () => undefined,
  reads: () => atoms,
  cues: [],
});

/** MECHANIC_RULES with a module that reads `visited: bay`: condition (d) keeps the bay out of the hall's place. */
const READS_BAY: RulesRegistry = [...MECHANIC_RULES, reader({ kind: 'visited', id: 'bay' })];

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

/**
 * The place quotient's soundness property on section S of `w` under `rules`: two states with one `sectionKey` have
 * the same sorted lines (step, successor key or LEAVE) over `placeSuccessors`, the union the search expands. Per seed,
 * 200 random states, each with its twins: one per other member of its place (the room swapped), one that differs only
 * in what the key abstracts, and one toggle per fact kind the key reads. Every state is normalized to I-P (a state in a
 * place of several rooms has arrived at its root: the root in `visited`, `enter:<root>` in `fired` when the root has an
 * `onEnter`), which every reachable state holds; so no toggle touches the root's `visited` or `enter:<root>`. Returns
 * the pairs compared per seed and those between two rooms of one place.
 */
function placeProperty(w: KernelWorld, rules: RulesRegistry, seeds: readonly number[]): Array<{ compared: number; cross: number }> {
  const ix = worldIndex(w);
  const scope = sectionScope(w, S);
  const rooms = [...scope.rooms];
  const hotspots = [...scope.hotspots];
  const takes = hotspots.filter((key) => ix.hotspots.get(key)?.hotspot.kind === 'take');
  const items = [...scope.items];
  const fired = [...scope.fired];
  const lockKeys = scope.locks.map((l) => l.key);
  const slotted = scope.locks.filter((l) => l.lock.slots.length > 0);
  const places = sectionPlaces(w, S, rules);
  const rootOf = (r: RoomId): RoomId => rm(own(places, r) ?? r);
  const placeOf = (r: RoomId): RoomId[] => rooms.filter((x) => rootOf(x) === rootOf(r));
  const lines = (s: WorldState): string =>
    placeSuccessors(w, s, S, rules)
      .map((x) => `${JSON.stringify(x.step)}\t${x.leaves ? 'LEAVE' : sectionKey(w, x.state, S, rules)}`)
      .sort()
      .join('\n');
  const toggled = <T>(list: readonly T[], x: T): T[] => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const added = <T>(list: readonly T[], x: T): T[] => (list.includes(x) ? [...list] : [...list, x]);
  return seeds.map((seed) => {
    const rnd = mulberry32(seed);
    const some = <T>(xs: readonly T[]): T[] => xs.filter(() => rnd() < 0.5);
    const pick = <T>(xs: readonly T[]): T => {
      const x = xs[Math.floor(rnd() * xs.length)];
      if (x === undefined) {
        throw new Error('invariant: a pick from a non-empty list');
      }
      return x;
    };
    const groups = new Map<string, { room: RoomId | null; lines: string }>();
    let compared = 0;
    let cross = 0;
    const visit = (s: WorldState): void => {
      const key = sectionKey(w, s, S, rules);
      const got = lines(s);
      const first = groups.get(key);
      if (first === undefined) {
        groups.set(key, { room: s.room, lines: got });
        return;
      }
      compared++;
      if (first.room !== s.room) {
        cross++;
      }
      expect(got, `seed ${seed}, key ${key}`).toBe(first.lines);
    };
    for (let n = 0; n < 200; n++) {
      const room = pick(rooms);
      const root = rootOf(room);
      const several = placeOf(room).length > 1;
      // I-P, for a state in a place of several rooms.
      const arrived = (visited: readonly RoomId[], f: readonly string[]): Pick<WorldState, 'visited' | 'fired'> =>
        several ? { visited: added(visited, root), fired: (ix.rooms.get(root)?.room.onEnter.length ?? 0) > 0 ? added(f, `enter:${root}`) : [...f] } : { visited: [...visited], fired: [...f] };
      const slots: Record<HotspotKey, Array<ItemId | null>> = {};
      for (const { key, lock: l } of slotted) {
        if (rnd() < 0.6) {
          slots[key] = l.slots.map((slot) => (rnd() < 0.5 ? slot.accepts : null));
        }
      }
      const s: WorldState = {
        ...structuredClone(EMPTY_WORLD_STATE),
        section: S,
        room,
        lastRoom: { [S]: room },
        held: some(items),
        used: some(items),
        taken: some(takes),
        slots,
        open: some(lockKeys),
        pendingStory: rnd() < 0.2 ? ['desk_voice' as KnotName] : [],
        ...arrived(some(rooms), some(fired)),
      };
      visit(s);
      // The other members of its place.
      for (const other of placeOf(room)) {
        if (other !== room) {
          visit({ ...s, room: other });
        }
      }
      // What the key abstracts: lastRoom, the visited of the rooms no module reads, examined, list order, another
      // section's facts, unproved.
      visit({
        ...s,
        lastRoom: { [S]: pick(rooms), ['t' as SectionId]: rm('yard') },
        ...arrived([...some(rooms.filter((r) => r !== 'bay')), ...s.visited.filter((r) => r === 'bay')], [...s.fired].reverse().concat(['enter:yard'])),
        examined: some(hotspots),
        held: [...s.held].reverse().concat(['yard_coin' as ItemId]),
        used: [...s.used].reverse(),
        taken: [...s.taken].reverse().concat([k('yard.chest')]),
        open: [...s.open].reverse(),
        unproved: [S],
      });
      // One fact of each kind the key reads (the root's visited and `enter:<root>` stay: I-P).
      const slot = pick(slotted);
      const cell = Math.floor(rnd() * slot.lock.slots.length);
      const cells = slot.lock.slots.map((x, i) => {
        const c = own(s.slots, slot.key)?.[i] ?? null;
        return i !== cell ? c : c === null ? x.accepts : null;
      });
      const patches: Array<Partial<WorldState>> = [
        { held: toggled(s.held, pick(items)) },
        { used: toggled(s.used, pick(items)) },
        { taken: toggled(s.taken, pick(takes)) },
        { open: toggled(s.open, pick(lockKeys)) },
        { fired: toggled(s.fired, pick(fired.filter((f) => !several || f !== `enter:${root}`))) },
        { visited: toggled(s.visited, pick(rooms.filter((r) => !several || r !== root))) },
        { slots: { ...s.slots, [slot.key]: cells } },
      ];
      for (const patch of patches) {
        visit({ ...s, ...patch });
      }
    }
    return { compared, cross };
  });
}

test("search: a free view keys under its parent's place", () => {
  const w = placesWorld();
  const key = (r: string, rules: RulesRegistry = MECHANIC_RULES): string => sectionKey(w, at(r), S, rules);
  // The desk is a free view of the hall: one place, one key.
  expect(key('desk')).toBe(key('hall'));
  // Depth 2, a merged view under a view that does not merge, a merged view of a plain room, a sibling view.
  expect(key('drawer')).toBe(key('hall'));
  expect(key('crate')).toBe(key('nook'));
  expect(key('shelf')).toBe(key('study'));
  expect(key('bay')).toBe(key('hall'));
  // Each view that fails a condition keys as its own room: a locked entry, no entry, an onEnter, an exit back, a
  // story exit.
  expect(['safe', 'attic', 'box', 'nook', 'loft'].map((v) => key(v).split('|')[0])).toEqual(['safe', 'attic', 'box', 'nook', 'loft']);
  // The maps, written by hand.
  expect(sectionPlaces(w, S)).toEqual({ desk: 'hall', drawer: 'hall', bay: 'hall', crate: 'nook', shelf: 'study' });
  // A module that reads `visited: bay` keeps the bay a place of its own (d).
  expect(sectionPlaces(w, S, READS_BAY)).toEqual({ desk: 'hall', drawer: 'hall', crate: 'nook', shelf: 'study' });
  expect(key('bay', READS_BAY).split('|')[0]).toBe('bay');
});

test('search: equal quotient keys have equal successor keys', () => {
  // Soundness of the place key both searches deduplicate by: two states with one key have the same steps to the same
  // keys over the union of their places' members. Under READS_BAY, (a), (b), (c1) and (d) each leave a view with
  // actions of its own out of a place, so a dropped condition merges a pair whose unions differ.
  const w = placesWorld();
  const stats = placeProperty(w, READS_BAY, [1, 2, 3, 4]);
  // Non-vacuity: merged views and views of each failed condition, every random state's abstract twin compared, and
  // pairs of two rooms of one place on every seed.
  const merged = sectionPlaces(w, S, READS_BAY);
  const views = Object.keys(w.mods.view.of);
  expect(Object.keys(merged).length).toBeGreaterThanOrEqual(3);
  expect(views.filter((v) => !Object.hasOwn(merged, v)).sort()).toEqual(['attic', 'bay', 'box', 'loft', 'nook', 'safe']);
  expect(stats.reduce((n, x) => n + x.compared, 0)).toBeGreaterThanOrEqual(800);
  expect(stats.map((x) => x.cross > 0)).toEqual([true, true, true, true]);
}, 60_000);

test('search: an edge from another member of a place carries its walk', () => {
  const w = wellWorld();
  const start = sectionEntry(w, EMPTY_WORLD_STATE, S);
  type Edge = { readonly from: number; readonly step: Step; readonly walk: Walk };
  const edges: Edge[] = [];
  const r = searchSection(w, start, S, RESUME_STATE_CAP, {
    onEdge: (from, succ, _to, _isNew, walk) => {
      edges.push({ from, step: succ.step, walk });
    },
  });
  const find = (from: number | null, step: Step): Edge | undefined =>
    edges.find((e) => (from === null || e.from === from) && JSON.stringify(e.step) === JSON.stringify(step));
  // The parent hands no walk (undefined): read it optionally, so its red names the missing walk.
  const walkOf = (e: Edge | undefined): unknown => e?.walk?.map((m) => [m.step, m.state.room]);
  // The key is taken in the desk, a member of the hall's place: the walk is the zoom tap.
  const taking = find(null, tap('desk.key'));
  expect(walkOf(taking)).toEqual([[tap('hall.to_desk'), 'desk']]);
  expect(taking?.from).toBe(0);
  // The well swallows the key from the hall, a member of the desk's place: the walk is the leave.
  expect(walkOf(find(null, { kind: 'insert', hotspot: k('hall.well'), item: 'key' as ItemId }))).toEqual([[LEAVE, 'hall']]);
  // A step from the state's own room: no walk.
  expect(walkOf(find(0, tap('hall.to_desk')))).toEqual([]);
  // hall; (desk, key); (hall, well opened); (hall, out opened): the desk adds no place. Without the quotient each room
  // is a place: hall, desk, (desk, key), (hall, key), (hall, well), (hall, out), (desk, well), (desk, out).
  expect(r.states).toBe(4);
  expect(searchSection(w, start, S, RESUME_STATE_CAP, { places: false }).states).toBe(8);
});

test('search: a saved state in a merged view is in reach and admits', () => {
  const w = wellWorld();
  const entry = sectionEntry(w, EMPTY_WORLD_STATE, S);
  // A save the world produces: the key taken in the desk.
  const s1: WorldState = { ...reduce(w, reduce(w, entry, tap('hall.to_desk')).state, tap('desk.key')).state, unproved: [S] };
  expect([s1.room, s1.held]).toEqual(['desk', ['key']]);
  expect(inSectionReach(w, s1, S, RESUME_STATE_CAP)).toBe('yes');
  const kept = admitSection(w, s1, S);
  expect([kept.state.room, kept.state.unproved]).toEqual(['desk', []]);
  expect(kept.effects[0]).toEqual({ kind: 'room', room: 'desk', sfx: null, from: 'desk', via: null, how: 'resume' });
  expect(kept.effects.filter((e) => e.kind === 'reset')).toEqual([]);
  // A save it cannot produce: the key held, its take never taken.
  const s2 = at('desk', { held: ['key' as ItemId], unproved: [S] });
  expect(inSectionReach(w, s2, S, RESUME_STATE_CAP)).toBe('no');
  const restarted = admitSection(w, s2, S);
  expect(restarted.effects[0]).toEqual({ kind: 'reset', section: 's' });
  expect(restarted.state).toEqual(sectionEntry(w, EMPTY_WORLD_STATE, S));
});

test('search: a registry with a tap hook merges no view', () => {
  // A hook may take the entering tap on its own data (here the desk's zoom tap, doing nothing), which the place rule
  // cannot read: no view merges, and the property holds under the registry.
  const claim: MechanicRules<'claim', never, never> = {
    id: 'claim',
    actions: () => [],
    apply: () => undefined,
    reads: () => [],
    cues: [],
    tap: (_w, _s, hotspot) => hotspot === k('hall.to_desk'),
  };
  const rules: RulesRegistry = [...MECHANIC_RULES, claim];
  const w = placesWorld();
  expect(sectionPlaces(w, S, rules)).toEqual({});
  expect(placeProperty(w, rules, [1])[0]?.compared).toBeGreaterThanOrEqual(200);
}, 60_000);

test('search: views whose parents form a cycle keep their own rooms', () => {
  // An unlinted world (`world/view-depth` refuses it, and the story tool searches it in the same run): the walk to a
  // root takes one hop per candidate, so the cycle's views stay places of their own.
  const w = kernel(
    source(
      rawWorld({
        s: ['hall', { hall: room([exit('out', { story: 'end' })]), left: view('right', [exit('to_right', 'right')]), right: view('left', [exit('to_left', 'left')]) }],
      }),
    ),
  );
  expect(sectionPlaces(w, S)).toEqual({});
  expect(sectionKey(w, at('left'), S).split('|')[0]).toBe('left');
});

test('search: a registry without leave-view merges no view', () => {
  // `reduce` dispatches `leave-view` whatever the registry, so a walk up would hand a view a way out its registry never
  // offers: without the view module the desk is its own place, and the player taking the key is trapped there.
  const w = wellWorld();
  const noView: RulesRegistry = MECHANIC_RULES.filter((m) => m.actions !== viewActions);
  expect(sectionPlaces(w, S)).toEqual({ desk: 'hall' });
  expect(sectionPlaces(w, S, noView)).toEqual({});
  expect(searchSection(w, sectionEntry(w, EMPTY_WORLD_STATE, S, noView), S, RESUME_STATE_CAP, { rules: noView })).toEqual({ result: 'exhausted', states: 3 });
});

test('search: a view entered from a room outside its parent merges no place', () => {
  // (a2): every exit into a view lies in its parent. The study's exit into the desk is no free move of the hall's
  // place. The build lint `world/view-entry` refuses such a world, so the search API is checked directly: the desk stays
  // a place of its own. Without the study's exit, the same desk merges.
  const raw = (foreign: boolean): Json =>
    rawWorld(
      {
        s: [
          'hall',
          {
            hall: room([exit('to_desk', 'desk'), exit('to_study', 'study'), exit('out', { story: 'end' })]),
            desk: view('hall', [take('pen', 'pen')]),
            study: room([...(foreign ? [exit('to_desk', 'desk')] : []), exit('to_hall', 'hall')]),
          },
        ],
      },
      ['pen'],
    );
  const src = source(raw(true));
  expect(lint(src)).toEqual([['world/view-entry', 'sections.s.rooms.study.hotspots.0.to.room', 'E']]);
  const w = kernel(src);
  expect(sectionPlaces(w, S)).toEqual({});
  expect(sectionKey(w, at('desk'), S).split('|')[0]).toBe('desk');
  const linted = source(raw(false));
  expect(lint(linted)).toEqual([]);
  expect(sectionPlaces(kernel(linted), S)).toEqual({ desk: 'hall' });
});

test('view: a soft-lock path describes each step from the state before it', () => {
  // The drawer (a view of the desk, a view of the hall) holds a box whose code puzzle gives the key; the well in the
  // hall swallows it, and the way out needs it. The path takes the puzzle two zooms down, then two leaves up: each
  // walk move and the step are described from the state before them (the puzzle's opener from the drawer, each leave
  // from the view it leaves).
  const box = { slots: [], puzzle: 'box', locked: txt(), onOpen: [], onFail: [] };
  const code = { type: 'code', params: { dials: 4 }, solution: [1, 1, 1, 1], title: txt(), prompt: txt(), closeup: null, maxAttempts: null, giveUp: false, hints: [txt()] };
  const w = kernel(
    source(
      rawWorld(
        {
          s: [
            'hall',
            {
              hall: room([exit('to_desk', 'desk'), object('well', { lock: lock(['key']) }), exit('out', { story: 'end' }, lock(['key']))]),
              desk: view('hall', [exit('to_drawer', 'drawer')]),
              drawer: view('desk', [object('box', { lock: box, then: [{ give: 'key' }] })]),
            },
          ],
        },
        ['key'],
        { box: code },
      ),
    ),
  );
  // Both views merge (one place, the hall), so the path's zoom steps come from the walks; without the quotient they are
  // hops of their own, and the text is the same.
  expect(checkWorld(w, 'story/ch1/world.json').flatMap((c) => c.findings.map((f) => f.message))).toEqual([
    'section s: a reachable state cannot reach a leave (stuck in hall): tap hall.to_desk → tap desk.to_drawer → tap drawer.box → box solved → leave view drawer → leave view desk → insert hall.well key',
  ]);
});

test('search: walk moves count as work', () => {
  // One place of four rooms: the hall (three zoom taps and a way out) and three hotspot-less views (a leave each). Its
  // expansion costs 3 walk moves and 4 + 1 + 1 + 1 successors.
  const w = kernel(
    source(
      rawWorld({
        s: [
          'hall',
          {
            hall: room([exit('to_v1', 'v1'), exit('to_v2', 'v2'), exit('to_v3', 'v3'), exit('out', { story: 'end' })]),
            v1: view('hall', []),
            v2: view('hall', []),
            v3: view('hall', []),
          },
        ],
      }),
    ),
  );
  const start = sectionEntry(w, EMPTY_WORLD_STATE, S);
  const spent: SearchStats[] = [];
  const onStats = (stats: SearchStats): void => {
    spent.push(stats);
  };
  // Cap 1, work bound 8: the walks (3), the hall (7), v1 (8), v2 (9) passes it.
  expect(searchSection(w, start, S, 1, { onStats })).toEqual({ result: 'cap', states: 1 });
  expect(spent.at(-1)).toEqual({ expansions: 4, work: 9, bound: 'work' });
  // Cap 2, work bound 16: all 10.
  expect(searchSection(w, start, S, 2, { onStats })).toEqual({ result: 'exhausted', states: 1 });
  expect(spent.at(-1)).toEqual({ expansions: 4, work: 10, bound: null });
  // Without the quotient the same successors cost 7 over 4 states, no walk: under 8, so only the walks pass it above.
  expect(searchSection(w, start, S, 4, { onStats, places: false })).toEqual({ result: 'exhausted', states: 4 });
  expect(spent.at(-1)).toEqual({ expansions: 4, work: 7, bound: null });
});

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
