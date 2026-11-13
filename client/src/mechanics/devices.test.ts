// Module `devices` (engine plan §7.5): a view room's `device` hotspot carries a zero-slot lock with the room's device
// puzzle, and its session opens on arrival (the `arrived` hook core runs at its three `room` pushes, never while a knot
// is pending), with the same `puzzle` effect the device's own tap reaches, so the proof's states are unchanged; an
// ended device plays its outcome's cue instead. A part move (`device-moved`) writes the device's run's `work` through
// the writer, a `work` fact per moved part, and a part's picture is a decor state chosen by the visual atom `part` over
// that saved work. The story gate's devices lint places a view type only on a device and a device only in a view, with
// the types as a parameter (no registered type is a view before GM8a). Fixture worlds are written in the source format and decoded with the
// real registries; a proof world carries the decoded `mods`, as the explore controller's and the story gate's do.
import { expect, test } from 'vitest';

import { DEVICE_BAND_Y, DEVICE_BAR_CSS_H, DEVICE_TOP_INSET_CSS, devicesFindings, deviceBandY } from '../../scripts/story/mechanics/devices.ts';
import type { WorldLintInput } from '../../scripts/story/mechanics/index.ts';
import { RESUME_STATE_CAP } from '../explore/reduce.ts';
import type { ExploreAction, ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { PuzzleRun, WorldState } from '../explore/state.ts';
import { PUZZLE_TYPES } from '../puzzles/rules/index.ts';
import type { PuzzleTypeData, PuzzleTypes } from '../puzzles/rules/index.ts';
import type { AssetCatalog } from '../story/catalog.ts';
import type { ChapterId, KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, RoomId } from '../world/types.ts';
import type { DecodeCtx, FlagId, KernelWorld, OwnedAt, RulesRegistry, SectionAction } from './contract.ts';
import { decodeCond } from './data/conditions.ts';
import { decodeDevices, encodeDevices } from './data/devices.ts';
import { reduce } from './rules/core.ts';
import { partHolds } from './rules/devices.ts';
import { MECHANIC_RULES } from './rules/index.ts';
import { RESUME_WORK_PER_STATE, searchSection, sectionEntry, sectionPlaces, successors } from './rules/search.ts';
import type { SearchStats } from './rules/search.ts';
import { visualsOf } from './rules/visual.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture worlds, in the source format

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (owner = 'w'): Json => ({ id: `ch1.dv.${(lineCounter++).toString(36).padStart(4, '0')}`, ru: owner });
const RECT = [100, 600, 200, 200];
const look = (id: string, then: readonly Json[] = []): Json => ({ id, kind: 'look', rect: RECT, label: txt(), look: txt(id), then });
const object = (id: string, lock: Json | null, extra: Json = {}): Json => ({ id, kind: 'object', rect: RECT, label: txt(), lock, then: [], look: null, prop: null, ...extra });
const exit = (id: string, to: string | { story: string }): Json => ({ id, kind: 'exit', rect: RECT, label: txt(), to: typeof to === 'string' ? { room: to } : to, lock: null, sfx: null });
/** A lock whose slots accept `accepts` (none: a zero-slot lock), with `puzzle`. */
const lock = (puzzle: string | null, accepts: readonly string[] = []): Json => ({ slots: accepts.map((a) => ({ accepts: a })), puzzle, locked: txt(), onOpen: [], onFail: [] });
const room = (hotspots: readonly Json[], extra: Json = {}): Json => ({ bg: 'room', title: txt(), onEnter: [], hotspots, ...extra });
/** A decor lever at `x` showing `up` while part `index` of the dial's work is 1. */
const lever = (index: number, x: number): Json => ({
  id: `lever${index}`,
  prop: 'lever',
  rect: [x, 900, 160, 320],
  z: 1,
  states: { up: { prop: 'lever_up' } },
  is: [{ when: { part: { puzzle: 'dial', index, is: 1 } }, state: 'up' }],
});
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

/** The source of one section `s` over `rooms`, starting in `hall`. */
function source(rooms: Readonly<Record<string, Json>>, o: { puzzles?: Json; flags?: Readonly<Record<string, string>> } = {}): Json {
  return {
    format: 1,
    items: {},
    docs: {},
    puzzles: o.puzzles ?? {},
    sections: { s: { start: 'hall', bgm: null, rooms } },
    ...(o.flags === undefined ? {} : { flags: Object.fromEntries(Object.entries(o.flags).map(([f, section]) => [f, { section }])) }),
  };
}

/** The proof world of a source decoded with `types`: the public body with the decoded `mods`. */
function kernel(raw: Json, types: PuzzleTypes = PUZZLE_TYPES): KernelWorld {
  const r = decodeWorldSource(raw, { types });
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods };
}

