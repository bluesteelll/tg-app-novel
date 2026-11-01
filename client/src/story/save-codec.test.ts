// The save body codec (PROTOTYPE-PLAN "Save format and resume", PUZZLES-PLAN X9): a body round-trips, and every body
// it cannot read is an error value naming the field.
import { expect, test } from 'vitest';

import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import { BACKLOG_MAX, decodeSave, encodeSave } from './save-codec.ts';
import type { BacklogEntry, SaveBodyV1 } from './save-codec.ts';
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
  format: 1,
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
} as unknown as WorldState;

function line(n: number): BacklogEntry {
  return { lineId: `ch1.start.${String(n).padStart(4, '0')}` as LineId, speaker: null, ru: `Line ${n}.` };
}

/** A body at a puzzle yield, with a world, a checkpoint, a carry and a backlog. */
const BODY: SaveBodyV1 = {
  format: 1,
  chapterId: CH1,
  storyVersion: VERSION,
  ink: '{"inkSaveVersion":10}',
  at: { lineId: 'ch1.start.c001' as LineId, knot: 'start' as KnotName, yield: { kind: 'puzzle', puzzle: 'cabinet', then: 'after' } as SaveBodyV1['at']['yield'] },
  staging: STAGE,
  checkpoint: { knot: 'start' as KnotName, vars: { g_x: 1, pz_cabinet: 0, g_ratio: 1.5, g_name: 'Ann', g_seen: true } as SaveBodyV1['chapterStart']['carry'], staging: EMPTY_SNAPSHOT },
  chapterStart: { carry: { g_x: 0 } as SaveBodyV1['chapterStart']['carry'] },
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
  expect(decodeSave(edited((b) => (b['format'] = 2)))).toMatchObject({ ok: false, error: { kind: 'unknown-format' } });
  expect(decodeSave(edited((b) => delete b['format']))).toMatchObject({ ok: false, error: { kind: 'unknown-format' } });
  expect(decodeSave('not json')).toMatchObject({ ok: false, error: { kind: 'malformed' } });
  expect(decodeSave('[]')).toMatchObject({ ok: false, error: { kind: 'malformed' } });
  expect(decodeSave('null')).toMatchObject({ ok: false, error: { kind: 'malformed' } });
});

test('save-codec: world round trip', () => {
  expect(decodeSave(encodeSave(BODY))).toEqual({ ok: true, value: BODY });
  const fresh: SaveBodyV1 = {
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
  const explore: SaveBodyV1 = { ...BODY, at: { ...BODY.at, yield: { kind: 'explore', section: 'cellar' } as SaveBodyV1['at']['yield'] } };
  expect(decodeSave(encodeSave(explore))).toEqual({ ok: true, value: explore });
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
    ['save.world.format', (b) => (at(b, 'world')['format'] = 2)],
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
