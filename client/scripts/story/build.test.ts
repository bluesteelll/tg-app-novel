// The story build: compile (inkjs compiler), knot graph, emit and the `story` CLI (STAGING-DSL §8-§11,
// PROTOTYPE-PLAN.md K9 and "Build outputs"). Fixtures are inline ink; the catalog and cast are the committed ones.
import { expect, test } from 'vitest';

import type { ChapterId } from '../../src/story/staging.ts';
import { compileChapter, resolveInclude } from './compile.ts';
import type { ReadInk } from './compile.ts';
import { GLOBALS_PATH } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';

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
