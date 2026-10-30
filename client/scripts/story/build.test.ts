// The story build: compile (inkjs compiler), knot graph, emit and the `story` CLI (STAGING-DSL §8-§11,
// PROTOTYPE-PLAN.md K9 and "Build outputs"). Fixtures are inline ink; the catalog and cast are the committed ones.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog, decodeCast } from '../../src/story/catalog.ts';
import type { Cast } from '../../src/story/catalog.ts';
import type { AssetIndex, ChapterId, KnotName } from '../../src/story/staging.ts';
import { compileChapter, resolveInclude } from './compile.ts';
import type { ReadInk } from './compile.ts';
import { buildGraph } from './graph.ts';
import type { ChapterGraph } from './graph.ts';
import { GLOBALS_PATH, lintSources } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';

function readRepoJson(path: string): unknown {
  const text = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  return JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text);
}

function committed(): { assets: AssetIndex; cast: Cast } {
  const catalog = decodeAssetCatalog(readRepoJson('assets/catalog.json'));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  const cast = decodeCast(readRepoJson('story/cast.json'), catalog.value);
  if (!cast.ok) {
    throw new Error('invariant: the committed cast decodes');
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
