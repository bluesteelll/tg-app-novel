// The story build: compile (inkjs compiler), knot graph, emit and the `story` CLI (STAGING-DSL §8-§11,
// PROTOTYPE-PLAN.md K9 and "Build outputs"). Fixtures are inline ink and an inline cast; the catalog is the committed
// one.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog, decodeCast, decodeChapterCatalog, decodeChapterMeta, storyOf } from '../../src/story/catalog.ts';
import type { Cast, ChapterListEntry, StoryId } from '../../src/story/catalog.ts';
import type { AssetId, AssetIndex, ChapterId, KnotName, ProductId } from '../../src/story/staging.ts';
import { compileChapter, resolveInclude } from './compile.ts';
import type { CompiledChapter, ReadInk } from './compile.ts';
import { decodeLineFingerprints, decodeStoryUsage, paidLeak, planEmit } from './emit.ts';
import type { LineFingerprints, ServerStoryIndex, StoryNames } from './emit.ts';
import { buildGraph } from './graph.ts';
import type { ChapterGraph } from './graph.ts';
import { GLOBALS_PATH, lintSources } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';
import type { StoryPlan } from './stories.ts';

function readRepoJson(path: string): unknown {
  const text = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  return JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text);
}

/**
 * The cast the fixtures were written against (STORIES-PLAN revision 2, W1): inline, so a speaker added to
 * story/cast.json moves no test of the tool.
 */
const CAST_RAW = { ally: { char: 'ally' }, stranger: { char: 'stranger' }, voice: { char: null } };

/** The committed catalog and the inline cast, decoded against it. */
function committed(): { assets: AssetIndex; cast: Cast } {
  const catalog = decodeAssetCatalog(readRepoJson('assets/catalog.json'));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  const cast = decodeCast(CAST_RAW, catalog.value);
  if (!cast.ok) {
    throw new Error('invariant: the inline cast decodes against the committed catalog');
  }
  return { assets: assetIndex(catalog.value), cast: cast.value };
}

const COMMITTED = committed();

function chapterId(id: string): ChapterId {
  return id as ChapterId; // test fixtures name their chapters directly
}

const CH1: SourceChapter = { id: chapterId('ch1'), paid: false, entry: 'ch1/main.ink' };
const GLOBALS = 'VAR g_trust = 0\n';
const HEAD = ['INCLUDE ../common/globals.ink', '-> start', '=== start ==='];

/** The story map of one chapter: globals, `ch1/main.ink` from `main`, and the extra files as given. */
function sources(main: readonly string[], extra: Readonly<Record<string, string>> = {}): Map<string, string> {
  return new Map([[GLOBALS_PATH, GLOBALS], ['ch1/main.ink', `${main.join('\n')}\n`], ...Object.entries(extra)]);
}

/** A ReadInk over `files` that records every key it is asked for. */
function reader(files: ReadonlyMap<string, string>, log: string[] = []): ReadInk {
  return (key) => {
    log.push(key);
    return files.get(key) ?? null;
  };
}

function where(findings: readonly Finding[], code: LintCode): string[] {
  return findings.filter((f) => f.code === code).map((f) => `${f.file}:${f.line}`);
}

// ---------------------------------------------------------------------------------------------------------------
// compile.ts

test('lint: ink/compile red on fixture', () => {
  const r = compileChapter(CH1, reader(sources([...HEAD, 'Hello. #id:ch1.start.k1m2', '-> nowhere'])));
  expect(where(r.findings, 'ink/compile'), JSON.stringify(r.findings)).toEqual(['ch1/main.ink:5']);
  expect(r.findings[0]?.message).toMatch(/Divert target not found/);
  expect(r.compiled).toBeNull();
});

test('compile: warnings are errors', () => {
  // A knot whose flow runs out without a divert: inkjs raises the "Apparent loose end" WARNING.
  const main = [...HEAD, 'Hello. #id:ch1.start.k1m2', '-> loose', '=== loose ===', 'Loose. #id:ch1.loose.p3q4'];
  const r = compileChapter(CH1, reader(sources(main)));
  expect(r.findings, JSON.stringify(r.findings)).toEqual([
    expect.objectContaining({ code: 'ink/compile', severity: 'E', file: 'ch1/main.ink', line: 7 }),
  ]);
  expect(r.findings[0]?.message).toMatch(/loose end/);
  expect(r.compiled).toBeNull();
});

test('lint: ink/todo red on fixture', () => {
  const r = compileChapter(CH1, reader(sources([...HEAD, 'TODO: x', 'Hello. #id:ch1.start.k1m2', '-> END'])));
  expect(r.findings, JSON.stringify(r.findings)).toEqual([
    { code: 'ink/todo', severity: 'W', file: 'ch1/main.ink', line: 4, message: 'x' },
  ]);
  expect(r.compiled).not.toBeNull();
});

test('compile: include resolves from the entry dir', () => {
  // As the lint's walk does: `sub/b.ink` written inside `ch1/sub/a.ink` is `ch1/sub/b.ink`, not `ch1/sub/sub/b.ink`.
  const files = sources(['INCLUDE ../common/globals.ink', 'INCLUDE sub/a.ink', '-> start', '=== start ===', 'Hello. #id:ch1.start.k1m2', '-> other'], {
    'ch1/sub/a.ink': 'INCLUDE sub/b.ink\n',
    'ch1/sub/b.ink': '=== other ===\nThere. #id:ch1.other.r5s6\n-> END\n',
  });
  const r = compileChapter(CH1, reader(files));
  expect(r.findings).toEqual([]);
  expect(r.compiled?.files).toEqual(['ch1/main.ink', 'common/globals.ink', 'ch1/sub/a.ink', 'ch1/sub/b.ink']);
  // inkjs names an included file by its raw INCLUDE string; the finding carries the story key.
  files.set('ch1/sub/b.ink', '=== other ===\nThere. #id:ch1.other.r5s6\n-> nowhere\n');
  expect(where(compileChapter(CH1, reader(files)).findings, 'ink/compile')).toEqual(['ch1/sub/b.ink:3']);
  expect(resolveInclude('ch1/main.ink', 'sub/b.ink')).toBe('ch1/sub/b.ink');
  expect(resolveInclude('ch1/main.ink', '../common/globals.ink')).toBe('common/globals.ink');
  expect(resolveInclude('ch1/main.ink', './sub/../x.ink')).toBe('ch1/x.ink');
});

test('compile: include outside the story root is refused', () => {
  for (const path of ['../../x.ink', 'C:/x.ink', 'sub\\x.ink']) {
    expect(resolveInclude('ch1/main.ink', path), path).toBeNull();
    const log: string[] = [];
    // Every refused key exists in the map: only the handler's refusal keeps the compiler from loading it.
    const files = sources(['INCLUDE ../common/globals.ink', `INCLUDE ${path}`, '-> start', '=== start ===', 'Hello. #id:ch1.start.k1m2', '-> END'], {
      '../x.ink': 'Leaked.\n',
      'C:/x.ink': 'Leaked.\n',
      'sub\\x.ink': 'Leaked.\n',
      'ch1/sub\\x.ink': 'Leaked.\n',
      'x.ink': 'Leaked.\n',
    });
    const r = compileChapter(CH1, reader(files, log));
    expect(where(r.findings, 'ink/compile'), `${path}: ${JSON.stringify(r.findings)}`).toEqual(['ch1/main.ink:2']);
    expect(r.findings[0]?.message).toMatch(/^Failed to load/);
    expect(log, path).toEqual(['ch1/main.ink', 'common/globals.ink']);
    expect(r.compiled).toBeNull();
  }
});

