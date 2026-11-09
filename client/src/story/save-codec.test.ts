// The save body codec (PROTOTYPE-PLAN "Save format and resume", PUZZLES-PLAN X9): a body round-trips, and every body
// it cannot read is an error value naming the field.
import { expect, test } from 'vitest';

import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { PuzzleRun, WorldState } from '../explore/state.ts';
import type { AnchorKey, FlagId } from '../mechanics/contract.ts';
import { MECHANIC_DATA } from '../mechanics/data/index.ts';
import type { ItemId } from '../world/types.ts';
import type { InkScalar } from './catalog.ts';
import GOLDEN from './fixtures/save-1-ch1.json?raw';
import { BACKLOG_MAX, SAVE_FIELDS, SAVE_FORMAT, decodeSave, encodeSave } from './save-codec.ts';
import type { BacklogEntry, SaveBody, SaveBodyV1 } from './save-codec.ts';
import { EMPTY_SNAPSHOT } from './staging.ts';
import type { ChapterId, CharId, KnotName, LineId, PropId, PropPlacement, PuzzleLocalId, StagingSnapshot, StoryVersion } from './staging.ts';

// The fixtures name their ids directly; each matches its grammar.
const CH1 = 'ch1' as ChapterId;
const VERSION = '0123456789abcdef' as StoryVersion;
const STAGE = {
  bg: 'cafe',
  cg: null,
  chars: [{ char: 'ally', expr: 'smile', at: 'left' }],
  bgm: { track: 'calm', vol: 80 },
  props: [{ prop: 'drawer', rect: [10, 20, 300, 200] }],
} as unknown as StagingSnapshot;
const WORLD = {
  format: 2,
  section: 'cellar',
  room: 'stairs',
  lastRoom: { cellar: 'stairs' },
  visited: ['stairs'],
  held: ['key_brass'],
  used: ['coin'],
  docs: ['letter'],
  taken: ['stairs.coin'],
  examined: ['stairs.shelf'],
  slots: { 'stairs.box': ['coin', null] },
  open: ['stairs.door'],
  fired: ['enter:stairs'],
  pendingStory: ['cellar_event'],
  puzzles: { cabinet: { outcome: null, attempts: 2, hintsOpened: 1 } },
  unproved: ['tower'],
  flags: [],
} as unknown as WorldState;

function line(n: number): BacklogEntry {
  return { lineId: `ch1.start.${String(n).padStart(4, '0')}` as LineId, speaker: null, ru: `Line ${n}.` };
}

/** A body at a puzzle yield, with a world, a checkpoint, a carry and a backlog. */
const BODY: SaveBody = {
  format: 2,
  chapterId: CH1,
  storyVersion: VERSION,
  ink: '{"inkSaveVersion":10}',
  at: { lineId: 'ch1.start.c001' as LineId, knot: 'start' as KnotName, yield: { kind: 'puzzle', puzzle: 'cabinet', then: 'after' } as SaveBody['at']['yield'] },
  staging: STAGE,
  checkpoint: { knot: 'start' as KnotName, vars: { g_x: 1, pz_cabinet: 0, g_ratio: 1.5, g_name: 'Ann', g_seen: true } as SaveBody['chapterStart']['carry'], staging: EMPTY_SNAPSHOT },
  chapterStart: { carry: { g_x: 0 } as SaveBody['chapterStart']['carry'], items: [] },
  backlog: [line(1), { lineId: 'ch1.start.0002' as LineId, speaker: 'ally' as BacklogEntry['speaker'], ru: 'Hi.', chosen: 'ch1.start.0003' as LineId }],
  world: WORLD,
  worldVersion: 'fedcba9876543210',
};

/** BODY as plain JSON with `edit` applied, encoded. */
function edited(edit: (b: Record<string, unknown>) => void): string {
  const b = JSON.parse(JSON.stringify(BODY)) as Record<string, unknown>;
  edit(b);
  return JSON.stringify(b);
}

function at(b: Record<string, unknown>, key: string): Record<string, unknown> {
  return b[key] as Record<string, unknown>; // the fixture's own nested objects
}

