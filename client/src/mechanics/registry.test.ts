import { expect, test, vi } from 'vitest';

import { worldIndex } from '../explore/reduce.ts';
import type { Draft, ExploreAction } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { DocId, HotspotKey, ItemId, RoomId, WorldPublicBody } from '../world/types.ts';
import { KERNEL_FACT_KINDS } from './contract.ts';
import type { Cause, MechanicData, MechanicId, MechanicRules, Writer } from './contract.ts';
import { MECHANIC_DATA } from './data/index.ts';
import { reduce } from './rules/core.ts';
import { MECHANIC_RULES } from './rules/index.ts';
import { successors } from './rules/search.ts';
import { createWriter } from './rules/writer.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture worlds: written in the source format and decoded (the same builder shape as explore/explore.test.ts).

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (owner = 'w'): Json => ({ id: `ch1.${owner}.${(lineCounter++).toString(36).padStart(4, '0')}`, ru: owner });
const RECT = [100, 200, 200, 200];
const look = (id: string, then: Json[] = []): Json => ({ id, kind: 'look', rect: RECT, label: txt(), look: txt(id), then });
const object = (id: string, then: Json[] = []): Json => ({ id, kind: 'object', rect: RECT, label: txt(), lock: null, then, look: txt(id), prop: null });
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
  const checkGraph = (index: typeof import('./rules/index.ts'), core: typeof import('./rules/core.ts')): void => {
    expect(index.MECHANIC_RULES).toStrictEqual([{ id: 'core', actions: core.actions, apply: core.applyCore, reads: core.reads, cues: [] }]);
    expect(core.reduce(w, at('hall'), tap('hall.statue')).effects.map((e) => e.kind)).toEqual(['look', 'dirty']);
  };
  vi.resetModules();
  const coreFirst = await import('./rules/core.ts');
  checkGraph(await import('./rules/index.ts'), coreFirst);
  vi.resetModules();
  const indexFirst = await import('./rules/index.ts');
  checkGraph(indexFirst, await import('./rules/core.ts'));
});

// ---------------------------------------------------------------------------------------------------------------
// The hooks (engine plan §3.2): fixture modules through the registry parameter.

const [CORE] = MECHANIC_RULES;
const DIRTY = { kind: 'dirty' } as const;

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
  expect(r.effects).toEqual([DIRTY]);
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
