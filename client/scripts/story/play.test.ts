// The seeded playthroughs of the story gate (STAGING-DSL §11 "Seeded playthroughs", `play/*`): `playChapter` is
// called directly on fixtures compiled and graphed in-test, so a fixture may be lint-dirty. The catalog and cast are
// the committed ones.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog, decodeCast } from '../../src/story/catalog.ts';
import type { Cast, ChapterListEntry } from '../../src/story/catalog.ts';
import type { AssetIndex, ChapterId, VarName } from '../../src/story/staging.ts';
import { compileChapter } from './compile.ts';
import { buildGraph } from './graph.ts';
import type { ChapterGraph } from './graph.ts';
import { GLOBALS_PATH } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';
import { PLAY_RUNS, STEP_CAP, coverageLine, decodeAllow, mulberry32, playChapter } from './playthrough.ts';
import type { ChapterPlay, PlayInput } from './playthrough.ts';

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

function varName(name: string): VarName {
  return name as VarName; // test fixtures name their globals directly
}

const CH1: SourceChapter = { id: chapterId('ch1'), paid: false, entry: 'ch1/main.ink' };
const CH2: SourceChapter = { id: chapterId('ch2'), paid: true, entry: 'ch2/main.ink' };
const GLOBALS = 'VAR g_x = 0\n';

type Fixture = { chapter: SourceChapter; json: string; graph: ChapterGraph };

/** One chapter compiled and graphed from its entry body (after the globals INCLUDE line). */
function fixture(body: readonly string[], chapter: SourceChapter = CH1, globals = GLOBALS): Fixture {
  const files = new Map([
    [GLOBALS_PATH, globals],
    [chapter.entry, ['INCLUDE ../common/globals.ink', ...body, ''].join('\n')],
  ]);
  const r = compileChapter(chapter, (key) => files.get(key) ?? null);
  if (r.compiled === null) {
    throw new Error(`invariant: the fixture compiles: ${JSON.stringify(r.findings)}`);
  }
  const g = buildGraph({ chapter, files: r.compiled.files, sources: files, assets: COMMITTED.assets });
  return { chapter, json: r.compiled.json, graph: g.graph };
}

function play(f: Fixture, over: Partial<PlayInput> = {}): { play: ChapterPlay; findings: Finding[] } {
  return playChapter({
    chapter: f.chapter,
    json: f.json,
    graph: f.graph,
    assets: COMMITTED.assets,
    cast: COMMITTED.cast,
    en: new Map(),
    staticIds: new Set(f.graph.lines.map((l) => l.id)),
    allow: new Map(),
    carry: null,
    ...over,
  });
}

function at(findings: readonly Finding[], code: LintCode): string[] {
  return findings.filter((f) => f.code === code).map((f) => `${f.file}:${f.line}`);
}

const LOOP = ['-> a', '=== a ===', 'А. #id:ch1.a.a001', '-> b', '=== b ===', 'Б. #id:ch1.b.a002', '-> a'];

test('play: step cap fails', () => {
  expect(STEP_CAP).toBe(5000);
  expect(PLAY_RUNS).toBe(200);
  const r = play(fixture(LOOP), { runs: 2 });
  expect(r.findings.filter((f) => f.code === 'play/step-cap'), JSON.stringify(r.findings)).toEqual([
    expect.objectContaining({ severity: 'E', file: 'ch1/main.ink', message: expect.stringContaining('2 of 2 runs') }),
  ]);
  expect(r.play).toMatchObject({ runs: 2, ended: 0, yielded: 0, failed: 2 });
});

test('lint: play/ending-not-reached red on fixture', () => {
  const f = fixture(
    ['-> k', '=== k ===', 'Текст. #id:ch1.k.a001', '{ g_never:', '    -> END', '}', '-> other', '=== other ===', 'Другое. #id:ch1.other.a002', '-> END'],
    CH1,
    'VAR g_never = false\n',
  );
  const r = play(f);
  expect(at(r.findings, 'play/ending-not-reached'), JSON.stringify(r.findings)).toEqual(['ch1/main.ink:3']);
  expect(r.findings.find((f) => f.code === 'play/ending-not-reached')?.severity).toBe('E');
  expect(at(r.findings, 'play/knot-not-visited')).toEqual([]);
  expect([...r.play.endings]).toEqual(['other']);
});

