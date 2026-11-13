// The data registry (engine plan §3.2): every module's engine half, in one order the rules registry
// (mechanics/rules/index.ts) follows for the modules that have a rules half (`mechanics: data and rules registries
// align`). Each module lane appends its entry.
//
// Two rules for every entry:
// - Load order: an entry is built here from its module's function declarations, never from a `const` it exports. A
//   module's data half may import data/conditions.ts, which imports this registry (`decodeCond`'s default), so either
//   may load first; ESM binds function declarations at instantiation, a `const` only when its module has run
//   (`mechanics: the data registry loads from any module first`).
// - Every module's decoded data `D` is plain JSON (objects, arrays, strings, numbers, booleans, null): the text walk
//   (`world/text-unwalked`) and the version hash read it as data (`mechanics: every module's decoded data is plain
//   JSON`).
import type { MechanicData, OwnedRaw } from '../contract.ts';
import { decodeCombine, encodeCombine, normalizeCombine } from './combine.ts';
import type { CombineData } from './combine.ts';
import { core } from './core.ts';
import { decodeFlagAtom, decodeFlags, encodeFlags, normalizeFlags } from './flags.ts';
import type { FlagsData } from './flags.ts';
import { decodeUse, encodeUse, normalizeUse } from './use.ts';
import type { UseData } from './use.ts';
import { decodeVisual, encodeVisual, normalizeVisual } from './visual.ts';
import type { VisualData } from './visual.ts';
import { decodeView, encodeView, normalizeView } from './view.ts';
import type { ViewData } from './view.ts';

const use = {
  id: 'use',
  rules: 'chunk',
  // `facts: []` (it adds no fact kind) keeps `owns.facts` readable on every entry of the tuple.
  owns: { hotspot: ['uses'], slot: ['keep'], item: ['refuse'], room: ['refuse'], trigger: 'use', facts: [] },
  decode: decodeUse,
  // The composed decoder hands each module the `mods[id]` its own decode produced, read off the registry as `unknown`
  // (world/decode.ts `toPublic`); the tuple's entries are called as one union, so each takes it as such.
  encode: encodeUse as (d: unknown) => OwnedRaw,
  normalize: normalizeUse,
} satisfies MechanicData<'use', UseData>;

const visual = {
  id: 'visual',
  rules: 'chunk',
  owns: { hotspot: ['states', 'is'], room: ['decor'], facts: [] },
  decode: decodeVisual,
  encode: encodeVisual as (d: unknown) => OwnedRaw,
  normalize: normalizeVisual,
} satisfies MechanicData<'visual', VisualData>;

const view = {
  id: 'view',
  rules: 'chunk',
  owns: { room: ['view'], facts: [] },
  decode: decodeView,
  encode: encodeView as (d: unknown) => OwnedRaw,
  normalize: normalizeView,
} satisfies MechanicData<'view', ViewData>;

const combine = {
  id: 'combine',
  rules: 'chunk',
  owns: { world: ['recipes'], facts: [] },
  decode: decodeCombine,
  encode: encodeCombine as (d: unknown) => OwnedRaw,
  normalize: normalizeCombine,
} satisfies MechanicData<'combine', CombineData>;

const flags = {
  id: 'flags',
  rules: 'chunk',
  // The `flag` fact kind is the module's: `WorldState.flags` holds its facts, and its atom reads it in any condition.
  owns: { world: ['flags'], effect: ['set'], atoms: ['flag'], facts: ['flag'] as const },
  decode: decodeFlags,
  encode: encodeFlags as (d: unknown) => OwnedRaw,
  normalize: normalizeFlags,
  atoms: { flag: { decode: decodeFlagAtom, gating: true } },
} satisfies MechanicData<'flags', FlagsData>;

export const MECHANIC_DATA = [core, use, visual, view, combine, flags] as const;

/** A data registry as a decode takes it: `MECHANIC_DATA`, or a test's fixture modules beside it. */
export type DataRegistry = readonly MechanicData<string, unknown, unknown>[];