/**
 * The hall and its device view `panel`: the device hotspot `dial` carries a zero-slot lock with the code puzzle `dial`
 * (four dials). `o.enter`: the panel's onEnter; `o.capped`: the puzzle's maxAttempts; `o.levers`: one decor lever per
 * dial, its picture chosen by its part.
 */
function panel(o: { enter?: readonly Json[]; capped?: number; levers?: boolean } = {}): KernelWorld {
  return kernel(
    source(
      {
        hall: room([exit('to_panel', 'panel'), exit('out', { story: 'end' })]),
        panel: room([object('dial', lock('dial'))], {
          view: { of: 'hall' },
          device: 'dial',
          onEnter: o.enter ?? [],
          ...(o.levers === true ? { decor: [lever(0, 100), lever(1, 320), lever(2, 540), lever(3, 760)] } : {}),
        }),
      },
      { puzzles: { dial: code(4, o.capped ?? null) } },
    ),
  );
}

const S = 's' as SectionId;
const k = (s: string) => s as HotspotKey;
const rm = (s: string) => s as RoomId;
const pz = (s: string) => s as PuzzleLocalId;
const kn = (s: string) => s as KnotName;
const fl = (s: string) => s as FlagId;
const tap = (hotspot: string): ExploreAction => ({ kind: 'tap', hotspot: k(hotspot) });
const DIAL = pz('dial');
const DEVICE = k('panel.dial');
const OPEN_DIAL = { kind: 'puzzle', puzzle: 'dial', hotspot: 'panel.dial' } as const;

/** A state in `roomId` of section `s`, having entered the hall. */
function at(roomId: string, extra: Partial<WorldState> = {}): WorldState {
  return { ...structuredClone(EMPTY_WORLD_STATE), section: S, room: rm(roomId), lastRoom: { [S]: rm(roomId) }, visited: [rm('hall'), rm(roomId)], ...extra };
}

const run = (r: Partial<PuzzleRun>): Readonly<Record<PuzzleLocalId, PuzzleRun>> => ({ [DIAL]: { outcome: null, attempts: 0, hintsOpened: 0, ...r } });
/** The kernel's effects of a list, in order: every effect but the writer's `cue` effects. */
const kernelEffects = (effects: readonly ExploreEffect[]): ExploreEffect[] => effects.filter((e) => e.kind !== 'cue');
/** The module cues of a list, as `<module>:<name>@<at>`. */
const moduleCues = (effects: readonly ExploreEffect[]): string[] =>
  effects.flatMap((e) => (e.kind === 'cue' && e.cue.kind === 'module' ? [`${e.cue.module}:${e.cue.name}@${String(e.cue.at)}`] : []));
const opens = (effects: readonly ExploreEffect[]): ExploreEffect[] => effects.filter((e) => e.kind === 'puzzle' || e.kind === 'lock');
/** The fact cues of a list, as `<kind> <change> <id>`. */
const facts = (effects: readonly ExploreEffect[]): string[] =>
  effects.flatMap((e) => (e.kind === 'cue' && e.cue.kind === 'fact' ? [`${e.cue.fact.kind} ${e.cue.change} ${e.cue.fact.id}`] : []));
const move = (work: readonly number[], puzzle = 'dial'): SectionAction => ({ kind: 'device-moved', puzzle: pz(puzzle), work });

/** A fixture view type the default registry lacks (GM8a registers the first real one): `parts` levers at 0..2, each
 *  starting at 2; a saved work fits while it has one value per lever. */