const SECRET = [
  '-> start',
  '=== start ===',
  'Начало. #id:ch1.start.a001',
  '* {g_x > 99} [Тайна. #id:ch1.start.a002]',
  '    -> secret',
  '* [Дальше. #id:ch1.start.a003]',
  '    -> END',
  '=== secret ===',
  'Секрет. #id:ch1.secret.a004',
  '-> END',
];

test('lint: play/knot-not-visited red on fixture', () => {
  const r = play(fixture(SECRET));
  expect(at(r.findings, 'play/knot-not-visited'), JSON.stringify(r.findings)).toEqual(['ch1/main.ink:9']);
  expect(r.findings.find((f) => f.code === 'play/knot-not-visited')?.message).toContain("'secret'");
  expect([...r.play.visited]).toEqual(['start']);
});

test('play: an allowed knot is not reported', () => {
  const f = fixture(SECRET);
  const listed: ChapterListEntry[] = [{ id: CH1.id, entry: CH1.entry, paid: false, productId: null, next: null }];
  const graphs = new Map([[CH1.id, f.graph]]);
  const text = (entries: unknown): string => `${JSON.stringify({ 'play/knot-not-visited': entries }, null, 2)}\n`;
  const ok = decodeAllow(text({ 'ch1.secret': 'reached only with a cheat code' }), listed, graphs);
  expect(ok.findings).toEqual([]);
  expect(at(play(f, { allow: ok.allow }).findings, 'play/knot-not-visited')).toEqual([]);
  // An empty reason allows nothing and is itself a finding, on its key's line.
  const empty = decodeAllow(text({ 'ch1.secret': ' ' }), listed, graphs);
  expect(at(empty.findings, 'play/knot-not-visited')).toEqual(['lint-allow.json:3']);
  expect(at(play(f, { allow: empty.allow }).findings, 'play/knot-not-visited')).toEqual(['ch1/main.ink:9']);
  // Every malformed entry is a finding on its key's line; a missing file allows nothing.
  const bad = decodeAllow(
    `${JSON.stringify({ 'play/knot-not-visited': { secret: 'x', 'ch9.secret': 'x', 'ch1.nope': 'x', 'ch1.secret': 1 }, other: {} }, null, 2)}\n`,
    listed,
    graphs,
  );
  expect(at(bad.findings, 'play/knot-not-visited'), JSON.stringify(bad.findings)).toEqual(['lint-allow.json:3', 'lint-allow.json:4', 'lint-allow.json:5', 'lint-allow.json:6', 'lint-allow.json:8']);
  expect(bad.allow.size).toBe(0);
  expect(at(decodeAllow('[]', listed, graphs).findings, 'play/knot-not-visited')).toEqual(['lint-allow.json:0']);
  expect(decodeAllow(null, listed, graphs)).toEqual({ allow: new Map(), findings: [] });
  // Without a decoded chapter list no chapter can be judged unlisted, and a chapter that did not compile is not judged.
  expect(decodeAllow(text({ 'ch9.secret': 'x' }), null, new Map()).findings).toEqual([]);
  expect(decodeAllow(text({ 'ch1.nope': 'x' }), listed, new Map()).findings).toEqual([]);
});

test('lint: play/runtime-error red on fixture', () => {
  // A missing external binding: the runtime throws before the first line (Story.ValidateExternalBindings).
  const f = fixture(['EXTERNAL beep()', '-> start', '=== start ===', '~ beep()', 'Текст. #id:ch1.start.a001', '-> END']);
  const r = play(f);
  expect(r.findings.filter((x) => x.code === 'play/runtime-error'), JSON.stringify(r.findings)).toEqual([
    expect.objectContaining({ severity: 'E', file: 'ch1/main.ink', line: 0, message: expect.stringMatching(/beep.*200 of 200 runs/s) }),
  ]);
  expect(r.play).toMatchObject({ ended: 0, failed: 200 });
});

test('lint: play/line-without-id red on fixture', () => {
  const r = play(fixture(['-> start', '=== start ===', 'Без метки.', '* [Выбор без метки.]', '    -> END']));
  const found = r.findings.filter((f) => f.code === 'play/line-without-id');
  expect(found.map((f) => `${f.file}:${f.line}`), JSON.stringify(r.findings)).toEqual(['ch1/main.ink:0', 'ch1/main.ink:0']);
  expect(found.map((f) => f.message)).toEqual([expect.stringContaining('"Без метки."'), expect.stringContaining('"Выбор без метки."')]);
  expect(r.play.ended).toBe(200);
});

