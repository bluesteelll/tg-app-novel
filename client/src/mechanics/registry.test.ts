import { expect, test, vi } from 'vitest';

import { RESUME_STATE_CAP, runOf, worldIndex } from '../explore/reduce.ts';
import type { Draft, ExploreAction } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { DocId, HotspotKey, ItemId, RoomId, WorldPublicBody } from '../world/types.ts';
import { KERNEL_FACT_KINDS } from './contract.ts';
import type { Cause, MechanicData, MechanicId, MechanicRules, RulesRegistry, SectionAction, Writer } from './contract.ts';
import { MECHANIC_DATA } from './data/index.ts';
import { reduce } from './rules/core.ts';
import { APPLY, MECHANIC_RULES } from './rules/index.ts';
import { searchSection, sectionEntry, successors } from './rules/search.ts';
import { createWriter } from './rules/writer.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture worlds: written in the source format and decoded (the same builder shape as explore/explore.test.ts).

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (owner = 'w'): Json => ({ id: `ch1.${owner}.${(lineCounter++).toString(36).padStart(4, '0')}`, ru: owner });
const RECT = [100, 200, 200, 200];
const look = (id: string, then: Json[] = []): Json => ({ id, kind: 'look', rect: RECT, label: txt(), look: txt(id), then });
const object = (id: string, then: Json[] = [], lock: Json | null = null): Json => ({ id, kind: 'object', rect: RECT, label: txt(), lock, then, look: txt(id), prop: null });
const exit = (id: string, to: string | { story: string }): Json => ({
  id,
  kind: 'exit',
  rect: RECT,
  label: txt(),
  to: typeof to === 'string' ? { room: to } : to,
  lock: null,
  sfx: null,
});
/** A zero-slot lock that opens with its puzzle. */
const puzzleLock = (puzzle: string): Json => ({ slots: [], puzzle, locked: txt(), onOpen: [], onFail: [] });
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
  hints: [txt()],
});