const LEVERS: PuzzleTypeData<string, unknown> = Object.freeze({
  type: 'levers',
  check: 'reach',
  goal: 'shown',
  presentation: 'view',
  wrong: 'none',
  commit: 'control',
  decodeParams: (raw: unknown) => ({ ok: true, value: raw }) as const,
  answerShape: (p: unknown) => ({ len: partsOf(p), max: 2 }),
  initial: (p: unknown) => new Array<number>(partsOf(p)).fill(2),
  startShown: () => null,
  workFits: (p: unknown, work: readonly number[]) => work.length === partsOf(p),
});
function partsOf(p: unknown): number {
  return (p as { readonly parts: number }).parts; // the fixture's params, decoded as written
}
const TYPES: PuzzleTypes = [...PUZZLE_TYPES, LEVERS];
const levers = (parts: number): Json => ({ ...code(2), type: 'levers', params: { parts }, solution: new Array<number>(parts).fill(1) });

// ---------------------------------------------------------------------------------------------------------------
// The data half

test('device: the device key and the part atom decode strictly and round-trip', () => {
  const owned = (id: string, device: unknown): OwnedAt => ({ place: 'room', id, path: `sections.s.rooms.${id}`, raw: { device } });
  const d = decodeDevices([owned('panel', 'dial'), owned('safe', 'door')]);
  expect(d).toEqual({ ok: true, value: { device: { panel: 'dial', safe: 'door' }, paths: { panel: 'sections.s.rooms.panel', safe: 'sections.s.rooms.safe' } } });
  // The inverse: decode(encode(d)) is d, and a world with no device encodes nothing (its body and version unchanged).
  expect(d.ok ? decodeDevices(encodeDevices(d.value)) : d).toEqual(d);
  expect(encodeDevices({ device: {}, paths: {} })).toEqual([]);
  // One spelling, a hotspot id: null, an object, a number and an id outside the pattern are each refused at the key.
  expect(decodeDevices([owned('a', null), owned('b', { hotspot: 'dial' }), owned('c', 3), owned('d', 'Dial')])).toEqual({
    ok: false,
    error: [
      { path: 'sections.s.rooms.a.device', reason: 'shape', detail: 'null is not a hotspot id (a string)' },
      { path: 'sections.s.rooms.b.device', reason: 'shape', detail: '{"hotspot":"dial"} is not a hotspot id (a string)' },
      { path: 'sections.s.rooms.c.device', reason: 'shape', detail: '3 is not a hotspot id (a string)' },
      { path: 'sections.s.rooms.d.device', reason: 'id', detail: "'Dial' is not a hotspot id ^[a-z][a-z0-9_]*$" },
    ],
  });
  // Through the composed decoder: the room's `device` reaches `mods.devices`.
  expect(panel().mods.devices.device).toEqual({ panel: 'dial' });
  // The visual atom `part`: exactly `{ puzzle, index, is }`, a puzzle id and two integers >= 0, every issue reported.
  const CTX: DecodeCtx = {
    text: () => {
      throw new Error('invariant: no condition decodes a text');
    },
  };
  const part = (v: unknown) => decodeCond({ part: v }, CTX, 'c');
  expect(part({ puzzle: 'dial', index: 2, is: 1 })).toEqual({ ok: true, value: { part: { puzzle: 'dial', index: 2, is: 1 } } });
  expect(part({ puzzle: 'dial', index: 0, is: 1, at: 'x' })).toEqual({ ok: false, error: [{ path: 'c.part.at', reason: 'shape', detail: 'unknown key (a part has puzzle, index, is)' }] });
  expect(part({ puzzle: 'Dial', index: -1, is: 1.5 })).toEqual({
    ok: false,
    error: [
      { path: 'c.part.puzzle', reason: 'id', detail: '"Dial" is not a puzzle id ^[a-z][a-z0-9_]*$' },
      { path: 'c.part.index', reason: 'shape', detail: '-1 is not an integer >= 0' },
      { path: 'c.part.is', reason: 'shape', detail: '1.5 is not an integer >= 0' },
    ],
  });
  expect(part({ puzzle: 'dial', index: 0 })).toEqual({ ok: false, error: [{ path: 'c.part.is', reason: 'shape', detail: 'undefined is not an integer >= 0' }] });
  expect(part([0, 1])).toEqual({ ok: false, error: [{ path: 'c.part', reason: 'shape', detail: '[0,1] is not a { puzzle, index, is } object' }] });
  // A decor state's `part` through the composed decoder, and its decoded value decodes to itself.
  const when = panel({ levers: true }).mods.visual.decor[rm('panel')]?.[2]?.is[0]?.when;
  expect(when).toEqual({ part: { puzzle: 'dial', index: 2, is: 1 } });
  expect(decodeCond(when, CTX, 'c')).toEqual({ ok: true, value: when });
});

