import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { RESUME_STATE_CAP } from '../../src/explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../../src/explore/state.ts';
import type { KernelWorld } from '../../src/mechanics/contract.ts';
import { searchSection, sectionEntry } from '../../src/mechanics/rules/search.ts';
import type { SearchResult } from '../../src/mechanics/rules/search.ts';
import { decodeAssetCatalog } from '../../src/story/catalog.ts';
import type { ChapterId, SectionId } from '../../src/story/staging.ts';
import { decodeWorldSource, toPublic } from '../../src/world/decode.ts';
import type { SourceChapter } from './lint.ts';
import type { WorldLint, WorldLintInput } from './mechanics/index.ts';
import { decodeWorldFile, lintWorld } from './world.ts';

// ---------------------------------------------------------------------------------------------------------------
// Spike P2-a (engine plan §7.6, GM1b): how far today's kernel's state count grows at ch1's density when later
// mechanics are emulated with today's world format - views as rooms with ungated exits back, flags and kept tools as
// items no slot ever takes, recipes as two-slot locks with an `onOpen` give, clue facts as docs. Spike P2-b (GM5): the
// same layouts with the real modules - views as `view` rooms left by `leave-view` (GM4), recipes as `combine` recipes -
// each real configuration drawing exactly where its emulation draws. One `p2:` line per search.
// The design's claims are asserted: `views` (P2-a's emulation) and `views-real` (real views, whose counts must equal
// `views`' seed by seed) stay under the cap. A `views` or `views-real` count at the cap, or a `views-real` count that
// differs from `views`', refutes the claim and is a STOP with its counts. Every other configuration (the emulated mix,
// `recipes-real`, `views+recipes-real`, `full-mix-real`) is measured and logged, never re-tuned. The generator's
// parameters are fixed here, before any measurement.

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (owner = 'p'): Json => ({ id: `ch1.${owner}.${(lineCounter++).toString(36).padStart(4, '0')}`, ru: owner });
const RECT = [100, 200, 200, 200];
const exit = (id: string, to: string | { story: string }, lock: Json | null = null): Json => ({
  id,
  kind: 'exit',
  rect: RECT,
  label: txt(),
  to: typeof to === 'string' ? { room: to } : to,
  lock,
  sfx: null,
});
const take = (id: string, gives: { item: string } | { doc: string }): Json => ({ id, kind: 'take', rect: RECT, label: txt(), gives, prop: null, then: [] });
const look = (id: string, then: Json[] = []): Json => ({ id, kind: 'look', rect: RECT, label: txt(), look: txt(id), then });
const object = (id: string, lock: Json, then: Json[] = []): Json => ({ id, kind: 'object', rect: RECT, label: txt(), lock, then, look: null, prop: null });
const lock = (accepts: string[], puzzle: string | null, onFail: Json[] = [], onOpen: Json[] = []): Json => ({
  slots: accepts.map((a) => ({ accepts: a })),
  puzzle,
  locked: txt(),
  onOpen,
  onFail,
});
const puzzleCommon = (maxAttempts: number | null): Json => ({ title: txt(), prompt: txt(), closeup: null, maxAttempts, giveUp: false, hints: [txt()] });

/** mulberry32 (test-local): a seeded generator, so every configuration is reproducible by its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONFIGS = ['base', 'views', 'flags', 'kept-tools', 'recipes', 'clue-facts', 'full-mix'] as const;
/** P2-b's configurations: the real modules in P2-a's layouts; `full-mix-real` is P2-a's full mix with both real. */
const REAL_CONFIGS = ['views-real', 'recipes-real', 'views+recipes-real', 'full-mix-real'] as const;
type Config = (typeof CONFIGS)[number] | (typeof REAL_CONFIGS)[number];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const S = 'p2' as SectionId;
/** The spike's cap: the kernel's one cap (X9), the line the design's claim is about. */
const CAP = RESUME_STATE_CAP;

/** Two view rooms per room, each entered by an ungated exit and left by an ungated exit back (views at 2 per room). */
function withViews(rooms: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [id, r] of Object.entries(rooms)) {
    const hotspots = [...(r.hotspots as Json[])];
    for (const v of [1, 2]) {
      const view = `${id}_view${v}`;
      hotspots.push(exit(`to_view${v}`, view));
      out[view] = { bg: 'room', title: txt(), onEnter: [], hotspots: [exit('back', id)] };
    }
    out[id] = { ...r, hotspots };
  }
  return out;
}

/** Two real views per room (module `view`): each a room with `view: { of }` and no hotspot, entered by the parent's
 *  ungated exit (as `withViews`) and left by `leave-view`, the module's own way back. */