/** A one-section world (`s`, starting in `hall`) over the given rooms. */
function world(rooms: Record<string, Json>, spec: { items?: string[]; puzzles?: Record<string, Json> } = {}): WorldPublicBody {
  const raw = {
    format: 1,
    items: Object.fromEntries((spec.items ?? []).map((id) => [id, { name: txt(), desc: txt(), glyph: 'key' }])),
    docs: {},
    puzzles: spec.puzzles ?? {},
    sections: { s: { start: 'hall', bgm: null, rooms } },
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return toPublic(r.value);
}

const S = 's' as SectionId;
const k = (s: string) => s as HotspotKey;
const rm = (s: string) => s as RoomId;
const it = (s: string) => s as ItemId;
const pz = (s: string) => s as PuzzleLocalId;
const kn = (s: string) => s as KnotName;
const tap = (hotspot: string): ExploreAction => ({ kind: 'tap', hotspot: k(hotspot) });

/** A state in `roomId` of section `s`. */
function at(roomId: string, extra: Partial<WorldState> = {}): WorldState {
  return { ...structuredClone(EMPTY_WORLD_STATE), section: S, room: rm(roomId), lastRoom: { [S]: rm(roomId) }, visited: [rm(roomId)], ...extra };
}

// ---------------------------------------------------------------------------------------------------------------
// The registry checks (engine plan §3.2 "Exhaustiveness"), test-local functions over a registry parameter, so the real
// tuples and the fixtures run the same checks.

type DataEntry = Pick<MechanicData<string, unknown, unknown>, 'id' | 'rules' | 'owns'>;
type RulesEntry = { readonly id: string; readonly cues: readonly string[] };

/** The `fired` prefixes the kernel's `triggerOf` resolves (explore/reconcile.ts): no module may own one. */
const KERNEL_TRIGGER_PREFIXES = ['enter', 'then', 'open', 'fail'] as const;
const PLACES = ['world', 'item', 'room', 'hotspot', 'slot', 'effect'] as const;

/** Every key owned twice: per place, trigger prefixes (a kernel prefix included), atom kinds, fact kinds, cue names. */
function ownershipProblems(data: readonly DataEntry[], rules: readonly RulesEntry[]): string[] {
  const problems: string[] = [];
  const once = (what: string, entries: ReadonlyArray<readonly [owner: string, key: string]>): void => {
    const owners = new Map<string, string>();
    for (const [owner, key] of entries) {
      const first = owners.get(key);
      if (first === undefined) {
        owners.set(key, owner);
      } else {
        problems.push(`${what} '${key}' owned by ${first} and ${owner}`);
      }
    }
  };
  for (const place of PLACES) {
    once(`${place} key`, data.flatMap((m) => (m.owns[place] ?? []).map((key) => [m.id, key] as const)));
  }
  once('trigger prefix', [
    ...KERNEL_TRIGGER_PREFIXES.map((p) => ['the kernel', p] as const),
    ...data.flatMap((m) => (m.owns.trigger === undefined ? [] : [[m.id, m.owns.trigger] as const])),
  ]);
  once('atom kind', data.flatMap((m) => (m.owns.atoms ?? []).map((key) => [m.id, key] as const)));
  once('fact kind', data.flatMap((m) => (m.owns.facts ?? []).map((key) => [m.id, key] as const)));
  for (const r of rules) {
    once(`cue name of ${r.id}`, r.cues.map((c) => [r.id, c] as const));
  }
  return problems;
}

/** The rules ids must be the data ids whose rules half is a chunk, in the data registry's order. */
function alignmentProblems(data: readonly DataEntry[], rules: readonly RulesEntry[]): string[] {
  const chunked = data.filter((m) => m.rules === 'chunk').map((m) => m.id);
  const ids = rules.map((r) => r.id);
  const problems: string[] = [];
  for (let i = 0; i < Math.max(chunked.length, ids.length); i++) {
    if (chunked[i] !== ids[i]) {
      problems.push(`rules entry ${i}: ${ids[i] ?? '(none)'}, data expects ${chunked[i] ?? '(none)'}`);
    }
  }
  return problems;
}

const data = (id: string, owns: DataEntry['owns'], rules: DataEntry['rules'] = 'chunk'): DataEntry => ({ id, rules, owns });

/** The action kinds a rules entry's `actions` emits. */
type KindsOf<R> = R extends { actions(w: never, s: never): readonly (infer A)[] } ? (A extends { readonly kind: infer K } ? K : never) : never;
/** Every action kind two entries of a rules tuple share; never when each kind has one module (dispatch is by kind). */
type SharedKinds<T extends readonly unknown[]> = T extends readonly [infer H, ...infer Rest] ? (KindsOf<H> & KindsOf<Rest[number]>) | SharedKinds<Rest> : never;
type Unique<T extends readonly unknown[]> = [SharedKinds<T>] extends [never] ? true : false;

test('mechanics: every key has one owner', () => {
  expect(ownershipProblems(MECHANIC_DATA, MECHANIC_RULES)).toEqual([]);
  // Core declares the kernel's fact kinds, so a module that claims one is caught by the same check.
  expect(MECHANIC_DATA[0].owns.facts).toEqual(KERNEL_FACT_KINDS);
  const fixtures: ReadonlyArray<readonly [DataEntry[], RulesEntry[], string]> = [
    [[...MECHANIC_DATA, data('dup', { facts: ['held'] })], [], "fact kind 'held' owned by core and dup"],
    [[data('dup', { trigger: 'open' })], [], "trigger prefix 'open' owned by the kernel and dup"],
    [[data('a', { trigger: 'turn' }), data('b', { trigger: 'turn' })], [], "trigger prefix 'turn' owned by a and b"],
    [[data('rotate', { hotspot: ['rotate'] }), data('turn', { hotspot: ['rotate'] })], [], "hotspot key 'rotate' owned by rotate and turn"],
    [[data('a', { item: ['uses', 'uses'] })], [], "item key 'uses' owned by a and a"],
    [[data('a', { effect: ['flag'] }), data('b', { effect: ['flag'] })], [], "effect key 'flag' owned by a and b"],
    [[data('a', { atoms: ['flag'] }), data('b', { atoms: ['flag'] })], [], "atom kind 'flag' owned by a and b"],
    [[], [{ id: 'a', cues: ['turned', 'turned'] }], "cue name of a 'turned' owned by a and a"],
  ];
  for (const [d, r, expected] of fixtures) {
    expect(ownershipProblems(d, r), expected).toEqual([expected]);
  }
  // Action kinds are types, not data: the dispatch map is keyed by kind, so two modules that emit one kind fail check.
  const realKindsUnique: Unique<typeof MECHANIC_RULES> = true;
  type Twin = { actions(w: never, s: never): readonly { readonly kind: 'insert' }[] };
  // @ts-expect-error -- core and the fixture both emit the action kind 'insert'
  const sharedKindCaught: Unique<readonly [(typeof MECHANIC_RULES)[0], Twin]> = true;
  expect([realKindsUnique, sharedKindCaught]).toEqual([true, true]);
});

test('mechanics: data and rules registries align', () => {
  expect(alignmentProblems(MECHANIC_DATA, MECHANIC_RULES)).toEqual([]);
  const pair = [data('a', {}), data('labels', {}, 'none'), data('b', {})];
  expect(alignmentProblems(pair, [{ id: 'a', cues: [] }, { id: 'b', cues: [] }])).toEqual([]);
  // Swapped: the same ids in another order.
  expect(alignmentProblems(pair, [{ id: 'b', cues: [] }, { id: 'a', cues: [] }])).toEqual([
    'rules entry 0: b, data expects a',
    'rules entry 1: a, data expects b',
  ]);
  // A data-only module never has a rules entry.
  expect(alignmentProblems(pair, [{ id: 'a', cues: [] }, { id: 'labels', cues: [] }, { id: 'b', cues: [] }])).toEqual([
    'rules entry 1: labels, data expects b',
    'rules entry 2: b, data expects (none)',
  ]);
});

test('writer: a set records the added and removed members', () => {
  const w = world({ hall: room([look('statue')]) }, { items: ['a', 'b', 'c'], puzzles: { p: code(2) } });
  const s = at('hall', { held: [it('a'), it('b')] });
  const d: Draft = { s, effects: [], ix: worldIndex(w) };
  const out = createWriter(d, w, MECHANIC_RULES);
  const cause: Cause = { verb: 'tap', at: k('hall.statue'), item: null, via: null };
  // Removed members in the old order, then added members in the new order, each with the cause.
  out.set('held', [it('a'), it('c')], cause);
  expect(out.changes).toEqual([
    { kind: 'held', id: 'b', change: 'removed', cause },
    { kind: 'held', id: 'c', change: 'added', cause },
  ]);
  expect(out.state.held).toEqual(['a', 'c']);
  expect(d.s).toBe(out.state);
  // The fact kinds of the renamed fields.
  out.set('docs', ['letter' as DocId], cause);
  out.set('pendingStory', ['voice' as KnotName], cause);
  expect(out.changes.slice(2)).toEqual([
    { kind: 'doc', id: 'letter', change: 'added', cause },
    { kind: 'story', id: 'voice', change: 'added', cause },
  ]);
  // An unchanged value records nothing and keeps the state object.
  const before = out.state;
  out.set('held', [it('a'), it('c')], cause);
  out.run(pz('p'), { outcome: null, attempts: 0, hintsOpened: 0 }, cause);
  expect(out.changes).toHaveLength(4);
  expect(out.state).toBe(before);
  // A run: its outcome, attempts and hints opened.
  const solve: Cause = { verb: 'solve', at: null, item: null, via: null };
  out.run(pz('p'), { outcome: 'solved', attempts: 1, hintsOpened: 0 }, solve);
  expect(out.changes.slice(4)).toEqual([
    { kind: 'solved', id: 'p', change: 'added', cause: solve },
    { kind: 'attempt', id: 'p', change: 'added', cause: solve },
  ]);
  expect(out.state.puzzles).toEqual({ p: { outcome: 'solved', attempts: 1, hintsOpened: 0 } });
  // Effects land in the draft; module cues are recorded.
  out.effect({ kind: 'lock', hotspot: k('hall.statue') });
  expect(d.effects).toEqual([{ kind: 'lock', hotspot: 'hall.statue' }]);
  out.cue('probe' as MechanicId, 'turned', k('hall.statue'), it('a'));
  expect(out.cues).toEqual([{ module: 'probe', name: 'turned', at: 'hall.statue', item: 'a' }]);
});

test('mechanics: the rules registry loads from either module first', async () => {
  // core.ts and rules/index.ts import each other (core's `reduce` runs the registry's hooks; the registry holds core's
  // entry). Each load order must leave the registry whole: index.ts reads only core.ts's function declarations. Node
  // and the bundle throw on a `const` read across the cycle before it is initialized; vitest's module runner reads it
  // as undefined, so every member of the entry is compared, not only the functions.
  const w = world({ hall: room([look('statue')]) });
  const checkGraph = (index: typeof import('./rules/index.ts'), core: typeof import('./rules/core.ts'), use: typeof import('./rules/use.ts')): void => {
    expect(index.MECHANIC_RULES).toStrictEqual([
      { id: 'core', actions: core.actions, apply: core.applyCore, reads: core.reads, cues: ['look', 'locked', 'refused', 'reset'] },
      { id: 'use', actions: use.useActions, apply: use.applyUse, reads: use.useReads, scope: use.useScope, cues: ['refused', 'said'] },
    ]);
    expect(core.reduce(w, at('hall'), tap('hall.statue')).effects.map((e) => e.kind)).toEqual(['look', 'cue', 'dirty']);
  };
  // rules/use.ts and rules/conditions.ts sit on the cycle too (use.ts <-> core.ts, conditions.ts -> index.ts).
  const firsts = [() => import('./rules/core.ts'), () => import('./rules/index.ts'), () => import('./rules/use.ts'), () => import('./rules/conditions.ts')];
  for (const first of firsts) {
    vi.resetModules();
    await first();
    checkGraph(await import('./rules/index.ts'), await import('./rules/core.ts'), await import('./rules/use.ts'));
  }
});

/** The source of a world whose `use` data holds every form: a gated rule, a say, a keeping slot, both refusals. */
function useSource(): Json {
  const box = { ...object('box', [], { slots: [{ accepts: 'lens', keep: true }, { accepts: 'key' }], puzzle: null, locked: txt(), onOpen: [], onFail: [] }) };
  box['uses'] = [
    { item: 'key', when: { all: [{ held: 'lens' }, { not: { open: 'hall.box' } }] }, do: [{ give: 'lens' }, { story: 'voice' }], say: txt() },
    { item: 'lens', keep: true },
  ];
  return {
    format: 1,
    items: { key: { name: txt(), desc: txt(), glyph: 'key', refuse: txt() }, lens: { name: txt(), desc: txt(), glyph: 'key' } },
    docs: {},
    puzzles: {},
    sections: { s: { start: 'hall', bgm: null, rooms: { hall: { ...room([box, exit('out', { story: 'end' })]), refuse: txt() } } } },
  };
}

test('mechanics: the data registry loads from any module first', async () => {
  // data/use.ts imports data/conditions.ts (`decodeCond`), which imports data/index.ts (its default registry), which
  // holds use's entry: the same cycle as the rules registry's. index.ts builds the entry from use.ts's function
  // declarations, so each load order leaves the registry whole (every member compared: vitest's runner reads an
  // uninitialized `const` as undefined), and a decode through the freshly loaded graph reads a `when`.
  const checkData = (index: typeof import('./data/index.ts'), core: typeof import('./data/core.ts'), use: typeof import('./data/use.ts')): void => {
    expect(index.MECHANIC_DATA).toStrictEqual([
      core.core,
      {
        id: 'use',
        rules: 'chunk',
        owns: { hotspot: ['uses'], slot: ['keep'], item: ['refuse'], room: ['refuse'], trigger: 'use', facts: [] },
        decode: use.decodeUse,
        encode: use.encodeUse,
        normalize: use.normalizeUse,
      },
    ]);
  };
  const firsts = [() => import('./data/use.ts'), () => import('./data/conditions.ts'), () => import('./data/index.ts'), () => import('./data/core.ts')];
  for (const first of firsts) {
    vi.resetModules();
    await first();
    checkData(await import('./data/index.ts'), await import('./data/core.ts'), await import('./data/use.ts'));
    const decoded = (await import('../world/decode.ts')).decodeWorldSource(useSource());
    expect(decoded.ok ? decoded.value.mods.use.uses[k('hall.box')]?.[0]?.when : decoded.error).toEqual({ all: [{ held: 'lens' }, { not: { open: 'hall.box' } }] });
  }
});

/** Where `v` is not plain JSON (a Map, a Set, a class instance, a function, undefined, a non-finite number), by path. */
function notJson(v: unknown, path: string): string[] {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') {
    return [];
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? [] : [`${path}: ${String(v)}`];
  }
  if (Array.isArray(v)) {
    return v.flatMap((x, i) => notJson(x, `${path}.${i}`));
  }
  if (typeof v === 'object') {
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      return [`${path}: ${Object.prototype.toString.call(v)}`];
    }
    return Object.entries(v).flatMap(([key, x]) => notJson(x, `${path}.${key}`));
  }
  return [`${path}: ${typeof v}`];
}

