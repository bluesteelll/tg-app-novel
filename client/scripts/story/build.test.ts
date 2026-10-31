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

import { RULES_VERSION } from '../../src/explore/reduce.ts';
import { assetIndex, decodeAssetCatalog, decodeCast, decodeChapterCatalog, decodeChapterMeta, storyOf } from '../../src/story/catalog.ts';
import type { Cast, ChapterListEntry, StoryId } from '../../src/story/catalog.ts';
import type { AssetId, AssetIndex, ChapterId, KnotName, LineId, ProductId } from '../../src/story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toPublic } from '../../src/world/decode.ts';
import type { WorldSource } from '../../src/world/types.ts';
import { assetUsage } from '../assets/manifest.ts';
import { compileChapter, resolveInclude } from './compile.ts';
import type { CompiledChapter, ReadInk } from './compile.ts';
import { decodeLineFingerprints, decodeStoryUsage, paidLeak, planEmit, worldVersion } from './emit.ts';
import type { LineFingerprints, ServerMeta, ServerStoryIndex, StoryNames, WorldNeedles } from './emit.ts';
import { buildGraph, writeOnly } from './graph.ts';
import type { ChapterGraph, GraphFacts } from './graph.ts';
import { GLOBALS_PATH, lintSources } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';
import { choicePoints } from './meta.ts';
import type { ChoiceMap, MetaSource } from './meta.ts';
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
function graphOf(files: ReadonlyMap<string, string>, ch: SourceChapter = CH1): { graph: ChapterGraph; findings: Finding[]; facts: GraphFacts } {
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

/** The fixture's meta texts: server-only, so each is distinct from every public text of the fixture. */
const META_TEXTS = {
  title: { ru: 'Запечатанное хранилище открыто', en: 'The sealed vault stands open' },
  foundName: { ru: 'Хранитель тайны', en: 'Keeper of the secret' },
  foundDesc: { ru: 'Дойти до концовки за запечатанной дверью.', en: 'Reach the ending behind the sealed door.' },
  oneName: { ru: 'Первая развязка', en: 'A first resolution' },
  oneDesc: { ru: 'Найти хотя бы одну концовку истории.', en: 'Find at least one ending of the story.' },
  allName: { ru: 'Все пути пройдены', en: 'Every road travelled' },
  allDesc: { ru: 'Найти каждую концовку этой истории.', en: 'Find every ending of this story.' },
  drawerName: { ru: 'Ящик без подсказок', en: 'A drawer without help' },
  drawerDesc: { ru: 'Открыть ящик стола, не взяв ни одной подсказки.', en: 'Open the desk drawer without taking a hint.' },
  cabinetName: { ru: 'Шкаф поддался', en: 'The cabinet gave way' },
  cabinetDesc: { ru: 'Подобрать код к шкафу в кабинете.', en: 'Find the code of the study cabinet.' },
  choiceName: { ru: 'Любопытная рука', en: 'A curious hand' },
  choiceDesc: { ru: 'Самой открыть ящик в архиве.', en: 'Open the archive drawer yourself.' },
  chapterName: { ru: 'Архив пройден', en: 'Through the archive' },
  chapterDesc: { ru: 'Дочитать главу в архиве до конца.', en: 'Read the archive chapter to its end.' },
  allOfName: { ru: 'Ключ и замок', en: 'The key and the lock' },
  allOfDesc: { ru: 'Открыть ящик и дойти до хранилища.', en: 'Open the drawer and reach the vault.' },
} as const;
/**
 * The fixture's story meta as `catalog/meta` decodes it: the paid ending's title and one achievement of every condition
 * kind (the server fixture's kinds), naming the puzzles of ch1's fixture world (`worldSource`) and ch2's one option.
 */
const EMIT_ACHIEVEMENTS = {
  vault_found: { hidden: false, when: { ending: 'q7_sealed_vault' }, name: META_TEXTS.foundName, desc: META_TEXTS.foundDesc },
  one_ending: { hidden: false, when: { endings: 1 }, name: META_TEXTS.oneName, desc: META_TEXTS.oneDesc },
  every_ending: { hidden: true, when: { allEndings: true }, name: META_TEXTS.allName, desc: META_TEXTS.allDesc },
  drawer_no_hints: { hidden: false, when: { puzzle: 'ch1.drawer', hints: 0 }, name: META_TEXTS.drawerName, desc: META_TEXTS.drawerDesc },
  cabinet_open: { hidden: false, when: { puzzle: 'ch1.cabinet' }, name: META_TEXTS.cabinetName, desc: META_TEXTS.cabinetDesc },
  archive_drawer: { hidden: false, when: { choice: 'ch2.archive.p004' }, name: META_TEXTS.choiceName, desc: META_TEXTS.choiceDesc },
  archive_done: { hidden: false, when: { chapter: 'ch2' }, name: META_TEXTS.chapterName, desc: META_TEXTS.chapterDesc },
  key_and_lock: {
    hidden: false,
    when: { all: [{ ending: 'q7_sealed_vault' }, { choice: 'ch2.archive.p004' }] },
    name: META_TEXTS.allOfName,
    desc: META_TEXTS.allOfDesc,
  },
};
const EMIT_META = { manor: { endings: { q7_sealed_vault: META_TEXTS.title }, achievements: EMIT_ACHIEVEMENTS } } as MetaSource; // fixture ids match their grammars
/** Every text of EMIT_META, ru and en. */
const EMIT_META_TEXTS: readonly string[] = Object.values(META_TEXTS).flatMap((t) => [t.ru, t.en]);

type EmitFixture = {
  plan: ReadonlyMap<string, string>;
  compiled: Map<ChapterId, CompiledChapter>;
  graphs: Map<ChapterId, ChapterGraph>;
  choices: Map<ChapterId, ChoiceMap>;
};

/**
 * Compiles and graphs the two-chapter fixture (both lint-clean) and plans its outputs for `stories`, with `worlds`
 * (default none) as the chapters' decoded world sources and `meta` (default EMIT_META) beside the chapters' choice
 * points, computed as story.ts computes them.
 */
function emitFixture(
  list: readonly ChapterListEntry[] = LIST,
  stories: readonly StoryPlan[] = [MANOR],
  worlds?: ReadonlyMap<ChapterId, WorldSource>,
  meta: MetaSource = EMIT_META,
): EmitFixture {
  const chapters = list.map((ch): SourceChapter => ({ id: ch.id, paid: ch.paid, entry: ch.entry }));
  expect(lintSources({ files: EMIT_SOURCES, chapters, assets: COMMITTED.assets, cast: COMMITTED.cast }), 'lint-clean').toEqual([]);
  const compiled = new Map<ChapterId, CompiledChapter>();
  const graphs = new Map<ChapterId, ChapterGraph>();
  const choices = new Map<ChapterId, ChoiceMap>();
  for (const ch of list) {
    const source: SourceChapter = { id: ch.id, paid: ch.paid, entry: ch.entry };
    const r = compileChapter(source, reader(EMIT_SOURCES));
    if (r.compiled === null) {
      throw new Error(`invariant: fixture ${ch.id} compiles: ${JSON.stringify(r.findings)}`);
    }
    compiled.set(ch.id, r.compiled);
    const graph = buildGraph({ chapter: source, files: r.compiled.files, sources: EMIT_SOURCES, assets: COMMITTED.assets }).graph;
    graphs.set(ch.id, graph);
    choices.set(ch.id, choicePoints({ files: r.compiled.files, sources: EMIT_SOURCES, lines: graph.lines }));
  }
  // The en text of each line is `en <id>`, as localeFiles() writes it; a world's texts (its hints included) too.
  const idsOf = (ch: ChapterId): string[] => [...(graphs.get(ch)?.lines ?? []).map((l) => l.id), ...worldTexts(worlds?.get(ch)).map((x) => x.id)];
  const en = new Map(list.map((ch) => [ch.id, Object.fromEntries(idsOf(ch.id).map((id) => [id, `en ${id}`]))]));
  const input = { chapters: list, compiled, graphs, cast: COMMITTED.cast, names: NAMES, en, stories, meta: { source: meta, choices } };
  return { plan: planEmit(worlds === undefined ? input : { ...input, worlds }), compiled, graphs, choices };
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
    'server/content/meta.json',
    'server/content/puzzles/ch1.json',
    'server/content/puzzles/ch2.json',
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

/** The story index's and the puzzle file's key wildcards: an ending name, a puzzle id. */
function indexWild(path: string): boolean {
  return path.endsWith('.endings') || path === '.puzzles';
}

/**
 * Per object path, the union of its keys (an array element is `[]`, a key of an object whose path is `wild` `*`); per
 * leaf path, its types.
 */
function shapeOf(value: unknown, wild: (path: string) => boolean = indexWild): { keys: Record<string, string[]>; leaves: Record<string, string[]> } {
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
        const key = wild(path) ? '*' : k;
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
// emit.ts: worlds (PUZZLES-PLAN "Build outputs", "Server formats", X7, X9)

type WorldJson = Record<string, unknown>;

/**
 * A world source for chapter `ch` (PUZZLES-PLAN "World data"): the hall (a key with a prop, a door to the study, the
 * way out into the `leave` knot) and the study (the drawer: a code puzzle with a closeup and two hints on a keyed
 * lock; the letter). `cabinet` is a yielded code puzzle on no lock, with a closeup. Every text names its chapter, so
 * no two chapters share one.
 */
function worldSource(ch: string, leave: string): WorldJson {
  let n = 0;
  const t = (owner: string, ru: string): { id: string; ru: string } => ({ id: `${ch}.${owner}.w${(n++).toString(36).padStart(3, '0')}`, ru: `${ru} (${ch})` });
  const exit = (id: string, rect: number[], to: WorldJson, sfx: string | null): WorldJson => ({ id, kind: 'exit', rect, label: t('manor', `Дверь ${id}`), to, lock: null, sfx });
  return {
    format: 1,
    items: {
      key: { name: t('key', 'Латунный ключ'), desc: t('key', 'Тяжёлый ключ от кабинета.'), glyph: 'key' },
      lamp: { name: t('lamp', 'Лампа'), desc: t('lamp', 'Старая масляная лампа.'), glyph: 'coin' },
    },
    docs: { letter: { title: t('letter', 'Письмо'), body: [t('letter', 'Дом построили в 1847 году.')] } },
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
        hints: [t('drawer', 'Год упоминается в письме из кабинета.'), t('drawer', 'Код: один, восемь, четыре, семь.')],
      },
      cabinet: {
        type: 'code',
        title: t('cabinet', 'Шкаф'),
        prompt: t('cabinet', 'Три диска.'),
        closeup: 'cabinet',
        params: { dials: 3 },
        maxAttempts: 3,
        giveUp: true,
        solution: [3, 1, 4],
        hints: [],
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
              { id: 'key', kind: 'take', rect: [100, 300, 200, 200], label: t('manor', 'Ключ'), gives: { item: 'key' }, prop: 'medal_sun', then: [] },
              exit('to_study', [400, 300, 200, 200], { room: 'study' }, 'door'),
              exit('out', [700, 300, 200, 200], { story: leave }, null),
            ],
          },
          study: {
            bg: 'study',
            title: t('manor', 'Кабинет'),
            onEnter: [],
            hotspots: [
              {
                id: 'drawer',
                kind: 'object',
                rect: [100, 300, 200, 200],
                label: t('manor', 'Ящик'),
                lock: { slots: [{ accepts: 'key' }], puzzle: 'drawer', locked: t('manor', 'Ящик заперт.'), onOpen: [], onFail: [] },
                then: [],
                look: null,
                prop: 'note',
              },
              { id: 'letter', kind: 'take', rect: [400, 300, 200, 200], label: t('manor', 'Письмо'), gives: { doc: 'letter' }, prop: null, then: [] },
              exit('to_hall', [700, 300, 200, 200], { room: 'hall' }, 'steps'),
            ],
          },
        },
      },
    },
  };
}