test('save-codec: unknown format is an error value', () => {
  expect(decodeSave(edited((b) => (b['format'] = 3)))).toMatchObject({ ok: false, error: { kind: 'unknown-format' } });
  expect(decodeSave(edited((b) => delete b['format']))).toMatchObject({ ok: false, error: { kind: 'unknown-format' } });
  expect(decodeSave('not json')).toMatchObject({ ok: false, error: { kind: 'malformed' } });
  expect(decodeSave('[]')).toMatchObject({ ok: false, error: { kind: 'malformed' } });
  expect(decodeSave('null')).toMatchObject({ ok: false, error: { kind: 'malformed' } });
});

test('save-codec: world round trip', () => {
  expect(decodeSave(encodeSave(BODY))).toEqual({ ok: true, value: BODY });
  const fresh: SaveBody = {
    ...BODY,
    ink: null,
    at: { lineId: null, knot: null, yield: null },
    staging: EMPTY_SNAPSHOT,
    checkpoint: null,
    backlog: [],
    world: EMPTY_WORLD_STATE,
    worldVersion: null,
  };
  expect(decodeSave(encodeSave(fresh))).toEqual({ ok: true, value: fresh });
  const explore: SaveBody = { ...BODY, at: { ...BODY.at, yield: { kind: 'explore', section: 'cellar' } as SaveBody['at']['yield'] } };
  expect(decodeSave(encodeSave(explore))).toEqual({ ok: true, value: explore });
});

test('save-codec: an empty string var round trips in the checkpoint and the carry', () => {
  // The story lint admits `""` as a scalar value: the codec must keep it, never read it as an absence or reject it.
  const emptied: SaveBody = {
    ...BODY,
    checkpoint: { knot: 'start' as KnotName, vars: { g_name: '' } as SaveBody['chapterStart']['carry'], staging: EMPTY_SNAPSHOT },
    chapterStart: { carry: { g_name: '' } as SaveBody['chapterStart']['carry'], items: [] },
  };
  expect(decodeSave(encodeSave(emptied))).toEqual({ ok: true, value: emptied });
  // The checkpoint is read first, so the carry gets its own body with no checkpoint.
  const carried: SaveBody = { ...emptied, checkpoint: null };
  expect(decodeSave(encodeSave(carried))).toEqual({ ok: true, value: carried });
});

test('save-codec: a false boolean and a negative number var round trip in the checkpoint and the carry', () => {
  // `false` is the default of every bool VAR and the lint admits negative defaults: neither may read as malformed.
  const v = { g_seen: false, g_aff: -2 } as SaveBody['chapterStart']['carry'];
  const falsy: SaveBody = { ...BODY, checkpoint: { knot: 'start' as KnotName, vars: v, staging: EMPTY_SNAPSHOT }, chapterStart: { carry: v, items: [] } };
  expect(decodeSave(encodeSave(falsy))).toEqual({ ok: true, value: falsy });
  // The checkpoint is read first, so the carry gets its own body with no checkpoint.
  const carried: SaveBody = { ...falsy, checkpoint: null };
  expect(decodeSave(encodeSave(carried))).toEqual({ ok: true, value: carried });
});