test("mechanics: every module's decoded data is plain JSON", () => {
  // The text walk (`world/text-unwalked`) and the version hash read a module's `D` as data (data/index.ts's header).
  const r = decodeWorldSource(useSource());
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  const mods: Record<string, unknown> = r.value.mods;
  for (const m of MECHANIC_DATA) {
    const d = mods[m.id];
    expect(d, m.id).toStrictEqual(JSON.parse(JSON.stringify(d)));
    expect(notJson(d, m.id)).toEqual([]);
  }
  // The positive control: the fixture holds every form of `use`'s data.
  expect([Object.keys(r.value.mods.use.uses), r.value.mods.use.keep, Object.keys(r.value.mods.use.refuse.items), Object.keys(r.value.mods.use.refuse.rooms)]).toEqual([
    ['hall.box'],
    ['hall.box#0'],
    ['key'],
    ['hall'],
  ]);
  expect(notJson(new Map(), 'm')).toEqual(['m: [object Map]']);
});

// ---------------------------------------------------------------------------------------------------------------
// The hooks (engine plan §3.2): fixture modules through the registry parameter.

const [CORE] = MECHANIC_RULES;
const DIRTY = { kind: 'dirty' } as const;

test("mechanics: a dispatch over the registry needs the kernel's writer", () => {
  const w = world({ hall: room([look('statue')]) });
  const s = at('hall');
  // The registry's own `apply` type, the one the dispatch and `out.rules` walk: the kernel's writer drives core's rules.
  const apply: RulesRegistry[number]['apply'] = CORE.apply;
  const d: Draft = { s, effects: [], ix: worldIndex(w) };
  apply(w, tap('hall.statue'), createWriter(d, w, MECHANIC_RULES));
  expect(d.s.examined).toEqual(['hall.statue']);
  // A module's plain `Writer` lacks the draft, world and registry core's rules write through: the dispatch refuses it.
  const plain: Writer = { state: s, set: () => undefined, run: () => undefined, fire: () => undefined, effect: () => undefined, cue: () => undefined };
  const refused = (): void => {
    // @ts-expect-error -- a plain Writer is not the kernel's writer
    apply(w, tap('hall.statue'), plain);
  };
  expect(refused).toBeTypeOf('function'); // a type check only: never run
});

