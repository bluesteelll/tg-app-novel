// Module `devices` (engine plan §7.5): a view room's `device` hotspot carries a zero-slot lock with the room's device
// puzzle, and its session opens on arrival (the `arrived` hook core runs at its three `room` pushes, never while a knot
// is pending), with the same `puzzle` effect the device's own tap reaches, so the proof's states are unchanged; an
// ended device plays its outcome's cue instead. A part's picture is a decor state chosen by the visual atom `part` over
// the device's saved work. Fixture worlds are written in the source format and decoded with the
// real registries; a proof world carries the decoded `mods`, as the explore controller's and the story gate's do.
import { expect, test } from 'vitest';

import { RESUME_STATE_CAP } from '../explore/reduce.ts';
import type { ExploreAction, ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { PuzzleRun, WorldState } from '../explore/state.ts';
import type { KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, RoomId } from '../world/types.ts';
import type { DecodeCtx, FlagId, KernelWorld, OwnedAt, RulesRegistry } from './contract.ts';
import { decodeCond } from './data/conditions.ts';
import { decodeDevices, encodeDevices } from './data/devices.ts';
import { reduce } from './rules/core.ts';
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

/** The proof world of a source: the public body with the decoded `mods`. */
function kernel(raw: Json): KernelWorld {
  const r = decodeWorldSource(raw);
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
