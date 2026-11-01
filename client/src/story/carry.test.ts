// The carry between chapters (PROTOTYPE-PLAN K8, carry:51): what one chapter's runner leaves in its g_ globals is what
// the next chapter's branches read, with the declared types. Inline ink compiled by the story tool's compiler (any
// finding throws), each chapter with its own globals.ink text; metas hand-written and decoded.
import { expect, test } from 'vitest';

import { compileChapter } from '../../scripts/story/compile.ts';
import { GLOBALS_PATH } from '../../scripts/story/lint.ts';
import { carryInto, carryOut } from './carry.ts';
import { assetIndex, decodeAssetCatalog, decodeChapterMeta } from './catalog.ts';
import type { InkScalar, LoadedChapter, Result } from './catalog.ts';
import { StoryRunner } from './runner.ts';
import type { RunnerError, RunnerStep, StartPoint } from './runner.ts';
import type { AssetIndex, ChapterId, KnotName, VarName } from './staging.ts';

function literalAssets(): AssetIndex {
  const catalog = decodeAssetCatalog({ bg: {}, chars: {}, cg: {}, bgm: {}, sfx: {}, prop: {}, cover: {} });
  if (!catalog.ok) {
    throw new Error(`invariant: the literal catalog decodes: ${JSON.stringify(catalog.error)}`);
  }
  return assetIndex(catalog.value);
}

const ASSETS = literalAssets();

/** A loaded chapter `id` over `main` (after the globals INCLUDE) and `globals`, its knots and VARs as listed. */
function chapter(id: string, main: readonly string[], globals: string, o: { knots: string[]; globals: string[]; vars?: string[] }): LoadedChapter {
  const source = `${['INCLUDE ../common/globals.ink', ...main].join('\n')}\n`;
  const files = new Map([[GLOBALS_PATH, globals], [`${id}/main.ink`, source]]);
  const r = compileChapter({ id: id as ChapterId, paid: false, entry: `${id}/main.ink` }, (key) => files.get(key) ?? null);
  if (r.compiled === null) {
    throw new Error(`fixture does not compile: ${JSON.stringify(r.findings)}`);
  }
  const meta = decodeChapterMeta({
    chapterId: id,
    storyVersion: '0123456789abcdef',
    firstKnot: o.knots[0],
    globals: o.globals,
    vars: [...o.globals, ...(o.vars ?? [])],
    knots: Object.fromEntries(o.knots.map((k) => [k, { assets: [], next: [], ending: false }])),
    endings: {},
  });
  if (!meta.ok) {
    throw new Error(`fixture meta does not decode: ${JSON.stringify(meta.error)}`);
  }
  const ch = id as ChapterId; // the fixture ids match CHAPTER_ID_RE
  return { id: ch, story: JSON.parse(r.compiled.json) as unknown, meta: meta.value, assets: { chapterId: ch, assets: {} }, en: null, world: null };
}