test('compile: a clean chapter compiles with no findings', () => {
  const r = compileChapter(CH1, reader(sources([...HEAD, 'ally: Привет. #id:ch1.start.k1m2', '-> END'])));
  expect(r.findings).toEqual([]);
  expect(r.compiled?.chapter).toBe('ch1');
  expect(JSON.parse(r.compiled?.json ?? '{}')).toHaveProperty('inkVersion', 21);
  expect(r.compiled?.files).toEqual(['ch1/main.ink', 'common/globals.ink']);
});

// ---------------------------------------------------------------------------------------------------------------
// graph.ts

/** Compiles `files` as chapter `ch` (the fixture must compile cleanly) and builds its graph. */
function graphOf(files: ReadonlyMap<string, string>, ch: SourceChapter = CH1): { graph: ChapterGraph; findings: Finding[] } {
  const r = compileChapter(ch, reader(files));
  expect(r.findings, `fixture compiles: ${JSON.stringify(r.findings)}`).toEqual([]);
  if (r.compiled === null) {
    throw new Error('invariant: a fixture with no findings compiled');
  }
  return buildGraph({ chapter: ch, files: r.compiled.files, sources: files, assets: COMMITTED.assets });
}

/** 1-based line of `text` in `lines`. */
function lineOf(lines: readonly string[], text: string): number {
  const i = lines.indexOf(text);
  if (i < 0) {
    throw new Error(`invariant: fixture line '${text}' exists`);
  }
  return i + 1;
}

function carriedOf(g: ChapterGraph): Record<string, readonly string[]> {
  return Object.fromEntries(g.carried);
}

test('graph: carry propagates until cleared', () => {
  const main = [
    'INCLUDE ../common/globals.ink',
    '-> a',
    '=== a ===',
    '# scene: room',
    '# show: ally neutral at=left',
    '# show: stranger neutral at=right',
    'First. #id:ch1.a.c001',
    '# cg: letter',
    'Second. #id:ch1.a.c002',
    '-> b',
    '=== b ===',
    '# show: ally smile',
    'ally: Hi. #id:ch1.b.c003',
    '* [To the street. #id:ch1.b.c004]',
    '    -> c',
    '* [To the cafe. #id:ch1.b.c005]',
    '    -> d',
    '=== c ===',
    '# scene: street',
    'Street. #id:ch1.c.c006',
    '-> END',
    '=== d ===',
    'One. #id:ch1.d.c007',
    '# scene: cafe',
    'Two. #id:ch1.d.c008',
    '-> END',
  ];
  const files = sources(main);
  const lint = lintSources({ files, chapters: [CH1], assets: COMMITTED.assets, cast: COMMITTED.cast });
  expect(lint, 'the fixture is lint-clean').toEqual([]);
  const { graph, findings } = graphOf(files);
  expect(findings).toEqual([]);
  expect(carriedOf(graph)).toEqual({
    a: [],
    // b's opening `show: ally smile` replaces ally's sprite; the rest of a's stage stays.
    b: ['bg/room', 'cg/letter', 'char/stranger/neutral'],
    c: [],
    // A `scene` below d's first line is not an opening tag line: it clears nothing the budget credits.
    d: ['bg/room', 'cg/letter', 'char/ally/smile', 'char/stranger/neutral'],
  });

  // The first knot is seeded with the empty stage, not pinned to it, and the stage is a fixed point, not one pass:
  // in a hub hall → corridor → study → attic → hall, the CG study leaves reaches hall only through attic, and
  // neither hall nor its successor names it. A pinned seed, or one sweep in source order, gives hall [].
  const hub = [
    'INCLUDE ../common/globals.ink',
    '-> hall',
    '=== hall ===',
    '# bg: room',
    'Hall. #id:ch1.hall.h001',
    '* [Corridor. #id:ch1.hall.h002]',
    '    -> corridor',
    '* [Leave. #id:ch1.hall.h003]',
    '    -> END',
    '=== corridor ===',
    'Corridor. #id:ch1.corridor.h004',
    '-> study',
    '=== study ===',
    'Study. #id:ch1.study.h005',
    '# cg: letter',
    'A letter. #id:ch1.study.h006',
    '-> attic',
    '=== attic ===',
    'Attic. #id:ch1.attic.h007',
    '-> hall',
  ];
  const hubFiles = sources(hub);
  expect(lintSources({ files: hubFiles, chapters: [CH1], assets: COMMITTED.assets, cast: COMMITTED.cast })).toEqual([]);
  const looped = graphOf(hubFiles);
  expect(looped.findings).toEqual([]);
  expect(carriedOf(looped.graph)).toEqual({ hall: ['cg/letter'], corridor: ['bg/room'], study: ['bg/room'], attic: ['cg/letter'] });
});

test('lint: graph/entry-below-top red on fixture', () => {
  const main = [
    'INCLUDE ../common/globals.ink',
    '-> j',
    '=== j ===',
    '# bg: room',
    '# show: ally neutral',
    'J. #id:ch1.j.e001',
    '* [Into the stitch. #id:ch1.j.e002]',
    '    -> k.s',
    '* [Into the gather. #id:ch1.j.e003]',
    '    -> k.g',
    '=== k ===',
    '# scene: street',
    'K. #id:ch1.k.e004',
    '- (g) Gathered. #id:ch1.k.e005',
    '-> k.s',
    '= s',
    'In s. #id:ch1.k.e006',
    '-> END',
  ];
  const { graph, findings } = graphOf(sources(main));
  // `-> k.s` written inside k is intra-knot: not flagged.
  expect(where(findings, 'graph/entry-below-top'), JSON.stringify(findings)).toEqual([
    `ch1/main.ink:${lineOf(main, '    -> k.s')}`,
    `ch1/main.ink:${lineOf(main, '    -> k.g')}`,
  ]);
  // Why it is an error: k's opening `scene` is credited as a clear, which these diverts skip at runtime.
  expect(graph.carried.get('k' as KnotName)).toEqual([]);
  expect(graph.knots.get('j' as KnotName)?.next).toEqual(['k']);

  // A dotted entry divert starts the chapter below the first knot's top too.
  const entry = ['INCLUDE ../common/globals.ink', '-> k.s', '=== k ===', '# scene: street', 'K. #id:ch1.k.e004', '-> s', '= s', 'In s. #id:ch1.k.e006', '-> END'];
  const dotted = graphOf(sources(entry));
  expect(where(dotted.findings, 'graph/entry-below-top'), JSON.stringify(dotted.findings)).toEqual(['ch1/main.ink:2']);
  expect(dotted.graph.firstKnot).toBe('k');
});

test('lint: graph/unreachable-knot red on fixture', () => {
  const main = [...HEAD, 'Hello. #id:ch1.start.u001', '-> END', '=== orphan ===', 'Nobody comes here. #id:ch1.orphan.u002', '-> END'];
  const { findings } = graphOf(sources(main));
  expect(where(findings, 'graph/unreachable-knot'), JSON.stringify(findings)).toEqual([`ch1/main.ink:${lineOf(main, '=== orphan ===')}`]);
  expect(findings.map((f) => f.code)).toEqual(['graph/unreachable-knot']);
});

test('lint: graph/no-end red on fixture', () => {
  const main = ['INCLUDE ../common/globals.ink', '-> a', '=== a ===', 'A. #id:ch1.a.n001', '-> b', '=== b ===', 'B. #id:ch1.b.n002', '-> a'];
  const { findings } = graphOf(sources(main));
  expect(findings, JSON.stringify(findings)).toEqual([
    expect.objectContaining({ code: 'graph/no-end', severity: 'E', file: 'ch1/main.ink', line: 2 }),
  ]);
});

