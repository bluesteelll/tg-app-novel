// The shot list, the step flow, the shot lints, build/shots.json and the art list (docs/plans/shots §2-3, lane SH2).
// Fixtures are built in-test on the committed catalog and cast; a fixture may be lint-dirty.
import { readFileSync, readdirSync } from 'node:fs';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog, decodeCast } from '../../../src/story/catalog.ts';
import type { AssetCatalog, Cast } from '../../../src/story/catalog.ts';
import type { AssetId, AssetIndex, BgId, ChapterId, KnotName } from '../../../src/story/staging.ts';
import { decodeWorldSource, toPublic } from '../../../src/world/decode.ts';
import type { RoomId, WorldPublicBody } from '../../../src/world/types.ts';
import { compileChapter } from '../compile.ts';
import { buildGraph, carriedStage } from '../graph.ts';
import type { ChapterGraph } from '../graph.ts';
import { GLOBALS_PATH } from '../lint.ts';
import { playChapter } from '../playthrough.ts';
import type { ChapterPlay } from '../playthrough.ts';
import { artList, artListMarkdown, encodeArtList } from './art-list.ts';
import type { ArtList, ArtShot } from './art-list.ts';
import { buildFlow, crossCheck, entries, entryOf, eventReturns, lookahead, roomEvents } from './flow.ts';
import type { ChapterFlow, Lookahead, RoomEvents, ShotFiles, StepKey } from './flow.ts';
import { SHOT_LINT_CODES, faceNeeds, lintShots } from './lint.ts';
import type { Plane, ShotFinding } from './lint.ts';
import { decodeShotList, effectiveCatalog, effectiveShots, impliedPlaceholders } from './list.ts';
import type { EffectiveShot, ShotList } from './list.ts';
import { decodeShotUsage, encodeShotUsage, parseShotFileId, shotUsage } from './usage.ts';
import type { ChapterShots, ShotUsage } from './usage.ts';

type Json = Readonly<Record<string, unknown>>;

function readRepoJson(path: string): unknown {
  const text = readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
  return JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text);
}

function committed(): { catalog: AssetCatalog; cast: Cast } {
  const catalog = decodeAssetCatalog(readRepoJson('assets/catalog.json'));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  const cast = decodeCast(readRepoJson('story/cast.json'), catalog.value);
  if (!cast.ok) {
    throw new Error('invariant: the committed cast decodes');
  }
  return { catalog: catalog.value, cast: cast.value };
}

const COMMITTED = committed();

function bg(id: string): BgId {
  return id as BgId; // fixture shot ids
}

/** A decoded fixture shot list (the fixture is valid by construction). */
function shotList(raw: Json): ShotList {
  const r = decodeShotList(raw, COMMITTED.catalog);
  if (!r.ok) {
    throw new Error(`invariant: the fixture shot list decodes: ${r.error.join('; ')}`);
  }
  return r.value;
}

/** A one-section world (section `s`, start `start`) of the given rooms, decoded and projected as the story tool does. */
function world(rooms: Json, start = 'hall', extra: Json = {}): WorldPublicBody {
  const raw = { format: 1, items: {}, docs: {}, puzzles: {}, sections: { s: { start, bgm: null, rooms } }, ...extra };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return toPublic(r.value);
}

let titles = 0;
/** A room of `bg` with the given hotspots and onEnter effects (each room its own title ID). */
function room(bgId: string, hotspots: readonly Json[] = [], onEnter: readonly Json[] = []): Json {
  titles += 1;
  return { bg: bgId, title: { id: `ch1.s.t${String(titles).padStart(3, '0')}`, ru: 'Комната' }, onEnter, hotspots };
}

const CH1: ChapterId = 'ch1' as ChapterId; // the fixture chapter

function knot(name: string): KnotName {
  return name as KnotName; // fixture knot names
}

/** The chapter's sections, as the shot pass reads them (a built graph always has them). */
function sectionsOf(g: ChapterGraph): NonNullable<ChapterGraph['sections']> {
  if (g.sections === undefined) {
    throw new Error('invariant: a built graph has its sections');
  }
  return g.sections;
}

type Built = { graph: ChapterGraph; files: readonly string[]; sources: ReadonlyMap<string, string>; assets: AssetIndex };

/** A fixture chapter (`id`, one entry file after the globals INCLUDE) graphed against `catalog`, with `w` as its world. */
function chapter(body: readonly string[], catalog: AssetCatalog = COMMITTED.catalog, w?: WorldPublicBody, id: ChapterId = CH1): Built {
  const entry = `${id}/main.ink`;
  const sources = new Map([
    [entry, ['INCLUDE ../common/globals.ink', ...body, ''].join('\n')],
    [GLOBALS_PATH, 'VAR g_x = 0\n'],
  ]);
  const files = [entry, GLOBALS_PATH];
  const assets = assetIndex(catalog);
  const { graph } = buildGraph({ chapter: { id, paid: false, entry }, files, sources, assets, world: w === undefined ? undefined : { kind: 'ok', body: w } });
  return { graph, files, sources, assets };
}

const TEXT = (id: string): Json => ({ id, ru: 'Текст' });
/** ch1's manor shape: the hall (gate exit to the leave knot, its lock's onFail an event), the study, the cellar (onEnter event). */
function manorWorld(onFail: readonly Json[] = [{ story: 'gate_forced' }, { unlock: 'hall.gate' }]): WorldPublicBody {
  return world(
    {
      hall: room('hall', [
        { id: 'to_study', kind: 'exit', rect: [100, 1300, 250, 400], label: TEXT('ch1.s.l001'), to: { room: 'study' }, lock: null, sfx: null },
        { id: 'to_cellar', kind: 'exit', rect: [730, 1300, 250, 400], label: TEXT('ch1.s.l002'), to: { room: 'cellar' }, lock: null, sfx: null },
        {
          id: 'gate',
          kind: 'exit',
          rect: [400, 500, 300, 700],
          label: TEXT('ch1.s.l003'),
          to: { story: 'out' },
          sfx: null,
          lock: { slots: [{ accepts: 'medal' }], puzzle: null, locked: TEXT('ch1.s.k001'), onFail },
        },
      ]),
      study: room('study', [
        { id: 'to_hall', kind: 'exit', rect: [100, 1300, 250, 400], label: TEXT('ch1.s.l004'), to: { room: 'hall' }, lock: null, sfx: null },
        { id: 'medal', kind: 'take', rect: [700, 400, 200, 200], label: TEXT('ch1.s.l005'), gives: { item: 'medal' }, prop: 'medal_sun' },
      ]),
      cellar: room(
        'cellar',
        [
          { id: 'to_hall', kind: 'exit', rect: [100, 1300, 250, 400], label: TEXT('ch1.s.l006'), to: { room: 'hall' }, lock: null, sfx: null },
          { id: 'star', kind: 'take', rect: [650, 1200, 200, 200], label: TEXT('ch1.s.l007'), gives: { item: 'star' }, prop: 'medal_star' },
        ],
        [{ story: 'cellar_voice' }],
      ),
    },
    'hall',
    {
      items: {
        medal: { name: TEXT('ch1.medal.n001'), desc: TEXT('ch1.medal.d001'), glyph: 'sun' },
        star: { name: TEXT('ch1.star.n001'), desc: TEXT('ch1.star.d001'), glyph: 'star' },
      },
    },
  );
}

/** ch1's manor knots: the arrival yields the section; two events return to it; the leave knot opens on the street. */
const MANOR = [
  '-> arrive',
  '=== arrive ===',
  '# scene: hall',
  'Зал. #id:ch1.arrive.a001',
  '# explore: s',
  '-> DONE',
  '=== cellar_voice ===',
  'Голос. #id:ch1.cellar_voice.v001',
  '# explore: s',
  '-> DONE',
  '=== gate_forced ===',
  'Хруст. #id:ch1.gate_forced.f001',
  '# explore: s',
  '-> DONE',
  '=== out ===',
  '# scene: street',
  'Улица. #id:ch1.out.o001',
  '-> END',
];

// ---------------------------------------------------------------------------------------------------------------
// Commit 1: the shot list, its decoder and the effective catalog

const CAFE_LIST: Json = {
  locs: [{ id: 'cafe', light: 'warm lamps, rain outside' }],
  shots: [
    {
      id: 'cafe_two',
      loc: 'cafe',
      frame: 'two',
      cast: [
        { char: 'stranger', view: 'back', rest: 'neutral' },
        { char: 'ally', view: 'face', rest: 'smile', figure: true },
      ],
    },
  ],
};

test('shots: the shot list decodes against the catalog and cast', () => {
  expect(decodeShotList(CAFE_LIST, COMMITTED.catalog)).toEqual({
    ok: true,
    value: {
      locs: [{ id: 'cafe', light: 'warm lamps, rain outside' }],
      shots: [
        {
          id: 'cafe_two',
          loc: 'cafe',
          frame: 'two',
          cast: [
            { char: 'stranger', view: 'back', rest: 'neutral', figure: false },
            { char: 'ally', view: 'face', rest: 'smile', figure: true },
          ],
        },
      ],
    },
  });
  // Every structural issue is reported, never only the first.
  const broken = {
    locs: [{ id: 'cafe', light: null }, { id: 'cafe', light: 3 }],
    shots: [
      { id: 'cafe_two', loc: 'cafe', frame: 'two', cast: [] },
      { id: 'cafe_two', loc: 'park', frame: 'pan', cast: [], extra: true },
      { id: 'Bad-Id', loc: 'cafe', frame: 'wide' },
    ],
    notes: 'x',
  };
  const r = decodeShotList(broken, COMMITTED.catalog);
  expect(r.ok).toBe(false);
  expect(r.ok ? [] : r.error).toEqual([
    'notes: unknown key (expected locs, shots)',
    'locs.1.light: not a string or null',
    "locs.1.id: duplicate location 'cafe'",
    'shots.1.extra: unknown key (expected id, loc, frame, cast)',
    "shots.1.id: duplicate shot 'cafe_two'",
    "shots.1.loc: 'park' is not a location of locs",
    'shots.1.frame: "pan" is not one of wide, medium, close, ots, two, insert, room',
    'shots.2.cast: missing',
    'shots.2.id: "Bad-Id" is not an id [a-z][a-z0-9_]*',
    'shots.2.cast: not an array',
  ]);
});

test('shots: a cast member outside the vocabulary is refused', () => {
  const list = {
    locs: [{ id: 'cafe', light: null }],
    shots: [
      {
        id: 'cafe_two',
        loc: 'cafe',
        frame: 'two',
        cast: [
          { char: 'ghost', view: 'face', rest: 'neutral' },
          { char: 'ally', view: 'face', rest: 'grin' },
          { char: 'stranger', view: 'side', rest: 'neutral', figure: 'yes' },
          { char: 'ally', view: 'back', rest: 'smile' },
        ],
      },
    ],
  };
  const r = decodeShotList(list, COMMITTED.catalog);
  expect(r.ok ? [] : r.error).toEqual([
    "shots.0.cast.0.char: 'ghost' is not a character of assets/catalog.json",
    "shots.0.cast.1.rest: 'grin' is not an expression of 'ally' in assets/catalog.json",
    'shots.0.cast.2.view: "side" is not face or back',
    'shots.0.cast.2.figure: not a boolean',
    "shots.0.cast.3.char: 'ally' is twice in the cast",
  ]);
});