test('play: batch conflict across a divert is reported', () => {
  // The static batches are clean; inkjs merges the tag line before the divert into the next knot's first line.
  const r = play(fixture(['-> start', '=== start ===', '# bg: room', '-> next', '=== next ===', '# bg: cafe', 'Текст. #id:ch1.next.a001', '-> END']));
  expect(r.findings.filter((f) => f.code === 'batch/conflict'), JSON.stringify(r.findings)).toEqual([
    expect.objectContaining({ severity: 'E', file: 'ch1/main.ink', line: 8, message: expect.stringContaining('200 of 200 runs') }),
  ]);
});

test('play: tag errors the lint reports are not repeated', () => {
  const r = play(fixture(['-> start', '=== start ===', '# bg: nope', 'Текст. #id:ch1.start.a001', '-> END']));
  expect(r.findings).toEqual([]);
  expect(r.play).toMatchObject({ runs: 200, ended: 200, failed: 0 });
});

const CARRY_CH2 = [
  '-> start',
  '=== start ===',
  '{ g_x == 1:',
  '    -> kept',
  '- else:',
  '    -> lost',
  '}',
  '=== kept ===',
  'Сохранено. #id:ch2.kept.b001',
  '-> END',
  '=== lost ===',
  'Потеряно. #id:ch2.lost.b002',
  '-> END',
];

test('play: ch2 runs start from ch1 carries', () => {
  const ch1 = play(fixture(['-> start', '=== start ===', '~ g_x = 1', 'Текст. #id:ch1.start.a001', '-> END']));
  const f = fixture(CARRY_CH2, CH2);
  const carried = play(f, { carry: { from: CH1.id, snapshots: ch1.play.carries.map((c) => c.vars) } });
  expect([...carried.play.visited], JSON.stringify(carried.findings)).toEqual(['start', 'kept']);
  expect(at(carried.findings, 'play/knot-not-visited')).toEqual(['ch2/main.ink:12']);
  expect(carried.play.carriedFrom).toBe('ch1');
  expect(coverageLine(carried.play, f.graph)).toContain('(seeds 1-200, ch1 carries;');
  // No carry is the declared defaults: g_x = 0.
  const defaults = play(f);
  expect([...defaults.play.visited]).toEqual(['start', 'lost']);
  expect(coverageLine(defaults.play, f.graph)).toContain('(seeds 1-200, defaults;');
  const none = play(f, { carry: { from: CH1.id, snapshots: [] } });
  expect([...none.play.visited]).toEqual(['start', 'lost']);
  expect(coverageLine(none.play, f.graph)).toContain('(seeds 1-200, defaults: ch1 left no carry;');
});

test('play: seeded runs are reproducible', () => {
  const f = fixture([
    '-> a',
    '=== a ===',
    '{ shuffle:',
    '- Один. #id:ch1.a.a001',
    '    ~ g_x = 1',
    '- Два. #id:ch1.a.a002',
    '    ~ g_x = 2',
    '}',
    '* [Так. #id:ch1.a.a003]',
    '    -> END',
    '* [Иначе. #id:ch1.a.a004]',
    '    ~ g_x = g_x + 10',
    '    -> END',
  ]);
  const first = play(f);
  expect(play(f)).toEqual(first);
  expect(new Set(first.play.carries.map((c) => JSON.stringify(c.vars))).size, JSON.stringify(first.findings)).toBeGreaterThan(1);
});

test('play: mulberry32 sequence is pinned', () => {
  // bryc, github.com/bryc/code/blob/master/jshash/PRNGs.md "Mulberry32", run as a node -e copy of that code.
  const three = (seed: number): number[] => {
    const next = mulberry32(seed);
    return [next(), next(), next()];
  };
  expect(three(1)).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  expect(three(200)).toEqual([0.3069990389049053, 0.609165761154145, 0.49042481533251703]);
});

test('play: a yield ends the run without an error', () => {
  const f = fixture(['-> start', '=== start ===', 'Текст. #id:ch1.start.a001', '# puzzle: lock then=after', '-> DONE', '=== after ===', 'После. #id:ch1.after.a002', '-> END']);
  const r = play(f);
  expect(r.play, JSON.stringify(r.findings)).toMatchObject({ runs: 200, yielded: 200, ended: 0, failed: 0, carries: [] });
  expect(at(r.findings, 'play/runtime-error')).toEqual([]);
  expect(at(r.findings, 'play/knot-not-visited')).toEqual(['ch1/main.ink:7']);
  expect(at(r.findings, 'play/ending-not-reached')).toEqual(['ch1/main.ink:7']);
  expect(r.findings).toHaveLength(2);
});