test('mechanics: a module emits only the cue names its rules half declares', () => {
  const fx = {
    id: 'fx',
    actions: () => [],
    apply: (_w, _a, out) => {
      out.cue('fx', 'ok', null, null);
      // Type checks only, never run: a name the module does not declare, and another module's id.
      const refused = (): void => {
        // @ts-expect-error -- 'other' is no cue name of module fx
        out.cue('fx', 'other', null, null);
        // @ts-expect-error -- module fx emits under its own id only
        out.cue('core', 'ok', null, null);
      };
      void refused;
    },
    reads: () => [],
    cues: ['ok'] as const,
  } satisfies MechanicRules<'fx', { kind: 'fx' }, 'ok'>;
  const w = world({ hall: room([look('statue')]) });
  const out = createWriter({ s: at('hall'), effects: [], ix: worldIndex(w) }, w, [CORE, fx]);
  fx.apply(w, { kind: 'fx' }, out);
  expect(out.cues).toEqual([{ module: 'fx', name: 'ok', at: null, item: null }]);
});

test('mechanics: every action kind has one handler', () => {
  // The registry's action kinds: a record check holds to the derived union, so a kind missing or extra fails check.
  const kinds = {
    'enter-section': true,
    'event-returned': true,
    tap: true,
    insert: true,
    'attempt-failed': true,
    'hint-opened': true,
    'puzzle-ended': true,
    use: true,
  } satisfies Record<SectionAction['kind'], true>;
  expect(Object.keys(APPLY).sort()).toEqual(Object.keys(kinds).sort());
  expect(Object.values(APPLY).every((handler) => typeof handler === 'function')).toBe(true);
  // A dispatch map without a handler for `tap` fails check.
  const { tap: _tap, ...rest } = APPLY;
  // @ts-expect-error -- the map lacks the kind `tap`
  const partial: typeof APPLY = rest;
  expect(Object.keys(partial)).not.toContain('tap');
});