test('shots: an undeclared catalog-less shot becomes an implied placeholder', () => {
  // §2.4: a shot shots.json declares and the catalog lacks gets an implied placeholder (hue = FNV-1a of the id mod
  // 360), so the story stages parse its `bg:` (the test's name keeps the plan's wording; the fixture follows §2.4).
  const list = shotList({
    locs: [{ id: 'cafe', light: null }],
    shots: [
      { id: 'cafe_ally_cu', loc: 'cafe', frame: 'close', cast: [{ char: 'ally', view: 'face', rest: 'neutral' }] },
      { id: 'cafe', loc: 'cafe', frame: 'wide', cast: [] },
    ],
  });
  expect(impliedPlaceholders(COMMITTED.catalog, list)).toEqual(['cafe_ally_cu']);
  const eff = effectiveCatalog(COMMITTED.catalog, list);
  expect(eff.bg[bg('cafe_ally_cu')]).toEqual({ placeholder: { hue: 20 } }); // MEASURED: FNV-1a 32 'cafe_ally_cu' = 2182665980
  expect(eff.bg[bg('cafe')]).toEqual(COMMITTED.catalog.bg[bg('cafe')]);
  expect(Object.hasOwn(COMMITTED.catalog.bg, 'cafe_ally_cu')).toBe(false); // the committed catalog is not written
  expect(effectiveShots(eff, list, []).get(bg('cafe_ally_cu'))).toEqual({
    id: 'cafe_ally_cu',
    loc: 'cafe',
    frame: 'close',
    cast: [{ char: 'ally', view: 'face', rest: 'neutral', figure: false }],
    declared: true,
  });
});

test("shots: a catalog bg shots.json lacks is an implied cast-less shot", () => {
  const list = shotList({ locs: [{ id: 'cafe', light: null }], shots: [] });
  const shots = effectiveShots(effectiveCatalog(COMMITTED.catalog, list), list, []);
  expect(shots.get(bg('street'))).toEqual({ id: 'street', loc: 'street', frame: 'wide', cast: [], declared: false });
  // One shot per catalog bg: none is dropped and none invented.
  expect([...shots.keys()].sort()).toEqual(Object.keys(COMMITTED.catalog.bg).sort());
});

test("shots: a room's undeclared bg is an implied room shot", () => {
  const list = shotList({ locs: [{ id: 'cafe', light: null }], shots: [] });
  const w = world({ hall: room('hall'), study: room('study') });
  const shots = effectiveShots(effectiveCatalog(COMMITTED.catalog, list), list, [w]);
  expect(shots.get(bg('hall'))).toEqual({ id: 'hall', loc: 'hall', frame: 'room', cast: [], declared: false });
  expect(shots.get(bg('study'))?.frame).toBe('room');
  expect(shots.get(bg('street'))?.frame).toBe('wide'); // no room names it
});

// ---------------------------------------------------------------------------------------------------------------
// Commit 1b: the graph's section edges, seeds and rooms

test('graph: the chapter graph exposes its section edges, seeds and rooms', () => {
  const { graph } = chapter(MANOR, COMMITTED.catalog, manorWorld());
  const sections = graph.sections;
  expect(sections).toEqual({
    edges: new Map([[knot('arrive'), ['cellar_voice', 'gate_forced', 'out']], [knot('cellar_voice'), ['cellar_voice', 'gate_forced', 'out']], [knot('gate_forced'), ['cellar_voice', 'gate_forced', 'out']]]),
    seeds: new Map([[knot('gate_forced'), ['bg/hall']], [knot('out'), ['bg/hall']], [knot('cellar_voice'), ['bg/cellar', 'prop/medal_star']]]),
    rooms: new Map([
      [knot('gate_forced'), { events: ['hall'], leaves: [] }],
      [knot('out'), { events: [], leaves: ['hall'] }],
      [knot('cellar_voice'), { events: ['cellar'], leaves: [] }],
    ]),
  });
  // No second derivation: the edges and seeds are the ones carriedStage reads, so `budget/knot-set` is unchanged.
  const first = graph.firstKnot;
  expect(first).toBe('arrive');
  expect(carriedStage(graph.knots, knot('arrive'), sectionsOf(graph))).toEqual(graph.carried);
});

// ---------------------------------------------------------------------------------------------------------------
// Commit 2: the step graph of a chapter

/** The step flow of a fixture chapter. */
function flowOf(body: readonly string[], catalog: AssetCatalog = COMMITTED.catalog, w?: WorldPublicBody, id: ChapterId = CH1): { flow: ChapterFlow; findings: ShotFinding[]; built: Built } {
  const built = chapter(body, catalog, w, id);
  const r = buildFlow({ chapter: id, files: built.files, sources: built.sources, graph: built.graph, assets: built.assets, cast: COMMITTED.cast, ...(w === undefined ? {} : { world: w }) });
  return { ...r, built };
}

/** A step's successors (the step must exist). */
function nextOf(flow: ChapterFlow, key: string): readonly string[] {
  const s = flow.steps.get(key as StepKey); // a fixture key
  if (s === undefined) {
    throw new Error(`invariant: the flow has step ${key}: ${[...flow.steps.keys()].join(', ')}`);
  }
  return s.next;
}

test("flow: a choice's branches each reach their first line", () => {
  const { flow, findings } = flowOf([
    '-> k',
    '=== k ===',
    'Перед. #id:ch1.k.a001',
    '* [А #id:ch1.k.c001]',
    '    После А. #id:ch1.k.a002',
    '* [Б #id:ch1.k.c002]',
    '    После Б. #id:ch1.k.a003',
    '+ {g_x > 0} [В #id:ch1.k.c003]',
    '    -> END',
    '- Сбор. #id:ch1.k.a004',
    '-> END',
  ]);
  expect(findings).toEqual([]);
  expect(flow.first).toBe('k:k');
  expect(nextOf(flow, 'k:k')).toEqual(['ch1.k.a001']);
  // A sticky, conditional choice counts: the set offers every choice it may show.
  expect(nextOf(flow, 'ch1.k.a001')).toEqual(['ch1.k.c001', 'ch1.k.c002', 'ch1.k.c003']);
  expect(nextOf(flow, 'ch1.k.c001')).toEqual(['ch1.k.a002']);
  expect(nextOf(flow, 'ch1.k.c002')).toEqual(['ch1.k.a003']);
  expect(nextOf(flow, 'ch1.k.c003')).toEqual([]);
});

test('flow: a gather joins its branches', () => {
  const { flow } = flowOf([
    '-> k',
    '=== k ===',
    '* [А #id:ch1.k.c001]',
    '    А1. #id:ch1.k.a001',
    '    ** [А-а #id:ch1.k.c003]',
    '        А-а. #id:ch1.k.a002',
    '    ** [А-б #id:ch1.k.c004]',
    '* [Б #id:ch1.k.c002]',
    '    -> other',
    '- Сбор. #id:ch1.k.a003',
    '-> END',
    '=== other ===',
    'Другое. #id:ch1.other.a004',
    '-> END',
  ]);
  expect(nextOf(flow, 'k:k')).toEqual(['ch1.k.c001', 'ch1.k.c002']);
  expect(nextOf(flow, 'ch1.k.a001')).toEqual(['ch1.k.c003', 'ch1.k.c004']);
  // A depth-2 branch with no depth-2 gather flows to the depth-1 gather; an empty branch too.
  expect(nextOf(flow, 'ch1.k.a002')).toEqual(['ch1.k.a003']);
  expect(nextOf(flow, 'ch1.k.c004')).toEqual(['ch1.k.a003']);
  // A branch that diverts away never reaches the gather.
  expect(nextOf(flow, 'ch1.k.c002')).toEqual(['ch1.other.a004']);
  expect(nextOf(flow, 'ch1.k.a003')).toEqual([]);
});

test("flow: a divert enters the knot's first step", () => {
  const { flow } = flowOf([
    '-> a',
    '=== a ===',
    'А. #id:ch1.a.a001',
    '-> b',
    '=== b ===',
    '# scene: street',
    'Б. #id:ch1.b.b001',
    '-> c',
    '=== c ===',
    '* [В #id:ch1.c.c001]',
    '    -> END',
    '* [Г #id:ch1.c.c002]',
    '    -> d',
    '=== d ===',
    '= first',
    'Д. #id:ch1.d.d001',
    '-> END',
  ]);
  expect(nextOf(flow, 'ch1.a.a001')).toEqual(['ch1.b.b001']);
  // The knot's opening tag lines are its first step's batch.
  expect(flow.steps.get('ch1.b.b001' as StepKey)?.batches.map((b) => [b.from, b.commands.map((c) => `${c.cmd.kind}@${c.line}`)])).toEqual([
    [['ch1.a.a001'], ['scene@7']],
  ]);
  // A knot whose first step is a choice set; a knot with no content of its own enters its first stitch.
  expect(nextOf(flow, 'ch1.b.b001')).toEqual(['ch1.c.c001', 'ch1.c.c002']);
  expect(nextOf(flow, 'ch1.c.c002')).toEqual(['ch1.d.d001']);
});

test('flow: a tunnel returns to every caller', () => {
  const { flow } = flowOf([
    '-> a',
    '=== a ===',
    'А. #id:ch1.a.a001',
    '-> t ->',
    'А2. #id:ch1.a.a002',
    '-> b',
    '=== b ===',
    'Б. #id:ch1.b.b001',
    '-> t ->',
    'Б2. #id:ch1.b.b002',
    '-> END',
    '=== t ===',
    'Т. #id:ch1.t.t001',
    '->->',
  ]);
  expect(nextOf(flow, 'ch1.a.a001')).toEqual(['ch1.t.t001']);
  expect(nextOf(flow, 'ch1.b.b001')).toEqual(['ch1.t.t001']);
  expect(nextOf(flow, 'ch1.t.t001')).toEqual(['ch1.a.a002', 'ch1.b.b002']);
});

test('flow: a thread is unsupported', () => {
  const { findings } = flowOf(['-> a', '=== a ===', 'А. #id:ch1.a.a001', '<- t', '-> END', '=== t ===', 'Т. #id:ch1.t.t001', '-> DONE']);
  expect(findings).toEqual([
    { code: 'flow/unsupported', severity: 'E', file: 'ch1/main.ink', line: 5, message: "thread '<- t': the step flow does not model it (§14)" },
  ]);
});

test('flow: every arm of a conditional block reaches the line after it', () => {
  const { flow } = flowOf([
    '-> k',
    '=== k ===',
    'Перед. #id:ch1.k.a001',
    '{',
    '- g_x > 1:',
    '    Много. #id:ch1.k.a002',
    '- g_x == 1:',
    '    Один. #id:ch1.k.a003',
    '- else:',
    '    Ноль. #id:ch1.k.a004',
    '}',
    '{ g_x > 0:',
    '    Есть. #id:ch1.k.a005',
    '- else:',
    '    Нет. #id:ch1.k.a006',
    '}',
    'После. #id:ch1.k.a007',
    '-> END',
  ]);
  // A switch with an else: every arm, and no way around it.
  expect(nextOf(flow, 'ch1.k.a001')).toEqual(['ch1.k.a002', 'ch1.k.a003', 'ch1.k.a004']);
  for (const arm of ['ch1.k.a002', 'ch1.k.a003', 'ch1.k.a004']) {
    expect(nextOf(flow, arm), arm).toEqual(['ch1.k.a005', 'ch1.k.a006']);
  }
  expect(nextOf(flow, 'ch1.k.a005')).toEqual(['ch1.k.a007']);
  expect(nextOf(flow, 'ch1.k.a006')).toEqual(['ch1.k.a007']);
});

test('flow: a conditional block without an else can skip its arms', () => {
  const { flow } = flowOf([
    '-> k',
    '=== k ===',
    'Перед. #id:ch1.k.a001',
    '{ g_x > 0:',
    '    Есть. #id:ch1.k.a002',
    '}',
    '{',
    '- g_x == 1:',
    '    Один. #id:ch1.k.a003',
    '- g_x == 2:',
    '    Два. #id:ch1.k.a004',
    '}',
    '{ stopping:',
    '- Раз. #id:ch1.k.a005',
    '- Снова. #id:ch1.k.a006',
    '}',
    'После. #id:ch1.k.a007',
    '-> END',
  ]);
  // Each block without an else may run no arm; a stopping sequence always runs one.
  expect(nextOf(flow, 'ch1.k.a001')).toEqual(['ch1.k.a002', 'ch1.k.a003', 'ch1.k.a004', 'ch1.k.a005', 'ch1.k.a006']);
  expect(nextOf(flow, 'ch1.k.a002')).toEqual(['ch1.k.a003', 'ch1.k.a004', 'ch1.k.a005', 'ch1.k.a006']);
  expect(nextOf(flow, 'ch1.k.a003')).toEqual(['ch1.k.a005', 'ch1.k.a006']);
  expect(nextOf(flow, 'ch1.k.a005')).toEqual(['ch1.k.a007']);
});

