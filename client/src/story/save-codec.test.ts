// The save body codec (PROTOTYPE-PLAN "Save format and resume", PUZZLES-PLAN X9): a body round-trips, and every body
// it cannot read is an error value naming the field.
import { expect, test } from 'vitest';

import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { InkScalar } from './catalog.ts';
import GOLDEN from './fixtures/save-1-ch1.json?raw';
import { BACKLOG_MAX, decodeSave, encodeSave } from './save-codec.ts';
import type { BacklogEntry, SaveBody } from './save-codec.ts';
import { EMPTY_SNAPSHOT } from './staging.ts';
import type { ChapterId, KnotName, LineId, StagingSnapshot, StoryVersion } from './staging.ts';

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
