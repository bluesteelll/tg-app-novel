// The story tool's localization side (STAGING-DSL §4, §11): `--fix-ids`, `--sync-locales`, the locale checks, and the
// `story` CLI runs of this lane against a temporary repository (`--root`). Fixtures are inline; the catalog and cast
// are the committed ones.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog, decodeCast, decodeChapterCatalog } from '../../src/story/catalog.ts';
import type { Cast, ChapterListEntry } from '../../src/story/catalog.ts';
import type { AssetIndex, ChapterId, LineId, ProductId } from '../../src/story/staging.ts';
import { LINE_ID_RE } from '../../src/story/tags.ts';
import type { StoryNames } from './emit.ts';
import { fixIds, syncLocales } from './fix.ts';
import type { FixIdsInput, IdTarget } from './fix.ts';
import type { ChapterGraph, StoryLine } from './graph.ts';
import { GLOBALS_PATH, lintSources } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';
import { checkLocales, decodeEnTable, decodeNameTable, decodeRetired } from './locales.ts';
import type { EnTable } from './locales.ts';

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
const BOM = String.fromCharCode(0xfeff);

function chapterId(id: string): ChapterId {
  return id as ChapterId; // test fixtures name their chapters directly
}

const CH1: SourceChapter = { id: chapterId('ch1'), paid: false, entry: 'ch1/main.ink' };

// ---------------------------------------------------------------------------------------------------------------
// fix.ts: --fix-ids

/** The `id/missing` findings of the source lint over `files` (BOM-stripped, as story.ts lints them). */
function missingIds(files: ReadonlyMap<string, string>): IdTarget[] {
  const stripped = new Map([...files].map(([k, v]) => [k, v.startsWith(BOM) ? v.slice(1) : v]));
  return lintSources({ files: stripped, chapters: [CH1], assets: COMMITTED.assets, cast: COMMITTED.cast })
    .filter((f) => f.code === 'id/missing')
    .map((f) => ({ file: f.file, line: f.line }));
}

/** A suffix source that hands out `values` in order. */
function suffixes(...values: string[]): () => string {
  let i = 0;
  return () => {
    const v = values[i];
    i += 1;
    if (v === undefined) {
      throw new Error('invariant: the fixture provides enough suffixes');
    }
    return v;
  };
}

function fixInput(files: ReadonlyMap<string, string>, over: Partial<FixIdsInput> = {}): FixIdsInput {
  return { files, targets: missingIds(files), chapters: [CH1.id], taken: new Set(), suffix: suffixes('k001', 'k002', 'k003'), ...over };
}

const FIX_MAIN = [
  'INCLUDE ../common/globals.ink',
  '-> start',
  '=== start ===',
  'ally: Привет.',
  'Тихо.',
  'Уже есть. #id:ch1.start.e001',
  '* [Остаться.]',
  '    -> END',
  '* [Уйти. #id:ch1.start.e002]',
  '    -> END',
  '',
];

test('fix: missing ids written, existing untouched', () => {
  const files = new Map([[GLOBALS_PATH, 'VAR g_trust = 0\n'], ['ch1/main.ink', FIX_MAIN.join('\n')]]);
  const r = fixIds(fixInput(files));
  expect(r.added, JSON.stringify(r)).toHaveLength(3);
  expect(r.skipped).toEqual([]);
  for (const a of r.added) {
    expect(a.id).toMatch(LINE_ID_RE);
    expect(a.id.startsWith('ch1.start.'), a.id).toBe(true);
  }
  expect(r.added.map((a) => `${a.file}:${a.line}`)).toEqual(['ch1/main.ink:4', 'ch1/main.ink:5', 'ch1/main.ink:7']);
  expect([...r.files.keys()]).toEqual(['ch1/main.ink']);
  const text = r.files.get('ch1/main.ink') ?? '';
  expect(text.split('\n')).toEqual([
    'INCLUDE ../common/globals.ink',
    '-> start',
    '=== start ===',
    'ally: Привет. #id:ch1.start.k001',
    'Тихо. #id:ch1.start.k002',
    'Уже есть. #id:ch1.start.e001',
    '* [Остаться. #id:ch1.start.k003]',
    '    -> END',
    '* [Уйти. #id:ch1.start.e002]',
    '    -> END',
    '',
  ]);
  expect(missingIds(new Map(files).set('ch1/main.ink', text))).toEqual([]);
});