test('save-codec: malformed bodies are error values', () => {
  const cases: ReadonlyArray<readonly [path: string, edit: (b: Record<string, unknown>) => void]> = [
    ['save.chapterId', (b) => (b['chapterId'] = 'chapter1')],
    ['save.storyVersion', (b) => (b['storyVersion'] = 'XYZ')],
    ['save.ink', (b) => (b['ink'] = 5)],
    ['save.at.lineId', (b) => (at(b, 'at')['lineId'] = 'ch1.bad')],
    ['save.at.knot', (b) => (at(b, 'at')['knot'] = 'Bad Knot')],
    ['save.at.yield', (b) => (at(b, 'at')['yield'] = { kind: 'dance' })],
    ['save.at.yield.then', (b) => (at(b, 'at')['yield'] = { kind: 'puzzle', puzzle: 'cabinet', then: 7 })],
    ['save.at', (b) => delete b['at']],
    ['save.staging.chars[0].at', (b) => (at(b, 'staging')['chars'] = [{ char: 'ally', expr: 'smile', at: 'top' }])],
    ['save.staging.bgm.vol', (b) => (at(b, 'staging')['bgm'] = { track: 'calm', vol: 'loud' })],
    ['save.staging.props[0].rect', (b) => (at(b, 'staging')['props'] = [{ prop: 'drawer', rect: [1, 2, 3] }])],
    ['save.staging.props', (b) => delete at(b, 'staging')['props']],
    ['save.checkpoint.vars.g_x', (b) => (at(at(b, 'checkpoint'), 'vars')['g_x'] = { n: 1 })],
    ['save.checkpoint.knot', (b) => (at(b, 'checkpoint')['knot'] = '')],
    ['save.chapterStart.carry', (b) => (at(b, 'chapterStart')['carry'] = [])],
    ['save.backlog[1].chosen', (b) => (b['backlog'] = [line(1), { ...line(2), chosen: 'x' }])],
    ['save.backlog[0].ru', (b) => (b['backlog'] = [{ ...line(1), ru: null }])],
    ['save.world.format', (b) => (at(b, 'world')['format'] = 1)],
    ['save.world.held[0]', (b) => (at(b, 'world')['held'] = [1])],
    ['save.world.slots.stairs.box[1]', (b) => (at(b, 'world')['slots'] = { 'stairs.box': ['coin', 3] })],
    ['save.world.puzzles.cabinet.outcome', (b) => (at(b, 'world')['puzzles'] = { cabinet: { outcome: 'won', attempts: 0, hintsOpened: 0 } })],
    ['save.world.puzzles.cabinet.attempts', (b) => (at(b, 'world')['puzzles'] = { cabinet: { outcome: null, attempts: -1, hintsOpened: 0 } })],
    ['save.world.puzzles.cabinet.work[0]', (b) => (at(b, 'world')['puzzles'] = { cabinet: { outcome: null, attempts: 0, hintsOpened: 0, work: [-1] } })],
    ['save.world.puzzles.cabinet.work', (b) => (at(b, 'world')['puzzles'] = { cabinet: { outcome: null, attempts: 0, hintsOpened: 0, work: 'x' } })],
    ['save.world.flags', (b) => delete at(b, 'world')['flags']],
    ['save.world.flags[0]', (b) => (at(b, 'world')['flags'] = [1])],
    ['save.chapterStart.items', (b) => delete at(b, 'chapterStart')['items']],
    ['save.chapterStart.items[0]', (b) => (at(b, 'chapterStart')['items'] = [1])],
    ['save.staging.props[0].at', (b) => (at(b, 'staging')['props'] = [{ prop: 'drawer', rect: [1, 2, 3, 4], at: 'Hall Medal' }])],
    ['save.staging.props[0].part', (b) => (at(b, 'staging')['props'] = [{ prop: 'drawer', rect: [1, 2, 3, 4], part: 'mid' }])],
    ['save.worldVersion', (b) => (b['worldVersion'] = 'v1')],
  ];
  for (const [path, edit] of cases) {
    const r = decodeSave(edited(edit));
    expect(r.ok ? 'decoded' : r.error.kind, path).toBe('malformed');
    expect(r.ok ? '' : r.error.detail, path).toMatch(new RegExp(`^${path.replace(/[.[\]]/g, '\\$&')}[:.]`));
  }
  // A non-finite number is not a scalar. encodeSave never writes one (JSON writes Infinity as null), but JSON.parse
  // reads 1e999 as Infinity, so the literal goes into the text.
  const infinite = encodeSave(BODY).replace('"g_x":1,', '"g_x":1e999,');
  expect(infinite).toContain('"g_x":1e999,');
  const inf = decodeSave(infinite);
  expect(inf.ok ? 'decoded' : inf.error.kind).toBe('malformed');
  expect(inf.ok ? '' : inf.error.detail).toMatch(/^save\.checkpoint\.vars\.g_x:/);
  // A backlog longer than the cap keeps its last BACKLOG_MAX entries.
  const long = Array.from({ length: 60 }, (_, i) => line(i + 1));
  const kept = decodeSave(JSON.stringify({ ...BODY, backlog: long }));
  expect(kept.ok && kept.value.backlog).toEqual(long.slice(-BACKLOG_MAX));
  expect(JSON.parse(encodeSave({ ...BODY, backlog: long })).backlog).toEqual(long.slice(-BACKLOG_MAX));
  // Unknown keys are ignored and never copied, at the top level and inside.
  const extra = decodeSave(edited((b) => {
    b['extra'] = 1;
    at(b, 'at')['note'] = 'x';
  }));
  expect(extra).toEqual({ ok: true, value: BODY });
});

