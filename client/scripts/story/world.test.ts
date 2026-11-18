// The world side of the story gate (PUZZLES-PLAN "Lint codes", STAGING-DSL §11 "Enforced from LW3"): the world lint
// and the per-section soft-lock check of world.ts, and the yield edges of graph.ts. Fixture worlds are inline JSON
// in the source format; the clean base is the demo manor of PUZZLES-PLAN "World data", which each red fixture
// mutates in one place. The catalog is the committed one.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { expect, test, vi } from 'vitest';

import { RESUME_STATE_CAP } from '../../src/explore/reduce.ts';
import type { Step } from '../../src/explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../../src/explore/state.ts';
import { HOTSPOT_MIN_SOURCE_PX } from '../../src/geom/cover.ts';
import type { IssueReport, KernelWorld, MechanicData, MechanicRules, OwnedAt, OwnedRaw, RulesRegistry } from '../../src/mechanics/contract.ts';
import { MECHANIC_DATA } from '../../src/mechanics/data/index.ts';
import type { DataRegistry } from '../../src/mechanics/data/index.ts';
import { MECHANIC_RULES } from '../../src/mechanics/rules/index.ts';
import { searchSection, sectionEntry } from '../../src/mechanics/rules/search.ts';
import type { SearchOptions } from '../../src/mechanics/rules/search.ts';
import { PUZZLE_TYPES } from '../../src/puzzles/rules/index.ts';
import type { PuzzleTypeData, PuzzleTypes } from '../../src/puzzles/rules/index.ts';
import { assetIndex, decodeAssetCatalog, decodeCast } from '../../src/story/catalog.ts';
import type { AssetCatalog, Cast, EndingName } from '../../src/story/catalog.ts';
import type { ChapterId, KnotName, PuzzleLocalId, SectionId, VarName } from '../../src/story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toPublic } from '../../src/world/decode.ts';
import type { DecodeOptions, WorldIssue } from '../../src/world/decode.ts';
import type { HotspotKey, ItemId, WorldSource, WorldText } from '../../src/world/types.ts';
import { carryPaths, main } from '../story.ts';
import { compileChapter } from './compile.ts';
import { buildGraph, mustPass, worldRef, writeOnly } from './graph.ts';
import type { ChapterGraph, GraphFacts, WorldRef } from './graph.ts';
import { GLOBALS_PATH, LINT_CODES } from './lint.ts';
import { checkLocales, decodeEnTable, decodeNameTable } from './locales.ts';
import type { Finding, LintCode, Severity, SourceChapter } from './lint.ts';
import { carryLines, carryProof } from './mechanics/carry.ts';
import type { CarryChapter, CarryWorld, SectionPath } from './mechanics/carry.ts';
import { clueFindings, reachFindings } from './mechanics/clues.ts';
import { CONDITIONS_LINT, condFindings } from './mechanics/conditions.ts';
import type { CondSite } from './mechanics/conditions.ts';
import { MECHANIC_LINTS, MECHANIC_TEXTS } from './mechanics/index.ts';
import type { MechanicLintCode, WorldLint, WorldLintInput } from './mechanics/index.ts';
import type { ModuleText, TextRegistry, TextWalker } from './mechanics/texts.ts';
import { playChapter } from './playthrough.ts';
import { checkSection } from './softlock.ts';
import { PUZZLE_LINTS } from './puzzles/index.ts';
import type { PuzzleLintCode, PuzzleTypeLint } from './puzzles/index.ts';
import { MAX_ANSWER_LEN, answerLenFindings, answerLenIssues } from './puzzles/shape.ts';
import { fixWorldIds } from './fix.ts';
import { buildFlow, crossCheck } from './shots/flow.ts';
import { decodeWorldFile, lintWorld, worldLines } from './world.ts';
import type { SectionReport, VarLiteral } from './world.ts';

function readRepoJson(path: string): unknown {
  const text = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  return JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text);
}

function committedCatalog(): AssetCatalog {
  const catalog = decodeAssetCatalog(readRepoJson('assets/catalog.json'));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  return catalog.value;
}

const CATALOG = committedCatalog();
const CH1: SourceChapter = { id: 'ch1' as ChapterId, paid: false, entry: 'ch1/main.ink' }; // a fixture chapter id
const FILE = 'story/ch1/world.json';
/** The demo's effect knots: an exit's leave and the two events. */
const KNOTS: ReadonlySet<KnotName> = new Set(['manor_out', 'manor_gate_forced', 'manor_cellar_voice'] as KnotName[]); // fixture knot names

// ---------------------------------------------------------------------------------------------------------------
// Fixture builders

type Json = Record<string, unknown>;
let counter = 0;

/** A world text whose ID is unique within the fixture being built (the knot part is its owner). */
function t(owner: string, ru: string): Json {
  return { id: `ch1.${owner}.${(counter++).toString(36).padStart(4, '0')}`, ru };
}

const MEDALS = ['medal_sun', 'medal_moon', 'medal_star'];

function demoExit(id: string, rect: number[], to: Json): Json {
  return { id, kind: 'exit', rect, label: t('manor', `Дверь ${id}`), to, lock: null, sfx: 'door' };
}

/**
 * The demo manor of PUZZLES-PLAN "World data", completed: the hall with the gate (an order puzzle over the three
 * medallions, on the gate's lock), the study with the drawer (a code puzzle on the drawer's lock, which gives the
 * moon medallion) and the cellar with its voice event. Every rect is in the safe frame, large and apart.
 */
function base(): Json {
  counter = 0;
  return {
    format: 1,
    items: {
      medal_sun: { name: t('medal_sun', 'Солнечный медальон'), desc: t('medal_sun', 'Тёплый на ощупь.'), glyph: 'sun' },
      medal_moon: { name: t('medal_moon', 'Лунный медальон'), desc: t('medal_moon', 'Холодный и гладкий.'), glyph: 'moon' },
      medal_star: { name: t('medal_star', 'Звёздный медальон'), desc: t('medal_star', 'С пятью лучами.'), glyph: 'star' },
    },
    docs: {
      letter: { title: t('letter', 'Письмо'), body: [t('letter', 'Дом построили в 1847 году.')] },
      diary: { title: t('diary', 'Дневник'), body: [t('diary', 'Сначала луна, потом солнце.')] },
    },
    puzzles: {
      drawer: {
        type: 'code',
        title: t('drawer', 'Ящик стола'),
        prompt: t('drawer', 'Четыре латунных диска.'),
        closeup: 'drawer',
        params: { dials: 4 },
        maxAttempts: null,
        giveUp: false,
        solution: [1, 8, 4, 7],
        hints: [t('drawer', 'Год упоминается в письме.'), t('drawer', 'Перечитайте письмо из кабинета.'), t('drawer', 'Код: один, восемь, четыре, семь.')],
        clues: [{ doc: 'letter' }],
      },
      gate: {
        type: 'order',
        title: t('gate', 'Ворота'),
        prompt: t('gate', 'Три углубления в камне.'),
        closeup: null,
        params: { pieces: [...MEDALS] },
        maxAttempts: 3,
        giveUp: false,
        solution: [1, 0, 2],
        hints: [t('gate', 'Порядок записан в дневнике.'), t('gate', 'Луна идёт перед солнцем.'), t('gate', 'Луна, солнце, звезда.')],
        clues: [{ examined: 'hall.inscription' }],
      },
    },
    sections: {
      manor: {
        start: 'hall',
        bgm: 'tension',
        rooms: {
          hall: {
            bg: 'hall',
            title: t('manor', 'Холл'),
            onEnter: [],
            hotspots: [
              demoExit('to_study', [80, 900, 220, 520], { room: 'study' }),
              {
                id: 'gate',
                kind: 'exit',
                rect: [380, 700, 320, 700],
                label: t('manor', 'Ворота'),
                to: { story: 'manor_out' },
                lock: {
                  slots: MEDALS.map((accepts) => ({ accepts })),
                  puzzle: 'gate',
                  locked: t('manor', 'Три пустых углубления.'),
                  onOpen: [],
                  onFail: [{ story: 'manor_gate_forced' }, { unlock: 'hall.gate' }],
                },
                sfx: 'door',
              },
              { id: 'inscription', kind: 'look', rect: [400, 400, 280, 200], label: t('manor', 'Надпись'), look: t('manor', 'Солнце, луна, звезда.'), then: [] },
              demoExit('to_cellar', [760, 900, 220, 520], { room: 'cellar' }),
            ],
          },
          study: {
            bg: 'study',
            title: t('manor', 'Кабинет'),
            onEnter: [],
            hotspots: [
              { id: 'medal', kind: 'take', rect: [100, 300, 200, 200], label: t('manor', 'Медальон'), gives: { item: 'medal_sun' }, prop: 'medal_sun', then: [] },
              {
                id: 'drawer',
                kind: 'object',
                rect: [400, 1000, 300, 300],
                label: t('manor', 'Ящик'),
                lock: { slots: [], puzzle: 'drawer', locked: t('manor', 'Ящик заперт.'), onOpen: [], onFail: [] },
                then: [{ give: 'medal_moon' }],
                look: null,
                prop: null,
              },
              { id: 'letter', kind: 'take', rect: [700, 300, 200, 200], label: t('manor', 'Письмо'), gives: { doc: 'letter' }, prop: 'note', then: [] },
              demoExit('to_hall', [80, 1500, 300, 200], { room: 'hall' }),
            ],
          },
          cellar: {
            bg: 'cellar',
            title: t('manor', 'Подвал'),
            onEnter: [{ story: 'manor_cellar_voice' }],
            hotspots: [
              { id: 'star', kind: 'take', rect: [100, 300, 200, 200], label: t('manor', 'Медальон'), gives: { item: 'medal_star' }, prop: 'medal_star', then: [] },
              { id: 'diary', kind: 'take', rect: [500, 300, 200, 200], label: t('manor', 'Дневник'), gives: { doc: 'diary' }, prop: null, then: [] },
              demoExit('to_hall', [80, 1500, 300, 200], { room: 'hall' }),
            ],
          },
        },
      },
    },
  };
}

function obj(v: unknown): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`invariant: a fixture object, got ${JSON.stringify(v)}`);
  }
  return v as Json; // checked just above: a fixture JSON object
}

function list(v: unknown): Json[] {
  if (!Array.isArray(v)) {
    throw new Error(`invariant: a fixture array, got ${JSON.stringify(v)}`);
  }
  return v as Json[]; // checked just above: fixture arrays hold objects
}

/** The object at a dotted path of a fixture's objects. */
function at(w: Json, path: string): Json {
  return path.split('.').reduce<Json>((o, key) => obj(o[key]), w);
}

function hotspots(w: Json, room: string, section = 'manor'): Json[] {
  return list(at(w, `sections.${section}.rooms.${room}`)['hotspots']);
}

function spot(w: Json, room: string, id: string, section = 'manor'): Json {
  const h = hotspots(w, room, section).find((x) => x['id'] === id);
  if (h === undefined) {
    throw new Error(`invariant: the fixture room ${room} has hotspot ${id}`);
  }
  return h;
}

/** Small worlds of the PUZZLES-PLAN triage rounds: every room bg is `room`, rects are laid out on a 3-wide grid. */
const txt = (): Json => t('w', 'Текст');
const leave = (id: string, knot = 'k'): Json => ({ id, kind: 'exit', label: txt(), to: { story: knot }, lock: null, sfx: null });
const door = (id: string, room: string, lock: Json | null = null): Json => ({ id, kind: 'exit', label: txt(), to: { room }, lock, sfx: null });
const take = (id: string, gives: Json): Json => ({ id, kind: 'take', label: txt(), gives, prop: null, then: [] });
const object = (id: string, lock: Json | null, then: Json[] = []): Json => ({ id, kind: 'object', label: txt(), lock, then, look: null, prop: null });
const lockOf = (accepts: readonly string[], puzzle: string | null = null, onFail: Json[] = []): Json => ({
  slots: accepts.map((a) => ({ accepts: a })),
  puzzle,
  locked: txt(),
  onOpen: [],
  onFail,
});
const codePuzzle = (maxAttempts: number | null = null): Json => ({
  type: 'code',
  title: txt(),
  prompt: txt(),
  closeup: null,
  params: { dials: 3 },
  maxAttempts,
  giveUp: false,
  solution: [1, 2, 3],
  hints: [],
});

type RoomSpec = Json[] | { hotspots: Json[]; onEnter: Json[] };

function mini(spec: {
  items?: readonly string[];
  docs?: readonly string[];
  puzzles?: Readonly<Record<string, Json>>;
  sections: Readonly<Record<string, { start: string; rooms: Readonly<Record<string, RoomSpec>> }>>;
}): Json {
  counter = 0;
  const named = (ids: readonly string[], body: () => Json): Json => Object.fromEntries(ids.map((id) => [id, body()]));
  const room = (r: RoomSpec): Json => {
    const { hotspots: spots, onEnter } = Array.isArray(r) ? { hotspots: r, onEnter: [] } : r;
    const laid = spots.map((h, i) => ({ ...h, rect: [100 + (i % 3) * 300, 300 + Math.floor(i / 3) * 300, 200, 200] }));
    return { bg: 'room', title: txt(), onEnter, hotspots: laid };
  };
  return {
    format: 1,
    items: named(spec.items ?? [], () => ({ name: txt(), desc: txt(), glyph: 'key' })),
    docs: named(spec.docs ?? [], () => ({ title: txt(), body: [txt()] })),
    puzzles: spec.puzzles ?? {},
    sections: Object.fromEntries(
      Object.entries(spec.sections).map(([id, s]) => [id, { start: s.start, bgm: null, rooms: Object.fromEntries(Object.entries(s.rooms).map(([rid, r]) => [rid, room(r)])) }]),
    ),
  };
}

type LintOptions = {
  knots?: ReadonlySet<KnotName> | null;
  yielded?: ReadonlySet<PuzzleLocalId> | null;
  declared?: Readonly<Record<string, VarLiteral>>;
};

/** The world as story/ch1/world.json (two-space JSON), decoded and linted the way the story gate runs them. */
function run(w: Json, opts: LintOptions = {}): { findings: Finding[]; sections: SectionReport[] } {
  const text = `${JSON.stringify(w, null, 2)}\n`;
  const decoded = decodeWorldFile({ file: FILE, text });
  if (decoded.world === null) {
    return { findings: decoded.findings, sections: [] };
  }
  const r = lintWorld({
    chapter: CH1,
    file: FILE,
    text,
    world: decoded.world,
    catalog: CATALOG,
    knots: opts.knots === undefined ? KNOTS : opts.knots,
    yielded: opts.yielded ?? null,
    declared: new Map(Object.entries(opts.declared ?? {}) as Array<[VarName, VarLiteral]>), // fixture VAR names
  });
  return { findings: [...decoded.findings, ...r.findings], sections: r.sections };
}

function lint(w: Json, opts: LintOptions = {}): Finding[] {
  return run(w, opts).findings;
}

function of(findings: readonly Finding[], code: Finding['code']): Finding[] {
  return findings.filter((f) => f.code === code);
}

function errors(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.severity === 'E');
}

// ---------------------------------------------------------------------------------------------------------------
// C1: the world lint (PUZZLES-PLAN "Lint codes")

test('world: a clean world raises no finding', () => {
  const r = run(base(), { declared: { pz_drawer: 'int', pz_gate_hints: 'int', it_medal_sun: 'bool', dc_letter: 'bool' } });
  expect(r.findings).toEqual([]);
  expect(r.sections).toEqual([{ section: 'manor', rooms: 3, states: expect.any(Number) as number, ok: true }]);
  expect(r.sections[0]?.states ?? 0).toBeGreaterThan(0);
});

test('lint: world/schema red on fixture', () => {
  const w = base();
  at(w, 'sections.manor.rooms.hall')['onenter'] = [];
  delete at(w, 'sections.manor.rooms.study')['title'];
  const found = of(lint(w), 'world/schema');
  // Every issue, never the first only.
  expect(found.map((f) => f.message).sort()).toEqual([
    'sections.manor.rooms.hall.onenter: unknown key (expected bg, title, onEnter, hotspots, refuse, decor, view, device)',
    'sections.manor.rooms.study.title: missing',
  ]);
  expect(found.every((f) => f.severity === 'E' && f.file === FILE && f.line > 0)).toBe(true);
  expect(of(lint({ ...base(), format: 2 }), 'world/schema')).toHaveLength(1);
});

test('lint: world/duplicate-id red on fixture', () => {
  const w = base();
  const out = { ...leave('out', 'manor_out'), rect: [100, 300, 200, 200] };
  obj(w['sections'])['garden'] = { start: 'hall', bgm: null, rooms: { hall: { bg: 'hall', title: t('garden', 'Холл'), onEnter: [], hotspots: [out] } } };
  expect(of(lint(w), 'world/duplicate-id')).toEqual([expect.objectContaining({ severity: 'E', message: expect.stringContaining("room 'hall' is defined in sections manor and garden") })]);
});

test('lint: world/id-reserved red on fixture', () => {
  const w = base();
  const puzzles = obj(w['puzzles']);
  puzzles['drawer_hints'] = puzzles['drawer'];
  delete puzzles['drawer'];
  obj(spot(w, 'study', 'drawer')['lock'])['puzzle'] = 'drawer_hints';
  expect(of(lint(w), 'world/id-reserved')).toEqual([expect.objectContaining({ message: expect.stringContaining("puzzle id 'drawer_hints' ends in _hints") })]);
});

test('lint: world/unknown-asset red on fixture', () => {
  const w = base();
  at(w, 'sections.manor.rooms.hall')['bg'] = 'nowhere';
  spot(w, 'study', 'medal')['prop'] = 'ghost_prop';
  obj(at(w, 'puzzles.drawer'))['closeup'] = 'ghost_cg';
  at(w, 'sections.manor')['bgm'] = 'ghost_track';
  spot(w, 'hall', 'to_study')['sfx'] = 'ghost_sfx';
  const found = of(lint(w), 'world/unknown-asset');
  expect(found.map((f) => f.message).sort()).toEqual([
    "bg 'nowhere' is not in assets/catalog.json",
    "bgm 'ghost_track' is not in assets/catalog.json",
    "close-up cg 'ghost_cg' is not in assets/catalog.json",
    "prop 'ghost_prop' is not in assets/catalog.json",
    "sfx 'ghost_sfx' is not in assets/catalog.json",
  ]);
  // A finding points at the line of its key.
  const text = JSON.stringify(w, null, 2);
  const prop = found.find((f) => f.message.startsWith('prop '));
  expect(text.split(String.fromCharCode(10))[(prop?.line ?? 0) - 1]).toContain('"prop": "ghost_prop"');
});

test('lint: world/unknown-ref red on fixture', () => {
  const w = base();
  hotspots(w, 'cellar').push(
    {
      id: 'chest',
      kind: 'object',
      rect: [500, 900, 200, 200],
      label: t('manor', 'Сундук'),
      lock: { slots: [{ accepts: 'ghost_item' }], puzzle: 'ghost_puzzle', locked: t('manor', 'Заперт.'), onOpen: [], onFail: [] },
      then: [{ unlock: 'hall.ghost' }, { story: 'ghost_knot' }],
      look: null,
      prop: null,
    },
    { id: 'scroll', kind: 'take', rect: [800, 900, 180, 200], label: t('manor', 'Свиток'), gives: { doc: 'ghost_doc' }, prop: null },
    demoExit('to_attic', [500, 1200, 200, 200], { room: 'attic' }),
  );
  const messages = of(lint(w), 'world/unknown-ref').map((f) => f.message);
  for (const what of ["item 'ghost_item'", "doc 'ghost_doc'", "puzzle 'ghost_puzzle'", "room 'attic'", "hotspot 'hall.ghost'", "knot 'ghost_knot'"]) {
    expect(messages.filter((m) => m.startsWith(what)), `${what} in ${JSON.stringify(messages)}`).toHaveLength(1);
  }
  // Effect knots are judged only against a compiled chapter's knots.
  expect(of(lint(w, { knots: null }), 'world/unknown-ref').map((f) => f.message).filter((m) => m.includes('ghost_knot'))).toEqual([]);
});

test('lint: world/one-way-exit red on fixture', () => {
  const w = base();
  const cellar = at(w, 'sections.manor.rooms.cellar');
  cellar['hotspots'] = hotspots(w, 'cellar').filter((h) => h['id'] !== 'to_hall');
  expect(of(lint(w), 'world/one-way-exit')).toEqual([expect.objectContaining({ message: 'exit hall.to_cellar leads to room cellar, which has no exit back to hall' })]);
});

test('lint: world/one-way-exit refuses a plain one-way exit out of a room that has a view', () => {
  const w = base();
  const cellar = at(w, 'sections.manor.rooms.cellar');
  cellar['hotspots'] = hotspots(w, 'cellar').filter((h) => h['id'] !== 'to_hall');
  // The hall zooms into its nook: the exemption is keyed on the exit's target being a view, never on its source room
  // having one (G1), so the hall's plain exit into the cellar is still one-way.
  hotspots(w, 'hall').push(demoExit('to_nook', [400, 600, 300, 300], { room: 'nook' }));
  at(w, 'sections.manor.rooms')['nook'] = { bg: 'room', title: t('manor', 'Ниша'), onEnter: [], hotspots: [], view: { of: 'hall' } };
  expect(of(lint(w), 'world/one-way-exit')).toEqual([expect.objectContaining({ message: 'exit hall.to_cellar leads to room cellar, which has no exit back to hall' })]);
});

test('lint: world/one-way-exit spares an exit into a view at either depth', () => {
  const w = base();
  // The study zooms into its desk, and the desk into its drawer: a depth-2 tree whose views have no exit back. A view
  // leaves by `leave-view` (always open), and a view of a view cannot have an exit back to its parent view
  // (`world/view-entry`), so neither exit is one-way.
  hotspots(w, 'study').push(demoExit('to_desk', [400, 600, 300, 300], { room: 'desk' }));
  const rooms = at(w, 'sections.manor.rooms');
  rooms['desk'] = { bg: 'room', title: t('manor', 'Стол'), onEnter: [], hotspots: [demoExit('to_drawer', [400, 600, 300, 300], { room: 'drawer' })], view: { of: 'study' } };
  rooms['drawer'] = { bg: 'room', title: t('manor', 'Ящик'), onEnter: [], hotspots: [], view: { of: 'desk' } };
  expect(errors(lint(w))).toEqual([]);
});

test('lint: world/hotspot-frame red on fixture', () => {
  const w = base();
  spot(w, 'hall', 'inscription')['rect'] = [0, 100, 280, 200];
  expect(of(lint(w), 'world/hotspot-frame')).toEqual([expect.objectContaining({ severity: 'E', message: expect.stringMatching(/^hall\.inscription \[0, 100, 280, 200\] leaves the safe frame/) })]);
});

test('lint: world/hotspot-small red on fixture', () => {
  const w = base();
  spot(w, 'hall', 'inscription')['rect'] = [400, 400, 100, 100];
  expect(of(lint(w), 'world/hotspot-small')).toEqual([expect.objectContaining({ severity: 'W', message: expect.stringMatching(/^hall\.inscription is 100×100/) })]);
});

test('lint: world/hotspot-overlap red on fixture', () => {
  const w = base();
  spot(w, 'hall', 'inscription')['rect'] = [400, 750, 280, 200];
  expect(of(lint(w), 'world/hotspot-overlap')).toEqual([expect.objectContaining({ severity: 'W', message: 'hall.inscription overlaps hall.gate' })]);
});

test('lint: world/props-per-room red on fixture', () => {
  const w = base();
  const extra = Array.from({ length: 9 }, (_, i) => ({ ...object(`vase${i}`, null), rect: [100 + (i % 3) * 300, 600 + Math.floor(i / 3) * 250, 200, 200], prop: 'note' }));
  at(w, 'sections.manor.rooms.cellar')['hotspots'] = [...hotspots(w, 'cellar').filter((h) => h['id'] === 'to_hall'), ...extra];
  expect(of(lint(w), 'world/props-per-room')).toEqual([expect.objectContaining({ message: 'room cellar shows 9 props: at most 8' })]);
});

test('lint: world/solution red on fixture', () => {
  const w = base();
  at(w, 'puzzles.drawer')['solution'] = [1, 8, 4];
  expect(of(lint(w), 'world/solution')).toEqual([expect.objectContaining({ message: "puzzle 'drawer': length 3, expected 4" })]);
  expect(of(lint(w), 'world/solution-initial')).toEqual([]);
});

test('lint: world/solution-initial red on fixture', () => {
  const w = base();
  at(w, 'puzzles.drawer')['solution'] = [0, 0, 0, 0];
  at(w, 'puzzles.gate')['solution'] = [0, 1, 2];
  const found = of(lint(w), 'world/solution-initial');
  expect(found.map((f) => f.message).sort()).toEqual([
    "puzzle 'drawer': the solution [0, 0, 0, 0] is the initial state (X17)",
    "puzzle 'gate': the solution [0, 1, 2] is the initial state (X17)",
  ]);
  expect(of(lint(w), 'world/solution')).toEqual([]);
});

test('lint: world/order-pieces red on fixture', () => {
  const w = base();
  obj(spot(w, 'hall', 'gate')['lock'])['slots'] = [{ accepts: 'medal_sun' }, { accepts: 'medal_moon' }];
  expect(of(lint(w), 'world/order-pieces')).toEqual([
    expect.objectContaining({ message: "lock hall.gate: order puzzle 'gate' has pieces [medal_sun, medal_moon, medal_star], the slots accept [medal_sun, medal_moon] (X17)" }),
  ]);
});

test('lint: world/hint-count red on fixture', () => {
  const w = base();
  list(at(w, 'puzzles.drawer')['hints']).push(t('drawer', 'Четвёртая подсказка.'));
  expect(of(lint(w), 'world/hint-count')).toEqual([expect.objectContaining({ severity: 'E', message: 'puzzles.drawer.hints: 4 hints: at most 3 tiers (X18)' })]);
});

test('lint: world/title-long red on fixture', () => {
  const w = base();
  obj(at(w, 'puzzles.drawer')['title'])['ru'] = 'Ящик письменного стола';
  expect(of(lint(w), 'world/title-long')).toEqual([expect.objectContaining({ message: expect.stringMatching(/^puzzle 'drawer': the title is 22 graphemes, at most 18/) })]);
});

