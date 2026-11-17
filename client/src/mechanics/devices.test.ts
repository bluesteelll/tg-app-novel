// Module `devices` (engine plan §7.5): a view room's `device` hotspot carries a zero-slot lock with the room's device
// puzzle, and its session opens on arrival (the `arrived` hook core runs at its three `room` pushes, never while a knot
// is pending), with the same `puzzle` effect the device's own tap reaches, so the proof's states are unchanged; an
// ended device plays its outcome's cue instead. A part move (`device-moved`) writes the device's run's `work` through
// the writer, a `work` fact per moved part, and a part's picture is a decor state chosen by the visual atom `part` over
// that saved work; at resume a saved work its type judges no longer fits the device is dropped. The story gate's
// devices lint places a view type only on a device and a device only in a view, keeps the device hotspot a plain,
// always-present object that only its puzzle opens, bounds a visual `part` atom by its room's device and a clue's by any
// room's device, and keeps a device's parts inside the safe frame, under the bar's band, above the item ribbon and apart,
// and its room's other hotspots clear of the band and the parts, with the types and the lint halves as parameters (a
// fixture view type, `cranks`, beside the registered ones; the real `levers` and `setting` are GM8a's).
// Fixture worlds are written in the source format and decoded with the real registries; a proof world carries the
// decoded `mods`, as the explore controller's and the story gate's do.
import { expect, test } from 'vitest';