// The scalar-partition table (cut D9: a var holds a boolean, a string or a finite number), one name per arm and row.
// Each arm has its own body that holds the probe var alone: the checkpoint is read before the carry, so a body with
// both would let a checkpoint red hide a carry red.
type Vars = SaveBody['chapterStart']['carry'];
const PROBE = 'g_probe';
const ARMS: ReadonlyArray<{ arm: string; detail: RegExp; body: (vars: Vars) => SaveBody }> = [
  {
    arm: 'checkpoint.vars',
    detail: /^save\.checkpoint\.vars\.g_probe: /,
    body: (vars) => ({ ...BODY, checkpoint: { knot: 'start' as KnotName, vars, staging: EMPTY_SNAPSHOT }, chapterStart: { carry: {}, items: [] } }),
  },
  {
    arm: 'chapterStart.carry',
    detail: /^save\.chapterStart\.carry\.g_probe: /,
    body: (vars) => ({ ...BODY, checkpoint: null, chapterStart: { carry: vars, items: [] } }),
  },
];
/** Every partition a var value may take; the label names the row, since `''` would print as nothing. */
const SCALARS: ReadonlyArray<readonly [label: string, value: InkScalar]> = [
  ['the empty string', ''],
  ['a non-empty string', 'Ann'],
  ['true', true],
  ['false', false],
  ['zero', 0],
  ['a positive number', 7],
  ['a negative number', -3],
  ['a fractional number', 0.25],
];
/** JSON text that is no scalar; 1e999 and -1e999 parse to ±Infinity, which JSON.stringify cannot write. */
const NON_SCALARS: ReadonlyArray<readonly [label: string, json: string]> = [
  ['null', 'null'],
  ['1e999', '1e999'],
  ['-1e999', '-1e999'],
  ['an object', '{"n":1}'],
  ['an array', '[1]'],
];

for (const { arm, body } of ARMS) {
  for (const [label, value] of SCALARS) {
    test(`save-codec: a ${arm} var holding ${label} round trips`, () => {
      const b = body({ [PROBE]: value } as Vars);
      expect(decodeSave(encodeSave(b))).toEqual({ ok: true, value: b });
    });
  }
}