test('lint: world/giveup-in-section red on fixture', () => {
  const w = base();
  at(w, 'puzzles.gate')['giveUp'] = true;
  expect(of(lint(w), 'world/giveup-in-section')).toEqual([expect.objectContaining({ message: expect.stringContaining("puzzle 'gate' is the puzzle of lock hall.gate") })]);
});

test('lint: world/cross-section-item red on fixture', () => {
  const w = base();
  obj(w['items'])['key'] = { name: t('key', 'Ключ'), desc: t('key', 'Железный.'), glyph: 'key' };
  obj(w['sections'])['garden'] = {
    start: 'yard',
    bgm: null,
    rooms: { yard: { bg: 'room', title: t('garden', 'Двор'), onEnter: [], hotspots: [{ ...take('key', { item: 'key' }), rect: [100, 300, 200, 200] }, { ...leave('out', 'manor_out'), rect: [500, 300, 200, 200] }] } },
  };
  hotspots(w, 'hall').push({ ...door('shed', 'study'), to: { story: 'manor_out' }, rect: [400, 1500, 300, 200], lock: lockOf(['key']) });
  expect(of(lint(w), 'world/cross-section-item')).toEqual([
    expect.objectContaining({ message: "item 'key' is obtained in section garden and required by lock hall.shed of section manor (X15)" }),
  ]);
});

/** PUZZLES-PLAN round-4 triage: a courtyard lever that unlocks the tower's gate, two sections joined by leaves. */
function leverWorld(): Json {
  return mini({
    sections: {
      courtyard: { start: 'yard', rooms: { yard: [object('lever', null, [{ unlock: 'hall.gate' }]), leave('to_tower', 'to_tower')] } },
      tower: {
        start: 'hall',
        rooms: { hall: [door('gate', 'vault', lockOf([])), leave('out', 'to_courtyard')], vault: [door('to_hall', 'hall'), leave('exit', 'ending')] },
      },
    },
  });
}

test('lint: world/cross-section-effect red on fixture', () => {
  // An unlock: without the rule the only finding is the W on vault (PP:3660); with it, the lever is reported.
  const unlock = lint(leverWorld(), { knots: null });
  expect(of(unlock, 'world/cross-section-effect')).toEqual([expect.objectContaining({ message: 'yard.lever then (section courtyard) unlocks hall.gate of section tower (X15: a trigger writes only its own section)' })]);
  expect(unlock.filter((f) => f.code !== 'world/cross-section-effect').map((f) => `${f.severity} ${f.code} ${f.message}`)).toEqual([
    'W world/unreachable room vault: no reachable state of section tower enters it',
  ]);
  // A give: one document given by a take in each of two sections.
  const give = mini({
    docs: ['letter'],
    sections: {
      a: { start: 'ra', rooms: { ra: [take('letter', { doc: 'letter' }), leave('out')] } },
      b: { start: 'rb', rooms: { rb: [take('letter', { doc: 'letter' }), leave('out')] } },
    },
  });
  expect(lint(give, { knots: null })).toEqual([expect.objectContaining({ code: 'world/cross-section-effect', message: "doc 'letter' is given in section b and in section a (X15: a gift belongs to one section)" })]);
});

test('lint: world/cross-section-effect allows a cross-room unlock inside a section', () => {
  // The same lever and gate in two rooms of one section.
  const w = mini({
    sections: {
      s: {
        start: 'yard',
        rooms: {
          yard: [object('lever', null, [{ unlock: 'hall.gate' }]), door('to_hall', 'hall'), leave('out')],
          hall: [door('to_yard', 'yard'), door('gate', 'vault', lockOf([]))],
          vault: [door('to_hall', 'hall'), leave('exit', 'ending')],
        },
      },
    },
  });
  expect(of(lint(w, { knots: null }), 'world/cross-section-effect')).toEqual([]);
  expect(lint(w, { knots: null })).toEqual([]);
});

test('lint: world/puzzle-multi-lock red on fixture', () => {
  // Across sections: the round-5 triage's keypad on courtyard's shed and on tower's gate.
  const across = mini({
    puzzles: { keypad: { ...codePuzzle(), clues: [{ visited: 'yard' }] } },
    sections: {
      courtyard: { start: 'yard', rooms: { yard: [object('shed', lockOf([], 'keypad')), leave('to_tower', 'to_tower')] } },
      tower: {
        start: 'hall',
        rooms: { hall: [door('gate', 'vault', lockOf([], 'keypad')), leave('out', 'to_courtyard')], vault: [door('to_hall', 'hall'), leave('exit', 'ending')] },
      },
    },
  });
  const a = lint(across, { knots: null });
  expect(errors(a)).toEqual([expect.objectContaining({ code: 'world/puzzle-multi-lock', message: "puzzle 'keypad' is the puzzle of 2 locks: yard.shed, hall.gate (X15: one lock per puzzle)" })]);
  // Within one section: two zero-slot object locks beside a lock-free leave.
  const within = mini({ puzzles: { keypad: { ...codePuzzle(), clues: [{ visited: 'r' }] } }, sections: { s: { start: 'r', rooms: { r: [object('a', lockOf([], 'keypad')), object('b', lockOf([], 'keypad')), leave('out')] } } } });
  expect(errors(lint(within, { knots: null }))).toEqual([expect.objectContaining({ code: 'world/puzzle-multi-lock', message: expect.stringContaining('2 locks: r.a, r.b') })]);
});

test('lint: world/puzzle-multi-lock allows one puzzle on one lock', () => {
  expect(of(lint(base()), 'world/puzzle-multi-lock')).toEqual([]);
});

/** PUZZLES-PLAN round-6 triage: an arch from courtyard's yard into tower's hall, above tower's pit. */
function archWorld(): Json {
  return mini({
    items: ['rope'],
    sections: {
      courtyard: { start: 'yard', rooms: { yard: [door('arch', 'hall'), leave('leave')] } },
      tower: {
        start: 'foyer',
        rooms: {
          foyer: [leave('out')],
          hall: [door('to_yard', 'yard'), take('coil', { item: 'rope' }), object('lever', null, [{ unlock: 'hall.down' }]), door('down', 'pit', lockOf([]))],
          pit: [door('up', 'hall', lockOf(['rope']))],
        },
      },
    },
  });
}

test('lint: world/cross-section-exit red on fixture', () => {
  let found: Finding[] = [];
  expect(() => {
    found = lint(archWorld(), { knots: null });
  }).not.toThrow();
  expect(errors(found).map((f) => `${f.code} ${f.message}`)).toEqual([
    'world/cross-section-exit exit yard.arch leads to room hall of section tower, not of its own section courtyard (X15)',
    'world/cross-section-exit exit hall.to_yard leads to room yard of section courtyard, not of its own section tower (X15)',
  ]);
});

test('lint: world/cross-section-exit allows a room→room exit inside one section', () => {
  const w = mini({
    sections: {
      s: { start: 'a', rooms: { a: [door('to_b', 'b'), leave('out')], b: [door('to_a', 'a')] } },
      t: { start: 'c', rooms: { c: [leave('out')] } },
    },
  });
  expect(of(lint(w, { knots: null }), 'world/cross-section-exit')).toEqual([]);
  expect(errors(lint(w, { knots: null }))).toEqual([]);
});

test('lint: world/fail-without-effect red on fixture', () => {
  const w = base();
  obj(spot(w, 'hall', 'gate')['lock'])['onFail'] = [];
  expect(of(lint(w), 'world/fail-without-effect')).toEqual([expect.objectContaining({ message: "lock hall.gate: puzzle 'gate' has maxAttempts 3 and the lock has no onFail effect" })]);
});

test('lint: world/var-type red on fixture', () => {
  const found = of(lint(base(), { declared: { pz_drawer: 'bool', it_medal_sun: 'int', pz_gate: 'int', g_trust: 'bool' } }), 'world/var-type');
  expect(found.map((f) => f.message).sort()).toEqual(['VAR it_medal_sun is declared int: the projection writes a bool (X2)', 'VAR pz_drawer is declared bool: the projection writes an int (X2)']);
});

test('story: fl_<flag> is a bool projection', () => {
  // Module `flags` (engine plan §6.5): `fl_<f>` is written as a bool, so a VAR declared int is refused at the flag's
  // declaration; an undeclared flag's VAR is no projection.
  const w = base();
  w['flags'] = { f: { section: 'manor' } };
  const found = of(lint(w, { declared: { fl_f: 'int', fl_g: 'int' } }), 'world/var-type');
  expect(found.map((f) => [f.line, f.message])).toEqual([[jsonLine(w, '"f": {'), 'VAR fl_f is declared int: the projection writes a bool (X2)']]);
  // The positive control: declared bool, no finding.
  expect(of(lint(w, { declared: { fl_f: 'bool' } }), 'world/var-type')).toEqual([]);
});

/** A lock whose third medallion sits behind that same lock; the hall's hatch, which takes the moon, is the other way out. */
function softlockWorld(section = 's'): Json {
  return mini({
    items: MEDALS,
    sections: {
      [section]: {
        start: 'hall',
        rooms: {
          hall: [take('sun', { item: 'medal_sun' }), take('moon', { item: 'medal_moon' }), door('gate', 'vault', lockOf(MEDALS)), { ...leave('hatch'), lock: lockOf(['medal_moon']) }],
          vault: [take('star', { item: 'medal_star' }), door('back', 'hall'), leave('out')],
        },
      },
    },
  });
}

test('lint: world/softlock red on fixture', () => {
  const r = run(softlockWorld(), { knots: null });
  const [f] = of(r.findings, 'world/softlock');
  expect(f).toMatchObject({ severity: 'E', file: FILE });
  // The counterexample: the moon wasted in the gate, which the star behind it can never open.
  expect(f?.message).toBe('section s: a reachable state cannot reach a leave (stuck in hall): tap hall.moon → insert hall.gate medal_moon');
  expect(f?.line).toBeGreaterThan(0);
  expect(r.sections).toEqual([{ section: 's', rooms: 2, states: expect.any(Number) as number, ok: false }]);
});

test('lint: world/unreachable red on fixture', () => {
  const w = base();
  obj(w['docs'])['map'] = { title: t('map', 'Карта'), body: [t('map', 'Старая карта.')] };
  obj(w['puzzles'])['riddle'] = { ...codePuzzle(), title: t('riddle', 'Загадка'), prompt: t('riddle', 'Три цифры.') };
  const found = of(lint(w, { yielded: new Set() }), 'world/unreachable');
  expect(found.map((f) => `${f.severity} ${f.message}`)).toEqual([
    "W doc 'map': no reachable state finds it",
    "W puzzle 'riddle': no lock carries it and no puzzle tag of ch1 yields it",
  ]);
  // A linear puzzle some tag yields is reachable; without the yields it is not judged.
  expect(of(lint(w, { yielded: new Set(['riddle'] as PuzzleLocalId[]) }), 'world/unreachable')).toHaveLength(1);
  expect(of(lint(w), 'world/unreachable')).toHaveLength(1);
});

test('lint: world/state-cap red on fixture', () => {
  // 13 documents in one room: 2^13 = 8,192 states, above RESUME_STATE_CAP, every one with an open way out.
  const docs = Array.from({ length: 13 }, (_, i) => `d${i}`);
  const w = mini({ docs, sections: { s: { start: 'hall', rooms: { hall: [leave('out'), ...docs.map((d) => take(d, { doc: d }))] } } } });
  const r = run(w, { knots: null });
  expect(errors(r.findings).map((f) => f.code)).toEqual(['world/state-cap']);
  // A capped section is not judged for what it never touched.
  expect(of(r.findings, 'world/unreachable')).toEqual([]);
  expect(r.sections).toEqual([{ section: 's', rooms: 1, states: null, ok: false }]);
});

test('lint: id/missing red on fixture (world)', () => {
  const w = base();
  delete obj(at(w, 'sections.manor.rooms.hall')['title'])['id'];
  delete obj(list(at(w, 'puzzles.drawer')['hints'])[1])['id'];
  const found = of(lint(w), 'id/missing');
  expect(found.map((f) => f.message).sort()).toEqual([
    'puzzles.drawer.hints.1.id: missing: every world text carries a line ID (STAGING-DSL §4)',
    'sections.manor.rooms.hall.title.id: missing: every world text carries a line ID (STAGING-DSL §4)',
  ]);
  expect(of(lint(w), 'world/hint-count')).toEqual([]);
});

test('lint: id/format red on fixture (world)', () => {
  const w = base();
  obj(at(w, 'sections.manor.rooms.hall')['title'])['id'] = 'ch1.Manor.0000';
  expect(of(lint(w), 'id/format')).toEqual([expect.objectContaining({ message: expect.stringMatching(/^sections\.manor\.rooms\.hall\.title\.id: "ch1\.Manor\.0000" does not match/) })]);
  expect(of(lint(w), 'id/missing')).toEqual([]);
});

test('lint: id/chapter-prefix red on fixture (world)', () => {
  const w = base();
  obj(at(w, 'sections.manor.rooms.hall')['title'])['id'] = 'ch2.manor.zzzz';
  expect(of(lint(w), 'id/chapter-prefix')).toEqual([expect.objectContaining({ severity: 'E', message: "'ch2.manor.zzzz' is in a world of ch1 (§4)" })]);
});

// ---------------------------------------------------------------------------------------------------------------
// graph.ts: the yield edges (STAGING-DSL §8 "Yield edges") and the yield codes against the chapter's world

const ASSETS = assetIndex(CATALOG);
const INK_HEAD = ['INCLUDE ../common/globals.ink', '-> start', '=== start ==='];

/** The demo manor's story: hall_in yields the section; the cellar voice and the forced gate are its events, manor_out its leave. */
function manorInk(): string[] {
  return [
    ...INK_HEAD,
    'Пришли. #id:ch1.start.a001',
    '-> hall_in',
    '=== hall_in ===',
    '# scene: street',
    'Осмотримся. #id:ch1.hall_in.a002',
    '# explore: manor',
    '-> DONE',
    '=== manor_cellar_voice ===',
    'Кто здесь? #id:ch1.manor_cellar_voice.a003',
    '# explore: manor',
    '-> DONE',
    '=== manor_gate_forced ===',
    'Ворота поддались. #id:ch1.manor_gate_forced.a004',
    '# explore: manor',
    '-> DONE',
    '=== manor_out ===',
    'Мы вышли. #id:ch1.manor_out.a005',
    '-> END',
  ];
}

/** The demo world plus `cabinet`, a code puzzle on no lock: one a tag may yield. */
function withCabinet(w: Json): Json {
  obj(w['puzzles'])['cabinet'] = {
    type: 'code',
    title: t('cabinet', 'Шкаф'),
    prompt: t('cabinet', 'Три диска.'),
    closeup: 'cabinet',
    params: { dials: 3 },
    maxAttempts: null,
    giveUp: false,
    solution: [3, 1, 4],
    hints: [],
  };
  return w;
}