function withRealViews(rooms: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [id, r] of Object.entries(rooms)) {
    const hotspots = [...(r.hotspots as Json[])];
    for (const v of [1, 2]) {
      const view = `${id}_view${v}`;
      hotspots.push(exit(`to_view${v}`, view));
      out[view] = { bg: 'room', title: txt(), onEnter: [], hotspots: [], view: { of: id } };
    }
    out[id] = { ...r, hotspots };
  }
  return out;
}

/**
 * One section at ch1's density (`story/ch1/world.json`: 3 rooms, 11 hotspots, 2 locks, both with a puzzle, 3 items,
 * 2 docs). Fixed: the start room holds the exits to the other two and the gate (a 3-slot lock with a 3-attempt order
 * puzzle; its `onFail` queues a knot and unlocks it, so the section always has a leave); each other room has its exit
 * back. Seeded: the room of the look, of the two item takes, of the drawer (a zero-slot lock with a code puzzle whose
 * `then` gives the third item) and of the two doc takes, and which far room's `onEnter` queues a knot. Each emulation
 * adds its hotspots at seeded rooms. A real configuration draws exactly as its emulation: real recipes take the
 * emulation's two input rooms and still draw the bench's room (no bench is placed), so every later draw and P2-a's
 * layouts are unchanged.
 */
function generated(seed: number, config: Config): Json {
  const rnd = mulberry32(seed);
  const rooms = ['r0', 'r1', 'r2'];
  const place = (): string => rooms[Math.floor(rnd() * rooms.length)] ?? 'r0';
  const realMix = config === 'full-mix-real';
  // P2-a's emulations; P2-b's full mix keeps the three that have no real module yet.
  const has = (c: Config): boolean => config === c || config === 'full-mix' || (realMix && (c === 'flags' || c === 'kept-tools' || c === 'clue-facts'));
  const realViews = config === 'views-real' || config === 'views+recipes-real' || realMix;
  const realRecipes = config === 'recipes-real' || config === 'views+recipes-real' || realMix;
  const spots: Record<string, Json[]> = {
    r0: [exit('to_r1', 'r1'), exit('to_r2', 'r2'), exit('gate', { story: 'p2_out' }, lock(['i1', 'i2', 'i3'], 'gate', [{ story: 'p2_forced' }, { unlock: 'r0.gate' }]))],
    r1: [exit('to_r0', 'r0')],
    r2: [exit('to_r0', 'r0')],
  };
  const add = (room: string, h: Json): void => {
    spots[room]?.push(h);
  };
  const lookRoom = place();
  add(lookRoom, look('mark', has('flags') ? [{ give: 'f2' }] : []));
  add(place(), take('i1', { item: 'i1' }));
  add(place(), take('i3', { item: 'i3' }));
  add(place(), object('drawer', lock([], 'drawer'), [{ give: 'i2' }]));
  add(place(), take('d1', { doc: 'd1' }));
  add(place(), take('d2', { doc: 'd2' }));
  const voice = rnd() < 0.5 ? 'r1' : 'r2';
  const items = ['i1', 'i2', 'i3'];
  const docs = ['d1', 'd2'];
  if (has('flags')) {
    items.push('f1', 'f2');
  }
  if (has('kept-tools')) {
    items.push('t1', 't2');
    add(place(), take('t1', { item: 't1' }));
    add(place(), take('t2', { item: 't2' }));
  }
  if (has('recipes') || realRecipes) {
    items.push('a1', 'a2', 'product');
    add(place(), take('a1', { item: 'a1' }));
    add(place(), take('a2', { item: 'a2' }));
    const bench = place(); // drawn for real recipes too: the later draws stay P2-a's
    if (has('recipes')) {
      add(bench, object('bench', lock(['a1', 'a2'], null, [], [{ give: 'product' }])));
    }
  }
  if (has('clue-facts')) {
    docs.push('c1', 'c2');
    add(place(), take('c1', { doc: 'c1' }));
    add(place(), take('c2', { doc: 'c2' }));
  }
  const flagRoom = voice === 'r1' ? 'r2' : 'r1';
  const base: Record<string, Json> = {};
  for (const r of rooms) {
    const onEnter: Json[] = [];
    if (r === voice) {
      onEnter.push({ story: 'p2_voice' });
    }
    if (has('flags') && r === flagRoom) {
      onEnter.push({ give: 'f1' });
    }
    base[r] = { bg: 'room', title: txt(), onEnter, hotspots: spots[r] ?? [] };
  }
  return {
    format: 1,
    items: Object.fromEntries(items.map((id) => [id, { name: txt(), desc: txt(), glyph: 'key' }])),
    docs: Object.fromEntries(docs.map((id) => [id, { title: txt(), body: [txt()] }])),
    puzzles: {
      gate: { type: 'order', params: { pieces: ['i1', 'i2', 'i3'] }, solution: [1, 2, 0], ...puzzleCommon(3) },
      drawer: { type: 'code', params: { dials: 4 }, solution: [1, 1, 1, 1], ...puzzleCommon(null) },
    },
    sections: { [S]: { start: 'r0', bgm: null, rooms: has('views') ? withViews(base) : realViews ? withRealViews(base) : base } },
    ...(realRecipes ? { recipes: [{ a: 'a1', b: 'a2', gives: 'product' }] } : {}),
  };
}