test('fix: new ids avoid taken ids', () => {
  const files = new Map([['ch1/main.ink', FIX_MAIN.join('\n')]]);
  // 'aaaa' is taken before the run, 'bbbb' by the run's own first ID.
  const r = fixIds(fixInput(files, { taken: new Set(['ch1.start.aaaa']), suffix: suffixes('aaaa', 'bbbb', 'bbbb', 'cccc', 'dddd') }));
  expect(r.added.map((a) => a.id)).toEqual(['ch1.start.bbbb', 'ch1.start.cccc', 'ch1.start.dddd']);
  expect(() => fixIds(fixInput(files, { taken: new Set(['ch1.start.aaaa']), suffix: () => 'aaaa' }))).toThrow(/^invariant: /);
});

test('fix: line endings, BOM and comments kept', () => {
  const lines = ['INCLUDE ../common/globals.ink', '-> start', '=== start ===', 'Тихо. // note', 'Уже есть. #id:ch1.start.e001', '-> END', ''];
  // CRLF everywhere except one LF: separators are kept per line.
  const text = `${BOM}${lines.slice(0, 4).join('\r\n')}\n${lines.slice(4).join('\r\n')}`;
  const r = fixIds(fixInput(new Map([['ch1/main.ink', text]])));
  expect(r.added.map((a) => a.line)).toEqual([4]);
  expect(r.files.get('ch1/main.ink')).toBe(
    `${BOM}INCLUDE ../common/globals.ink\r\n-> start\r\n=== start ===\r\nТихо. #id:ch1.start.k001 // note\nУже есть. #id:ch1.start.e001\r\n-> END\r\n`,
  );
});