function ok<T>(r: Result<T, RunnerError>): T {
  if (!r.ok) {
    throw new Error(`runner error ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** The first line a runner of `ch` started at `start` shows. */
function firstLine(ch: LoadedChapter, start: StartPoint): RunnerStep {
  const r = ok(StoryRunner.create(ch, start, ASSETS));
  const step = ok(r.next());
  r.dispose();
  return step;
}

test('carry: g_ vars carried', () => {
  // ch1's build still declares g_old; the story update that ch2 was built after removed it.
  const ch1 = chapter(
    'ch1',
    ['-> start', '=== start ===', 'Pick. #id:ch1.start.p001', '* [Set it. #id:ch1.start.p002]', '    ~ g_x = 1', '    -> END'],
    'VAR g_x = 0\nVAR g_old = 3\n',
    { knots: ['start'], globals: ['g_x', 'g_old'] },
  );
  const ch2 = chapter(
    'ch2',
    ['-> start', '=== start ===', '{ g_x == 1:', '    Was set. #id:ch2.start.p003', '- else:', '    Not set. #id:ch2.start.p004', '}', '-> END'],
    'VAR g_x = 0\n',
    { knots: ['start'], globals: ['g_x'] },
  );
  const r1 = ok(StoryRunner.create(ch1, { kind: 'fresh', carry: {} }, ASSETS));
  expect(ok(r1.next()).kind).toBe('line');
  expect(ok(r1.next()).kind).toBe('choices');
  ok(r1.choose(0));
  expect(ok(r1.next()).kind).toBe('end');
  const out = carryOut(r1, ch1.meta);
  r1.dispose();
  expect(out).toEqual({ g_x: 1, g_old: 3 });
  const into = carryInto(out, ch2.meta);
  expect(firstLine(ch2, { kind: 'fresh', carry: into })).toMatchObject({ kind: 'line', lineId: 'ch2.start.p003' });
  expect(into).toEqual({ g_x: 1 }); // g_old would be an undeclared VAR in ch2: a load error
});

test('carry: an integral value for a float global stays a float', () => {
  const globals = 'VAR g_ratio = 1.5\n';
  const ch1 = chapter('ch1', ['-> start', '=== start ===', '~ g_ratio = g_ratio + 0.5', 'Текст. #id:ch1.start.q001', '-> END'], globals, {
    knots: ['start'],
    globals: ['g_ratio'],
  });
  const ch2 = chapter(
    'ch2',
    [
      '-> start',
      '=== start ===',
      '{ g_ratio / 4 > 0.4:',
      '    -> half',
      '- else:',
      '    -> whole',
      '}',
      '=== half ===',
      'Половина. #id:ch2.half.q002',
      '-> END',
      '=== whole ===',
      'Целое. #id:ch2.whole.q003',
      '-> END',
    ],
    globals,
    { knots: ['start', 'half', 'whole'], globals: ['g_ratio'] },
  );
  const r1 = ok(StoryRunner.create(ch1, { kind: 'fresh', carry: {} }, ASSETS));
  ok(r1.next());
  const out = carryOut(r1, ch1.meta);
  r1.dispose();
  // 2.0 arrives as the JS number 2; an Int write would divide as integers (2 / 4 = 0) and route to `whole`.
  expect(out).toEqual({ g_ratio: 2 });
  expect(firstLine(ch2, { kind: 'fresh', carry: carryInto(out, ch2.meta) })).toMatchObject({ lineId: 'ch2.half.q002' });
  // The checkpoint start writes its VARs through the same helper.
  const vars = { g_ratio: 2 } as Readonly<Record<VarName, InkScalar>>;
  expect(firstLine(ch2, { kind: 'checkpoint', knot: 'start' as KnotName, vars })).toMatchObject({ lineId: 'ch2.half.q002' });
});

test('carry: a carried false or zero overrides a truthy default of the next chapter', () => {
  // The story lint admits any scalar default for a global; a falsy value left by ch1 is a value, not an absence.
  const globals = 'VAR g_alive = true\nVAR g_trust = 3\n';
  const ch1 = chapter('ch1', ['-> start', '=== start ===', '~ g_alive = false', '~ g_trust = 0', 'Текст. #id:ch1.start.r001', '-> END'], globals, {
    knots: ['start'],
    globals: ['g_alive', 'g_trust'],
  });
  const ch2 = chapter(
    'ch2',
    ['-> start', '=== start ===', '{ not g_alive && g_trust == 0:', '    Ушёл. #id:ch2.start.r002', '- else:', '    Остался. #id:ch2.start.r003', '}', '-> END'],
    globals,
    { knots: ['start'], globals: ['g_alive', 'g_trust'] },
  );
  const r1 = ok(StoryRunner.create(ch1, { kind: 'fresh', carry: {} }, ASSETS));
  expect(ok(r1.next()).kind).toBe('line');
  expect(ok(r1.next()).kind).toBe('end');
  const out = carryOut(r1, ch1.meta);
  r1.dispose();
  expect(out).toEqual({ g_alive: false, g_trust: 0 });
  const into = carryInto(out, ch2.meta);
  expect(into).toEqual({ g_alive: false, g_trust: 0 });
  expect(firstLine(ch2, { kind: 'fresh', carry: into })).toMatchObject({ kind: 'line', lineId: 'ch2.start.r002' });
});