/** A fixture world as the graph's world input: decoded the way the story gate decodes it, then made public. */
function okWorld(w: Json): WorldRef {
  const decoded = decodeWorldFile({ file: FILE, text: `${JSON.stringify(w, null, 2)}\n` });
  if (decoded.world === null) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(decoded.findings)}`);
  }
  return { kind: 'ok', body: { ...toPublic(decoded.world), mods: decoded.world.mods } };
}

/** Compiles `main` as ch1 (the fixture must compile cleanly) and builds its graph against `world` (default none). */
function graphWith(main: readonly string[], world?: WorldRef): { graph: ChapterGraph; findings: Finding[]; facts: GraphFacts } {
  const files = new Map([
    [GLOBALS_PATH, 'VAR g_trust = 0\n'],
    ['ch1/main.ink', `${main.join('\n')}\n`],
  ]);
  const r = compileChapter(CH1, (key) => files.get(key) ?? null);
  expect(r.findings, `fixture compiles: ${JSON.stringify(r.findings)}`).toEqual([]);
  if (r.compiled === null) {
    throw new Error('invariant: a fixture with no findings compiled');
  }
  return buildGraph({ chapter: CH1, files: r.compiled.files, sources: files, assets: ASSETS, world });
}

/** The findings of `code` as `file:line: message`. */
function sited(findings: readonly Finding[], code: LintCode): string[] {
  return of(findings, code).map((f) => `${f.file}:${f.line}: ${f.message}`);
}

/** The 1-based line of `text` in a fixture's lines. */
function lineIn(main: readonly string[], text: string): number {
  const i = main.indexOf(text);
  if (i < 0) {
    throw new Error(`invariant: fixture line '${text}' exists`);
  }
  return i + 1;
}

/** A chapter whose start yields `tag`, with an `after` knot that ends it. */
function yielding(tag: string): string[] {
  return [...INK_HEAD, 'Ящик. #id:ch1.start.a001', tag, '-> DONE', '=== after ===', 'Готово. #id:ch1.after.a002', '-> END'];
}

test('lint: puzzle/unknown red on fixture', () => {
  const main = yielding('# puzzle: chest then=after');
  const line = lineIn(main, '# puzzle: chest then=after');
  expect(sited(graphWith(main, okWorld(withCabinet(base()))).findings, 'puzzle/unknown')).toEqual([
    `ch1/main.ink:${line}: puzzle 'chest' is not in story/ch1/world.json`,
  ]);
  // No world at all: the id is not in the chapter's world either (D6).
  expect(sited(graphWith(main).findings, 'puzzle/unknown')).toEqual([`ch1/main.ink:${line}: puzzle 'chest': ch1 has no world (story/ch1/world.json)`]);
  // A world that failed world/schema is not judged; a puzzle the world has is green.
  expect(of(graphWith(main, { kind: 'invalid' }).findings, 'puzzle/unknown')).toEqual([]);
  expect(graphWith(yielding('# puzzle: cabinet then=after'), okWorld(withCabinet(base()))).findings).toEqual([]);
});

test('lint: puzzle/then-unknown red on fixture', () => {
  const main = yielding('# puzzle: cabinet then=nowhere');
  const line = lineIn(main, '# puzzle: cabinet then=nowhere');
  const expected = [`ch1/main.ink:${line}: 'then=nowhere' names no knot of ch1`];
  // `then=` never depends on the world (D6).
  expect(sited(graphWith(main, okWorld(withCabinet(base()))).findings, 'puzzle/then-unknown')).toEqual(expected);
  expect(sited(graphWith(main, { kind: 'invalid' }).findings, 'puzzle/then-unknown')).toEqual(expected);
  expect(sited(graphWith(main).findings, 'puzzle/then-unknown')).toEqual(expected);
  expect(of(graphWith(yielding('# puzzle: cabinet then=after')).findings, 'puzzle/then-unknown')).toEqual([]);
});

test('lint: puzzle/in-section red on fixture', () => {
  // The gate's order puzzle sits on the hall gate's lock: it opens from its room, never from a yield.
  const main = yielding('# puzzle: gate then=after');
  const line = lineIn(main, '# puzzle: gate then=after');
  expect(of(graphWith(main, okWorld(base())).findings, 'puzzle/in-section')).toEqual([
    {
      code: 'puzzle/in-section',
      severity: 'E',
      file: 'ch1/main.ink',
      line,
      message: "puzzle 'gate' is yielded here and is the puzzle of lock hall.gate: a lock's puzzle opens from its room (PUZZLES-PLAN §8)",
    },
  ]);
  expect(of(graphWith(main, okWorld(base())).findings, 'puzzle/unknown')).toEqual([]);
  expect(of(graphWith(yielding('# puzzle: cabinet then=after'), okWorld(withCabinet(base()))).findings, 'puzzle/in-section')).toEqual([]);
});

test('lint: explore/unknown-section red on fixture', () => {
  const main = yielding('# explore: garden');
  const line = lineIn(main, '# explore: garden');
  expect(sited(graphWith(main, okWorld(base())).findings, 'explore/unknown-section')).toEqual([
    `ch1/main.ink:${line}: section 'garden' is not in story/ch1/world.json`,
  ]);
  expect(sited(graphWith(main).findings, 'explore/unknown-section')).toEqual([
    `ch1/main.ink:${line}: explore 'garden': ch1 has no world (story/ch1/world.json)`,
  ]);
  expect(of(graphWith(main, { kind: 'invalid' }).findings, 'explore/unknown-section')).toEqual([]);
  expect(of(graphWith(manorInk(), okWorld(base())).findings, 'explore/unknown-section')).toEqual([]);
});

test('lint: explore/event-return red on fixture', () => {
  // The cellar voice runs and stops without handing control back to the rooms.
  const main = manorInk();
  main.splice(lineIn(main, 'Кто здесь? #id:ch1.manor_cellar_voice.a003'), 1);
  const header = lineIn(main, '=== manor_cellar_voice ===');
  expect(sited(graphWith(main, okWorld(base())).findings, 'explore/event-return')).toEqual([
    `ch1/main.ink:${header}: event knot 'manor_cellar_voice' of section manor never yields '# explore: manor' back to the rooms (§6)`,
  ]);
  // E1 -> E2, where E2 yields: the closure over the section's event knots returns (D7), and nothing escapes.
  const chained = manorInk();
  chained.splice(lineIn(chained, 'Кто здесь? #id:ch1.manor_cellar_voice.a003'), 2, '-> manor_gate_forced');
  const g = graphWith(chained, okWorld(base()));
  expect(g.graph.knots.get('manor_cellar_voice' as KnotName)?.next).toEqual(['manor_gate_forced']);
  expect(g.findings).toEqual([]);
});

test('lint: explore/event-escape red on fixture', () => {
  // The cellar voice ends the story; the forced gate diverts out of the section's event knots.
  const main = manorInk();
  main.splice(lineIn(main, 'Кто здесь? #id:ch1.manor_cellar_voice.a003'), 2, '-> END');
  main.splice(lineIn(main, 'Ворота поддались. #id:ch1.manor_gate_forced.a004'), 2, '-> hall_in');
  const voice = lineIn(main, '=== manor_cellar_voice ===');
  const gate = lineIn(main, '=== manor_gate_forced ===');
  expect(sited(graphWith(main, okWorld(base())).findings, 'explore/event-escape')).toEqual([
    `ch1/main.ink:${voice}: event knot 'manor_cellar_voice' of section manor writes '-> END': it returns with '# explore: manor' (§6)`,
    `ch1/main.ink:${gate}: event knot 'manor_gate_forced' of section manor leads to 'hall_in', which is not an event knot of manor (§6)`,
  ]);
  // A leave knot is no event knot: its `-> END` is the chapter's way on.
  expect(of(graphWith(manorInk(), okWorld(base())).findings, 'explore/event-escape')).toEqual([]);
});

test('graph: event knot carries the room stage', () => {
  // The cellar voice runs over the cellar (its bg and the star medallion's prop); the forced gate and the leave over
  // the hall. hall_in's street never flows along a section edge: a room's batch opens with its own scene.
  const g = graphWith(manorInk(), okWorld(base()));
  expect(g.graph.carried.get('manor_cellar_voice' as KnotName)).toEqual(['bg/cellar', 'prop/medal_star']);
  expect(g.graph.carried.get('manor_gate_forced' as KnotName)).toEqual(['bg/hall']);
  expect(g.graph.carried.get('manor_out' as KnotName)).toEqual(['bg/hall']);
  expect(g.findings).toEqual([]);
  // A `bg` on the event knot's opening tag lines clears the room's background and its props (STAGING-DSL §8).
  const cleared = manorInk();
  cleared.splice(lineIn(cleared, '=== manor_cellar_voice ==='), 0, '# bg: shore');
  expect(graphWith(cleared, okWorld(base())).graph.carried.get('manor_cellar_voice' as KnotName)).toEqual([]);
});

test('graph: then= knot is a successor, section knots are reachability edges only', () => {
  const manor = manorInk();
  const main = [
    ...INK_HEAD,
    'Ящик. #id:ch1.start.a001',
    '# puzzle: cabinet then=after',
    '-> DONE',
    '=== after ===',
    'Открыто. #id:ch1.after.a002',
    '# explore: manor',
    '-> DONE',
    ...manor.slice(manor.indexOf('=== manor_cellar_voice ===')),
  ];
  const g = graphWith(main, okWorld(withCabinet(base())));
  expect(g.graph.knots.get('start' as KnotName)?.next).toEqual(['after']);
  // The hub never preloads every event (K9): reachability only, so no unreachable knot, and the leave's END ends it.
  expect(g.graph.knots.get('after' as KnotName)?.next).toEqual([]);
  expect(g.findings).toEqual([]);
  expect(g.facts.yields.get('after' as KnotName)).toEqual([{ kind: 'explore', section: 'manor' }]);
  // Without the world the section knots have no edge in: unreachable, and no reachable knot writes END.
  const bare = graphWith(main);
  expect(of(bare.findings, 'graph/unreachable-knot').map((f) => f.message)).toEqual([
    "knot 'manor_cellar_voice' is not reachable from '-> start'",
    "knot 'manor_gate_forced' is not reachable from '-> start'",
    "knot 'manor_out' is not reachable from '-> start'",
  ]);
  expect(of(bare.findings, 'graph/no-end')).toHaveLength(1);
});

// ---------------------------------------------------------------------------------------------------------------
// GM1d: the module and type lint codes (engine plan §3.2), the clue lints (§7.3, I4) and the answer bound (§7.4)

type CodeTable = { readonly id: string; readonly codes: Readonly<Record<string, Severity>> };
type TypeCodeTables = Readonly<Record<string, { readonly codes: Readonly<Record<string, Severity>> }>>;

/**
 * Every clash among the lint codes of the world lint registry (per-world and story-level entries alike, R-E22) and the
 * puzzle type lint registry: a code two entries own, or a code of the DSL's table. Registries as parameters, so a
 * fixture entry shows the checker is not vacuous.
 */
function codeClashes(mechanics: readonly CodeTable[], types: TypeCodeTables, dsl: Readonly<Record<string, Severity>> = LINT_CODES): string[] {
  const owner = new Map<string, string>();
  const out: string[] = [];
  const tables = [...mechanics, ...Object.entries(types).map(([type, l]) => ({ id: `type ${type}`, codes: l.codes }))];
  for (const t of tables) {
    for (const code of Object.keys(t.codes)) {
      if (Object.hasOwn(dsl, code)) {
        out.push(`${code} is a DSL code (LINT_CODES)`);
      }
      const first = owner.get(code);
      if (first === undefined) {
        owner.set(code, t.id);
      } else {
        out.push(`${code} in ${first} and ${t.id}`);
      }
    }
  }
  return out;
}

test('story: module and type lint codes are unique and none is a DSL code', () => {
  expect(codeClashes(MECHANIC_LINTS, PUZZLE_LINTS)).toEqual([]);
  // A per-world entry repeating a DSL code; a story-level entry repeating a module's code; a type repeating one.
  const dsl: WorldLint<'world/softlock'> = { id: 'probe', codes: { 'world/softlock': 'E' }, lint: () => [] };
  expect(codeClashes([...MECHANIC_LINTS, dsl], PUZZLE_LINTS)).toEqual(['world/softlock is a DSL code (LINT_CODES)']);
  const storyLevel: WorldLint<'world/clue-declared'> = { id: 'story-pass', codes: { 'world/clue-declared': 'E' }, runsFrom: 'story' };
  expect(codeClashes([...MECHANIC_LINTS, storyLevel], PUZZLE_LINTS)).toEqual(['world/clue-declared in clues and story-pass']);
  const typed = { ...PUZZLE_LINTS, code: { ...PUZZLE_LINTS.code, codes: { 'world/clue-reachable': 'E' } } } as const;
  expect(codeClashes(MECHANIC_LINTS, typed)).toEqual(['world/clue-reachable in clues and type code']);
  // Every registered code is a Finding's code (tsc), at its own table's severity.
  const finding = (code: MechanicLintCode | PuzzleLintCode, severity: Severity): Finding => ({ code, severity, file: FILE, line: 1, message: code });
  const tables: readonly CodeTable[] = [...MECHANIC_LINTS, ...Object.values(PUZZLE_LINTS).map((l) => ({ id: 'type', codes: l.codes }))];
  // The keys of a registry entry's codes are MechanicLintCode or PuzzleLintCode by those types' definitions.
  const registered = tables.flatMap((t) => (Object.entries(t.codes) as Array<[MechanicLintCode | PuzzleLintCode, Severity]>).map(([code, s]) => finding(code, s)));
  expect(registered.map((f) => `${f.code} ${f.severity}`)).toEqual([
    'world/renamed-target E',
    'world/renamed-source E',
    'world/renamed-cycle E',
    'world/renamed-puzzles E',
    'world/clue-declared E',
    'world/reach-has-clue E',
    'world/clue-reachable E',
    'world/unique-solution E',
    'world/reach-solution E',
    'world/attempts-without-wrong E',
    'world/answer-len E',
    'world/cross-section-cond E',
    'world/visual-only-atom E',
    'world/cond-size E',
    'world/text-unwalked E',
    'world/use-unknown-ref E',
    'world/use-cross-section E',
    'world/keep-consumed W',
    'world/view-depth E',
    'world/view-section E',
    'world/view-entry E',
    'world/view-exits E',
    'world/recipe-unknown-ref E',
    'world/recipe-scope E',
    'world/flag-unknown-ref E',
    'world/flag-scope E',
    'world/view-type-site E',
    'world/device-type E',
    'world/device-parts-frame E',
    'world/device-closeup E',
    'world/device-failed-state E',
    'world/device-object E',
    'world/device-when E',
    'world/device-alone E',
    'world/device-unlock E',
    'world/device-part E',
    'world/device-hotspot-cover E',
    'world/hint-moves E',
    'world/inherit-count E',
    'world/inherit-item E',
    'world/carry-registry E',
    'world/carry-inherit E',
    'world/carry-mark E',
    'world/carry-required-path E',
    'world/carry-giver-prefix E',
    'world/carry-leave E',
    'world/carry-consumed E',
    'world/carry-tier E',
  ]);
  // The registry restates world.ts's VarLiteral (its types stay out of the app program): one type (tsc).
  type InputVar = WorldLintInput['declared'] extends ReadonlyMap<VarName, infer V> ? V : never;
  type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
  expect(true satisfies Same<VarLiteral, InputVar>).toBe(true);
});

/** The demo manor with a `renamed` map (engine plan §5.3), appended after its sections. */
function renamedBase(renamed: Json): Json {
  return { ...base(), renamed };
}

/** The `world/renamed-*` findings of a lint run. */
function renamedOf(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.code.startsWith('world/renamed-'));
}

/** The vars the clean manor's ink declares (`world: a clean world raises no finding`). */
const MANOR_VARS = { pz_drawer: 'int', pz_gate_hints: 'int', it_medal_sun: 'bool', dc_letter: 'bool' } as const;

test('story: a rename to a missing target / of a live source / in a cycle is refused', () => {
  const target = renamedBase({ items: { medal_old: 'medal_gone' } });
  expect(renamedOf(lint(target))).toEqual([
    { code: 'world/renamed-target', severity: 'E', file: FILE, line: jsonLine(target, '"medal_old"'), message: "renamed.items: 'medal_old' ends at 'medal_gone', which is not in this world (§5.3)" },
  ]);
  const source = renamedBase({ items: { medal_sun: 'medal_moon' } });
  expect(renamedOf(lint(source))).toEqual([
    {
      code: 'world/renamed-source',
      severity: 'E',
      file: FILE,
      line: jsonLine(source, '"medal_sun": "medal_moon"'),
      message: "renamed.items: 'medal_sun' is still in this world: a rename's source is an id it no longer has (§5.3)",
    },
  ]);
  // A cycle: one finding per entry, and no target finding for a chain that ends nowhere.
  const cycle = renamedBase({ docs: { old_a: 'old_b', old_b: 'old_a' } });
  const ends = (from: string): string => `renamed.docs: the chain from '${from}' returns to itself and ends at no id (§5.3)`;
  expect(renamedOf(lint(cycle))).toEqual([
    { code: 'world/renamed-cycle', severity: 'E', file: FILE, line: jsonLine(cycle, '"old_a"'), message: ends('old_a') },
    { code: 'world/renamed-cycle', severity: 'E', file: FILE, line: jsonLine(cycle, '"old_b"'), message: ends('old_b') },
  ]);
  // `fl_b` is declared nowhere here (module `flags`, GM5f): the flag target is missing. A declared target passes
  // (`story: a declared flag is a valid rename target`).
  const flag = renamedBase({ flags: { fl_a: 'fl_b' } });
  expect(renamedOf(lint(flag)).map((f) => `${f.code} ${f.line}`)).toEqual([`world/renamed-target ${jsonLine(flag, '"fl_a"')}`]);
  // The clean control: a chain to a live doc, a room, a section and a hotspot renamed onto live ones raise nothing.
  const clean = renamedBase({ docs: { a: 'b', b: 'letter' }, rooms: { attic: 'hall' }, sections: { house: 'manor' }, hotspots: { 'hall.old_gate': 'hall.gate' } });
  expect(run(clean, { declared: MANOR_VARS }).findings).toEqual([]);
});

test('story: renamed.puzzles is refused', () => {
  // R-E4: the server keys stored puzzles by their id until per-player GM6c1b; `old_drawer` is gone and `drawer` is
  // live, so the refusal is the only finding.
  const w = renamedBase({ puzzles: { old_drawer: 'drawer' } });
  expect(renamedOf(lint(w))).toEqual([
    {
      code: 'world/renamed-puzzles',
      severity: 'E',
      file: FILE,
      line: jsonLine(w, '"old_drawer"'),
      message: "renamed.puzzles: 'old_drawer' is refused until stored puzzles are re-keyed (R-E4, per-player GM6c1b)",
    },
  ]);
});

/** The 1-based line of the first line of a fixture's two-space JSON text that starts with `start` (trimmed). */
function jsonLine(w: Json, start: string): number {
  const i = `${JSON.stringify(w, null, 2)}\n`.split('\n').findIndex((l) => l.trimStart().startsWith(start));
  if (i < 0) {
    throw new Error(`invariant: the fixture text has a line starting with ${start}`);
  }
  return i + 1;
}

/** A fixture reach type whose own UI draws its goal (§7.3, I4), decoded beside the real types. */
const SHOWN: PuzzleTypeData<string, unknown> = Object.freeze({
  type: 'tiles',
  check: 'reach',
  goal: 'shown',
  presentation: 'view',
  wrong: 'none',
  commit: 'control',
  decodeParams: (raw: unknown) => ({ ok: true, value: raw }) as const,
  answerShape: () => ({ len: 4, max: 9 }),
  initial: () => [0, 0, 0, 0],
  startShown: () => [0, 0, 0, 0],
  workFits: () => true,
});

/**
 * A fixture world decoded with `types`, as a per-world pass's input (lintWorld's own rules know the real types only).
 * Its line lookup numbers each path in the order it is first asked for, so a test asks for the path it expects.
 */
function passInput(w: Json, types: PuzzleTypes): WorldLintInput {
  const text = `${JSON.stringify(w, null, 2)}\n`;
  const r = decodeWorldSource(JSON.parse(text), { types });
  if (!r.ok) {
    throw new Error(`invariant: the fixture decodes: ${JSON.stringify(r.error)}`);
  }
  const asked: string[] = [];
  const line = (path: string): number => {
    const i = asked.indexOf(path);
    return i >= 0 ? i + 1 : asked.push(path);
  };
  return { chapter: CH1, file: FILE, text, world: r.value, catalog: CATALOG, knots: KNOTS, yielded: null, declared: new Map(), line, moduleLines: new Map() };
}

const NO_CLUE = 'declares no clue: clues names the fact that shows its answer (§7.3, I4)';

test('story: a secret puzzle without clues is refused', () => {
  const w = base();
  delete at(w, 'puzzles.drawer')['clues'];
  delete at(w, 'puzzles.gate')['clues'];
  // Both are secret goals a lock holds: the drawer's code and the gate's order.
  expect(of(lint(w), 'world/clue-declared')).toEqual([
    { code: 'world/clue-declared', severity: 'E', file: FILE, line: jsonLine(w, '"drawer": {'), message: `puzzle 'drawer' (code, a secret goal) ${NO_CLUE}` },
    { code: 'world/clue-declared', severity: 'E', file: FILE, line: jsonLine(w, '"gate": {'), message: `puzzle 'gate' (order, a secret goal) ${NO_CLUE}` },
  ]);
  // A linear secret puzzle (no lock; a puzzle tag yields it): its clue is the story's (RULINGS 180 Q1-A).
  const linear = withCabinet(base());
  expect(of(lint(linear, { yielded: new Set(['cabinet'] as PuzzleLocalId[]) }), 'world/clue-declared')).toEqual([]); // a fixture id
  expect(of(lint(base()), 'world/clue-declared')).toEqual([]);
});

test('story: a shown-goal puzzle with a clue is refused', () => {
  const types: PuzzleTypes = [...PUZZLE_TYPES, SHOWN];
  const w = base();
  at(w, 'puzzles.drawer')['type'] = 'tiles';
  const input = passInput(w, types);
  expect(clueFindings(input, types)).toEqual([
    { code: 'world/reach-has-clue', severity: 'E', file: FILE, line: input.line('puzzles.drawer.clues'), message: "puzzle 'drawer' (tiles) draws its goal: it declares no clue (§7.3)" },
  ]);
  // Without the clue the shown goal is clean, and a lock holding it asks for none.
  delete at(w, 'puzzles.drawer')['clues'];
  expect(clueFindings(passInput(w, types), types)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM7p: the reach lints (engine plan §7.4, R8, R8b) through the full runner and the real registries, on the demo manor
// whose drawer is a path: 3 x 2, ends 0 and 3, its one solution 0 1 2 5 4 3, no clue (a shown goal), no attempt count.

const PATH_DRAWER: Json = { cols: 3, rows: 2, ends: [0, 3], blocked: [] };
/** The codes a reach puzzle's source can raise, and the solution check's. */
const REACH_SEEN = ['world/unique-solution', 'world/reach-solution', 'world/attempts-without-wrong', 'world/reach-has-clue', 'world/solution'] as const;

function pathBase(): Json {
  const w = base();
  const drawer = at(w, 'puzzles.drawer');
  drawer['type'] = 'path';
  drawer['params'] = { ...PATH_DRAWER };
  drawer['solution'] = [0, 1, 2, 5, 4, 3];
  drawer['maxAttempts'] = null;
  delete drawer['clues'];
  return w;
}

/** The findings of `REACH_SEEN`'s codes, as `code: message`. */
function reachSeen(w: Json): string[] {
  return lint(w)
    .filter((f) => (REACH_SEEN as readonly string[]).includes(f.code))
    .map((f) => `${f.code}: ${f.message}`);
}

test('story: a path with two solutions is refused', () => {
  // The control: the drawer as a path with one solution is a clean world.
  expect(run(pathBase(), { declared: { pz_drawer: 'int', pz_gate_hints: 'int', it_medal_sun: 'bool', dc_letter: 'bool' } }).findings).toEqual([]);
  // N3: 3 x 3 with ends 0 and 8 has two paths (the fixture is checked first): the solution cannot be the one posted.
  const two = { cols: 3, rows: 3, ends: [0, 8] as const, blocked: [] };
  expect(PUZZLE_LINTS.path.countSolutions(two, 2)).toBe(2);
  const w = pathBase();
  at(w, 'puzzles.drawer')['params'] = two;
  at(w, 'puzzles.drawer')['solution'] = [0, 1, 2, 5, 4, 3, 6, 7, 8];
  // One root cause, one finding: the solution check leaves two solutions to world/unique-solution.
  expect(reachSeen(w)).toEqual(["world/unique-solution: puzzle 'drawer' (path) has two or more solutions: a reach puzzle posts its one solution (§7.4)"]);
  expect(of(lint(w), 'world/unique-solution')).toEqual([expect.objectContaining({ severity: 'E', line: jsonLine(w, '"params": {') })]);
});

test('story: a reach puzzle with maxAttempts is refused', () => {
  const w = pathBase();
  at(w, 'puzzles.drawer')['maxAttempts'] = 2;
  // The path has no wrong answer, so its count would never move; the gate's order puzzle (3 attempts) posts wrong ones.
  expect(reachSeen(w)).toEqual(["world/attempts-without-wrong: puzzle 'drawer' (path) has maxAttempts 2, but its type has no wrong answer: the count never moves"]);
  expect(at(w, 'puzzles.gate')['maxAttempts']).toBe(3);
});

test('story: a path solution other than its canonical solve is refused', () => {
  // A wiring pin (H1 (2) through the real runner): PATH_LINT.validateSolution reports as world/solution.
  const w = pathBase();
  at(w, 'puzzles.drawer')['solution'] = [3, 4, 5, 2, 1, 0];
  expect(reachSeen(w)).toEqual([
    "world/solution: puzzle 'drawer': the solution is written from its higher-index end: a path is posted from its lower-index end, [0, 1, 2, 5, 4, 3]",
  ]);
  at(w, 'puzzles.drawer')['solution'] = [0, 1, 2, 5, 3, 4];
  expect(reachSeen(w)).toEqual(["world/solution: puzzle 'drawer': the solution is not the path's solve [0, 1, 2, 5, 4, 3]"]);
});

test('story: a path puzzle with a clue is refused', () => {
  // A wiring pin: the real type's shown goal activates world/reach-has-clue (§7.3) once it is registered.
  const w = pathBase();
  at(w, 'puzzles.drawer')['clues'] = [{ doc: 'letter' }];
  expect(reachSeen(w)).toEqual(["world/reach-has-clue: puzzle 'drawer' (path) draws its goal: it declares no clue (§7.3)"]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM7g: the grid through the reach pass and the solution check (engine plan §7.4, H1 (2)), through the full runner and
// the real registries, on the demo manor whose drawer is a grid: 2 x 2 over 2 symbols, cell 0 given 1, its one fill
// 1 2 / 2 1, no clue (a shown goal), no attempt count.

const GRID_DRAWER: Json = { rows: 2, cols: 2, symbols: 2, given: [1, 0, 0, 0] };

function gridBase(): Json {
  const w = base();
  const drawer = at(w, 'puzzles.drawer');
  drawer['type'] = 'grid';
  drawer['params'] = structuredClone(GRID_DRAWER);
  drawer['solution'] = [1, 2, 2, 1];
  drawer['maxAttempts'] = null;
  delete drawer['clues'];
  return w;
}

test('story: a grid with two solutions is refused', () => {
  // The control: the drawer as a grid with one fill is a clean world.
  expect(run(gridBase(), { declared: { pz_drawer: 'int', pz_gate_hints: 'int', it_medal_sun: 'bool', dc_letter: 'bool' } }).findings).toEqual([]);
  // A wiring pin: with nothing given the 2 x 2 has two fills (the fixture is checked first), so the solution cannot be
  // the one posted.
  const two = { rows: 2, cols: 2, symbols: 2, given: [0, 0, 0, 0] };
  expect(PUZZLE_LINTS.grid.countSolutions(two, 2)).toBe(2);
  const w = gridBase();
  at(w, 'puzzles.drawer')['params'] = two;
  // One root cause, one finding: the solution check leaves two fills to world/unique-solution.
  expect(reachSeen(w)).toEqual(["world/unique-solution: puzzle 'drawer' (grid) has two or more solutions: a reach puzzle posts its one solution (§7.4)"]);
  expect(of(lint(w), 'world/unique-solution')).toEqual([expect.objectContaining({ severity: 'E', line: jsonLine(w, '"params": {') })]);
});

test('story: a grid whose given cells fill it is refused', () => {
  // A wiring pin: the decoder admits a fully given grid, and the full runner refuses it twice, by code (in its pass
  // order): the reach pass's start clause, which reads the type's own `initial`, and the core's solution-is-initial.
  const w = gridBase();
  at(w, 'puzzles.drawer')['params'] = { rows: 2, cols: 2, symbols: 2, given: [1, 2, 2, 1] };
  const found = lint(w)
    .filter((f) => f.code === 'world/solution-initial' || f.code === 'world/reach-solution')
    .map((f) => [f.code, f.message]);
  expect(found).toEqual([
    ['world/reach-solution', "puzzle 'drawer' (grid) is reached at its start: it would post before any input (§7.4)"],
    ['world/solution-initial', "puzzle 'drawer': the solution [1, 2, 2, 1] is the initial state (X17)"],
  ]);
  expect(reachSeen(w)).toEqual(["world/reach-solution: puzzle 'drawer' (grid) is reached at its start: it would post before any input (§7.4)"]);
});

test('story: a grid solution other than its fill is refused', () => {
  // A wiring pin (H1 (2) through the real runner): GRID_LINT.validateSolution reports as world/solution; a Latin fill
  // that changes the given is not what the device posts.
  const w = gridBase();
  at(w, 'puzzles.drawer')['solution'] = [2, 1, 1, 2];
  expect(reachSeen(w)).toEqual(["world/solution: puzzle 'drawer': the solution is not the grid's fill [1, 2, 2, 1]"]);
});

test('story: a 25-cell grid passes the answer bound', () => {
  // A wiring pin (12e:108): the answer bound reads a reach type's length from its lint half's `solve`, through the real
  // registries; a 5 x 5 grid (the cyclic square, its diagonal blank) posts 25 entries, within 1..MAX_ANSWER_LEN.
  const fill = Array.from({ length: 25 }, (_, c) => ((Math.floor(c / 5) + (c % 5)) % 5) + 1);
  const params = { rows: 5, cols: 5, symbols: 5, given: fill.map((v, c) => (Math.floor(c / 5) === c % 5 ? 0 : v)) };
  expect(PUZZLE_LINTS.grid.solve(params)).toEqual(fill);
  const w = gridBase();
  at(w, 'puzzles.drawer')['params'] = params;
  at(w, 'puzzles.drawer')['solution'] = fill;
  expect(of(lint(w), 'world/answer-len')).toEqual([]);
  expect(reachSeen(w)).toEqual([]);
});

/** The line of clue `i` of puzzle `pid` in a fixture's JSON text: each clue is a one-key object over three lines. */
function clueLine(w: Json, pid: string, i: number): number {
  const lines = `${JSON.stringify(w, null, 2)}\n`.split('\n');
  const owner = lines.findIndex((l) => l.trimStart().startsWith(`"${pid}": {`));
  const clues = lines.findIndex((l, n) => n > owner && l.trimStart().startsWith('"clues": ['));
  if (owner < 0 || clues < 0) {
    throw new Error(`invariant: the fixture puzzle ${pid} has clues`);
  }
  return clues + 2 + 3 * i;
}

test('story: a clue behind its own puzzle is refused', () => {
  // The diary inside its own drawer: the drawer's code moves onto the cellar door, and the diary lies in the cellar.
  const behind = (maxAttempts: number | null, onFail: Json[]): Json => {
    const w = base();
    spot(w, 'study', 'drawer')['lock'] = null;
    spot(w, 'hall', 'to_cellar')['lock'] = { slots: [], puzzle: 'drawer', locked: t('manor', 'Дверь в подвал заперта.'), onOpen: [], onFail };
    at(w, 'puzzles.drawer')['maxAttempts'] = maxAttempts;
    at(w, 'puzzles.drawer')['clues'] = [{ doc: 'diary' }];
    return w;
  };
  const unseen = (w: Json, pid: string, clue: Json): Finding => ({
    code: 'world/clue-reachable',
    severity: 'E',
    file: FILE,
    line: clueLine(w, pid, 0),
    message: `puzzle '${pid}': clue ${JSON.stringify(clue)} holds in no state of section manor reached before '${pid}' is solved or failed (§7.3)`,
  });
  const inside = behind(null, []);
  expect(of(lint(inside), 'world/clue-reachable')).toEqual([unseen(inside, 'drawer', { doc: 'diary' })]);
  // Limited, and its failure opens the door itself (world/fail-without-effect's usual form): while the drawer can still
  // be solved, the diary stays behind it (critique W1).
  const limited = behind(3, [{ unlock: 'hall.to_cellar' }]);
  expect(of(lint(limited), 'world/clue-reachable')).toEqual([unseen(limited, 'drawer', { doc: 'diary' })]);
  // The control: the letter lies in the study, before the door.
  const before = behind(null, []);
  at(before, 'puzzles.drawer')['clues'] = [{ doc: 'letter' }];
  expect(of(lint(before), 'world/clue-reachable')).toEqual([]);
  // The gate's inscription is a look, a fact the section key does not hold: seen at the edge that sets it (D4).
  expect(of(lint(base()), 'world/clue-reachable')).toEqual([]);
  // A fact only the puzzle's own end writes: its outcome, or its lock opened by its onFail.
  for (const clue of [{ solved: 'gate' }, { failed: 'gate' }, { open: 'hall.gate' }]) {
    const w = base();
    at(w, 'puzzles.gate')['clues'] = [clue];
    expect(of(lint(w), 'world/clue-reachable'), JSON.stringify(clue)).toEqual([unseen(w, 'gate', clue)]);
  }
});

test('story: a clue naming no fact of its world is refused', () => {
  const w = base();
  at(w, 'puzzles.drawer')['clues'] = [{ doc: 'diar' }, { examined: 'hall.nothing' }, { solved: 'ghost' }];
  expect(of(lint(w), 'world/clue-reachable').map((f) => `${f.line} ${f.message}`)).toEqual([
    `${clueLine(w, 'drawer', 0)} puzzle 'drawer': clue {"doc":"diar"} names no doc of this world`,
    `${clueLine(w, 'drawer', 1)} puzzle 'drawer': clue {"examined":"hall.nothing"} names no hotspot of this world`,
    `${clueLine(w, 'drawer', 2)} puzzle 'drawer': clue {"solved":"ghost"} names no puzzle of this world`,
  ]);
  // A linear puzzle's atoms too; whether they hold is the story's order, judged by a cross-chapter clue pass once
  // content needs one (RULINGS 402 C4), so a named fact passes.
  const linear = withCabinet(base());
  const yielded = new Set(['cabinet'] as PuzzleLocalId[]); // a fixture id
  at(linear, 'puzzles.cabinet')['clues'] = [{ visited: 'attic' }, { has: 'lamp' }, { doc: 'diary' }];
  expect(of(lint(linear, { yielded }), 'world/clue-reachable').map((f) => f.message)).toEqual([
    `puzzle 'cabinet': clue {"visited":"attic"} names no room of this world`,
    `puzzle 'cabinet': clue {"has":"lamp"} names no item of this world`,
  ]);
});

test('search: an excluded step is never taken', () => {
  const decoded = decodeWorldSource(base());
  if (!decoded.ok) {
    throw new Error(`invariant: the fixture decodes: ${JSON.stringify(decoded.error)}`);
  }
  const pub = { ...toPublic(decoded.value), mods: decoded.value.mods };
  const manor = 'manor' as SectionId; // the fixture's section
  const start = sectionEntry(pub, EMPTY_WORLD_STATE, manor);
  const walk = (opts: SearchOptions): { states: number; result: string; steps: Step[] } => {
    const steps: Step[] = [];
    const r = searchSection(pub, start, manor, RESUME_STATE_CAP, { ...opts, onEdge: (_from, succ) => steps.push(succ.step) });
    return { states: r.states, result: r.result, steps };
  };
  const solvedDrawer = (st: Step): boolean => st.kind === 'puzzle-ended' && st.puzzle === 'drawer' && st.outcome === 'solved';
  const all = walk({});
  expect(all.steps.filter(solvedDrawer).length).toBeGreaterThan(0);
  const cut = walk({ exclude: solvedDrawer });
  expect(cut.steps.filter(solvedDrawer)).toEqual([]);
  expect(cut.result).toBe('exhausted');
  expect(cut.states).toBeLessThan(all.states);
  // An exclusion that accepts nothing is the option-less search, edge for edge.
  expect(walk({ exclude: () => false })).toEqual(all);
});

/** `params.n` of a fixture type's instance (its params decode as written). */
function nOf(params: unknown): number {
  const n = (params as { n?: unknown }).n; // a fixture type's params: { n }
  if (typeof n !== 'number') {
    throw new Error('invariant: a fixture instance writes params.n');
  }
  return n;
}

/** A commit type posting `params.n` entries, and a reach type whose lint half solves to `params.n` entries. */
const POSTS: PuzzleTypeData<string, unknown> = Object.freeze({
  type: 'posts',
  check: 'commit',
  goal: 'secret',
  presentation: 'overlay',
  wrong: 'posted',
  commit: 'control',
  decodeParams: (raw: unknown) => ({ ok: true, value: raw }) as const,
  answerShape: (p: unknown) => ({ len: nOf(p), max: 9 }),
  initial: (p: unknown) => Array.from({ length: nOf(p) }, () => 0),
  startShown: (p: unknown) => Array.from({ length: nOf(p) }, () => 0),
});
const REACHES: PuzzleTypeData<string, unknown> = Object.freeze({ ...SHOWN, type: 'reaches' });
const LENGTH_TYPES: PuzzleTypes = [...PUZZLE_TYPES, POSTS, REACHES];
const LENGTH_LINTS: Readonly<Record<string, PuzzleTypeLint<unknown>>> = {
  ...PUZZLE_LINTS,
  posts: { countSolutions: () => 1 },
  reaches: { solve: (p: unknown) => Array.from({ length: nOf(p) }, () => 1), countSolutions: () => 1 },
};

/** base() whose drawer is a fixture type posting `n` entries, decoded with LENGTH_TYPES. */
function lengthWorld(type: 'posts' | 'reaches', n: number): Json {
  const w = base();
  at(w, 'puzzles.drawer')['type'] = type;
  at(w, 'puzzles.drawer')['params'] = { n };
  return w;
}

test('story: an answer longer than MAX_ANSWER_LEN is refused', () => {
  const issues = (type: 'posts' | 'reaches', n: number) => answerLenIssues(passInput(lengthWorld(type, n), LENGTH_TYPES).world, LENGTH_LINTS, LENGTH_TYPES);
  const long = (n: number) => [{ path: 'puzzles.drawer.params', reason: 'range', detail: `puzzle 'drawer' posts ${n} entries: 1..64 (the server refuses longer, §7.4)` }];
  expect(issues('posts', 65)).toEqual(long(65));
  expect(issues('posts', 64)).toEqual([]);
  expect(issues('posts', 1)).toEqual([]);
  expect(issues('posts', 0)).toEqual(long(0));
  expect(issues('reaches', 65)).toEqual(long(65));
  expect(issues('reaches', 64)).toEqual([]);
  // The pass reports each at the author's line of the puzzle's params.
  const input = passInput(lengthWorld('posts', 65), LENGTH_TYPES);
  expect(answerLenFindings(input, LENGTH_LINTS, LENGTH_TYPES)).toEqual([
    { code: 'world/answer-len', severity: 'E', file: FILE, line: input.line('puzzles.drawer.params'), message: long(65)[0]?.detail },
  ]);
  // The real code and order worlds post within the bound, through the registry too.
  const decoded = decodeWorldSource(base());
  expect(decoded.ok && answerLenIssues(decoded.value)).toEqual([]);
  expect(of(lint(base()), 'world/answer-len')).toEqual([]);
});

test("story: the build's answer bound never exceeds the server's MAX_ANSWER_LEN", () => {
  const rust = readFileSync(new URL('../../../server/src/puzzles/mod.rs', import.meta.url), 'utf8');
  const m = /pub const MAX_ANSWER_LEN: usize = (\d+);/.exec(rust);
  expect(m, 'server/src/puzzles/mod.rs: pub const MAX_ANSWER_LEN: usize = <n>;').not.toBeNull();
  expect(MAX_ANSWER_LEN).toBeLessThanOrEqual(Number(m?.[1]));
});

test('story: a reach type whose lint half lacks a hook is refused by its code', () => {
  // K5's M1 (fix3): the reach pass names a missing `solve`, `reached` or `canonical` by its own code. The control's lint
  // half has all three: its one answer is all ones, which the zero start does not reach.
  const n = 4;
  const input = passInput(lengthWorld('reaches', n), LENGTH_TYPES);
  const countSolutions = (): 1 => 1;
  const solve = (): number[] => Array.from({ length: n }, () => 1);
  const reached = (_p: unknown, a: readonly number[]): boolean => a.every((v) => v === 1);
  const canonical = (_p: unknown, a: readonly number[]): readonly number[] => a;
  const codes = (half: PuzzleTypeLint<unknown>): string[] => reachFindings(input, { ...LENGTH_LINTS, reaches: half }, LENGTH_TYPES).map((f) => `${f.code} ${f.line}`);
  expect(codes({ countSolutions, solve, reached, canonical })).toEqual([]);
  const at = input.line('puzzles.drawer.params');
  expect(codes({ countSolutions, reached, canonical }), 'no solve').toEqual([`world/reach-solution ${at}`]);
  expect(codes({ countSolutions, solve, canonical }), 'no reached').toEqual([`world/reach-solution ${at}`]);
  expect(codes({ countSolutions, solve, reached }), 'no canonical').toEqual([`world/reach-solution ${at}`]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM3c: the composed decoder's module texts (engine plan §3.2 "Module texts")

/**
 * A fixture module owning hotspot `say` (a text) and `notes` (a list of `{ say }`): its data is the `OwnedAt`s it got,
 * every text decoded through the kernel's line-ID text decoder (`DecodeCtx.text`).
 */
const PROBE: MechanicData<'probe', OwnedRaw> = {
  id: 'probe',
  rules: 'none',
  owns: { hotspot: ['say', 'notes'] },
  decode: (raw, ctx) => {
    const error: WorldIssue[] = [];
    const report: IssueReport = (path, reason, detail) => {
      error.push({ path, reason, detail });
    };
    const value = raw.map((a): OwnedAt => {
      const out: Record<string, unknown> = { ...a.raw };
      if (Object.hasOwn(a.raw, 'say')) {
        out['say'] = ctx.text(a.raw['say'], `${a.path}.say`, report);
      }
      if (Object.hasOwn(a.raw, 'notes')) {
        out['notes'] = list(a.raw['notes']).map((u, i) => ({ say: ctx.text(u['say'], `${a.path}.notes.${i}.say`, report) }));
      }
      return { ...a, raw: out };
    });
    return error.length === 0 ? { ok: true, value } : { ok: false, error };
  },
  encode: (d) => d,
  normalize: (_w, s) => s,
};
const PROBED: DecodeOptions = { mechanics: [...MECHANIC_DATA, PROBE] };

test("world: a module text decodes with the kernel's line-ID rule", () => {
  const sayOn = (say: Json): { w: Json; findings: Finding[] } => {
    const w = base();
    spot(w, 'hall', 'inscription')['say'] = say;
    return { w, findings: decodeWorldFile({ file: FILE, text: `${JSON.stringify(w, null, 2)}\n` }, PROBED).findings };
  };
  // A module text without its ID: `id/missing` at the text's source line, as a kernel text's.
  const missing = sayOn({ ru: 'Тихо.' });
  expect(missing.findings).toEqual([
    {
      code: 'id/missing',
      severity: 'E',
      file: FILE,
      line: jsonLine(missing.w, '"say": {'),
      message: 'sections.manor.rooms.hall.hotspots.2.say.id: missing: every world text carries a line ID (STAGING-DSL §4)',
    },
  ]);
  const malformed = sayOn({ id: 'ch1.Manor.sy01', ru: 'Тихо.' });
  expect(malformed.findings.map((f) => `${f.code} ${f.line}`)).toEqual([`id/format ${jsonLine(malformed.w, '"id": "ch1.Manor.sy01"')}`]);
  // The control: a text with its ID decodes, and only the probe's registry admits the key.
  expect(sayOn({ id: 'ch1.manor.sy01', ru: 'Тихо.' }).findings).toEqual([]);
});

test('story: an all clue holds only when its conjuncts hold in one reached state', () => {
  const gateClue = (clue: Json): Json => {
    const w = base();
    at(w, 'puzzles.gate')['clues'] = [clue];
    return w;
  };
  // Each conjunct is reached, never both at once: inserting the medal into the gate uses it.
  const apart = { all: [{ held: 'medal_sun' }, { used: 'medal_sun' }] };
  const w = gateClue(apart);
  expect(of(lint(w), 'world/clue-reachable')).toEqual([
    {
      code: 'world/clue-reachable',
      severity: 'E',
      file: FILE,
      line: clueLine(w, 'gate', 0),
      message: `puzzle 'gate': clue ${JSON.stringify(apart)} holds in no state of section manor reached before 'gate' is solved or failed (§7.3)`,
    },
  ]);
  // Both in one state: the medal in hand after reading the inscription.
  expect(of(lint(gateClue({ all: [{ has: 'medal_sun' }, { examined: 'hall.inscription' }] })), 'world/clue-reachable')).toEqual([]);
  // The existence check reads every atom, nested ones and a `not`'s included, and names the first missing one.
  expect(of(lint(gateClue({ all: [{ doc: 'diar' }] })), 'world/clue-reachable').map((f) => f.message)).toEqual([`puzzle 'gate': clue {"all":[{"doc":"diar"}]} names no doc of this world`]);
  const negated = { all: [{ has: 'medal_sun' }, { not: { doc: 'diar' } }] };
  expect(of(lint(gateClue(negated)), 'world/clue-reachable').map((f) => f.message)).toEqual([`puzzle 'gate': clue ${JSON.stringify(negated)} names no doc of this world`]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM3c: the condition lints (engine plan §4 "Two scopes", "Limits")

/** A data module declaring atom `part`, visual only (as GM8i's), its value any string. */
const PART: MechanicData<'part_probe', null> = {
  id: 'part_probe',
  rules: 'none',
  owns: { atoms: ['part'] },
  atoms: { part: { decode: (v) => v, gating: false } },
  decode: () => ({ ok: true, value: null }),
  encode: () => [],
  normalize: (_w, s) => s,
};

/** base() plus section `yard`: a room with a take giving an item, a take giving a doc and a lock holding a puzzle. */
function yardWorld(): Json {
  const w = base();
  obj(w['items'])['lamp'] = { name: t('lamp', 'Лампа'), desc: t('lamp', 'Старая лампа.'), glyph: 'key' };
  obj(w['docs'])['note'] = { title: t('note', 'Записка'), body: [t('note', 'Во дворе.')] };
  obj(w['puzzles'])['shed'] = { ...codePuzzle(), clues: [{ doc: 'note' }] };
  obj(w['sections'])['yard'] = {
    start: 'yard',
    bgm: null,
    rooms: {
      yard: {
        bg: 'yard',
        title: t('yard', 'Двор'),
        onEnter: [],
        hotspots: [
          { ...take('lamp', { item: 'lamp' }), rect: [100, 300, 200, 200] },
          { ...take('note', { doc: 'note' }), rect: [400, 300, 200, 200] },
          { ...object('shed', lockOf([], 'shed')), rect: [700, 300, 200, 200] },
        ],
      },
    },
  };
  return w;
}

const MANOR = { gating: 'manor' as SectionId }; // the fixture's section

test('story: a gating condition reading another section is refused', () => {
  const input = passInput(yardWorld(), PUZZLE_TYPES);
  const where = 'sections.manor.rooms.hall.hotspots.2.when';
  const site = (cond: Json, scope: CondSite['scope'] = MANOR): CondSite => ({ cond, path: where, scope });
  const said = (sites: readonly CondSite[], data?: DataRegistry): string[] => condFindings(input, sites, data).map((f) => `${f.code} ${f.severity} ${f.message}`);
  const cross = (atom: Json, kind: string): string =>
    `world/cross-section-cond E ${where}: ${JSON.stringify(atom)} names no ${kind} of section manor: a gating condition reads only its own section (§4)`;
  // Every kernel atom naming one of yard's ids, in a gating condition of manor: one finding each.
  const yard: ReadonlyArray<readonly [Json, string]> = [
    [{ visited: 'yard' }, 'room'],
    [{ taken: 'yard.lamp' }, 'hotspot'],
    [{ examined: 'yard.lamp' }, 'hotspot'],
    [{ open: 'yard.shed' }, 'hotspot'],
    [{ held: 'lamp' }, 'item'],
    [{ used: 'lamp' }, 'item'],
    [{ has: 'lamp' }, 'item'],
    [{ doc: 'note' }, 'doc'],
    [{ solved: 'shed' }, 'puzzle'],
    [{ failed: 'shed' }, 'puzzle'],
  ];
  for (const [atom, kind] of yard) {
    expect(said([site(atom)]), JSON.stringify(atom)).toEqual([cross(atom, kind)]);
  }
  // Nested in every combinator, each atom once; a missing id the same way.
  const nested = { all: [{ any: [{ visited: 'yard' }, { has: 'medal_sun' }] }, { not: { doc: 'note' } }, { not: { visited: 'attic' } }] };
  expect(said([site(nested)])).toEqual([cross({ visited: 'yard' }, 'room'), cross({ doc: 'note' }, 'doc'), cross({ visited: 'attic' }, 'room')]);
  // Manor's own ids: rooms, hotspot keys, the items and docs it gives (a take, a give effect), its lock puzzles.
  const own = [{ visited: 'cellar' }, { taken: 'study.medal' }, { examined: 'hall.inscription' }, { open: 'hall.gate' }, { has: 'medal_moon' }, { doc: 'diary' }, { solved: 'drawer' }, { failed: 'gate' }];
  expect(said([site({ all: own })])).toEqual([]);
  // A visual condition reads any id of the chapter; a clue is scoped by world/clue-reachable.
  expect(said([site(nested, 'visual'), site(nested, 'clue')])).toEqual([]);
  // A visual-only module atom in a gating condition; in a visual one it is fine.
  const data: DataRegistry = [...MECHANIC_DATA, PART];
  expect(said([site({ any: [{ part: 'x' }, { has: 'medal_sun' }] })], data)).toEqual([
    `world/visual-only-atom E ${where}: {"part":"x"} is a visual-only atom: a gating condition never reads it (§4)`,
  ]);
  expect(said([site({ part: 'x' }, 'visual')], data)).toEqual([]);
  // Every finding at the site's line.
  expect(condFindings(input, [site({ visited: 'yard' })]).map((f) => [f.file, f.line])).toEqual([[FILE, input.line(where)]]);
});

test('story: a condition deeper than 4 or with more than 16 atoms is refused', () => {
  const input = passInput(base(), PUZZLE_TYPES);
  const where = 'puzzles.gate.clues.0';
  const nots = (n: number): Json => Array.from({ length: n }).reduce<Json>((c) => ({ not: c }), { has: 'medal_sun' });
  const wide = (n: number): Json => ({ all: Array.from({ length: n }, () => ({ has: 'medal_sun' })) });
  const size = (depth: number, atoms: number): string =>
    `world/cond-size E ${where}: the condition is ${depth} deep with ${atoms} atoms: at most 4 deep and 16 atoms (bounded evaluation, §4)`;
  for (const scope of [MANOR, 'visual', 'clue'] as const) {
    const said = (cond: Json): string[] => condFindings(input, [{ cond, path: where, scope }]).map((f) => `${f.code} ${f.severity} ${f.message}`);
    expect(said(nots(3)), JSON.stringify(scope)).toEqual([]);
    expect(said(nots(4)), JSON.stringify(scope)).toEqual([size(5, 1)]);
    expect(said(wide(16)), JSON.stringify(scope)).toEqual([]);
    expect(said(wide(17)), JSON.stringify(scope)).toEqual([size(2, 17)]);
  }
  // The registry's pass reads every clue as a site of scope clue, at the clue's line.
  const w = base();
  at(w, 'puzzles.gate')['clues'] = [nots(4)];
  const pass = passInput(w, PUZZLE_TYPES);
  const found = 'lint' in CONDITIONS_LINT ? CONDITIONS_LINT.lint(pass) : [];
  expect(found.map((f) => `${f.code} ${f.line}`)).toEqual([`world/cond-size ${pass.line(where)}`]);
  expect(of(lint(w), 'world/cond-size').map((f) => f.line)).toEqual([clueLine(w, 'gate', 0)]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM3c: the one walk of world texts (engine plan §3.2 "Module texts"), its gate, and the hotspot minimum's home

/** The probe's texts at their source paths: its hotspot `say` and every `notes` entry's `say`, all toasts. */
const PROBE_WALKER: TextWalker<OwnedRaw> = (_w, d, places) =>
  d.flatMap((a): ModuleText[] => {
    const path = places.hotspot(a.id as HotspotKey); // the probe owns hotspot keys only: its id is a HotspotKey
    const say = a.raw['say'] as WorldText | undefined; // the probe's decode made every say a text
    const notes = (a.raw['notes'] ?? []) as ReadonlyArray<{ readonly say: WorldText }>; // likewise, inside its list
    return [
      ...(say === undefined ? [] : [{ text: say, path: `${path}.say`, role: 'toast' as const, reach: [] }]),
      ...notes.map((u, i) => ({ text: u.say, path: `${path}.notes.${i}.say`, role: 'toast' as const, reach: [] })),
    ];
  });

/** The fixture world as text, decoded with the probe. */
function probeWorld(w: Json): { text: string; world: WorldSource } {
  const text = `${JSON.stringify(w, null, 2)}\n`;
  const decoded = decodeWorldFile({ file: FILE, text }, PROBED);
  if (decoded.world === null) {
    throw new Error(`invariant: the probe world decodes: ${JSON.stringify(decoded.findings)}`);
  }
  return { text, world: decoded.world };
}

/** lintWorld over a world decoded with the probe, with `lints` and `texts` as given. */
function lintProbe(w: Json, lints: readonly WorldLint<string>[], texts: TextRegistry): Finding[] {
  const { text, world } = probeWorld(w);
  return lintWorld({ chapter: CH1, file: FILE, text, world, catalog: CATALOG, knots: KNOTS, yielded: null, declared: new Map() }, lints, texts).findings;
}

/** base() whose inscription says `say` through the probe. */
function saying(): { w: Json; say: Json } {
  const w = base();
  const say = t('manor', 'Тихо.');
  spot(w, 'hall', 'inscription')['say'] = say;
  return { w, say };
}

test('story: a module text is a world line with its role', () => {
  const { w, say } = saying();
  const { text, world } = probeWorld(w);
  const lines = worldLines(world, FILE, text, { ...MECHANIC_TEXTS, probe: PROBE_WALKER });
  // The kernel's lines first, unchanged; then the module's text at its source path and line.
  expect(lines.slice(0, -1)).toEqual(worldLines(world, FILE, text));
  expect(lines.at(-1)).toEqual({
    id: say['id'],
    text: 'Тихо.',
    file: FILE,
    line: jsonLine(w, '"say": {'),
    hint: false,
    path: 'sections.manor.rooms.hall.hotspots.2.say',
    role: 'toast',
    reach: [],
  });
});

/** R-E9's table, restated: each kernel field's role and reach. */
const KERNEL_ROLES: Readonly<Record<string, readonly [string, 'has' | 'doc' | null]>> = {
  'item.name': ['name', null],
  'item.desc': ['read', 'has'],
  'doc.title': ['name', null],
  'doc.body': ['read', 'doc'],
  'puzzle.title': ['name', null],
  'puzzle.prompt': ['name', null],
  'puzzle.hints': ['hint', null],
  'room.title': ['name', null],
  'hotspot.label': ['name', null],
  'lock.locked': ['toast', null],
  'hotspot.look': ['toast', null],
};

/**
 * Today's kernel walk over a world's raw JSON, field by field in the kernel's order (items' name and desc, docs' title
 * and body, puzzles' title, prompt and hints, then per room its title and per hotspot its label, lock text and look):
 * `[id, path, line, hint, role, reach]`. A committed world writes each text on one line, so its line holds its ID.
 */
function kernelOracle(raw: Json, text: string): unknown[][] {
  const fileLines = text.split('\n');
  const out: unknown[][] = [];
  const add = (v: unknown, path: string, field: string, owner = ''): void => {
    const id = String(obj(v)['id']);
    const [role, reach] = KERNEL_ROLES[field] ?? ['?', null];
    const line = fileLines.findIndex((l) => l.includes(`"${id}"`)) + 1;
    out.push([id, path, line, role === 'hint', role, reach === null ? [] : [{ [reach]: owner }]]);
  };
  for (const [id, item] of Object.entries(obj(raw['items']))) {
    add(obj(item)['name'], `items.${id}.name`, 'item.name');
    add(obj(item)['desc'], `items.${id}.desc`, 'item.desc', id);
  }
  for (const [id, doc] of Object.entries(obj(raw['docs']))) {
    add(obj(doc)['title'], `docs.${id}.title`, 'doc.title');
    list(obj(doc)['body']).forEach((b, i) => add(b, `docs.${id}.body.${i}`, 'doc.body', id));
  }
  for (const [id, p] of Object.entries(obj(raw['puzzles']))) {
    add(obj(p)['title'], `puzzles.${id}.title`, 'puzzle.title');
    add(obj(p)['prompt'], `puzzles.${id}.prompt`, 'puzzle.prompt');
    list(obj(p)['hints']).forEach((h, i) => add(h, `puzzles.${id}.hints.${i}`, 'puzzle.hints'));
  }
  for (const [sid, s] of Object.entries(obj(raw['sections']))) {
    for (const [rid, r] of Object.entries(obj(obj(s)['rooms']))) {
      const room = `sections.${sid}.rooms.${rid}`;
      add(obj(r)['title'], `${room}.title`, 'room.title');
      list(obj(r)['hotspots']).forEach((h, i) => {
        const path = `${room}.hotspots.${i}`;
        add(h['label'], `${path}.label`, 'hotspot.label');
        if (h['lock'] !== null && h['lock'] !== undefined) {
          add(obj(h['lock'])['locked'], `${path}.lock.locked`, 'lock.locked');
        }
        if (h['look'] !== null && h['look'] !== undefined) {
          add(h['look'], `${path}.look`, 'hotspot.look');
        }
      });
    }
  }
  return out;
}

test("story: the kernel's world lines keep their order and gain their roles", () => {
  for (const ch of ['ch1', 'ch2']) {
    const file = `story/${ch}/world.json`;
    const text = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
    const decoded = decodeWorldFile({ file, text });
    if (decoded.world === null) {
      throw new Error(`invariant: ${file} decodes`);
    }
    const lines = worldLines(decoded.world, file, text);
    const oracle = kernelOracle(obj(readRepoJson(file)), text);
    expect(oracle.length, file).toBeGreaterThan(0);
    expect(lines.map((l) => [l.id, l.path, l.line, l.hint, l.role, l.reach]), file).toEqual(oracle);
    expect(lines.every((l) => l.file === file && l.hint === (l.role === 'hint')), file).toBe(true);
  }
});

test("story: a module text's en entry is checked", () => {
  const { w, say } = saying();
  const { text, world } = probeWorld(w);
  const id = String(say['id']);
  const lines = worldLines(world, 'ch1/world.json', text, { ...MECHANIC_TEXTS, probe: PROBE_WALKER });
  const { graph } = graphWith(manorInk());
  const check = (en: Readonly<Record<string, { ru: string; en: string }>>): Finding[] =>
    checkLocales({
      chapters: null,
      graphs: new Map([[CH1.id, graph]]),
      en: new Map([['ch1', decodeEnTable('locales/en/ch1.json', JSON.stringify(en)).table]]),
      names: { ru: decodeNameTable('locales/ru/story.json', null).table, en: decodeNameTable('locales/en/story.json', null).table },
      cast: {},
      retired: new Set(),
      stories: [],
      worlds: new Map([[CH1.id, lines]]),
    }).findings.filter((f) => f.message.includes(id));
  // No en entry: loc/missing-en at the text's source line, as a kernel text's.
  expect(check({})).toEqual([
    { code: 'loc/missing-en', severity: LINT_CODES['loc/missing-en'], file: 'ch1/world.json', line: jsonLine(w, '"say": {'), message: `'${id}' has no entry in story/locales/en/ch1.json (run --sync-locales)` },
  ]);
  // With it: the entry names a line, so it is no orphan.
  expect(check({ [id]: { ru: 'Тихо.', en: 'Quiet.' } })).toEqual([]);
});

test('mechanics: every module declares its texts', () => {
  expect(Object.keys(MECHANIC_TEXTS)).toEqual(MECHANIC_DATA.map((d) => d.id));
});

test('story: an undeclared module text is refused', () => {
  const w = base();
  const say = t('manor', 'Тихо.');
  spot(w, 'hall', 'inscription')['notes'] = [{ say }];
  // The probe's entry is null, and its data holds a text inside a list.
  expect(of(lintProbe(w, MECHANIC_LINTS, { ...MECHANIC_TEXTS, probe: null }), 'world/text-unwalked')).toEqual([
    {
      code: 'world/text-unwalked',
      severity: 'E',
      file: FILE,
      line: jsonLine(w, `"id": "${String(say['id'])}"`),
      message: `'${String(say['id'])}' is a text of module probe that no text walker returns: walk it in MECHANIC_TEXTS (§3.2)`,
    },
  ]);
  // Walked, it is a world line and the gate is silent.
  expect(of(lintProbe(w, MECHANIC_LINTS, { ...MECHANIC_TEXTS, probe: PROBE_WALKER }), 'world/text-unwalked')).toEqual([]);
});

test("story: the texts gate reads each module's walked lines", () => {
  const { w, say } = saying();
  const seen: WorldLintInput[] = [];
  const capture: WorldLint<never> = {
    id: 'capture',
    codes: {},
    lint: (input) => {
      seen.push(input);
      return [];
    },
  };
  const walked = lintProbe(w, [...MECHANIC_LINTS, capture], { ...MECHANIC_TEXTS, probe: PROBE_WALKER });
  expect(seen).toHaveLength(1);
  const moduleLines: ReadonlyMap<string, ReadonlySet<string>> | undefined = seen[0]?.moduleLines;
  expect([...(moduleLines?.keys() ?? [])]).toEqual([...Object.keys(MECHANIC_TEXTS), 'probe']);
  expect(moduleLines?.get('probe')).toEqual(new Set([say['id']]));
  expect(moduleLines?.get('core')).toEqual(new Set());
  expect(of(walked, 'world/text-unwalked')).toEqual([]);
  // A walker that misses its text: the gate reports it.
  const blind: TextWalker<OwnedRaw> = () => [];
  expect(of(lintProbe(w, MECHANIC_LINTS, { ...MECHANIC_TEXTS, probe: blind }), 'world/text-unwalked').map((f) => f.line)).toEqual([
    jsonLine(w, `"id": "${String(say['id'])}"`),
  ]);
});

test('texts: texts.ts value-imports nothing from mechanics/index.ts or world.ts', async () => {
  const dir = new URL('./mechanics/', import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();
  // Never vacuous: every lint file and the registry this rule exists for is read.
  expect(files).toEqual(expect.arrayContaining(['clues.ts', 'conditions.ts', 'core.ts', 'index.ts', 'texts.ts']));
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    // world.ts: nothing, not even a type (it type-imports emit.ts, which imports node:crypto: index.ts's header).
    expect(src, f).not.toMatch(/['"]\.\.?\/world\.ts['"]/);
    // index.ts: types only, erased at run time, so the registry's value graph has no edge back into it.
    for (const m of src.matchAll(/^(?:import|export)\b[^;]*?['"]\.\/index\.ts['"]/gm)) {
      expect(m[0], f).toMatch(/^(?:import|export) type\b/);
    }
    expect(src, f).not.toMatch(/import\(\s*['"]\.\/index\.ts['"]\s*\)/);
  }
  // Loaded first, alone, texts.ts resolves its gate: no binding of index.ts is read at its top level.
  vi.resetModules();
  const texts = await import('./mechanics/texts.ts');
  expect('lint' in texts.TEXTS_LINT && typeof texts.TEXTS_LINT.lint).toBe('function');
});

test('story: the hotspot minimum is one constant', () => {
  expect(HOTSPOT_MIN_SOURCE_PX).toBe(150);
  const sized = (rw: number, rh: number): Finding[] => {
    const w = base();
    spot(w, 'hall', 'inscription')['rect'] = [400, 400, rw, rh];
    return of(lint(w), 'world/hotspot-small');
  };
  expect(sized(149, 150)).toEqual([expect.objectContaining({ severity: 'W', message: 'hall.inscription is 149×150: under 150×150 source px (a 44 CSS px target)' })]);
  expect(sized(150, 149)).toHaveLength(1);
  expect(sized(150, 150)).toEqual([]);
  // world.ts keeps no minimum of its own.
  expect(readFileSync(new URL('./world.ts', import.meta.url), 'utf8')).not.toMatch(/=\s*150\b/);
  // The committed ch1 has no hotspot under it.
  const text = readFileSync(new URL('../../../story/ch1/world.json', import.meta.url), 'utf8');
  const decoded = decodeWorldFile({ file: FILE, text });
  if (decoded.world === null) {
    throw new Error('invariant: story/ch1/world.json decodes');
  }
  const ch1 = lintWorld({ chapter: CH1, file: FILE, text, world: decoded.world, catalog: CATALOG, knots: null, yielded: null, declared: new Map() });
  expect(of(ch1.findings, 'world/hotspot-small')).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// Module `use` on the seeded playthroughs (STAGING-DSL §11): the played world is story.ts's, the public body with the
// decoded `mods` (b1). The fixture helpers restate play.test.ts's; this file's program has the node types the story
// tool's modules need, which src/mechanics/use.test.ts's has not.

/** The committed cast, decoded against the committed catalog. */
function committedCast(): Cast {
  const cast = decodeCast(readRepoJson('story/cast.json'), CATALOG);
  if (!cast.ok) {
    throw new Error('invariant: the committed cast decodes');
  }
  return cast.value;
}

/** The hall's door is a zero-slot lock that only the statue's rule unlocks; the rule's story runs and hands back. */
function statueWorld(): WorldSource {
  const label = (owner: string): Json => ({ id: `ch1.${owner}.u${(counter++).toString(36).padStart(3, '0')}`, ru: 'Текст' });
  const laid = (h: Json, i: number): Json => ({ label: label('s'), rect: [100 + i * 300, 300, 200, 200], ...h });
  const raw = {
    format: 1,
    items: { key: { name: label('key'), desc: label('key'), glyph: 'key' } },
    docs: {},
    puzzles: {},
    sections: {
      s: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: {
            bg: 'hall',
            title: label('s'),
            onEnter: [],
            hotspots: [
              { id: 'key', kind: 'take', gives: { item: 'key' }, prop: null, then: [] },
              { id: 'statue', kind: 'object', lock: null, then: [], look: null, prop: null, uses: [{ item: 'key', do: [{ unlock: 'hall.door' }, { story: 'statue_voice' }] }] },
              { id: 'door', kind: 'exit', to: { story: 'after' }, lock: { slots: [], puzzle: null, locked: label('s'), onOpen: [], onFail: [] }, sfx: null },
            ].map(laid),
          },
        },
      },
    },
  };
  const src = decodeWorldSource(raw);
  if (!src.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(src.error)}`);
  }
  return src.value;
}