test('fix: unplaceable lines are skipped, not guessed', () => {
  const files = new Map([
    [
      'ch1/main.ink',
      ['INCLUDE ../common/globals.ink', 'Сверху.', '-> start', '=== start ===', '* Уйти', '    -> END', '/* c */ Текст.', '-> END', ''].join('\n'),
    ],
    ['common/x.ink', '=== helper ===\nОбщая строка.\n-> END\n'],
  ]);
  const r = fixIds(fixInput(files));
  expect(r.added).toEqual([]);
  expect(r.files.size).toBe(0);
  expect(r.skipped.map((s) => `${s.file}:${s.line}`).sort()).toEqual(['ch1/main.ink:2', 'ch1/main.ink:5', 'ch1/main.ink:7', 'common/x.ink:2']);
  expect(r.skipped.every((s) => s.reason !== '')).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------
// locales.ts: en tables, names and titles, cross-chapter and retired IDs; fix.ts: --sync-locales

const CH1_ENTRY: ChapterListEntry = { id: chapterId('ch1'), entry: 'ch1/main.ink', paid: false, productId: null, next: chapterId('ch2') };
const CH2_ENTRY: ChapterListEntry = { id: chapterId('ch2'), entry: 'ch2/main.ink', paid: true, productId: 'chapter:ch2' as ProductId, next: null };

function storyLine(id: string, text: string, file: string, line: number): StoryLine {
  return { id: id as LineId, text, file, line }; // fixture IDs match LINE_ID_RE
}

/** A graph with only the ID'd lines: the one part of a graph the locale checks read. */
function linesGraph(ch: ChapterId, lines: readonly StoryLine[]): ChapterGraph {
  return { chapter: ch, firstKnot: null, knots: new Map(), globals: [], vars: [], lines, carried: new Map() };
}

const LOC_A001 = storyLine('ch1.start.a001', 'Привет.', 'ch1/main.ink', 4);
const LOC_A002 = storyLine('ch1.start.a002', 'Пока.', 'ch1/main.ink', 5);
const LOC_CH1 = [LOC_A001, LOC_A002];
const LOC_CH2 = [storyLine('ch2.start.b001', 'Архив.', 'ch2/main.ink', 4)];

function table(entries: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

const EN_CH1 = { 'ch1.start.a001': { ru: 'Привет.', en: 'Hi.' }, 'ch1.start.a002': { ru: 'Пока.', en: 'Bye.' } };
const EN_CH2 = { 'ch2.start.b001': { ru: 'Архив.', en: 'Archive.' } };
const NAMES_RU = { names: { ally: 'Подруга', stranger: 'Незнакомец', voice: 'Голос' }, chapters: { ch1: 'Глава 1', ch2: 'Глава 2' } };
const NAMES_EN = { names: { ally: 'Ally', stranger: 'Stranger', voice: 'Voice' }, chapters: { ch1: 'Chapter 1', ch2: 'Chapter 2' } };

type LocaleTexts = {
  en?: Readonly<Record<string, string>>;
  ru?: string | null;
  enNames?: string | null;
  retired?: string | null;
  chapters?: readonly ChapterListEntry[] | null;
  lines?: { ch1: readonly StoryLine[]; ch2: readonly StoryLine[] };
};

/** Decodes the texts as story.ts does and checks them; every decode and check finding together. */
function locales(texts: LocaleTexts = {}): { findings: Finding[]; names: StoryNames | null } {
  const decoded: Finding[] = [];
  const en = new Map<string, EnTable>();
  for (const [name, text] of Object.entries(texts.en ?? { ch1: table(EN_CH1), ch2: table(EN_CH2) })) {
    const d = decodeEnTable(`locales/en/${name}.json`, text);
    decoded.push(...d.findings);
    en.set(name, d.table);
  }
  const ru = decodeNameTable('locales/ru/story.json', texts.ru === undefined ? table(NAMES_RU) : texts.ru);
  const enNames = decodeNameTable('locales/en/story.json', texts.enNames === undefined ? table(NAMES_EN) : texts.enNames);
  const retired = decodeRetired(texts.retired ?? null);
  decoded.push(...ru.findings, ...enNames.findings, ...retired.findings);
  const lines = texts.lines ?? { ch1: LOC_CH1, ch2: LOC_CH2 };
  const graphs = new Map([
    [CH1_ENTRY.id, linesGraph(CH1_ENTRY.id, lines.ch1)],
    [CH2_ENTRY.id, linesGraph(CH2_ENTRY.id, lines.ch2)],
  ]);
  const chapters = texts.chapters === undefined ? [CH1_ENTRY, CH2_ENTRY] : texts.chapters;
  const r = checkLocales({ chapters, graphs, en, names: { ru: ru.table, en: enNames.table }, cast: COMMITTED.cast, retired: retired.ids });
  return { findings: [...decoded, ...r.findings], names: r.names };
}

function at(findings: readonly Finding[], code: LintCode): string[] {
  return findings.filter((f) => f.code === code).map((f) => `${f.file}:${f.line}`);
}

test('lint: loc/missing-en red on fixture', () => {
  const r = locales({ en: { ch1: table({ 'ch1.start.a001': EN_CH1['ch1.start.a001'] }), ch2: table(EN_CH2) } });
  expect(at(r.findings, 'loc/missing-en'), JSON.stringify(r.findings)).toEqual(['ch1/main.ink:5']);
  expect(r.findings.find((f) => f.code === 'loc/missing-en')?.message).toContain('story/locales/en/ch1.json (run --sync-locales)');
  // A missing table is every line missing, not a file-level finding.
  expect(at(locales({ en: { ch1: table(EN_CH1) } }).findings, 'loc/missing-en')).toEqual(['ch2/main.ink:4']);
});

test('lint: loc/empty-en red on fixture', () => {
  const r = locales({ en: { ch1: table({ ...EN_CH1, 'ch1.start.a002': { ru: 'Пока.', en: '  ' } }), ch2: table(EN_CH2) } });
  // Line 6 of the two-space table is the second key.
  expect(at(r.findings, 'loc/empty-en'), JSON.stringify(r.findings)).toEqual(['locales/en/ch1.json:6']);
  expect(r.findings.every((f) => f.severity === 'E')).toBe(true);
});

test('lint: loc/orphan-en red on fixture', () => {
  const en = {
    ch1: table({ ...EN_CH1, 'ch1.start.zzzz': { ru: 'Удалено.', en: 'Removed.' }, hello: { ru: 'а', en: 'b' } }),
    ch2: table(EN_CH2),
    ch9: table({}),
  };
  const r = locales({ en });
  expect(at(r.findings, 'loc/orphan-en').sort(), JSON.stringify(r.findings)).toEqual(['locales/en/ch1.json:10', 'locales/en/ch1.json:14', 'locales/en/ch9.json:0']);
  // Without a decoded chapter list every table would read as stray: none is judged.
  const unlisted = locales({ en, chapters: null });
  expect(at(unlisted.findings, 'loc/orphan-en')).not.toContain('locales/en/ch9.json:0');
  expect(at(unlisted.findings, 'loc/orphan-en')).toContain('locales/en/ch1.json:14');
});

test('lint: loc/stale-en red on fixture', () => {
  const r = locales({ en: { ch1: table({ ...EN_CH1, 'ch1.start.a001': { ru: 'Здравствуй.', en: 'Hello.' } }), ch2: table(EN_CH2) } });
  expect(
    r.findings.filter((f) => f.code === 'loc/stale-en'),
    JSON.stringify(r.findings),
  ).toEqual([expect.objectContaining({ severity: 'W', file: 'locales/en/ch1.json', line: 2, message: expect.stringContaining('"Здравствуй."') })]);
  expect(r.findings.filter((f) => f.code !== 'loc/stale-en')).toEqual([]);
});

test('lint: loc/missing-name red on fixture', () => {
  const r = locales({
    ru: table({ ...NAMES_RU, chapters: { ch1: 'Глава 1', ch2: '' } }),
    enNames: table({ ...NAMES_EN, names: { ally: 'Ally', voice: 'Voice' } }),
  });
  expect(at(r.findings, 'loc/missing-name').sort(), JSON.stringify(r.findings)).toEqual(['locales/en/story.json:0', 'locales/ru/story.json:9']);
  expect(r.names).toBeNull();
  // A missing story.json is every name missing.
  expect(at(locales({ ru: null }).findings, 'loc/missing-name')).toHaveLength(5);
});

test('lint: id/duplicate red on fixture (across chapters)', () => {
  // The lint.test.ts shape: ch1 and ch2 both write ch1.start.d001; the later chapter's occurrence is the duplicate.
  const d1 = storyLine('ch1.start.d001', 'Текст.', 'ch1/main.ink', 4);
  const d2 = storyLine('ch1.start.d001', 'Текст.', 'ch2/main.ink', 4);
  const entry = table({ 'ch1.start.d001': { ru: 'Текст.', en: 'Text.' } });
  const r = locales({ lines: { ch1: [d1], ch2: [d2] }, en: { ch1: entry, ch2: entry } });
  expect(
    r.findings.filter((f) => f.code === 'id/duplicate'),
    JSON.stringify(r.findings),
  ).toEqual([expect.objectContaining({ file: 'ch2/main.ink', line: 4, message: expect.stringContaining('ch1/main.ink:4 (chapter ch1)') })]);
  // Within one chapter it is the source lint's; one file reached by two chapters is one occurrence (ink/include).
  const within = locales({ lines: { ch1: [d1, { ...d1, line: 5 }], ch2: [d1] }, en: { ch1: entry, ch2: entry } });
  expect(at(within.findings, 'id/duplicate')).toEqual([]);
});

test('lint: id/retired red on fixture', () => {
  const r = locales({ retired: 'ch1.start.a002\n\n  ch1.old.q001  \nnot an id\n' });
  expect(at(r.findings, 'id/retired'), JSON.stringify(r.findings)).toEqual(['ch1/main.ink:5']);
  expect(at(r.findings, 'id/format')).toEqual(['retired-ids.txt:4']);
  expect(decodeRetired('ch1.start.a002\r\nch1.old.q001\r\n').ids).toEqual(new Set(['ch1.start.a002', 'ch1.old.q001']));
});

test('locales: matching tables raise nothing', () => {
  const r = locales();
  expect(r.findings).toEqual([]);
  expect(r.names).toEqual({
    chapters: { ch1: { ru: 'Глава 1', en: 'Chapter 1' }, ch2: { ru: 'Глава 2', en: 'Chapter 2' } },
    speakers: { ally: { ru: 'Подруга', en: 'Ally' }, stranger: { ru: 'Незнакомец', en: 'Stranger' }, voice: { ru: 'Голос', en: 'Voice' } },
  });
});

test('locales: malformed tables are findings, not throws', () => {
  const en = (text: string): string[] => at(decodeEnTable('locales/en/ch1.json', text).findings, 'loc/missing-en');
  expect(en('not json')).toEqual(['locales/en/ch1.json:0']);
  expect(en('[]')).toEqual(['locales/en/ch1.json:0']);
  expect(en('{\n  "ch1.start.a001": { "ru": 1 }\n}\n')).toEqual(['locales/en/ch1.json:2']);
  expect(en('{\n  "ch1.start.a001": { "ru": "a", "en": "b", "note": "c" }\n}\n')).toEqual(['locales/en/ch1.json:2']);
  expect(decodeEnTable('locales/en/ch1.json', 'not json').table.entries.size).toBe(0);
  const names = (text: string): string[] => decodeNameTable('locales/ru/story.json', text).findings.map((f) => `${f.code}:${f.line}`);
  expect(names('{')).toEqual(['loc/missing-name:0']);
  expect(names('{\n  "names": {},\n  "chapters": {},\n  "extra": 1\n}\n')).toEqual(['loc/missing-name:4']);
  expect(names('{\n  "names": [],\n  "chapters": {}\n}\n')).toEqual(['loc/missing-name:2']);
  // A malformed table is one file-level finding plus each line it fails to translate.
  const r = locales({ en: { ch1: 'not json', ch2: table(EN_CH2) } });
  expect(at(r.findings, 'loc/missing-en')).toEqual(['locales/en/ch1.json:0', 'ch1/main.ink:4', 'ch1/main.ink:5']);
});

test('fix: sync-locales adds new ids only', () => {
  const before = table({ 'ch1.start.zzzz': { ru: 'Удалено.', en: 'Removed.' }, 'ch1.start.a001': { ru: 'Старое.', en: 'Hi.' } });
  // a002 twice (a line and a duplicate of it): one entry.
  const r = syncLocales({ text: before }, [LOC_A001, LOC_A002, { ...LOC_A002, line: 9 }]);
  if (!('text' in r)) {
    throw new Error(`invariant: a valid table syncs: ${r.error}`);
  }
  expect(r.added).toEqual(['ch1.start.a002']);
  expect(r.text).toBe(
    table({
      'ch1.start.zzzz': { ru: 'Удалено.', en: 'Removed.' },
      'ch1.start.a001': { ru: 'Старое.', en: 'Hi.' },
      'ch1.start.a002': { ru: 'Пока.', en: '' },
    }),
  );
  expect(syncLocales({ text: null }, LOC_CH1)).toEqual({
    text: table({ 'ch1.start.a001': { ru: 'Привет.', en: '' }, 'ch1.start.a002': { ru: 'Пока.', en: '' } }),
    added: ['ch1.start.a001', 'ch1.start.a002'],
  });
  expect(syncLocales({ text: '[1]' }, LOC_CH1)).toHaveProperty('error');
  expect(syncLocales({ text: '{' }, LOC_CH1)).toHaveProperty('error');
});

// ---------------------------------------------------------------------------------------------------------------
// story.ts: spawned the way `npm run story` runs it, against a temporary repository (`--root`)

const CLIENT_DIR = fileURLToPath(new URL('../..', import.meta.url));
const STORY_SCRIPT = fileURLToPath(new URL('../story.ts', import.meta.url));
/** A spawned Node loads inkjs/full and compiles: allow for a loaded machine instead of retrying. */
const CLI_TIMEOUT_MS = 60_000;

const CH1_INK = [
  'INCLUDE ../common/globals.ink',
  '-> cafe',
  '=== cafe ===',
  '# scene: cafe',
  'ally: Привет. #id:ch1.cafe.a001',
  '* [Остаться. #id:ch1.cafe.a002]',
  '    ~ g_trust = 1',
  '    -> street',
  '* [Уйти. #id:ch1.cafe.a003]',
  '    -> street',
  '=== street ===',
  '# scene: street',
  'Улица. #id:ch1.street.a004',
  '-> END',
  '',
].join('\n');
const CH2_INK = [
  'INCLUDE ../common/globals.ink',
  '-> archive',
  '=== archive ===',
  '# scene: archive',
  '{ g_trust > 0:',
  '    ally: Спасибо. #id:ch2.archive.b001',
  '- else:',
  '    ally: Посмотрим. #id:ch2.archive.b002',
  '}',
  '-> END',
  '',
].join('\n');

/** The en tables of `repoFiles()`: ru is each line's displayed text. */
const REPO_EN_CH1 = {
  'ch1.cafe.a001': { ru: 'Привет.', en: 'Hi.' },
  'ch1.cafe.a002': { ru: 'Остаться.', en: 'Stay.' },
  'ch1.cafe.a003': { ru: 'Уйти.', en: 'Leave.' },
  'ch1.street.a004': { ru: 'Улица.', en: 'The street.' },
};
const REPO_EN_CH2 = { 'ch2.archive.b001': { ru: 'Спасибо.', en: 'Thanks.' }, 'ch2.archive.b002': { ru: 'Посмотрим.', en: "We'll see." } };
/** `REPO_EN_CH1` without the street line's entry. */
const EN_NO_STREET = Object.fromEntries(Object.entries(REPO_EN_CH1).filter(([id]) => id !== 'ch1.street.a004'));

/** The committed catalog and cast, a free ch1 and a paid ch2, and their locale tables: a clean, emitting repo. */
function repoFiles(): Record<string, string> {
  return {
    'assets/catalog.json': readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8'),
    'story/cast.json': readFileSync(new URL('../../../story/cast.json', import.meta.url), 'utf8'),
    'story/chapters.json': JSON.stringify([
      { id: 'ch1', entry: 'ch1/main.ink', paid: false, next: 'ch2' },
      { id: 'ch2', entry: 'ch2/main.ink', paid: true, productId: 'chapter:ch2', next: null },
    ]),
    'story/common/globals.ink': 'VAR g_trust = 0\n',
    'story/ch1/main.ink': CH1_INK,
    'story/ch2/main.ink': CH2_INK,
    'story/locales/en/ch1.json': table(REPO_EN_CH1),
    'story/locales/en/ch2.json': table(REPO_EN_CH2),
    'story/locales/ru/story.json': table(NAMES_RU),
    'story/locales/en/story.json': table(NAMES_EN),
  };
}

function put(root: string, rel: string, text: string): void {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function withRepo(files: Readonly<Record<string, string>>, body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'story-loc-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      put(root, rel, text);
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Every file under `rel` of the repo with its text, repo-relative posix keys, sorted. */
function treeOf(root: string, rel: string): Record<string, string> {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    return {};
  }
  const entries = readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .map((p) => [p.slice(root.length + 1).split('\\').join('/'), readFileSync(p, 'utf8')] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return Object.fromEntries(entries);
}

function runStory(root: string, args: readonly string[] = []): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [STORY_SCRIPT, '--root', root, ...args], { cwd: CLIENT_DIR, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const NO_STREET_ID = CH1_INK.replace('Улица. #id:ch1.street.a004', 'Улица.');

test(
  'story: --fix-ids writes ids then lints',
  () => {
    withRepo({ ...repoFiles(), 'story/ch1/main.ink': NO_STREET_ID }, (root) => {
      const r = runStory(root, ['--fix-ids']);
      expect(r.stdout, r.stdout + r.stderr).toMatch(/^fix-ids: 1 ids added in 1 files$/m);
      const text = readFileSync(join(root, 'story/ch1/main.ink'), 'utf8');
      const fixed = text.split('\n');
      expect(fixed[12]).toMatch(/^Улица\. #id:ch1\.street\.[0-9a-z]{4}$/);
      expect([...fixed.slice(0, 12), ...fixed.slice(13)]).toEqual([...NO_STREET_ID.split('\n').slice(0, 12), ...NO_STREET_ID.split('\n').slice(13)]);
      expect(r.stdout).not.toMatch(/ id\/missing /);
      expect(r.stdout).not.toMatch(/ id\/format /);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: the gate never rewrites story sources',
  () => {
    withRepo({ ...repoFiles(), 'story/ch1/main.ink': NO_STREET_ID }, (root) => {
      const before = treeOf(root, 'story');
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/^E story\/ch1\/main\.ink:13 id\/missing /m);
      expect(r.stdout).not.toMatch(/^fix-ids:/m);
      expect(treeOf(root, 'story')).toEqual(before);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: locale errors fail the gate',
  () => {
    withRepo({ ...repoFiles(), 'story/locales/en/ch1.json': table(EN_NO_STREET) }, (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/^E story\/ch1\/main\.ink:13 loc\/missing-en 'ch1\.street\.a004' has no entry in story\/locales\/en\/ch1\.json/m);
      expect(r.stdout).toMatch(/^story: 1 errors, 0 warnings$/m);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: --sync-locales adds entries then lints',
  () => {
    withRepo({ ...repoFiles(), 'story/locales/en/ch1.json': table(EN_NO_STREET) }, (root) => {
      const before = treeOf(root, 'story');
      const r = runStory(root, ['--sync-locales']);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/^sync-locales: ch1 \+1 entries$/m);
      expect(r.stdout).toMatch(/^sync-locales: ch2 \+0 entries$/m);
      expect(readFileSync(join(root, 'story/locales/en/ch1.json'), 'utf8')).toBe(table({ ...EN_NO_STREET, 'ch1.street.a004': { ru: 'Улица.', en: '' } }));
      // The new entry is the one finding: its en is empty, and nothing else moved.
      expect(r.stdout).toMatch(/^E story\/locales\/en\/ch1\.json:14 loc\/empty-en 'ch1\.street\.a004'/m);
      expect(r.stdout).not.toMatch(/ loc\/missing-en /);
      expect(r.stdout).toMatch(/^story: 1 errors, 0 warnings$/m);
      const after = treeOf(root, 'story');
      expect(Object.keys(after).filter((rel) => after[rel] !== before[rel])).toEqual(['story/locales/en/ch1.json']);
    });
  },
  CLI_TIMEOUT_MS,
);

test(
  'story: catalog names come from the locale tables',
  () => {
    withRepo(repoFiles(), (root) => {
      const r = runStory(root);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const catalog = decodeChapterCatalog(JSON.parse(readFileSync(join(root, 'client/src/story-gen/catalog.json'), 'utf8')));
      if (!catalog.ok) {
        throw new Error(`invariant: the emitted catalog decodes: ${JSON.stringify(catalog.error)}`);
      }
      expect(catalog.value.chapters.map((c) => [c.id, c.title])).toEqual([
        ['ch1', { ru: NAMES_RU.chapters.ch1, en: NAMES_EN.chapters.ch1 }],
        ['ch2', { ru: NAMES_RU.chapters.ch2, en: NAMES_EN.chapters.ch2 }],
      ]);
      expect(Object.fromEntries(Object.entries(catalog.value.cast).map(([speaker, entry]) => [speaker, entry.name]))).toEqual({
        ally: { ru: NAMES_RU.names.ally, en: NAMES_EN.names.ally },
        stranger: { ru: NAMES_RU.names.stranger, en: NAMES_EN.names.stranger },
        voice: { ru: NAMES_RU.names.voice, en: NAMES_EN.names.voice },
      });
    });
  },
  CLI_TIMEOUT_MS,
);
