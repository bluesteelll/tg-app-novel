// Module `devices` (engine plan §7.5): a view room's `device` hotspot carries a zero-slot lock with the room's device
// puzzle, and its session opens on arrival (the `arrived` hook core runs at its three `room` pushes, never while a knot
// is pending), with the same `puzzle` effect the device's own tap reaches, so the proof's states are unchanged; an
// ended device plays its outcome's cue instead. Fixture worlds are written in the source format and decoded with the
// real registries; a proof world carries the decoded `mods`, as the explore controller's and the story gate's do.
import { expect, test } from 'vitest';

import { RESUME_STATE_CAP } from '../explore/reduce.ts';
import type { ExploreAction, ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { PuzzleRun, WorldState } from '../explore/state.ts';
import type { KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, RoomId } from '../world/types.ts';
import type { FlagId, KernelWorld, OwnedAt, RulesRegistry } from './contract.ts';
import { decodeDevices, encodeDevices } from './data/devices.ts';
import { reduce } from './rules/core.ts';
import { MECHANIC_RULES } from './rules/index.ts';
import { RESUME_WORK_PER_STATE, searchSection, sectionEntry, sectionPlaces, successors } from './rules/search.ts';
import type { SearchStats } from './rules/search.ts';

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
 * The hall and its device view `panel`: the device hotspot `dial` carries a zero-slot lock with the code puzzle `dial`.
 * `o.enter`: the panel's onEnter; `o.capped`: the puzzle's maxAttempts.
 */
function panel(o: { enter?: readonly Json[]; capped?: number } = {}): KernelWorld {
  return kernel(
    source(
      {
        hall: room([exit('to_panel', 'panel'), exit('out', { story: 'end' })]),
        panel: room([object('dial', lock('dial'))], { view: { of: 'hall' }, device: 'dial', onEnter: o.enter ?? [] }),
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