/** The chapter that explores the statue world: `statue_voice` is entered only by the rule's `story`. */
function statueChapter(): { sources: ReadonlyMap<string, string>; files: readonly string[]; json: string } {
  const sources = new Map([
    [GLOBALS_PATH, 'VAR g_x = 0\n'],
    [
      CH1.entry,
      [
        'INCLUDE ../common/globals.ink',
        '-> start',
        '=== start ===',
        'Холл. #id:ch1.start.a001',
        '# explore: s',
        '-> DONE',
        '=== statue_voice ===',
        'Статуя повернулась. #id:ch1.statue_voice.a002',
        '# explore: s',
        '-> DONE',
        '=== after ===',
        'Дверь открыта. #id:ch1.after.a003',
        '-> END',
        '',
      ].join('\n'),
    ],
  ]);
  const compiled = compileChapter(CH1, (key) => sources.get(key) ?? null).compiled;
  if (compiled === null) {
    throw new Error('invariant: the fixture compiles');
  }
  return { sources, files: compiled.files, json: compiled.json };
}

/** Five seeded runs of the statue chapter over `world`. */
function playStatue(graph: ChapterGraph, json: string, world: KernelWorld): ReturnType<typeof playChapter> {
  return playChapter({
    chapter: CH1,
    json,
    graph,
    assets: ASSETS,
    cast: committedCast(),
    en: new Map(),
    staticIds: new Set(graph.lines.map((l) => l.id)),
    allow: new Map(),
    carry: null,
    runs: 5,
    world,
  });
}