test('mechanics: a hotspot a module claims routes its tap to the module', () => {
  // The statue is an object whose `then` gives a coin with a look text: core's tap would show the text and give it.
  const w = world({ hall: room([object('statue', [{ give: 'coin' }]), look('vase')]) }, { items: ['coin'] });
  const cause: Cause = { verb: 'tap', at: k('hall.statue'), item: null, via: null };
  const writers: Writer[] = [];
  const probe: MechanicRules<'probe', never, never> = {
    id: 'probe',
    actions: () => [],
    apply: () => undefined,
    reads: () => [],
    cues: [],
    tap: (_w, s, at, out) => {
      if (at !== k('hall.statue')) {
        return false;
      }
      writers.push(out);
      out.set('examined', [...s.examined, at], cause);
      return true;
    },
  };
  const registry = [CORE, probe];
  const s = at('hall');
  const r = reduce(w, s, tap('hall.statue'), registry);
  expect(r.effects).toEqual([{ kind: 'cue', cue: { kind: 'fact', fact: { kind: 'examined', id: 'hall.statue' }, change: 'added', cause } }, DIRTY]);
  expect(r.state.examined).toEqual(['hall.statue']);
  expect(r.state.held).toEqual([]);
  const [out] = writers;
  expect(writers).toHaveLength(1);
  expect(out !== undefined && 'changes' in out ? out.changes : undefined).toEqual([{ kind: 'examined', id: 'hall.statue', change: 'added', cause }]);
  // Any other hotspot: core's rules, unchanged.
  expect(reduce(w, s, tap('hall.vase'), registry)).toEqual(reduce(w, s, tap('hall.vase')));
  expect(writers).toHaveLength(1);
});