// ---------------------------------------------------------------------------------------------------------------
// Commit 3: the playthroughs' step transitions and the cross-check

/** The fixture chapter compiled and played `runs` times (with its world, through its yields). */
function played(built: Built, runs: number, w?: WorldPublicBody): ChapterPlay {
  const compiled = compileChapter({ id: CH1, paid: false, entry: 'ch1/main.ink' }, (key) => built.sources.get(key) ?? null);
  if (compiled.compiled === null) {
    throw new Error(`invariant: the fixture compiles: ${JSON.stringify(compiled.findings)}`);
  }
  const r = playChapter({
    chapter: { id: CH1, paid: false, entry: 'ch1/main.ink' },
    json: compiled.compiled.json,
    graph: built.graph,
    assets: built.assets,
    cast: COMMITTED.cast,
    en: new Map(),
    staticIds: new Set(built.graph.lines.map((l) => l.id)),
    allow: new Map(),
    carry: null,
    runs,
    ...(w === undefined ? {} : { world: w }),
  });
  return r.play;
}

const CHOICE = [
  '-> k',
  '=== k ===',
  'А. #id:ch1.k.a001',
  '* [Б #id:ch1.k.c001]',
  '    Б1. #id:ch1.k.a002',
  '* [В #id:ch1.k.c002]',
  '    В1. #id:ch1.k.a003',
  '- Г. #id:ch1.k.a004',
  '-> END',
];

test('playthrough: a run records its step transitions', () => {
  const play = played(chapter(CHOICE), 20);
  // A choice set is one step: every offered choice is a transition, and the run goes on from the picked one.
  expect(play.transitions).toEqual(
    new Set([
      'k:k→ch1.k.a001',
      'ch1.k.a001→ch1.k.c001',
      'ch1.k.a001→ch1.k.c002',
      'ch1.k.c001→ch1.k.a002',
      'ch1.k.c002→ch1.k.a003',
      'ch1.k.a002→ch1.k.a004',
      'ch1.k.a003→ch1.k.a004',
    ]),
  );
  // Through the world's yields: a knot the explore enters is `k:<knot>`.
  const w = manorWorld();
  const manor = played(chapter(MANOR, COMMITTED.catalog, w), 40, w);
  expect([...manor.transitions]).toEqual(
    expect.arrayContaining(['k:arrive→ch1.arrive.a001', 'ch1.arrive.a001→k:cellar_voice', 'k:cellar_voice→ch1.cellar_voice.v001', 'k:out→ch1.out.o001']),
  );
});

