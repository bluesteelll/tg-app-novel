// Module `flags` (engine plan §6.5): a `{ set }` effect sets a declared flag once, at its source index among its
// trigger's kernel effects; the atom `{ flag }` reads it; only its section's reset clears it. The module is reached
// only through the kernel's entry points (decode, `reduce`, `holds`, the scopes, the searches), so each test fails on its
// own line before the module exists. Every behaviour test runs its fixture in both world forms (engine plan §6.5, A1):
// the proof form `{ ...toPublic(src), mods }`, which keeps an owned effect in its kernel list at its source index, and
// the runtime form `decodeWorldPublic`, which routes it out; both carry the same `mods`, so both must run alike.
import { expect, test } from 'vitest';

import { RESUME_STATE_CAP } from '../explore/reduce.ts';
import type { ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { SectionId } from '../story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toPublic } from '../world/decode.ts';
import type { DecodeOptions, WorldIssue } from '../world/decode.ts';
import type { HotspotKey, ItemId, RoomId, WorldSource } from '../world/types.ts';
import type { DecodeCtx, FlagId, KernelWorld, MechanicData, OwnedRaw, SectionAction } from './contract.ts';
import { condReads, decodeCond } from './data/conditions.ts';
import type { Cond } from './data/conditions.ts';
import type { FlagsData } from './data/flags.ts';
import { MECHANIC_DATA } from './data/index.ts';
import { holds } from './rules/conditions.ts';
import { actions, reduce } from './rules/core.ts';
import { resetSection, searchSection, sectionEntry, sectionKey, sectionPlaces, successors } from './rules/search.ts';
import type { SearchStats } from './rules/search.ts';
import { visualsOf } from './rules/visual.ts';

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
const look = (id: string, then: readonly Json[] = []): Json => ({ id, kind: 'look', rect: RECT, label: txt(), look: txt(id), then });
const object = (id: string, then: readonly Json[] = []): Json => ({ id, kind: 'object', rect: RECT, label: txt(), lock: null, then, look: null, prop: null });
/** An object whose lock (no puzzle) has one slot per item of `accepts`. */
const safe = (id: string, accepts: readonly string[]): Json => ({
  ...object(id),
  lock: { slots: accepts.map((a) => ({ accepts: a })), puzzle: null, locked: txt(), onOpen: [], onFail: [] },
});
/** `h` with a presence `when` (module `flags`). */
const when = (h: Json, cond: unknown): Json => ({ ...h, when: cond });
const room = (hotspots: readonly Json[], onEnter: readonly Json[] = [], extra: Json = {}): Json => ({ bg: 'room', title: txt(), onEnter, hotspots, ...extra });
const view = (of: string, hotspots: readonly Json[], onEnter: readonly Json[] = []): Json => room(hotspots, onEnter, { view: { of } });

/** The source world of `sections` (each `[start, rooms]`), an item per id of `items`, and `flags` (flag -> section). */
function rawWorld(sections: Readonly<Record<string, readonly [string, Readonly<Record<string, Json>>]>>, items: readonly string[] = [], flags?: Readonly<Record<string, string>>): Json {
  return {
    format: 1,
    items: Object.fromEntries(items.map((id) => [id, { name: txt(id), desc: txt(id), glyph: 'key' }])),
    docs: {},
    puzzles: {},
    sections: Object.fromEntries(Object.entries(sections).map(([id, [start, rooms]]) => [id, { start, bgm: null, rooms }])),
    ...(flags === undefined ? {} : { flags: Object.fromEntries(Object.entries(flags).map(([f, section]) => [f, { section }])) }),
  };
}

function source(raw: Json, o: DecodeOptions = {}): WorldSource {
  const r = decodeWorldSource(raw, o);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** One world form: its name (in every assertion's message) and the world the rules read. */
type Form = { readonly form: 'proof' | 'runtime'; readonly w: KernelWorld };

/**
 * Both world forms of one source (A1): the proof form `{ ...toPublic(src), mods }` (the story gate, the playthroughs,
 * the spike) and the runtime form `decodeWorldPublic` (the app's `ch.world`). Both carry the same `mods`.
 */
function forms(raw: Json, o: DecodeOptions = {}): readonly Form[] {
  const src = source(raw, o);
  const r = decodeWorldPublic({ ...structuredClone(toPublic(src, o)), version: '0123456789abcdef' }, o);
  if (!r.ok) {
    throw new Error(`invariant: the public world decodes: ${JSON.stringify(r.error)}`);
  }
  return [
    { form: 'proof', w: { ...toPublic(src, o), mods: src.mods } },
    { form: 'runtime', w: r.value },
  ];
}

const S = 's' as SectionId;
const T = 't' as SectionId;
const k = (s: string) => s as HotspotKey;
const rm = (s: string) => s as RoomId;
const it = (s: string) => s as ItemId;
const fl = (s: string) => s as FlagId;
const tap = (hotspot: string): SectionAction => ({ kind: 'tap', hotspot: k(hotspot) });
const insert = (hotspot: string, item: string): SectionAction => ({ kind: 'insert', hotspot: k(hotspot), item: it(item) });

/** A state in `roomId` of `section` (default `s`). */
function at(roomId: string, extra: Partial<WorldState> = {}, section: SectionId = S): WorldState {
  return { ...structuredClone(EMPTY_WORLD_STATE), section, room: rm(roomId), lastRoom: { [section]: rm(roomId) }, visited: [rm(roomId)], ...extra };
}

/** The writer's fact cues of a list, as `<kind>:<id>:<change>`, in record order. */
function factCues(effects: readonly ExploreEffect[]): string[] {
  return effects.flatMap((e) => (e.kind === 'cue' && e.cue.kind === 'fact' ? [`${e.cue.fact.kind}:${e.cue.fact.id}:${e.cue.change}`] : []));
}

/** The writer's `flag` fact cues of a list, whole. */
function flagCues(effects: readonly ExploreEffect[]): unknown[] {
  return effects.flatMap((e) => (e.kind === 'cue' && e.cue.kind === 'fact' && e.cue.fact.kind === 'flag' ? [e.cue] : []));
}

/** S's search from its entry: `[result, states, expansions, work, bound]`, and every successor state an edge met. */
function searched(w: KernelWorld, section: SectionId = S): { row: unknown[]; met: WorldState[] } {
  const met: WorldState[] = [];
  let stats = null as SearchStats | null; // written by `onStats`, which runs once before the search returns
  const r = searchSection(w, sectionEntry(w, EMPTY_WORLD_STATE, section), section, RESUME_STATE_CAP, {
    onEdge: (_from, succ) => {
      met.push(succ.state);
    },
    onStats: (x) => {
      stats = x;
    },
  });
  return { row: [r.result, r.states, stats?.expansions, stats?.work, stats?.bound], met };
}

/** The hotspots of room `room` of section `section` in a public body read as JSON. */
function spotsOf(body: Json, section: string, room: string): Json[] {
  const sections = body['sections'] as Record<string, { rooms: Record<string, { hotspots: Json[] }> }>; // the source format's nesting
  return sections[section]?.rooms[room]?.hotspots ?? [];
}

/** The issues of a decode, as `<path> <reason>`, sorted. */
function issues(r: { ok: true } | { ok: false; error: readonly WorldIssue[] }): string[] {
  return r.ok ? [] : r.error.map((i) => `${i.path} ${i.reason}`).sort();
}

const CTX: DecodeCtx = {
  text: () => {
    throw new Error('invariant: no condition decodes a text');
  },
};

function cond(raw: unknown): Cond {
  const r = decodeCond(raw, CTX, 'when');
  if (!r.ok) {
    throw new Error(`invariant: ${JSON.stringify(raw)} decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

// ---------------------------------------------------------------------------------------------------------------
// C1: the set effect, the atom, the reset, the runner's two forms

/** One section: the hall's look `mark` sets `f` and nothing else; `f` is declared in `s`. */
const markWorld = (): Json => rawWorld({ s: ['hall', { hall: room([look('mark', [{ set: 'f' }]), exit('out', { story: 'end' })]) }] }, [], { f: 's' });

test('flags: a set effect sets a flag once', () => {
  for (const { form, w } of forms(markWorld())) {
    const s = at('hall');
    const first = reduce(w, s, tap('hall.mark'));
    // A set-only trigger fires: its `fired` key and its flag, one flag cue with the tap's cause, via the trigger.
    expect(first.state.fired, form).toEqual(['then:hall.mark']);
    expect(first.state.flags, form).toEqual(['f']);
    expect(flagCues(first.effects), form).toEqual([
      { kind: 'fact', fact: { kind: 'flag', id: 'f' }, change: 'added', cause: { verb: 'tap', at: 'hall.mark', item: null, via: 'then:hall.mark' } },
    ]);
    // Fire-once: a second tap changes nothing and records no flag cue.
    const again = reduce(w, first.state, tap('hall.mark'));
    expect(again.state, form).toBe(first.state);
    expect(flagCues(again.effects), form).toEqual([]);
  }
});

test('flags: module effects run at their source indices', () => {
  const raw = rawWorld({ s: ['hall', { hall: room([object('box', [{ give: 'x' }, { set: 'f' }, { story: 'k' }]), exit('out', { story: 'end' })]) }] }, ['x'], { f: 's' });
  for (const { form, w } of forms(raw)) {
    const r = reduce(w, at('hall'), tap('hall.box'));
    // The set between the give and the story: the writer records the source order.
    expect(factCues(r.effects), form).toEqual(['fired:then:hall.box:added', 'held:x:added', 'flag:f:added', 'story:k:added']);
    expect([r.state.held, r.state.flags, r.state.pendingStory], form).toEqual([['x'], ['f'], ['k']]);
  }
});

test('flags: the declarations and set effects decode, every fault in one pass', () => {
  // The clean world decodes with its declarations and its set at `<trigger>#<source index>`.
  const raw = rawWorld({ s: ['hall', { hall: room([object('box', [{ give: 'x' }, { set: 'f' }]), exit('out', { story: 'end' })], [{ set: 'g' }]) }] }, ['x'], { f: 's', g: 's' });
  const src = source(raw);
  const d: FlagsData = src.mods.flags;
  expect(d.flags).toEqual({ f: { section: 's' }, g: { section: 's' } });
  expect(d.sets).toEqual({ 'enter:hall#0': 'g', 'then:hall.box#1': 'f' });
  // Plain JSON (the version hash and the text walk read it as data).
  expect(d).toStrictEqual(JSON.parse(JSON.stringify(d)));
  // decode(encode(d)) = d: the public body carries the module's keys back where they were written.
  const body = structuredClone(toPublic(src)) as unknown as Json; // the public body, as JSON
  expect(body['flags']).toEqual({ f: { section: 's' }, g: { section: 's' } });
  const back = decodeWorldPublic({ ...body, version: '0123456789abcdef' });
  expect(back.ok && back.value.mods.flags).toEqual(d);
  // Every fault in one pass: the declarations' shapes and ids, a set's id.
  const bad = rawWorld({ s: ['hall', { hall: room([look('mark', [{ set: 'Bad' }, { set: 3 }]), exit('out', { story: 'end' })]) }] });
  bad['flags'] = { Bad: { section: 's' }, a: 'x', b: { section: 's', when: null }, c: {}, d: { section: 'Hall' } };
  expect(issues(decodeWorldSource(bad))).toEqual(
    [
      'flags.Bad id',
      'flags.a shape',
      'flags.b shape',
      'flags.c.section shape',
      'flags.d.section id',
      'sections.s.rooms.hall.hotspots.0.then.0.set id',
      'sections.s.rooms.hall.hotspots.0.then.1.set id',
    ].sort(),
  );
  const notObject = rawWorld({ s: ['hall', { hall: room([exit('out', { story: 'end' })]) }] });
  notObject['flags'] = [];
  expect(issues(decodeWorldSource(notObject))).toEqual(['flags shape']);
  // A world without flags: the defaults, and its body is the kernel's own (no `OwnedAt`, no key).
  const none = source(rawWorld({ s: ['hall', { hall: room([exit('out', { story: 'end' })]) }] }));
  const entry = MECHANIC_DATA.find((m) => m.id === 'flags');
  expect(entry?.encode(none.mods.flags)).toEqual([]);
  expect(Object.keys(toPublic(none))).toEqual(['format', 'items', 'docs', 'puzzles', 'sections']);
});

test('flags: a flag atom holds when its flag is set', () => {
  const w = forms(markWorld())[0]?.w;
  if (w === undefined) {
    throw new Error('invariant: two forms');
  }
  const c = cond({ flag: 'f' });
  expect(condReads(c)).toEqual([{ kind: 'flag', id: 'f' }]);
  const set = at('hall', { flags: [fl('f')] });
  expect([holds(w, set, c), holds(w, at('hall'), c)]).toEqual([true, false]);
  expect([holds(w, set, cond({ not: { flag: 'f' } })), holds(w, set, cond({ flag: 'g' }))]).toEqual([false, false]);
  // The atom's value is a flag id.
  const bad = decodeCond({ flag: 'F' }, CTX, 'when');
  expect(bad.ok ? [] : bad.error.map((i) => `${i.path} ${i.reason}`)).toEqual(['when.flag id']);
});

test('flags: a section reset clears its own flags', () => {
  // Two sections, each declaring one flag that its hall's look sets.
  const raw = rawWorld(
    {
      s: ['hall', { hall: room([look('mark', [{ set: 'fs' }]), exit('out', { story: 'end' })]) }],
      t: ['yard', { yard: room([look('mark', [{ set: 'ft' }]), exit('out', { story: 'end' })]) }],
    },
    [],
    { fs: 's', ft: 't' },
  );
  for (const { form, w } of forms(raw)) {
    const played = reduce(w, at('hall', { flags: [fl('ft')] }), tap('hall.mark')).state;
    expect(played.flags, form).toEqual(['ft', 'fs']);
    // S's reset drops S's flag and keeps T's.
    expect(resetSection(w, played, S).flags, form).toEqual(['ft']);
    expect(resetSection(w, played, T).flags, form).toEqual(['fs']);
    // The restart (`sectionEntry`, what `restart` reduces) reaches the state the build started from, T's facts aside.
    expect(sectionEntry(w, played, S), form).toEqual(sectionEntry(w, { ...EMPTY_WORLD_STATE, flags: [fl('ft')] }, S));
  }
});

test('search: a view whose onEnter sets a flag keeps its own place', () => {
  // The desk is a view of the hall entered by a lockless exit: with an onEnter that only sets a flag, every arrival
  // writes the flag and the trigger's `fired` key, so it keeps its own place (b); without it, it merges.
  const raw = (onEnter: readonly Json[]): Json =>
    rawWorld({ s: ['hall', { hall: room([exit('to_desk', 'desk'), exit('out', { story: 'end' })]), desk: view('hall', [look('pad')], onEnter) }] }, [], { f: 's' });
  for (const { form, w } of forms(raw([{ set: 'f' }]))) {
    expect(sectionPlaces(w, S), form).toEqual({});
  }
  for (const { form, w } of forms(raw([]))) {
    expect(sectionPlaces(w, S), form).toEqual({ desk: 'hall' });
  }
});

/** A data-only module that owns the effect key `echo` (no rules half: nothing runs it). */
const ECHO: MechanicData<'echo', OwnedRaw> = {
  id: 'echo',
  rules: 'none',
  owns: { effect: ['echo'] },
  decode: (raw) => ({ ok: true, value: raw }),
  encode: (d) => d,
  normalize: (_w, s) => s,
};
const ECHOED: DecodeOptions = { mechanics: [...MECHANIC_DATA, ECHO] };

/** The hall's look `mark` with one owned effect only, and its object `box` with one between two kernel effects. */
const twoTriggers = (own: Json, flags?: Readonly<Record<string, string>>): Json =>
  rawWorld({ s: ['hall', { hall: room([look('mark', [own]), object('box', [{ give: 'x' }, own, { story: 'k' }]), exit('out', { story: 'end' })]) }] }, ['x'], flags);

/** Each form's state and effects after one tap on each hotspot (then a second), and its search row. */
function playOf(w: KernelWorld): unknown[] {
  const out: unknown[] = [];
  for (const h of ['hall.mark', 'hall.box']) {
    const first = reduce(w, at('hall'), tap(h));
    const second = reduce(w, first.state, tap(h));
    out.push(first.state, first.effects, second.state, second.effects);
  }
  return [...out, searched(w).row];
}

test('flags: both world forms run module effects alike', () => {
  // Part 1: a data module that owns an effect key and has no rules half. The proof form keeps its entry in the kernel
  // lists; the runtime form routes it out. Its key is no kernel effect, so neither form runs it.
  const [proof, runtime] = forms(twoTriggers({ echo: 1 }), ECHOED);
  if (proof === undefined || runtime === undefined) {
    throw new Error('invariant: two forms');
  }
  const thenOf = (w: KernelWorld, h: string): unknown[] => {
    const spot = w.sections[S]?.rooms[rm('hall')]?.hotspots.find((x) => x.id === h);
    return spot === undefined || spot.kind === 'exit' ? [] : [...spot.then];
  };
  // Non-vacuous: the proof form's lists hold the owned entry, the runtime form's do not.
  expect([thenOf(proof.w, 'mark').length, thenOf(proof.w, 'box').length, thenOf(runtime.w, 'mark').length, thenOf(runtime.w, 'box').length]).toEqual([1, 3, 0, 2]);
  expect(playOf(proof.w)).toEqual(playOf(runtime.w));
  // Part 2: the real module's set, in both triggers.
  const [p2, r2] = forms(twoTriggers({ set: 'f' }, { f: 's' }));
  if (p2 === undefined || r2 === undefined) {
    throw new Error('invariant: two forms');
  }
  expect([thenOf(p2.w, 'mark').length, thenOf(r2.w, 'mark').length]).toEqual([1, 0]);
  expect(playOf(p2.w)).toEqual(playOf(r2.w));
  // Non-vacuous: the search meets a state holding the flag, in both forms.
  for (const { form, w } of [p2, r2]) {
    expect(searched(w).met.some((s) => s.flags.includes(fl('f'))), form).toBe(true);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// C2: a hotspot's `when`, its presence

const HALL = 'sections.s.rooms.hall.hotspots';

test('flags: a hotspot when decodes as a gating condition', () => {
  // Any gating condition (a flag atom, a kernel atom, a combinator); `null` is the default, always present.
  const gate = { all: [{ flag: 'f' }, { not: { held: 'key' } }] };
  const raw = rawWorld({ s: ['hall', { hall: room([look('mark', [{ set: 'f' }]), when(look('vase'), gate), when(look('urn'), null), exit('out', { story: 'end' })]) }] }, ['key'], { f: 's' });
  const src = source(raw);
  expect(src.mods.flags.when).toEqual({ 'hall.vase': gate });
  // The round trip writes the condition back where it was written, and nothing for `null`.
  const body = structuredClone(toPublic(src)) as unknown as Json; // the public body, as JSON
  const spots = spotsOf(body, 's', 'hall');
  expect([spots[1]?.['when'], spots[2] !== undefined && Object.hasOwn(spots[2], 'when')]).toEqual([gate, false]);
  const back = decodeWorldPublic({ ...body, version: '0123456789abcdef' });
  expect(back.ok && back.value.mods.flags).toEqual(src.mods.flags);
  // `decodeCond`'s faults at the hotspot's own path, every one in one pass.
  const bad = rawWorld({ s: ['hall', { hall: room([when(look('a'), { flag: 'F' }), when(look('b'), { all: [] }), when(look('c'), { bogus: 1 }), when(look('d'), 3)]) }] });
  expect(issues(decodeWorldSource(bad))).toEqual([`${HALL}.0.when.flag id`, `${HALL}.1.when.all shape`, `${HALL}.2.when shape`, `${HALL}.3.when shape`].sort());
});

/** The hall's look `mark` sets `f`; its safe (one slot, for the key) is present only while `f` is set; the den's
 *  chest is the same lock in another room. The player starts holding the key. */
const safeWorld = (): Json =>
  rawWorld(
    {
      s: [
        'hall',
        {
          hall: room([look('mark', [{ set: 'f' }]), when(safe('safe', ['key']), { flag: 'f' }), exit('to_den', 'den'), exit('out', { story: 'end' })]),
          den: room([safe('chest', ['key']), exit('to_hall', 'hall')]),
        },
      ],
    },
    ['key'],
    { f: 's' },
  );

test('flags: a gated hotspot is no action until its flag is set', () => {
  for (const { form, w } of forms(safeWorld())) {
    const s = at('hall', { held: [it('key')] });
    const on = (list: readonly SectionAction[]): unknown[] => list.filter((a) => 'hotspot' in a && a.hotspot === k('hall.safe'));
    expect(on(actions(w, s)), form).toEqual([]);
    // A stale tap: no effect and the same state, as a tap on another room's hotspot.
    const tapped = reduce(w, s, tap('hall.safe'));
    expect([tapped.state === s, tapped.effects], form).toEqual([true, []]);
    expect(tapped.effects, form).toEqual(reduce(w, s, tap('den.chest')).effects);
    // A stale insert: the same state and the base's refusal, as a stale insert on a lock of another room.
    const inserted = reduce(w, s, insert('hall.safe', 'key'));
    expect(inserted.state, form).toBe(s);
    expect(inserted.effects, form).toEqual([
      { kind: 'refused', at: 'hall.safe', item: 'key', reason: 'no-fit' },
      { kind: 'cue', cue: { kind: 'module', module: 'core', name: 'refused', at: 'hall.safe', item: 'key' } },
    ]);
    expect(JSON.stringify(inserted.effects), form).toBe(JSON.stringify(reduce(w, s, insert('den.chest', 'key')).effects).replaceAll('den.chest', 'hall.safe'));
    // Once the setter fires, both are listed and accepted.
    const lit = reduce(w, s, tap('hall.mark')).state;
    expect(on(actions(w, lit)), form).toEqual([tap('hall.safe'), insert('hall.safe', 'key')]);
    expect(reduce(w, lit, tap('hall.safe')).effects.filter((e) => e.kind === 'lock'), form).toEqual([{ kind: 'lock', hotspot: 'hall.safe' }]);
    expect(reduce(w, lit, insert('hall.safe', 'key')).state.open, form).toEqual(['hall.safe']);
  }
});

test('flags: a gated hotspot draws nothing and takes no use until its flag is set', () => {
  // The statue has a picture and a `use` rule for the key; it is present only while `f` is set.
  const statue = { ...when(object('statue'), { flag: 'f' }), prop: 'statue', uses: [{ item: 'key', do: [{ give: 'gem' }] }] };
  const raw = rawWorld({ s: ['hall', { hall: room([look('mark', [{ set: 'f' }]), statue, exit('out', { story: 'end' })]) }] }, ['key', 'gem'], { f: 's' });
  const use: SectionAction = { kind: 'use', item: it('key'), target: k('hall.statue') };
  for (const { form, w } of forms(raw)) {
    const s = at('hall', { held: [it('key')] });
    const drawn = (x: WorldState): string[] => visualsOf(w, x, rm('hall')).map((v) => v.at);
    const uses = (x: WorldState): unknown[] => successors(w, x).flatMap((n) => (n.step.kind === 'use' ? [n.step] : []));
    expect([drawn(s), uses(s)], form).toEqual([[], []]);
    // A stale use is refused with no effect.
    const stale = reduce(w, s, use);
    expect([stale.state === s, stale.effects], form).toEqual([true, []]);
    const lit = reduce(w, s, tap('hall.mark')).state;
    expect([drawn(lit), uses(lit)], form).toEqual([['hall.statue'], [use]]);
    expect(reduce(w, lit, use).state.held, form).toEqual(['gem']);
  }
});

test('flags: a flag a hotspot when reads is part of the section key', () => {
  // `g` gates the vase; `u` is declared in the section and read by nothing.
  const raw = rawWorld({ s: ['hall', { hall: room([look('mark', [{ set: 'g' }]), when(look('vase'), { flag: 'g' }), exit('out', { story: 'end' })]) }] }, [], { g: 's', u: 's' });
  for (const { form, w } of forms(raw)) {
    const s = at('hall');
    expect(sectionKey(w, at('hall', { flags: [fl('g')] }), S), form).not.toBe(sectionKey(w, s, S));
    // The positive control: an unread flag splits no state.
    expect(sectionKey(w, at('hall', { flags: [fl('u')] }), S), form).toBe(sectionKey(w, s, S));
  }
});

test('search: a view behind a gated entry keeps its own place', () => {
  // Both views have a lockless zoom entry from the hall; the desk's shows only once `f` is set, so entering it is no
  // free move (a2): the desk keeps its own place, and the ungated shelf merges.
  const raw = rawWorld(
    {
      s: [
        'hall',
        {
          hall: room([look('mark', [{ set: 'f' }]), when(exit('to_desk', 'desk'), { flag: 'f' }), exit('to_shelf', 'shelf'), exit('out', { story: 'end' })]),
          desk: view('hall', [look('pad')]),
          shelf: view('hall', [look('box')]),
        },
      ],
    },
    [],
    { f: 's' },
  );
  for (const { form, w } of forms(raw)) {
    expect(sectionPlaces(w, S), form).toEqual({ shelf: 'hall' });
  }
});
