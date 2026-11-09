import { expect, test } from 'vitest';

import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { PuzzleLocalId } from '../story/staging.ts';
import type { DocId, HotspotKey, ItemId, RoomId, WorldPublicBody } from '../world/types.ts';
import type { DecodeCtx, Issue, KernelWorld, MechanicData, MechanicRules, RulesRegistry } from './contract.ts';
import { COND_MAX_ATOMS, COND_MAX_DEPTH, condReads, condSize, decodeCond } from './data/conditions.ts';
import type { Cond } from './data/conditions.ts';
import { MECHANIC_DATA } from './data/index.ts';
import type { DataRegistry } from './data/index.ts';
import { holds } from './rules/conditions.ts';
import { MECHANIC_RULES } from './rules/index.ts';

/** A context no condition reads: the decoder takes the composed decoder's, for a module atom that one day might. */
const CTX: DecodeCtx = {
  text: () => {
    throw new Error('invariant: no condition decodes a text');
  },
};

/** A fixture module declaring atom `part` (visual only, any string id) and `flag` (gating, `fl_` ids). */
const PROBE_DATA: MechanicData<'probe', null> = {
  id: 'probe',
  rules: 'chunk',
  owns: { atoms: ['part', 'flag'] },
  atoms: {
    part: { decode: (v) => v, gating: false },
    flag: {
      decode: (v, path, report) => {
        if (typeof v === 'string' && v.startsWith('fl_')) {
          return v;
        }
        report(path, 'id', `${JSON.stringify(v)} is not a flag`);
        return undefined;
      },
      gating: true,
    },
  },
  decode: () => ({ ok: true, value: null }),
  encode: () => [],
  normalize: (_w, s) => s,
};
const DATA: DataRegistry = [...MECHANIC_DATA, PROBE_DATA];
/** Its rules half: `flag` holds for `fl_on` only, `part` for any value. */
const PROBE_RULES: MechanicRules<'probe', { readonly kind: 'probe' }, never> = {
  id: 'probe',
  actions: () => [],
  apply: () => undefined,
  reads: () => [],
  cues: [],
  holds: (_w, _s, atom) => atom.kind === 'part' || atom.value === 'fl_on',
};
const RULES: RulesRegistry = [...MECHANIC_RULES, PROBE_RULES];