test('play: a text-less routing knot counts as visited', () => {
  const f = fixture([
    '-> start',
    '=== start ===',
    'Текст. #id:ch1.start.a001',
    '-> route',
    '=== route ===',
    '{ g_x > 0:',
    '    -> a',
    '- else:',
    '    -> b',
    '}',
    '=== a ===',
    'А. #id:ch1.a.a002',
    '-> END',
    '=== b ===',
    'Б. #id:ch1.b.a003',
    '-> END',
  ]);
  const r = play(f);
  expect([...r.play.visited]).toEqual(['start', 'route', 'b']);
  expect(at(r.findings, 'play/knot-not-visited'), JSON.stringify(r.findings)).toEqual(['ch1/main.ink:12']);
});

test('play: a text-less loop is capped, not hung', () => {
  const r = play(fixture(['-> start', '=== start ===', '-> start']), { runs: 2 });
  expect(r.findings.filter((f) => f.code === 'play/step-cap'), JSON.stringify(r.findings)).toEqual([
    expect.objectContaining({ file: 'ch1/main.ink', line: 3, message: expect.stringContaining('2 of 2 runs') }),
  ]);
  expect(r.play).toMatchObject({ runs: 2, failed: 2 });
});

test('play: carries name the knot each run ended in', () => {
  const f = fixture([
    '-> start',
    '=== start ===',
    '* [Хорошо. #id:ch1.start.a001]',
    '    ~ g_x = 1',
    '    -> good',
    '* [Плохо. #id:ch1.start.a002]',
    '    ~ g_x = 9',
    '    -> bad',
    '=== good ===',
    'Хорошо. #id:ch1.good.a003',
    '-> END',
    '=== bad ===',
    'Плохо. #id:ch1.bad.a004',
    '-> END',
  ]);
  const r = play(f);
  expect(new Set(r.play.carries.map((c) => `${c.knot}:${c.vars[varName('g_x')]}`)), JSON.stringify(r.findings)).toEqual(new Set(['good:1', 'bad:9']));
  expect(r.play.carries).toHaveLength(200);
});

test('play: tag lines before a choice block are not a line', () => {
  // inkjs yields `# show: ally smile` as a tag-only step that carries the choice set (§3.5): it needs no ID, and it
  // never merges into the first line after the choice.
  const f = fixture([
    '-> start',
    '=== start ===',
    'ally: Хм. #id:ch1.start.a001',
    '# show: ally smile',
    '* [Да. #id:ch1.start.a002]',
    '    -> next',
    '=== next ===',
    '# show: ally worried',
    'Дальше. #id:ch1.next.a003',
    '-> END',
  ]);
  const r = play(f);
  expect(at(r.findings, 'play/line-without-id'), JSON.stringify(r.findings)).toEqual([]);
  expect(at(r.findings, 'batch/conflict')).toEqual([]);
  expect(r.play.ended).toBe(200);
});

test('play: a float global is carried as a float', () => {
  const globals = 'VAR g_ratio = 1.5\n';
  const ch1 = play(fixture(['-> start', '=== start ===', '~ g_ratio = g_ratio + 0.5', 'Текст. #id:ch1.start.a001', '-> END'], CH1, globals));
  const f = fixture(
    [
      '-> start',
      '=== start ===',
      '{ g_ratio / 4 > 0.4:',
      '    -> half',
      '- else:',
      '    -> whole',
      '}',
      '=== half ===',
      'Половина. #id:ch2.half.b001',
      '-> END',
      '=== whole ===',
      'Целое. #id:ch2.whole.b002',
      '-> END',
    ],
    CH2,
    globals,
  );
  // 2.0 arrives as the JS number 2; an int write would divide as integers (2 / 4 = 0) and route to `whole`.
  const r = play(f, { carry: { from: CH1.id, snapshots: ch1.play.carries.map((c) => c.vars) } });
  expect([...r.play.visited], JSON.stringify(r.findings)).toEqual(['start', 'half']);
  expect(at(r.findings, 'play/knot-not-visited')).toEqual(['ch2/main.ink:12']);
});