/** One search: its result, its time and the edges it met per step kind (every successor, deduped or not). */
type Measured = SearchResult & { readonly ms: number; readonly edges: Readonly<Record<string, number>> };

/**
 * Decodes a source world (a world the decoder refuses fails the test) and searches every section from its entry;
 * `places` false: without the place quotient (GM5q), each room its own place.
 */
function measure(raw: unknown, places = true): Measured[] {
  return measured(raw, places).results;
}

/** `measure`, with the decoded world's module data (P2-b's non-vacuity checks read it). */
function measured(raw: unknown, places = true): { readonly results: Measured[]; readonly mods: KernelWorld['mods'] } {
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`the generated world does not decode: ${JSON.stringify(r.error)}`);
  }
  const w = { ...toPublic(r.value), mods: r.value.mods };
  const results = (Object.keys(w.sections) as SectionId[]).map((section) => {
    const edges: Record<string, number> = {};
    const t0 = performance.now();
    const found = searchSection(w, sectionEntry(w, EMPTY_WORLD_STATE, section), section, CAP, {
      places,
      onEdge: (_from, succ) => {
        edges[succ.step.kind] = (edges[succ.step.kind] ?? 0) + 1;
      },
    });
    return { ...found, ms: performance.now() - t0, edges };
  });
  return { results, mods: r.value.mods };
}

function only(results: readonly Measured[]): Measured {
  const [first] = results;
  if (first === undefined || results.length !== 1) {
    throw new Error(`invariant: one section, got ${results.length}`);
  }
  return first;
}

const report = (config: string, seed: number | string, m: Measured): void => {
  console.log(`p2: ${config} seed=${seed} states=${m.result === 'cap' ? 'cap' : m.states} ms=${m.ms.toFixed(1)}`);
};

test('spike p2: views at 2 per room fit the cap at ch1 density', () => {
  for (const seed of SEEDS) {
    const base = only(measure(generated(seed, 'base')));
    const views = only(measure(generated(seed, 'views')));
    report('base', seed, base);
    report('views', seed, views);
    expect(base.result, `seed ${seed} base`).toBe('exhausted');
    expect(views.result, `seed ${seed} views (${views.states} states)`).toBe('exhausted');
    // The emulation adds positions: a view room is a room the player stands in.
    expect(views.states, `seed ${seed}`).toBeGreaterThan(base.states);
  }
}, 60_000);