test('flow: every observed step transition is an edge', () => {
  const choice = chapter(CHOICE);
  const flow = buildFlow({ chapter: CH1, files: choice.files, sources: choice.sources, graph: choice.graph, assets: choice.assets, cast: COMMITTED.cast }).flow;
  expect(crossCheck(flow, played(choice, 20).transitions, 'ch1/main.ink')).toEqual([]);
  // The explore yields: a run enters any section knot after its walk, and an event's end leads on.
  const w = manorWorld();
  const manor = chapter(MANOR, COMMITTED.catalog, w);
  const manorFlow = buildFlow({ chapter: CH1, files: manor.files, sources: manor.sources, graph: manor.graph, assets: manor.assets, cast: COMMITTED.cast }).flow;
  const seen = played(manor, 40, w).transitions;
  expect(seen.size).toBeGreaterThan(5); // non-vacuity: the runs walked the section
  expect(crossCheck(manorFlow, seen, 'ch1/main.ink')).toEqual([]);
  // A transition the flow lacks fails at the step it leaves.
  expect(crossCheck(flow, new Set(['ch1.k.a001→ch1.k.a004']), 'ch1/main.ink')).toEqual([
    {
      code: 'flow/edge-missing',
      severity: 'E',
      file: 'ch1/main.ink',
      line: 4,
      message: "the seeded runs went from 'ch1.k.a001' to 'ch1.k.a004', which the step flow lacks (§14)",
    },
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// Commit 4: what may be on stage at each step

/** A step's effect, as sorted plain lists (faces and sprites `char=expr,...`; a null as '-'). */
function effectAt(flow: ChapterFlow, key: string): { shots: string[]; faces: string[]; cg: string[]; room: string[]; sprites: string[] } {
  const s = flow.steps.get(key as StepKey); // a fixture key
  if (s === undefined) {
    throw new Error(`invariant: the flow has step ${key}`);
  }
  const e = s.effect;
  const list = (x: ReadonlySet<string | null>): string[] => [...x].map((v) => v ?? '-').sort();
  const map = (m: ReadonlyMap<string, ReadonlySet<string | null>>): string[] => [...m].map(([k, v]) => `${k}=${list(v).join(',')}`).sort();
  return { shots: list(e.shots), faces: map(e.faces), cg: list(e.cg), room: list(e.room), sprites: map(e.sprites) };
}

test('flow: the shot in effect after a gather is the union of its branches', () => {
  const { flow } = flowOf([
    '-> k',
    '=== k ===',
    '# scene: room',
    'Комната. #id:ch1.k.a001',
    '* [Кафе #id:ch1.k.c001]',
    '    # bg: cafe',
    '    Кафе. #id:ch1.k.a002',
    '* [Улица #id:ch1.k.c002]',
    '    # bg: street',
    '    Улица. #id:ch1.k.a003',
    '* [Остаться #id:ch1.k.c003]',
    '- Дальше. #id:ch1.k.a004',
    '-> END',
  ]);
  expect(effectAt(flow, 'ch1.k.a002').shots).toEqual(['cafe']);
  expect(effectAt(flow, 'ch1.k.a003').shots).toEqual(['street']);
  expect(effectAt(flow, 'ch1.k.a004').shots).toEqual(['cafe', 'room', 'street']);
});

test('flow: faces persist across cuts until a scene', () => {
  const { flow } = flowOf([
    '-> k',
    '=== k ===',
    '# scene: cafe',
    '# face: ally smile',
    'Кафе. #id:ch1.k.a001',
    '# bg: street',
    'Улица. #id:ch1.k.a002',
    '* [Грустно #id:ch1.k.c001]',
    '    # face: ally worried',
    '    ally: Ох. #id:ch1.k.a003',
    '* [Ничего #id:ch1.k.c002]',
    '- Дальше. #id:ch1.k.a004',
    '# scene: room',
    'Комната. #id:ch1.k.a005',
    '-> END',
  ]);
  expect(effectAt(flow, 'ch1.k.a001').faces).toEqual(['ally=smile']);
  expect(effectAt(flow, 'ch1.k.a002')).toMatchObject({ shots: ['street'], faces: ['ally=smile'] }); // a cut keeps faces (S4)
  expect(effectAt(flow, 'ch1.k.a004').faces).toEqual(['ally=smile,worried']);
  expect(effectAt(flow, 'ch1.k.a005').faces).toEqual([]); // a scene puts every face back at rest
  // A path where no face was set joins as the rest state.
  const joined = flowOf([
    '-> k',
    '=== k ===',
    '# scene: cafe',
    'Кафе. #id:ch1.k.a001',
    '* [Улыбка #id:ch1.k.c001]',
    '    # face: ally smile',
    '    ally: Ха. #id:ch1.k.a002',
    '* [Ничего #id:ch1.k.c002]',
    '- Дальше. #id:ch1.k.a003',
    '-> END',
  ]).flow;
  expect(effectAt(joined, 'ch1.k.a003').faces).toEqual(['ally=-,smile']);
});

test("flow: a chapter's first step starts on the empty stage", () => {
  const { flow } = flowOf(['-> k', '=== k ===', '# face: ally smile', 'ally: Привет. #id:ch1.k.a001', '# scene: cafe', 'Кафе. #id:ch1.k.a002', '-> END']);
  const empty = { shots: [], faces: [], cg: ['-'], room: ['-'], sprites: [] };
  expect(effectAt(flow, 'k:k')).toEqual(empty);
  // No shot on any path: the face names no cast (shot/char-absent judges it).
  expect(effectAt(flow, 'ch1.k.a001')).toEqual({ ...empty, faces: ['ally=smile'] });
  expect(effectAt(flow, 'ch1.k.a002')).toEqual({ ...empty, shots: ['cafe'] });
});

test("flow: a section knot starts with its room's shot and props", () => {
  const w = manorWorld();
  const { flow } = flowOf(MANOR, COMMITTED.catalog, w);
  // The event knot runs over the cellar (its room, whose props come with it), never the arrival's hall.
  expect(effectAt(flow, 'k:cellar_voice')).toMatchObject({ shots: ['cellar'], room: ['cellar'] });
  expect(effectAt(flow, 'ch1.cellar_voice.v001')).toMatchObject({ shots: ['cellar'], room: ['cellar'], cg: ['-'] });
  expect(effectAt(flow, 'k:gate_forced')).toMatchObject({ shots: ['hall'], room: ['hall'] });
  // The leave knot opens on its own scene: the street, no room.
  expect(effectAt(flow, 'ch1.out.o001')).toMatchObject({ shots: ['street'], room: ['-'] });
  // The arrival's scene is a room's shot: its room is in effect.
  expect(effectAt(flow, 'ch1.arrive.a001')).toMatchObject({ shots: ['hall'], room: ['hall'] });
});

test("flow: a cut back to a room's shot puts its room in effect", () => {
  const w = manorWorld();
  const body = MANOR.map((l) => (l === 'Хруст. #id:ch1.gate_forced.f001' ? '# bg: cafe\nХруст. #id:ch1.gate_forced.f001\n# bg: hall\nСнова зал. #id:ch1.gate_forced.f002' : l));
  const { flow } = flowOf(body.join('\n').split('\n'), COMMITTED.catalog, w);
  expect(effectAt(flow, 'ch1.gate_forced.f001')).toMatchObject({ shots: ['cafe'], room: ['-'] });
  expect(effectAt(flow, 'ch1.gate_forced.f002')).toMatchObject({ shots: ['hall'], room: ['hall'] });
});

test('flow: a legacy show is in effect until a hide or a scene', () => {
  const { flow } = flowOf([
    '-> k',
    '=== k ===',
    '# scene: cafe',
    '# show: ally neutral at=left',
    'Кафе. #id:ch1.k.a001',
    '# show: ally smile',
    '# show: stranger neutral at=right',
    'Улыбка. #id:ch1.k.a002',
    '# hide: ally',
    'Ушла. #id:ch1.k.a003',
    '# bg: street',
    'Улица. #id:ch1.k.a004',
    '# scene: room',
    'Комната. #id:ch1.k.a005',
    '-> END',
  ]);
  expect(effectAt(flow, 'ch1.k.a001').sprites).toEqual(['ally=neutral']);
  expect(effectAt(flow, 'ch1.k.a002').sprites).toEqual(['ally=smile', 'stranger=neutral']);
  expect(effectAt(flow, 'ch1.k.a003').sprites).toEqual(['stranger=neutral']);
  expect(effectAt(flow, 'ch1.k.a004').sprites).toEqual(['stranger=neutral']); // a cut keeps sprites
  expect(effectAt(flow, 'ch1.k.a005').sprites).toEqual([]);
});

test("flow: a batch before a conditional block runs with every arm's first line", () => {
  // ch1's manor_out shape: the knot's opening scene runs with whichever arm's line shows first.
  const { flow } = flowOf([
    '-> a',
    '=== a ===',
    '# scene: room',
    'Комната. #id:ch1.a.a001',
    '-> b',
    '=== b ===',
    '# scene: street',
    '# show: ally neutral at=left',
    '{ g_x == 1:',
    '    Открыто. #id:ch1.b.o001',
    '- else:',
    '    Сломано. #id:ch1.b.o002',
    '}',
    'Дальше. #id:ch1.b.o003',
    '-> END',
  ]);
  for (const arm of ['ch1.b.o001', 'ch1.b.o002']) {
    expect(effectAt(flow, arm), arm).toMatchObject({ shots: ['street'], sprites: ['ally=neutral'] });
    expect(flow.steps.get(arm as StepKey)?.cut, arm).toBe('street');
  }
  expect(effectAt(flow, 'ch1.b.o003').shots).toEqual(['street']);
});

// ---------------------------------------------------------------------------------------------------------------
// Commit 5: the shot lints and STAGING-DSL §14

/** A cafe with three cast shots (none in the committed catalog: implied placeholders) and a cast-less street shot. */
const CAFE_SHOTS = shotList({
  locs: [
    { id: 'cafe', light: null },
    { id: 'street', light: null },
  ],
  shots: [
    { id: 'cafe_wide', loc: 'cafe', frame: 'wide', cast: [{ char: 'ally', view: 'face', rest: 'neutral' }, { char: 'stranger', view: 'face', rest: 'neutral' }] },
    { id: 'cafe_ally_cu', loc: 'cafe', frame: 'close', cast: [{ char: 'ally', view: 'face', rest: 'neutral', figure: true }] },
    { id: 'cafe_ots', loc: 'cafe', frame: 'ots', cast: [{ char: 'stranger', view: 'back', rest: 'neutral' }, { char: 'ally', view: 'face', rest: 'smile' }] },
    { id: 'street_wide', loc: 'street', frame: 'wide', cast: [] },
    { id: 'spare_cu', loc: 'cafe', frame: 'close', cast: [{ char: 'keeper', view: 'face', rest: 'neutral' }] },
  ],
});
const CAFE_CATALOG = effectiveCatalog(COMMITTED.catalog, CAFE_SHOTS);

type Linted = { flow: ChapterFlow; findings: ShotFinding[]; shots: ReadonlyMap<BgId, EffectiveShot> };

/** One fixture chapter's flow under a shot list, and the shot lints over it. */
function linted(body: readonly string[], opts: { list?: ShotList; w?: WorldPublicBody; planes?: ReadonlyMap<BgId, readonly Plane[]> } = {}): Linted {
  const list = opts.list ?? CAFE_SHOTS;
  const catalog = effectiveCatalog(COMMITTED.catalog, list);
  const { flow } = flowOf(body, catalog, opts.w);
  const shots = effectiveShots(catalog, list, opts.w === undefined ? [] : [opts.w]);
  const findings = lintShots({ chapters: [{ id: CH1, flow, world: opts.w ?? null }], shots, catalog: COMMITTED.catalog, planes: opts.planes ?? new Map() });
  return { flow, findings, shots };
}

/** The findings of some codes as `code file:line message`. */
function shown(findings: readonly ShotFinding[], ...codes: string[]): string[] {
  return findings.filter((f) => codes.includes(f.code)).map((f) => `${f.code} ${f.file}:${f.line} ${f.message}`);
}

test('shots: a face of a character absent from the shot fails', () => {
  const { findings } = linted(['-> k', '=== k ===', '# scene: cafe_ally_cu', 'ally: Привет. #id:ch1.k.a001', '# face: stranger smile', 'Тишина. #id:ch1.k.a002', '-> END']);
  expect(shown(findings, 'shot/char-absent')).toEqual([
    "shot/char-absent story/ch1/main.ink:6 'face: stranger smile': stranger is not in the cast of shot 'cafe_ally_cu' (on some path) (§14)",
  ]);
  expect(findings.find((f) => f.code === 'shot/char-absent')?.severity).toBe('E');
});

test("shots: a face in the batch of a cut names the new shot's cast", () => {
  const { findings } = linted([
    '-> k',
    '=== k ===',
    '# scene: cafe_ally_cu',
    'ally: Привет. #id:ch1.k.a001',
    '# bg: cafe_wide',
    '# face: stranger serious',
    'stranger: Здравствуй. #id:ch1.k.a002',
    '# bg: cafe_ally_cu',
    '# face: stranger smile',
    'Тишина. #id:ch1.k.a003',
    '-> END',
  ]);
  // The cut runs first (§3.1 batch order): stranger is cast in cafe_wide, the shot after the cut; not in cafe_ally_cu.
  expect(shown(findings, 'shot/char-absent')).toEqual([
    "shot/char-absent story/ch1/main.ink:10 'face: stranger smile': stranger is not in the cast of shot 'cafe_ally_cu' (on some path) (§14)",
  ]);
});

test('shots: an off-screen speaker passes', () => {
  const { findings } = linted(['-> k', '=== k ===', '# scene: cafe_ally_cu', 'voice: Кто там? #id:ch1.k.a001', 'radio: Приём. #id:ch1.k.a002', 'stranger: Я здесь. #id:ch1.k.a003', '-> END']);
  expect(shown(findings, 'shot/char-absent', 'shot/back-view')).toEqual([]);
});

test('shots: a show in a shot chapter fails', () => {
  // Any character: ally is in the cast and still has no sprite in a shot chapter.
  const { findings } = linted(['-> k', '=== k ===', '# scene: cafe_wide', 'Кафе. #id:ch1.k.a001', '# show: ally smile at=left', 'Улыбка. #id:ch1.k.a002', '-> END']);
  expect(shown(findings, 'shot/sprite-in-shot-chapter')).toEqual([
    "shot/sprite-in-shot-chapter story/ch1/main.ink:7 ch1 shows shot 'cafe_wide', which has a cast: a shot chapter has no sprites (§14)",
  ]);
});

test('shots: a show in a legacy chapter passes', () => {
  const { findings } = linted(['-> k', '=== k ===', '# scene: street', '# show: ally smile at=left', 'Улица. #id:ch1.k.a001', '# hide: ally', 'Ушла. #id:ch1.k.a002', '-> END']);
  expect(findings.filter((f) => f.severity === 'E')).toEqual([]);
  expect(shown(findings, 'shot/sprite-in-shot-chapter')).toEqual([]);
});

test('shots: a front plane over a hotspot warns', () => {
  const list = shotList({ locs: [{ id: 'hall', light: null }], shots: [{ id: 'hall', loc: 'hall', frame: 'room', cast: [] }] });
  const w = manorWorld();
  const planes = new Map<BgId, readonly Plane[]>([
    [
      bg('hall'),
      [
        { at: [450, 600, 100, 100], front: true }, // over the gate [400, 500, 300, 700]
        { at: [0, 0, 50, 50], front: true }, // over nothing
        { at: [400, 500, 300, 700], front: false }, // a back plane draws below the props
      ],
    ],
  ]);
  const { findings } = linted(MANOR, { list, w, planes });
  expect(shown(findings, 'shot/plane-over-hotspot')).toEqual(['shot/plane-over-hotspot story/ch1/world.json:0 a front plane of \'hall\' at [450, 600, 100, 100] covers hotspot s.hall.gate (§14)']);
  expect(findings.find((f) => f.code === 'shot/plane-over-hotspot')?.severity).toBe('W');
});

test('shots: an undeclared shot warns', () => {
  const { findings } = linted(['-> k', '=== k ===', '# scene: street', 'Улица. #id:ch1.k.a001', '# scene: cafe_wide', 'Кафе. #id:ch1.k.a002', '-> END']);
  expect(shown(findings, 'shot/undeclared')).toEqual([
    "shot/undeclared story/shots.json:0 shot 'street' (used by ch1) is not declared: an implied cast-less shot, frame wide (§14)",
  ]);
  expect(findings.find((f) => f.code === 'shot/undeclared')?.severity).toBe('W');
});

test('shots: a view whose bg is declared as an insert fails', () => {
  // No zoom view exists on this tree (no `view` key yet): a view is a room of a section, so the fixture is a room.
  const insert = shotList({ locs: [{ id: 'hall', light: null }], shots: [{ id: 'hall', loc: 'hall', frame: 'insert', cast: [] }] });
  const w = manorWorld();
  expect(shown(linted(MANOR, { list: insert, w }).findings, 'shot/room-frame')).toEqual([
    "shot/room-frame story/ch1/world.json:0 room s.hall draws 'hall', which story/shots.json declares frame insert: a room's shot is frame room (§14)",
  ]);
  const room = shotList({ locs: [{ id: 'hall', light: null }], shots: [{ id: 'hall', loc: 'hall', frame: 'room', cast: [] }] });
  expect(shown(linted(MANOR, { list: room, w }).findings, 'shot/room-frame')).toEqual([]);
});

/** The rows of STAGING-DSL §14 that start with a code (`| \`code\` | sev |`). */
function docCodes(): Array<[string, string]> {
  const lines = readFileSync(new URL('../../../../docs/STAGING-DSL.md', import.meta.url), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## 14.'));
  if (start < 0) {
    throw new Error('invariant: STAGING-DSL.md has a section 14');
  }
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? lines.length : end).flatMap((l) => {
    const m = /^\| `([^`]+)` \| (E|W) \|/.exec(l);
    return m === null ? [] : [[m[1] ?? '', m[2] ?? ''] as [string, string]];
  });
}

test("shots: the doc's shot lint table equals the codes", () => {
  const rows = docCodes();
  expect(rows.length).toBeGreaterThanOrEqual(10); // non-vacuity; no fixed count, so SH3b adds its rows with no test edit
  expect(new Map(rows)).toEqual(new Map(Object.entries(SHOT_LINT_CODES)));
  expect(rows.length).toBe(new Set(rows.map(([code]) => code)).size); // one row per code
});

test('shots: a face or a cam target on a back view fails', () => {
  const { findings } = linted([
    '-> k',
    '=== k ===',
    '# scene: cafe_ots',
    'Кафе. #id:ch1.k.a001',
    '# face: stranger smile',
    'Улыбка. #id:ch1.k.a002',
    '# cam: push to=stranger z=120',
    'Ближе. #id:ch1.k.a003',
    '# cam: push to=ally',
    '# face: ally worried',
    'ally: Ой. #id:ch1.k.a004',
    '-> END',
  ]);
  expect(shown(findings, 'shot/back-view', 'shot/char-absent')).toEqual([
    "shot/back-view story/ch1/main.ink:6 'face: stranger smile': stranger is a back view in shot 'cafe_ots' (§14)",
    "shot/back-view story/ch1/main.ink:8 'cam: push to=stranger': stranger is a back view in shot 'cafe_ots' (§14)",
  ]);
});

test('shots: a hop for a member without a figure plane fails', () => {
  const { findings } = linted([
    '-> k',
    '=== k ===',
    '# scene: cafe_wide',
    '# anim: ally hop',
    'Прыжок. #id:ch1.k.a001',
    '# anim: stranger nod',
    'Кивок. #id:ch1.k.a002',
    '# bg: cafe_ally_cu',
    '# anim: ally bounce',
    'Ещё. #id:ch1.k.a003',
    '-> END',
  ]);
  expect(shown(findings, 'shot/motion-unsupported', 'shot/char-absent')).toEqual([
    "shot/motion-unsupported story/ch1/main.ink:5 'anim: ally hop': ally has no figure plane in shot 'cafe_wide' (figure: true) (§14)",
  ]);
});

test('shots: a cut to another location without a scene warns', () => {
  const { findings } = linted([
    '-> k',
    '=== k ===',
    '# scene: cafe_wide',
    'Кафе. #id:ch1.k.a001',
    '# bg: cafe_ally_cu',
    'Ближе. #id:ch1.k.a002',
    '# bg: street_wide',
    'Улица. #id:ch1.k.a003',
    '# scene: cafe_wide',
    'Снова кафе. #id:ch1.k.a004',
    '-> END',
  ]);
  expect(shown(findings, 'shot/loc-change')).toEqual([
    "shot/loc-change story/ch1/main.ink:8 'bg: street_wide' cuts from location cafe ('cafe_ally_cu') to street without a scene (§14)",
  ]);
});

test('shots: a used shot without a catalog entry warns', () => {
  const { findings } = linted(['-> k', '=== k ===', '# scene: cafe_wide', 'Кафе. #id:ch1.k.a001', '-> END']);
  // spare_cu is declared with no catalog entry too, but no chapter uses it.
  expect(shown(findings, 'shot/implied-placeholder')).toEqual([
    "shot/implied-placeholder story/shots.json:0 shot 'cafe_wide' (used by ch1) has no assets/catalog.json entry: an implied placeholder, art pending (§14)",
  ]);
});

test('shots: a needed face state on a placeholder shot is pending art', () => {
  const { findings } = linted([
    '-> k',
    '=== k ===',
    '# scene: cafe_ally_cu',
    'ally: Привет. #id:ch1.k.a001',
    '# face: ally smile',
    'ally: Ха. #id:ch1.k.a002',
    'Тишина. #id:ch1.k.a003',
    '-> END',
  ]);
  expect(shown(findings, 'art/pending')).toEqual([
    'art/pending story/ch1/main.ink:5 shot cafe_ally_cu lacks ally.neutral (needed by ch1.k.a001) (§14)',
    'art/pending story/ch1/main.ink:7 shot cafe_ally_cu lacks ally.smile (needed by ch1.k.a002, ch1.k.a003) (§14)',
  ]);
});

test('shots: a face, anim or cam target on a legacy chapter fails even with its sprite shown', () => {
  // D4 (carries b, c): a legacy chapter's shots are cast-less; the rule reads no sprite.
  const { findings } = linted([
    '-> k',
    '=== k ===',
    '# scene: street',
    '# show: ally neutral at=left',
    'Улица. #id:ch1.k.a001',
    '# face: ally smile',
    'Улыбка. #id:ch1.k.a002',
    '# anim: ally nod',
    'Кивок. #id:ch1.k.a003',
    '# cam: pan to=ally',
    'Взгляд. #id:ch1.k.a004',
    '# cam: push',
    'Ближе. #id:ch1.k.a005',
    '-> END',
  ]);
  expect(shown(findings, 'shot/char-absent')).toEqual([
    "shot/char-absent story/ch1/main.ink:7 'face: ally smile': ally is not in the cast of shot 'street' (on some path) (§14)",
    "shot/char-absent story/ch1/main.ink:9 'anim: ally nod': ally is not in the cast of shot 'street' (on some path) (§14)",
    "shot/char-absent story/ch1/main.ink:11 'cam: pan to=ally': ally is not in the cast of shot 'street' (on some path) (§14)",
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// Commit 6a: the story-step lookahead

type Looked = { flow: ChapterFlow; look: ReadonlyMap<string, Lookahead>; files: ShotFiles; rooms: RoomEvents };

/**
 * One fixture chapter's flow and lookahead under a shot list; the talk files are the chapter's own spoken faces, the
 * room windows the world's rooms with `pictures` (per room id, its pictures beyond the plate).
 */
function looked(body: readonly string[], opts: { list?: ShotList; w?: WorldPublicBody; pictures?: ReadonlyMap<string, readonly string[]> } = {}): Looked {
  const list = opts.list ?? CAFE_SHOTS;
  const catalog = effectiveCatalog(COMMITTED.catalog, list);
  const { flow, built } = flowOf(body, catalog, opts.w);
  const shots = effectiveShots(catalog, list, opts.w === undefined ? [] : [opts.w]);
  const talk = new Set(
    faceNeeds(flow, shots)
      .filter((n) => n.talk)
      .map((n) => `${n.shot}/${n.char}/${n.expr}`),
  );
  const files = { shots, talk };
  const pictures = new Map([...(opts.pictures ?? [])].map(([r, xs]) => [r as RoomId, xs.map((x) => x as AssetId)])); // fixture ids
  const rooms = opts.w === undefined ? new Map() : roomEvents(opts.w, sectionsOf(built.graph), pictures);
  return { flow, look: lookahead({ flow, files, rooms }), files, rooms };
}

function lookAt(l: Looked, key: string): Lookahead {
  const v = l.look.get(key);
  if (v === undefined) {
    throw new Error(`invariant: the lookahead has window ${key}`);
  }
  return v;
}

function entryAt(l: Looked, key: string): string[][] {
  const s = l.flow.steps.get(key as StepKey); // a fixture key
  if (s === undefined) {
    throw new Error(`invariant: the flow has step ${key}`);
  }
  return entryOf(s.effect, l);
}

/** A cafe choice: a close-up, an over-the-shoulder, the street; the gather after it. */
const THREE_WAYS = [
  '-> k',
  '=== k ===',
  '# scene: cafe_wide',
  'Кафе. #id:ch1.k.a001',
  '* [Ближе #id:ch1.k.c001]',
  '    # bg: cafe_ally_cu',
  '    ally: Привет. #id:ch1.k.a002',
  '* [Через плечо #id:ch1.k.c002]',
  '    # bg: cafe_ots',
  '    ally: Да? #id:ch1.k.a003',
  '* [Уйти #id:ch1.k.c003]',
  '    # scene: street_wide',
  '    Улица. #id:ch1.k.a004',
  '- Потом. #id:ch1.k.a005',
  '-> END',
];

test("flow: d1 of a choice lists each branch's first cut", () => {
  const l = looked(THREE_WAYS);
  const branches = [
    'bg/cafe_ally_cu',
    'bg/cafe_ots',
    'bg/street_wide',
    'sheet/cafe_ally_cu',
    'sheet/cafe_ots',
    'talk/cafe_ally_cu/ally/neutral', // ally speaks at rest in the close-up
    'talk/cafe_ots/ally/smile', // and at the over-the-shoulder's rest (smile)
  ];
  // The step before the choice and every choice of the set (one window) look into every branch.
  for (const key of ['ch1.k.a001', 'ch1.k.c001', 'ch1.k.c002', 'ch1.k.c003']) {
    expect(lookAt(l, key), key).toMatchObject({ certain: [], certainDist: 0, possible: branches, d2: [], d3: [] });
  }
  expect(l.flow.steps.get('ch1.k.c002' as StepKey)).toMatchObject({ kind: 'choice', set: ['ch1.k.c001', 'ch1.k.c002', 'ch1.k.c003'] });
  expect(l.flow.steps.get('ch1.k.a001' as StepKey)).toMatchObject({ kind: 'line', set: [] });
});

test("flow: a line after a knot's last cut looks into the next knot", () => {
  const l = looked(['-> a', '=== a ===', '# scene: cafe_wide', 'Кафе. #id:ch1.a.a001', 'Ещё. #id:ch1.a.a002', '-> b', '=== b ===', '# scene: street_wide', 'Улица. #id:ch1.b.b001', '-> END']);
  expect(lookAt(l, 'ch1.a.a002')).toMatchObject({ certain: ['bg/street_wide'], certainDist: 1, possible: [] });
  expect(lookAt(l, 'ch1.a.a001')).toMatchObject({ certain: ['bg/street_wide'], certainDist: 2, possible: [] });
  expect(lookAt(l, 'k:a')).toMatchObject({ certain: ['bg/cafe_wide', 'sheet/cafe_wide'], certainDist: 1, d2: ['bg/street_wide'] });
  expect(lookAt(l, 'ch1.b.b001')).toMatchObject({ certain: [], possible: [], d2: [] });
});

/** A CG over the cafe, then the CG off. */
const LETTER = ['-> k', '=== k ===', '# scene: cafe_wide', 'Кафе. #id:ch1.k.a001', '# cg: letter', 'Письмо. #id:ch1.k.a002', '# cg: off', 'Дальше. #id:ch1.k.a003', '-> END'];

test('flow: a cg counts as an image change', () => {
  const l = looked(LETTER);
  expect(lookAt(l, 'ch1.k.a001')).toMatchObject({ certain: ['cg/letter'], certainDist: 1 });
  expect(l.flow.steps.get('ch1.k.a002' as StepKey)?.cut).toBe('letter');
  // Off brings back the shot that stayed resident under the CG: nothing new appears.
  expect(lookAt(l, 'ch1.k.a002')).toMatchObject({ certain: [], possible: [] });
});

test('flow: a step under a CG enters at the CG alone', () => {
  const l = looked(LETTER);
  expect(entryAt(l, 'ch1.k.a002')).toEqual([['cg/letter']]);
  // The shot under the CG stays in effect: it is resident, not an entry alternative.
  expect(lookAt(l, 'ch1.k.a002').cur).toEqual(['bg/cafe_wide', 'cg/letter', 'sheet/cafe_wide']);
  expect(entryAt(l, 'ch1.k.a003')).toEqual([['bg/cafe_wide', 'sheet/cafe_wide']]);
  // A CG on one path only: the CG and the shot are two alternatives.
  const one = looked(['-> k', '=== k ===', '# scene: cafe_wide', 'Кафе. #id:ch1.k.a001', '* [Письмо #id:ch1.k.c001]', '    # cg: letter', '    Письмо. #id:ch1.k.a002', '* [Нет #id:ch1.k.c002]', '- Дальше. #id:ch1.k.a003', '-> END']);
  expect(entryAt(one, 'ch1.k.a003')).toEqual([['cg/letter'], ['bg/cafe_wide', 'sheet/cafe_wide']]);
});

test("flow: a gather's entry lists one alternative per possible shot", () => {
  const l = looked(THREE_WAYS);
  expect(entryAt(l, 'ch1.k.a005')).toEqual([['bg/cafe_ally_cu', 'sheet/cafe_ally_cu'], ['bg/cafe_ots', 'sheet/cafe_ots'], ['bg/street_wide']]);
  // The step's files in effect: every alternative, and the talk file of each visible face that has one.
  expect(lookAt(l, 'ch1.k.a005').cur).toEqual([
    'bg/cafe_ally_cu',
    'bg/cafe_ots',
    'bg/street_wide',
    'sheet/cafe_ally_cu',
    'sheet/cafe_ots',
    'talk/cafe_ally_cu/ally/neutral',
    'talk/cafe_ots/ally/smile',
  ]);
});

test("flow: a legacy step's entry lists the sprites in effect", () => {
  const l = looked(['-> k', '=== k ===', '# scene: street', '# show: ally neutral at=left', 'Улица. #id:ch1.k.a001', '# show: stranger smile at=right', 'Двое. #id:ch1.k.a002', '-> END']);
  expect(entryAt(l, 'ch1.k.a001')).toEqual([['bg/street', 'char/ally/neutral']]);
  expect(entryAt(l, 'ch1.k.a002')).toEqual([['bg/street', 'char/ally/neutral', 'char/stranger/smile']]);
  expect(lookAt(l, 'ch1.k.a002').cur).toEqual(['bg/street', 'char/ally/neutral', 'char/stranger/smile']);
  // A sprite is the knot-set's row, not an appearance (§3.4 "Window bytes").
  expect(lookAt(l, 'ch1.k.a001')).toMatchObject({ certain: [], possible: [] });
});

test('flow: a choice whose replies open on different shots lists them as possible, not certain', () => {
  const l = looked([
    '-> k',
    '=== k ===',
    '# scene: cafe_wide',
    'Кафе. #id:ch1.k.a001',
    '* [Ближе #id:ch1.k.c001]',
    '    # bg: cafe_ally_cu',
    '    Близко. #id:ch1.k.a002',
    '* [Плечо #id:ch1.k.c002]',
    '    # bg: cafe_ots',
    '    Плечо. #id:ch1.k.a003',
    '* [Ждать #id:ch1.k.c003]',
    '- Потом. #id:ch1.k.a004',
    '# bg: street_wide',
    'Улица. #id:ch1.k.a005',
    '-> END',
  ]);
  // The waiting reply opens on nothing: its first appearance is the street, two steps on.
  expect(lookAt(l, 'ch1.k.a001')).toMatchObject({
    certain: [],
    certainDist: 0,
    possible: ['bg/cafe_ally_cu', 'bg/cafe_ots', 'bg/street_wide', 'sheet/cafe_ally_cu', 'sheet/cafe_ots'],
    d2: ['bg/street_wide'],
    d3: [],
  });
  expect(lookAt(l, 'ch1.k.a004')).toMatchObject({ certain: ['bg/street_wide'], certainDist: 1, possible: [] });
});

test('flow: a step whose every path opens on one shot lists it as certain with its distance', () => {
  const body = [
    '-> k',
    '=== k ===',
    '# scene: cafe_wide',
    'Кафе. #id:ch1.k.a001',
    '* [Да #id:ch1.k.c001]',
    '    Да. #id:ch1.k.a002',
    '* [Нет #id:ch1.k.c002]',
    '- Потом. #id:ch1.k.a003',
    '# bg: cafe_ally_cu',
    '# face: ally smile',
    'Близко. #id:ch1.k.a004',
    '-> END',
  ];
  const l = looked(body);
  const cu = ['bg/cafe_ally_cu', 'face/cafe_ally_cu/ally/smile', 'sheet/cafe_ally_cu'];
  // The shortest way: the choice "Нет", the gather, the close-up.
  expect(lookAt(l, 'ch1.k.a001')).toMatchObject({ certain: cu, certainDist: 3, possible: [] });
  expect(lookAt(l, 'ch1.k.c001')).toMatchObject({ certain: cu, certainDist: 2, possible: [] });
  expect(lookAt(l, 'ch1.k.a003')).toMatchObject({ certain: cu, certainDist: 1, possible: [] });
  // A reply that ends the chapter shares nothing: the close-up is only possible.
  const exit = looked([...body.slice(0, 7), '* [Уйти #id:ch1.k.c003]', '    -> END', ...body.slice(7)]);
  expect(lookAt(exit, 'ch1.k.a001')).toMatchObject({ certain: [], certainDist: 0, possible: cu });
  expect(lookAt(exit, 'ch1.k.c003')).toMatchObject({ certain: [], possible: cu });
});

test('flow: a face change is an appearance of its face file', () => {
  const l = looked(['-> k', '=== k ===', '# scene: cafe_ally_cu', 'ally: Привет. #id:ch1.k.a001', '# face: ally smile', 'ally: Ха. #id:ch1.k.a002', '# face: ally neutral', 'Тишина. #id:ch1.k.a003', '-> END']);
  expect(lookAt(l, 'ch1.k.a001')).toMatchObject({ certain: ['face/cafe_ally_cu/ally/smile', 'talk/cafe_ally_cu/ally/smile'], certainDist: 1 });
  // Back to rest: the plate's face, no face file; its talk file (ally speaks at rest at a001) comes with it.
  expect(lookAt(l, 'ch1.k.a002')).toMatchObject({ certain: ['talk/cafe_ally_cu/ally/neutral'], certainDist: 1 });
  expect(lookAt(l, 'ch1.k.a002').cur).toEqual(['bg/cafe_ally_cu', 'face/cafe_ally_cu/ally/smile', 'sheet/cafe_ally_cu', 'talk/cafe_ally_cu/ally/smile']);
});

test('flow: a cut lists the talk file of every visible face whose expression has one', () => {
  const l = looked([
    '-> k',
    '=== k ===',
    '# scene: street_wide',
    'Улица. #id:ch1.k.a001',
    '# scene: cafe_wide',
    '# face: ally smile',
    'ally: Привет. #id:ch1.k.a002',
    'stranger: Здравствуй. #id:ch1.k.a003',
    '# bg: cafe_ally_cu',
    'Близко. #id:ch1.k.a004',
    '-> END',
  ]);
  // The stranger is silent at the cut but speaks at rest later in this shot: its talk file comes with the cut.
  expect(lookAt(l, 'ch1.k.a001')).toMatchObject({
    certain: ['bg/cafe_wide', 'face/cafe_wide/ally/smile', 'sheet/cafe_wide', 'talk/cafe_wide/ally/smile', 'talk/cafe_wide/stranger/neutral'],
    certainDist: 1,
  });
  // Faces persist across the cut; nobody speaks in the close-up, so it has no talk file.
  expect(lookAt(l, 'ch1.k.a003')).toMatchObject({ certain: ['bg/cafe_ally_cu', 'face/cafe_ally_cu/ally/smile', 'sheet/cafe_ally_cu'], certainDist: 1 });
});

test("flow: a story step's near covers all its possible files", () => {
  const l = looked(THREE_WAYS);
  expect(lookAt(l, 'ch1.k.a001').possible.length).toBeGreaterThan(0); // non-vacuity
  for (const [key, v] of l.look) {
    expect(v.near, key).toBe(v.possible.length);
    expect(v.labels, key).toBe(false); // no room in effect
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Commit 6b: room windows and event returns

/** The manor rooms' pictures beyond the plate (usage.json `rooms` props). */
const MANOR_PROPS = new Map([
  ['study', ['prop/medal_sun']],
  ['cellar', ['prop/medal_star']],
]);

/** MANOR with some knots' first line replaced (`<knot>` -> its new opening lines). */
function manor(opening: Readonly<Record<string, readonly string[]>>, extra: readonly string[] = []): string[] {
  const out: string[] = [];
  let knot = '';
  for (const l of MANOR) {
    const m = /^=== (\w+) ===$/.exec(l);
    if (m !== null) {
      knot = m[1] ?? '';
      out.push(l, ...(opening[knot] ?? []));
      continue;
    }
    out.push(l);
  }
  return [...out, ...extra];
}

test('flow: a window with a room in effect lists its props and its label bound', () => {
  const w = manorWorld();
  const l = looked(manor({ gate_forced: [] }).flatMap((x) => (x === 'Хруст. #id:ch1.gate_forced.f001' ? [x, '# bg: cellar', 'Подвал. #id:ch1.gate_forced.f002'] : [x])), { w, pictures: MANOR_PROPS });
  // A cut into a room's shot brings the room's props with its plate.
  expect(lookAt(l, 'ch1.gate_forced.f001')).toMatchObject({ certain: ['bg/cellar', 'prop/medal_star'], certainDist: 1 });
  expect(lookAt(l, 'ch1.gate_forced.f002')).toMatchObject({ cur: ['bg/cellar', 'prop/medal_star'], labels: true });
  expect(lookAt(l, 'ch1.cellar_voice.v001')).toMatchObject({ cur: ['bg/cellar', 'prop/medal_star'], labels: true });
  expect(lookAt(l, 'ch1.out.o001')).toMatchObject({ cur: ['bg/street'], labels: false });
  expect(lookAt(l, 'r:study')).toMatchObject({ cur: ['bg/study', 'prop/medal_sun'], certain: [], certainDist: 0, d2: [], d3: [], labels: true });
});

/** The critic's fixture: a start room with three events of distinct close-up openers and a leave knot opening on a scene. */
function crowdedHall(): { w: WorldPublicBody; body: string[] } {
  const look = (id: string, n: number, story: string): Json => ({
    id,
    kind: 'look',
    rect: [100 * n, 300, 100, 100],
    label: TEXT(`ch1.s.l10${n}`),
    look: TEXT(`ch1.s.k10${n}`),
    then: [{ story }],
  });
  const w = world({
    hall: room('hall', [
      look('clock', 1, 'e1'),
      look('mirror', 2, 'e2'),
      look('chair', 3, 'e3'),
      { id: 'to_study', kind: 'exit', rect: [100, 1300, 250, 400], label: TEXT('ch1.s.l104'), to: { room: 'study' }, lock: null, sfx: null },
      { id: 'door', kind: 'exit', rect: [700, 1300, 250, 400], label: TEXT('ch1.s.l105'), to: { story: 'out' }, lock: null, sfx: null },
    ]),
    study: room('study', [{ id: 'to_hall', kind: 'exit', rect: [100, 1300, 250, 400], label: TEXT('ch1.s.l106'), to: { room: 'hall' }, lock: null, sfx: null }]),
  });
  const event = (k: string, shot: string, line: string): string[] => [`=== ${k} ===`, `# bg: ${shot}`, line, '# explore: s', '-> DONE'];
  const body = [
    '-> arrive',
    '=== arrive ===',
    '# scene: hall',
    'Зал. #id:ch1.arrive.a001',
    '# explore: s',
    '-> DONE',
    ...event('e1', 'cafe_ally_cu', 'ally: Привет. #id:ch1.e1.a001'),
    ...event('e2', 'cafe_ots', 'Плечо. #id:ch1.e2.a001'),
    ...event('e3', 'spare_cu', 'Хранитель. #id:ch1.e3.a001'),
    '=== out ===',
    '# scene: street_wide',
    'Улица. #id:ch1.out.o001',
    '-> END',
  ];
  return { w, body };
}

test('flow: each room of a section has a window of its room and the knots one action away', () => {
  const { w, body } = crowdedHall();
  const l = looked(body, { w });
  expect(l.rooms.get('hall' as RoomId)).toMatchObject({ near: ['e1', 'e2', 'e3', 'out'], far: [] });
  expect(lookAt(l, 'r:hall')).toEqual({
    cur: ['bg/hall'],
    certain: [],
    certainDist: 0,
    possible: [
      'bg/cafe_ally_cu',
      'bg/cafe_ots',
      'bg/spare_cu',
      'bg/street_wide',
      'sheet/cafe_ally_cu',
      'sheet/cafe_ots',
      'sheet/spare_cu',
      'talk/cafe_ally_cu/ally/neutral',
    ],
    near: 8,
    d2: [],
    d3: [],
    labels: true,
  });
  // The study names no knot and its exit leads to a room without onEnter: nothing is one action away.
  expect(lookAt(l, 'r:study')).toMatchObject({ cur: ['bg/study'], possible: [], near: 0, labels: true });
});

test('flow: an explore yield step enters at any room of its section', () => {
  const w = manorWorld();
  const l = looked(MANOR, { w, pictures: MANOR_PROPS });
  // Entering the section leads to its start room's window; the arrival already shows the hall, so nothing appears.
  expect(nextOf(l.flow, 'ch1.arrive.a001')).toEqual(['r:hall']);
  expect(lookAt(l, 'ch1.arrive.a001')).toMatchObject({ certain: [], possible: [] });
  const all = entries(l);
  expect([...all].filter(([k]) => k.startsWith('r:')).sort(([a], [b]) => (a < b ? -1 : 1))).toEqual([
    ['r:cellar', [['bg/cellar', 'prop/medal_star']]],
    ['r:hall', [['bg/hall']]],
    ['r:study', [['bg/study', 'prop/medal_sun']]],
  ]);
  expect(all.get('ch1.arrive.a001' as StepKey)).toEqual([['bg/hall']]);
});

test("flow: an event knot's last step lists the return to its room as certain", () => {
  const w = manorWorld();
  const l = looked(manor({ gate_forced: ['# bg: cafe_ally_cu'] }), { w, pictures: MANOR_PROPS });
  expect(nextOf(l.flow, 'ch1.gate_forced.f001')).toEqual(['r:hall']);
  expect(lookAt(l, 'ch1.gate_forced.f001')).toMatchObject({ certain: ['bg/hall'], certainDist: 1, possible: [] });
  // An event that never left its room returns to what is on stage: nothing appears.
  expect(nextOf(l.flow, 'ch1.cellar_voice.v001')).toEqual(['r:cellar']);
  expect(lookAt(l, 'ch1.cellar_voice.v001')).toMatchObject({ certain: [], possible: [] });
  // A leave knot leaves the section: no return.
  expect(nextOf(l.flow, 'ch1.out.o001')).toEqual([]);
});

test('flow: an event co-fired before another makes the return possible, not certain', () => {
  const w = manorWorld([{ story: 'gate_forced' }, { story: 'gate_echo' }, { unlock: 'hall.gate' }]);
  const body = manor({ gate_forced: ['# bg: cafe_ally_cu'] }, ['=== gate_echo ===', '# bg: cafe_ots', 'Эхо. #id:ch1.gate_echo.e001', '# explore: s', '-> DONE']);
  const l = looked(body, { w, pictures: MANOR_PROPS });
  const built = chapter(body, CAFE_CATALOG, w);
  expect([...eventReturns(w, sectionsOf(built.graph))].sort(([a], [b]) => (a < b ? -1 : 1))).toEqual([
    ['cellar_voice', { rooms: ['cellar'], cofiredAfter: [] }],
    ['gate_echo', { rooms: ['hall'], cofiredAfter: [] }],
    ['gate_forced', { rooms: ['hall'], cofiredAfter: ['gate_echo'] }],
  ]);
  // The echo runs on the forced gate's last image; the hall shows only when nothing more is co-fired.
  expect(nextOf(l.flow, 'ch1.gate_forced.f001')).toEqual(['k:gate_echo', 'r:hall']);
  expect(lookAt(l, 'ch1.gate_forced.f001')).toMatchObject({ certain: [], certainDist: 0, possible: ['bg/cafe_ots', 'bg/hall', 'sheet/cafe_ots'] });
  expect(lookAt(l, 'ch1.gate_echo.e001')).toMatchObject({ certain: ['bg/hall'], certainDist: 1 });
});

test('flow: two rooms on one bg keep two windows', () => {
  const look = (story: string, n: number): Json => ({ id: 'thing', kind: 'look', rect: [100, 300, 100, 100], label: TEXT(`ch1.s.l20${n}`), look: TEXT(`ch1.s.k20${n}`), then: [{ story }] });
  const exit = (to: string, n: number): Json => ({ id: 'way', kind: 'exit', rect: [100, 1300, 250, 400], label: TEXT(`ch1.s.l21${n}`), to: { room: to }, lock: null, sfx: null });
  const w = world({ hall: room('hall', [look('e1', 1), exit('wing', 1)]), wing: room('hall', [look('e2', 2), exit('hall', 2)]) });
  const body = [
    '-> arrive',
    '=== arrive ===',
    '# scene: hall',
    'Зал. #id:ch1.arrive.a001',
    '# explore: s',
    '-> DONE',
    '=== e1 ===',
    '# bg: cafe_ally_cu',
    'Близко. #id:ch1.e1.a001',
    '# explore: s',
    '-> DONE',
    '=== e2 ===',
    '# bg: cafe_ots',
    'Плечо. #id:ch1.e2.a001',
    '# explore: s',
    '-> DONE',
  ];
  const l = looked(body, { w });
  expect(lookAt(l, 'r:hall')).toMatchObject({ cur: ['bg/hall'], possible: ['bg/cafe_ally_cu', 'sheet/cafe_ally_cu'], near: 2 });
  expect(lookAt(l, 'r:wing')).toMatchObject({ cur: ['bg/hall'], possible: ['bg/cafe_ots', 'sheet/cafe_ots'], near: 2 });
});

test("flow: a room window lists its own openers before its neighbours' onEnter openers", () => {
  // ch1's hall shape: the gate's onFail event and the leave knot are the hall's own; the cellar's onEnter is one exit away.
  const w = manorWorld();
  const l = looked(manor({ gate_forced: ['# bg: cafe_ots'], cellar_voice: ['# bg: cafe_ally_cu'] }), { w, pictures: MANOR_PROPS });
  expect(l.rooms.get('hall' as RoomId)).toMatchObject({ near: ['gate_forced', 'out'], far: ['cellar_voice'] });
  expect(lookAt(l, 'r:hall')).toMatchObject({
    possible: ['bg/cafe_ots', 'bg/street', 'sheet/cafe_ots', 'bg/cafe_ally_cu', 'sheet/cafe_ally_cu'],
    near: 3,
  });
  expect(lookAt(l, 'r:cellar')).toMatchObject({ cur: ['bg/cellar', 'prop/medal_star'], possible: ['bg/cafe_ally_cu', 'sheet/cafe_ally_cu'], near: 2 });
  expect(lookAt(l, 'r:study')).toMatchObject({ possible: [], near: 0 });
});

// ---------------------------------------------------------------------------------------------------------------
// Commit 7: build/shots.json

const CH2: ChapterId = 'ch2' as ChapterId; // the second fixture chapter

/** build/shots.json over fixture chapters (`[id, body, world?]`) under a shot list. */
function usageOf(chs: ReadonlyArray<readonly [ChapterId, readonly string[], WorldPublicBody?]>, list: ShotList = CAFE_SHOTS): ShotUsage {
  const catalog = effectiveCatalog(COMMITTED.catalog, list);
  const worlds = chs.flatMap(([, , w]) => (w === undefined ? [] : [w]));
  const shots = effectiveShots(catalog, list, worlds);
  const chapters = chs.map(([id, body, w]) => {
    const { flow, built } = flowOf(body, catalog, w, id);
    return { id, flow, world: w ?? null, rooms: w === undefined ? new Map() : roomEvents(w, sectionsOf(built.graph), new Map()) };
  });
  return shotUsage(chapters, shots);
}

function chapterOf(u: ShotUsage, id: ChapterId): ChapterShots {
  const c = u.chapters[id];
  if (c === undefined) {
    throw new Error(`invariant: the usage has chapter ${id}`);
  }
  return c;
}

const STAGED = [
  '-> k',
  '=== k ===',
  '# scene: cafe_wide',
  'ally: Привет. #id:ch1.k.a001',
  '# bg: cafe_ally_cu',
  '# face: ally smile',
  '# cam: push to=ally z=120',
  'ally: Ха. #id:ch1.k.a002',
  '# anim: ally nod',
  'Кивок. #id:ch1.k.a003',
  '-> END',
];

test('shots: build shots.json lists every need with its line IDs', () => {
  const u = usageOf([[CH1, STAGED]]);
  const ch = chapterOf(u, CH1);
  expect(ch.shots).toEqual({
    cafe_ally_cu: {
      cast: { ally: { view: 'face', rest: 'neutral', figure: true } },
      faces: { ally: [{ expr: 'smile', talk: true, lines: ['ch1.k.a002', 'ch1.k.a003'] }] },
      frame: 'close',
      loc: 'cafe',
      camTargets: ['ally'],
      motions: ['nod'],
      room: null,
    },
    cafe_wide: {
      cast: { ally: { view: 'face', rest: 'neutral', figure: false }, stranger: { view: 'face', rest: 'neutral', figure: false } },
      faces: { ally: [{ expr: 'neutral', talk: true, lines: ['ch1.k.a001'] }], stranger: [{ expr: 'neutral', talk: false, lines: ['ch1.k.a001'] }] },
      frame: 'wide',
      loc: 'cafe',
      camTargets: [],
      motions: [],
      room: null,
    },
  });
  expect(ch.sprites).toBe(false);
  expect(Object.keys(ch.look).sort()).toEqual(['ch1.k.a001', 'ch1.k.a002', 'ch1.k.a003', 'k:k']);
  expect(ch.look['ch1.k.a001' as StepKey]).toMatchObject({ certain: ['bg/cafe_ally_cu', 'face/cafe_ally_cu/ally/smile', 'sheet/cafe_ally_cu', 'talk/cafe_ally_cu/ally/smile'] });
  expect(ch.entry['ch1.k.a002' as StepKey]).toEqual([['bg/cafe_ally_cu', 'face/cafe_ally_cu/ally/smile', 'sheet/cafe_ally_cu']]);
  // The file decodes to what was encoded.
  const text = encodeShotUsage(u);
  expect(decodeShotUsage(JSON.parse(text))).toEqual({ ok: true, value: JSON.parse(text) });
  // A legacy chapter names its sprites; a room's shot names its room.
  const legacy = chapterOf(usageOf([[CH1, MANOR.flatMap((l) => (l === '# scene: hall' ? [l, '# show: ally neutral at=left'] : [l])), manorWorld()]]), CH1);
  expect(legacy.sprites).toBe(true);
  expect(Object.entries(legacy.shots).map(([s, n]) => [s, n.frame, n.room])).toEqual([
    ['cellar', 'room', 'cellar'],
    ['hall', 'room', 'hall'],
    ['street', 'wide', null],
    ['study', 'room', 'study'],
  ]);
  expect(legacy.assets).toEqual(['bg/cellar', 'bg/hall', 'bg/street', 'bg/study']);
});

test('shots: outputs are byte-identical across runs', () => {
  const two = (order: 'ab' | 'ba'): string => {
    const a = [CH1, STAGED] as const;
    const b = [CH2, ['-> k', '=== k ===', '# scene: cafe_ots', 'ally: Да. #id:ch2.k.a001', '-> END']] as const;
    return encodeShotUsage(usageOf(order === 'ab' ? [a, b] : [b, a]));
  };
  const first = two('ab');
  expect(two('ab')).toBe(first);
  expect(two('ba')).toBe(first); // the chapter order of the input does not matter
  expect(first.endsWith('}\n')).toBe(true);
  const parsed = JSON.parse(first) as { chapters: Record<string, { shots: Record<string, object> }> };
  expect(Object.keys(parsed.chapters)).toEqual(['ch1', 'ch2']);
  expect(Object.keys(parsed.chapters['ch1']?.shots['cafe_wide'] ?? {})).toEqual(['camTargets', 'cast', 'faces', 'frame', 'loc', 'motions', 'room']);
});

test('shots: build shots.json lists every shot file each chapter needs', () => {
  // A shared shot; the worried face only in the paid chapter: its own file, so the asset tool gates it alone.
  const u = usageOf([
    [CH1, ['-> k', '=== k ===', '# scene: cafe_ally_cu', 'ally: Привет. #id:ch1.k.a001', '# scene: street_wide', 'Улица. #id:ch1.k.a002', '-> END']],
    [CH2, ['-> k', '=== k ===', '# scene: cafe_ally_cu', '# face: ally worried', 'Ох. #id:ch2.k.a001', '-> END']],
  ]);
  expect(chapterOf(u, CH1).assets).toEqual(['bg/cafe_ally_cu', 'bg/street_wide', 'sheet/cafe_ally_cu', 'talk/cafe_ally_cu/ally/neutral']);
  expect(chapterOf(u, CH2).assets).toEqual(['bg/cafe_ally_cu', 'face/cafe_ally_cu/ally/worried', 'sheet/cafe_ally_cu']);
});

test('shots: a talk file is listed only where its character speaks in that expression', () => {
  const u = usageOf([
    [CH1, ['-> k', '=== k ===', '# scene: street_wide', 'Улица. #id:ch1.k.a000', '# scene: cafe_ally_cu', '# face: ally smile', 'ally: Ха. #id:ch1.k.a001', '-> END']],
    [CH2, ['-> k', '=== k ===', '# scene: street_wide', 'Улица. #id:ch2.k.a000', '# scene: cafe_ally_cu', '# face: ally smile', 'Тишина. #id:ch2.k.a001', '-> END']],
  ]);
  expect(chapterOf(u, CH1).assets).toContain('talk/cafe_ally_cu/ally/smile');
  expect(chapterOf(u, CH1).look['ch1.k.a000' as StepKey]?.certain).toContain('talk/cafe_ally_cu/ally/smile');
  const ch2 = chapterOf(u, CH2);
  expect(ch2.assets).toEqual(['bg/cafe_ally_cu', 'bg/street_wide', 'face/cafe_ally_cu/ally/smile', 'sheet/cafe_ally_cu']);
  // No window of the silent chapter holds a talk file: one it does not list is one its tier may not grant.
  const held = Object.values(ch2.look).flatMap((w) => [...w.cur, ...w.certain, ...w.possible, ...w.d2, ...w.d3]);
  expect(held.length).toBeGreaterThan(0); // non-vacuity
  expect(held.filter((a) => a.startsWith('talk/'))).toEqual([]);
});

test('shots: a shot-file id that names no shot, cast member or expression of its need is refused', () => {
  expect(parseShotFileId('bg/cafe_wide')).toEqual({ ns: 'bg', shot: 'cafe_wide' });
  expect(parseShotFileId('sheet/cafe_wide')).toEqual({ ns: 'sheet', shot: 'cafe_wide' });
  expect(parseShotFileId('face/cafe_wide/ally/smile')).toEqual({ ns: 'face', shot: 'cafe_wide', char: 'ally', expr: 'smile' });
  expect(parseShotFileId('talk/cafe_wide/ally/smile')).toEqual({ ns: 'talk', shot: 'cafe_wide', char: 'ally', expr: 'smile' });
  for (const bad of ['face/cafe_wide/ally', 'face/cafe_wide/ally/smile/x', 'bg/Cafe', 'sheet/a/b', 'char/ally/smile', 'cg/letter', 'bg/']) {
    expect(parseShotFileId(bad), bad).toBeNull();
  }
  const raw = JSON.parse(encodeShotUsage(usageOf([[CH1, STAGED]]))) as {
    chapters: { ch1: { assets: string[]; look: Record<string, Record<string, string[]>>; entry: Record<string, string[][]> } };
  };
  const ch = raw.chapters.ch1;
  const n = ch.assets.length;
  ch.assets.push('prop/medal_sun', 'face/cafe_ally_cu/stranger/smile', 'face/cafe_ally_cu/ally/worried', 'bg/cafe_ally_cu');
  ch.look['ch1.k.a001']?.['possible']?.push('face/cafe_ally_cu/ally/worried', 'cg/letter', 'prop/medal_sun', 'char/ally/smile');
  ch.entry['ch1.k.a001']?.[0]?.push('bg/archive');
  ch.look['x:y'] = {};
  const look = ch.look['ch1.k.a001']?.['possible']?.length ?? 0;
  expect(decodeShotUsage(raw)).toEqual({
    ok: false,
    error: [
      `chapters.ch1.assets.${n}: "prop/medal_sun" is not a shot file of the chapter's needs`,
      `chapters.ch1.assets.${n + 1}: "face/cafe_ally_cu/stranger/smile" is not a shot file of the chapter's needs`,
      `chapters.ch1.assets.${n + 2}: "face/cafe_ally_cu/ally/worried" is not a shot file of the chapter's needs`,
      `chapters.ch1.look.ch1.k.a001.possible.${look - 4}: "face/cafe_ally_cu/ally/worried" is not an asset id or a shot file of the chapter's needs`,
      'chapters.ch1.look.x:y: not a window key with an object',
      `chapters.ch1.entry.ch1.k.a001.0.${(ch.entry['ch1.k.a001']?.[0]?.length ?? 0) - 1}: "bg/archive" is not an asset id or a shot file of the chapter's needs`,
    ],
  });
});

test('shots: only the flow names the legacy kinds', () => {
  // rev. 5 (W3): SH12a removes `show` / `hide` from flow.ts alone; the fixtures of shots.test.ts name them and are not read.
  const dir = new URL('./', import.meta.url);
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'flow.ts' && f !== 'shots.test.ts');
  expect(sources).toEqual(expect.arrayContaining(['lint.ts', 'list.ts', 'usage.ts']));
  const LEGACY = /['"`](?:show|hide)['"`]/;
  for (const f of sources) {
    expect(LEGACY.test(readFileSync(new URL(f, dir), 'utf8')), f).toBe(false);
  }
  expect(LEGACY.test(readFileSync(new URL('flow.ts', dir), 'utf8'))).toBe(true); // non-vacuity: the pattern finds them
});

// ---------------------------------------------------------------------------------------------------------------
// Commit 8: the art list

/** The art list of a fixture story (`[id, paid, body]` in story order) under a shot list. */
function artOf(chs: ReadonlyArray<readonly [ChapterId, boolean, readonly string[]]>, list: ShotList = CAFE_SHOTS): ArtList {
  const catalog = effectiveCatalog(COMMITTED.catalog, list);
  const shots = effectiveShots(catalog, list, []);
  const flows = chs.map(([id, paid, body]) => ({ id, paid, flow: flowOf(body, catalog, undefined, id).flow }));
  const u = shotUsage(
    flows.map((c) => ({ id: c.id, flow: c.flow, world: null, rooms: new Map() })),
    shots,
  );
  return artList({ story: 'demo', chapters: flows.map((c) => ({ ...c, usage: chapterOf(u, c.id) })), list, shots, catalog: COMMITTED.catalog });
}

function artShot(a: ArtList, id: string): ArtShot {
  const s = a.shots.find((x) => x.id === id);
  if (s === undefined) {
    throw new Error(`invariant: the art list has shot ${id}`);
  }
  return s;
}

const FACE_MASKS = [
  { mask: 'mask.fig', typical: false },
  { mask: 'mask.head', typical: false },
  { mask: 'hair.1', typical: false },
  { mask: 'hair.2', typical: true },
];
const BACK_MASKS = FACE_MASKS.filter((m) => m.mask !== 'mask.head');
const derived = (x: string, talk: boolean): Array<{ state: string; conditional: boolean }> => [
  { state: x, conditional: false },
  ...['half', 'closed', 'accent', ...(talk ? ['talk1', 'talk2'] : [])].map((d) => ({ state: `${x}.${d}`, conditional: true })),
];

test('art-list: a shot lists its cast, needed expressions with lines, speakers and an hours estimate', () => {
  const a = artOf([
    [CH1, false, STAGED],
    [CH2, true, ['-> k', '=== k ===', '# scene: cafe_ally_cu', '# face: ally worried', 'ally: Ох. #id:ch2.k.a001', '-> END']],
  ]);
  expect(artShot(a, 'cafe_ally_cu')).toEqual({
    id: 'cafe_ally_cu',
    loc: 'cafe',
    frame: 'close',
    declared: true,
    drawn: false,
    chapters: ['ch1', 'ch2'],
    steps: 3,
    cast: [
      {
        char: 'ally',
        view: 'face',
        rest: 'neutral',
        figure: true,
        masks: FACE_MASKS,
        restSet: ['half', 'closed', 'accent'],
        needs: [
          { expr: 'smile', talk: true, lines: ['ch1.k.a002', 'ch1.k.a003'], states: derived('smile', true) },
          { expr: 'worried', talk: true, lines: ['ch2.k.a001'], states: derived('worried', true) },
        ],
      },
    ],
    camTargets: ['ally'],
    motions: ['nod'],
    files: [
      { id: 'bg/cafe_ally_cu', tier: 'public' },
      { id: 'face/cafe_ally_cu/ally/smile', tier: 'public' },
      { id: 'face/cafe_ally_cu/ally/worried', tier: 'gated' }, // only the paid chapter needs it
      { id: 'sheet/cafe_ally_cu', tier: 'public' },
      { id: 'talk/cafe_ally_cu/ally/smile', tier: 'public' },
      { id: 'talk/cafe_ally_cu/ally/worried', tier: 'gated' },
    ],
    // 3 rest-set states + 2 expressions: each alone (lower) or with its 5 derived states (upper).
    states: { lower: 5, upper: 15 },
    minutes: { lower: 92 + 9 + 1 + 4 * 5, upper: 92 + 9 + 1 + 4 * 15 },
  });
  expect(artShot(a, 'cafe_wide')).toMatchObject({ steps: 1, states: { lower: 8, upper: 8 }, minutes: { lower: 144, upper: 144 } });
  expect(a.toDraw).toEqual(['cafe_wide', 'cafe_ally_cu']); // no catalog art, in order of first use
  expect(a.toStage).toEqual([]);
  expect(a.locs).toEqual([{ id: 'cafe', light: null, shots: ['cafe_wide', 'cafe_ally_cu'] }]);
  expect(a.chapters).toEqual([
    { id: 'ch1', paid: false, shots: 2, fresh: ['cafe_wide', 'cafe_ally_cu'], minutes: { lower: 266, upper: 306 }, extra: 0, marginal: { lower: 0, upper: 0 } },
    { id: 'ch2', paid: true, shots: 1, fresh: [], minutes: { lower: 0, upper: 0 }, extra: 0, marginal: { lower: 0, upper: 0 } },
  ]);
  const md = artListMarkdown(a);
  expect(md).toContain('### Shot `cafe_ally_cu`');
  expect(md).toContain('    - `smile` (2 lines: ch1.k.a002, ch1.k.a003; speaks): smile; then');
  expect(md).toContain('- face states 5-15; estimate 122-162 min (2.0-2.7 h)');
  expect(md).toContain('| ch2 | paid | 1 | 0 | 0-0 min (0.0-0.0 h) | 0 (+0-0 min (0.0-0.0 h)) |');
  expect(JSON.parse(encodeArtList(a))).toEqual(JSON.parse(JSON.stringify(a)));
});

test('art-list: a small face in a wide lists its full set', () => {
  // No reduction for a small face (S30): the stranger speaks in the wide, at rest and in a smile.
  const a = artOf([[CH1, false, ['-> k', '=== k ===', '# scene: cafe_wide', 'stranger: Добрый вечер. #id:ch1.k.a001', '# face: stranger smile', 'stranger: Рад видеть. #id:ch1.k.a002', '-> END']]]);
  const wide = artShot(a, 'cafe_wide');
  expect(wide.cast.find((m) => m.char === 'stranger')).toEqual({
    char: 'stranger',
    view: 'face',
    rest: 'neutral',
    figure: false,
    masks: FACE_MASKS,
    restSet: ['half', 'closed', 'accent', 'talk1', 'talk2'],
    needs: [
      { expr: 'neutral', talk: true, lines: ['ch1.k.a001'], states: [] },
      { expr: 'smile', talk: true, lines: ['ch1.k.a002'], states: derived('smile', true) },
    ],
  });
  expect(wide.cast.find((m) => m.char === 'ally')).toMatchObject({ restSet: ['half', 'closed', 'accent'], needs: [{ expr: 'neutral', talk: false, lines: ['ch1.k.a001', 'ch1.k.a002'], states: [] }] });
  expect(wide.states).toEqual({ lower: 3 + 5 + 1, upper: 3 + 5 + 6 });
});

test("art-list: an expression's derived states are listed as conditional on its boxes", () => {
  const a = artOf([
    [
      CH1,
      false,
      ['-> k', '=== k ===', '# scene: cafe_ally_cu', '# face: ally smile', 'Улыбка. #id:ch1.k.a001', '# face: ally worried', 'ally: Ох. #id:ch1.k.a002', '-> END'],
    ],
  ]);
  const ally = artShot(a, 'cafe_ally_cu').cast[0];
  // A talk pair only where it speaks in that expression; every derived state only if the expression changes that box.
  expect(ally?.needs).toEqual([
    { expr: 'smile', talk: false, lines: ['ch1.k.a001'], states: derived('smile', false) },
    { expr: 'worried', talk: true, lines: ['ch1.k.a002'], states: derived('worried', true) },
  ]);
  expect(artListMarkdown(a)).toContain(
    '    - `smile` (1 line: ch1.k.a001): smile; then smile.half, smile.closed, smile.accent: each only if smile changes that box; else the rest state is reused',
  );
  // The second non-rest expression of one face in one shot is an extra one, at +4-24 min.
  expect(a.chapters[0]).toMatchObject({ extra: 1, marginal: { lower: 4, upper: 24 } });
});

test('art-list: every cast member lists its figure mask and hair locks', () => {
  const a = artOf([[CH1, false, ['-> k', '=== k ===', '# scene: cafe_ots', 'ally: Да? #id:ch1.k.a001', '# scene: street_wide', 'Улица. #id:ch1.k.a002', '-> END']]]);
  const ots = artShot(a, 'cafe_ots');
  expect(ots.cast.map((m) => [m.char, m.view, m.masks, m.restSet])).toEqual([
    ['stranger', 'back', BACK_MASKS, []],
    ['ally', 'face', FACE_MASKS, ['half', 'closed', 'accent', 'talk1', 'talk2']],
  ]);
  expect(ots.cast[0]?.needs).toEqual([]); // a back view carries no face state
  expect(ots.minutes).toEqual({ lower: 92 + 2 * 9 + 1 + 4 * 5, upper: 92 + 2 * 9 + 1 + 4 * 5 });
  expect(artShot(a, 'street_wide')).toMatchObject({ cast: [], minutes: { lower: 92, upper: 92 } });
  const md = artListMarkdown(a);
  expect(md).toContain('    - masks: mask.fig, hair.1, hair.2 (typical)\n    - no face states (no face is visible)');
  expect(md).toContain('    - masks: mask.fig, mask.head, hair.1, hair.2 (typical)');
});