test("use: a played chapter takes a use edge only with the world's mods", () => {
  const src = statueWorld();
  const ch = statueChapter();
  const graph = buildGraph({ chapter: CH1, files: ch.files, sources: ch.sources, assets: ASSETS }).graph;
  // With the decoded `mods` every run uses the key on the statue, plays its voice and leaves through the door.
  const withMods = playStatue(graph, ch.json, { ...toPublic(src), mods: src.mods });
  expect(withMods.play, JSON.stringify(withMods.findings)).toMatchObject({ ended: 5, failed: 0 });
  expect([...withMods.play.visited]).toEqual(['start', 'statue_voice', 'after']);
  // The public body alone has no rules: the door never opens and `after` is never entered.
  // @ts-expect-error -- the public body alone is no proof world (KernelWorld.mods); kept as the runtime guard
  const without = playStatue(graph, ch.json, toPublic(src));
  expect(without.play.ended).toBe(0);
  expect([...without.play.visited]).not.toContain('after');
});

test('playthrough: every step yields at least one cue', () => {
  // The hall: a look hotspot (tapped again and again) and the exit out of the section.
  const label = (): Json => ({ id: `ch1.s.p${(counter++).toString(36).padStart(3, '0')}`, ru: 'Текст' });
  const raw = {
    format: 1,
    items: {},
    docs: {},
    puzzles: {},
    sections: {
      s: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: {
            bg: 'hall',
            title: label(),
            onEnter: [],
            hotspots: [
              { id: 'desk', kind: 'look', rect: [100, 300, 200, 200], label: label(), look: label(), then: [] },
              { id: 'out', kind: 'exit', rect: [400, 300, 200, 200], label: label(), to: { story: 'after' }, lock: null, sfx: null },
            ],
          },
        },
      },
    },
  };
  const src = decodeWorldSource(raw);
  if (!src.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(src.error)}`);
  }
  const sources = new Map([
    [GLOBALS_PATH, 'VAR g_x = 0\n'],
    [CH1.entry, ['INCLUDE ../common/globals.ink', '-> start', '=== start ===', 'Холл. #id:ch1.start.a001', '# explore: s', '-> DONE', '=== after ===', 'Вышли. #id:ch1.after.a002', '-> END', ''].join('\n')],
  ]);
  const compiled = compileChapter(CH1, (key) => sources.get(key) ?? null).compiled;
  if (compiled === null) {
    throw new Error('invariant: the fixture compiles');
  }
  const graph = buildGraph({ chapter: CH1, files: compiled.files, sources, assets: ASSETS }).graph;
  const play = (rules?: RulesRegistry): ReturnType<typeof playChapter> =>
    playChapter({
      chapter: CH1,
      json: compiled.json,
      graph,
      assets: ASSETS,
      cast: committedCast(),
      en: new Map(),
      staticIds: new Set(graph.lines.map((l) => l.id)),
      allow: new Map(),
      carry: null,
      runs: 20,
      world: { ...toPublic(src.value), mods: src.value.mods },
      ...(rules === undefined ? {} : { rules }),
    });
  // Every run taps the desk until it leaves: each tap, the first and every later one, plays a cue.
  const clean = play();
  expect(clean.play, JSON.stringify(clean.findings)).toMatchObject({ ended: 20, failed: 0 });
  expect(clean.findings).toEqual([]);
  // The positive control: a module that claims the desk's tap and writes nothing fails the run at that step.
  const mute: MechanicRules<'mute', never, never> = {
    id: 'mute',
    actions: () => [],
    apply: () => undefined,
    reads: () => [],
    cues: [],
    tap: (_w, _s, at) => at === ('hall.desk' as HotspotKey), // the fixture's hotspot
  };
  const muted = play([...MECHANIC_RULES, mute]);
  expect(muted.findings.map((f) => f.code)).toEqual(['play/runtime-error']);
  expect(muted.findings[0]?.message).toContain('step tap hall.desk yields no cue');
});

test('use: a knot a rule enters is in the graph, its seeds and the shot flow', () => {
  const src = statueWorld();
  const world: KernelWorld = { ...toPublic(src), mods: src.mods };
  const ch = statueChapter();
  // The graph's world is the story gate's own construction (`worldRef`, what story.ts passes to `buildGraph`).
  const g = buildGraph({ chapter: CH1, files: ch.files, sources: ch.sources, assets: ASSETS, world: worldRef({ kind: 'ok', source: src }) });
  // The rule's knot is an event of the hall (RULINGS 212 Q3): reachable from the yield, seeded with the hall's stage.
  expect(g.findings.filter((f) => f.code === 'graph/unreachable-knot' || f.code.startsWith('explore/'))).toEqual([]);
  const knot = 'statue_voice' as KnotName; // the fixture's knot
  expect([g.graph.sections?.seeds.get(knot), g.graph.sections?.rooms.get(knot)]).toEqual([['bg/hall'], { events: ['hall'], leaves: [] }]);
  // The seeded runs enter it, and the shot flow has every transition they took.
  const r = playStatue(g.graph, ch.json, world);
  expect([...r.play.visited]).toContain('statue_voice');
  const flow = buildFlow({ chapter: CH1.id, files: ch.files, sources: ch.sources, graph: g.graph, assets: ASSETS, cast: committedCast(), world });
  expect(crossCheck(flow.flow, r.play.transitions, CH1.entry)).toEqual([]);
});

test('use: the graph world input maps none, invalid and ok', () => {
  const src = statueWorld();
  // No world file and a world that did not decode stay apart: only `none` gives each yield a "has no world" finding.
  expect(worldRef(undefined)).toEqual({ kind: 'none' });
  expect(worldRef({ kind: 'none' })).toEqual({ kind: 'none' });
  expect(worldRef({ kind: 'invalid' })).toEqual({ kind: 'invalid' });
  const ok = worldRef({ kind: 'ok', source: src });
  expect(ok.kind).toBe('ok');
  expect(ok.kind === 'ok' ? ok.body.mods : null).toBe(src.mods);
});

// ---------------------------------------------------------------------------------------------------------------
// Module `use`'s texts and lints (scripts/story/mechanics/use.ts)

/** The world as the story gate decodes it from its file. */
function decodedText(w: Json): { text: string; world: WorldSource } {
  const text = `${JSON.stringify(w, null, 2)}\n`;
  const decoded = decodeWorldFile({ file: FILE, text });
  if (decoded.world === null) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(decoded.findings)}`);
  }
  return { text, world: decoded.world };
}

test('use: its say and refuse texts are world lines of role toast', () => {
  const w = base();
  const refuse = t('medal_sun', 'Не подходит.');
  const say = t('manor', 'Медальон звякнул.');
  obj(obj(w['items'])['medal_sun'])['refuse'] = refuse;
  spot(w, 'hall', 'inscription')['uses'] = [{ item: 'medal_sun', keep: true, say }];
  const { text, world } = decodedText(w);
  const lines = worldLines(world, FILE, text);
  // The kernel's lines first, unchanged; then use's, in source order, at their source paths and lines.
  expect(lines.slice(0, -2)).toEqual(worldLines(world, FILE, text, { ...MECHANIC_TEXTS, use: null }));
  expect(lines.slice(-2)).toEqual([
    { id: refuse['id'], text: 'Не подходит.', file: FILE, line: jsonLine(w, '"refuse": {'), hint: false, path: 'items.medal_sun.refuse', role: 'toast', reach: [] },
    { id: say['id'], text: 'Медальон звякнул.', file: FILE, line: jsonLine(w, '"say": {'), hint: false, path: 'sections.manor.rooms.hall.hotspots.2.uses.0.say', role: 'toast', reach: [] },
  ]);
  // The texts gate reads them as walked: the world lints clean.
  expect(lint(w)).toEqual([]);
});

test('use: lints refuse an unknown ref, a cross-section rule and warn a consumed keep item', () => {
  // Section s gives the key and the lens; section t gives the relic, and its chest takes the gem.
  const w = mini({
    items: ['key', 'relic', 'gem', 'lens'],
    sections: {
      s: { start: 'hall', rooms: { hall: [take('key', { item: 'key' }), object('box', null), take('lens', { item: 'lens' }), object('scope', lockOf(['lens'])), object('jar', lockOf(['lens'])), leave('out')] } },
      t: { start: 'yard', rooms: { yard: [take('relic', { item: 'relic' }), object('chest', lockOf(['gem'])), leave('out')] } },
    },
  });
  // The box's rule 0 uses and reads t's relic; rule 1 gives the gem t's chest takes, unlocks a take, enters no knot.
  spot(w, 'hall', 'box', 's')['uses'] = [
    { item: 'relic', when: { held: 'relic' } },
    { item: 'key', keep: true, do: [{ give: 'gem' }, { unlock: 'hall.key' }, { story: 'nowhere' }] },
  ];
  // The scope's slot keeps the lens, which the jar's slot consumes.
  obj(list(obj(spot(w, 'hall', 'scope', 's')['lock'])['slots'])[0])['keep'] = true;
  const box = 'sections.s.rooms.hall.hotspots.1.uses';
  const found = lint(w, { knots: new Set(['k'] as KnotName[]) }); // the fixture's one knot
  expect(found.map((f) => `${f.code} ${f.severity} ${f.message}`)).toEqual([
    `world/use-cross-section E rule 0 of hall.box: item 'relic' is no item section s gives: a rule reads only its own section (X15)`,
    `world/cross-section-cond E ${box}.0.when: {"held":"relic"} names no item of section s: a gating condition reads only its own section (§4)`,
    `world/use-cross-section E rule 1 of hall.box: item 'gem' is given in section s and required by lock yard.chest of section t (X15)`,
    `world/use-unknown-ref E rule 1 of hall.box: hotspot 'hall.key' is no lock`,
    `world/use-unknown-ref E rule 1 of hall.box: knot 'nowhere' of ch1 is not defined`,
    `world/keep-consumed W slot hall.scope#0 keeps item 'lens' held, but slot hall.jar#0 consumes it: a tool that stays is never used up (§6.1)`,
  ]);
  // Each at its source line, in the file's order (the slot's `keep` is the file's last one: the box's rule comes first).
  const lines = `${JSON.stringify(w, null, 2)}\n`.split('\n');
  const slotKeep = lines.findLastIndex((l) => l.trimStart().startsWith('"keep": true')) + 1;
  const at = (start: string): number => jsonLine(w, start);
  expect(found.map((f) => f.line)).toEqual([at('"item": "relic"'), at('"when": {'), at('"give": "gem"'), at('"unlock": "hall.key"'), at('"story": "nowhere"'), slotKeep]);
  // The keep check reads the data alone: a world whose `use` data holds no rule still gets it.
  delete spot(w, 'hall', 'box', 's')['uses'];
  const ruleless = `${JSON.stringify(w, null, 2)}\n`.split('\n').findIndex((l) => l.trimStart().startsWith('"keep": true')) + 1;
  expect(of(lint(w, { knots: new Set(['k'] as KnotName[]) }), 'world/keep-consumed').map((f) => f.line)).toEqual([ruleless]);
});