for (const { arm, detail, body } of ARMS) {
  for (const [label, json] of NON_SCALARS) {
    test(`save-codec: a ${arm} var holding ${label} is malformed`, () => {
      const sentinel = `"${PROBE}":0`;
      const text = encodeSave(body({ [PROBE]: 0 } as Vars));
      // An unmatched replace would leave a valid body, so the sentinel must occur exactly once.
      expect(text.split(sentinel)).toHaveLength(2);
      const r = decodeSave(text.replace(sentinel, `"${PROBE}":${json}`));
      expect(r.ok ? 'decoded' : r.error.kind).toBe('malformed');
      expect(r.ok ? '' : r.error.detail).toMatch(detail);
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Format 2 (engine plan §5.2): a format-1 body upgrades on read; a written body is format 2.

/** The decoded body; a decode error fails the test with its detail. */
function decodedOf(raw: string): SaveBody {
  const r = decodeSave(raw);
  if (!r.ok) {
    throw new Error(`decode failed: ${r.error.kind}: ${r.error.detail}`);
  }
  return r.value;
}

// GOLDEN is ch1's `auto` as the format-1 game wrote it (e2e `explore: search item puzzle solve` on 2815340, the
// server's stored body as captured), never edited: the body a player holds today.
test('save: a format-1 body upgrades to format 2', () => {
  const parsed = JSON.parse(GOLDEN) as Record<string, unknown>;
  // (a) A format-1 body in the middle of ch1's play: a story at a line, a checkpoint, a choice in the backlog, a world
  // with its version, puzzle runs, fired triggers and items.
  const world = at(parsed, 'world');
  expect(parsed).toMatchObject({ format: 1, chapterId: 'ch1', world: { format: 1 } });
  expect(typeof parsed['ink']).toBe('string');
  expect(parsed['checkpoint']).not.toBeNull();
  expect((parsed['backlog'] as ReadonlyArray<Record<string, unknown>>).some((e) => Object.hasOwn(e, 'chosen'))).toBe(true);
  expect(typeof parsed['worldVersion']).toBe('string');
  expect(Object.keys(at(world, 'puzzles')).length).toBeGreaterThan(0);
  expect((world['fired'] as unknown[]).length).toBeGreaterThan(0);
  expect([...(world['held'] as unknown[]), ...(world['used'] as unknown[])].length).toBeGreaterThan(0);
  // (b) It reads as format 2: the world gains `flags`, the chapter start `items`, both empty.
  expect(decodeSave(GOLDEN)).toMatchObject({ ok: true, value: { format: 2, world: { format: 2, flags: [] }, chapterStart: { items: [] } } });
  // (c) Every other field is the saved one: the same place, the same state.
  const up = decodedOf(GOLDEN);
  const back = JSON.parse(JSON.stringify(up)) as Record<string, unknown>;
  back['format'] = 1;
  at(back, 'world')['format'] = 1;
  delete at(back, 'world')['flags'];
  delete at(back, 'chapterStart')['items'];
  expect(back).toEqual(parsed);
  // (d) The upgraded body is a format-2 fixed point: written and read back, it is the same body.
  expect(decodeSave(encodeSave(up))).toStrictEqual({ ok: true, value: up });
});

// Format 2's optional keys (engine plan §5.2, reconcile r1): a run's `work`, a prop's `at` / `part`, the stage's `cam`.
const WORKED: PuzzleRun = { outcome: null, attempts: 2, hintsOpened: 1, work: [3, 0, 1] };
const SAFE: PuzzleRun = { outcome: 'solved', attempts: 1, hintsOpened: 0 };
const ANCHORED: PropPlacement = { prop: 'drawer' as PropId, rect: [10, 20, 300, 200], at: 'stairs.drawer' as AnchorKey, part: 'patch' };
const LOOSE: PropPlacement = { prop: 'coin' as PropId, rect: [0, 0, 10, 10] };
/** BODY with a worked run beside a plain one, an anchored prop beside a plain one, a carried item and a flag; no `cam`. */
const FULL: SaveBody = {
  ...BODY,
  staging: { ...STAGE, props: [ANCHORED, LOOSE] },
  chapterStart: { carry: {}, items: ['brass_key' as ItemId] },
  world: { ...WORLD, flags: ['fl_seen' as FlagId], puzzles: { ['cabinet' as PuzzleLocalId]: WORKED, ['safe' as PuzzleLocalId]: SAFE } },
};
/** The stage with each camera state of §5.2; a push at both ends of its zoom range (105..130, both inclusive). */
const CAMMED: readonly StagingSnapshot[] = [
  { ...STAGE, cam: { kind: 'rest' } },
  { ...STAGE, cam: { kind: 'push', to: 'ally' as CharId, z: 120 } },
  { ...STAGE, cam: { kind: 'push', to: 'center', z: 105 } },
  { ...STAGE, cam: { kind: 'push', to: 'ally' as CharId, z: 130 } },
  { ...STAGE, cam: { kind: 'pan', to: 'left' } },
];

test('save: format 2 round-trips', () => {
  const checkpoint = (staging: StagingSnapshot): SaveBody['checkpoint'] => ({ knot: 'start' as KnotName, vars: {}, staging });
  const bodies: readonly SaveBody[] = [
    BODY,
    FULL,
    ...CAMMED.map((staging) => ({ ...FULL, staging })),
    ...CAMMED.map((staging) => ({ ...FULL, checkpoint: checkpoint(staging) })),
  ];
  for (const [i, b] of bodies.entries()) {
    expect(decodeSave(encodeSave(b)), `body ${i}`).toStrictEqual({ ok: true, value: b });
  }
  // An absent optional key decodes to no key, never to `undefined`.
  const plain = decodedOf(encodeSave(FULL));
  const safe = Object.entries(plain.world.puzzles).find(([p]) => p === 'safe')?.[1];
  const loose = plain.staging.props[1];
  expect([safe, loose]).toStrictEqual([SAFE, LOOSE]);
  expect([
    Object.hasOwn(plain.staging, 'cam'),
    plain.checkpoint !== null && Object.hasOwn(plain.checkpoint.staging, 'cam'),
    safe !== undefined && Object.hasOwn(safe, 'work'),
    loose !== undefined && Object.hasOwn(loose, 'at'),
    loose !== undefined && Object.hasOwn(loose, 'part'),
  ]).toEqual([false, false, false, false, false]);
});

test('save: the upgrader chain is total', () => {
  const v1: SaveBodyV1 = {
    format: 1,
    chapterId: CH1,
    storyVersion: VERSION,
    ink: null,
    at: { lineId: null, knot: null, yield: null },
    staging: EMPTY_SNAPSHOT,
    checkpoint: null,
    chapterStart: { carry: {} },
    backlog: [],
    world: {
      format: 1,
      section: null,
      room: null,
      lastRoom: {},
      visited: [],
      held: [],
      used: [],
      docs: [],
      taken: [],
      examined: [],
      slots: {},
      open: [],
      fired: [],
      pendingStory: [],
      puzzles: {},
      unproved: [],
    },
    worldVersion: null,
  };
  const v2: SaveBody = { ...v1, format: 2, chapterStart: { carry: {}, items: [] }, world: EMPTY_WORLD_STATE };
  // A minimal body per format this build reads: tsc demands one for every format SAVE_FIELDS lists.
  const SAMPLES: { readonly [F in keyof typeof SAVE_FIELDS]: string } = { 1: JSON.stringify(v1), 2: encodeSave(v2) };
  expect(Math.max(...Object.keys(SAMPLES).map(Number))).toBe(SAVE_FORMAT);
  const keysOf = (o: object): ReadonlySet<string> => new Set(Object.keys(o));
  for (const f of [1, 2] as const) {
    expect(keysOf(at(JSON.parse(SAMPLES[f]) as Record<string, unknown>, 'world')), `the world keys of format ${f}`).toEqual(new Set(SAVE_FIELDS[f]));
    const up = decodedOf(SAMPLES[f]);
    expect([up.format, up.world.format], `format ${f} read`).toEqual([SAVE_FORMAT, SAVE_FORMAT]);
    expect(keysOf(up.world), `format ${f} read`).toEqual(new Set(SAVE_FIELDS[SAVE_FORMAT]));
  }
  expect(keysOf(at(JSON.parse(GOLDEN) as Record<string, unknown>, 'world'))).toEqual(new Set(SAVE_FIELDS[1]));
  expect(keysOf(EMPTY_WORLD_STATE)).toEqual(new Set(SAVE_FIELDS[SAVE_FORMAT]));
  // No other format is read: a newer one, a string, none.
  for (const format of [SAVE_FORMAT + 1, 0, '2', null, undefined]) {
    const raw = JSON.stringify({ ...(JSON.parse(SAMPLES[SAVE_FORMAT]) as Record<string, unknown>), format });
    expect(decodeSave(raw), String(format)).toMatchObject({ ok: false, error: { kind: 'unknown-format' } });
  }
  // Format 1's decoder is frozen: format 2's keys in a format-1 body are unknown keys, ignored and never copied.
  const ahead = JSON.parse(SAMPLES[1]) as Record<string, unknown>;
  at(ahead, 'world')['flags'] = ['x'];
  at(ahead, 'world')['puzzles'] = { cabinet: { outcome: null, attempts: 1, hintsOpened: 0, work: [1] } };
  at(ahead, 'staging')['props'] = [{ prop: 'drawer', rect: [1, 2, 3, 4], at: 'stairs.drawer', part: 'base' }];
  at(ahead, 'staging')['cam'] = { kind: 'rest' };
  const read = decodedOf(JSON.stringify(ahead));
  expect(read.world.flags).toEqual([]);
  expect(read.world.puzzles).toStrictEqual({ cabinet: { outcome: null, attempts: 1, hintsOpened: 0 } });
  expect(read.staging.props).toStrictEqual([{ prop: 'drawer', rect: [1, 2, 3, 4] }]);
  expect(Object.hasOwn(read.staging, 'cam')).toBe(false);
  // A format-1 body at a pending chapter start keeps its carried vars: `chapterStart` is the one key the upgrade
  // rebuilds rather than spreads, and ch1's golden carries nothing.
  const carry = { g_x: 1, g_name: 'Ann', g_seen: true } as Vars;
  expect(decodedOf(JSON.stringify({ ...v1, chapterStart: { carry } })).chapterStart).toStrictEqual({ carry, items: [] });
  // Format 1's paths are kept.
  const held = JSON.parse(SAMPLES[1]) as Record<string, unknown>;
  at(held, 'world')['held'] = [1];
  const bad = decodeSave(JSON.stringify(held));
  expect(bad.ok ? 'decoded' : bad.error.kind).toBe('malformed');
  expect(bad.ok ? '' : bad.error.detail).toMatch(/^save\.world\.held\[0\]: /);
});

test('save: a camera state outside the grammar fails at its path', () => {
  const cases: ReadonlyArray<readonly [path: string, inCheckpoint: boolean, cam: unknown]> = [
    ['save.staging.cam.z', false, { kind: 'push', to: 'ally', z: 104 }],
    ['save.staging.cam.z', false, { kind: 'push', to: 'ally', z: 131 }],
    ['save.staging.cam.z', false, { kind: 'push', to: 'ally', z: 110.5 }],
    ['save.staging.cam.z', false, { kind: 'push', to: 'ally' }],
    ['save.staging.cam.to', false, { kind: 'push', to: 'Bad Name', z: 120 }],
    ['save.staging.cam.to', false, { kind: 'pan', to: 7 }],
    ['save.staging.cam.to', false, { kind: 'pan', to: 'Bad Name' }],
    // The whole target grammar `^[a-z][a-z0-9_]*$`, per arm: trailing junk after a valid prefix (the end anchor), the
    // empty string, a first character outside `[a-z]` (two), a rest character outside `[a-z0-9_]` (two).
    ['save.staging.cam.to', false, { kind: 'push', to: 'left x', z: 120 }],
    ['save.staging.cam.to', false, { kind: 'pan', to: 'left x' }],
    ['save.staging.cam.to', false, { kind: 'push', to: '', z: 120 }],
    ['save.staging.cam.to', false, { kind: 'pan', to: '' }],
    ['save.staging.cam.to', false, { kind: 'push', to: '_left', z: 120 }],
    ['save.staging.cam.to', false, { kind: 'pan', to: '_left' }],
    ['save.staging.cam.to', false, { kind: 'push', to: '1left', z: 120 }],
    ['save.staging.cam.to', false, { kind: 'pan', to: '1left' }],
    ['save.staging.cam.to', false, { kind: 'push', to: 'le-ft', z: 120 }],
    ['save.staging.cam.to', false, { kind: 'pan', to: 'le-ft' }],
    ['save.staging.cam.to', false, { kind: 'push', to: 'leFt', z: 120 }],
    ['save.staging.cam.to', false, { kind: 'pan', to: 'leFt' }],
    ['save.staging.cam.kind', false, { kind: 'zoom' }],
    ['save.staging.cam', false, null],
    ['save.checkpoint.staging.cam.z', true, { kind: 'push', to: 'ally', z: 131 }],
  ];
  for (const [path, inCheckpoint, cam] of cases) {
    const r = decodeSave(edited((b) => (at(inCheckpoint ? at(b, 'checkpoint') : b, 'staging')['cam'] = cam)));
    const label = `${path} ${JSON.stringify(cam)}`;
    expect(r.ok ? 'decoded' : r.error.kind, label).toBe('malformed');
    expect(r.ok ? '' : r.error.detail, label).toMatch(new RegExp(`^${path.replace(/[.[\]]/g, '\\$&')}: `));
  }
});

/** The slice keys of `registry` that the current format does not save (engine plan §3.2: a slice lives in `world`). */
function unsaved(registry: ReadonlyArray<{ readonly id: string; readonly slice?: { readonly key: string } }>): string[] {
  const saved: readonly string[] = SAVE_FIELDS[SAVE_FORMAT];
  return registry.flatMap((m) => (m.slice === undefined || saved.includes(m.slice.key) ? [] : [m.slice.key]));
}

test('mechanics: slice keys pinned to SAVE_FORMAT', () => {
  expect(unsaved(MECHANIC_DATA)).toEqual([]);
  // No module declares a slice yet, so the guard is shown live on fixture modules: a key the format lacks fails it
  // (a slice is a format bump), a key it has passes.
  const sliced = (key: string) => ({ id: 'fixture', slice: { key } });
  expect(unsaved([...MECHANIC_DATA, sliced('rotations')])).toEqual(['rotations']);
  expect(unsaved([...MECHANIC_DATA, sliced('flags')])).toEqual([]);
});