// ---------------------------------------------------------------------------------------------------------------
// The picture

test('visual: four placements of one lever image keep four anchors', () => {
  // Decor anchors are `<room>~<decor>`, never the image: four levers drawing one prop are four anchors, each with its
  // own state, chosen by its part of the device's saved work.
  const w = panel({ levers: true });
  const views = (s: WorldState) => visualsOf(w, s, rm('panel')).map((v) => [v.at, v.prop, v.state]);
  expect(views(at('panel', { puzzles: run({ work: [1, 0, 1, 0] }) }))).toEqual([
    ['panel~lever0', 'lever_up', 'up'],
    ['panel~lever1', 'lever', 'default'],
    ['panel~lever2', 'lever_up', 'up'],
    ['panel~lever3', 'lever', 'default'],
  ]);
  // No saved work yet: the parts read the type's `initial` (a code puzzle's zeros), so every lever is down.
  expect(views(at('panel')).map(([anchor, , state]) => [anchor, state])).toEqual([
    ['panel~lever0', 'default'],
    ['panel~lever1', 'default'],
    ['panel~lever2', 'default'],
    ['panel~lever3', 'default'],
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// The work

test('device: a part move writes run.work and its picture follows', () => {
  const w = panel({ levers: true });
  const down = ['default', 'default', 'default', 'default'];
  const states = (s: WorldState): string[] => visualsOf(w, s, rm('panel')).map((v) => v.state);
  // X14 (a): with no saved work the parts read the type's `initial` (a code puzzle's zeros).
  const s = at('panel');
  expect(states(s)).toEqual(down);
  // The first write (no `work` before) records every part's position (RULINGS 353 Q6), at the device, verb 'device'.
  const first = reduce(w, s, move([1, 0, 0, 0]));
  expect(first.state.puzzles[DIAL]).toEqual({ outcome: null, attempts: 0, hintsOpened: 0, work: [1, 0, 0, 0] });
  expect(facts(first.effects)).toEqual(['work added dial.0=1', 'work added dial.1=0', 'work added dial.2=0', 'work added dial.3=0']);
  const cue = first.effects.find((e) => e.kind === 'cue');
  expect(cue?.kind === 'cue' && cue.cue.kind === 'fact' ? cue.cue.cause : null).toEqual({ verb: 'device', at: 'panel.dial', item: null, via: null });
  expect(first.effects.at(-1)).toEqual({ kind: 'dirty' });
  expect(states(first.state)).toEqual(['up', 'default', 'default', 'default']);
  // A later move records each moved part: its old position removed, then its new one added.
  const second = reduce(w, first.state, move([1, 1, 0, 0]));
  expect(facts(second.effects)).toEqual(['work removed dial.1=0', 'work added dial.1=1']);
  expect(states(second.state)).toEqual(['up', 'up', 'default', 'default']);
  // X14 (b): a move back to `initial` stores the array (the one write form), its facts recorded; the picture is down.
  const reset = reduce(w, second.state, move([0, 0, 0, 0]));
  expect(reset.state.puzzles[DIAL]?.work).toEqual([0, 0, 0, 0]);
  expect(facts(reset.effects)).toEqual(['work removed dial.0=1', 'work removed dial.1=1', 'work added dial.0=0', 'work added dial.1=0']);
  expect(states(reset.state)).toEqual(down);
  // The same move again changes nothing: no fact, no dirty, the same state.
  const again = reduce(w, reset.state, move([0, 0, 0, 0]));
  expect([again.state, again.effects]).toEqual([reset.state, []]);
  expect(again.state).toBe(reset.state);
  // X14 (a) for a type the default registry lacks: the fixture type's `initial` through `types`, and none without it.
  const v = kernel(source({ hall: room([exit('out', { story: 'end' })]) }, { puzzles: { gauge: levers(3) } }), TYPES);
  const gauge = (index: number, is: number) => ({ puzzle: pz('gauge'), index, is });
  expect([partHolds(v, at('hall'), gauge(1, 2), TYPES), partHolds(v, at('hall'), gauge(1, 0), TYPES)]).toEqual([true, false]);
  expect([0, 1, 2].map((is) => partHolds(v, at('hall'), gauge(1, is)))).toEqual([false, false, false]);
  const saved = at('hall', { puzzles: { [pz('gauge')]: { outcome: null, attempts: 0, hintsOpened: 0, work: [0, 1, 0] } } });
  expect([partHolds(v, saved, gauge(1, 1)), partHolds(v, saved, gauge(1, 1), TYPES)]).toEqual([true, true]);
});

test('device: a stale part move writes nothing', () => {
  const w = panel();
  const writes = (s: WorldState, a: SectionAction = move([1, 0, 0, 0])): boolean => {
    const r = reduce(w, s, a);
    return r.state !== s || r.effects.length > 0;
  };
  // The control: a live device run in its room takes the move.
  expect(writes(at('panel'))).toBe(true);
  // G1: no section's room.
  expect(writes({ ...at('panel'), section: null })).toBe(false);
  expect(writes({ ...at('panel'), room: null })).toBe(false);
  // G2: a puzzle that is not the current room's device (the room's device is `dial`; the hall has none).
  expect(writes(at('panel'), move([1, 0], 'other'))).toBe(false);
  expect(writes(at('hall'))).toBe(false);
  // G3: a knot pending.
  expect(writes(at('panel', { pendingStory: [kn('voice')] }))).toBe(false);
  // G4: the run has ended.
  expect(writes(at('panel', { puzzles: run({ outcome: 'failed', attempts: 2 }) }))).toBe(false);
  expect(writes(at('panel', { open: [DEVICE], puzzles: run({ outcome: 'solved' }) }))).toBe(false);
  // A value the save cannot keep (RULINGS 353 O3): never written, so one bad dispatch never refuses the whole save.
  for (const bad of [-1, 1.5, Number.NaN, 2 ** 53]) {
    expect(writes(at('panel'), move([0, bad, 0, 0])), String(bad)).toBe(false);
  }
});

test("writer: a kernel run write keeps a device's work and records no work fact", () => {
  // Every kernel run write spreads the old run, so a device's saved work survives a failed attempt, a hint and the
  // puzzle's end, and the writer's work comparison sees no change.
  const w = panel({ capped: 3 });
  const s = at('panel', { puzzles: run({ work: [1, 0, 1, 0] }) });
  const failed = reduce(w, s, { kind: 'attempt-failed', puzzle: DIAL });
  expect(failed.state.puzzles[DIAL]).toEqual({ outcome: null, attempts: 1, hintsOpened: 0, work: [1, 0, 1, 0] });
  expect(facts(failed.effects)).toEqual(['attempt added dial']);
  const hinted = reduce(w, failed.state, { kind: 'hint-opened', puzzle: DIAL, tier: 1 });
  expect(facts(hinted.effects)).toEqual(['hint added dial']);
  const solved = reduce(w, hinted.state, { kind: 'puzzle-ended', puzzle: DIAL, outcome: 'solved' });
  expect(solved.state.puzzles[DIAL]).toEqual({ outcome: 'solved', attempts: 1, hintsOpened: 1, work: [1, 0, 1, 0] });
  expect(facts(solved.effects).filter((f) => f.startsWith('work'))).toEqual([]);
  expect(facts(solved.effects)[0]).toBe('solved added dial');
});

// ---------------------------------------------------------------------------------------------------------------
// Arrival

test('device: arriving in a device view opens its session', () => {
  const w = panel();
  const zoomed = reduce(w, at('hall'), tap('hall.to_panel'));
  expect(kernelEffects(zoomed.effects)).toEqual([{ kind: 'room', room: 'panel', sfx: null, from: 'hall', via: 'hall.to_panel', how: 'zoom-in' }, OPEN_DIAL, { kind: 'dirty' }]);
  // The edge the device's own tap reaches (the zero-slot lock's puzzle), so the proof's states are unchanged.
  expect(opens(reduce(w, zoomed.state, tap('panel.dial')).effects)).toEqual([OPEN_DIAL]);
  // A device the state holds open (a remote unlock, its outcome still null) opens nothing; a room with no device neither.
  expect(opens(reduce(w, at('hall', { open: [DEVICE] }), tap('hall.to_panel')).effects)).toEqual([]);
  expect(opens(reduce(w, zoomed.state, { kind: 'leave-view' }).effects)).toEqual([]);
});

test('device: arriving at a jammed device plays its jam and opens nothing', () => {
  const w = panel({ capped: 2 });
  const r = reduce(w, at('hall', { puzzles: run({ outcome: 'failed', attempts: 2 }) }), tap('hall.to_panel'));
  expect(opens(r.effects)).toEqual([]);
  expect(moduleCues(r.effects)).toEqual(['devices:jammed@panel.dial']);
  expect(r.state.room).toBe('panel');
});

test('device: arriving at a solved device opens nothing', () => {
  const w = panel();
  const r = reduce(w, at('hall', { open: [DEVICE], puzzles: run({ outcome: 'solved', attempts: 1 }) }), tap('hall.to_panel'));
  expect(opens(r.effects)).toEqual([]);
  expect(moduleCues(r.effects)).toEqual(['devices:done@panel.dial']);
});

test('device: a resume and an event return into a device room open its session', () => {
  // Core calls the hook at all three of its `room` pushes; the move is T1's. A resume of the current section:
  const w = panel();
  const resumed = reduce(w, at('panel'), { kind: 'enter-section', section: S });
  expect(kernelEffects(resumed.effects)).toEqual([{ kind: 'room', room: 'panel', sfx: null, from: 'panel', via: null, how: 'resume' }, OPEN_DIAL]);
  // An event knot's return into the device room.
  const returned = reduce(w, at('panel', { pendingStory: [kn('voice')] }), { kind: 'event-returned', section: S });
  expect(kernelEffects(returned.effects)).toEqual([{ kind: 'room', room: 'panel', sfx: null, from: 'panel', via: null, how: 'return' }, OPEN_DIAL, { kind: 'dirty' }]);
});

test('device: an arrival under an onEnter event opens nothing until the event returns', () => {
  // Core's guard (core.ts `arrived`): no hook runs while a knot is pending; devices' own hook does not check it.
  const w = panel({ enter: [{ story: 'panel_voice' }] });
  const zoomed = reduce(w, at('hall'), tap('hall.to_panel'));
  expect(zoomed.state.pendingStory).toEqual(['panel_voice']);
  expect(opens(zoomed.effects)).toEqual([]);
  expect(kernelEffects(zoomed.effects).map((e) => e.kind)).toEqual(['room', 'story', 'dirty']);
  const returned = reduce(w, zoomed.state, { kind: 'event-returned', section: S });
  expect(opens(returned.effects)).toEqual([OPEN_DIAL]);
});

test("search: a device's arrival adds no state", () => {
  // A device view that merges into its parent's place, its device hidden until a hall look sets `power` (a `when` on
  // the device: a rules-level fixture, `world/device-when` refuses it in content). An arrival opens only what the
  // device's own tap opens, under the same presence, so the section's states are those of a registry without the hook.
  const w = kernel(
    source(
      {
        hall: room([look('switch', [{ set: 'power' }]), exit('to_panel', 'panel'), exit('out', { story: 'end' })]),
        panel: room([object('dial', lock('dial'), { when: { flag: 'power' } })], { view: { of: 'hall' }, device: 'dial' }),
      },
      { puzzles: { dial: code(2, 2) }, flags: { power: 's' } },
    ),
  );
  const all: RulesRegistry = MECHANIC_RULES;
  const quiet: RulesRegistry = all.map((m) => {
    if (m.id !== 'devices') {
      return m;
    }
    const { arrived: _arrived, ...rest } = m;
    return rest;
  });
  expect(quiet.some((m) => m.arrived !== undefined)).toBe(false);
  expect(sectionPlaces(w, S, all)).toEqual({ panel: 'hall' });
  const search = (rules: RulesRegistry): { result: string; states: number; stats: SearchStats | null } => {
    let stats: SearchStats | null = null;
    const r = searchSection(w, sectionEntry(w, EMPTY_WORLD_STATE, S, rules), S, RESUME_STATE_CAP, {
      rules,
      onStats: (x) => {
        stats = x;
      },
    });
    return { ...r, stats };
  };
  const plain = search(quiet);
  const hooked = search(all);
  expect(plain.result).toBe('exhausted');
  expect({ result: hooked.result, states: hooked.states }).toEqual({ result: plain.result, states: plain.states });
  // The work, on the shared bound (RESUME_WORK_PER_STATE): the section's four states are the entry, `power` set, and
  // the device solved or failed after it. The one zoom-in edge into the unsolved, present device (from the `power`
  // state) expands into its `closed` edge and its two outcomes, as the device's own tap does: 2 evaluations more.
  expect([plain.states, plain.stats, hooked.stats]).toEqual([4, { expansions: 8, work: 25, bound: null }, { expansions: 8, work: 27, bound: null }]);
  expect(hooked.stats?.work).toBeLessThanOrEqual(plain.states * RESUME_WORK_PER_STATE);
  // The hook is live: with `power` set, the zoom-in from the hall expands into the device's session edges.
  const lit = at('hall', { flags: [fl('power')], fired: ['enter:hall', 'then:hall.switch'], examined: [k('hall.switch')] });
  const kinds = (s: WorldState, rules: RulesRegistry): string[] => successors(w, s, rules).map((x) => x.step.kind);
  expect(kinds(lit, quiet)).toEqual(['tap', 'tap', 'tap']);
  expect(kinds(lit, all)).toEqual(['tap', 'closed', 'puzzle-ended', 'puzzle-ended', 'tap']);
  // Unlit, the device is hidden: its arrival opens nothing.
  expect(kinds(at('hall'), all)).toEqual(['tap', 'tap', 'tap']);
});

// ---------------------------------------------------------------------------------------------------------------
// The story gate: placement lints (each a code of the module's own table) and the band

const CATALOG: AssetCatalog = { bg: {}, chars: {}, cg: {}, bgm: {}, sfx: {}, prop: {}, cover: {} };

/** The devices lint over `raw` decoded with the fixture types, `yielded` the puzzles the chapter yields: each finding as
 *  `<code> <message>` (a message starts with its path). */
function lint(raw: Json, yielded: readonly string[] = []): string[] {
  const r = decodeWorldSource(raw, { types: TYPES });
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  const paths: string[] = [];
  const input: WorldLintInput = {
    chapter: { id: 'ch1' as ChapterId, paid: false, entry: 'ch1/main.ink' },
    file: 'story/ch1/world.json',
    text: '',
    world: r.value,
    catalog: CATALOG,
    knots: null,
    yielded: new Set(yielded.map(pz)),
    declared: new Map(),
    line: (path) => (paths.includes(path) ? paths.indexOf(path) : paths.push(path) - 1) + 1,
    moduleLines: new Map(),
  };
  return devicesFindings(input, TYPES).map((f) => {
    expect([f.severity, f.file, paths[f.line - 1] !== undefined && f.message.startsWith(`${paths[f.line - 1] ?? ''}: `)]).toEqual(['E', 'story/ch1/world.json', true]);
    return `${f.code} ${f.message}`;
  });
}

/**
 * A lint fixture: the hall and its device view `panel`, whose device hotspot `dial` carries `o.dial` (default: a zero-slot
 * lock with the view-type puzzle `dial`); `o.hall` adds hotspots to the hall, `o.panel` keys to the panel, `o.puzzles`
 * puzzles beside `dial` (a `LEVERS` puzzle of four parts unless replaced).
 */
function deviceWorld(o: { dial?: Json; hall?: readonly Json[]; panel?: Json; puzzles?: Json } = {}): Json {
  return source(
    {
      hall: room([exit('to_panel', 'panel'), exit('out', { story: 'end' }), ...(o.hall ?? [])]),
      panel: room([o.dial ?? object('dial', lock('dial'))], { view: { of: 'hall' }, device: 'dial', ...o.panel }),
    },
    { puzzles: { dial: levers(4), ...o.puzzles } },
  );
}

test('story: a device room without a zero-slot lock is refused', () => {
  const TYPE = 'world/device-type sections.s.rooms.panel.device: hotspot';
  const ZERO = "a device's hotspot carries a zero-slot lock with its puzzle (§7.5)";
  expect(lint(deviceWorld())).toEqual([]);
  // No lock (the view-type puzzle is then on no lock: its own site finding too).
  expect(lint(deviceWorld({ dial: object('dial', null) }))).toEqual([
    `${TYPE} 'dial' carries no lock: ${ZERO}`,
    "world/view-type-site puzzles.dial: view-type puzzle 'dial' is on no lock: a view type is played only by its device, never as a linear yield (§7.5)",
  ]);
  // A lock with slots (its puzzle is then on a slot lock).
  expect(lint(deviceWorld({ dial: object('dial', lock('dial', ['key'])) }))).toEqual([
    `${TYPE} 'dial' carries a lock with slots: ${ZERO}`,
    "world/view-type-site sections.s.rooms.panel.hotspots.0.lock.puzzle: view-type puzzle 'dial' is on a lock with slots: a view type is the puzzle of its device's zero-slot lock (§7.5)",
  ]);
  // A lock with no puzzle (the view-type puzzle is then on no lock).
  expect(lint(deviceWorld({ dial: object('dial', lock(null)) }))).toEqual([
    `${TYPE} 'dial' carries a lock with no puzzle: ${ZERO}`,
    "world/view-type-site puzzles.dial: view-type puzzle 'dial' is on no lock: a view type is played only by its device, never as a linear yield (§7.5)",
  ]);
  // A `device` that names no hotspot of its room is the DSL's unknown reference.
  expect(lint(deviceWorld({ panel: { device: 'lever' } }))).toEqual([
    "world/unknown-ref sections.s.rooms.panel.device: device 'lever' names no hotspot of room 'panel'",
    "world/view-type-site sections.s.rooms.panel.hotspots.0.lock.puzzle: view-type puzzle 'dial' is on a lock that is no view room's device: a view type is the puzzle of its device's zero-slot lock (§7.5)",
  ]);
});

test('story: a device whose lock puzzle is an overlay type is refused', () => {
  expect(lint(deviceWorld({ puzzles: { dial: code(4) } }))).toEqual([
    "world/device-type sections.s.rooms.panel.device: puzzle 'dial' is a code puzzle: a device's puzzle is of a view type (§7.5)",
  ]);
});

test('story: a view-type puzzle outside a device lock is refused', () => {
  // Three sites the view type cannot be played from: a linear yield, an ordinary room lock, a slot lock.
  const w = deviceWorld({
    hall: [object('safe', lock('safe')), object('box', lock('box', ['key']))],
    puzzles: { loose: levers(2), safe: levers(2), box: levers(1) },
  });
  expect(lint(w, ['loose'])).toEqual([
    "world/view-type-site puzzles.loose: view-type puzzle 'loose' is on no lock: a view type is played only by its device, never as a linear yield (§7.5)",
    "world/view-type-site sections.s.rooms.hall.hotspots.2.lock.puzzle: view-type puzzle 'safe' is on a lock that is no view room's device: a view type is the puzzle of its device's zero-slot lock (§7.5)",
    "world/view-type-site sections.s.rooms.hall.hotspots.3.lock.puzzle: view-type puzzle 'box' is on a lock with slots: a view type is the puzzle of its device's zero-slot lock (§7.5)",
  ]);
  // A `device` on a room that is no view.
  const flat = source({ hall: room([object('dial', lock('dial')), exit('out', { story: 'end' })], { device: 'dial' }) }, { puzzles: { dial: levers(4) } });
  expect(lint(flat)).toEqual([
    "world/view-type-site sections.s.rooms.hall.device: room 'hall' is no view: a device sits in a view room (§7.5)",
    "world/view-type-site sections.s.rooms.hall.hotspots.0.lock.puzzle: view-type puzzle 'dial' is on a lock that is no view room's device: a view type is the puzzle of its device's zero-slot lock (§7.5)",
  ]);
});

test('story: a device puzzle with a close-up is refused', () => {
  expect(lint(deviceWorld({ puzzles: { dial: { ...levers(4), closeup: 'cabinet' } } }))).toEqual([
    "world/device-closeup puzzles.dial.closeup: view-type puzzle 'dial' has close-up 'cabinet': a device is played in its room, never under a close-up (§7.5)",
  ]);
});

test("devices: the band constant follows the bar's bound", () => {
  // 07 §7.5 round 6: 64 canonical px cropped at the top of a 320 px 9:16 cover, then 8 + bar + inset CSS px at 3.375
  // canonical px each, rounded up.
  expect([DEVICE_BAR_CSS_H, DEVICE_TOP_INSET_CSS]).toEqual([120, 0]);
  expect([deviceBandY(120, 0), deviceBandY(120, 1)]).toEqual([496, 500]);
  expect(DEVICE_BAND_Y).toBe(deviceBandY(DEVICE_BAR_CSS_H, DEVICE_TOP_INSET_CSS));
  expect(DEVICE_BAND_Y).toBe(496);
});
