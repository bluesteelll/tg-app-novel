// The world side of the story gate (PUZZLES-PLAN "Lint codes", STAGING-DSL §11 "Enforced from LW3"): the world lint
// and the per-section soft-lock check of world.ts, and the yield edges of graph.ts. Fixture worlds are inline JSON
// in the source format; the clean base is the demo manor of PUZZLES-PLAN "World data", which each red fixture
// mutates in one place. The catalog is the committed one.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog } from '../../src/story/catalog.ts';
import type { AssetCatalog } from '../../src/story/catalog.ts';
import type { ChapterId, KnotName, PuzzleLocalId, VarName } from '../../src/story/staging.ts';
import { toPublic } from '../../src/world/decode.ts';
import { compileChapter } from './compile.ts';
import { buildGraph } from './graph.ts';
import type { ChapterGraph, GraphFacts, WorldRef } from './graph.ts';
import { GLOBALS_PATH } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';
import { decodeWorldFile, lintWorld } from './world.ts';
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

function of(findings: readonly Finding[], code: LintCode): Finding[] {
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
    'sections.manor.rooms.hall.onenter: unknown key (expected bg, title, onEnter, hotspots)',
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
    puzzles: { keypad: codePuzzle() },
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
  const within = mini({ puzzles: { keypad: codePuzzle() }, sections: { s: { start: 'r', rooms: { r: [object('a', lockOf([], 'keypad')), object('b', lockOf([], 'keypad')), leave('out')] } } } });
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
  return { kind: 'ok', body: toPublic(decoded.world) };
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
