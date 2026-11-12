// Module `combine` (engine plan §6.2): two held items, one tapped onto the other in either order, run the first recipe
// of the pair whose `when` holds; a pair with none is refused with both ribbon items shaking. "Combine anywhere" (R11)
// under its three conditions: a recipe's items belong to one section (`world/recipe-scope`), no gating rule outside it
// reads them, and that section's search enumerates the recipe while it is current; the property test pins that a
// combine in another section commutes with leaving the recipe's section. Fixture worlds are written in the source
// format and decoded with the real registries; a proof world carries the decoded `mods`, as the explore controller's
// and the story gate's do. The module is reached only through the kernel's entry points (decode, `reduce`,
// `successors`, the scopes, the searches, the soft-lock proof), so each test fails on its own line before the module
// exists.
import { expect, test } from 'vitest';

import { checkWorld } from '../../scripts/story/softlock.ts';
import { RESUME_STATE_CAP, sectionScope } from '../explore/reduce.ts';
import type { ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { KnotName, SectionId } from '../story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toPublic } from '../world/decode.ts';
import type { WorldIssue } from '../world/decode.ts';
import type { HotspotKey, ItemId, RoomId, WorldSource } from '../world/types.ts';
import type { KernelWorld, MechanicId, SectionAction } from './contract.ts';
import { MECHANIC_DATA } from './data/index.ts';
import { reduce } from './rules/core.ts';
import { ownScope, resetSection, searchSection, sectionEntry, sectionKey, successors } from './rules/search.ts';

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
const look = (id: string): Json => ({ id, kind: 'look', rect: RECT, label: txt(), look: txt(id), then: [] });
const object = (id: string, extra: Json = {}): Json => ({ id, kind: 'object', rect: RECT, label: txt(), lock: null, then: [], look: null, prop: null, ...extra });
/** A lock without a puzzle whose slots accept `accepts`, one item each. */
const lock = (accepts: readonly string[]): Json => ({ slots: accepts.map((a) => ({ accepts: a })), puzzle: null, locked: txt(), onOpen: [], onFail: [] });
const room = (hotspots: readonly Json[]): Json => ({ bg: 'room', title: txt(), onEnter: [], hotspots });
const recipe = (a: string, b: string, gives: string, extra: Json = {}): Json => ({ a, b, gives, ...extra });

/** The source world of `sections` (each `[start, rooms]`), an item per id of `items`, and its `recipes` if any. */
function rawWorld(sections: Readonly<Record<string, readonly [string, Readonly<Record<string, Json>>]>>, items: readonly string[], recipes?: readonly Json[]): Json {
  return {
    format: 1,
    items: Object.fromEntries(items.map((id) => [id, { name: txt(id), desc: txt(id), glyph: 'key' }])),
    docs: {},
    puzzles: {},
    sections: Object.fromEntries(Object.entries(sections).map(([id, [start, rooms]]) => [id, { start, bgm: null, rooms }])),
    ...(recipes === undefined ? {} : { recipes }),
  };
}

/** One section `s`: the hall gives the shard and the glue and leaves to the story; `extra` items beside them. */
const hall = (recipes: readonly Json[], extra: readonly string[] = []): Json =>
  rawWorld({ s: ['hall', { hall: room([take('shard', 'shard'), take('glue', 'glue'), exit('out', { story: 'end' })]) }] }, ['shard', 'glue', 'vase', ...extra], recipes);

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
const T = 't' as SectionId;
const FILE = 'story/ch1/world.json';
const k = (s: string) => s as HotspotKey;
const it = (s: string) => s as ItemId;
const rm = (s: string) => s as RoomId;
const combine = (a: string, b: string): SectionAction => ({ kind: 'combine', a: it(a), b: it(b) });
const tap = (hotspot: string): SectionAction => ({ kind: 'tap', hotspot: k(hotspot) });
const DIRTY: ExploreEffect = { kind: 'dirty' };
/** The kernel's effects of a list, in order: every effect but the writer's `cue` effects. */
const kernelEffects = <E extends { readonly kind: string }>(effects: readonly E[]): E[] => effects.filter((e) => e.kind !== 'cue');
/** A refusal's cue effect: a module cue of `combine` on the ribbon item `item`, at no hotspot. */
const refusal = (name: string, item: string): ExploreEffect => ({ kind: 'cue', cue: { kind: 'module', module: 'combine' as MechanicId, name, at: null, item: it(item) } });

/** The writer's fact cues of a list, as `fact:<kind>:<id>:<change> <verb>@<at> <item>`. */
function factCues(effects: readonly ExploreEffect[]): string[] {
  return effects.flatMap((e) =>
    e.kind === 'cue' && e.cue.kind === 'fact' ? [`fact:${e.cue.fact.kind}:${e.cue.fact.id}:${e.cue.change} ${e.cue.cause.verb}@${String(e.cue.cause.at)} ${String(e.cue.cause.item)}`] : [],
  );
}

/** A state in `roomId` of `section` (default `s`). */
function at(roomId: string, extra: Partial<WorldState> = {}, section: SectionId = S): WorldState {
  return { ...structuredClone(EMPTY_WORLD_STATE), section, room: rm(roomId), lastRoom: { [section]: rm(roomId) }, visited: [rm(roomId)], ...extra };
}

const held = (...ids: string[]): Partial<WorldState> => ({ held: ids.map(it) });

/** Every state S's search reaches from its entry, in discovery order, and its result. */
function reach(w: KernelWorld, section: SectionId = S): { states: WorldState[]; result: string } {
  const start = sectionEntry(w, EMPTY_WORLD_STATE, section);
  const states = [start];
  const r = searchSection(w, start, section, RESUME_STATE_CAP, {
    onEdge: (_from, succ, to, isNew) => {
      if (isNew && to !== null) {
        states.push(succ.state);
      }
    },
  });
  return { states, result: r.result };
}

// ---------------------------------------------------------------------------------------------------------------
// §6.2 "Action": the first matching recipe, either order, keep, the refusal

test('combine: two items in either order give the product', () => {
  const w = kernel(source(hall([recipe('shard', 'glue', 'vase')], ['pin'])));
  const s = at('hall', held('shard', 'glue', 'pin'));
  const one = reduce(w, s, combine('shard', 'glue'));
  expect([one.state.held, one.state.used]).toEqual([['pin', 'vase'], ['shard', 'glue']]);
  // The other order (the glue selected, tapped onto the shard): the same state.
  const other = reduce(w, s, combine('glue', 'shard'));
  expect(other.state).toEqual(one.state);
  // Its writes are fact cues with the combine's cause: the selected item, at no hotspot.
  expect(factCues(one.effects)).toEqual([
    'fact:held:shard:removed combine@null shard',
    'fact:held:glue:removed combine@null shard',
    'fact:used:shard:added combine@null shard',
    'fact:used:glue:added combine@null shard',
    'fact:held:vase:added combine@null shard',
  ]);
});

test('combine: the first recipe whose when holds runs', () => {
  const w = kernel(
    source(hall([recipe('shard', 'glue', 'vase', { when: { held: 'map' } }), recipe('glue', 'shard', 'urn'), recipe('shard', 'glue', 'jar')], ['map', 'urn', 'jar'])),
  );
  // The first recipe's `when` does not hold: the second, written in the other order, runs (not the third).
  expect(reduce(w, at('hall', held('shard', 'glue')), combine('shard', 'glue')).state.held).toEqual(['urn']);
  // With the map held the first holds and runs.
  expect(reduce(w, at('hall', held('map', 'shard', 'glue')), combine('shard', 'glue')).state.held).toEqual(['map', 'vase']);
});

test('combine: a kept input stays held', () => {
  const w = kernel(source(hall([recipe('shard', 'glue', 'vase', { keep: ['glue'] })])));
  const r = reduce(w, at('hall', held('shard', 'glue')), combine('shard', 'glue'));
  // The glue is a tool: it stays held and is never used; the shard is consumed.
  expect([r.state.held, r.state.used]).toEqual([['glue', 'vase'], ['shard']]);
});

test('combine: a refusal writes nothing and shakes both ribbon items', () => {
  const w = kernel(source(hall([recipe('shard', 'glue', 'vase', { when: { held: 'map' } })], ['map', 'coin'])));
  // No recipe for the pair: the same state object, no kernel effect, and exactly the two cues: `refused` on the
  // selected item, then `refused-with` on the item tapped onto it.
  const s = at('hall', held('shard', 'coin'));
  const r = reduce(w, s, combine('shard', 'coin'));
  expect(r.state).toBe(s);
  expect(r.effects).toEqual([refusal('refused', 'shard'), refusal('refused-with', 'coin')]);
  // A recipe whose `when` does not hold refuses the same way (here the glue selected).
  const g = at('hall', held('shard', 'glue'));
  const q = reduce(w, g, combine('glue', 'shard'));
  expect(q.state).toBe(g);
  expect(q.effects).toEqual([refusal('refused', 'glue'), refusal('refused-with', 'shard')]);
});

test('combine: a combine outside a section, under a pending knot or of one item changes nothing', () => {
  const w = kernel(source(hall([recipe('shard', 'glue', 'vase')])));
  const idle = at('hall', held('shard', 'glue'));
  // The positive control: idle in the section, the recipe runs.
  expect(reduce(w, idle, combine('shard', 'glue')).state.held).toEqual(['vase']);
  const cases: Array<[string, WorldState, SectionAction]> = [
    ['no current section', { ...idle, section: null }, combine('shard', 'glue')],
    ['an event knot pending', { ...idle, pendingStory: ['hall_voice' as KnotName] }, combine('shard', 'glue')], // a fixture knot name
    ['one item twice', idle, combine('shard', 'shard')],
    ['an item not held', at('hall', held('shard')), combine('shard', 'glue')],
  ];
  // Each: the same state object and no effect at all (no refusal either).
  expect(
    cases.map(([label, s, a]) => {
      const r = reduce(w, s, a);
      return [label, r.state === s, r.effects];
    }),
  ).toEqual(cases.map(([label]) => [label, true, []]));
});

// ---------------------------------------------------------------------------------------------------------------
// The data half

test('combine: decode and encode round-trip', () => {
  const raw = hall([recipe('shard', 'glue', 'vase', { keep: ['glue'], when: { all: [{ held: 'shard' }, { not: { used: 'vase' } }] }, say: txt('say') }), recipe('vase', 'pin', 'lamp')], [
    'pin',
    'lamp',
  ]);
  const src = source(raw);
  const d = src.mods.combine;
  const [first, second] = d.recipes;
  expect(second).toEqual({ a: 'vase', b: 'pin', gives: 'lamp', keep: [], when: null, say: null });
  expect([first?.keep, first?.when, first?.say?.ru]).toEqual([['glue'], { all: [{ held: 'shard' }, { not: { used: 'vase' } }] }, 'say']);
  // Through the public body and back: the same data, and `recipes` back at the world's root with the defaults left out.
  const pub = toPublic(src);
  const back = decodeWorldPublic({ ...pub, version: '0123456789abcdef' });
  expect(back.ok ? back.value.mods?.combine : back.error).toEqual(d);
  const emitted = JSON.parse(JSON.stringify(pub)) as { recipes?: unknown[] }; // the body's JSON, `recipes` untyped there
  expect(emitted.recipes?.[1]).toEqual({ a: 'vase', b: 'pin', gives: 'lamp' });
  // A world without recipes encodes nothing, so its emitted body is the kernel's.
  const plain = source(hall([]));
  const none = source(rawWorld({ s: ['hall', { hall: room([exit('out', { story: 'end' })]) }] }, []));
  expect([MECHANIC_DATA[4].encode(plain.mods.combine), MECHANIC_DATA[4].encode(none.mods.combine), Object.hasOwn(toPublic(none), 'recipes')]).toEqual([[], [], false]);
  // Strict keys and ids, every issue at its source path (the keep-both row is its own test's).
  const issues = (recipes: unknown): Array<[string, string]> => {
    const r = decodeWorldSource({ ...hall([]), recipes });
    return r.ok ? [] : r.error.map((e: WorldIssue) => [e.path, e.reason]);
  };
  expect(issues({ a: 'shard' })).toEqual([['recipes', 'shape']]);
  expect(
    issues([
      5,
      recipe('shard', 'shard', 'shard', { with: 1 }),
      { a: 'Shard', gives: 'vase' },
      recipe('shard', 'glue', 'vase', { keep: 'glue' }),
      recipe('shard', 'glue', 'vase', { keep: ['pin', 'glue', 'glue'] }),
      recipe('shard', 'glue', 'vase', { when: { lit: 'lamp' } }),
      recipe('shard', 'glue', 'vase', { say: { ru: 'no id' } }),
    ]),
  ).toEqual([
    ['recipes.0', 'shape'],
    ['recipes.1.with', 'shape'],
    ['recipes.1.b', 'shape'],
    ['recipes.1.gives', 'shape'],
    ['recipes.2.a', 'id'],
    ['recipes.2.b', 'id'],
    ['recipes.3.keep', 'shape'],
    ['recipes.4.keep.0', 'shape'],
    ['recipes.4.keep.2', 'shape'],
    ['recipes.5.when', 'shape'],
    ['recipes.6.say.id', 'line-id'],
  ]);
});

test('combine: a recipe that keeps both inputs is refused', () => {
  const issues = (keep: readonly string[]): WorldIssue[] => {
    const r = decodeWorldSource(hall([recipe('shard', 'glue', 'vase', { keep })]));
    return r.ok ? [] : r.error;
  };
  // Both inputs kept, in either order: a run would write nothing after the first (a cue-less self-loop, W1).
  const both = [{ path: 'recipes.0.keep', reason: 'shape', detail: 'a recipe consumes at least one of its inputs' }];
  expect([issues(['shard', 'glue']), issues(['glue', 'shard'])]).toEqual([both, both]);
  // The boundary: one input kept decodes.
  expect([decodeWorldSource(hall([recipe('shard', 'glue', 'vase', { keep: ['glue'] })])).ok, decodeWorldSource(hall([recipe('shard', 'glue', 'vase', { keep: ['shard'] })])).ok]).toEqual([
    true,
    true,
  ]);
});

test("combine: a recipe's say and product are its toasts", () => {
  const src = source(hall([recipe('shard', 'glue', 'vase', { say: txt('say') }), recipe('vase', 'pin', 'lamp')], ['pin', 'lamp']));
  const say = src.mods.combine.recipes[0]?.say;
  expect(say?.ru).toBe('say');
  const w = kernel(src);
  // The product's name toast (a gift at no hotspot), then the say (a text at no hotspot).
  const r = reduce(w, at('hall', held('shard', 'glue')), combine('shard', 'glue'));
  expect(kernelEffects(r.effects)).toEqual([{ kind: 'got', gift: { item: 'vase' }, at: null }, { kind: 'look', text: say, at: null }, DIRTY]);
  // Without a say: the product's toast alone.
  expect(kernelEffects(reduce(w, at('hall', held('vase', 'pin')), combine('pin', 'vase')).effects)).toEqual([{ kind: 'got', gift: { item: 'lamp' }, at: null }, DIRTY]);
});

// ---------------------------------------------------------------------------------------------------------------
// The sections and the proof path

/**
 * Section `s`: the hall gives the shard, the glue and the wire, and its desk's `use` rule gives the fuse for the wire;
 * section `t`: the yard gives the bolt and the nut. Each leaves to the story.
 */
const twoSections = (recipes: readonly Json[]): Json =>
  rawWorld(
    {
      s: [
        'hall',
        {
          hall: room([take('shard', 'shard'), take('glue', 'glue'), take('wire', 'wire'), object('desk', { uses: [{ item: 'wire', do: [{ give: 'fuse' }] }] }), exit('out', { story: 'end' })]),
        },
      ],
      t: ['yard', { yard: room([take('bolt', 'bolt'), take('nut', 'nut'), exit('away', { story: 'after' })]) }],
    },
    ['shard', 'glue', 'wire', 'fuse', 'vase', 'lamp', 'torch', 'bolt', 'nut', 'gear', 'junk'],
    recipes,
  );

test("combine: a recipe's section is its inputs' section, through a chain in any order", () => {
  const w = kernel(
    source(
      twoSections([
        recipe('vase', 'wire', 'lamp'), // a chain: the vase is the next recipe's product
        recipe('shard', 'glue', 'vase'),
        recipe('fuse', 'shard', 'torch'), // a `use` rule's gift is an input of its section
        recipe('bolt', 'nut', 'gear'),
        recipe('shard', 'bolt', 'junk'), // no one section gives both: no section's
      ]),
    ),
  );
  // Each section's own facts gain the products of its recipes (the reset's and the key's scope).
  const own = (section: SectionId): string[] => [...ownScope(w, section).items].sort();
  expect([own(S), own(T)]).toEqual([
    ['fuse', 'glue', 'lamp', 'shard', 'torch', 'vase', 'wire'],
    ['bolt', 'gear', 'nut'],
  ]);
});

test("combine: a section's search enumerates its recipes only while it is current", () => {
  const w = kernel(source(twoSections([recipe('shard', 'glue', 'vase')])));
  const combines = (s: WorldState): unknown[] => successors(w, s).flatMap((x) => (x.step.kind === 'combine' ? [x.step] : []));
  // In S, holding both: one edge for the pair, the smaller id first.
  const inS = at('hall', held('shard', 'glue'));
  expect(combines(inS)).toEqual([{ kind: 'combine', a: 'glue', b: 'shard' }]);
  // In T, holding S's inputs: T's search never enumerates it, though the combine runs there ("combine anywhere").
  const inT = at('yard', held('shard', 'glue'), T);
  expect(combines(inT)).toEqual([]);
  expect(reduce(w, inT, combine('shard', 'glue')).state.held).toEqual(['vase']);
  // Under a pending knot, and with no current section: no edge.
  expect([combines({ ...inS, pendingStory: ['hall_voice' as KnotName] }), combines({ ...inS, section: null })]).toEqual([[], []]); // a fixture knot name
});

test('combine: the soft-lock proof takes a combine edge', () => {
  // The hall's door takes the vase only the recipe gives.
  const src = source(
    rawWorld({ s: ['hall', { hall: room([take('shard', 'shard'), take('glue', 'glue'), exit('door', { story: 'after' }, lock(['vase']))]) }] }, ['shard', 'glue', 'vase'], [
      recipe('shard', 'glue', 'vase'),
    ]),
  );
  // With the decoded `mods` the proof takes the combine, so every state reaches the door.
  expect(checkWorld(kernel(src), FILE).flatMap((c) => c.findings)).toEqual([]);
  // Without them nothing gives the vase: the guard on the proof path.
  // @ts-expect-error -- the public body alone is no proof world (KernelWorld.mods); kept as the runtime guard
  expect(checkWorld(toPublic(src), FILE).flatMap((c) => c.findings.map((f) => f.code))).toEqual(['world/softlock']);
});

test('combine: a soft-lock path names its combine step', () => {
  // The recipe consumes the shard the door's lock needs.
  const src = source(
    rawWorld({ s: ['hall', { hall: room([take('shard', 'shard'), take('glue', 'glue'), exit('door', { story: 'after' }, lock(['shard']))]) }] }, ['shard', 'glue', 'vase'], [
      recipe('shard', 'glue', 'vase'),
    ]),
  );
  expect(checkWorld(kernel(src), FILE).flatMap((c) => c.findings.map((f) => f.message))).toEqual([
    'section s: a reachable state cannot reach a leave (stuck in hall): tap hall.shard → tap hall.glue → combine glue + shard',
  ]);
});

test("combine: a section reset clears its recipe's product", () => {
  const w = kernel(source(hall([recipe('shard', 'glue', 'vase')])));
  const { states, result } = reach(w);
  expect(result).toBe('exhausted');
  // The positive control: the search reaches the recipe's run.
  const made = states.find((s) => s.held.includes(it('vase')));
  expect([made?.held, made?.used]).toEqual([['vase'], ['shard', 'glue']]);
  // The reset clears the product with the inputs' facts: the state the build started from.
  const reset = made === undefined ? null : resetSection(w, made, S);
  expect([reset?.held, reset?.used, reset?.taken]).toEqual([[], [], []]);
  // X9's start premise: re-entering S from any state play reaches gives the start's key.
  const key = sectionKey(w, states[0] ?? EMPTY_WORLD_STATE, S);
  expect(states.map((s) => sectionKey(w, sectionEntry(w, s, S), S)).filter((x) => x !== key)).toEqual([]);
  // S's own facts: the kernel's scope plus the product (a world without recipes adds nothing: the kernel's own object).
  expect([ownScope(w, S).items.has(it('vase')), sectionScope(w, S).items.has(it('vase'))]).toEqual([true, false]);
  const plain = kernel(source(hall([])));
  expect(ownScope(plain, S)).toBe(sectionScope(plain, S));
});

test("combine: the section key reads a recipe's when", () => {
  // `examined` is an atom no core rule reads (core's key ignores it): only the recipe's `when` puts it in S's key.
  const w = kernel(
    source(
      rawWorld({ s: ['hall', { hall: room([look('painting'), take('shard', 'shard'), take('glue', 'glue'), exit('out', { story: 'end' })]) }] }, ['shard', 'glue', 'vase'], [
        recipe('shard', 'glue', 'vase', { when: { examined: 'hall.painting' } }),
      ]),
    ),
  );
  const start = sectionEntry(w, EMPTY_WORLD_STATE, S);
  let edges = 0;
  searchSection(w, start, S, RESUME_STATE_CAP, {
    onEdge: (_from, succ) => {
      edges += succ.step.kind === 'combine' ? 1 : 0;
    },
  });
  // The search reaches a state where the painting was looked at with both items held, so it takes the combine.
  expect(edges).toBeGreaterThan(0);
  // The look is a state of its own for S's key.
  expect(sectionKey(w, reduce(w, start, tap('hall.painting')).state, S)).not.toBe(sectionKey(w, start, S));
});
