// The shot list, the step flow, the shot lints, build/shots.json and the art list (docs/plans/shots §2-3, lane SH2).
// Fixtures are built in-test on the committed catalog and cast; a fixture may be lint-dirty.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog, decodeCast } from '../../../src/story/catalog.ts';
import type { AssetCatalog, Cast } from '../../../src/story/catalog.ts';
import type { AssetIndex, BgId, ChapterId, KnotName } from '../../../src/story/staging.ts';
import { decodeWorldSource, toPublic } from '../../../src/world/decode.ts';
import type { WorldPublicBody } from '../../../src/world/types.ts';
import { buildGraph, carriedStage } from '../graph.ts';
import type { ChapterGraph } from '../graph.ts';
import { GLOBALS_PATH } from '../lint.ts';
import { decodeShotList, effectiveCatalog, effectiveShots, impliedPlaceholders } from './list.ts';
import type { ShotList } from './list.ts';

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

/** A fixture chapter (ch1, one entry file after the globals INCLUDE) graphed against `catalog`, with `w` as its world. */
function chapter(body: readonly string[], catalog: AssetCatalog = COMMITTED.catalog, w?: WorldPublicBody): Built {
  const entry = 'ch1/main.ink';
  const sources = new Map([
    [entry, ['INCLUDE ../common/globals.ink', ...body, ''].join('\n')],
    [GLOBALS_PATH, 'VAR g_x = 0\n'],
  ]);
  const files = [entry, GLOBALS_PATH];
  const assets = assetIndex(catalog);
  const { graph } = buildGraph({ chapter: { id: CH1, paid: false, entry }, files, sources, assets, world: w === undefined ? undefined : { kind: 'ok', body: w } });
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