function decodedWorld(raw: WorldJson): WorldSource {
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** Every world text (`{ id, ru }`) of a world, in document order; none without a world. */
function worldTexts(w: unknown): Array<{ id: string; ru: string }> {
  if (Array.isArray(w)) {
    return w.flatMap(worldTexts);
  }
  if (typeof w !== 'object' || w === null) {
    return [];
  }
  const o = w as Readonly<Record<string, unknown>>; // a JSON object
  const id = o['id'];
  const ru = o['ru'];
  if (Object.keys(o).length === 2 && typeof id === 'string' && typeof ru === 'string') {
    return [{ id, ru }];
  }
  return Object.values(o).flatMap(worldTexts);
}

function hintsOf(w: WorldSource): Array<{ id: LineId; ru: string }> {
  return Object.values(w.puzzles).flatMap((p) => p.hints.map((h) => ({ id: h.id, ru: h.ru })));
}

/** One dotted path of a fixture world's objects. */
function objectAt(w: WorldJson, path: string): WorldJson {
  return path.split('.').reduce<WorldJson>((o, key) => {
    const v = o[key];
    if (typeof v !== 'object' || v === null) {
      throw new Error(`invariant: the fixture has an object at ${path}`);
    }
    return v as WorldJson; // checked just above: a fixture JSON object (an array index is a key too)
  }, w);
}

/** The rules server/src/content.rs `load_puzzle_file` refuses a puzzle file for (:735-770); [] when it loads. */
function puzzleProblems(raw: unknown, chapter: string): string[] {
  type Text = { ru: string; en: string };
  type Entry = { type: string; answerLen: number; answerMax: number; solution: number[]; title: Text; hints: Text[] };
  const file = raw as { format: number; chapterId: string; puzzles: Record<string, Entry> }; // the shape test compares the keys
  const out: string[] = [];
  if (file.format !== 1) {
    out.push(`format ${file.format}, expected 1`);
  }
  if (file.chapterId !== chapter) {
    out.push(`chapterId is not ${chapter}`);
  }
  for (const [local, p] of Object.entries(file.puzzles)) {
    if (!/^[a-z][a-z0-9_]*$/.test(local)) {
      out.push(`${local}: not a puzzle id`);
    }
    if (p.type !== 'code' && p.type !== 'order') {
      out.push(`${local}: type ${p.type}`);
    }
    if (p.answerLen === 0 || p.solution.length !== p.answerLen) {
      out.push(`${local}: the solution's length must be answerLen, at least 1`);
    } else if (p.solution.some((v) => v > p.answerMax)) {
      out.push(`${local}: a solution value is above answerMax`);
    } else if (p.hints.length > 3) {
      out.push(`${local}: more than 3 hints`);
    } else if ([p.title, ...p.hints].some((x) => x.ru === '' || x.en === '')) {
      out.push(`${local}: an empty title or hint text`);
    }
  }
  return out;
}

const CH1_WORLD = 'client/src/story-gen/free/ch1.world.json';
const CH2_WORLD = 'server/content/chapters/ch2/world.json';

test('emit: public world has no solution or hint fields', () => {
  const source = decodedWorld(worldSource('ch1', 'cafe'));
  const { plan } = emitFixture(LIST, [MANOR], new Map([[CH1_ENTRY.id, source]]));
  const text = planned(plan, CH1_WORLD);
  const decoded = decodeWorldPublic(JSON.parse(text));
  expect(decoded.ok, JSON.stringify(decoded)).toBe(true);
  expect(text).not.toMatch(/"(?:solution|hints)"/);
  expect(decoded.ok && decoded.value.version).toBe(worldVersion(toPublic(source)));
  // No hint ID or text in any public output, the free en table included (D10); a non-hint world text is shipped.
  const hints = hintsOf(source);
  expect(hints).toHaveLength(2);
  for (const [path, out] of [...plan].filter(([p]) => p.startsWith('client/'))) {
    expect(hints.filter((h) => out.includes(h.id) || out.includes(h.ru)), path).toEqual([]);
  }
  const en = JSON.parse(planned(plan, 'client/src/story-gen/free/ch1.en.json')) as Record<string, string>; // the en table
  const title = source.puzzles['drawer' as keyof WorldSource['puzzles']]?.title.id ?? '';
  expect(en[title]).toBe(`en ${title}`);
  // The control: both hints are planned, in the server puzzle content.
  const server = planned(plan, 'server/content/puzzles/ch1.json');
  expect(hints.filter((h) => !server.includes(h.ru) || !server.includes(`en ${h.id}`))).toEqual([]);
});

test('emit: server puzzle content matches the server fixture shape', () => {
  const source = decodedWorld(worldSource('ch1', 'cafe'));
  const { plan } = emitFixture(LIST, [MANOR], new Map([[CH1_ENTRY.id, source]]));
  const emitted: unknown = JSON.parse(planned(plan, 'server/content/puzzles/ch1.json'));
  const fixture: unknown = readRepoJson('server/tests/fixtures/content/puzzles/ch1.json');
  expect(shapeOf(emitted)).toEqual(shapeOf(fixture));
  // The shapes match, so the rules load_puzzle_file applies read the typed fields; the fixture is their control.
  expect(puzzleProblems(fixture, 'ch1')).toEqual([]);
  expect(puzzleProblems(emitted, 'ch1')).toEqual([]);
  const [first, second] = hintsOf(source);
  expect((emitted as { puzzles: Record<string, unknown> }).puzzles['drawer']).toEqual({
    type: 'code',
    answerLen: 4,
    answerMax: 9,
    solution: [1, 8, 4, 7],
    title: { ru: 'Ящик стола (ch1)', en: `en ${source.puzzles['drawer' as keyof WorldSource['puzzles']]?.title.id ?? ''}` },
    hints: [first, second].map((h) => ({ ru: h?.ru, en: `en ${h?.id ?? ''}` })),
  });
});

test('lint: paid/leak red on fixture (hint text)', () => {
  const source = decodedWorld(worldSource('ch1', 'cafe'));
  const { plan } = emitFixture(LIST, [MANOR], new Map([[CH1_ENTRY.id, source]]));
  const fp = fingerprintsOf(plan);
  const hints = hintsOf(source);
  const needles: WorldNeedles = { hintIds: hints.map((h) => h.id), hintTexts: hints.map((h) => h.ru), paidIds: [], paidTexts: [] };
  const [first, second] = hints;
  // One hint's ID and another's text copied into story-gen beside the (clean) public catalog.
  const leaked = 'client/src/story-gen/free/ch1.hints.json';
  const storyGen = new Map([
    [leaked, JSON.stringify({ id: first?.id, ru: second?.ru })],
    ['client/src/story-gen/catalog.json', planned(plan, 'client/src/story-gen/catalog.json')],
  ]);
  const findings = paidLeak(storyGen, fp, needles);
  expect(findings).toContainEqual(expect.objectContaining({ code: 'paid/leak', severity: 'E', file: leaked, line: 0, message: `hint ID '${first?.id ?? ''}' in the public build input (principle 0)` }));
  expect(findings).toContainEqual(expect.objectContaining({ code: 'paid/leak', file: leaked, message: `hint text ${JSON.stringify(second?.ru)} in the public build input (principle 0)` }));
  expect(findings.filter((f) => f.file !== leaked)).toEqual([]);
  // Every public output of the plan, the public world included, is clean; without the world needles the copy is
  // not looked for.
  const outputs = new Map([...plan].filter(([p]) => p.startsWith('client/')));
  expect([...outputs.keys()]).toContain(CH1_WORLD);
  expect(paidLeak(outputs, fp, needles)).toEqual([]);
  expect(paidLeak(storyGen, fp)).toEqual([]);
});

test('emit: world version ignores texts', () => {
  const version = (w: WorldJson): string => worldVersion(toPublic(decodedWorld(w)));
  const base = worldSource('ch1', 'cafe');
  expect(version(base)).toMatch(/^[0-9a-f]{16}$/);
  const retold = worldSource('ch1', 'cafe');
  objectAt(retold, 'sections.manor.rooms.hall.title')['ru'] = 'Парадный холл';
  expect(version(retold)).toBe(version(base));
  const renumbered = worldSource('ch1', 'cafe');
  objectAt(renumbered, 'sections.manor.rooms.hall.title')['id'] = 'ch1.manor.zzzz';
  expect(version(renumbered)).toBe(version(base));
});

test('emit: world version changes on a rules edit', () => {
  const version = (w: WorldJson): string => worldVersion(toPublic(decodedWorld(w)));
  const edited = worldSource('ch1', 'cafe');
  objectAt(edited, 'sections.manor.rooms.study.hotspots.0.lock.slots.0')['accepts'] = 'lamp';
  expect(version(edited)).not.toBe(version(worldSource('ch1', 'cafe')));
});

test('emit: world version changes on a RULES_VERSION bump', () => {
  const body = toPublic(decodedWorld(worldSource('ch1', 'cafe')));
  expect(worldVersion(body, RULES_VERSION)).toBe(worldVersion(body));
  expect(worldVersion(body, RULES_VERSION + 1)).not.toBe(worldVersion(body));
});

test('emit: usage holds world assets and rooms', () => {
  const { plan } = emitFixture(LIST, [MANOR], new Map([[CH1_ENTRY.id, decodedWorld(worldSource('ch1', 'cafe'))]]));
  const raw = JSON.parse(planned(plan, 'server/content/build/usage.json')) as Record<string, unknown>; // a JSON object
  const usage = decodeStoryUsage(raw);
  if (!usage.ok) {
    throw new Error(`invariant: the planned usage decodes: ${usage.error.join('; ')}`);
  }
  const world = ['bg/hall', 'bg/study', 'bgm/tension', 'cg/cabinet', 'cg/drawer', 'prop/medal_sun', 'prop/note', 'sfx/door', 'sfx/steps'];
  expect(usage.value.chapters[CH1_ENTRY.id]?.worldAssets).toEqual(world);
  expect(usage.value.chapters[CH2_ENTRY.id]).not.toHaveProperty('worldAssets');
  const rooms = {
    'ch1/manor/hall': { bg: 'bg/hall', props: ['prop/medal_sun'], closeups: [], neighbours: ['bg/study'] },
    'ch1/manor/study': { bg: 'bg/study', props: ['prop/note'], closeups: ['cg/drawer'], neighbours: ['bg/hall'] },
  };
  expect(usage.value.rooms).toEqual(rooms);
  expect(assetUsage(usage.value)).toEqual({
    chapters: {
      ch1: { ink: ['bg/cafe', 'char/ally/neutral'], world },
      ch2: { ink: ['bg/archive', 'bgm/mystery', 'cg/reveal'], world: [] },
    },
    rooms,
  });
  // A pre-LW3 usage.json still decodes (L5 O7): no world art, no rooms.
  const pre = decodeStoryUsage({ chapters: { ch1: { assets: ['bg/cafe'], knots: {} } } });
  expect(pre.ok && assetUsage(pre.value)).toEqual({ chapters: { ch1: { ink: ['bg/cafe'], world: [] } }, rooms: {} });
  // A bad room key, a room of a chapter usage.json lacks, a value of the wrong namespace: each refused.
  const hall = rooms['ch1/manor/hall'];
  const refused: Array<readonly [string, unknown]> = [
    ['rooms.ch1/hall', { 'ch1/hall': hall }],
    ['rooms.ch9/manor/hall', { 'ch9/manor/hall': hall }],
    ['rooms.ch1/manor/hall.props.0', { 'ch1/manor/hall': { ...hall, props: ['bg/hall'] } }],
    ['rooms.ch1/manor/hall.extra', { 'ch1/manor/hall': { ...hall, extra: [] } }],
  ];
  for (const [path, bad] of refused) {
    const d = decodeStoryUsage({ ...raw, rooms: bad });
    expect(d.ok ? [] : d.error.join('; '), path).toContain(path);
  }
});

test('emit: a paid world is routed to the server only', () => {
  const ch1 = worldSource('ch1', 'cafe');
  const ch2 = worldSource('ch2', 'archive');
  const worlds = new Map([
    [CH1_ENTRY.id, decodedWorld(ch1)],
    [CH2_ENTRY.id, decodedWorld(ch2)],
  ]);
  const { plan } = emitFixture(LIST, [MANOR], worlds);
  expect([...plan.keys()].filter((p) => p.endsWith('world.json') || p.startsWith('server/content/puzzles/')).sort()).toEqual([
    CH1_WORLD,
    CH2_WORLD,
    'server/content/puzzles/ch1.json',
    'server/content/puzzles/ch2.json',
  ]);
  // No ch2 world ID or text under client/; the control: the paid world holds its non-hint texts.
  const paid = worldTexts(ch2);
  for (const [path, out] of [...plan].filter(([p]) => p.startsWith('client/'))) {
    expect(paid.filter((x) => out.includes(x.id) || out.includes(x.ru)), path).toEqual([]);
  }
  const hintIds = new Set<string>(hintsOf(decodedWorld(ch2)).map((h) => h.id));
  const paidWorld = planned(plan, CH2_WORLD);
  expect(paid.filter((x) => !hintIds.has(x.id) && !paidWorld.includes(x.id))).toEqual([]);
  // The paid en table has no hint ID either (Q13): a chapter's owner gets a hint only through its tier.
  const paidEn = Object.keys(JSON.parse(planned(plan, 'server/content/chapters/ch2/en.json')) as Record<string, string>); // the en table
  expect(paidEn.filter((id) => hintIds.has(id))).toEqual([]);
  expect(paidEn.filter((id) => id.startsWith('ch2.manor.'))).not.toEqual([]);
  // A world-less chapter still gets its puzzle file, empty (D5).
  expect(JSON.parse(planned(emitFixture().plan, 'server/content/puzzles/ch2.json'))).toEqual({ format: 1, chapterId: 'ch2', puzzles: {} });
});

// ---------------------------------------------------------------------------------------------------------------
// emit.ts: the server meta (META-PLAN "Server formats", M2, M7)

const SERVER_META = 'server/content/meta.json';

/** The server meta's key wildcards: chapter ids, option IDs, story ids and ending names. */
function metaWild(path: string): boolean {
  return path === '.choices' || path === '.choices.*' || path === '.stories' || path.endsWith('.endings');
}

/** A puzzle file's local puzzle ids. */
function puzzleIds(raw: unknown): ReadonlySet<string> {
  return new Set(Object.keys((raw as { puzzles: Readonly<Record<string, unknown>> }).puzzles)); // the puzzle file shape test pins the key
}

/** A text of 1-`max` code points in ru and in en, non-blank (META-PLAN M4). */
function textProblems(t: unknown, at: string, max: number): string[] {
  const o = typeof t === 'object' && t !== null ? (t as Readonly<Record<string, unknown>>) : {}; // a JSON object, or none
  return (['ru', 'en'] as const).flatMap((lang) => {
    const v = o[lang];
    return typeof v === 'string' && v.trim() !== '' && [...v].length <= max ? [] : [`${at}.${lang}: not 1-${max} code points`];
  });
}

type MetaJson = {
  format: unknown;
  choices: Readonly<Record<string, Readonly<Record<string, string>>>>;
  stories: Readonly<
    Record<string, { endings: Readonly<Record<string, unknown>>; achievements: ReadonlyArray<{ id: string; hidden: unknown; when: unknown; name: unknown; desc: unknown }> }>
  >;
};

/**
 * The startup checks LM2's ContentStore applies to server/content/meta.json (META-PLAN "Server formats"), given the
 * story index and each chapter's puzzle ids; [] when it loads.
 */
function metaProblems(text: string, index: ServerStoryIndex, puzzles: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const out: string[] = [];
  if (new TextEncoder().encode(text).length > 256 * 1024) {
    out.push('over 256 KB');
  }
  const meta = JSON.parse(text) as MetaJson; // the shape test compares the keys
  const same = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (meta.format !== 1) {
    out.push(`format ${String(meta.format)}, expected 1`);
  }
  const chapters: string[] = index.stories.flatMap((s) => s.chapters.map((c) => c.id));
  if (!same(Object.keys(meta.choices), chapters)) {
    out.push(`choices for ${Object.keys(meta.choices).join(', ')}, the index lists ${chapters.join(', ')}`);
  }
  for (const [ch, map] of Object.entries(meta.choices)) {
    for (const [option, point] of Object.entries(map)) {
      if (!/^ch[1-9][0-9]*\.[a-z][a-z0-9_]*\.[0-9a-z]{4}$/.test(option) || !option.startsWith(`${ch}.`)) {
        out.push(`${ch}: option ${option}`);
      }
      if (!Object.hasOwn(map, point)) {
        out.push(`${ch}: point ${point} is no option of ${ch}`);
      }
    }
  }
  if (!same(Object.keys(meta.stories), index.stories.map((s) => s.id))) {
    out.push(`stories ${Object.keys(meta.stories).join(', ')} are not the index's`);
  }
  for (const s of index.stories) {
    const m = Object.hasOwn(meta.stories, s.id) ? meta.stories[s.id] : undefined;
    if (m === undefined) {
      continue;
    }
    const endings = Object.keys(s.endings);
    const own: string[] = s.chapters.map((c) => c.id);
    if (!same(Object.keys(m.endings), endings)) {
      out.push(`${s.id}: endings ${Object.keys(m.endings).join(', ')}, the index declares ${endings.join(', ')}`);
    }
    for (const [name, t] of Object.entries(m.endings)) {
      out.push(...textProblems(t, `${s.id}.endings.${name}`, 40));
    }
    const ids = m.achievements.map((a) => a.id);
    if (ids.length > 50 || new Set(ids).size !== ids.length) {
      out.push(`${s.id}: achievement ids ${ids.join(', ')}`);
    }
    const cond = (c: unknown, at: string, nested: boolean): void => {
      const o = typeof c === 'object' && c !== null ? (c as Readonly<Record<string, unknown>>) : {}; // a JSON object, or none
      const kinds = Object.keys(o).filter((k) => k !== 'hints');
      const kind = kinds.length === 1 ? kinds[0] : undefined;
      const v = kind === undefined ? undefined : o[kind];
      if (Object.hasOwn(o, 'hints') && (kind !== 'puzzle' || o['hints'] !== 0)) {
        out.push(`${at}: hints beside ${String(kind)}`);
      }
      const [pch = '', local = ''] = kind === 'puzzle' && typeof v === 'string' ? v.split('.') : [];
      const ok =
        (kind === 'ending' && typeof v === 'string' && endings.includes(v)) ||
        (kind === 'endings' && typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= endings.length) ||
        (kind === 'allEndings' && v === true && endings.length > 0) ||
        (kind === 'choice' && typeof v === 'string' && own.some((ch) => Object.hasOwn(meta.choices[ch] ?? {}, v))) ||
        (kind === 'chapter' && typeof v === 'string' && own.includes(v)) ||
        (kind === 'puzzle' && own.includes(pch) && puzzles.get(pch)?.has(local) === true) ||
        (kind === 'all' && !nested && Array.isArray(v) && v.length >= 2 && v.length <= 4);
      if (!ok) {
        out.push(`${at}: ${JSON.stringify(c)} names nothing of ${s.id}`);
      } else if (kind === 'all' && Array.isArray(v)) {
        v.forEach((x: unknown, i) => cond(x, `${at}.all.${i}`, true));
      }
    };
    for (const a of m.achievements) {
      const at = `${s.id}.achievements.${a.id}`;
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(a.id) || typeof a.hidden !== 'boolean') {
        out.push(`${at}: id or hidden`);
      }
      out.push(...textProblems(a.name, `${at}.name`, 40), ...textProblems(a.desc, `${at}.desc`, 140));
      cond(a.when, `${at}.when`, false);
    }
  }
  return out;
}