test("use: a world whose rules give and read their section's own items lints clean", () => {
  // The positive control (RULINGS 212): the inscription's rule takes the sun medallion and leaves it held (`keep`, so
  // the gate's slots can still be filled: the section stays leave-safe) and gives the coin, which the drawer's rule
  // reads in its `when`. The coin is manor's own item through use's scope hook only.
  const w = base();
  obj(w['items'])['coin'] = { name: t('coin', 'Монета'), desc: t('coin', 'Старая монета.'), glyph: 'key' };
  spot(w, 'hall', 'inscription')['uses'] = [{ item: 'medal_sun', keep: true, do: [{ give: 'coin' }] }];
  spot(w, 'study', 'drawer')['uses'] = [{ item: 'coin', when: { held: 'coin' }, do: [{ story: 'manor_cellar_voice' }] }];
  expect(lint(w)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// Module `combine`'s texts (scripts/story/mechanics/combine.ts) and the `--fix-ids` owner rule it relies on (§3.2)

/**
 * The demo manor with one recipe (RULINGS 212's positive control, recombined): the inscription's `use` rule keeps the
 * sun medallion and gives the coin; the recipe consumes the coin, keeps the sun (so the gate's slots can still be
 * filled: the section stays leave-safe) and makes the amulet, all manor's own items. `say` is the recipe's text, built
 * after `base()` restarts the fixture's ID counter.
 */
function recipeBase(say: () => Json): Json {
  const w = base();
  obj(w['items'])['coin'] = { name: t('coin', 'Монета'), desc: t('coin', 'Старая монета.'), glyph: 'key' };
  obj(w['items'])['amulet'] = { name: t('amulet', 'Амулет'), desc: t('amulet', 'Монета в оправе.'), glyph: 'key' };
  spot(w, 'hall', 'inscription')['uses'] = [{ item: 'medal_sun', keep: true, do: [{ give: 'coin' }] }];
  w['recipes'] = [{ a: 'coin', b: 'medal_sun', gives: 'amulet', keep: ['medal_sun'], say: say() }];
  return w;
}

test("combine: a recipe's say is a world line of role toast", () => {
  const w = recipeBase(() => t('manor', 'Монета легла в оправу.'));
  const say = obj(list(w['recipes'])[0]?.['say']);
  const { text, world } = decodedText(w);
  const lines = worldLines(world, FILE, text);
  // The recipe's say last, at its source path (under the world's root) and line; the kernel's lines before it, unchanged.
  expect(lines.at(-1)).toEqual({ id: say['id'], text: 'Монета легла в оправу.', file: FILE, line: jsonLine(w, '"say": {'), hint: false, path: 'recipes.0.say', role: 'toast', reach: [] });
  expect(lines.slice(0, -1)).toEqual(worldLines(world, FILE, text, { ...MECHANIC_TEXTS, combine: null }));
  // The texts gate reads it as walked: the world lints clean.
  expect(lint(w)).toEqual([]);
});

test("combine: --fix-ids skips a recipe's say and names why", () => {
  // The say without its ID: under the world's root, no item, doc, puzzle or section owns it (fix.ts WORLD_OWNERS).
  const w = recipeBase(() => ({ ru: 'Монета легла в оправу.' }));
  const text = `${JSON.stringify(w, null, 2)}\n`;
  let n = 0;
  const r = fixWorldIds({ text, chapter: CH1.id, taken: new Set(), suffix: () => (n++).toString(36).padStart(4, '0') });
  if (!('text' in r)) {
    throw new Error(`invariant: a JSON world is fixed: ${r.error}`);
  }
  expect(r.skipped).toEqual([{ path: 'recipes.0.say', reason: 'the text is under no item, doc, puzzle or section, so the ID would have no knot part (§4)' }]);
  expect(r.added.filter((a) => a.path.startsWith('recipes.'))).toEqual([]);
  // So the gate keeps reporting it, at its own line: its ID is written by hand (§3.2).
  expect(of(decodeWorldFile({ file: FILE, text }).findings, 'id/missing').map((f) => [f.line, f.message.startsWith('recipes.0.say')])).toEqual([[jsonLine(w, '"say": {'), true]]);
});

test("conditions: a module's scope hook widens the gating scope", () => {
  const input = passInput(base(), PUZZLE_TYPES);
  const where = 'sections.manor.rooms.hall.hotspots.2.when';
  const site: CondSite = { cond: { held: 'relic' }, path: where, scope: MANOR };
  // A fixture rules module whose data gives the relic in manor: no item of the world, nothing else.
  const relic: MechanicRules<'relic_probe', never, never> = {
    id: 'relic_probe',
    actions: () => [],
    apply: () => undefined,
    reads: () => [],
    cues: [],
    scope: (_w, section) => ({ items: section === 'manor' ? ['relic' as ItemId] : [], fired: [] }), // a fixture item id
  };
  expect(condFindings(input, [site], MECHANIC_DATA, [...MECHANIC_RULES, relic])).toEqual([]);
  expect(condFindings(input, [site]).map((f) => `${f.code} ${f.severity} ${f.message}`)).toEqual([
    `world/cross-section-cond E ${where}: {"held":"relic"} names no item of section manor: a gating condition reads only its own section (§4)`,
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM5f: module `flags` (engine plan §6.5): its lint, the rename target, an onFail that sets a flag

/** The 1-based line of the first line starting with `start` after the first one starting with `anchor`. */
function lineAfter(w: Json, anchor: string, start: string): number {
  const lines = `${JSON.stringify(w, null, 2)}\n`.split('\n');
  const from = lines.findIndex((l) => l.trimStart().startsWith(anchor));
  const i = from < 0 ? -1 : lines.findIndex((l, j) => j > from && l.trimStart().startsWith(start));
  if (i < 0) {
    throw new Error(`invariant: the fixture text has a line starting with ${start} after ${anchor}`);
  }
  return i + 1;
}

/**
 * Two sections: s declares `fs` and its mark sets it; t declares `ft` and its sign sets it. s gives the coin and the
 * medal, which a recipe combines into the amulet; s's gate and chest are bare (hotspots 3 and 4 of the hall).
 */
function flagWorld(): Json {
  const w = mini({
    items: ['coin', 'medal', 'amulet', 'key'],
    sections: {
      s: { start: 'hall', rooms: { hall: [object('mark', null, [{ set: 'fs' }]), take('coin', { item: 'coin' }), take('medal', { item: 'medal' }), object('gate', null), object('chest', lockOf(['coin'])), leave('out')] } },
      t: { start: 'yard', rooms: { yard: [object('sign', null, [{ set: 'ft' }]), take('key', { item: 'key' }), leave('out')] } },
    },
  });
  w['flags'] = { fs: { section: 's' }, ft: { section: 't' } };
  w['recipes'] = [{ a: 'coin', b: 'medal', gives: 'amulet', keep: [], say: null }];
  return w;
}

const HALL = 'sections.s.rooms.hall.hotspots';

test('story: a flag set outside its section is refused', () => {
  const w = flagWorld();
  // The set form: t's sign sets s's `fs` too (a trigger's section is its key's room's); its own `ft` beside it passes.
  list(spot(w, 'yard', 'sign', 't')['then']).push({ set: 'fs' });
  // The atom form, one site of each gating kind, each in s naming t's `ft`: the gate's `when` (by its hotspot's room),
  // the chest's `uses.when` (by its target's room) and the recipe's `when` (by `recipeSections`: s gives both inputs).
  spot(w, 'hall', 'gate', 's')['when'] = { flag: 'ft' };
  spot(w, 'hall', 'chest', 's')['uses'] = [{ item: 'coin', when: { flag: 'ft' } }];
  obj(list(w['recipes'])[0])['when'] = { flag: 'ft' };
  // A visual site reads any flag of the chapter: the mark's picture follows t's `ft`, and is not refused.
  const mark = spot(w, 'hall', 'mark', 's');
  mark['states'] = { lit: { prop: null } };
  mark['is'] = [{ when: { flag: 'ft' }, state: 'lit' }];
  const found = lint(w).filter((f) => f.code.startsWith('world/flag-'));
  const scope = (f: string, s: string, t: string): string => `flag '${f}' is declared in section ${s}: a gating condition of section ${t} reads only its own section's flags (§4)`;
  // One finding per form and site kind, each at its line, in the file's order (the runner sorts by line).
  expect(found.map((f) => [f.code, f.line, f.message])).toEqual([
    ['world/flag-scope', lineAfter(w, '"id": "gate"', '"when": {'), `${HALL}.3.when: ${scope('ft', 't', 's')}`],
    ['world/flag-scope', lineAfter(w, '"id": "chest"', '"when": {'), `${HALL}.4.uses.0.when: ${scope('ft', 't', 's')}`],
    ['world/flag-scope', lineAfter(w, '"id": "sign"', '"set": "fs"'), "sections.t.rooms.yard.hotspots.0.then.1.set: flag 'fs' is declared in section s and set in section t: a flag is set only by its own section's effects (X15)"],
    ['world/flag-scope', lineAfter(w, '"recipes": [', '"when": {'), `recipes.0.when: ${scope('ft', 't', 's')}`],
  ]);
});

test('story: a flag reference names a declared flag', () => {
  const w = flagWorld();
  // A declaration in a section the world lacks, a set of an undeclared flag, and an undeclared flag at each site.
  w['flags'] = { fs: { section: 's' }, ft: { section: 't' }, fx: { section: 'nowhere' } };
  list(spot(w, 'hall', 'mark', 's')['then']).push({ set: 'ghost' });
  spot(w, 'hall', 'gate', 's')['when'] = { flag: 'ghost' };
  spot(w, 'hall', 'chest', 's')['uses'] = [{ item: 'coin', when: { flag: 'ghost' } }];
  obj(list(w['recipes'])[0])['when'] = { flag: 'ghost' };
  const mark = spot(w, 'hall', 'mark', 's');
  mark['states'] = { lit: { prop: null } };
  mark['is'] = [{ when: { flag: 'ghost' }, state: 'lit' }];
  w['puzzles'] = { dial: { ...codePuzzle(), clues: [{ flag: 'ghost' }] } };
  const found = lint(w).filter((f) => f.code.startsWith('world/flag-'));
  const ghost = "flag 'ghost' is not declared";
  // Each at its line, in the file's order (the runner sorts by line).
  expect(found.map((f) => [f.code, f.line, f.message])).toEqual([
    ['world/flag-unknown-ref', lineAfter(w, '"clues": [', '{'), `puzzles.dial.clues.0: ${ghost}`],
    ['world/flag-unknown-ref', jsonLine(w, '"set": "ghost"'), `${HALL}.0.then.1.set: ${ghost}`],
    ['world/flag-unknown-ref', lineAfter(w, '"is": [', '"when": {'), `${HALL}.0.is.0.when: ${ghost}`],
    ['world/flag-unknown-ref', lineAfter(w, '"id": "gate"', '"when": {'), `${HALL}.3.when: ${ghost}`],
    ['world/flag-unknown-ref', lineAfter(w, '"id": "chest"', '"when": {'), `${HALL}.4.uses.0.when: ${ghost}`],
    ['world/flag-unknown-ref', jsonLine(w, '"section": "nowhere"'), "flags.fx.section: section 'nowhere' of flag 'fx' is not defined"],
    ['world/flag-unknown-ref', lineAfter(w, '"recipes": [', '"when": {'), `recipes.0.when: ${ghost}`],
  ]);
});

test('story: a flag set outside its section is refused at an onEnter and at a lock trigger', () => {
  // The set form at the other kernel triggers: t's yard sets s's `fs` on entry; s's chest (a coin lock) sets t's `ft`
  // in its onOpen and its onFail. An `enter` trigger's section is its room's, a lock trigger's its hotspot's.
  const w = flagWorld();
  at(w, 'sections.t.rooms.yard')['onEnter'] = [{ set: 'fs' }];
  const lock = obj(spot(w, 'hall', 'chest', 's')['lock']);
  lock['onOpen'] = [{ set: 'ft' }];
  lock['onFail'] = [{ set: 'ft' }];
  const found = lint(w).filter((f) => f.code === 'world/flag-scope');
  const scope = (f: string, s: string, t: string): string => `flag '${f}' is declared in section ${s} and set in section ${t}: a flag is set only by its own section's effects (X15)`;
  // Each at its line, in the file's order (the runner sorts by line).
  expect(found.map((f) => [f.code, f.line, f.message])).toEqual([
    ['world/flag-scope', lineAfter(w, '"onOpen": [', '"set": "ft"'), `${HALL}.4.lock.onOpen.0.set: ${scope('ft', 't', 's')}`],
    ['world/flag-scope', lineAfter(w, '"onFail": [', '"set": "ft"'), `${HALL}.4.lock.onFail.0.set: ${scope('ft', 't', 's')}`],
    ['world/flag-scope', lineAfter(w, '"yard": {', '"set": "fs"'), `sections.t.rooms.yard.onEnter.0.set: ${scope('fs', 's', 't')}`],
  ]);
});

test('story: an undeclared flag in a decor picture is refused', () => {
  // The visual site of a room's decor: the hall's rug follows the undeclared `ghost`.
  const w = flagWorld();
  at(w, 'sections.s.rooms.hall')['decor'] = [
    { id: 'rug', prop: 'rug', rect: [0, 0, 100, 100], z: 1, states: { worn: { prop: null } }, is: [{ when: { flag: 'ghost' }, state: 'worn' }] },
  ];
  const found = lint(w).filter((f) => f.code.startsWith('world/flag-'));
  expect(found.map((f) => [f.code, f.line, f.message])).toEqual([
    ['world/flag-unknown-ref', lineAfter(w, '"decor": [', '"when": {'), "sections.s.rooms.hall.decor.0.is.0.when: flag 'ghost' is not declared"],
  ]);
});

test('story: a declared flag is a valid rename target', () => {
  // GM2b Q1: a rename's target must be live; a declared flag is (`liveIds`), so the chain to it raises nothing.
  const w = renamedBase({ flags: { fl_a: 'fl_b' } });
  w['flags'] = { fl_b: { section: 'manor' } };
  expect(run(w, { declared: MANOR_VARS }).findings).toEqual([]);
});

test('story: an onFail that sets a flag is an effect', () => {
  // D9: a lock whose fail only sets a flag (one that reveals a way on, say) has an onFail effect; the proof judges it.
  const w = base();
  w['flags'] = { f: { section: 'manor' } };
  obj(spot(w, 'hall', 'gate')['lock'])['onFail'] = [{ set: 'f' }];
  expect(of(lint(w), 'world/fail-without-effect')).toEqual([]);
  // The control: with no effect at all the lock is refused.
  obj(spot(w, 'hall', 'gate')['lock'])['onFail'] = [];
  expect(of(lint(w), 'world/fail-without-effect').map((f) => f.line)).toEqual([lineAfter(w, '"id": "gate"', '"onFail": [')]);
});

test("story: a hotspot when naming another section's fact is refused", () => {
  // W1: s's gate shows only while t's key is not held, a kernel fact of t. A player who walks in holding it sees no
  // gate, and neither s's proof (from its entry, where the key is never held) nor s's reset can see it (X15, §4).
  const w = flagWorld();
  spot(w, 'hall', 'gate', 's')['when'] = { not: { held: 'key' } };
  expect(of(lint(w), 'world/cross-section-cond').map((f) => [f.line, f.message])).toEqual([
    [lineAfter(w, '"id": "gate"', '"when": {'), `${HALL}.3.when: {"held":"key"} names no item of section s: a gating condition reads only its own section (§4)`],
  ]);
  // The same-section control: s's own coin raises nothing.
  spot(w, 'hall', 'gate', 's')['when'] = { not: { held: 'coin' } };
  expect(of(lint(w), 'world/cross-section-cond')).toEqual([]);
});

test('story: a finding after a module effect names its source line', () => {
  // GM3c O2: the decoder routes a `set` out of its kernel list, so a kernel effect after it sits at a compacted index;
  // a finding names the effect's source index, and so the author's line, not the set's.
  const w = flagWorld();
  list(spot(w, 'hall', 'mark', 's')['then']).push({ give: 'nope' });
  list(spot(w, 'yard', 'sign', 't')['then']).push({ unlock: 'hall.chest' });
  const found = lint(w, { knots: null });
  const lines = (code: Finding['code']): number[] => of(found, code).map((f) => f.line);
  expect([lines('world/unknown-ref'), lines('world/cross-section-effect')]).toEqual([[jsonLine(w, '"give": "nope"')], [jsonLine(w, '"unlock": "hall.chest"')]]);
  expect(of(found, 'world/cross-section-effect').map((f) => f.message)).toEqual(['yard.sign then (section t) unlocks hall.chest of section s (X15: a trigger writes only its own section)']);
});

test('story: a gift after a module effect names its source line', () => {
  // R2's gift site: s's mark gives t's key after its set, so the give sits at a compacted index of its kernel list; the
  // cross-section finding names the give's source index, and so its line, not the set's.
  const w = flagWorld();
  list(spot(w, 'hall', 'mark', 's')['then']).push({ give: 'key' });
  const found = of(lint(w, { knots: null }), 'world/cross-section-effect');
  expect(found.map((f) => f.line)).toEqual([jsonLine(w, '"give": "key"')]);
  // Non-vacuous: the set's line is another line.
  expect(jsonLine(w, '"set": "fs"')).not.toBe(jsonLine(w, '"give": "key"'));
});

test('story: a lone flag clue is seen once its setter fires', () => {
  // A7's pin: the gate's clue is a flag the hall's inscription sets, and no gating rule reads it, so under D7 the flag
  // is in no key part and the set's successor keys as its parent; the clue is seen at the edge that sets it, as a look's
  // `examined` is (`unseenClues` observes every reported successor, known ones included).
  const lone = (set: boolean): Json => {
    const w = base();
    w['flags'] = { f: { section: 'manor' } };
    spot(w, 'hall', 'inscription')['then'] = set ? [{ set: 'f' }] : [];
    at(w, 'puzzles.gate')['clues'] = [{ flag: 'f' }];
    return w;
  };
  expect(of(lint(lone(true)), 'world/clue-reachable')).toEqual([]);
  // The negative control (non-vacuity): without the set no state holds `f`, and the clue is refused at its line.
  const unset = lone(false);
  expect(of(lint(unset), 'world/clue-reachable').map((f) => [f.line, f.message])).toEqual([
    [clueLine(unset, 'gate', 0), `puzzle 'gate': clue {"flag":"f"} holds in no state of section manor reached before 'gate' is solved or failed (§7.3)`],
  ]);
});

test('story: a part atom in a gating condition is refused at its line, not a crash', () => {
  // Fix1 item 4 (proof P1): a `part` atom is visual-only (`gating: false`), and in a gating site (a hotspot `when`, a
  // `uses.when`, a recipe `when`) its read would reach the section key, which cannot encode it (`keyPlan`'s invariant).
  // The soft-lock check and the clue lint skip such a section (`gatesVisualOnly`), so the gate refuses the world at the
  // author's line instead of dying. The manor's `drawer` (a secret code puzzle on one lock, with a clue) makes the clue
  // lint search `manor` in every case. A skipped section is unsearched (`states` null), so world.ts's unreachable pass
  // sees no module gift in it: the use rule's coin and the recipe's amulet are reported W (critique W1, carried with
  // Q-F2), as in a capped section.
  const sites = (atom: Json): ReadonlyArray<readonly [path: string, put: (w: Json) => void]> => [
    ['sections.manor.rooms.hall.hotspots.2.when', (w) => (spot(w, 'hall', 'inscription')['when'] = atom)],
    ['sections.manor.rooms.hall.hotspots.2.uses.0.when', (w) => (obj(list(spot(w, 'hall', 'inscription')['uses'])[0])['when'] = atom)],
    ['recipes.0.when', (w) => (obj(list(w['recipes'])[0])['when'] = atom)],
  ];
  const plain = (): Json => recipeBase(() => t('manor', 'Монета легла в оправу.'));
  // The device: a view `desk` of the study, entered by the study's `to_desk`, whose device `dial` is a zero-slot lock on
  // the secret code puzzle `dial` (a clue). A code puzzle is no view type, so `world/device-type` refuses it.
  const desk = (): Json => {
    const w = plain();
    at(w, 'puzzles')['dial'] = {
      type: 'code',
      title: t('dial', 'Замок стола'),
      prompt: t('dial', 'Четыре диска.'),
      closeup: null,
      params: { dials: 4 },
      maxAttempts: null,
      giveUp: false,
      solution: [1, 8, 4, 7],
      hints: [t('dial', 'Год упоминается в письме.')],
      clues: [{ doc: 'letter' }],
    };
    hotspots(w, 'study').push(demoExit('to_desk', [700, 1500, 300, 200], { room: 'desk' }));
    const lock = { slots: [], puzzle: 'dial', locked: t('manor', 'Заперто.'), onOpen: [], onFail: [] };
    const dial = { id: 'dial', kind: 'object', rect: [400, 800, 300, 300], label: t('manor', 'Замок'), lock, then: [], look: null, prop: null };
    at(w, 'sections.manor.rooms')['desk'] = { bg: 'study', title: t('manor', 'Стол'), onEnter: [], view: { of: 'study' }, device: 'dial', hotspots: [dial] };
    return w;
  };
  const deviceType = (w: Json): Finding[] => [
    { code: 'world/device-type', severity: 'E', file: FILE, line: jsonLine(w, '"device": "dial"'), message: "sections.manor.rooms.desk.device: puzzle 'dial' is a code puzzle: a device's puzzle is of a view type (§7.5)" },
  ];
  const unreachable = (w: Json, item: string): Finding => ({ code: 'world/unreachable', severity: 'W', file: FILE, line: jsonLine(w, `"${item}": {`), message: `item '${item}': no reachable state holds it` });
  const cases: ReadonlyArray<readonly [label: string, make: () => Json, puzzle: string, own: (w: Json) => Finding[]]> = [
    ['no device', plain, 'drawer', () => []],
    ['a device', desk, 'dial', deviceType],
  ];
  for (const [label, make, puzzle, own] of cases) {
    // The control: searched (non-vacuity), and clean but for its own pinned findings.
    const control = make();
    const checked = run(control);
    expect(checked.findings, `${label}: the control`).toEqual(own(control));
    expect(checked.sections.map((s) => typeof s.states), `${label}: the control is searched`).toEqual(['number']);
    const atom = { part: { puzzle, index: 0, is: 1 } };
    for (const [path, put] of sites(atom)) {
      const w = make();
      put(w);
      const r = run(w); // the story gate's own path, which must not throw
      const refused: Finding = {
        code: 'world/visual-only-atom',
        severity: 'E',
        file: FILE,
        line: jsonLine(w, '"when"'),
        message: `${path}: ${JSON.stringify(atom)} is a visual-only atom: a gating condition never reads it (§4)`,
      };
      const expected = [unreachable(w, 'coin'), unreachable(w, 'amulet'), refused, ...own(w)].sort((a, b) => a.line - b.line);
      expect(r.findings, `${label}, ${path}`).toEqual(expected);
      expect(r.sections.map((s) => s.states), `${label}, ${path}: unsearched`).toEqual([null]);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// GM9p: the carry proof (engine plan §6.6). A giving world marks `items.<id>.carry: true`; a receiving world lists
// `inherits: [{ id, required }]`; story/items.json registers each carried item's giving chapter.

/** The demo manor with a lamp declared (no section gives it) and `inherits` set, unless null. */
function receiver(inherits: readonly unknown[] | null): Json {
  const w = base();
  obj(w['items'])['lamp'] = { name: t('lamp', 'Лампа'), desc: t('lamp', 'Старая лампа.'), glyph: 'key' };
  if (inherits !== null) {
    w['inherits'] = inherits;
  }
  return w;
}

/** The line of `inherits.<n>` in the fixture's two-space JSON: each entry `{ id, required }` spans four lines. */
function inheritLine(w: Json, n: number): number {
  return jsonLine(w, '"inherits": [') + 1 + 4 * n;
}

/** The findings of the carry codes, as `code line message`. */
function carrySeen(findings: readonly Finding[]): string[] {
  return findings.filter((f) => f.code.startsWith('world/carry-') || f.code.startsWith('world/inherit-')).map((f) => `${f.code} ${f.line} ${f.message}`);
}

test("carry: a receiver's inherits and a giver's mark decode into mods.carry", () => {
  const w = receiver([
    { id: 'lamp', required: true },
    { id: 'rope', required: false },
  ]);
  at(w, 'items.medal_sun')['carry'] = true;
  const r = decodeWorldSource(w);
  if (!r.ok) {
    throw new Error(`invariant: the fixture decodes: ${JSON.stringify(r.error)}`);
  }
  const d = r.value.mods.carry;
  expect(d).toEqual({
    marks: ['medal_sun'],
    inherits: [
      { id: 'lamp', required: true },
      { id: 'rope', required: false },
    ],
  });
  // Plain JSON (registry.test.ts's form for every module's data).
  expect(d).toStrictEqual(JSON.parse(JSON.stringify(d)));
  // Through the public body and back: the same data, each key after the kernel's of its place.
  const pub = JSON.parse(JSON.stringify(toPublic(r.value))) as Json; // the body's JSON, owned keys untyped there
  expect(Object.keys(at(pub, 'items.medal_sun'))).toEqual(['name', 'desc', 'glyph', 'carry']);
  expect(Object.keys(pub).at(-1)).toBe('inherits');
  const back = decodeWorldPublic({ ...pub, version: '0123456789abcdef' });
  expect(back.ok ? back.value.mods.carry : back.error).toEqual(d);
  // Strict: each issue a world/schema finding at its own path.
  const schema = (inherits: unknown, mark: unknown = undefined): string[] => {
    const x = receiver([]);
    x['inherits'] = inherits;
    if (mark !== undefined) {
      at(x, 'items.medal_sun')['carry'] = mark;
    }
    return of(lint(x), 'world/schema').map((f) => f.message);
  };
  expect(schema([{ id: 'lamp', required: true, note: 1 }])).toEqual(['inherits.0.note: unknown key (expected id, required)']);
  expect(schema([{ id: 'lamp', required: 'yes' }])).toEqual(['inherits.0.required: not a boolean']);
  expect(schema([{ id: 'lamp' }])).toEqual(['inherits.0.required: not a boolean']);
  expect(
    schema([
      { id: 'lamp', required: true },
      { id: 'lamp', required: false },
    ]),
  ).toEqual(["inherits.1.id: 'lamp' repeats"]);
  expect(schema([{ id: 'Lamp', required: true }])).toEqual(['inherits.0.id: not an item id ^[a-z][a-z0-9_]*$']);
  expect(schema({ id: 'lamp', required: true })).toEqual(['inherits: not an array']);
  expect(schema(['lamp'])).toEqual(['inherits.0: not an { id, required } object']);
  expect(schema([], false)).toEqual(['items.medal_sun.carry: not true (omit the key)']);
  // The control of the rows above: the same receiver, well formed.
  expect(schema([{ id: 'lamp', required: true }])).toEqual([]);
  // At the author's line.
  const bad = receiver([{ id: 'lamp', required: 'yes' }]);
  expect(of(lint(bad), 'world/schema').map((f) => f.line)).toEqual([jsonLine(bad, '"required": "yes"')]);
});

test('carry: an inherited item is a declared item no section of the receiver gives', () => {
  // The control: the lamp is declared and no section gives it.
  expect(carrySeen(lint(receiver([{ id: 'lamp', required: true }])))).toEqual([]);
  const given = (id: string, edit: (x: Json) => void = () => undefined): string[] => {
    const x = receiver([{ id, required: true }]);
    edit(x);
    return carrySeen(lint(x));
  };
  const line = inheritLine(receiver([{ id: 'lamp', required: true }]), 0);
  const refused = (id: string): string[] => [`world/inherit-item ${line} item '${id}' is inherited and given in section manor: its reset would drop the inherited item (§6.6)`];
  // A kernel gift: the study's take, the drawer's `give` effect.
  expect(given('medal_sun')).toEqual(refused('medal_sun'));
  expect(given('medal_moon')).toEqual(refused('medal_moon'));
  // A module gift: a recipe's product (S's own items, `ownScope`).
  expect(given('lamp', (x) => (x['recipes'] = [{ a: 'medal_sun', b: 'medal_star', gives: 'lamp' }]))).toEqual(refused('lamp'));
  // An undeclared item: the receiver declares the texts of what it inherits.
  expect(given('ghost')).toEqual([`world/inherit-item ${line} item 'ghost' is inherited but not declared in items: the receiver declares its texts (§6.6)`]);
});

test('carry: more than three optional inherited items are refused', () => {
  const world = (optional: number, required: number): Json => {
    const ids = ['rope', 'map', 'coin', 'ring', 'lamp'].slice(0, optional + required);
    const w = receiver(ids.map((id, i) => ({ id, required: i >= optional })));
    for (const id of ids.filter((x) => x !== 'lamp')) {
      obj(w['items'])[id] = { name: t(id, 'Предмет'), desc: t(id, 'Описание.'), glyph: 'key' };
    }
    return w;
  };
  const four = world(4, 0);
  expect(carrySeen(lint(four))).toEqual([
    `world/inherit-count ${jsonLine(four, '"inherits": [')} 4 optional inherited items: at most 3, each doubles the starts a section proves (§6.6)`,
  ]);
  // The edge, and required items, which do not count.
  expect(carrySeen(lint(world(3, 0)))).toEqual([]);
  expect(carrySeen(lint(world(3, 2)))).toEqual([]);
});

test('carry: a carry-less world encodes no carry key', () => {
  const plain = decodeWorldSource(base());
  if (!plain.ok) {
    throw new Error('invariant: the demo manor decodes');
  }
  expect(plain.value.mods.carry).toEqual({ marks: [], inherits: [] });
  expect(MECHANIC_DATA[7].encode(plain.value.mods.carry)).toEqual([]);
  // So its public body is the kernel's: no `inherits`, no item's `carry`.
  const pub = JSON.stringify(toPublic(plain.value));
  expect(pub).not.toContain('"inherits"');
  expect(pub).not.toContain('"carry"');
});

// ---------------------------------------------------------------------------------------------------------------
// GM9p: the story-level pass. Unit rows build the graph (`mustPass`, `carryPaths`) and hand `carryProof` plain data;
// the in-process rows run the story gate's `main` over a fixture repo (D9), never the committed story.

type KnotSpec = { readonly next?: readonly string[]; readonly ending?: boolean };

/** A hand-built graph: its knots in the given order (the first is the first knot), and its section edges. */
function knotGraph(knots: Readonly<Record<string, KnotSpec>>, edges: Readonly<Record<string, readonly string[]>> = {}): ChapterGraph {
  const kn = (s: string): KnotName => s as KnotName; // fixture knot names
  const nodes = new Map(
    Object.entries(knots).map(([name, k], i) => [
      kn(name),
      { name: kn(name), file: 'ch1/main.ink', line: i + 1, assets: [], next: (k.next ?? []).map(kn), ending: k.ending ?? false, clears: { all: false, bg: false, cg: false, chars: [] } },
    ]),
  );
  return {
    chapter: CH1.id,
    firstKnot: kn(Object.keys(knots)[0] ?? ''),
    knots: nodes,
    globals: [],
    vars: [],
    lines: [],
    carried: new Map(),
    sections: { edges: new Map(Object.entries(edges).map(([k, v]) => [kn(k), v.map(kn)])), seeds: new Map(), rooms: new Map() },
  };
}

const knots = (...names: string[]): ReadonlySet<KnotName> => new Set(names as KnotName[]); // fixture knot names

test('graph: mustPass is true iff every path from the start to a target passes an avoided knot', () => {
  const diamond = knotGraph({ a: { next: ['b', 'c'] }, b: { next: ['d'] }, c: { next: ['d'] }, d: { ending: true } });
  const a = 'a' as KnotName;
  // Around the avoided knot: false; every path through it: true.
  expect(mustPass(diamond, a, knots('b'), knots('d'))).toBe(false);
  expect(mustPass(diamond, a, knots('b', 'c'), knots('d'))).toBe(true);
  const line = knotGraph({ a: { next: ['b'] }, b: { next: ['d'] }, d: { ending: true }, z: { ending: true } });
  expect(mustPass(line, a, knots('b'), knots('d'))).toBe(true);
  expect(mustPass(line, a, knots(), knots('d'))).toBe(false);
  // Vacuous: an unreachable target, a start in `avoid`, a target in `avoid`, a start that is no knot.
  expect(mustPass(line, a, knots(), knots('z'))).toBe(true);
  expect(mustPass(line, a, knots('a'), knots('d'))).toBe(true);
  expect(mustPass(line, a, knots('d'), knots('d'))).toBe(true);
  expect(mustPass(line, 'nowhere' as KnotName, knots(), knots('d'))).toBe(true); // a fixture knot name
  // A section edge is a path too: a target reached only over one is reached.
  const yielded = knotGraph({ a: {}, out: { ending: true } }, { a: ['out'] });
  expect(mustPass(yielded, a, knots('b'), knots('out'))).toBe(false);
  expect(mustPass(yielded, a, knots('a'), knots('out'))).toBe(true);
});

/** A fixture world as the carry pass reads it: its two-space text, decoded the way the story gate decodes it. */
function carryWorldOf(w: Json): CarryWorld {
  const text = `${JSON.stringify(w, null, 2)}\n`;
  const decoded = decodeWorldFile({ file: FILE, text });
  if (decoded.world === null) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(decoded.findings)}`);
  }
  return { kind: 'ok', source: decoded.world, text };
}

/** The demo manor marking the sun medallion, which its study gives and its gate's slot keeps (a required carried item
 *  is never used up on its way, §6.6). */
function giver(): Json {
  const w = base();
  at(w, 'items.medal_sun')['carry'] = true;
  list(obj(gateOf(w)['lock'])['slots'])[0] = { accepts: 'medal_sun', keep: true };
  return w;
}

/** The demo manor's gate, whose lock's slot 0 accepts the sun medallion. */
function gateOf(w: Json): Json {
  return obj(hotspots(w, 'hall').find((h) => h['id'] === 'gate'));
}

/** A small receiving world declaring the sun medallion, which no section of it gives, inheriting `inherits`. */
function heir(inherits: readonly Json[] = [{ id: 'medal_sun', required: true }], mark = false): Json {
  const w = mini({ items: ['medal_sun'], sections: { s: { start: 'hall', rooms: { hall: [leave('out')] } } } });
  w['inherits'] = inherits;
  if (mark) {
    at(w, 'items.medal_sun')['carry'] = true;
  }
  return w;
}

const ch = (id: string): ChapterId => id as ChapterId; // fixture chapter ids

/** A listed chapter for `carryProof`: no paths unless given (no path verdict). */
function carryChapter(id: string, next: string | null, world: Json | null, paths: ReadonlyMap<SectionId, SectionPath> | null = null, paid = false): CarryChapter {
  return { id: ch(id), paid, next: next === null ? null : ch(next), world: world === null ? { kind: 'none' } : carryWorldOf(world), paths };
}

/** The carry findings as `code file:line`. */
function carried(findings: readonly Finding[]): string[] {
  return findings.map((f) => `${f.code} ${f.file}:${f.line}`);
}

const SUN_ROW = '[{ "id": "medal_sun", "from": "ch1" }]\n';

/** ch1 entering the manor from `start`, with a choice that also leads to an END of its own when `bypass`. */
function enterManor(bypass: boolean): string[] {
  const choice = bypass ? ['* [Войти #id:ch1.start.c001]', '    -> hall', '* [Уйти #id:ch1.start.c002]', '    -> away'] : ['-> hall'];
  const away = bypass ? ['=== away ===', 'Мы ушли. #id:ch1.away.a003', '-> END'] : [];
  return [...INK_HEAD, 'Перед усадьбой. #id:ch1.start.a001', ...choice, '=== hall ===', 'Мы вошли. #id:ch1.hall.a002', '# explore: manor', '-> DONE', ...away, '=== manor_out ===', 'Мы вышли. #id:ch1.manor_out.a004', '-> END'];
}

/** The manor giver's chapter (ch1) built from `main`, its declared story endings `endings`, the medallion's receiver ch2
 *  after it. */
function proofOf(main: readonly string[], endings: Readonly<Record<string, string>> = {}): Finding[] {
  const w = giver();
  const g = graphWith(main, okWorld(w));
  const declared = new Map(Object.entries(endings) as Array<[KnotName, EndingName]>); // fixture knot and ending names
  const chapters = [carryChapter('ch1', 'ch2', w, carryPaths(g.graph, g.facts, declared)), carryChapter('ch2', null, heir())];
  return carryProof({ chapters, registry: SUN_ROW }).findings;
}

test('carry: a continuing END reachable without the giver yield is refused', () => {
  const main = enterManor(true);
  const yieldLine = lineIn(main, '# explore: manor');
  expect(proofOf(main).map((f) => `${f.code} ${f.file}:${f.line} ${f.message}`)).toEqual([
    `world/carry-required-path story/ch1/main.ink:${yieldLine} section manor gives item 'medal_sun', which ch2 inherits as required, but the END of knot 'away' is reachable without a yield of manor (§6.6)`,
  ]);
  // The control: the manor's yield is on every path to an END.
  expect(proofOf(enterManor(false))).toEqual([]);
  // The manor never yielded: refused at the giver's section.
  const never = [...INK_HEAD, 'Перед усадьбой. #id:ch1.start.a001', '-> manor_out', '=== manor_out ===', 'Мы вышли. #id:ch1.manor_out.a004', '-> END'];
  expect(carried(proofOf(never))).toEqual([`world/carry-required-path ${FILE}:${jsonLine(giver(), '"manor": {')}`]);
});

test('carry: a story ending reachable before the giver is allowed', () => {
  // ch3's `shore_drowned` shape: before the manor, a choice may end the story (a declared ending) or walk away (an END
  // the story continues after, to ch2).
  const main = [
    ...INK_HEAD,
    'Перед усадьбой. #id:ch1.start.a001',
    '* [Войти #id:ch1.start.c001]',
    '    -> hall',
    '* [Утонуть #id:ch1.start.c002]',
    '    -> drowned',
    '=== hall ===',
    'Мы вошли. #id:ch1.hall.a002',
    '# explore: manor',
    '-> DONE',
    '=== drowned ===',
    'Волна накрыла нас. #id:ch1.drowned.a003',
    '-> END',
    '=== manor_out ===',
    'Мы вышли. #id:ch1.manor_out.a004',
    '-> END',
  ];
  expect(proofOf(main, { drowned: 'drowned' })).toEqual([]);
  // The same END undeclared continues the story, so it is refused (the plan's m5: every END counted, T2's red).
  expect(proofOf(main).map((f) => `${f.code} ${f.line} ${f.message.slice(f.message.indexOf('END'))}`)).toEqual([
    `world/carry-required-path ${lineIn(main, '# explore: manor')} END of knot 'drowned' is reachable without a yield of manor (§6.6)`,
  ]);
  // A declared ending beside a continuing END: the continuing one is still refused.
  const both = enterManor(true);
  expect(proofOf(both, { manor_out: 'out' }).map((f) => f.message.slice(f.message.indexOf('END')))).toEqual(["END of knot 'away' is reachable without a yield of manor (§6.6)"]);
  expect(proofOf(both, { away: 'away' })).toEqual([]);
});

test('carry: an inherited item is checked against story/items.json', () => {
  const run = (chapters: readonly CarryChapter[], registry: string | null): string[] => carried(carryProof({ chapters, registry }).findings);
  const said = (chapters: readonly CarryChapter[], registry: string | null): string[] => carryProof({ chapters, registry }).findings.map((f) => `${f.code} ${f.file}:${f.line} ${f.message}`);
  const inherit = `story/ch2/world.json:${inheritLine(heir(), 0)}`;
  const markOf = (c: string, w: Json): string => `world/carry-mark story/${c}/world.json:${jsonLine(w, '"carry": true')}`;
  const pair = (r: Json = heir(), g: Json = giver()): CarryChapter[] => [carryChapter('ch1', 'ch2', g), carryChapter('ch2', null, r)];
  // The consistent control: ch1 gives and marks the medallion, ch2 inherits it, the row names ch1.
  expect(run(pair(), SUN_ROW)).toEqual([]);
  // No row, in an empty registry or an absent one (so ch1's mark has none either).
  expect(run(pair(), '[]')).toEqual([`world/carry-inherit ${inherit}`, markOf('ch1', giver())]);
  expect(run(pair(), null)).toEqual([`world/carry-inherit ${inherit}`, markOf('ch1', giver())]);
  // Two rows for one id: the repeat refused at its own line, and nothing that names the id judged again.
  const twice = '[\n  { "id": "medal_sun", "from": "ch1" },\n  { "id": "medal_sun", "from": "ch1" }\n]\n';
  expect(said(pair(), twice)).toEqual(["world/carry-registry story/items.json:3 1.id: item 'medal_sun' has row 0 too: one giving chapter per carried item"]);
  // `from` not before the receiver on its chain: another chain (story/chapters.json's shape, ch1 -> ch2, ch3 -> ch4),
  // later on the receiver's own chain (ch1 -> ch2 -> ch3), the receiver itself. ch3 gives the medallion and marks
  // nothing, so each control (the row naming ch1) is clean; in each refusal ch1's mark has a row naming another chapter.
  const notBefore = (from: string): string => `world/carry-inherit ${inherit} item 'medal_sun': it comes from ${from}, which is not before ch2 on its chain (§6.6)`;
  const misplaced = `${markOf('ch1', giver())} item 'medal_sun' is marked carry: true, but story/items.json gives it from ch3 and ch1 does not inherit it (§6.6)`;
  const chains = [carryChapter('ch1', 'ch2', giver()), carryChapter('ch2', null, heir()), carryChapter('ch3', 'ch4', base()), carryChapter('ch4', null, null)];
  expect(said(chains, SUN_ROW)).toEqual([]);
  expect(said(chains, '[{ "id": "medal_sun", "from": "ch3" }]')).toEqual([notBefore('ch3'), misplaced]);
  const three = [carryChapter('ch1', 'ch2', giver()), carryChapter('ch2', 'ch3', heir()), carryChapter('ch3', null, base())];
  expect(said(three, SUN_ROW)).toEqual([]);
  expect(said(three, '[{ "id": "medal_sun", "from": "ch3" }]')).toEqual([notBefore('ch3'), misplaced]);
  // The receiver as its own giver: its world gives and marks the medallion.
  const self = [carryChapter('ch1', 'ch2', base()), carryChapter('ch2', null, { ...giver(), inherits: [{ id: 'medal_sun', required: true }] })];
  const selfLine = inheritLine({ ...giver(), inherits: [{ id: 'medal_sun', required: true }] }, 0);
  expect(said(self, '[{ "id": "medal_sun", "from": "ch2" }]')).toEqual([
    `world/carry-inherit story/ch2/world.json:${selfLine} item 'medal_sun': story/items.json gives it from ch2 itself (§6.6)`,
  ]);
  // The giver's world does not mark it.
  expect(said(pair(heir(), base()), SUN_ROW)).toEqual([`world/carry-inherit ${inherit} item 'medal_sun': ch1's world does not mark it carry: true (§6.6)`]);
  // A mark with no row; a mark with a row and no receiver (no finding); a mark at a chapter that neither gives nor
  // inherits the item.
  expect(run([carryChapter('ch1', null, giver())], '[]')).toEqual([markOf('ch1', giver())]);
  expect(run([carryChapter('ch1', null, giver())], SUN_ROW)).toEqual([]);
  const marked = heir([], true);
  expect(run(pair(marked), SUN_ROW)).toEqual([markOf('ch2', marked)]);
  // A row whose giving chapter gives its item in no section: refused at the row.
  expect(said(pair(), '[{ "id": "medal_sun", "from": "ch1" }, { "id": "lamp", "from": "ch1" }]')).toEqual([
    "world/carry-registry story/items.json:1 1: chapter ch1 gives item 'lamp' in no section of its world (§6.6)",
  ]);
  // story/items.json not JSON, or not an array: one finding, and nothing that needs its rows is judged.
  expect(run(pair(), '[{ "id": ')).toEqual(['world/carry-registry story/items.json:0']);
  expect(run(pair(), '{}')).toEqual(['world/carry-registry story/items.json:0']);
  // A chain item: ch2 inherits and re-marks it, ch3 inherits it from ch1, whatever ch2 holds.
  const chain = [carryChapter('ch1', 'ch2', giver()), carryChapter('ch2', 'ch3', heir([{ id: 'medal_sun', required: false }], true)), carryChapter('ch3', null, heir())];
  expect(run(chain, SUN_ROW)).toEqual([]);
});

// The in-process story gate (D9): `main` over a fixture repo in a temp directory, its console captured.

/** A spawned or in-process run loads inkjs/full and compiles: allow for a loaded machine (build.test.ts's value). */
const IN_PROCESS_TIMEOUT_MS = 60_000;
/** The marker a fixture world's texts are written with: `repoWorld` replaces each with a fresh text of its chapter. */
const TEXT = '<text>';

/** A fixture world of chapter `ch` in the source format: `sections` of rooms (the first room is the start, every room's
 *  bg is `room`, rects on mini()'s grid), `items` with any extra keys, then `top` keys; each TEXT a fresh line. */
function repoWorld(ch: string, spec: { items?: Readonly<Record<string, Json>>; sections: Readonly<Record<string, Readonly<Record<string, readonly Json[]>>>>; top?: Json }): Json {
  let n = 0;
  const fill = (v: unknown): unknown => {
    if (v === TEXT) {
      const id = `${ch}.w.${(n++).toString(36).padStart(4, '0')}`;
      return { id, ru: `${ch} текст ${n}` };
    }
    if (Array.isArray(v)) {
      return v.map(fill);
    }
    return typeof v === 'object' && v !== null ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
  };
  const room = (spots: readonly Json[]): Json => ({ bg: 'room', title: TEXT, onEnter: [], hotspots: spots.map((h, i) => ({ ...h, rect: [100 + (i % 3) * 300, 300 + Math.floor(i / 3) * 300, 200, 200] })) });
  const sections = Object.fromEntries(Object.entries(spec.sections).map(([id, rooms]) => [id, { start: Object.keys(rooms)[0], bgm: null, rooms: Object.fromEntries(Object.entries(rooms).map(([r, spots]) => [r, room(spots)])) }]));
  const items = Object.fromEntries(Object.entries(spec.items ?? {}).map(([id, extra]) => [id, { name: TEXT, desc: TEXT, glyph: 'key', ...extra }]));
  return obj(fill({ format: 1, items, docs: {}, puzzles: {}, sections, ...spec.top }));
}

const takeIt = (id: string, item: string): Json => ({ id, kind: 'take', label: TEXT, gives: { item }, prop: null, then: [] });
/** An exit to the leave knot `knot`, locked on `slots` (none: open). */
const leaveBy = (id: string, knot: string, slots: readonly Json[] = []): Json => ({
  id,
  kind: 'exit',
  label: TEXT,
  to: { story: knot },
  lock: slots.length === 0 ? null : { slots, puzzle: null, locked: TEXT, onOpen: [], onFail: [] },
  sfx: null,
});

/** One chapter of a fixture repo: its ink lines (the INCLUDE first) and its world, if any. */
type RepoChapter = { readonly id: string; readonly paid?: boolean; readonly next?: string | null; readonly ink: readonly string[]; readonly world?: Json };

/** Every `{ id, ru }` text of a fixture JSON, in walk order. */
function textsIn(v: unknown): Array<{ id: string; ru: string }> {
  if (Array.isArray(v)) {
    return v.flatMap(textsIn);
  }
  if (typeof v !== 'object' || v === null) {
    return [];
  }
  const o = v as Json; // an object, checked above
  return typeof o['id'] === 'string' && typeof o['ru'] === 'string' ? [{ id: o['id'], ru: o['ru'] }] : Object.values(o).flatMap(textsIn);
}

/** A chapter's ID'd lines as the graph reads them (the en table's `ru`), from its ink compiled alone. */
function inkLines(id: string, ink: string): Array<{ id: string; ru: string }> {
  const chapter: SourceChapter = { id: ch(id), paid: false, entry: `${id}/main.ink` };
  const files = new Map([
    [GLOBALS_PATH, 'VAR g_x = 0\n'],
    [chapter.entry, ink],
  ]);
  const r = compileChapter(chapter, (key) => files.get(key) ?? null);
  if (r.compiled === null) {
    throw new Error(`invariant: the fixture chapter ${id} compiles: ${JSON.stringify(r.findings)}`);
  }
  return buildGraph({ chapter, files: r.compiled.files, sources: files, assets: ASSETS }).graph.lines.map((l) => ({ id: l.id, ru: l.text }));
}

/**
 * A fixture repo (path -> text) in graph-shot.test.ts's `faceRepo` shape: the committed catalog, an inline cast, the
 * chapter list (a paid chapter's product is `chapter:<id>`), the stories (default: one per chain, endings none), the
 * globals, each chapter's ink and world, the en tables of every ink line and world text, the names; and
 * story/items.json when `items` is given.
 */
function carryRepo(spec: { chapters: readonly RepoChapter[]; stories?: unknown; items?: string }): Record<string, string> {
  const table = (o: unknown): string => `${JSON.stringify(o, null, 2)}\n`;
  const nexts = new Set(spec.chapters.flatMap((c) => (c.next === undefined || c.next === null ? [] : [c.next])));
  const firsts = spec.chapters.filter((c) => !nexts.has(c.id)).map((c) => c.id);
  const covers = ['manor', 'tide'];
  const stories = spec.stories ?? firsts.map((first, i) => ({ id: covers[i] ?? 'manor', first, cover: `cover/${covers[i] ?? 'manor'}`, endings: {} }));
  const files: Record<string, string> = {
    'assets/catalog.json': readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8'),
    'story/cast.json': JSON.stringify({ ally: { char: 'ally' }, stranger: { char: 'stranger' }, voice: { char: null } }),
    'story/chapters.json': JSON.stringify(
      spec.chapters.map((c) => ({ id: c.id, entry: `${c.id}/main.ink`, paid: c.paid === true, ...(c.paid === true ? { productId: `chapter:${c.id}` } : {}), next: c.next ?? null })),
    ),
    'story/stories.json': JSON.stringify(stories),
    'story/common/globals.ink': 'VAR g_x = 0\n',
  };
  for (const c of spec.chapters) {
    const ink = `${c.ink.join('\n')}\n`;
    files[`story/${c.id}/main.ink`] = ink;
    if (c.world !== undefined) {
      files[`story/${c.id}/world.json`] = table(c.world);
    }
    files[`story/locales/en/${c.id}.json`] = table(Object.fromEntries([...inkLines(c.id, ink), ...textsIn(c.world ?? {})].map((x) => [x.id, { ru: x.ru, en: `en ${x.id}` }])));
  }
  const names = (ru: boolean): unknown => ({
    names: ru ? { ally: 'Подруга', stranger: 'Незнакомец', voice: 'Голос' } : { ally: 'Ally', stranger: 'Stranger', voice: 'Voice' },
    chapters: Object.fromEntries(spec.chapters.map((c, i) => [c.id, ru ? `Глава ${i + 1}` : `Chapter ${i + 1}`])),
    stories: Object.fromEntries(covers.slice(0, Math.max(1, firsts.length)).map((s) => [s, ru ? `История ${s}` : `Story ${s}`])),
    teasers: Object.fromEntries(covers.slice(0, Math.max(1, firsts.length)).map((s) => [s, ru ? 'Черновик истории.' : 'A draft story.'])),
  });
  files['story/locales/ru/story.json'] = table(names(true));
  files['story/locales/en/story.json'] = table(names(false));
  if (spec.items !== undefined) {
    files['story/items.json'] = spec.items;
  }
  return files;
}

/** Every file under `rel` of `root`, repo-relative posix, sorted. */
function outputsUnder(root: string, rel: string): string[] {
  const abs = join(root, rel);
  return existsSync(abs)
    ? readdirSync(abs, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(root, join(e.parentPath, e.name)).split('\\').join('/'))
        .sort()
    : [];
}

/**
 * The story gate's `main` over `files` written into a fresh temp repo: its exit code, its stdout lines (console.log
 * captured, restored after), and the files it wrote under client/ and server/. A run that printed nothing, or not its
 * tally last, is a vacuous green: refused here.
 */
function storyRun(files: Readonly<Record<string, string>>): { code: number; out: string[]; emitted: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'story-carry-'));
  const out: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  });
  try {
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(root, ...rel.split('/'));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
    const code = main([], root);
    expect(out.length, 'the run printed its report').toBeGreaterThan(0);
    expect(out.at(-1), out.join('\n')).toMatch(/^story: \d+ errors, \d+ warnings$/);
    return { code, out, emitted: [...outputsUnder(root, 'client'), ...outputsUnder(root, 'server')] };
  } finally {
    spy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
}

/** A run's findings of `code` as `file:line`. */
function printed(out: readonly string[], code: string): string[] {
  return out.flatMap((l) => {
    const m = /^[EW] (\S+):(\d+) (\S+) /.exec(l);
    return m !== null && m[3] === code ? [`${m[1]}:${m[2]}`] : [];
  });
}

/** The carry codes a run printed. */
function carryCodes(out: readonly string[]): string[] {
  return out.flatMap((l) => /^[EW] \S+ ((?:world\/carry-|world\/inherit-)\S+) /.exec(l)?.[1] ?? []);
}

/** The giver ch1: `start` enters the manor (`bypass`: a choice also leads to an END of its own), whose hall gives the
 *  lamp, kept by its way out (`back`: a second, open way out too). `mark`: the lamp is marked carry: true. */
function giverChapter(opts: { bypass?: boolean; back?: boolean; mark?: boolean; paid?: boolean; id?: string; next?: string } = {}): RepoChapter {
  const id = opts.id ?? 'ch1';
  const choice = opts.bypass === true ? ['* [Войти #id:ch1.start.c001]', '    -> hall', '* [Уйти #id:ch1.start.c002]', '    -> away'] : ['-> hall'];
  const away = opts.bypass === true ? ['=== away ===', 'Мы ушли. #id:ch1.away.a003', '-> END'] : [];
  const ink = [
    'INCLUDE ../common/globals.ink',
    '-> start',
    '=== start ===',
    '# scene: hall',
    'Перед усадьбой. #id:ch1.start.a001',
    ...choice,
    '=== hall ===',
    'Мы вошли. #id:ch1.hall.a002',
    '# explore: manor',
    '-> DONE',
    ...away,
    '=== manor_out ===',
    'Мы вышли. #id:ch1.manor_out.a004',
    '-> END',
  ].map((l) => l.replaceAll('ch1.', `${id}.`));
  const world = repoWorld(id, {
    items: { lamp: opts.mark === false ? {} : { carry: true } },
    sections: { manor: { hall: [takeIt('t_lamp', 'lamp'), leaveBy('out', 'manor_out', [{ accepts: 'lamp', keep: true }]), ...(opts.back === true ? [leaveBy('back', 'manor_out')] : [])] } },
  });
  return { id, paid: opts.paid ?? false, next: opts.next ?? 'ch2', ink, world };
}

/** The receiver ch2: `start` enters its archive, left by an open door; its world declares the lamp and inherits
 *  `inherits` (none: no `inherits` key, nor the lamp). */
function receiverChapter(inherits: readonly Json[] | null, opts: { paid?: boolean; id?: string; next?: string | null } = {}): RepoChapter {
  const id = opts.id ?? 'ch2';
  const ink = ['INCLUDE ../common/globals.ink', '-> start', '=== start ===', '# scene: archive', 'Архив. #id:ch2.start.a001', '# explore: archive', '-> DONE', '=== archive_out ===', 'Конец. #id:ch2.archive_out.a002', '-> END'].map((l) =>
    l.replaceAll('ch2.', `${id}.`),
  );
  const world = repoWorld(id, {
    items: inherits === null ? {} : { lamp: {} },
    sections: { archive: { hall: [leaveBy('out', 'archive_out')] } },
    ...(inherits === null ? {} : { top: { inherits } }),
  });
  return { id, paid: opts.paid ?? true, next: opts.next ?? null, ink, world };
}

const LAMP_ROW = '[{ "id": "lamp", "from": "ch1" }]\n';
const LAMP_REQUIRED: readonly Json[] = [{ id: 'lamp', required: true }];

test(
  'carry: the story gate runs the cross-chapter pass',
  () => {
    const fault = carryRepo({ chapters: [giverChapter({ bypass: true }), receiverChapter(LAMP_REQUIRED)], items: LAMP_ROW });
    const r = storyRun(fault);
    const yieldLine = (fault['story/ch1/main.ink'] ?? '').split('\n').indexOf('# explore: manor') + 1;
    expect(printed(r.out, 'world/carry-required-path'), r.out.join('\n')).toEqual([`story/ch1/main.ink:${yieldLine}`]);
    expect(r.code).toBe(1);
    // The control: the manor's yield on every path. Clean, so it exits 0.
    const control = storyRun(carryRepo({ chapters: [giverChapter(), receiverChapter(LAMP_REQUIRED)], items: LAMP_ROW }));
    expect(carryCodes(control.out), control.out.join('\n')).toEqual([]);
    expect(control.code, control.out.join('\n')).toBe(0);
  },
  IN_PROCESS_TIMEOUT_MS,
);

test(
  'carry: inherits without story/items.json are refused',
  () => {
    const files = carryRepo({ chapters: [giverChapter(), receiverChapter(LAMP_REQUIRED)] });
    const r = storyRun(files);
    const line = (files['story/ch2/world.json'] ?? '').split('\n').indexOf('    {') + 1;
    expect(printed(r.out, 'world/carry-inherit'), r.out.join('\n')).toEqual([`story/ch2/world.json:${line}`]);
    expect(line).toBe(carryLines(files['story/ch2/world.json'] ?? '')('inherits.0'));
    expect(r.code).toBe(1);
  },
  IN_PROCESS_TIMEOUT_MS,
);

/** The kind of each stdout line of a run, in story.ts's report order. */
function lineKinds(out: readonly string[]): string[] {
  return out.map((l) => (/^story: \d+ errors, \d+ warnings$/.test(l) ? 'tally' : /^[EW] /.test(l) ? l.slice(0, 2) : (/^[a-z]+:/.exec(l)?.[0] ?? l)));
}

test(
  'carry: a carry-less repo prints what it printed before',
  () => {
    const chapters = [giverChapter({ mark: false }), receiverChapter(null)];
    for (const items of [undefined, '[]\n']) {
      const r = storyRun(carryRepo({ chapters, ...(items === undefined ? {} : { items }) }));
      const label = `${items ?? 'no story/items.json'}\n${r.out.join('\n')}`;
      expect(r.code, label).toBe(0);
      expect(carryCodes(r.out), label).toEqual([]);
      expect(r.out[r.out.findIndex((l) => l.startsWith('stories: ')) + 1], label).toMatch(/^meta: /);
      expect(
        r.out.filter((l) => l.startsWith('world: ')),
        label,
      ).toEqual(['world: ch1: 1 section, 1 room, 0 puzzles, softlock OK (3 states)', 'world: ch2: 1 section, 1 room, 0 puzzles, softlock OK (1 states)']);
      expect(lineKinds(r.out), label).toEqual(['story:', 'story:', 'world:', 'world:', 'stories:', 'meta:', 'play:', 'play:', 'shots:', 'tally']);
    }
  },
  IN_PROCESS_TIMEOUT_MS,
);

test(
  'carry: story/items.json is never emitted',
  () => {
    const r = storyRun(carryRepo({ chapters: [giverChapter(), receiverChapter(LAMP_REQUIRED)], items: LAMP_ROW }));
    expect(r.code, r.out.join('\n')).toBe(0);
    expect(r.emitted.filter((p) => p.startsWith('client/')).length).toBeGreaterThan(0);
    expect(r.emitted.filter((p) => p.startsWith('server/')).length).toBeGreaterThan(0);
    expect(r.emitted.filter((p) => p.endsWith('items.json'))).toEqual([]);
  },
  IN_PROCESS_TIMEOUT_MS,
);

test(
  'carry: a run whose story list fails skips the cross-chapter pass',
  () => {
    // A story ending reachable before the giver's yield: the skip removed, the pass would read no ending and refuse it.
    const files = carryRepo({ chapters: [giverChapter({ bypass: true }), receiverChapter(LAMP_REQUIRED)], items: LAMP_ROW, stories: { manor: {} } });
    const r = storyRun(files);
    expect(printed(r.out, 'catalog/stories'), r.out.join('\n')).not.toEqual([]);
    expect(carryCodes(r.out), r.out.join('\n')).toEqual([]);
    expect(r.code).toBe(1);
  },
  IN_PROCESS_TIMEOUT_MS,
);

test('carry: the carry pass locates a world path where the world runner does', () => {
  const w = base();
  at(w, 'items.medal_sun')['carry'] = true;
  w['inherits'] = [{ id: 'lamp', required: false }];
  obj(w['items'])['lamp'] = { name: t('lamp', 'Лампа'), desc: t('lamp', 'Лампа.'), glyph: 'key' };
  const text = `${JSON.stringify(w, null, 2)}\n`;
  const decoded = decodeWorldFile({ file: FILE, text });
  if (decoded.world === null) {
    throw new Error('invariant: the fixture decodes');
  }
  const seen: WorldLintInput[] = [];
  const capture: WorldLint<never> = {
    id: 'capture',
    codes: {},
    lint: (input) => {
      seen.push(input);
      return [];
    },
  };
  lintWorld({ chapter: CH1, file: FILE, text, world: decoded.world, catalog: CATALOG, knots: KNOTS, yielded: null, declared: new Map() }, [...MECHANIC_LINTS, capture]);
  const runner = seen[0]?.line;
  if (runner === undefined) {
    throw new Error('invariant: the capture pass ran');
  }
  // Every written path (each member key and array element), then paths that fall back to an ancestor or to 0.
  const paths = (v: unknown, path: string): string[] => {
    const under = (k: string | number): string => (path === '' ? String(k) : `${path}.${k}`);
    if (Array.isArray(v)) {
      return v.flatMap((x, i) => [under(i), ...paths(x, under(i))]);
    }
    return typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [under(k), ...paths(x, under(k))]) : [];
  };
  const all = [...paths(w, ''), 'inherits.0.id.x', 'sections.manor.rooms.hall.hotspots.9.rect', 'nowhere', ''];
  expect(all.length).toBeGreaterThan(200);
  const ours = carryLines(text);
  expect(all.map((p) => `${p} ${ours(p)}`)).toEqual(all.map((p) => `${p} ${runner(p)}`));
  // Not vacuous: array elements and members land on different lines.
  expect(new Set(all.map(ours)).size).toBeGreaterThan(100);
});

/** The giver chapter ch1 from `main` against the manor (plus `edit` on its world): its `world/carry-giver-prefix`
 *  findings as `line`. */
function prefixRefusals(main: readonly string[], edit: (w: Json) => void = () => undefined): number[] {
  const w = giver();
  edit(w);
  const g = graphWith(main, okWorld(w));
  const chapters = [carryChapter('ch1', 'ch2', w, carryPaths(g.graph, g.facts, new Map())), carryChapter('ch2', null, heir())];
  const found = carryProof({ chapters, registry: SUN_ROW }).findings;
  // Every row's yields are on every path to an END: only the prefix rule can refuse.
  expect(found.filter((f) => f.code !== 'world/carry-giver-prefix')).toEqual([]);
  return found.filter((f) => f.code === 'world/carry-giver-prefix').map((f) => f.line);
}

test('carry: a giver yield after an ungathered choice or a divert is refused', () => {
  const start = [...INK_HEAD, 'Перед усадьбой. #id:ch1.start.a001', '-> hall'];
  const after = ['=== away ===', 'Мы ушли. #id:ch1.away.a009', '-> END', '=== manor_out ===', 'Мы вышли. #id:ch1.manor_out.a010', '-> END'];
  /** ch1 whose `hall` knot runs `body` and then yields the manor. */
  const hall = (body: readonly string[]): string[] => [...start, '=== hall ===', 'Холл. #id:ch1.hall.a002', ...body, '# explore: manor', '-> DONE', ...after];
  const yieldIn = (main: readonly string[]): number => lineIn(main, '# explore: manor');
  // ch1's shape (story/ch1/main.ink:41-48): a choice whose every branch falls to the gather before the yield.
  const gathered = hall(['* [Взять за руку #id:ch1.hall.c001]', '    Спасибо. #id:ch1.hall.a003', '* [Спорить #id:ch1.hall.c002]', '    Ну и ладно. #id:ch1.hall.a004', '- Дальше. #id:ch1.hall.a005']);
  expect(prefixRefusals(gathered)).toEqual([]);
  // A branch that diverts out before the gather: an entry of the hall may never reach its yield.
  const out = hall(['* [Остаться #id:ch1.hall.c001]', '    Остались. #id:ch1.hall.a003', '* [Уйти #id:ch1.hall.c002]', '    -> away', '- Дальше. #id:ch1.hall.a005']);
  expect(prefixRefusals(out)).toEqual([yieldIn(out)]);
  // A yield inside one branch (no gather).
  const inBranch = [...start, '=== hall ===', 'Холл. #id:ch1.hall.a002', '* [Войти #id:ch1.hall.c001]', '    # explore: manor', '    -> DONE', '* [Уйти #id:ch1.hall.c002]', '    -> away', ...after];
  expect(prefixRefusals(inBranch)).toEqual([lineIn(inBranch, '    # explore: manor')]);
  // A multi-line conditional holding a divert out; the same inline (one text line, 06:685's third class).
  const block = hall(['{ g_trust > 0:', '    -> away', '}']);
  expect(prefixRefusals(block)).toEqual([yieldIn(block)]);
  const inline = hall(['{g_trust > 0: -> away}']);
  expect(prefixRefusals(inline)).toEqual([yieldIn(inline)]);
  // A closed conditional block with no divert: every branch falls through to the yield.
  const closed = hall(['{ g_trust > 0:', '    Доверие. #id:ch1.hall.a003', '- else:', '    Недоверие. #id:ch1.hall.a004', '}']);
  expect(prefixRefusals(closed)).toEqual([]);
  // A yield inside a multi-line conditional still open at the yield: an entry whose condition fails never runs it, so it
  // is off the prefix. The yield after the block follows the in-block yield's `-> DONE` (a divert) and is off the prefix
  // too, so no yield of the knot is on it: refused at the first.
  const open = hall(['{ g_trust > 0:', '    # explore: manor', '    -> DONE', '}']);
  expect(prefixRefusals(open)).toEqual([lineIn(open, '    # explore: manor')]);
  // The knot's only yield inside an outer multi-line conditional, after a nested closed one; otherwise the knot leaves
  // to `away`. The outer block is still open at the yield (an inner close does not close it), so an entry whose outer
  // condition fails leaves without the item.
  const nestedOnly = [...start, '=== hall ===', 'Холл. #id:ch1.hall.a002', '{ g_trust > 0:', '    { g_trust > 1:', '        Глубже. #id:ch1.hall.a006', '    }', '    # explore: manor', '    -> DONE', '}', '-> away', ...after];
  expect(prefixRefusals(nestedOnly)).toEqual([lineIn(nestedOnly, '    # explore: manor')]);

  // The event knot of the cellar (ch1's `manor_cellar_voice`, story/ch1/main.ink:56-63): choices gathered before its
  // yield back, clean.
  const voice = (body: readonly string[]): string[] => [
    ...hall([]),
    '=== manor_cellar_voice ===',
    'Голос. #id:ch1.manor_cellar_voice.v001',
    ...body,
    '# explore: manor',
    '-> DONE',
  ];
  const evented = voice(['* [Держись #id:ch1.manor_cellar_voice.c001]', '    Спасибо. #id:ch1.manor_cellar_voice.v002', '* [Кто ты? #id:ch1.manor_cellar_voice.c002]', '    Потом. #id:ch1.manor_cellar_voice.v003', '- Тихо. #id:ch1.manor_cellar_voice.v004']);
  expect(prefixRefusals(evented)).toEqual([]);
  // An event knot entered only by its section's edges, a yield in each branch of an ungathered choice: clean only
  // because the knot is exempt (every entry is the section's own event).
  const branches = [
    '=== manor_cellar_voice ===',
    'Голос. #id:ch1.manor_cellar_voice.v001',
    '* [Держись #id:ch1.manor_cellar_voice.c001]',
    '    # explore: manor',
    '    -> DONE',
    '* [Кто ты? #id:ch1.manor_cellar_voice.c002]',
    '    # explore: manor',
    '    -> DONE',
  ];
  const exempt = [...hall([]), ...branches];
  expect(prefixRefusals(exempt)).toEqual([]);
  // The same knot also entered by a divert from another knot: judged by the prefix, refused at its first yield.
  const entered = [...INK_HEAD, 'Перед усадьбой. #id:ch1.start.a001', '* [Холл #id:ch1.start.c001]', '    -> hall', '* [Подвал #id:ch1.start.c002]', '    -> manor_cellar_voice', ...hall([]).slice(start.length), ...branches];
  expect(prefixRefusals(entered)).toEqual([lineIn(entered, '    # explore: manor')]);
  // The same knot named by a second section's rooms too, one branch returning to each: no longer the manor's own
  // event, so judged by the prefix and refused (RULINGS 403 B3).
  const shared = [
    ...hall([]),
    '=== manor_cellar_voice ===',
    'Голос. #id:ch1.manor_cellar_voice.v001',
    '* [В подвал #id:ch1.manor_cellar_voice.c001]',
    '    # explore: manor',
    '    -> DONE',
    '* [В сад #id:ch1.manor_cellar_voice.c002]',
    '    # explore: garden',
    '    -> DONE',
  ];
  /** A second section, `garden`, whose one room's entry runs `knots`. */
  const garden =
    (knots: readonly string[]) =>
    (w: Json): void => {
      const yard = { bg: 'room', title: t('garden', 'Сад'), onEnter: knots.map((story) => ({ story })), hotspots: [] };
      at(w, 'sections')['garden'] = { start: 'yard', bgm: null, rooms: { yard } };
    };
  expect(prefixRefusals(shared, garden(['manor_cellar_voice']))).toEqual([lineIn(shared, '    # explore: manor')]);
  // Its control: the garden names no knot, so the cellar's event is the manor's own again.
  expect(prefixRefusals(shared, garden([]))).toEqual([]);
});

/** A fixture world as the proof searches it: decoded, its public body with the decoded `mods`. */
function kernelOf(w: Json): KernelWorld {
  const r = decodeWorldSource(w);
  if (!r.ok) {
    throw new Error(`invariant: the fixture decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods };
}

test('carry: a skipped or capped giver section fails closed on its own error', () => {
  const required = new Map([['medal_sun' as ItemId, ch('ch2')]]); // a fixture item id
  // Skipped: a part atom in a gating `when` leaves the manor unsearched; `world/visual-only-atom` refuses the world.
  const skipped = recipeBase(() => t('manor', 'Монета легла в оправу.'));
  spot(skipped, 'hall', 'inscription')['when'] = { part: { puzzle: 'drawer', index: 0, is: 1 } };
  expect(checkSection(kernelOf(skipped), 'manor' as SectionId, FILE, required)).toEqual({ section: 'manor', states: null, findings: [] });
  expect(of(lint(skipped), 'world/visual-only-atom')).toHaveLength(1);
  // Capped: thirteen documents beside the sun medallion, past RESUME_STATE_CAP; only its `world/state-cap`.
  const docs = Array.from({ length: 13 }, (_, i) => `d${i}`);
  const capped = mini({ items: ['medal_sun'], docs, sections: { s: { start: 'hall', rooms: { hall: [leave('out'), take('sun', { item: 'medal_sun' }), ...docs.map((d) => take(d, { doc: d }))] } } } });
  const c = checkSection(kernelOf(capped), 's' as SectionId, FILE, required);
  expect([c.states, c.findings.map((f) => f.code)]).toEqual([null, ['world/state-cap']]);
  expect(of(lint(capped), 'world/state-cap')).toHaveLength(1);
});

test(
  "carry: the story gate runs the giver's leave check",
  () => {
    const files = carryRepo({ chapters: [giverChapter({ back: true }), receiverChapter(LAMP_REQUIRED)], items: LAMP_ROW });
    const r = storyRun(files);
    const line = (files['story/ch1/world.json'] ?? '').split('\n').indexOf('    "manor": {') + 1;
    expect(line).toBeGreaterThan(0);
    expect(printed(r.out, 'world/carry-leave'), r.out.join('\n')).toEqual([`story/ch1/world.json:${line}`]);
    expect(r.code).toBe(1);
    // The control: the only way out keeps the lamp.
    const control = storyRun(carryRepo({ chapters: [giverChapter(), receiverChapter(LAMP_REQUIRED)], items: LAMP_ROW }));
    expect(printed(control.out, 'world/carry-leave'), control.out.join('\n')).toEqual([]);
    expect(control.code).toBe(0);
  },
  IN_PROCESS_TIMEOUT_MS,
);

test('carry: a required item consumable later is refused', () => {
  type Form = 'slot' | 'rule' | 'recipe';
  const FORMS: readonly Form[] = ['slot', 'rule', 'recipe'];
  /** `form` consuming the sun medallion (`keep`: keeping it) in the manor: the gate's slot, a rule on the inscription, a
   *  recipe. */
  const manor = (form: Form | null, keep: boolean): Json => {
    const w = giver();
    if (form === 'slot') {
      list(obj(gateOf(w)['lock'])['slots'])[0] = { accepts: 'medal_sun', ...(keep ? { keep: true } : {}) };
    } else if (form === 'rule') {
      spot(w, 'hall', 'inscription')['uses'] = [{ item: 'medal_sun', ...(keep ? { keep: true } : {}), do: [] }];
    } else if (form === 'recipe') {
      obj(w['items'])['coin'] = { name: t('coin', 'Монета'), desc: t('coin', 'Старая монета.'), glyph: 'key' };
      obj(w['items'])['amulet'] = { name: t('amulet', 'Амулет'), desc: t('amulet', 'Монета в оправе.'), glyph: 'key' };
      w['recipes'] = [{ a: 'medal_sun', b: 'coin', gives: 'amulet', ...(keep ? { keep: ['medal_sun'] } : {}) }];
    }
    return w;
  };
  /** A small world declaring the medallion and a recipe's coin and amulet, none of which it gives; `form` consumes the
   *  medallion (`keep`: keeps it) on its hall's box or as a recipe; `inherits` set unless null. */
  const holder = (form: Form | null, keep: boolean, inherits: readonly Json[] | null = null): Json => {
    const slot = { accepts: 'medal_sun', ...(keep ? { keep: true } : {}) };
    const box = form === 'slot' ? [object('box', { ...lockOf([]), slots: [slot] })] : form === 'rule' ? [{ ...object('box', null), uses: [{ item: 'medal_sun', ...(keep ? { keep: true } : {}), do: [] }] }] : [];
    const w = mini({ items: ['medal_sun', 'coin', 'amulet'], sections: { s: { start: 'hall', rooms: { hall: [leave('out'), ...box] } } } });
    if (form === 'recipe') {
      w['recipes'] = [{ a: 'medal_sun', b: 'coin', gives: 'amulet', ...(keep ? { keep: ['medal_sun'] } : {}) }];
    }
    if (inherits !== null) {
      w['inherits'] = inherits;
    }
    return w;
  };
  const REQUIRED: readonly Json[] = [{ id: 'medal_sun', required: true }];
  /** ch1 gives the medallion, ch2 passes it on, ch3 inherits it as required, ch4 follows; `w` replaces chapter `place`. */
  const chain = (place: string, w: Json, ch2Inherits: readonly Json[] | null = null): CarryChapter[] => {
    const worlds: Record<string, Json> = { ch1: giver(), ch2: holder(null, false, ch2Inherits), ch3: holder(null, false, REQUIRED), ch4: holder(null, false), [place]: w };
    return ['ch1', 'ch2', 'ch3', 'ch4'].map((c, i, all) => carryChapter(c, all[i + 1] ?? null, worlds[c] ?? null));
  };
  /** The pass's consumed findings as `code file:line message`; every other carry rule holds (the chain is valid). */
  const consumed = (chapters: readonly CarryChapter[]): string[] => {
    const found = carryProof({ chapters, registry: SUN_ROW }).findings;
    expect(found.filter((f) => f.code !== 'world/carry-consumed')).toEqual([]);
    return found.filter((f) => f.code === 'world/carry-consumed').map((f) => `${f.code} ${f.file}:${f.line} ${f.message}`);
  };
  const refusal = (c: string, line: number, what: string): string =>
    `world/carry-consumed story/${c}/world.json:${line} item 'medal_sun' is inherited as required from ch1, but ${what} consumes it: a required carried item stays held from its giver through its receiver (§6.6)`;
  /** The consumer's line (the line naming the item) and its name, in world `w`. */
  const consumer = (form: Form, w: Json, hotspot: string): [number, string] =>
    form === 'slot' ? [jsonLine(w, '"accepts": "medal_sun"'), `slot ${hotspot}#0`] : form === 'rule' ? [jsonLine(w, '"uses": [') + 2, `rule 0 of ${hotspot}`] : [jsonLine(w, '"a": "medal_sun"'), 'recipe 0'];

  // The control: nothing on the way consumes the medallion.
  expect(consumed(chain('ch1', giver()))).toEqual([]);
  for (const form of FORMS) {
    // In the giver, an intermediate chapter and the receiver: refused at the consumer; each with `keep`: clean.
    const rows: ReadonlyArray<readonly [c: string, make: (keep: boolean) => Json, hotspot: string]> = [
      ['ch1', (keep) => manor(form, keep), form === 'slot' ? 'hall.gate' : 'hall.inscription'],
      ['ch2', (keep) => holder(form, keep), 'hall.box'],
      ['ch3', (keep) => holder(form, keep, REQUIRED), 'hall.box'],
    ];
    for (const [c, make, hotspot] of rows) {
      const w = make(false);
      const [line, what] = consumer(form, w, hotspot);
      expect(consumed(chain(c, w)), `${form} in ${c}`).toEqual([refusal(c, line, what)]);
      expect(consumed(chain(c, make(true))), `${form} in ${c}, kept`).toEqual([]);
    }
    // After the receiver (ch4), and in a receiver that inherits it as optional: clean.
    expect(consumed(chain('ch4', holder(form, false))), `${form} in ch4`).toEqual([]);
    expect(consumed(chain('ch3', holder(form, false, [{ id: 'medal_sun', required: false }]))), `${form} in an optional receiver`).toEqual([]);
  }
  // Two receivers whose chains both pass the consumer (ch2 and ch3 each inherit it as required): one finding.
  const gate = manor('slot', false);
  const [line] = consumer('slot', gate, 'hall.gate');
  expect(consumed(chain('ch1', gate, REQUIRED))).toEqual([refusal('ch1', line, 'slot hall.gate#0')]);
});

test('carry: a paid giver into a free chapter is refused', () => {
  /** The pass over ch1 (the manor giver) -> ch2 (inheriting `inherits`) at the given tiers. */
  const tiers = (giverPaid: boolean, receiverPaid: boolean, inherits: readonly Json[] = [{ id: 'medal_sun', required: true }]): string[] => {
    const chapters = [carryChapter('ch1', 'ch2', giver(), null, giverPaid), carryChapter('ch2', null, heir(inherits), null, receiverPaid)];
    return carryProof({ chapters, registry: SUN_ROW }).findings.map((f) => `${f.code} ${f.file}:${f.line} ${f.message}`);
  };
  const refused = `world/carry-tier story/ch2/world.json:${inheritLine(heir(), 0)} item 'medal_sun' comes from ch1, a paid chapter, into ch2, a free one: a paid chapter's item would reach a free chapter's player (§6.6)`;
  // Paid -> free, a required item and an optional one.
  expect(tiers(true, false)).toEqual([refused]);
  expect(tiers(true, false, [{ id: 'medal_sun', required: false }])).toEqual([refused]);
  // Free -> paid (the committed chains' shape), paid -> paid and free -> free: clean.
  expect(tiers(false, true)).toEqual([]);
  expect(tiers(true, true)).toEqual([]);
  expect(tiers(false, false)).toEqual([]);
});

test(
  'carry: the story gate refuses a paid giver into a free chapter',
  () => {
    /** Free ch1 -> ch2 (paid unless `free`), giving the lamp -> free ch3, inheriting it as required. */
    const repo = (free: boolean): Record<string, string> =>
      carryRepo({
        chapters: [
          receiverChapter(null, { id: 'ch1', paid: false, next: 'ch2' }),
          giverChapter({ id: 'ch2', paid: !free, next: 'ch3' }),
          receiverChapter(LAMP_REQUIRED, { id: 'ch3', paid: false }),
        ],
        items: '[{ "id": "lamp", "from": "ch2" }]\n',
      });
    const files = repo(false);
    const r = storyRun(files);
    const line = carryLines(files['story/ch3/world.json'] ?? '')('inherits.0');
    expect(line).toBeGreaterThan(0);
    expect(printed(r.out, 'world/carry-tier'), r.out.join('\n')).toEqual([`story/ch3/world.json:${line}`]);
    expect(r.code).toBe(1);
    // The control: ch2 free. Clean, so it exits 0.
    const control = storyRun(repo(true));
    expect(carryCodes(control.out), control.out.join('\n')).toEqual([]);
    expect(control.code, control.out.join('\n')).toBe(0);
  },
  IN_PROCESS_TIMEOUT_MS,
);

/** The receiver with `optional` optional inherited items it declares (lamp first), none of them read. */
function optionalHeir(optional: number): Json {
  const ids = ['lamp', 'rope', 'map', 'coin'].slice(0, optional);
  const w = receiver(ids.map((id) => ({ id, required: false })));
  for (const id of ids.filter((x) => x !== 'lamp')) {
    obj(w['items'])[id] = { name: t(id, 'Предмет'), desc: t(id, 'Описание.'), glyph: 'key' };
  }
  return w;
}

test('carry: above three optional inherited items no section start is searched', () => {
  const four = run(optionalHeir(4));
  expect(four.sections.map((s) => s.states)).toEqual([null]);
  expect(four.findings.map((f) => f.code)).toContain('world/inherit-count');
  expect(four.findings.filter((f) => f.code === 'world/softlock' || f.code === 'world/state-cap')).toEqual([]);
  // The edge: three, searched (2^3 starts).
  expect(run(optionalHeir(3)).sections.map((s) => typeof s.states)).toEqual(['number']);
});

test(
  'story: a section not searched is reported as such',
  () => {
    /** The first chapter alone, its archive's world inheriting `optional` optional items it declares. */
    const repo = (optional: number): Record<string, string> => {
      const ids = ['lamp', 'rope', 'map', 'coin'].slice(0, optional);
      const ch1 = receiverChapter(null, { id: 'ch1', paid: false });
      const world = repoWorld('ch1', {
        items: Object.fromEntries(ids.map((id) => [id, {}])),
        sections: { archive: { hall: [leaveBy('out', 'archive_out')] } },
        top: { inherits: ids.map((id) => ({ id, required: false })) },
      });
      return carryRepo({ chapters: [{ ...ch1, world }] });
    };
    const worldLine = (out: readonly string[]): string[] => out.filter((l) => l.startsWith('world: ch1:'));
    const r = storyRun(repo(4));
    expect(worldLine(r.out), r.out.join('\n')).toEqual(['world: ch1: 1 section, 1 room, 0 puzzles, softlock NOT SEARCHED (1 of 1 sections)']);
    expect(printed(r.out, 'world/inherit-count')).toHaveLength(1);
    // The OK form's head fields, on the same world with three: searched, its eight starts of one state each.
    const control = storyRun(repo(3));
    expect(worldLine(control.out), control.out.join('\n')).toEqual(['world: ch1: 1 section, 1 room, 0 puzzles, softlock OK (8 states)']);
  },
  IN_PROCESS_TIMEOUT_MS,
);

test(
  'story: the en half of [moves] is refused at its en line',
  () => {
    const SAFE_HINT = 'ch1.w.m001'; // fixture text ids, beside repoWorld's `ch1.w.<n>`
    const DIAL_HINT = 'ch1.w.m002';
    /** ch1 alone: its archive's hall holds a code safe (its clue a note beside it) and a door into the view of a two-lever
     *  device (07 §7.5), whose ru hints obey W6; `safeEn` and `dialEn` are the en texts of the safe's one hint and the levers' last tier. */
    const repo = (safeEn: string, dialEn: string): Record<string, string> => {
      const ch1 = receiverChapter(null, { id: 'ch1', paid: false });
      const zeroSlot = (puzzle: string): Json => ({ slots: [], puzzle, locked: TEXT, onOpen: [], onFail: [] });
      const common = { title: TEXT, prompt: TEXT, closeup: null, maxAttempts: null, giveUp: false };
      const puzzles = {
        safe: { type: 'code', ...common, params: { dials: 3 }, solution: [1, 1, 1], hints: [{ id: SAFE_HINT, ru: 'Код в письме.' }], clues: [{ examined: 'hall.note' }] },
        dial: {
          type: 'levers',
          ...common,
          params: { parts: 2, positions: 2, couples: [[], []], target: [1, 1], rects: [[100, 800, 150, 150], [400, 800, 150, 150]] },
          solution: [1, 1],
          hints: [{ id: DIAL_HINT, ru: 'Порядок: [moves].' }],
        },
      };
      const world = repoWorld('ch1', {
        sections: {
          archive: {
            hall: [
              leaveBy('out', 'archive_out'),
              { id: 'safe', kind: 'object', label: TEXT, lock: zeroSlot('safe'), then: [], look: null, prop: null },
              { id: 'note', kind: 'look', label: TEXT, look: TEXT, then: [] },
              { id: 'to_panel', kind: 'exit', label: TEXT, to: { room: 'panel' }, lock: null, sfx: null },
            ],
            panel: [{ id: 'dial', kind: 'object', label: TEXT, lock: zeroSlot('dial'), then: [], look: null, prop: null }],
          },
        },
        top: { puzzles },
      });
      const panel = at(world, 'sections.archive.rooms.panel');
      panel['view'] = { of: 'hall' };
      panel['device'] = 'dial';
      const files = carryRepo({ chapters: [{ ...ch1, world }] });
      const en = JSON.parse(files['story/locales/en/ch1.json'] ?? '{}') as Record<string, Json>; // the harness's en table
      obj(en[SAFE_HINT])['en'] = safeEn;
      obj(en[DIAL_HINT])['en'] = dialEn;
      files['story/locales/en/ch1.json'] = `${JSON.stringify(en, null, 2)}\n`;
      return files;
    };
    /** The run's `world/hint-moves` lines, and the en table line of `id` in its repo. */
    const refused = (out: readonly string[]): string[] => out.filter((l) => l.includes(' world/hint-moves '));
    const enLine = (files: Readonly<Record<string, string>>, id: string): number => (files['story/locales/en/ch1.json'] ?? '').split('\n').indexOf(`  "${id}": {`) + 1;

    // The control: each en tier as its ru. Clean, so it exits 0 (and the levers build replaced the marker).
    const control = storyRun(repo('The code is in the letter.', 'Order: [moves].'));
    expect(control.out.filter((l) => /^[EW] /.test(l)), control.out.join('\n')).toEqual([]);
    expect(control.code).toBe(0);
    // A code puzzle's en tier holding the marker.
    const codeFiles = repo('Code: [moves].', 'Order: [moves].');
    const code = storyRun(codeFiles);
    expect(refused(code.out), code.out.join('\n')).toEqual([
      `E story/locales/en/ch1.json:${enLine(codeFiles, SAFE_HINT)} world/hint-moves code puzzle 'safe': en hint tier 1 holds [moves], which only a levers puzzle's last tier may (§7.3, W6)`,
    ]);
    expect(code.code).toBe(1);
    // The levers' last en tier without it.
    const leversFiles = repo('The code is in the letter.', 'Order.');
    const levers = storyRun(leversFiles);
    expect(refused(levers.out), levers.out.join('\n')).toEqual([
      `E story/locales/en/ch1.json:${enLine(leversFiles, DIAL_HINT)} world/hint-moves levers puzzle 'dial': its last en hint tier (1 of 1) holds no [moves], which the build replaces with the throw order (§7.3, W6)`,
    ]);
    expect(levers.code).toBe(1);
  },
  IN_PROCESS_TIMEOUT_MS,
);

test('vars: a nested inline read counts as a read', () => {
  /** ch1 assigning its VAR `seen` and saying `said`. */
  const chapter = (said: string): string[] => [...INK_HEAD.slice(0, 1), 'VAR seen = false', ...INK_HEAD.slice(1), '~ seen = true', `${said} #id:ch1.start.a001`, '-> END'];
  // `seen` read only by the outer group of a nested inline: `{g_trust}` sits inside its branch.
  expect(writeOnly([graphWith(chapter('Мы {seen: снова {g_trust}|впервые} здесь.')).facts])).toEqual([]);
  // The control: the same write, read nowhere.
  expect(writeOnly([graphWith(chapter('Мы здесь.')).facts]).map((f) => f.message)).toEqual(['VAR seen is assigned, but its chapter never reads it (§11)']);
});