test('search: a claimed hotspot has one tap edge', () => {
  const w = world({ hall: room([object('statue', [{ give: 'coin' }]), look('vase')]) }, { items: ['coin'] });
  const probe: MechanicRules<'probe', never, never> = {
    id: 'probe',
    actions: () => [],
    apply: () => undefined,
    reads: () => [],
    cues: [],
    tap: (_w, s, at, out) => {
      if (at !== k('hall.statue')) {
        return false;
      }
      out.set('examined', [...s.examined, at], { verb: 'tap', at, item: null, via: null });
      return true;
    },
  };
  const edges = successors(w, at('hall'), [CORE, probe]).filter((x) => x.step.kind === 'tap' && x.step.hotspot === k('hall.statue'));
  expect(edges).toHaveLength(1);
  expect(edges[0]?.state.examined).toEqual(['hall.statue']);
  expect(edges[0]?.state.held).toEqual([]);
});

/** A fixture module that logs every arrival with the `fired` entries the state holds when the hook runs. */
function arrivalLogger(): { module: MechanicRules<'logger', never, never>; calls: () => Array<{ room: string; fired: readonly string[] }> } {
  const log: Array<{ room: string; fired: readonly string[] }> = [];
  return {
    module: {
      id: 'logger',
      actions: () => [],
      apply: () => undefined,
      reads: () => [],
      cues: [],
      arrived: (_w, s, room) => {
        log.push({ room, fired: s.fired });
      },
    },
    calls: () => log.splice(0),
  };
}