test('spike p2: the emulated mix is measured', () => {
  for (const seed of SEEDS) {
    for (const config of CONFIGS) {
      const m = only(measure(generated(seed, config)));
      report(config, seed, m);
      expect(m.states, `${config} seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  }
  // The calibration rows: the real ch1, as it is and with two view rooms per room (reported, never pinned: later
  // lanes change ch1's content).
  const ch1 = JSON.parse(readFileSync(new URL('../../../story/ch1/world.json', import.meta.url), 'utf8')) as Json & { sections: Record<string, Json & { rooms: Record<string, Json> }> };
  const ch1Views = { ...ch1, sections: Object.fromEntries(Object.entries(ch1.sections).map(([id, s]) => [id, { ...s, rooms: withViews(s.rooms) }])) };
  for (const [name, raw] of [['ch1', ch1], ['ch1+views', ch1Views]] as const) {
    for (const m of measure(raw)) {
      report(name, '-', m);
      expect(m.states, name).toBeGreaterThanOrEqual(1);
    }
  }
}, 60_000);

test('spike p2: real views at 2 per room fit the cap at ch1 density', () => {
  // P2-b's claim, measured without the place quotient (GM5q), which merges every real view into its room.
  for (const seed of SEEDS) {
    const base = only(measure(generated(seed, 'base'), false));
    const views = only(measure(generated(seed, 'views'), false));
    const real = measured(generated(seed, 'views-real'), false);
    const m = only(real.results);
    report('views-real', seed, m);
    // Non-vacuity: two real views of each of the three rooms, and the search leaves them by `leave-view`.
    expect(Object.keys(real.mods.view.of), `seed ${seed}`).toHaveLength(6);
    expect(m.edges['leave-view'] ?? 0, `seed ${seed} leave-view edges`).toBeGreaterThan(0);
    expect(m.result, `seed ${seed} views-real (${m.states} states)`).toBe('exhausted');
    expect(m.states, `seed ${seed}`).toBeGreaterThan(base.states);
    // A leave is the state the emulated exit back reaches, and no view fact enters the key: the same count.
    expect(m.states, `seed ${seed} views-real against views`).toBe(views.states);
  }
}, 60_000);

test('spike p2: real views and recipes are measured', () => {
  for (const config of ['recipes-real', 'views+recipes-real', 'full-mix-real'] as const) {
    for (const seed of SEEDS) {
      const real = measured(generated(seed, config));
      const m = only(real.results);
      report(config, seed, m);
      expect(m.states, `${config} seed ${seed}`).toBeGreaterThanOrEqual(1);
      // Non-vacuity: one real recipe, and a search that ends takes its combine.
      expect(real.mods.combine.recipes, `${config} seed ${seed}`).toHaveLength(1);
      if (config === 'recipes-real' && m.result !== 'cap') {
        expect(m.edges['combine'] ?? 0, `${config} seed ${seed} combine edges`).toBeGreaterThan(0);
      }
    }
  }
}, 120_000);

// ---------------------------------------------------------------------------------------------------------------
// The world lint registry (engine plan §3.2, GM1b): `lintWorld` runs every per-world entry of MECHANIC_LINTS with the
// world runner's inputs and its line lookup. Here, not in world.test.ts, because this is the lane's scripts test file.

const CH1: SourceChapter = { id: 'ch1' as ChapterId, paid: false, entry: 'ch1/main.ink' }; // a fixture chapter id
const FILE = 'story/ch1/world.json';

function repoText(path: string): string {
  const text = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  return text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text;
}

test("story: lintWorld runs every per-world mechanics lint at the author's line", () => {
  const catalog = decodeAssetCatalog(JSON.parse(repoText('assets/catalog.json')));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  const inputOf = (text: string): Parameters<typeof lintWorld>[0] => {
    const decoded = decodeWorldFile({ file: FILE, text });
    if (decoded.world === null) {
      throw new Error(`invariant: the world decodes: ${JSON.stringify(decoded.findings)}`);
    }
    return { chapter: CH1, file: FILE, text, world: decoded.world, catalog: catalog.value, knots: null, yielded: null, declared: new Map() };
  };
  // A per-world pass that reports at an item's path, and a story-level entry the world runner never calls.
  const text = `${JSON.stringify(generated(1, 'base'), null, 2)}\n`;
  const input = inputOf(text);
  const calls: WorldLintInput[] = [];
  const perWorld: WorldLint<'world/schema'> = {
    id: 'probe',
    codes: { 'world/schema': 'E' },
    lint: (i) => {
      calls.push(i);
      return [{ code: 'world/schema', severity: 'E', file: i.file, line: i.line('items.i2'), message: 'probe: items.i2' }];
    },
  };
  const storyLevel: WorldLint<'world/state-cap'> = { id: 'story-pass', codes: { 'world/state-cap': 'E' }, runsFrom: 'story' };
  expect('lint' in storyLevel).toBe(false);
  const r = lintWorld(input, [perWorld, storyLevel]);
  const itemLine = text.split('\n').findIndex((l) => l.trimStart().startsWith('"i2": {')) + 1;
  expect(itemLine).toBeGreaterThan(1);
  expect(r.findings.filter((f) => f.message.startsWith('probe:'))).toEqual([
    { code: 'world/schema', severity: 'E', file: FILE, line: itemLine, message: 'probe: items.i2' },
  ]);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.world).toBe(input.world);
  expect(calls[0]?.text).toBe(text);
  // A module finding sorts with the kernel's: by line, code and message.
  const order = r.findings.map((f) => `${String(f.line).padStart(6, '0')}\t${f.code}\t${f.message}`);
  expect(order).toEqual([...order].sort());
  // The default registry on the real ch1: core's entry adds no finding to today's.
  const ch1 = inputOf(repoText(FILE));
  expect(lintWorld(ch1)).toEqual(lintWorld(ch1, []));
}, 60_000);