test('emit: meta texts only in server outputs', () => {
  const { plan } = emitFixture(LIST, [MANOR], new Map([[CH1_ENTRY.id, decodedWorld(worldSource('ch1', 'cafe'))]]));
  // The control: every meta text is planned, in the server meta.
  const server = planned(plan, SERVER_META);
  expect(EMIT_META_TEXTS.filter((t) => !server.includes(t))).toEqual([]);
  // No other output holds one: no story-gen file (the free en table and the public world included), no file of the
  // paid chapter, no other server file.
  const holding = [...plan].filter(([, text]) => EMIT_META_TEXTS.some((t) => text.includes(t))).map(([path]) => path);
  expect(holding.sort()).toEqual([SERVER_META]);
});

test('emit: server meta matches the server fixture shape', () => {
  const { plan } = emitFixture(LIST, [MANOR], new Map([[CH1_ENTRY.id, decodedWorld(worldSource('ch1', 'cafe'))]]));
  const text = planned(plan, SERVER_META);
  const emitted: unknown = JSON.parse(text);
  const fixtureText = readFileSync(new URL('../../../server/tests/fixtures/content/meta.json', import.meta.url), 'utf8');
  const fixture: unknown = JSON.parse(fixtureText);
  const want = shapeOf(fixture, metaWild);
  const got = shapeOf(emitted, metaWild);
  // The same keys at every object path, every condition kind included; every emitted leaf a type the fixture has there.
  expect(got.keys).toEqual(want.keys);
  expect(want.keys['.stories.*.achievements[].when']).toEqual(['all', 'allEndings', 'chapter', 'choice', 'ending', 'endings', 'hints', 'puzzle']);
  expect(Object.keys(got.leaves)).toEqual(Object.keys(want.leaves));
  for (const [path, types] of Object.entries(got.leaves)) {
    expect(types.filter((t) => !(want.leaves[path] ?? []).includes(t)), path).toEqual([]);
  }
  // The shapes match, so the startup checks read the typed fields: the committed fixture against the committed content
  // index and puzzle files (four chapters, two stories), the emitted meta against the planned ones.
  const fixtureIndex = readRepoJson('server/tests/fixtures/content/stories.json') as ServerStoryIndex; // indexProblems' fixture
  const fixturePuzzles = new Map(['ch1', 'ch2', 'ch3', 'ch4'].map((ch) => [ch, puzzleIds(readRepoJson(`server/tests/fixtures/content/puzzles/${ch}.json`))]));
  expect(metaProblems(fixtureText, fixtureIndex, fixturePuzzles)).toEqual([]);
  const index = JSON.parse(planned(plan, STORY_INDEX)) as ServerStoryIndex; // the story index shape test pins it
  const puzzles = new Map(LIST.map((ch) => [ch.id as string, puzzleIds(JSON.parse(planned(plan, `server/content/puzzles/${ch.id}.json`)))]));
  expect(metaProblems(text, index, puzzles)).toEqual([]);
  // The checks are not vacuous: a wrong format and a puzzle of no world are refused.
  const broken = text.replace('"format": 1', '"format": 2').replace('"ch1.cabinet"', '"ch2.cabinet"');
  expect(metaProblems(broken, index, puzzles)).toEqual([
    'format 2, expected 1',
    'manor.achievements.cabinet_open.when: {"puzzle":"ch2.cabinet"} names nothing of manor',
  ]);
  const expected: ServerMeta = {
    format: 1,
    choices: { ch1: {}, ch2: { 'ch2.archive.p004': 'ch2.archive.p004' } } as ServerMeta['choices'], // fixture ids
    stories: {
      manor: { endings: { q7_sealed_vault: META_TEXTS.title }, achievements: Object.entries(EMIT_ACHIEVEMENTS).map(([id, a]) => ({ id, ...a })) },
    } as ServerMeta['stories'], // the fixture's literal ids and conditions
  };
  expect(emitted).toEqual(expected);
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

/** The CLI fixture's story meta (STAGING-DSL §9 "Story meta"): the paid ending's title and one choice achievement. */
const REPO_META = {
  manor: {
    endings: { q7_sealed_vault: META_TEXTS.title },
    achievements: { vault_drawer: { hidden: false, when: { choice: 'ch2.archive.p004' }, name: META_TEXTS.choiceName, desc: META_TEXTS.choiceDesc } },
  },
};

/**
 * The committed catalog, the inline cast, the given chapter list, the fixture's story list and story meta, and the emit
 * fixture's ink and locale tables under story/.
 */
function repoFiles(chapters: unknown = [CH1_LISTED, CH2_LISTED]): Record<string, string> {
  return {
    'assets/catalog.json': readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8'),
    'story/cast.json': JSON.stringify(CAST_RAW),
    'story/chapters.json': JSON.stringify(chapters),
    'story/stories.json': JSON.stringify(STORIES_SOURCE),
    'story/meta.json': JSON.stringify(REPO_META),
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
        'server/content/meta.json',
        'server/content/puzzles/ch1.json',
        'server/content/puzzles/ch2.json',
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
  'story: cli writes server meta',
  () => {
    const texts = [META_TEXTS.title, META_TEXTS.choiceName, META_TEXTS.choiceDesc].flatMap((t) => [t.ru, t.en]);
    withRepo(repoFiles(), (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^stories: manor \(ch1 → ch2\), endings 1\nmeta: manor endings 1, achievements 1; choices ch1 0\/0, ch2 1\/1$/m);
      expect(JSON.parse(readFileSync(join(root, SERVER_META), 'utf8'))).toEqual({
        format: 1,
        choices: { ch1: {}, ch2: { 'ch2.archive.p004': 'ch2.archive.p004' } },
        stories: { manor: { endings: REPO_META.manor.endings, achievements: [{ id: 'vault_drawer', ...REPO_META.manor.achievements.vault_drawer }] } },
      });
      // No meta text in any file under client/ (principle 0, M7).
      const client = filesUnder(root, 'client');
      expect(client).toEqual(CLIENT_OUTPUTS);
      expect(client.flatMap((rel) => texts.filter((t) => readFileSync(join(root, rel), 'utf8').includes(t)).map((t) => `${rel}: ${t}`))).toEqual([]);
    });
    // The gate seen failing through the CLI: the paid ending's title without its English writes nothing.
    const untranslated = { manor: { ...REPO_META.manor, endings: { q7_sealed_vault: { ru: META_TEXTS.title.ru } } } };
    withRepo({ ...repoFiles(), 'story/meta.json': JSON.stringify(untranslated) }, (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/^E story\/meta\.json:0 catalog\/meta manor\.endings\.q7_sealed_vault\.en: missing$/m);
      expect(r.stdout).toMatch(/^meta: invalid \(catalog\/meta\)$/m);
      expect(r.stdout).toMatch(/^story: 1 errors, 0 warnings$/m);
      expect([...filesUnder(root, 'client'), ...filesUnder(root, 'server')]).toEqual([]);
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
      'story/meta.json': JSON.stringify({ manor: { endings: { bad_end: { ru: 'Плохая развязка', en: 'A bad resolution' } }, achievements: {} } }),
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

// ---------------------------------------------------------------------------------------------------------------
// story.ts: worlds (PUZZLES-PLAN "World data", "Build outputs"; D16, D17)

/** ch1 as a world chapter: its lines, then the ink (the cabinet is yielded into `manor_in`, which explores the manor). */
const WORLD_INK_LINES: ReadonlyArray<readonly [id: string, ru: string]> = [
  ['ch1.cafe.f001', 'За углом стоит старая усадьба.'],
  ['ch1.manor_in.f002', 'Дверь усадьбы не заперта.'],
  ['ch1.manor_out.f003', 'Мы вышли из усадьбы.'],
];
const WORLD_CH1 = [
  'INCLUDE ../common/globals.ink',
  '-> cafe',
  '=== cafe ===',
  '# scene: cafe',
  'За углом стоит старая усадьба. #id:ch1.cafe.f001',
  '# puzzle: cabinet then=manor_in',
  '-> DONE',
  '=== manor_in ===',
  'Дверь усадьбы не заперта. #id:ch1.manor_in.f002',
  '# explore: manor',
  '-> DONE',
  '=== manor_out ===',
  'Мы вышли из усадьбы. #id:ch1.manor_out.f003',
  '-> END',
  '',
].join('\n');

/**
 * The CLI fixture with ch1 as a world chapter: WORLD_CH1 and, as story/ch1/world.json, the build world whose way out
 * is `manor_out`, without `lamp` (no state of the manor holds it: `world/unreachable`), after `edit`. ch1's en table
 * holds every ink line and every world text that has an ID as `en <id>`, the hints included.
 */
function worldRepo(edit: (w: WorldJson) => void = () => undefined): { files: Record<string, string>; world: WorldJson } {
  const w = worldSource('ch1', 'manor_out');
  delete objectAt(w, 'items')['lamp'];
  edit(w);
  const texts = [...WORLD_INK_LINES.map(([id, ru]) => ({ id, ru })), ...worldTexts(w)];
  const table = Object.fromEntries(texts.map((x) => [x.id, { ru: x.ru, en: `en ${x.id}` }]));
  const files = {
    ...repoFiles(),
    'story/ch1/main.ink': WORLD_CH1,
    'story/ch1/world.json': `${JSON.stringify(w, null, 2)}\n`,
    [EN_CH1_TABLE]: `${JSON.stringify(table, null, 2)}\n`,
  };
  return { files, world: w };
}

test(
  'story: world softlock fails the gate',
  () => {
    // The way out takes the key, and so does the study's drawer: once the key is spent in the drawer, no leave is left.
    const { files } = worldRepo((w) => {
      objectAt(w, 'sections.manor.rooms.hall.hotspots.2')['lock'] = {
        slots: [{ accepts: 'key' }],
        puzzle: null,
        locked: { id: 'ch1.manor.wz01', ru: 'Дверь на улицу заперта.' },
        onOpen: [],
        onFail: [],
      };
    });
    withRepo(files, (root) => {
      const r = runStory(root);
      expect(r.stdout, r.stdout + r.stderr).toMatch(/^E story\/ch1\/world\.json:\d+ world\/softlock section manor: .* tap /m);
      expect(r.stdout).toMatch(/^world: ch1: 1 section, 2 rooms, 2 puzzles, softlock FAIL \(1 of 1 sections\)$/m);
      expect(r.stdout).toMatch(/^play: ch1: not played \(errors in its sources\)$/m);
      expect(r.status).toBe(1);
      expect([...filesUnder(root, 'client'), ...filesUnder(root, 'server')]).toEqual([]);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: cli builds a world chapter',
  () => {
    const { files, world } = worldRepo();
    const source = decodedWorld(world);
    const hints = hintsOf(source);
    withRepo(files, (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^story: 0 errors, 0 warnings$/m);
      expect(r.stdout).toMatch(/^world: ch1: 1 section, 2 rooms, 2 puzzles, softlock OK \(\d+ states\)$/m);
      expect(r.stdout).toMatch(/^world: ch2: none$/m);
      // The runs play through the cabinet's yield and the manor's rooms into `manor_out`.
      expect(r.stdout).toMatch(/^play: ch1: 200 runs, knots 3\/3, endings 1\/1 \(seeds 1-200, defaults; ended 200, yielded 0, failed 0; pz_cabinet /m);
      expect(filesUnder(root, 'client')).toEqual([...CLIENT_OUTPUTS, CH1_WORLD]);
      const pub = readFileSync(join(root, CH1_WORLD), 'utf8');
      expect(decodeWorldPublic(JSON.parse(pub)).ok).toBe(true);
      expect(pub).not.toMatch(/"(?:solution|hints)"/);
      const server: unknown = JSON.parse(readFileSync(join(root, 'server/content/puzzles/ch1.json'), 'utf8'));
      expect(puzzleProblems(server, 'ch1')).toEqual([]);
      const drawer = (server as { puzzles: Record<string, { hints: unknown }> }).puzzles['drawer']; // checked by puzzleProblems
      expect(drawer?.hints).toEqual(hints.map((h) => ({ ru: h.ru, en: `en ${h.id}` })));
      expect(JSON.parse(readFileSync(join(root, 'server/content/puzzles/ch2.json'), 'utf8'))).toEqual({ format: 1, chapterId: 'ch2', puzzles: {} });
      // The shipped en table: every ink line and world text, no hint (D10).
      const shipped = Object.keys(JSON.parse(readFileSync(join(root, 'client/src/story-gen/free/ch1.en.json'), 'utf8')) as Record<string, string>).sort(); // the en table
      const hintIds = new Set<string>(hints.map((h) => h.id));
      const expected = [...WORLD_INK_LINES.map(([id]) => id), ...worldTexts(world).map((x) => x.id).filter((id) => !hintIds.has(id))].sort();
      expect(shipped).toEqual(expected);
      // The world needles reach the gate's read-back: a hint's ID and another's text in a story-gen file the sweep
      // keeps (L5's asset manifest of ch1) fail the next run.
      const [first, second] = hints;
      put(root, 'client/src/story-gen/free/ch1.assets.json', JSON.stringify({ id: first?.id, ru: second?.ru }));
      const leak = runStory(root);
      expect(leak.status, leak.stdout + leak.stderr).toBe(1);
      expect(leak.stdout).toMatch(new RegExp(`^E client/src/story-gen/free/ch1\\.assets\\.json:0 paid/leak hint ID '${(first?.id ?? '-').replaceAll('.', '\\.')}' `, 'm'));
      expect(leak.stdout).toContain(`paid/leak hint text ${JSON.stringify(second?.ru)} in the public build input (principle 0)`);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: --fix-ids and --sync-locales cover world texts',
  () => {
    // The hall's title without its ID, so it has no en entry either.
    let ru = '';
    const { files } = worldRepo((w) => {
      const title = objectAt(w, 'sections.manor.rooms.hall.title');
      ru = String(title['ru']);
      delete title['id'];
    });
    withRepo(files, (root) => {
      const r = runStory(root, ['--fix-ids', '--sync-locales']);
      const fixed = JSON.parse(readFileSync(join(root, 'story/ch1/world.json'), 'utf8')) as WorldJson; // fixWorldIds writes an object
      const id = String(objectAt(fixed, 'sections.manor.rooms.hall.title')['id']);
      expect(id, r.stdout + r.stderr).toMatch(/^ch1\.manor\.[0-9a-z]{4}$/);
      expect(r.stdout).toMatch(/^fix-ids: 1 ids added in 1 files$/m);
      const table = JSON.parse(readFileSync(join(root, EN_CH1_TABLE), 'utf8')) as Record<string, unknown>; // the en table
      expect(table[id]).toEqual({ ru, en: '' });
      expect(r.stdout).toMatch(/^sync-locales: ch1 \+1 entries$/m);
      // What is left is the author's: the new entry's English.
      const findings = r.stdout.split('\n').filter((l) => /^[EW] /.test(l));
      expect(findings).toEqual([expect.stringMatching(new RegExp(`^E story/locales/en/ch1\\.json:\\d+ loc/empty-en '${id.replaceAll('.', '\\.')}': en is empty \\(§4\\)$`))]);
      expect(r.status).toBe(1);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: a removed world leaves no world output',
  () => {
    // Stale world outputs of a free and a paid chapter, and the puzzle file of a chapter no longer listed.
    const stale = { [CH1_WORLD]: '{}', [CH2_WORLD]: '{}', 'server/content/puzzles/ch9.json': '{}' };
    withRepo({ ...repoFiles(), ...stale }, (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(filesUnder(root, 'client')).toEqual(CLIENT_OUTPUTS);
      expect(filesUnder(root, 'server')).toEqual([
        'server/content/build/fingerprints.lines.json',
        'server/content/build/usage.json',
        'server/content/chapters/ch2/en.json',
        'server/content/chapters/ch2/meta.json',
        'server/content/chapters/ch2/story.json',
        'server/content/meta.json',
        'server/content/puzzles/ch1.json',
        'server/content/puzzles/ch2.json',
        'server/content/stories.json',
      ]);
      expect(r.stdout).toMatch(/^world: ch1: none$/m);
    });
  },
  CLI_TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------------------------------
// graph.ts and story.ts: `vars/write-only` across the chapters (STAGING-DSL §11, D15)

const CH2_SOURCE: SourceChapter = { id: chapterId('ch2'), paid: true, entry: 'ch2/main.ink' };
const WRITE_GLOBALS = 'VAR g_trust = 0\nVAR g_flag = 0\n';
/** ch1 sets g_flag, bumps its own `count` and never reads either; `x` reads itself. */
const WRITE_CH1 = [
  'INCLUDE ../common/globals.ink',
  'VAR count = 0',
  'VAR x = 0',
  '-> start',
  '=== start ===',
  'Привет. #id:ch1.start.k1m2',
  '~ g_flag = 1',
  '~ count += 1',
  '~ x = x + 1',
  '-> END',
];
const WRITE_CH2 = ['INCLUDE ../common/globals.ink', '-> start', '=== start ===', 'Там. #id:ch2.start.k1m2', '-> END'];

/** The graph facts of ch1 and ch2, in list order, over WRITE_GLOBALS. */
function writeFacts(ch1: readonly string[], ch2: readonly string[]): GraphFacts[] {
  const files = new Map([
    [GLOBALS_PATH, WRITE_GLOBALS],
    ['ch1/main.ink', `${ch1.join('\n')}\n`],
    ['ch2/main.ink', `${ch2.join('\n')}\n`],
  ]);
  return [graphOf(files, CH1).facts, graphOf(files, CH2_SOURCE).facts];
}

test(
  'lint: vars/write-only red on fixture',
  () => {
    const found = writeOnly(writeFacts(WRITE_CH1, WRITE_CH2));
    // g_flag and count; `~ x = x + 1` reads x.
    expect(where(found, 'vars/write-only')).toEqual([`ch1/main.ink:${lineOf(WRITE_CH1, '~ g_flag = 1')}`, `ch1/main.ink:${lineOf(WRITE_CH1, '~ count += 1')}`]);
    expect(found.every((f) => f.severity === 'W')).toBe(true);
    // Through the CLI: the same three writes in the emit fixture's ch1.
    const ch1 = (EMIT_SOURCES.get('ch1/main.ink') ?? '')
      .replace('INCLUDE ../common/globals.ink\n', 'INCLUDE ../common/globals.ink\nVAR count = 0\nVAR x = 0\n')
      .replace('-> END\n', '~ g_flag = 1\n~ count += 1\n~ x = x + 1\n-> END\n');
    const lines = ch1.split('\n');
    const files = { ...repoFiles(), 'story/common/globals.ink': WRITE_GLOBALS, 'story/ch1/main.ink': ch1 };
    const writes = (stdout: string): string[] => stdout.split('\n').filter((l) => l.includes(' vars/write-only '));
    withRepo(files, (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(writes(r.stdout)).toEqual([
        `W story/ch1/main.ink:${lineOf(lines, '~ g_flag = 1')} vars/write-only VAR g_flag is assigned, but no listed chapter reads it (§11)`,
        `W story/ch1/main.ink:${lineOf(lines, '~ count += 1')} vars/write-only VAR count is assigned, but its chapter never reads it (§11)`,
      ]);
      expect(r.stdout).toMatch(/^story: 0 errors, 2 warnings$/m);
    });
    // The error-run control: ch2 does not compile, so its reads are unknown and nothing is judged.
    const broken = (EMIT_SOURCES.get('ch2/main.ink') ?? '').replace('    -> drawer\n', '    -> nowhere\n');
    withRepo({ ...files, 'story/ch2/main.ink': broken }, (root) => {
      const r = runStory(root);
      expect(r.stdout, r.stdout + r.stderr).toMatch(/^story: ch2 failed$/m);
      expect(writes(r.stdout)).toEqual([]);
      expect(r.status).toBe(1);
    });
  },
  CLI_TIMEOUT_MS,
);

test('lint: vars/write-only allows a global read in a later chapter', () => {
  const ch1 = ['INCLUDE ../common/globals.ink', '-> start', '=== start ===', 'Привет. #id:ch1.start.k1m2', '~ g_flag = 1', '-> END'];
  const ch2 = ['INCLUDE ../common/globals.ink', '-> start', '=== start ===', '{ g_flag > 0:', '    Флаг поднят. #id:ch2.start.k3m4', '}', 'Там. #id:ch2.start.k1m2', '-> END'];
  expect(where(writeOnly(writeFacts(ch1, ch2)), 'vars/write-only')).toEqual([]);
});