test('mechanics: an arrival hook runs once per room effect, after onEnter, and never while an event knot is pending', () => {
  const w = world(
    {
      hall: room([exit('to_den', 'den'), exit('to_crypt', 'crypt'), exit('out', { story: 'end' })], [{ give: 'lamp' }]),
      den: room([exit('back', 'hall')], [{ give: 'map' }]),
      crypt: room([exit('back', 'hall')], [{ story: 'crypt_voice' }]),
    },
    { items: ['lamp', 'map'] },
  );
  const { module, calls } = arrivalLogger();
  const registry = [CORE, module];
  const step = (s: WorldState, a: ExploreAction): WorldState => reduce(w, s, a, registry).state;
  // The section's entry arrives in its start room, after the room's onEnter.
  const entered = step(EMPTY_WORLD_STATE, { kind: 'enter-section', section: S });
  expect(calls().map((c) => c.room)).toEqual(['hall']);
  // A resume of the current section.
  expect(step(entered, { kind: 'enter-section', section: S })).toBe(entered);
  expect(calls()).toEqual([{ room: 'hall', fired: ['enter:hall'] }]);
  // A move.
  const den = step(entered, tap('hall.to_den'));
  expect(calls()).toEqual([{ room: 'den', fired: ['enter:hall', 'enter:den'] }]);
  // A move whose onEnter queues an event knot arrives when the knot returns, once.
  const crypt = step(step(den, tap('den.back')), tap('hall.to_crypt'));
  expect(calls().map((c) => c.room)).toEqual(['hall']);
  expect(crypt.pendingStory).toEqual(['crypt_voice']);
  step(crypt, { kind: 'event-returned', section: S });
  expect(calls()).toEqual([{ room: 'crypt', fired: ['enter:hall', 'enter:den', 'enter:crypt'] }]);
});

test('mechanics: a puzzle end runs no arrival hook', () => {
  const w = world({ hall: room([object('chest', [], puzzleLock('chest')), exit('to_den', 'den')]), den: room([exit('back', 'hall')]) }, { puzzles: { chest: code(2) } });
  const { module, calls } = arrivalLogger();
  const registry = [CORE, module];
  // The hook is live in this world: a move arrives.
  reduce(w, at('hall'), tap('hall.to_den'), registry);
  expect(calls().map((c) => c.room)).toEqual(['den']);
  // A lock puzzle's end opens its lock and pushes no room effect.
  const solved = reduce(w, at('hall'), { kind: 'puzzle-ended', puzzle: pz('chest'), outcome: 'solved' }, registry);
  expect(solved.state.open).toEqual(['hall.chest']);
  expect(calls()).toEqual([]);
});

test('search: an arrival hook adds no state', () => {
  // The vault's onEnter queues a knot, and its chest is a zero-slot lock with a puzzle: a hook that opens that puzzle on
  // arrival reaches only the states the chest's own tap reaches, so the section's state count is unchanged.
  const w = world(
    {
      hall: room([exit('to_vault', 'vault'), exit('out', { story: 'end' })]),
      vault: room([object('chest', [{ give: 'gem' }], puzzleLock('chest')), exit('back', 'hall')], [{ story: 'vault_voice' }]),
    },
    { items: ['gem'], puzzles: { chest: code(2, 2) } },
  );
  const chest = k('vault.chest');
  const opener: MechanicRules<'opener', never, never> = {
    id: 'opener',
    actions: () => [],
    apply: () => undefined,
    reads: () => [],
    cues: [],
    arrived: (_w, s, room, out) => {
      if (room === rm('vault') && !s.open.includes(chest) && runOf(s, pz('chest')).outcome === null) {
        out.effect({ kind: 'puzzle', puzzle: pz('chest'), hotspot: chest });
      }
    },
  };
  const search = (rules: RulesRegistry) => searchSection(w, sectionEntry(w, EMPTY_WORLD_STATE, S, rules), S, RESUME_STATE_CAP, { rules });
  const plain = search([CORE]);
  expect(plain.result).toBe('exhausted');
  expect(search([CORE, opener])).toEqual(plain);
  // The hook is live: the knot's return into the vault opens the chest's puzzle, so that edge expands into `closed`.
  const waiting = { ...at('vault'), pendingStory: [kn('vault_voice')], fired: ['enter:vault'] };
  const kinds = (rules: RulesRegistry) => successors(w, waiting, rules).map((x) => x.step.kind);
  expect(kinds([CORE])).toEqual(['event-returned']);
  expect(kinds([CORE, opener])).toEqual(['closed', 'puzzle-ended', 'puzzle-ended']);
});