test('lint: ink/forbidden red on fixture (variable divert)', () => {
  const main = [
    'INCLUDE ../common/globals.ink',
    'VAR target = -> c',
    '-> a',
    '=== a ===',
    'A. #id:ch1.a.v001',
    '~ temp t = -> b',
    '-> t',
    '=== b ===',
    'B. #id:ch1.b.v002',
    '-> target',
    '=== c ===',
    'C. #id:ch1.c.v003',
    '-> END',
  ];
  const { findings } = graphOf(sources(main));
  expect(where(findings, 'ink/forbidden'), JSON.stringify(findings)).toEqual([
    `ch1/main.ink:${lineOf(main, '-> t')}`,
    `ch1/main.ink:${lineOf(main, '-> target')}`,
  ]);
});

test('graph: successors, assets and endings per knot', () => {
  const main = [
    'INCLUDE ../common/globals.ink',
    'VAR local_count = 0',
    'CONST LIMIT = 3',
    '-> hub',
    '=== hub ===',
    '# bg: room',
    '# bgm: calm',
    'ally: Where to? #id:ch1.hub.s001',
    '* [Street. #id:ch1.hub.s002]',
    '    -> street',
    '* [Cafe. #id:ch1.hub.s003]',
    '    -> cafe',
    '* [Stay. #id:ch1.hub.s004]',
    '    -> inner',
    '= inner',
    '# sfx: door',
    'Stay a while. #id:ch1.hub.s005',
    '-> wait_here',
    '- (wait_here) Waiting. #id:ch1.hub.s006',
    '-> street',
    '=== street ===',
    'Cold. #id:ch1.street.s007',
    '-> cafe',
    '=== cafe ===',
    '# scene: cafe',
    '# show: ally smile',
    '~ local_count = inc(local_count)',
    'Warm \\# inside. #id:ch1.cafe.s008',
    '-> END',
  ];
  const files = sources(main);
  files.set(GLOBALS_PATH, 'VAR g_trust = 0\n=== function inc(x) ===\n~ return x + 1\n');
  const { graph, findings } = graphOf(files);
  expect(findings).toEqual([]);
  expect(graph.firstKnot).toBe('hub');
  expect([...graph.knots.keys()]).toEqual(['hub', 'street', 'cafe']); // source order; the function is no knot
  const view = Object.fromEntries([...graph.knots].map(([k, n]) => [k, { assets: n.assets, next: n.next, ending: n.ending }]));
  expect(view).toEqual({
    // `-> inner` (a stitch) and `-> wait_here` (a label) are intra-knot: not successors.
    hub: { assets: ['bg/room', 'bgm/calm', 'sfx/door'], next: ['cafe', 'street'], ending: false },
    street: { assets: [], next: ['cafe'], ending: false },
    cafe: { assets: ['bg/cafe', 'char/ally/smile'], next: [], ending: true },
  });
  expect(graph.knots.get('hub' as KnotName)).toMatchObject({ file: 'ch1/main.ink', line: 5, clears: { all: false, bg: true, cg: false, chars: [] } });
  expect(graph.knots.get('cafe' as KnotName)?.clears).toEqual({ all: true, bg: false, cg: false, chars: ['ally'] });
  // Audio is never carried: only images stay on stage.
  expect(carriedOf(graph)).toEqual({ hub: [], street: ['bg/room'], cafe: [] });
  expect(graph.vars).toEqual(['g_trust', 'local_count']);
  expect(graph.globals).toEqual(['g_trust']);
  expect(graph.lines.map((l) => [l.id, l.text, `${l.file}:${l.line}`])).toEqual([
    ['ch1.hub.s001', 'Where to?', 'ch1/main.ink:8'],
    ['ch1.hub.s002', 'Street.', 'ch1/main.ink:9'],
    ['ch1.hub.s003', 'Cafe.', 'ch1/main.ink:11'],
    ['ch1.hub.s004', 'Stay.', 'ch1/main.ink:13'],
    ['ch1.hub.s005', 'Stay a while.', 'ch1/main.ink:17'],
    ['ch1.hub.s006', 'Waiting.', 'ch1/main.ink:19'],
    ['ch1.street.s007', 'Cold.', 'ch1/main.ink:22'],
    ['ch1.cafe.s008', 'Warm # inside.', 'ch1/main.ink:28'],
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// emit.ts and the catalog.ts output decoders

const CH1_ENTRY: ChapterListEntry = { id: chapterId('ch1'), entry: 'ch1/main.ink', paid: false, productId: null, next: chapterId('ch2') };
const CH2_ENTRY: ChapterListEntry = { id: chapterId('ch2'), entry: 'ch2/main.ink', paid: true, productId: 'chapter:ch2' as ProductId, next: null };
const LIST: readonly ChapterListEntry[] = [CH1_ENTRY, CH2_ENTRY];
const SHARED = 'Общая строка для двух глав, длиннее двадцати четырёх.';
/** Escaped as `\"` in the story JSON: never verbatim in a leaked copy, so never a text needle. */
const QUOTED = 'Он сказал: "ключ под ковром", и это самая длинная строка во всей платной главе, честно.';
const LONGEST = 'В ящике лежит старое письмо без подписи и без даты, сложенное вчетверо.';
const NUMBERED = Array.from({ length: 11 }, (_, i) => `Строка номер ${i + 1} в платной главе, достаточно длинная.`);
const EMIT_SOURCES = new Map([
  [GLOBALS_PATH, GLOBALS],
  [
    'ch1/main.ink',
    [
      'INCLUDE ../common/globals.ink',
      '-> cafe',
      '=== cafe ===',
      '# scene: cafe',
      '# show: ally neutral at=left',
      'ally: Добро пожаловать в кафе на углу улицы. #id:ch1.cafe.f001',
      `${SHARED} #id:ch1.cafe.f002`,
      '-> END',
      '',
    ].join('\n'),
  ],
  [
    'ch2/main.ink',
    [
      'INCLUDE ../common/globals.ink',
      '-> archive',
      '=== archive ===',
      '# scene: archive',
      '# bgm: mystery',
      `${SHARED} #id:ch2.archive.p001`,
      `${QUOTED} #id:ch2.archive.p002`,
      ...NUMBERED.map((t, i) => `${t} #id:ch2.archive.n${String(i).padStart(3, '0')}`),
      'Коротко. #id:ch2.archive.p003',
      '* [Открыть ящик. #id:ch2.archive.p004]',
      '    -> drawer',
      '=== drawer ===',
      '# cg: reveal',
      `${LONGEST} #id:ch2.drawer.p005`,
      '-> END',
      '',
    ].join('\n'),
  ],
]);
/** The fixture story's title and teaser (STAGING-DSL §4): public text, so it names nothing of the paid chapter. */
const MANOR_NAMES = {
  stories: { manor: { ru: 'Усадьба', en: 'The Manor' } },
  teasers: { manor: { ru: 'Черновик истории для проверки сборки.', en: 'A draft story for the build check.' } },
};
const NAMES = {
  chapters: { ch1: { ru: 'ch1', en: 'ch1' }, ch2: { ru: 'ch2', en: 'ch2' } },
  speakers: { ally: { ru: 'ally', en: 'ally' }, stranger: { ru: 'stranger', en: 'stranger' }, voice: { ru: 'voice', en: 'voice' } },
  ...MANOR_NAMES,
} as StoryNames; // placeholder names keyed by the fixture's ids
/** The fixture's story as decodeStories plans it (STORIES_SOURCE below): ch1 → ch2, the paid ending on `drawer`. */
const MANOR: StoryPlan = {
  id: 'manor' as StoryId,
  first: chapterId('ch1'),
  cover: 'cover/manor' as AssetId,
  endings: { q7_sealed_vault: { chapter: chapterId('ch2'), knot: 'drawer' as KnotName } } as StoryPlan['endings'],
  chapters: [chapterId('ch1'), chapterId('ch2')],
}; // fixture ids match their grammars

type EmitFixture = { plan: ReadonlyMap<string, string>; compiled: Map<ChapterId, CompiledChapter>; graphs: Map<ChapterId, ChapterGraph> };

/** Compiles and graphs the two-chapter fixture (both lint-clean) and plans its outputs for `stories`. */
function emitFixture(list: readonly ChapterListEntry[] = LIST, stories: readonly StoryPlan[] = [MANOR]): EmitFixture {
  const chapters = list.map((ch): SourceChapter => ({ id: ch.id, paid: ch.paid, entry: ch.entry }));
  expect(lintSources({ files: EMIT_SOURCES, chapters, assets: COMMITTED.assets, cast: COMMITTED.cast }), 'lint-clean').toEqual([]);
  const compiled = new Map<ChapterId, CompiledChapter>();
  const graphs = new Map<ChapterId, ChapterGraph>();
  for (const ch of list) {
    const source: SourceChapter = { id: ch.id, paid: ch.paid, entry: ch.entry };
    const r = compileChapter(source, reader(EMIT_SOURCES));
    if (r.compiled === null) {
      throw new Error(`invariant: fixture ${ch.id} compiles: ${JSON.stringify(r.findings)}`);
    }
    compiled.set(ch.id, r.compiled);
    graphs.set(ch.id, buildGraph({ chapter: source, files: r.compiled.files, sources: EMIT_SOURCES, assets: COMMITTED.assets }).graph);
  }
  // The en text of each line is `en <id>`, as localeFiles() writes it.
  const en = new Map(list.map((ch) => [ch.id, Object.fromEntries((graphs.get(ch.id)?.lines ?? []).map((l) => [l.id, `en ${l.id}`]))]));
  return { plan: planEmit({ chapters: list, compiled, graphs, cast: COMMITTED.cast, names: NAMES, en, stories }), compiled, graphs };
}

function planned(plan: ReadonlyMap<string, string>, path: string): string {
  const text = plan.get(path);
  if (text === undefined) {
    throw new Error(`invariant: ${path} is planned; planned: ${[...plan.keys()].join(', ')}`);
  }
  return text;
}

function fingerprintsOf(plan: ReadonlyMap<string, string>): LineFingerprints {
  const fp = decodeLineFingerprints(JSON.parse(planned(plan, 'server/content/build/fingerprints.lines.json')));
  if (!fp.ok) {
    throw new Error(`invariant: planned fingerprints decode: ${fp.error.join('; ')}`);
  }
  return fp.value;
}

const CH2_STORY = 'server/content/chapters/ch2/story.json';

test('lint: paid/leak red on fixture', () => {
  const { plan } = emitFixture();
  const fp = fingerprintsOf(plan);
  // The paid chapter routed into story-gen by mistake, next to the (clean) public catalog.
  const storyGen = new Map([
    ['client/src/story-gen/free/ch2.story.json', planned(plan, CH2_STORY)],
    ['client/src/story-gen/catalog.json', planned(plan, 'client/src/story-gen/catalog.json')],
  ]);
  const findings = paidLeak(storyGen, fp);
  expect(findings).toContainEqual(
    expect.objectContaining({ code: 'paid/leak', severity: 'E', file: 'client/src/story-gen/free/ch2.story.json', line: 0, message: expect.stringContaining("'ch2.archive.p001'") }),
  );
  expect(findings).toContainEqual(expect.objectContaining({ code: 'paid/leak', message: expect.stringContaining(JSON.stringify(LONGEST)) }));
  expect(findings.filter((f) => f.file !== 'client/src/story-gen/free/ch2.story.json')).toEqual([]);
  expect(paidLeak(new Map([['client/src/story-gen/free/ch1.story.json', planned(plan, 'client/src/story-gen/free/ch1.story.json')]]), fp)).toEqual([]);
});

test('emit: free and paid outputs are routed apart', () => {
  const { plan, compiled } = emitFixture();
  expect([...plan.keys()].sort()).toEqual([
    'client/src/story-gen/catalog.json',
    'client/src/story-gen/free/ch1.en.json',
    'client/src/story-gen/free/ch1.meta.json',
    'client/src/story-gen/free/ch1.story.json',
    'server/content/build/fingerprints.lines.json',
    'server/content/build/usage.json',
    'server/content/chapters/ch2/en.json',
    'server/content/chapters/ch2/meta.json',
    'server/content/chapters/ch2/story.json',
    'server/content/stories.json',
  ]);
  // The exact ToJson() text, not a re-serialization.
  expect(plan.get('client/src/story-gen/free/ch1.story.json')).toBe(compiled.get(chapterId('ch1'))?.json);
  expect(plan.get(CH2_STORY)).toBe(compiled.get(chapterId('ch2'))?.json);
  const fp = fingerprintsOf(plan);
  for (const [path, text] of plan) {
    if (path.startsWith('client/')) {
      expect(fp.lineIds.filter((id) => text.includes(id)), path).toEqual([]);
    }
  }
});

test('emit: meta holds the knot index and the story version', () => {
  const { plan } = emitFixture();
  const version = (path: string): string => createHash('sha256').update(Buffer.from(planned(plan, path), 'utf8')).digest('hex').slice(0, 16);
  expect(JSON.parse(planned(plan, 'client/src/story-gen/free/ch1.meta.json'))).toEqual({
    chapterId: 'ch1',
    storyVersion: version('client/src/story-gen/free/ch1.story.json'),
    firstKnot: 'cafe',
    globals: ['g_trust'],
    vars: ['g_trust'],
    knots: { cafe: { assets: ['bg/cafe', 'char/ally/neutral'], next: [], ending: true } },
    endings: {},
  });
  expect(JSON.parse(planned(plan, 'server/content/chapters/ch2/meta.json'))).toEqual({
    chapterId: 'ch2',
    storyVersion: version(CH2_STORY),
    firstKnot: 'archive',
    globals: ['g_trust'],
    vars: ['g_trust'],
    knots: {
      archive: { assets: ['bg/archive', 'bgm/mystery'], next: ['drawer'], ending: false },
      drawer: { assets: ['cg/reveal'], next: [], ending: true },
    },
    endings: { drawer: 'q7_sealed_vault' },
  });
});

test('emit: usage holds assets and the carried stage per knot', () => {
  const { plan } = emitFixture();
  const usage = decodeStoryUsage(JSON.parse(planned(plan, 'server/content/build/usage.json')));
  expect(usage).toEqual({
    ok: true,
    value: {
      chapters: {
        ch1: { assets: ['bg/cafe', 'char/ally/neutral'], knots: { cafe: { assets: ['bg/cafe', 'char/ally/neutral'], next: [], carried: [] } } },
        ch2: {
          assets: ['bg/archive', 'bgm/mystery', 'cg/reveal'],
          knots: {
            archive: { assets: ['bg/archive', 'bgm/mystery'], next: ['drawer'], carried: [] },
            // drawer's opening `cg` clears the CG slot only; archive's background stays on stage.
            drawer: { assets: ['cg/reveal'], next: [], carried: ['bg/archive'] },
          },
        },
      },
    },
  });
  expect(decodeStoryUsage({ chapters: { ch1: { assets: ['bg/x'], knots: { k: { assets: [], next: ['Bad'], carried: [] } } } } }).ok).toBe(false);
});

test('emit: line fingerprints cover every paid line', () => {
  const { plan, graphs } = emitFixture();
  const fp = fingerprintsOf(plan);
  const paidIds = graphs.get(chapterId('ch2'))?.lines.map((l) => l.id) ?? [];
  expect(paidIds).toHaveLength(16);
  expect(fp.lineIds).toEqual([...paidIds].sort());
  expect(fp.lineIds.filter((id) => !id.startsWith('ch2.'))).toEqual([]);
  // Every 10th eligible line of >= 24 code points (the 1st and the 11th numbered line), plus the longest eligible
  // one; the shared line (also in ch1) and the quoted one (escaped in JSON) are not eligible.
  expect(fp.texts).toEqual([NUMBERED[0], NUMBERED[10], LONGEST]);
  const paid = planned(plan, CH2_STORY);
  const free = planned(plan, 'client/src/story-gen/free/ch1.story.json');
  for (const t of fp.texts) {
    expect(paid.includes(t), t).toBe(true);
    expect(free.includes(t), t).toBe(false);
  }
  expect(paid.includes(QUOTED)).toBe(false);
  // A free-only story has no needles at all.
  const freeOnly = fingerprintsOf(emitFixture([{ ...CH1_ENTRY, next: null }], [{ ...MANOR, endings: {}, chapters: [CH1_ENTRY.id] }]).plan);
  expect(freeOnly).toEqual({ lineIds: [], texts: [] });
  expect(decodeLineFingerprints({ lineIds: [], texts: [''] }).ok).toBe(false);
});

test('emit: outputs are byte-identical across runs', () => {
  const first = emitFixture().plan;
  const second = emitFixture().plan;
  expect([...second.keys()]).toEqual([...first.keys()]);
  for (const [path, text] of first) {
    expect(second.get(path), path).toBe(text);
  }
});

test('catalog: emitted chapter catalog and meta decode', () => {
  const { plan } = emitFixture();
  expect(decodeChapterCatalog(JSON.parse(planned(plan, 'client/src/story-gen/catalog.json')))).toEqual({
    ok: true,
    value: {
      stories: [{ id: 'manor', chapters: ['ch1', 'ch2'], cover: 'cover/manor', title: MANOR_NAMES.stories.manor, teaser: MANOR_NAMES.teasers.manor }],
      chapters: [
        { id: 'ch1', paid: false, productId: null, next: 'ch2', title: { ru: 'ch1', en: 'ch1' } },
        { id: 'ch2', paid: true, productId: 'chapter:ch2', next: null, title: { ru: 'ch2', en: 'ch2' } },
      ],
      cast: {
        ally: { char: 'ally', name: { ru: 'ally', en: 'ally' } },
        stranger: { char: 'stranger', name: { ru: 'stranger', en: 'stranger' } },
        voice: { char: null, name: { ru: 'voice', en: 'voice' } },
      },
    },
  });
  for (const path of ['client/src/story-gen/free/ch1.meta.json', 'server/content/chapters/ch2/meta.json']) {
    const meta = decodeChapterMeta(JSON.parse(planned(plan, path)));
    expect(meta.ok, JSON.stringify(meta)).toBe(true);
  }
});

test('catalog: malformed meta is an error value', () => {
  const good = { chapterId: 'ch1', storyVersion: '0123456789abcdef', firstKnot: 'a', globals: [], vars: [], knots: { a: { assets: [], next: [], ending: true } }, endings: {} };
  expect(decodeChapterMeta(good).ok).toBe(true);
  const cases: Array<readonly [string, unknown]> = [
    ['not an object', [good]],
    ['storyVersion', { ...good, storyVersion: '0123' }],
    ['firstKnot', { ...good, firstKnot: 'b' }],
    ['knots.a.next', { ...good, knots: { a: { assets: [], next: ['b'], ending: true } } }],
    ['knots.a.assets.0', { ...good, knots: { a: { assets: ['img/x'], next: [], ending: true } } }],
    ['extra', { ...good, extra: 1 }],
    ['globals', { ...good, globals: ['g_x'] }],
    ['chapterId', { ...good, chapterId: 'chapter1' }],
  ];
  for (const [path, raw] of cases) {
    const r = decodeChapterMeta(raw);
    expect(r.ok, path).toBe(false);
    if (!r.ok) {
      expect(r.error.every((i) => i.file === 'meta.json'), path).toBe(true);
      expect(r.error.map((i) => i.path).join(' '), path).toContain(path === 'not an object' ? '' : path);
    }
  }
  expect(decodeChapterCatalog({ chapters: [{ id: 'ch1' }], cast: {} }).ok).toBe(false);
});

const STORY_INDEX = 'server/content/stories.json';
const PAID_ENDING = 'q7_sealed_vault';

/** Per object path, the union of its keys (an array element is `[]`, an ending name `*`); per leaf path, its types. */
function shapeOf(value: unknown): { keys: Record<string, string[]>; leaves: Record<string, string[]> } {
  const keys = new Map<string, Set<string>>();
  const leaves = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, path: string, x: string | null): void => {
    const set = m.get(path) ?? new Set<string>();
    if (x !== null) {
      set.add(x);
    }
    m.set(path, set);
  };
  const walk = (x: unknown, path: string): void => {
    if (Array.isArray(x)) {
      x.forEach((e: unknown) => walk(e, `${path}[]`));
    } else if (typeof x === 'object' && x !== null) {
      add(keys, path, null);
      for (const [k, e] of Object.entries(x)) {
        const key = path.endsWith('.endings') ? '*' : k;
        add(keys, path, key);
        walk(e, `${path}.${key}`);
      }
    } else {
      add(leaves, path, x === null ? 'null' : typeof x);
    }
  };
  walk(value, '');
  const sorted = (m: Map<string, Set<string>>): Record<string, string[]> => Object.fromEntries([...m].map(([k, v]) => [k, [...v].sort()]).sort());
  return { keys: sorted(keys), leaves: sorted(leaves) };
}

/** The rules server/src/content.rs `load_index` refuses a story index for; [] when it loads. */
function indexProblems(index: ServerStoryIndex): string[] {
  const out: string[] = [];
  if (index.format !== 1 || index.stories.length === 0) {
    out.push('format 1 with at least one story');
  }
  const storyIds = new Set<string>();
  const chapterIds = new Set<string>();
  for (const s of index.stories) {
    if (storyIds.has(s.id)) {
      out.push(`story ${s.id} twice`);
    }
    storyIds.add(s.id);
    if (s.chapters[0]?.paid !== false) {
      out.push(`story ${s.id}: no free first chapter`);
    }
    for (const c of s.chapters) {
      if (chapterIds.has(c.id)) {
        out.push(`chapter ${c.id} twice`);
      }
      chapterIds.add(c.id);
      if (c.productId !== (c.paid ? `chapter:${c.id}` : null)) {
        out.push(`chapter ${c.id}: paid ${String(c.paid)} with productId ${String(c.productId)}`);
      }
    }
    for (const [name, e] of Object.entries(s.endings)) {
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) {
        out.push(`story ${s.id}: ending name ${name}`);
      }
      if (!s.chapters.some((c) => c.id === e.chapter)) {
        out.push(`story ${s.id}: ending ${name} off the chain`);
      }
    }
  }
  return out;
}

test('emit: server story index matches the server fixture shape', () => {
  const { plan } = emitFixture();
  const emitted: unknown = JSON.parse(planned(plan, STORY_INDEX));
  const fixture: unknown = readRepoJson('server/tests/fixtures/content/stories.json');
  const want = shapeOf(fixture);
  const got = shapeOf(emitted);
  // The same keys at every object path; every emitted leaf a type the fixture has there (productId: null or string).
  expect(got.keys).toEqual(want.keys);
  expect(Object.keys(got.leaves)).toEqual(Object.keys(want.leaves));
  for (const [path, types] of Object.entries(got.leaves)) {
    expect(types.filter((t) => !(want.leaves[path] ?? []).includes(t)), path).toEqual([]);
  }
  expect(want.leaves['.stories[].chapters[].productId']).toEqual(['null', 'string']);
  // The shapes match, so the rules load_index applies read the typed fields; the fixture is their control.
  expect(indexProblems(fixture as ServerStoryIndex)).toEqual([]);
  expect(indexProblems(emitted as ServerStoryIndex)).toEqual([]);
  expect(emitted).toEqual({
    format: 1,
    stories: [
      {
        id: 'manor',
        title: MANOR_NAMES.stories.manor,
        chapters: [
          { id: 'ch1', paid: false, productId: null, title: { ru: 'ch1', en: 'ch1' } },
          { id: 'ch2', paid: true, productId: 'chapter:ch2', title: { ru: 'ch2', en: 'ch2' } },
        ],
        endings: { [PAID_ENDING]: { chapter: 'ch2' } },
      },
    ],
  });
});

test('emit: public catalog lists stories without endings', () => {
  const { plan } = emitFixture();
  const text = planned(plan, 'client/src/story-gen/catalog.json');
  const stories = (JSON.parse(text) as Record<string, unknown>)['stories']; // the decoder's own test reads the rest
  expect(stories).toEqual([{ id: 'manor', chapters: ['ch1', 'ch2'], cover: 'cover/manor', title: MANOR_NAMES.stories.manor, teaser: MANOR_NAMES.teasers.manor }]);
  expect((stories as ReadonlyArray<Readonly<Record<string, unknown>>>).map((s) => Object.keys(s).sort())).toEqual([['chapters', 'cover', 'id', 'teaser', 'title']]);
  expect(text).not.toContain('"endings"');
  expect(text).not.toContain(PAID_ENDING);
});

test('emit: meta carries endings', () => {
  const { plan } = emitFixture();
  const paid = JSON.parse(planned(plan, 'server/content/chapters/ch2/meta.json')) as Record<string, unknown>; // a JSON object
  expect(paid['endings']).toEqual({ drawer: PAID_ENDING });
  expect(decodeChapterMeta(paid)).toMatchObject({ ok: true, value: { endings: { drawer: PAID_ENDING } } });
  const free = JSON.parse(planned(plan, 'client/src/story-gen/free/ch1.meta.json')) as Record<string, unknown>; // a JSON object
  expect(free['endings']).toEqual({});
});

test('emit: paid endings only in server outputs', () => {
  const { plan } = emitFixture();
  // The control: the paid chapter's ending name is planned, in its meta and in the server story index.
  expect(planned(plan, 'server/content/chapters/ch2/meta.json')).toContain(PAID_ENDING);
  expect(planned(plan, STORY_INDEX)).toContain(PAID_ENDING);
  // It is a substring of no public build input.
  expect([...plan].filter(([path, text]) => path.startsWith('client/src/story-gen/') && text.includes(PAID_ENDING)).map(([path]) => path)).toEqual([]);
});

test('catalog: meta without endings is malformed', () => {
  const knots = { a: { assets: [], next: [], ending: true } };
  const without = { chapterId: 'ch1', storyVersion: '0123456789abcdef', firstKnot: 'a', globals: [], vars: [], knots };
  expect(decodeChapterMeta(without).ok).toBe(false);
  expect(decodeChapterMeta(without)).toEqual({ ok: false, error: [{ file: 'meta.json', path: 'endings', detail: 'missing' }] });
  // An ending names a knot of the index, by an EndingName.
  expect(decodeChapterMeta({ ...without, endings: { b: 'end' } })).toEqual({
    ok: false,
    error: [{ file: 'meta.json', path: 'endings.b', detail: "'b' is not a knot of this index" }],
  });
  expect(decodeChapterMeta({ ...without, endings: { a: 'End' } }).ok).toBe(false);
  expect(decodeChapterMeta({ ...without, endings: [] }).ok).toBe(false);
  expect(decodeChapterMeta({ ...without, endings: { a: 'end' } })).toMatchObject({ ok: true, value: { endings: { a: 'end' } } });
});

test('catalog: catalog with stories decodes', () => {
  const story = { id: 'manor', chapters: ['ch1', 'ch2'], cover: 'cover/manor', title: { ru: 'Усадьба', en: 'The Manor' }, teaser: { ru: 'Тизер.', en: 'Teaser.' } };
  const chapters = [
    { id: 'ch1', paid: false, productId: null, next: 'ch2', title: { ru: 'Глава 1', en: 'Chapter 1' } },
    { id: 'ch2', paid: true, productId: 'chapter:ch2', next: null, title: { ru: 'Глава 2', en: 'Chapter 2' } },
  ];
  const raw = { stories: [story], chapters, cast: {} };
  const r = decodeChapterCatalog(raw);
  expect(r).toEqual({ ok: true, value: raw });
  if (!r.ok) {
    throw new Error('invariant: asserted just above');
  }
  expect(storyOf(r.value, chapterId('ch2'))?.id).toBe('manor');
  expect(storyOf(r.value, chapterId('ch9'))).toBeNull();
  const refused: Array<readonly [string, unknown]> = [
    ['stories', { chapters, cast: {} }],
    ['stories.0.chapters.0', { ...raw, stories: [{ ...story, chapters: ['ch2'] }] }],
    ['stories.0.chapters.1', { ...raw, stories: [{ ...story, chapters: ['ch1', 'ch9'] }] }],
    ['stories.0.chapters', { ...raw, stories: [{ ...story, chapters: [] }] }],
    ['stories.0.cover', { ...raw, stories: [{ ...story, cover: 'bg/cafe' }] }],
    ['stories.0.id', { ...raw, stories: [{ ...story, id: 'Manor' }] }],
    ['stories.0.endings', { ...raw, stories: [{ ...story, endings: {} }] }],
    ['stories.0.teaser', { ...raw, stories: [{ ...story, teaser: 'Тизер.' }] }],
  ];
  for (const [path, bad] of refused) {
    const d = decodeChapterCatalog(bad);
    expect(d.ok ? [] : d.error.map((i) => i.path), path).toContain(path);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// story.ts: spawned the way `npm run story` runs it, against a temporary repository (`--root`)

const CLIENT_DIR = fileURLToPath(new URL('../..', import.meta.url));
const STORY_SCRIPT = fileURLToPath(new URL('../story.ts', import.meta.url));
/** A spawned Node loads inkjs/full and compiles: allow for a loaded machine instead of retrying. */
const CLI_TIMEOUT_MS = 60_000;
const CH1_LISTED = { id: 'ch1', entry: 'ch1/main.ink', paid: false, next: 'ch2' };
const CH2_LISTED = { id: 'ch2', entry: 'ch2/main.ink', paid: true, productId: 'chapter:ch2', next: null };
/**
 * The fixture's story list: `manor`, ch1 → ch2, its one ending on ch2's `drawer`. The name is one no free output can
 * hold: no ink control string, meta or catalog key, version hex or fixture word.
 */
const STORIES_SOURCE = [{ id: 'manor', first: 'ch1', cover: 'cover/manor', endings: { q7_sealed_vault: { chapter: 'ch2', knot: 'drawer' } } }];
const CLIENT_OUTPUTS = [
  'client/src/story-gen/catalog.json',
  'client/src/story-gen/free/ch1.en.json',
  'client/src/story-gen/free/ch1.meta.json',
  'client/src/story-gen/free/ch1.story.json',
];

const EN_CH1_TABLE = 'story/locales/en/ch1.json';
let localeTables: Readonly<Record<string, string>> | null = null;

/**
 * The emit fixture's locale tables: per chapter every ID'd line as `{ ru: <text>, en: 'en <id>' }`, and the names
 * and titles of `NAMES` in both languages. Built on first use, which is inside a test body: `emitFixture()` asserts.
 */
function localeFiles(): Readonly<Record<string, string>> {
  if (localeTables === null) {
    const { graphs } = emitFixture();
    const en = (ch: string): string => {
      const lines = graphs.get(chapterId(ch))?.lines ?? [];
      return `${JSON.stringify(Object.fromEntries(lines.map((l) => [l.id, { ru: l.text, en: `en ${l.id}` }])), null, 2)}\n`;
    };
    const names = (lang: 'ru' | 'en'): string => {
      const pick = (section: Readonly<Record<string, { ru: string; en: string }>>): Record<string, string> =>
        Object.fromEntries(Object.entries(section).map(([id, name]) => [id, name[lang]]));
      const sections = { names: pick(NAMES.speakers), chapters: pick(NAMES.chapters), stories: pick(MANOR_NAMES.stories), teasers: pick(MANOR_NAMES.teasers) };
      return `${JSON.stringify(sections, null, 2)}\n`;
    };
    localeTables = {
      [EN_CH1_TABLE]: en('ch1'),
      'story/locales/en/ch2.json': en('ch2'),
      'story/locales/ru/story.json': names('ru'),
      'story/locales/en/story.json': names('en'),
    };
  }
  return localeTables;
}

/**
 * The committed catalog, the inline cast, the given chapter list, the fixture's story list, and the emit fixture's ink
 * and locale tables under story/.
 */
function repoFiles(chapters: unknown = [CH1_LISTED, CH2_LISTED]): Record<string, string> {
  return {
    'assets/catalog.json': readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8'),
    'story/cast.json': JSON.stringify(CAST_RAW),
    'story/chapters.json': JSON.stringify(chapters),
    'story/stories.json': JSON.stringify(STORIES_SOURCE),
    ...Object.fromEntries([...EMIT_SOURCES].map(([key, text]) => [`story/${key}`, text])),
    ...localeFiles(),
  };
}

function put(root: string, rel: string, text: string): void {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function withRepo(files: Readonly<Record<string, string>>, body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'story-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      put(root, rel, text);
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Every file under `rel` of the repo, repo-relative posix, sorted; [] when `rel` does not exist. */
function filesUnder(root: string, rel: string): string[] {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    return [];
  }
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(root.length + 1).split('\\').join('/'))
    .sort();
}

function runStory(root: string, args: readonly string[] = [], script = STORY_SCRIPT): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [script, '--root', root, ...args], { cwd: CLIENT_DIR, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** ch1 of the emit fixture with `line` inserted before its `-> END`, or `-> END` replaced by it. */
function ch1With(line: string, replaceEnd = false): string {
  const text = EMIT_SOURCES.get('ch1/main.ink') ?? '';
  return text.replace('-> END\n', replaceEnd ? `${line}\n` : `${line}\n-> END\n`);
}

test(
  'story: zero chapters is an error',
  () => {
    withRepo(repoFiles([]), (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/^E story\/chapters\.json:0 catalog\/chapters 0 chapters/m);
      expect(r.stdout).toMatch(/^story: [1-9]\d* errors, \d+ warnings$/m);
      expect([...filesUnder(root, 'client'), ...filesUnder(root, 'server')]).toEqual([]);
    });
  },
  CLI_TIMEOUT_MS,
);

const CHAPTER_CASES: ReadonlyArray<readonly [name: string, chapters: unknown, expected: RegExp, omit?: string]> = [
  ['duplicate id', [CH1_LISTED, { ...CH2_LISTED, id: 'ch1', entry: 'ch1/main.ink' }], /1\.id: duplicate id 'ch1'/],
  ['bad id', [{ ...CH1_LISTED, id: 'chapter1', entry: 'chapter1/main.ink', next: null }], /0\.id: "chapter1" does not match/],
  ['entry layout', [{ ...CH1_LISTED, entry: 'ch1/start.ink', next: null }], /0\.entry: "ch1\/start\.ink": the entry of ch1 is 'ch1\/main\.ink'/],
  ['missing entry file', [CH1_LISTED, CH2_LISTED], /ch2: the entry file story\/ch2\/main\.ink is missing/, 'story/ch2/main.ink'],
  ['paid without product', [CH1_LISTED, { ...CH2_LISTED, productId: undefined }], /1\.productId: a paid chapter needs a productId/],
  ['product on free chapter', [{ ...CH1_LISTED, productId: 'chapter:ch1' }, CH2_LISTED], /0\.productId: a free chapter has no productId/],
  [
    'duplicate product',
    [CH1_LISTED, { ...CH2_LISTED, next: 'ch3' }, { id: 'ch3', entry: 'ch3/main.ink', paid: true, productId: 'chapter:ch2', next: null }],
    /2\.productId: duplicate product 'chapter:ch2'/,
  ],
  ['unknown next', [{ ...CH1_LISTED, next: 'ch9' }, CH2_LISTED], /0\.next: 'ch9' is not a listed chapter/],
];

for (const [name, chapters, expected, omit] of CHAPTER_CASES) {
  test(
    `lint: catalog/chapters red on fixture (${name})`,
    () => {
      const files = Object.fromEntries(Object.entries(repoFiles(chapters)).filter(([rel]) => rel !== omit));
      withRepo(files, (root) => {
        const r = runStory(root);
        expect(r.status, r.stdout + r.stderr).toBe(1);
        const lines = r.stdout.split('\n').filter((l) => l.startsWith('E story/chapters.json:0 catalog/chapters '));
        expect(lines.filter((l) => expected.test(l)), r.stdout).toHaveLength(1);
        expect([...filesUnder(root, 'client'), ...filesUnder(root, 'server')]).toEqual([]);
      });
    },
    CLI_TIMEOUT_MS,
  );
}

test(
  'story: cli builds a free and a paid chapter',
  () => {
    withRepo(repoFiles(), (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^story: ch1 free knots 1 lines 2 version [0-9a-f]{16}$/m);
      expect(r.stdout).toMatch(/^story: ch2 paid knots 2 lines 16 version [0-9a-f]{16}$/m);
      expect(r.stdout).toMatch(/^story: 0 errors, 0 warnings$/m);
      expect(filesUnder(root, 'client')).toEqual(CLIENT_OUTPUTS);
      expect(filesUnder(root, 'server')).toEqual([
        'server/content/build/fingerprints.lines.json',
        'server/content/build/usage.json',
        'server/content/chapters/ch2/en.json',
        'server/content/chapters/ch2/meta.json',
        'server/content/chapters/ch2/story.json',
        'server/content/stories.json',
      ]);
      for (const rel of CLIENT_OUTPUTS) {
        expect(readFileSync(join(root, rel), 'utf8'), rel).not.toContain('ch2.archive');
      }
      const paid = readFileSync(join(root, 'server/content/chapters/ch2/story.json'), 'utf8');
      expect(paid.startsWith('{"inkVersion":21')).toBe(true); // the API's ToJson(): no BOM, no reformatting
      expect(paid).toContain(LONGEST);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: no outputs are written when an error remains',
  () => {
    const files = { ...repoFiles(), 'story/ch1/main.ink': ch1With('-> nowhere', true) };
    // A stale public copy of the (now paid) ch2: deleting it belongs to a clean run only.
    withRepo({ ...files, 'client/src/story-gen/free/ch2.story.json': 'stale' }, (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/^E story\/ch1\/main\.ink:\d+ ink\/compile Divert target not found/m);
      expect(r.stdout).toMatch(/^story: ch1 failed$/m);
      expect(filesUnder(root, 'client')).toEqual(['client/src/story-gen/free/ch2.story.json']);
      expect(readFileSync(join(root, 'client/src/story-gen/free/ch2.story.json'), 'utf8')).toBe('stale');
      expect(filesUnder(root, 'server')).toEqual([]);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: a chapter flipped to paid leaves no free output',
  () => {
    withRepo(repoFiles([CH1_LISTED, { ...CH2_LISTED, paid: false, productId: undefined }]), (root) => {
      const free = runStory(root);
      expect(free.status, free.stdout + free.stderr).toBe(0);
      expect(free.stdout).toMatch(/^story: ch2 free /m);
      expect(existsSync(join(root, 'client/src/story-gen/free/ch2.story.json'))).toBe(true);
      put(root, 'client/src/story-gen/free/ch2.assets.json', '{}'); // L5's asset manifest of the then-free chapter
      put(root, 'story/chapters.json', JSON.stringify([CH1_LISTED, CH2_LISTED]));
      const paid = runStory(root);
      expect(paid.status, paid.stdout + paid.stderr).toBe(0);
      expect(paid.stdout).toMatch(/^story: ch2 paid /m);
      expect(filesUnder(root, 'client')).toEqual(CLIENT_OUTPUTS);
      expect(existsSync(join(root, 'server/content/chapters/ch2/story.json'))).toBe(true);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: --strict turns warnings into errors',
  () => {
    withRepo({ ...repoFiles(), 'story/ch1/main.ink': ch1With('TODO: polish this scene') }, (root) => {
      const lax = runStory(root);
      expect(lax.status, lax.stdout + lax.stderr).toBe(0);
      expect(lax.stdout).toMatch(/^W story\/ch1\/main\.ink:\d+ ink\/todo polish this scene$/m);
      expect(lax.stdout).toMatch(/^story: 0 errors, 1 warnings$/m);
      const strict = runStory(root, ['--strict']);
      expect(strict.status, strict.stdout + strict.stderr).toBe(1);
      expect(strict.stdout).toMatch(/^E story\/ch1\/main\.ink:\d+ ink\/todo polish this scene$/m);
      expect(strict.stdout).toMatch(/^story: 1 errors, 0 warnings$/m);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'lint: paid/leak red on fixture (story cli)',
  () => {
    // Lint, compile and graph see a clean free line; only the read-back of the written story-gen tree can tell that
    // its text names a paid line ID, so this is the one net of the `story` gate for it.
    const files = repoFiles();
    const en = JSON.parse(files[EN_CH1_TABLE] ?? '{}') as Record<string, unknown>; // localeFiles() writes an object
    const ch1En = { ...en, 'ch1.cafe.f003': { ru: 'Здесь упомянут ch2.archive.p001.', en: 'en ch1.cafe.f003' } };
    withRepo({ ...files, 'story/ch1/main.ink': ch1With('Здесь упомянут ch2.archive.p001. #id:ch1.cafe.f003'), [EN_CH1_TABLE]: `${JSON.stringify(ch1En, null, 2)}\n` }, (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/^E client\/src\/story-gen\/free\/ch1\.story\.json:0 paid\/leak paid line ID 'ch2\.archive\.p001'/m);
      expect(r.stdout).toMatch(/^story: 1 errors, 0 warnings$/m);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: missing stories.json fails the gate',
  () => {
    // Every chapter lies on one story (§9): without the story list no story is defined, so the gate fails.
    const files = Object.fromEntries(Object.entries(repoFiles()).filter(([rel]) => rel !== 'story/stories.json'));
    withRepo(files, (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/^E story\/stories\.json:0 catalog\/stories missing$/m);
      expect(r.stdout).toMatch(/^story: 1 errors, 0 warnings$/m);
      expect([...filesUnder(root, 'client'), ...filesUnder(root, 'server')]).toEqual([]);
    });
  },
  CLI_TIMEOUT_MS,
);

/** ch1 of the carry fixture: a choice between `bad`, a declared story ending that sets g_x, and `good`. */
const CARRY_CH1 = [
  'INCLUDE ../common/globals.ink',
  '-> cafe',
  '=== cafe ===',
  '# scene: cafe',
  'Куда идти? #id:ch1.cafe.d001',
  '* [Налево. #id:ch1.cafe.d002]',
  '    -> bad',
  '* [Направо. #id:ch1.cafe.d003]',
  '    -> good',
  '=== bad ===',
  '~ g_x = 9',
  'Плохой конец. #id:ch1.bad.d004',
  '-> END',
  '=== good ===',
  'Дальше. #id:ch1.good.d005',
  '-> END',
  '',
].join('\n');
/** ch2 of the carry fixture: `leak` is entered only from g_x == 9 and writes no `-> END` of its own. */
const CARRY_CH2 = [
  'INCLUDE ../common/globals.ink',
  '-> start',
  '=== start ===',
  '# scene: archive',
  'Архив. #id:ch2.start.d006',
  '{ g_x == 9:',
  '    -> leak',
  '}',
  '-> safe',
  '=== leak ===',
  'Утечка. #id:ch2.leak.d007',
  '-> safe',
  '=== safe ===',
  'Тихо. #id:ch2.safe.d008',
  '-> END',
  '',
].join('\n');

test(
  'story: a story-ending run does not carry into the next chapter',
  () => {
    const table = (entries: Readonly<Record<string, string>>): string =>
      `${JSON.stringify(Object.fromEntries(Object.entries(entries).map(([id, ru]) => [id, { ru, en: `en ${id}` }])), null, 2)}\n`;
    const files = {
      ...repoFiles(),
      'story/common/globals.ink': 'VAR g_trust = 0\nVAR g_x = 0\n',
      'story/ch1/main.ink': CARRY_CH1,
      'story/ch2/main.ink': CARRY_CH2,
      'story/stories.json': JSON.stringify([{ id: 'manor', first: 'ch1', cover: 'cover/manor', endings: { bad_end: { chapter: 'ch1', knot: 'bad' } } }]),
      'story/lint-allow.json': JSON.stringify({ 'play/knot-not-visited': { 'ch2.leak': 'reached only after the story ending bad_end, which carries nothing' } }),
      [EN_CH1_TABLE]: table({
        'ch1.cafe.d001': 'Куда идти?',
        'ch1.cafe.d002': 'Налево.',
        'ch1.cafe.d003': 'Направо.',
        'ch1.bad.d004': 'Плохой конец.',
        'ch1.good.d005': 'Дальше.',
      }),
      'story/locales/en/ch2.json': table({ 'ch2.start.d006': 'Архив.', 'ch2.leak.d007': 'Утечка.', 'ch2.safe.d008': 'Тихо.' }),
    };
    withRepo(files, (root) => {
      const r = runStory(root);
      // Only the runs that ended in `good` seed ch2, so none of them sets g_x and `leak` stays unvisited.
      expect(r.stdout).toMatch(/^play: ch2: 200 runs, knots 2\/3, endings 1\/1 \(seeds 1-200, ch1 carries; /m);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^play: ch1: 200 runs, knots 3\/3, endings 2\/2 /m);
      expect(r.stdout).toMatch(/^stories: manor \(ch1 → ch2\), endings 1$/m);
      expect(r.stdout).toMatch(/^story: 0 errors, 0 warnings$/m);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: cli runs through a linked path',
  () => {
    // Node runs the main module from its realpath while argv[1] keeps the caller's spelling (a junction, macOS's
    // symlinked /tmp): a guard that compares the two spellings skips main() and exits 0 having built nothing.
    withRepo(repoFiles([]), (root) => {
      const link = join(root, 'scripts');
      symlinkSync(dirname(STORY_SCRIPT), link, process.platform === 'win32' ? 'junction' : 'dir');
      try {
        const r = runStory(root, [], join(link, 'story.ts'));
        expect(r.status, r.stdout + r.stderr).toBe(1);
        expect(r.stdout).toMatch(/^E story\/chapters\.json:0 catalog\/chapters 0 chapters/m);
      } finally {
        unlinkSync(link); // the link only: the recursive delete never meets a way into client/scripts
      }
    });
  },
  CLI_TIMEOUT_MS,
);