import { stripComments } from '../../scripts/story/classify.ts';
import {
  DEVICE_BAND_Y,
  DEVICE_BAR_CSS_H,
  DEVICE_BOTTOM_INSET_CSS,
  DEVICE_RIBBON_PER_ROW,
  DEVICE_TOP_INSET_CSS,
  devicesFindings,
  deviceBandY,
  deviceRibbonRows,
  deviceRibbonY,
} from '../../scripts/story/mechanics/devices.ts';
import devicesSource from '../../scripts/story/mechanics/devices.ts?raw';
import type { WorldLintInput } from '../../scripts/story/mechanics/index.ts';
import { PUZZLE_LINTS } from '../../scripts/story/puzzles/index.ts';
import type { PuzzleLintRegistry } from '../../scripts/story/puzzles/shape.ts';
import { RESUME_STATE_CAP } from '../explore/reduce.ts';
import type { ExploreAction, ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { PuzzleRun, WorldState } from '../explore/state.ts';
import { PUZZLE_TYPES } from '../puzzles/rules/index.ts';
import type { PuzzleTypeData, PuzzleTypes } from '../puzzles/rules/index.ts';
import type { AssetCatalog } from '../story/catalog.ts';
import { decodeSave, encodeSave } from '../story/save-codec.ts';
import type { SaveBody } from '../story/save-codec.ts';
import { EMPTY_SNAPSHOT } from '../story/staging.ts';
import type { ChapterId, KnotName, LineId, PuzzleLocalId, Rect, SectionId, StoryVersion } from '../story/staging.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, RoomId } from '../world/types.ts';
import type { DecodeCtx, FlagId, KernelWorld, OwnedAt, RulesRegistry, SectionAction } from './contract.ts';
import { decodeCond } from './data/conditions.ts';
import { decodeDevices, encodeDevices, fitWork, normalizeDevices } from './data/devices.ts';
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

/** The source of one section `s` over `rooms`, starting in `hall`; `o.items` declares that many items (`item0`...). */
function source(rooms: Readonly<Record<string, Json>>, o: { puzzles?: Json; flags?: Readonly<Record<string, string>>; items?: number } = {}): Json {
  return {
    format: 1,
    items: Object.fromEntries(Array.from({ length: o.items ?? 0 }, (_, i) => [`item${i}`, { name: txt(), desc: txt(), glyph: 'key' }])),
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
/** A save body around a world state, as the autosave writes one (format 2, the empty stage, one backlog line). */
const bodyOf = (world: WorldState): SaveBody => ({
  format: 2,
  chapterId: 'ch1' as ChapterId,
  storyVersion: '0123456789abcdef' as StoryVersion,
  ink: '{"inkSaveVersion":10}',
  at: { lineId: 'ch1.start.c001' as LineId, knot: kn('start'), yield: null },
  staging: EMPTY_SNAPSHOT,
  checkpoint: null,
  chapterStart: { carry: {}, items: [] },
  backlog: [{ lineId: 'ch1.start.0001' as LineId, speaker: null, ru: 'Line 1.' }],
  world,
  worldVersion: 'fedcba9876543210',
});

/** A fixture view type the default registry lacks, named apart from the real view types so none shadows it (`types.find`
 *  takes the first match): `parts` cranks at 0..2, each starting at 2; a saved work fits while it has one value per
 *  crank. */
const CRANKS: PuzzleTypeData<string, unknown> = Object.freeze({
  type: 'cranks',
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
const TYPES: PuzzleTypes = [...PUZZLE_TYPES, CRANKS];
/** A second fixture view type, `cranks` but for its `workFits`, which throws on any saved work. */
const JAMMED: PuzzleTypeData<string, unknown> = Object.freeze({
  ...CRANKS,
  type: 'jammed',
  workFits: () => {
    throw new Error('jammed: this fixture type reads no saved work');
  },
});
const cranks = (parts: number): Json => ({ ...code(2), type: 'cranks', params: { parts }, solution: new Array<number>(parts).fill(1) });

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
  const v = kernel(source({ hall: room([exit('out', { story: 'end' })]) }, { puzzles: { gauge: cranks(3) } }), TYPES);
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
  // A work the save cannot keep (RULINGS 353 O3; fix1 F1, F2): never written, so one bad dispatch never refuses the whole
  // save. A hole is read as `undefined` (`every` skips it, the spread does not), and a work that is no array is no move.
  const deleted = [1, 0, 1, 0];
  delete deleted[1];
  const rows: ReadonlyArray<readonly [label: string, work: unknown, expected: 'wrote' | 'no-op']> = [
    ['-1', [0, -1, 0, 0], 'no-op'],
    ['1.5', [0, 1.5, 0, 0], 'no-op'],
    ['NaN', [0, Number.NaN, 0, 0], 'no-op'],
    ['2^53', [0, 2 ** 53, 0, 0], 'no-op'],
    ['a deleted index', deleted, 'no-op'],
    ['an elided index', [2, , 2, 2], 'no-op'],
    ['new Array(4)', new Array<number>(4), 'no-op'],
    ['a raised length', Object.assign([1, 0, 1, 0], { length: 6 }), 'no-op'],
    ["'x'", 'x', 'no-op'],
    ['undefined', undefined, 'no-op'],
    ['null', null, 'no-op'],
    ['the control', [1, 0, 0, 0], 'wrote'],
    ['2^53 - 1', [0, 2 ** 53 - 1, 0, 0], 'wrote'],
  ];
  // Each row judged alone (`expect.soft`): written, a no-op (the same state, no effect) or a throw, which only this judge
  // catches. Every state a dispatch returns then saves and loads: the save round trip is the contract, not the guard.
  for (const [label, work, expected] of rows) {
    const s = at('panel');
    let r: { state: WorldState; effects: ExploreEffect[] } | null = null;
    try {
      // The dispatch a play half could send at run time, past the action's static type (the guard's subject).
      r = reduce(w, s, { kind: 'device-moved', puzzle: DIAL, work: work as readonly number[] });
    } catch {
      r = null;
    }
    const outcome = r === null ? 'threw' : r.state !== s || r.effects.length > 0 ? 'wrote' : 'no-op';
    expect.soft(outcome, label).toBe(expected);
    if (r !== null) {
      const loaded = decodeSave(encodeSave(bodyOf(r.state)));
      expect.soft(loaded.ok ? 'decodes' : loaded.error.detail, `${label}: the save round trip`).toBe('decodes');
      if (expected === 'wrote') {
        expect.soft(loaded.ok ? loaded.value.world.puzzles : null, `${label}: the loaded runs`).toEqual(r.state.puzzles);
      }
    }
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

test('device: a saved work that no longer fits the device is dropped at resume', () => {
  // A new version's params: `gauge` now has three cranks and its save two; `wide` still fits; `drawer` is a code puzzle,
  // whose type has no `workFits`.
  const w = kernel(source({ hall: room([exit('out', { story: 'end' })]) }, { puzzles: { gauge: cranks(3), wide: cranks(2), drawer: code(2) } }), TYPES);
  const saved = (work: readonly number[]): PuzzleRun => ({ outcome: null, attempts: 1, hintsOpened: 0, work });
  const s = at('hall', { puzzles: { [pz('gauge')]: saved([0, 1]), [pz('wide')]: saved([2, 0]), [pz('drawer')]: saved([2, 0, 1]) } });
  const dropped: string[] = [];
  const r = fitWork(w, s, dropped, TYPES);
  // The misfit work goes as `work:<p>` and its run stays; a fitting work and a type with no `workFits` keep theirs.
  expect(r.puzzles).toStrictEqual({ gauge: { outcome: null, attempts: 1, hintsOpened: 0 }, wide: saved([2, 0]), drawer: saved([2, 0, 1]) });
  expect(dropped).toEqual(['work:gauge']);
  expect({ ...r, puzzles: s.puzzles }).toEqual(s);
  // Nothing left to drop: the same state, nothing reported.
  const none: string[] = [];
  expect(fitWork(w, r, none, TYPES)).toBe(r);
  expect(none).toEqual([]);
  // The registry's normalize judges by the registered types: a type they lack (the fixture `cranks`) keeps its work, as
  // a type with no `workFits` does (a registered view type's misfit goes: the next test).
  const kept: string[] = [];
  expect(normalizeDevices(w, s, kept)).toBe(s);
  expect(kept).toEqual([]);
});

test('device: a saved work its type throws on is dropped at resume', () => {
  // A `workFits` that throws is a misfit (`instanceOf.fits`' reading, RULINGS 368): its work goes as `work:<p>` and its
  // run stays, and the runs after it are judged as before (the misfit `gauge` still goes, the rest keep theirs).
  const types: PuzzleTypes = [...TYPES, JAMMED];
  const puzzles = { wide: cranks(2), stuck: { ...cranks(2), type: 'jammed' }, gauge: cranks(3), drawer: code(2) };
  const w = kernel(source({ hall: room([exit('out', { story: 'end' })]) }, { puzzles }), types);
  const saved = (work: readonly number[]): PuzzleRun => ({ outcome: null, attempts: 1, hintsOpened: 0, work });
  const s = at('hall', { puzzles: { [pz('wide')]: saved([2, 0]), [pz('stuck')]: saved([0, 0]), [pz('gauge')]: saved([0, 1]), [pz('drawer')]: saved([2, 0, 1]) } });
  const dropped: string[] = [];
  const r = fitWork(w, s, dropped, types);
  const bare = { outcome: null, attempts: 1, hintsOpened: 0 };
  expect(r.puzzles).toStrictEqual({ wide: saved([2, 0]), stuck: bare, gauge: bare, drawer: saved([2, 0, 1]) });
  expect(dropped).toEqual(['work:stuck', 'work:gauge']);
});

test("device: the default registry drops a real view type's misfit work at resume", () => {
  // D8 (A9): the registry wiring on a real view type. `gate` is a levers device whose two levers each move the other
  // (critique W1): from the start only 0 0 and 1 1 are reachable. Decoded and judged with the default registry, no types.
  const gate = {
    ...code(2),
    type: 'levers',
    params: { parts: 2, positions: 2, couples: [[1], [0]], target: [1, 1], rects: [[100, 800, 200, 200], [600, 800, 200, 200]] },
    solution: [1, 1],
  };
  const w = kernel(source({ hall: room([exit('out', { story: 'end' })]) }, { puzzles: { gate } }));
  const saved = (work: readonly number[]): WorldState => at('hall', { puzzles: { [pz('gate')]: { outcome: null, attempts: 0, hintsOpened: 0, work } } });
  const judged = (work: readonly number[]): { readonly work: readonly number[] | undefined; readonly dropped: string[] } => {
    const dropped: string[] = [];
    return { work: normalizeDevices(w, saved(work), dropped).puzzles[pz('gate')]?.work, dropped };
  };
  // A work of another length (an older version's three levers) goes, and so does one the throws never reach (B2).
  expect(judged([1, 1, 0])).toEqual({ work: undefined, dropped: ['work:gate'] });
  expect(judged([0, 1])).toEqual({ work: undefined, dropped: ['work:gate'] });
  // A fitting work stays.
  expect(judged([1, 1])).toEqual({ work: [1, 1], dropped: [] });
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

test("device: a hotspot of another room sharing the device's id opens nothing", () => {
  // The device is the room's own (fix1, gates F2): the hall's `dial`, an ordinary zero-slot lock on the code puzzle
  // `safe` with the device's hotspot id, is no device, and neither is a view named with the hall's prefix (`hall_panel`).
  const world = (view: string): KernelWorld =>
    kernel(
      source(
        {
          hall: room([exit('to_panel', view), exit('out', { story: 'end' }), object('dial', lock('safe'))]),
          [view]: room([object('dial', lock('dial'))], { view: { of: 'hall' }, device: 'dial' }),
        },
        { puzzles: { dial: code(4), safe: code(3) } },
      ),
    );
  for (const view of ['panel', 'hall_panel']) {
    const w = world(view);
    // The zoom-in opens the device of the view it enters.
    const zoomed = reduce(w, at('hall'), tap('hall.to_panel'));
    expect(opens(zoomed.effects), `${view}: the zoom-in`).toEqual([{ kind: 'puzzle', puzzle: 'dial', hotspot: `${view}.dial` }]);
    // An arrival in the hall, by a leave-view or a resume, opens nothing: the hall has no device.
    expect(opens(reduce(w, zoomed.state, { kind: 'leave-view' }).effects), `${view}: the leave-view`).toEqual([]);
    expect(opens(reduce(w, at('hall'), { kind: 'enter-section', section: S }).effects), `${view}: the resume`).toEqual([]);
    // Non-vacuity: the hall's own tap opens its safe.
    expect(opens(reduce(w, at('hall'), tap('hall.dial')).effects), `${view}: the hall's tap`).toEqual([{ kind: 'puzzle', puzzle: 'safe', hotspot: 'hall.dial' }]);
  }
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

test("search: an uncapped device's arrival adds one evaluation and no state", () => {
  // P3: the world above with an uncapped device. With no cap it never fails, so the one zoom-in edge into the present,
  // unsolved device expands into its `closed` edge and its one outcome, as the device's own tap does: one evaluation
  // more than a registry without the hook, on the same states (the entry, `power` set, the device solved).
  const w = kernel(
    source(
      {
        hall: room([look('switch', [{ set: 'power' }]), exit('to_panel', 'panel'), exit('out', { story: 'end' })]),
        panel: room([object('dial', lock('dial'), { when: { flag: 'power' } })], { view: { of: 'hall' }, device: 'dial' }),
      },
      { puzzles: { dial: code(2) }, flags: { power: 's' } },
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
  expect({ result: hooked.result, states: hooked.states, expansions: hooked.stats?.expansions }).toEqual({
    result: plain.result,
    states: plain.states,
    expansions: plain.stats?.expansions,
  });
  expect((hooked.stats?.work ?? 0) - (plain.stats?.work ?? 0)).toBe(1);
  expect(hooked.stats?.work).toBeLessThanOrEqual(plain.states * RESUME_WORK_PER_STATE);
  expect([plain.states, plain.stats, hooked.stats]).toEqual([3, { expansions: 6, work: 18, bound: null }, { expansions: 6, work: 19, bound: null }]);
  // The hook is live: with `power` set, the zoom-in expands into the device's `closed` edge and its one outcome.
  const lit = at('hall', { flags: [fl('power')], fired: ['enter:hall', 'then:hall.switch'], examined: [k('hall.switch')] });
  const kinds = (s: WorldState, rules: RulesRegistry): string[] => successors(w, s, rules).map((x) => x.step.kind);
  expect([kinds(lit, quiet), kinds(lit, all)]).toEqual([
    ['tap', 'tap', 'tap'],
    ['tap', 'closed', 'puzzle-ended', 'tap'],
  ]);
  // The search reads one `puzzle` effect per action, so a second one would leave every count above unmoved: the
  // arrival's effect stream is what pins the hook to exactly one opening.
  expect(opens(reduce(w, lit, tap('hall.to_panel')).effects)).toEqual([OPEN_DIAL]);
});

// ---------------------------------------------------------------------------------------------------------------
// The story gate: placement lints (each a code of the module's own table) and the band

const CATALOG: AssetCatalog = { bg: {}, chars: {}, cg: {}, bgm: {}, sfx: {}, prop: {}, cover: {} };

/** The devices lint over `raw` decoded with the fixture types, `yielded` the puzzles the chapter yields, `lints` the
 *  puzzle lint halves (the registered ones unless given): each finding as `<code> <message>` (a message starts with its
 *  path). */
function lint(raw: Json, yielded: readonly string[] = [], lints?: PuzzleLintRegistry): string[] {
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
  return devicesFindings(input, TYPES, lints).map((f) => {
    expect([f.severity, f.file, paths[f.line - 1] !== undefined && f.message.startsWith(`${paths[f.line - 1] ?? ''}: `)]).toEqual(['E', 'story/ch1/world.json', true]);
    return `${f.code} ${f.message}`;
  });
}

/**
 * A lint fixture: the hall and its device view `panel`, whose device hotspot `dial` carries `o.dial` (default: a zero-slot
 * lock with the view-type puzzle `dial`); `o.hall` adds hotspots to the hall and `o.hallKeys` keys, `o.spots` hotspots to
 * the panel after the device and `o.panel` keys, `o.puzzles` puzzles beside `dial` (a `CRANKS` puzzle of four parts, each
 * at 0..2, unless replaced), `o.items` the items the world declares (none unless given).
 */
function deviceWorld(
  o: { dial?: Json; hall?: readonly Json[]; hallKeys?: Json; spots?: readonly Json[]; panel?: Json; puzzles?: Json; items?: number } = {},
): Json {
  return source(
    {
      hall: room([exit('to_panel', 'panel'), exit('out', { story: 'end' }), ...(o.hall ?? [])], o.hallKeys),
      panel: room([o.dial ?? object('dial', lock('dial')), ...(o.spots ?? [])], { view: { of: 'hall' }, device: 'dial', ...o.panel }),
    },
    { puzzles: { dial: cranks(4), ...o.puzzles }, items: o.items ?? 0 },
  );
}

/** A decor picture `id` whose state `on` shows while `when` holds. */
const decor = (id: string, when: Json): Json => ({ id, prop: 'lever', rect: [100, 900, 160, 320], z: 1, states: { on: { prop: 'lever_up' } }, is: [{ when, state: 'on' }] });
/** A `part` atom of `puzzle`. */
const part = (puzzle: string, index: number, is: number): Json => ({ part: { puzzle, index, is } });

/** A `levers` device puzzle with a lever per rect: two positions, no couples, every target 1 (one throw each); `o.hints`
 *  its ladder, none unless given (`code()`'s default tier holds no `[moves]`). */
function leversPuzzle(rects: readonly Rect[], o: { hints?: readonly Json[] } = {}): Json {
  const target = rects.map(() => 1);
  return { ...code(2), type: 'levers', params: { parts: rects.length, positions: 2, couples: rects.map(() => []), target, rects }, solution: target, hints: o.hints ?? [] };
}
/** A `setting` device puzzle with a knob of ten positions per rect and its pull at `pull`; `o.hints` its ladder. */
function settingPuzzle(rects: readonly Rect[], pull: Rect, o: { hints?: readonly Json[] } = {}): Json {
  return { ...code(2), type: 'setting', params: { parts: rects.length, positions: 10, rects, pull }, solution: rects.map((_, i) => i + 1), hints: o.hints ?? [] };
}
/** Two parts inside the frame, under the band, above the ribbon and apart: the base every part row breaks one clause of. */
const PARTS: readonly Rect[] = [
  [100, 800, 150, 150],
  [400, 800, 150, 150],
];
/** A hint tier whose ru text is `ru`. */
const hint = (ru: string): Json => ({ ...txt(), ru });
/** The `world/device-parts-frame` finding of part `i` of the device puzzle `dial` at `rect`, reported at `params<at>`. */
const partFinding = (at: string, i: number, rect: Rect, why: string): string =>
  `world/device-parts-frame puzzles.dial.params${at}: part ${i} of puzzle 'dial' [${rect.join(', ')}] ${why} (§7.5)`;

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
    puzzles: { loose: cranks(2), safe: cranks(2), box: cranks(1) },
  });
  expect(lint(w, ['loose'])).toEqual([
    "world/view-type-site puzzles.loose: view-type puzzle 'loose' is on no lock: a view type is played only by its device, never as a linear yield (§7.5)",
    "world/view-type-site sections.s.rooms.hall.hotspots.2.lock.puzzle: view-type puzzle 'safe' is on a lock that is no view room's device: a view type is the puzzle of its device's zero-slot lock (§7.5)",
    "world/view-type-site sections.s.rooms.hall.hotspots.3.lock.puzzle: view-type puzzle 'box' is on a lock with slots: a view type is the puzzle of its device's zero-slot lock (§7.5)",
  ]);
  // A `device` on a room that is no view.
  const flat = source({ hall: room([object('dial', lock('dial')), exit('out', { story: 'end' })], { device: 'dial' }) }, { puzzles: { dial: cranks(4) } });
  expect(lint(flat)).toEqual([
    "world/view-type-site sections.s.rooms.hall.device: room 'hall' is no view: a device sits in a view room (§7.5)",
    "world/view-type-site sections.s.rooms.hall.hotspots.0.lock.puzzle: view-type puzzle 'dial' is on a lock that is no view room's device: a view type is the puzzle of its device's zero-slot lock (§7.5)",
  ]);
});

test('story: a device puzzle with a close-up is refused', () => {
  expect(lint(deviceWorld({ puzzles: { dial: { ...cranks(4), closeup: 'cabinet' } } }))).toEqual([
    "world/device-closeup puzzles.dial.closeup: view-type puzzle 'dial' has close-up 'cabinet': a device is played in its room, never under a close-up (§7.5)",
  ]);
});

test('story: a capped device without a failed state is refused', () => {
  const capped = { puzzles: { dial: { ...cranks(4), maxAttempts: 3 } } };
  const FAILED =
    "world/device-failed-state sections.s.rooms.panel.device: puzzle 'dial' has maxAttempts 3 and no decor or device state reads { failed: 'dial' }: a jammed device never looks live (§7.5)";
  // Uncapped, a device never jams: no failed state is owed.
  expect(lint(deviceWorld())).toEqual([]);
  expect(lint(deviceWorld(capped))).toEqual([FAILED]);
  // A decor state reading the solve, or another puzzle's failure, is no jam of this device.
  expect(lint(deviceWorld({ ...capped, panel: { decor: [decor('lamp', { solved: 'dial' }), decor('vent', { failed: 'safe' })] } }))).toEqual([FAILED]);
  // A decor state of the room reading `{ failed: p }`, here under a combinator, shows the jam.
  expect(lint(deviceWorld({ ...capped, panel: { decor: [decor('jam', { all: [{ failed: 'dial' }, { visited: 'hall' }] })] } }))).toEqual([]);
  // So does the device hotspot's own state.
  const own = object('dial', lock('dial'), { prop: 'dial', states: { jam: { prop: 'dial_jam' } }, is: [{ when: { failed: 'dial' }, state: 'jam' }] });
  expect(lint(deviceWorld({ ...capped, dial: own }))).toEqual([]);
  // A decor state in another room does not.
  expect(lint(deviceWorld({ ...capped, hallKeys: { decor: [decor('jam', { failed: 'dial' })] } }))).toEqual([FAILED]);
});

test('story: a device hotspot that is no plain object is refused', () => {
  // An exit carrying the device's zero-slot lock.
  const door = { ...exit('dial', 'hall'), lock: lock('dial') };
  expect(lint(deviceWorld({ dial: door }))).toEqual(["world/device-object sections.s.rooms.panel.hotspots.0: device hotspot 'dial' is an exit: a device's hotspot is an object (§7.5)"]);
  // An object an item is used on.
  const used = object('dial', lock('dial'), { uses: [{ item: 'oil', do: [] }] });
  expect(lint(deviceWorld({ dial: used }))).toEqual([
    "world/device-object sections.s.rooms.panel.hotspots.0.uses: device hotspot 'dial' carries uses: a device is played by its parts, never used on (§7.5)",
  ]);
});

test('story: a device hotspot with a when is refused', () => {
  const hidden = object('dial', lock('dial'), { when: { visited: 'hall' } });
  expect(lint(deviceWorld({ dial: hidden }))).toEqual([
    "world/device-when sections.s.rooms.panel.hotspots.0.when: device hotspot 'dial' has a when: a device is always present in its view (§7.5)",
  ]);
  // `when: null` is the always-present default.
  expect(lint(deviceWorld({ dial: object('dial', lock('dial'), { when: null }) }))).toEqual([]);
});

test('story: a device room with another puzzle lock is refused', () => {
  // A plain slot lock and a lockless object beside the device are allowed; a second puzzle lock is not. The spots sit
  // under the bar's band, as every hotspot of a device room does.
  const spots = [
    object('box', lock(null, ['key']), { rect: [100, 800, 200, 200] }),
    object('vase', null, { rect: [400, 800, 200, 200] }),
    object('safe', lock('safe'), { rect: [700, 800, 200, 200] }),
  ];
  expect(lint(deviceWorld({ spots, puzzles: { safe: code(3) } }))).toEqual([
    "world/device-alone sections.s.rooms.panel.hotspots.3.lock.puzzle: hotspot 'safe' carries puzzle 'safe' beside device 'dial': a device room holds no other puzzle lock (§7.5)",
  ]);
  expect(lint(deviceWorld({ spots: spots.slice(0, 2) }))).toEqual([]);
});

test('story: a remote unlock of a device is refused', () => {
  const UNLOCK = { unlock: 'panel.dial' };
  // From a room's onEnter (at the list's path, after a give), and from a use rule's do.
  const crate = object('crate', null, { uses: [{ item: 'oil', do: [UNLOCK] }] });
  expect(lint(deviceWorld({ hallKeys: { onEnter: [{ give: 'oil' }, UNLOCK] }, hall: [crate] }))).toEqual([
    'world/device-unlock sections.s.rooms.hall.onEnter: room hall onEnter unlocks device panel.dial: a device opens only by its own puzzle (§7.5)',
    'world/device-unlock sections.s.rooms.hall.hotspots.2.uses.0.do: rule 0 of hall.crate unlocks device panel.dial: a device opens only by its own puzzle (§7.5)',
  ]);
  // From a hotspot's then and a lock's onOpen and onFail.
  const note = look('note', [UNLOCK]);
  const gate = object('gate', { ...lock(null, ['oil']), onOpen: [UNLOCK], onFail: [UNLOCK] });
  expect(lint(deviceWorld({ hall: [note, gate] }))).toEqual([
    'world/device-unlock sections.s.rooms.hall.hotspots.2.then: hall.note then unlocks device panel.dial: a device opens only by its own puzzle (§7.5)',
    'world/device-unlock sections.s.rooms.hall.hotspots.3.lock.onOpen: hall.gate onOpen unlocks device panel.dial: a device opens only by its own puzzle (§7.5)',
    'world/device-unlock sections.s.rooms.hall.hotspots.3.lock.onFail: hall.gate onFail unlocks device panel.dial: a device opens only by its own puzzle (§7.5)',
  ]);
  // An unlock of an ordinary lock is no device's.
  expect(lint(deviceWorld({ hallKeys: { onEnter: [{ unlock: 'hall.gate' }] }, hall: [object('gate', lock(null, ['oil']))] }))).toEqual([]);
});

test("story: a part atom outside its device's range is refused", () => {
  // The device `dial` has four parts at 0..2: index 3 and is 2 are its last.
  const within = [decor('a', part('dial', 3, 2)), decor('b', { not: part('dial', 0, 0) })];
  expect(lint(deviceWorld({ panel: { decor: within } }))).toEqual([]);
  // Not the room's device: another puzzle in the device room, and any part in a room with no device.
  const DECOR = 'world/device-part sections.s.rooms';
  expect(lint(deviceWorld({ panel: { decor: [decor('a', part('safe', 0, 1))] }, puzzles: { safe: code(3) } }))).toEqual([
    `${DECOR}.panel.decor.0.is.0.when: {"part":{"puzzle":"safe","index":0,"is":1}} reads puzzle 'safe', but room 'panel''s device is 'dial': a part reads its own room's device (§7.5)`,
  ]);
  expect(lint(deviceWorld({ hallKeys: { decor: [decor('a', part('dial', 0, 1))] } }))).toEqual([
    `${DECOR}.hall.decor.0.is.0.when: {"part":{"puzzle":"dial","index":0,"is":1}} reads puzzle 'dial', but room 'hall' has no device: a part reads its own room's device (§7.5)`,
  ]);
  // `index` not below the part count, and `is` above the type's max, from a decor (under a `not` too) and from the device
  // hotspot's own state.
  const own = object('dial', lock('dial'), { prop: 'dial', states: { on: { prop: 'dial_on' } }, is: [{ when: { any: [part('dial', 0, 1), part('dial', 1, 3)] }, state: 'on' }] });
  expect(lint(deviceWorld({ dial: own, panel: { decor: [decor('a', part('dial', 4, 1)), decor('b', { not: part('dial', 0, 5) })] } }))).toEqual([
    `${DECOR}.panel.hotspots.0.is.0.when: {"part":{"puzzle":"dial","index":1,"is":3}}: is 3 is outside the part's range 0..2 (§7.5)`,
    `${DECOR}.panel.decor.0.is.0.when: {"part":{"puzzle":"dial","index":4,"is":1}}: index 4 is not below the device's 4 parts (§7.5)`,
    `${DECOR}.panel.decor.1.is.0.when: {"part":{"puzzle":"dial","index":0,"is":5}}: is 5 is outside the part's range 0..2 (§7.5)`,
  ]);
});

test("story: a part atom in a clue reads a device's work within its shape", () => {
  // RULINGS 356 (b): a clue's `part` reads any room's device, within that device's answer shape (the `cranks` dial: four
  // parts at 0..2), and is reported at the clue.
  const clues = [part('dial', 4, 1), part('dial', 0, 3), part('safe', 0, 1), part('dial', 3, 2)];
  const CLUE = 'world/device-part puzzles.safe.clues';
  expect(lint(deviceWorld({ puzzles: { safe: { ...code(3), clues } } }))).toEqual([
    `${CLUE}.0: {"part":{"puzzle":"dial","index":4,"is":1}}: index 4 is not below the device's 4 parts (§7.5)`,
    `${CLUE}.1: {"part":{"puzzle":"dial","index":0,"is":3}}: is 3 is outside the part's range 0..2 (§7.5)`,
    `${CLUE}.2: {"part":{"puzzle":"safe","index":0,"is":1}} reads puzzle 'safe', which is no room's device: a clue's part reads a device's work (§7.5)`,
  ]);
});

test('story: a part atom on a device lock with no puzzle says the device has no puzzle', () => {
  // M1: the room has a device, whose lock names no puzzle; beside the lock's own two findings.
  expect(lint(deviceWorld({ dial: object('dial', lock(null)), panel: { decor: [decor('a', part('dial', 0, 1))] } }))).toEqual([
    "world/device-type sections.s.rooms.panel.device: hotspot 'dial' carries a lock with no puzzle: a device's hotspot carries a zero-slot lock with its puzzle (§7.5)",
    "world/view-type-site puzzles.dial: view-type puzzle 'dial' is on no lock: a view type is played only by its device, never as a linear yield (§7.5)",
    `world/device-part sections.s.rooms.panel.decor.0.is.0.when: {"part":{"puzzle":"dial","index":0,"is":1}} reads puzzle 'dial', but room 'panel''s device has no puzzle: a part reads its own room's device (§7.5)`,
  ]);
});

test("story: a levers puzzle's [moves] sits once in its last ru tier, at its line", () => {
  // W6 (07 §7.3): the build replaces the last tier's `[moves]` with the throw order, so it sits there exactly once and in
  // no earlier tier; refused at the tier (the emit's own throw names no puzzle).
  const ladder = (...ru: string[]): string[] => lint(deviceWorld({ puzzles: { dial: leversPuzzle(PARTS, { hints: ru.map(hint) }) } }));
  const moves = (i: number, why: string): string => `world/hint-moves puzzles.dial.hints.${i}: levers puzzle 'dial': ${why} (§7.3, W6)`;
  expect(ladder('Один', 'Два', 'Порядок.')).toEqual([moves(2, 'its last hint tier (3 of 3) holds no [moves], which the build replaces with the throw order')]);
  expect(ladder('[moves], [moves]')).toEqual([moves(0, 'its last hint tier (1 of 1) holds [moves] 2 times, not once')]);
  expect(ladder('Сначала [moves].', 'Порядок: [moves].')).toEqual([moves(0, 'hint tier 1 of 2 holds [moves], which only the last tier may')]);
  // The controls: a clean ladder, and none.
  expect(ladder('Один', 'Порядок: [moves].')).toEqual([]);
  expect(ladder()).toEqual([]);
});

test('story: [moves] on a puzzle that is no levers is refused at its line', () => {
  // No other type's build replaces it: shipped, it would show as written.
  const OTHER = "hint tier 1 holds [moves], which only a levers puzzle's last tier may (§7.3, W6)";
  expect(lint(deviceWorld({ puzzles: { safe: { ...code(3), hints: [hint('Код: [moves].')] } } }))).toEqual([`world/hint-moves puzzles.safe.hints.0: code puzzle 'safe': ${OTHER}`]);
  // A `setting` device, its pull inside the frame, under the band, above the ribbon and apart from its knobs.
  const setting = settingPuzzle(PARTS, [100, 1000, 300, 150], { hints: [hint('Ручки: [moves].')] });
  expect(lint(deviceWorld({ puzzles: { dial: setting } }))).toEqual([`world/hint-moves puzzles.dial.hints.0: setting puzzle 'dial': ${OTHER}`]);
});

test("story: a device part outside the safe frame or under the bar's band is refused", () => {
  // D1 on a real `levers` device, one row per live edge; each row breaks that edge alone (the base PARTS elsewhere).
  const dial = (rects: readonly Rect[]): string[] => lint(deviceWorld({ puzzles: { dial: leversPuzzle(rects) } }));
  const LEFT = "starts at x 79, left of the safe frame's x 80";
  expect(dial(PARTS)).toEqual([]);
  // The left edge, strict: x 79 refused, x 80 clean.
  expect(dial([[79, 800, 150, 150], [400, 800, 150, 150]])).toEqual([partFinding('.rects.0', 0, [79, 800, 150, 150], LEFT)]);
  expect(dial([[80, 800, 150, 150], [400, 800, 150, 150]])).toEqual([]);
  // The right edge: a part ending at x 1000 clean, at 1001 refused.
  expect(dial([[100, 800, 150, 150], [850, 800, 150, 150]])).toEqual([]);
  expect(dial([[100, 800, 150, 150], [851, 800, 150, 150]])).toEqual([
    partFinding('.rects.1', 1, [851, 800, 150, 150], "ends at x 1001, right of the safe frame's x 1000"),
  ]);
  // Each side's minimum, in either dimension: 149 refused (150 x 150 is the base, clean).
  expect(dial([[100, 800, 149, 150], [400, 800, 150, 150]])).toEqual([partFinding('.rects.0', 0, [100, 800, 149, 150], 'is 149×150, a side under 150 source px')]);
  expect(dial([[100, 800, 150, 149], [400, 800, 150, 150]])).toEqual([partFinding('.rects.0', 0, [100, 800, 150, 149], 'is 150×149, a side under 150 source px')]);
  // The band, against its constant (B3 moves it): a top one px above it refused, a top on it clean.
  const above: Rect = [100, DEVICE_BAND_Y - 1, 150, 150];
  expect(dial([above, [400, 800, 150, 150]])).toEqual([
    partFinding('.rects.0', 0, above, `starts at y ${DEVICE_BAND_Y - 1}, above the device bar's band at y ${DEVICE_BAND_Y}`),
  ]);
  expect(dial([[100, DEVICE_BAND_Y, 150, 150], [400, 800, 150, 150]])).toEqual([]);
  // D3: a `setting` pull is a part too, the last, reported at its own key.
  const pull: Rect = [79, 1000, 300, 150];
  expect(lint(deviceWorld({ puzzles: { dial: settingPuzzle(PARTS, pull) } }))).toEqual([partFinding('.pull', 2, pull, LEFT)]);
  // A lint half whose rects are no value of the params (copies) is reported at the params, the part index in its message:
  // given through the `lints` parameter, for the fixture `cranks` device.
  const copies: PuzzleLintRegistry = { ...PUZZLE_LINTS, cranks: { countSolutions: () => 1, partRects: (): readonly Rect[] => [[79, 800, 150, 150]] } };
  expect(lint(deviceWorld(), [], copies)).toEqual([partFinding('', 0, [79, 800, 150, 150], LEFT)]);
});

test("story: a device part under the bar's band is refused", () => {
  // B3: the band sits under the fullscreen header's inset, so a top the bar alone left clear (496..732) is under it.
  const tops = [496, 600];
  const at = (top: number): Rect => [100, top, 150, 150];
  expect(tops.map((top) => lint(deviceWorld({ puzzles: { dial: leversPuzzle([at(top), [400, 800, 150, 150]]) } })))).toEqual(
    tops.map((top) => [partFinding('.rects.0', 0, at(top), `starts at y ${top}, above the device bar's band at y ${DEVICE_BAND_Y}`)]),
  );
});

test('story: device parts that overlap are refused', () => {
  // The later part takes the taps where two overlap, and a device is a lock with no other way in; edge-touching is clean.
  const over: Rect = [200, 800, 150, 150];
  expect(lint(deviceWorld({ puzzles: { dial: leversPuzzle([[100, 800, 150, 150], over]) } }))).toEqual([
    partFinding('.rects.1', 1, over, 'overlaps part 0, which then takes its taps'),
  ]);
  // A `setting` pull over a knob.
  const pull: Rect = [450, 850, 150, 150];
  expect(lint(deviceWorld({ puzzles: { dial: settingPuzzle(PARTS, pull) } }))).toEqual([partFinding('.pull', 2, pull, 'overlaps part 1, which then takes its taps')]);
  // Three levers touching on both axes.
  const touching: readonly Rect[] = [
    [100, 800, 150, 150],
    [250, 800, 150, 150],
    [100, 950, 150, 150],
  ];
  expect(lint(deviceWorld({ puzzles: { dial: leversPuzzle(touching) } }))).toEqual([]);
});

test("story: the device part checks run once per device puzzle, on a view room's device only", () => {
  const bad: readonly Rect[] = [
    [79, 800, 150, 150],
    [400, 800, 150, 150],
  ];
  // A view-type puzzle on no lock is `world/view-type-site`'s alone: one root cause, one finding.
  expect(lint(deviceWorld({ puzzles: { loose: leversPuzzle(bad) } }))).toEqual([
    "world/view-type-site puzzles.loose: view-type puzzle 'loose' is on no lock: a view type is played only by its device, never as a linear yield (§7.5)",
  ]);
  // A `device` in a room that is no view: the site's two findings alone (no seat, so no part is judged).
  const flat = source({ hall: room([object('dial', lock('dial')), exit('out', { story: 'end' })], { device: 'dial' }) }, { puzzles: { dial: leversPuzzle(bad) } });
  expect(lint(flat)).toEqual([
    "world/view-type-site sections.s.rooms.hall.device: room 'hall' is no view: a device sits in a view room (§7.5)",
    "world/view-type-site sections.s.rooms.hall.hotspots.0.lock.puzzle: view-type puzzle 'dial' is on a lock that is no view room's device: a view type is the puzzle of its device's zero-slot lock (§7.5)",
  ]);
  // One puzzle as the device of two view rooms: its parts are judged once, at its first device room.
  const view = room([object('dial', lock('dial'))], { view: { of: 'hall' }, device: 'dial' });
  const twice = source(
    { hall: room([exit('to_panel', 'panel'), exit('to_panel2', 'panel2'), exit('out', { story: 'end' })]), panel: view, panel2: view },
    { puzzles: { dial: leversPuzzle(bad) } },
  );
  expect(lint(twice)).toEqual([partFinding('.rects.0', 0, [79, 800, 150, 150], "starts at x 79, left of the safe frame's x 80")]);
});

test('story: a device part ending under the item ribbon is refused', () => {
  // D5: the item ribbon shows over the open device, its rows from the items the world declares (4 a row on the 320 px
  // basis, over the mock's 34 px bottom inset), so a part ends above its top: y 1450 for one row, 1234 for two. Literal
  // figures: a row written against the bound would move with a wrong inset.
  const dial = (rect: Rect, items: number): string[] => lint(deviceWorld({ items, puzzles: { dial: leversPuzzle([rect, [400, 800, 150, 150]]) } }));
  const under = (rect: Rect, floor: number, items: number): string =>
    partFinding('.rects.0', 0, rect, `ends at y ${rect[1] + rect[3]}, below y ${floor}, the item ribbon's top for ${items} declared items`);
  // No item: one row.
  expect(dial([100, 1300, 150, 150], 0)).toEqual([]);
  expect(dial([100, 1301, 150, 150], 0)).toEqual([under([100, 1301, 150, 150], 1450, 0)]);
  // Four items fill one row; a fifth starts the second.
  expect(dial([100, 1300, 150, 150], 4)).toEqual([]);
  expect(dial([100, 1300, 150, 150], 5)).toEqual([under([100, 1300, 150, 150], 1234, 5)]);
  expect(dial([100, 1084, 150, 150], 5)).toEqual([]);
  expect(dial([100, 1085, 150, 150], 5)).toEqual([under([100, 1085, 150, 150], 1234, 5)]);
});

test("devices: the ribbon bound follows the ribbon's rows", () => {
  // Ribbon.svelte on the 320 px basis: 60 px over the bottom inset, 8 px padding under 56 px slots with 8 px gaps and
  // 12 px side padding (4 slots a row), each CSS px 3.375 canonical px rounded up, from the cover's visible bottom (1984).
  expect([DEVICE_BOTTOM_INSET_CSS, DEVICE_RIBBON_PER_ROW]).toEqual([34, 4]);
  expect([1, 2, 3, 4].map((rows) => deviceRibbonY(rows, 34))).toEqual([1450, 1234, 1018, 802]);
  expect([deviceRibbonY(1, 0), deviceRibbonY(2, 0)]).toEqual([1565, 1349]);
  expect([0, 4, 5, 8, 9].map((items) => deviceRibbonRows(items))).toEqual([1, 1, 2, 2, 3]);
});

test("story: a device room's hotspot under the bar's band or under a part is refused", () => {
  // F6: while the device is open its bar covers the band and takes the taps there, and a part takes the taps of what it
  // lies over. The device's own hotspot draws no button, so it is never judged.
  const vase = (rect: Rect): string[] => lint(deviceWorld({ spots: [object('vase', null, { rect })], puzzles: { dial: leversPuzzle(PARTS) } }));
  const cover = (rect: Rect, why: string): string =>
    `world/device-hotspot-cover sections.s.rooms.panel.hotspots.1.rect: hotspot 'vase' [${rect.join(', ')}] ${why} (§7.5)`;
  const band = (y: number): string => `starts at y ${y}, above the device bar's band at y ${DEVICE_BAND_Y}, which covers it while the device is open`;
  // F6a, against the band's constant: a top one px above it, a hotspot wholly above it, one straddling it; a top on it
  // is clean.
  const edge: Rect = [700, DEVICE_BAND_Y - 1, 150, 150];
  expect(vase(edge)).toEqual([cover(edge, band(DEVICE_BAND_Y - 1))]);
  expect(vase([700, 520, 150, 150])).toEqual([cover([700, 520, 150, 150], band(520))]);
  expect(vase([700, 600, 200, 200])).toEqual([cover([700, 600, 200, 200], band(600))]);
  expect(vase([700, DEVICE_BAND_Y, 150, 150])).toEqual([]);
  // F6b: a part over the hotspot.
  expect(vase([400, 800, 200, 200])).toEqual([cover([400, 800, 200, 200], "lies under part 1 of puzzle 'dial', which takes its taps")]);
  // The control: the device's own hotspot under a part.
  expect(lint(deviceWorld({ dial: object('dial', lock('dial'), { rect: [100, 800, 200, 200] }), puzzles: { dial: leversPuzzle(PARTS) } }))).toEqual([]);
});

test("devices: every view type's lint half gives its part rects", () => {
  // D2: the lint skips a view type whose lint half has no `partRects`, so the registry holds every view type to one.
  const views = PUZZLE_TYPES.filter((t) => t.presentation === 'view').map((t) => t.type);
  expect(views).toEqual(expect.arrayContaining(['levers', 'setting']));
  const lints: PuzzleLintRegistry = PUZZLE_LINTS;
  for (const t of views) {
    expect(typeof lints[t]?.partRects, t).toBe('function');
  }
});

test('story: the device part checks read the shared bounds, never a copy', () => {
  // A2: the frame and the side minimum are geom/cover.ts's, imported; no figure of theirs or of the band is written in
  // the lint's code. Comments are stripped first: they may state the figures.
  const code = stripComments(devicesSource);
  // Never vacuous: the stripped text is the module's code, and it had comments to strip.
  expect([code.includes('export function devicesFindings'), code.includes('export const DEVICES_LINT'), code.length < devicesSource.length]).toEqual([true, true, true]);
  const names = [...code.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'(?:\.\.\/)+src\/geom\/cover\.ts';/gm)].flatMap((m) => (m[1] ?? '').split(',').map((n) => n.trim()));
  expect(names).toEqual(expect.arrayContaining(['HOTSPOT_MIN_SOURCE_PX', 'HOTSPOT_SAFE_FRAME']));
  expect(code).not.toMatch(/\b150\b/);
  expect(code).not.toMatch(/\b733\b/);
  expect(code).not.toMatch(/\b(?:80|1000|160|1760)\b/);
});

test("devices: the band constant follows the bar's bound", () => {
  // 07 §7.5 round 6: 64 canonical px cropped at the top of a 320 px 9:16 cover, then 8 + bar + inset CSS px at 3.375
  // canonical px each, rounded up; the inset is the mock's largest top inset (B3).
  expect([DEVICE_BAR_CSS_H, DEVICE_TOP_INSET_CSS]).toEqual([120, 70]);
  expect([deviceBandY(120, 0), deviceBandY(120, 1)]).toEqual([496, 500]);
  expect(DEVICE_BAND_Y).toBe(deviceBandY(DEVICE_BAR_CSS_H, DEVICE_TOP_INSET_CSS));
  expect(DEVICE_BAND_Y).toBe(733);
});
