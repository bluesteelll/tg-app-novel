// The story tool's localization side (STAGING-DSL §4, §11): `--fix-ids`, and the `story` CLI runs of this lane
// against a temporary repository (`--root`). Fixtures are inline ink; the catalog and cast are the committed ones.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog, decodeCast } from '../../src/story/catalog.ts';
import type { Cast } from '../../src/story/catalog.ts';
import type { AssetIndex, ChapterId } from '../../src/story/staging.ts';
import { LINE_ID_RE } from '../../src/story/tags.ts';
import { fixIds } from './fix.ts';
import type { FixIdsInput, IdTarget } from './fix.ts';
import { GLOBALS_PATH, lintSources } from './lint.ts';
import type { SourceChapter } from './lint.ts';

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

/** The committed catalog and cast, a free ch1 and a paid ch2. */
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
