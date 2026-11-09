// The shot list, the step flow, the shot lints, build/shots.json and the art list (docs/plans/shots §2-3, lane SH2).
// Fixtures are built in-test on the committed catalog and cast; a fixture may be lint-dirty.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { decodeAssetCatalog, decodeCast } from '../../../src/story/catalog.ts';
import type { AssetCatalog, Cast } from '../../../src/story/catalog.ts';
import type { BgId } from '../../../src/story/staging.ts';
import { decodeWorldSource, toPublic } from '../../../src/world/decode.ts';
import type { WorldPublicBody } from '../../../src/world/types.ts';
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

/** A room of `bg` with the given hotspots and onEnter effects. */
function room(bgId: string, hotspots: readonly Json[] = [], onEnter: readonly Json[] = []): Json {
  return { bg: bgId, title: { id: `ch1.s.t${bgId.slice(0, 3).padEnd(3, '0')}`, ru: 'Комната' }, onEnter, hotspots };
}

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