function ok(raw: unknown, mechanics: DataRegistry = MECHANIC_DATA): Cond {
  const r = decodeCond(raw, CTX, 'when', mechanics);
  if (!r.ok) {
    throw new Error(`invariant: ${JSON.stringify(raw)} decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

function refused(raw: unknown, mechanics: DataRegistry = MECHANIC_DATA): string[] {
  const r = decodeCond(raw, CTX, 'when', mechanics);
  return r.ok ? [] : r.error.map((i: Issue) => `${i.path} ${i.reason}`);
}

const KERNEL_ATOMS = [
  { held: 'match' },
  { used: 'match' },
  { has: 'match' },
  { doc: 'diary' },
  { taken: 'study.lamp' },
  { examined: 'hall.inscription' },
  { open: 'study.drawer' },
  { visited: 'cellar' },
  { solved: 'gate' },
  { failed: 'gate' },
];

test('conditions: every atom and combinator decodes with strict keys', () => {
  // Every kernel atom, nested in every combinator, and a module's atom through its declared decoder.
  for (const atom of KERNEL_ATOMS) {
    expect(ok(atom), JSON.stringify(atom)).toEqual(atom);
  }
  const nested = { all: [{ any: KERNEL_ATOMS }, { not: { not: { has: 'match' } } }, { flag: 'fl_on' }] };
  expect(ok(nested, DATA)).toEqual(nested);
  expect(ok({ part: { at: 'hall.door' } }, DATA)).toEqual({ part: { at: 'hall.door' } });
  // One issue per fault, every fault in one pass, in the kernel's reasons and paths.
  expect(refused({ held: 'match', used: 'match' })).toEqual(['when shape']);
  expect(refused({ flag: 'fl_on' })).toEqual(['when shape']);
  expect(refused({ flag: 'on' }, DATA)).toEqual(['when.flag id']);
  expect(refused({ all: [] })).toEqual(['when.all shape']);
  expect(refused({ any: [] })).toEqual(['when.any shape']);
  expect(refused({ all: {} })).toEqual(['when.all shape']);
  expect(refused({ not: [] })).toEqual(['when.not shape']);
  expect(refused(null)).toEqual(['when shape']);
  expect(refused('held')).toEqual(['when shape']);
  expect(refused({})).toEqual(['when shape']);
  const outOfGrammar = KERNEL_ATOMS.map((a) => Object.fromEntries(Object.keys(a).map((k) => [k, 'Bad.Id'])));
  expect(refused({ all: outOfGrammar })).toEqual(KERNEL_ATOMS.map((a, i) => `when.all.${i}.${Object.keys(a).join('')} id`));
  // A hotspot atom wants `<room>.<hotspot>`, the others a bare id.
  expect(refused({ any: [{ open: 'drawer' }, { visited: 'hall.door' }, { doc: 7 }] })).toEqual(['when.any.0.open id', 'when.any.1.visited id', 'when.any.2.doc id']);
  expect(refused({ all: [{ has: 'match' }, { not: {} }, { any: [] }, 3] })).toEqual(['when.all.1.not shape', 'when.all.2.any shape', 'when.all.3 shape']);
  // The caps are the lint's, not the decoder's.
  const deep = { not: { not: { not: { not: { not: { has: 'match' } } } } } };
  expect(ok(deep)).toEqual(deep);
  const wide = { all: Array.from({ length: COND_MAX_ATOMS + 1 }, () => ({ has: 'match' })) };
  expect(ok(wide)).toEqual(wide);
});

test('conditions: reads lists every atom', () => {
  const c = ok({ all: [{ any: KERNEL_ATOMS.slice(0, 5) }, { not: { all: KERNEL_ATOMS.slice(5) } }, { flag: 'fl_on' }] }, DATA);
  expect(condReads(c)).toEqual([
    { kind: 'held', id: 'match' },
    { kind: 'used', id: 'match' },
    { kind: 'held', id: 'match' },
    { kind: 'used', id: 'match' },
    { kind: 'doc', id: 'diary' },
    { kind: 'taken', id: 'study.lamp' },
    { kind: 'examined', id: 'hall.inscription' },
    { kind: 'open', id: 'study.drawer' },
    { kind: 'visited', id: 'cellar' },
    { kind: 'solved', id: 'gate' },
    { kind: 'failed', id: 'gate' },
    { kind: 'flag', id: 'fl_on' },
  ]);
  // A module atom whose value is no string names it as JSON.
  expect(condReads(ok({ part: { at: 'hall.door' } }, DATA))).toEqual([{ kind: 'part', id: '{"at":"hall.door"}' }]);
  // Depth and atom count, the inputs of world/cond-size.
  expect(condSize(ok({ has: 'match' }))).toEqual({ depth: 1, atoms: 1 });
  expect(condSize(c)).toEqual({ depth: 4, atoms: 11 });
  expect(COND_MAX_DEPTH).toBe(4);
});

const WORLD: KernelWorld = { format: 1, items: {}, docs: {}, puzzles: {}, sections: {} } satisfies WorldPublicBody;

/** A state holding one fact of every kernel atom kind of KERNEL_ATOMS but `used` (the match is held) and `failed`. */
function rich(): WorldState {
  return {
    ...EMPTY_WORLD_STATE,
    held: ['match' as ItemId],
    docs: ['diary' as DocId],
    taken: ['study.lamp' as HotspotKey],
    examined: ['hall.inscription' as HotspotKey],
    open: ['study.drawer' as HotspotKey],
    visited: ['cellar' as RoomId],
    puzzles: { ['gate' as PuzzleLocalId]: { outcome: 'solved', attempts: 1, hintsOpened: 0 } },
  };
}

test('conditions: holds evaluates every atom and combinator', () => {
  const at = (s: WorldState, raw: unknown): boolean => holds(WORLD, s, ok(raw, DATA), RULES, DATA);
  const s = rich();
  const empty = EMPTY_WORLD_STATE;
  // Each kernel atom on the state that has its fact, and on the empty state.
  const expected = [true, false, true, true, true, true, true, true, true, false];
  KERNEL_ATOMS.forEach((a, i) => {
    expect(at(s, a), JSON.stringify(a)).toBe(expected[i]);
    expect(at(empty, a), JSON.stringify(a)).toBe(false);
  });
  // `has` is held or used; `failed` the other outcome.
  const used: WorldState = { ...EMPTY_WORLD_STATE, used: ['match' as ItemId], puzzles: { ['gate' as PuzzleLocalId]: { outcome: 'failed', attempts: 3, hintsOpened: 0 } } };
  expect(at(used, { has: 'match' })).toBe(true);
  expect(at(used, { held: 'match' })).toBe(false);
  expect(at(used, { failed: 'gate' })).toBe(true);
  expect(at(used, { solved: 'gate' })).toBe(false);
  // all every member, any some, not none.
  expect(at(s, { all: [{ held: 'match' }, { doc: 'diary' }] })).toBe(true);
  expect(at(s, { all: [{ held: 'match' }, { used: 'match' }] })).toBe(false);
  expect(at(s, { any: [{ used: 'match' }, { doc: 'diary' }] })).toBe(true);
  expect(at(s, { any: [{ used: 'match' }, { failed: 'gate' }] })).toBe(false);
  expect(at(s, { not: { used: 'match' } })).toBe(true);
  expect(at(s, { not: { held: 'match' } })).toBe(false);
  // A module's atom through its rules half's holds.
  expect(at(empty, { flag: 'fl_on' })).toBe(true);
  expect(at(empty, { flag: 'fl_off' })).toBe(false);
  expect(at(empty, { not: { flag: 'fl_off' } })).toBe(true);
  // An atom no data half declares never reaches the evaluator from the decoder: holding one is a bug.
  expect(() => holds(WORLD, s, { flag: 'fl_on' })).toThrow('invariant: a decoded condition holds only declared atoms');
});
