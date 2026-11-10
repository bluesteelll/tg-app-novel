import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { PIXI_ENV_SRCS, SKIP_PIXI_ENV } from '../src/scene/pixi-env.ts';
import { STEADY_CAP_BYTES } from '../src/scene/registry.ts';
import type { AssetCatalog, AssetEntry, HalfFile, ImageEntry } from '../src/story/catalog.ts';
import type { AssetId, ChapterId, TrackId } from '../src/story/staging.ts';
import { decodeAssetCatalog, decodeAssetManifest, decodeChapterMeta, decodeCoverManifest, urlPath } from './assets/manifest.ts';
import { ENGINE_SRC, LIMITS, evaluate, evaluateAssets, firstLineFiles, formatRows, readAssetInputs, readInputs } from './budget.ts';
import type { AssetInputs, BudgetInputs, ChapterInputs, DistFile, ManifestChunk, Row } from './budget.ts';
import { decodeChapterList, decodeStoryUsage } from './story/emit.ts';

/** The lazy family rows (PUZZLES-PLAN X14, "Budgets"). */
const LAZY_ROWS = ['puzzle-type chunk (br)', 'puzzle-host chunk (br)', 'explore-ui chunk (br)', 'cue-stage chunk (br)'];
/** The meta families' rows (META-PLAN M27, "Budgets"; RULINGS 105): app/meta.ts is their importer. */
const META_ROWS = ['meta-ui chunk (br)', 'meta controller chunk (br)'];

const ROW_NAMES = [
  'manifest',
  'entry closure JS (br)',
  'engine closure JS (br)',
  'JS before the first line (br)',
  ...LAZY_ROWS,
  ...META_ROWS,
  'all JS (br)',
  'CSS total (br)',
  'index.html (br)',
];

function file(path: string, brBytes: number): DistFile {
  return { path, rawBytes: brBytes * 3, brBytes };
}

/** A small, valid dist: entry + one shared chunk + CSS + html; no engine. Every row passes. */
function inputs(over: Partial<BudgetInputs> = {}): BudgetInputs {
  const manifest: Record<string, ManifestChunk> = {
    'index.html': {
      file: 'assets/index-a.js',
      src: 'index.html',
      isEntry: true,
      imports: ['_shared-b.js'],
      css: ['assets/index-c.css'],
    },
    '_shared-b.js': { file: 'assets/shared-b.js' },
  };
  return {
    manifest,
    manifestStale: false,
    indexHtml: '<script type="module" crossorigin src="/assets/index-a.js"></script>',
    files: [
      file('index.html', 400),
      file('.vite/manifest.json', 100),
      file('assets/index-a.js', 10_000),
      file('assets/shared-b.js', 2_000),
      file('assets/index-c.css', 200),
    ],
    engineSourceExists: false,
    yieldsSourceExists: false,
    metaSourceExists: false,
    lazySources: new Set(),
    facades: new Set(),
    pixiEnvSkipped: false,
    ...over,
  };
}

function rowOf(rows: readonly Row[], name: string): Row {
  const row = rows.find((r) => r.name === name);
  expect(row, `expected row ${name}`).toBeDefined();
  if (row === undefined) {
    throw new Error(`invariant: row ${name} checked above`);
  }
  return row;
}

/** Adds a dynamically imported engine chunk that statically imports a Pixi chunk and the entry's shared chunk. */
function withEngine(base: BudgetInputs, engineBr: number, pixiBr: number): BudgetInputs {
  const manifest = { ...base.manifest };
  const entry = manifest['index.html'];
  if (entry === undefined) {
    throw new Error('invariant: the base manifest has an entry');
  }
  manifest['index.html'] = { ...entry, dynamicImports: [ENGINE_SRC] };
  manifest[ENGINE_SRC] = {
    file: 'assets/engine-d.js',
    src: ENGINE_SRC,
    isDynamicEntry: true,
    imports: ['_shared-b.js', '_pixi-e.js'],
  };
  manifest['_pixi-e.js'] = { file: 'assets/pixi-e.js', imports: ['_shared-b.js'] };
  return {
    ...base,
    manifest,
    engineSourceExists: true,
    files: [...base.files, file('assets/engine-d.js', engineBr), file('assets/pixi-e.js', pixiBr)],
  };
}

/** Pixi's environment srcs as the manifest names them (pixi.js 8.22.0), spelled out: PIXI_ENV_SRCS is pinned on them. */
const BROWSER_ALL = 'node_modules/pixi.js/lib/environment-browser/browserAll.mjs';
const WEBWORKER_ALL = 'node_modules/pixi.js/lib/environment-webworker/webworkerAll.mjs';

/**
 * An engine of 200 000 B whose dynamic imports are Pixi's two environment chunks (dynamic entries, as Vite emits
 * them: browserAll 9 851, webworkerAll 120), both statically importing one `init` chunk (4 291) nothing else imports.
 */
function withPixiEnv(pixiEnvSkipped: boolean): BudgetInputs {
  const base = withEngine(inputs({ pixiEnvSkipped }), 20_000, 180_000);
  const manifest = { ...base.manifest };
  const engine = manifest[ENGINE_SRC];
  if (engine === undefined) {
    throw new Error('invariant: withEngine adds the engine chunk');
  }
  manifest[ENGINE_SRC] = { ...engine, dynamicImports: [BROWSER_ALL, WEBWORKER_ALL] };
  manifest[BROWSER_ALL] = { file: 'assets/browserAll-f.js', src: BROWSER_ALL, isDynamicEntry: true, imports: ['_init-g.js'] };
  manifest[WEBWORKER_ALL] = { file: 'assets/webworkerAll-h.js', src: WEBWORKER_ALL, isDynamicEntry: true, imports: ['_init-g.js'] };
  manifest['_init-g.js'] = { file: 'assets/init-g.js' };
  const env = [file('assets/browserAll-f.js', 9_851), file('assets/webworkerAll-h.js', 120), file('assets/init-g.js', 4_291)];
  return { ...base, manifest, files: [...base.files, ...env] };
}

const CODE_LOCK = 'src/puzzles/ui/CodeLock.svelte';
const ORDER = 'src/puzzles/ui/OrderPuzzle.svelte';
const HOST = 'src/ui/puzzles/PuzzleHost.svelte';
const CONTROLLER = 'src/explore/controller.ts';
const EXPLORE_VIEW = 'src/ui/explore/ExploreView.svelte';
const CUE_STAGE = 'src/cues/stage/index.ts';
const ALL_LAZY: ReadonlySet<string> = new Set([CODE_LOCK, ORDER, HOST, CONTROLLER, EXPLORE_VIEW, CUE_STAGE]);
const META_UI = 'src/ui/meta/index.ts';
const META_CTL = 'src/app/meta.ts';

/** One built lazy root: its JS chunk's brotli bytes, and its CSS file's if any. */
type LazyChunk = { js: number; css?: number };

/**
 * Adds each lazy root as a dynamic entry of the entry chunk (as Vite emits an `import()`'d module), importing the
 * entry's shared chunk; app/yields.ts exists and the roots' sources too, unless `over` says otherwise.
 */
function withLazy(base: BudgetInputs, chunks: Readonly<Record<string, LazyChunk>>, over: Partial<BudgetInputs> = {}): BudgetInputs {
  const manifest = { ...base.manifest };
  const entry = manifest['index.html'];
  if (entry === undefined) {
    throw new Error('invariant: the base manifest has an entry');
  }
  manifest['index.html'] = { ...entry, dynamicImports: [...(entry.dynamicImports ?? []), ...Object.keys(chunks)] };
  const files = [...base.files];
  for (const [src, size] of Object.entries(chunks)) {
    const stem = (src.split('/').pop() ?? src).replace(/\.\w+$/, '');
    const js = `assets/${stem}-z.js`;
    const css = size.css === undefined ? [] : [`assets/${stem}-z.css`];
    manifest[src] = { file: js, src, isDynamicEntry: true, imports: ['_shared-b.js'], css };
    files.push(file(js, size.js), ...css.map((c) => file(c, size.css ?? 0)));
  }
  return { ...base, manifest, files, yieldsSourceExists: true, lazySources: new Set(Object.keys(chunks)), ...over };
}

describe('budget evaluate', () => {
  test('budget: entry over limit fails', () => {
    const big = inputs();
    // 310 000 + 2 000 shared: over the entry's 40 KB and the 305 KB of all JS.
    big.files = big.files.map((f) => (f.path === 'assets/index-a.js' ? file(f.path, 310_000) : f));
    const rows = evaluate(big, LIMITS);
    const entry = rowOf(rows, 'entry closure JS (br)');
    expect(entry.status).toBe('FAIL');
    expect(entry.valueBytes).toBe(312_000);
    expect(rowOf(rows, 'all JS (br)').status).toBe('FAIL');
  });

  test('budget: engine row pending while engine source is absent', () => {
    const row = rowOf(evaluate(inputs(), LIMITS), 'engine closure JS (br)');
    expect(row.status).toBe('PENDING');
    expect(row.valueBytes).toBeNull();
    expect(row.note).toContain('src/app/engine.ts absent');
  });

  test('budget: engine row fails when dynamic entry missing', () => {
    // The engine exists, but nothing in the manifest is its dynamic entry: never a 0 KB PASS.
    const missing = rowOf(evaluate(inputs({ engineSourceExists: true }), LIMITS), 'engine closure JS (br)');
    expect(missing.status).toBe('FAIL');
    // Statically imported into the entry chunk instead of split off: still not a dynamic entry.
    const base = inputs({ engineSourceExists: true });
    const manifest = { ...base.manifest, [ENGINE_SRC]: { file: 'assets/engine-d.js', src: ENGINE_SRC } };
    const static_ = rowOf(
      evaluate({ ...base, manifest, files: [...base.files, file('assets/engine-d.js', 5_000)] }, LIMITS),
      'engine closure JS (br)',
    );
    expect(static_.status).toBe('FAIL');
  });

  test('budget: engine row measures the dynamic entry closure', () => {
    // 50 000 + 179 000 = 229 000 passes; counting the entry's shared chunk (2 000) again would fail.
    const rows = evaluate(withEngine(inputs(), 50_000, 179_000), LIMITS);
    const engine = rowOf(rows, 'engine closure JS (br)');
    expect(engine.valueBytes).toBe(229_000);
    expect(engine.status).toBe('PASS');
    expect(rowOf(rows, 'entry closure JS (br)').valueBytes).toBe(12_000);
  });

  test("budget: engine row counts the engine's dynamic imports", () => {
    // A chunk the engine imports dynamically on the way to the first line is part of its boot download (budget.ts's
    // basis note): Pixi's default Application.init() imports its environment chunk that way. These keys carry no src,
    // so no stop applies.
    const base = withEngine(inputs(), 20_000, 180_000);
    const manifest = { ...base.manifest };
    const engine = manifest[ENGINE_SRC];
    if (engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk');
    }
    manifest[ENGINE_SRC] = { ...engine, dynamicImports: ['_browserAll-f.js'] };
    manifest['_browserAll-f.js'] = {
      file: 'assets/browserAll-f.js',
      imports: ['_shared-b.js', '_pixi-e.js'],
      dynamicImports: ['_init-g.js'],
    };
    manifest['_init-g.js'] = { file: 'assets/init-g.js', imports: ['_pixi-e.js'], dynamicImports: [ENGINE_SRC] };
    const files = [...base.files, file('assets/browserAll-f.js', 30_000), file('assets/init-g.js', 10_000)];
    const rows = evaluate({ ...base, manifest, files }, LIMITS);
    const row = rowOf(rows, 'engine closure JS (br)');
    // 20 000 + 180 000 static, 30 000 + 10 000 dynamic; the entry's shared chunk (2 000) is still excluded.
    expect(row.status).toBe('FAIL');
    expect(row.valueBytes).toBe(240_000);
    expect(row.note).toContain('4 chunks');
    // The entry row stays static: the entry's dynamic import of the engine is not part of its first download.
    expect(rowOf(rows, 'entry closure JS (br)').valueBytes).toBe(12_000);
  });

  test("budget: the engine row stops at Pixi's environment chunks the scene skips", () => {
    // Under the skip no path requests them (the basis note): the engine's own 200 000 B, without 9 851 + 120 + 4 291.
    expect(rowOf(evaluate(withPixiEnv(true), LIMITS), 'engine closure JS (br)').valueBytes).toBe(200_000);
    expect(PIXI_ENV_SRCS).toEqual([BROWSER_ALL, WEBWORKER_ALL]);
  });

  test("budget: the engine row counts Pixi's environment chunks the scene imports", () => {
    // The fail-safe: with the flag off the walk follows the dynamic edges as before, 200 000 + 9 851 + 120 + 4 291.
    expect(rowOf(evaluate(withPixiEnv(false), LIMITS), 'engine closure JS (br)').valueBytes).toBe(214_262);
  });

  test("budget: the first-line files are the rows' own walk", () => {
    // The e2e's list of chunks a fresh start may request: entry 12 000 + engine, under the skip and without it.
    const cases: ReadonlyArray<readonly [boolean, number]> = [
      [true, 212_000],
      [false, 226_262],
    ];
    for (const [skipped, bytes] of cases) {
      const input = withPixiEnv(skipped);
      if (input.manifest === null) {
        throw new Error('invariant: withPixiEnv builds a manifest');
      }
      const sizes = new Map(input.files.map((f) => [f.path, f.brBytes]));
      const files = [...firstLineFiles(input.manifest, { pixiEnvSkipped: skipped })];
      expect(files.filter((f) => !sizes.has(f)), `skipped ${skipped}`).toEqual([]);
      const sum = files.reduce((s, f) => s + (sizes.get(f) ?? 0), 0);
      expect(sum, `skipped ${skipped}`).toBe(bytes);
      expect(rowOf(evaluate(input, LIMITS), 'JS before the first line (br)').valueBytes, `skipped ${skipped}`).toBe(sum);
      expect(files.includes('assets/browserAll-f.js'), `skipped ${skipped}`).toBe(!skipped);
    }
  });

  // The CLI reads whatever dist/ is on disk (hand-edited, interrupted, partly deleted): an edge or a file the engine
  // reaches but cannot measure would undercount its real download, so it fails instead of passing on fewer bytes.
  test('budget: engine row fails on a dangling dynamic import key', () => {
    const base = withEngine(inputs(), 20_000, 100_000);
    expect(rowOf(evaluate(base, LIMITS), 'engine closure JS (br)').status).toBe('PASS'); // control: 120 000 fits
    const manifest = { ...base.manifest };
    const engine = manifest[ENGINE_SRC];
    if (engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk');
    }
    manifest[ENGINE_SRC] = { ...engine, dynamicImports: ['_ghost-z.js'] };
    const row = rowOf(evaluate({ ...base, manifest }, LIMITS), 'engine closure JS (br)');
    expect(row.status).toBe('FAIL');
    expect(row.note).toContain('_ghost-z.js');
  });

  test('budget: engine row fails when a reached chunk has no file in dist', () => {
    const base = withEngine(inputs(), 20_000, 100_000);
    expect(rowOf(evaluate(base, LIMITS), 'engine closure JS (br)').status).toBe('PASS'); // control: 120 000 fits
    const files = base.files.filter((f) => f.path !== 'assets/pixi-e.js');
    const row = rowOf(evaluate({ ...base, files }, LIMITS), 'engine closure JS (br)');
    expect(row.status).toBe('FAIL');
    expect(row.note).toContain('assets/pixi-e.js');
  });

  test('budget: all js over limit fails', () => {
    // META-PLAN raised the limit to 305 KB br: 12 000 + 11 × 27 000 = 309 000 is over it.
    const base = inputs();
    const lazy = Array.from({ length: 11 }, (_, i) => file(`assets/lazy-${i}.js`, 27_000));
    const rows = evaluate({ ...base, files: [...base.files, ...lazy] }, LIMITS);
    expect(rowOf(rows, 'entry closure JS (br)').status).toBe('PASS');
    const all = rowOf(rows, 'all JS (br)');
    expect(all.valueBytes).toBe(309_000);
    expect(all.status).toBe('FAIL');
  });

  test('budget: js before the first line over limit fails', () => {
    // Entry 40 000 (10 000 + 2 000 shared + 28 000) + engine 231 000 = 271 000 > 270 000; lazy chunks never count.
    const base = withEngine(inputs(), 131_000, 100_000);
    const files = base.files.map((f) => (f.path === 'assets/index-a.js' ? file(f.path, 38_000) : f));
    const rows = evaluate({ ...base, files: [...files, file('assets/lazy-0.js', 9_000)] }, LIMITS);
    const first = rowOf(rows, 'JS before the first line (br)');
    expect(first.valueBytes).toBe(271_000);
    expect(first.status).toBe('FAIL');
    // Control: 1 000 less in the engine passes.
    const fits = withEngine(inputs(), 130_000, 100_000);
    const under = evaluate({ ...fits, files: fits.files.map((f) => (f.path === 'assets/index-a.js' ? file(f.path, 38_000) : f)) }, LIMITS);
    expect(rowOf(under, 'JS before the first line (br)')).toMatchObject({ valueBytes: 270_000, status: 'PASS' });
    // Engine source absent: the partial sum is PENDING, never a PASS; already over it FAILs.
    const partial = rowOf(evaluate(inputs(), LIMITS), 'JS before the first line (br)');
    expect(partial).toMatchObject({ status: 'PENDING', valueBytes: 12_000 });
    const big = inputs();
    big.files = big.files.map((f) => (f.path === 'assets/index-a.js' ? file(f.path, 300_000) : f));
    expect(rowOf(evaluate(big, LIMITS), 'JS before the first line (br)').status).toBe('FAIL');
  });

  test('budget: css over limit fails', () => {
    const base = inputs();
    const css = [file('assets/a.css', 7_000), file('assets/b.css', 7_000)];
    const files = [...base.files.filter((f) => !f.path.endsWith('.css')), ...css];
    const row = rowOf(evaluate({ ...base, files }, LIMITS), 'CSS total (br)');
    expect(row.valueBytes).toBe(14_000);
    expect(row.status).toBe('FAIL');
  });

  test('budget: index.html over limit fails', () => {
    const base = inputs();
    const files = base.files.map((f) => (f.path === 'index.html' ? file(f.path, 2_500) : f));
    expect(rowOf(evaluate({ ...base, files }, LIMITS), 'index.html (br)').status).toBe('FAIL');
    const noHtml = base.files.filter((f) => f.path !== 'index.html');
    expect(rowOf(evaluate({ ...base, files: noHtml }, LIMITS), 'index.html (br)').status).toBe('FAIL');
  });

  test('budget: missing manifest fails', () => {
    const rows = evaluate(inputs({ manifest: null }), LIMITS);
    expect(rowOf(rows, 'manifest').status).toBe('FAIL');
    expect(rowOf(rows, 'entry closure JS (br)').status).toBe('FAIL');
    const engine = rowOf(evaluate(inputs({ manifest: null, engineSourceExists: true }), LIMITS), 'engine closure JS (br)');
    expect(engine.status).toBe('FAIL');
  });

  test('budget: stale manifest fails', () => {
    // index.html from another build references an entry file this manifest does not name.
    const otherBuild = inputs({ indexHtml: '<script type="module" src="/assets/index-OLD.js"></script>' });
    expect(rowOf(evaluate(otherBuild, LIMITS), 'manifest').status).toBe('FAIL');
    expect(rowOf(evaluate(inputs({ manifestStale: true }), LIMITS), 'manifest').status).toBe('FAIL');
    // Control: the same inputs, fresh and consistent, pass.
    expect(rowOf(evaluate(inputs(), LIMITS), 'manifest').status).toBe('PASS');
  });

  test('budget: puzzle ui in engine closure fails', () => {
    // Control: CodeLock as its own dynamic entry (yields.ts's import()) is measured and passes.
    const base = withLazy(withEngine(inputs(), 50_000, 100_000), { [CODE_LOCK]: { js: 3_000 } });
    expect(rowOf(evaluate(base, LIMITS), 'puzzle-type chunk (br)')).toMatchObject({ status: 'PASS', valueBytes: 3_000 });
    // Also statically imported by app/engine.ts: it loads before the first line, whatever its own size.
    const manifest = { ...base.manifest };
    const engine = manifest[ENGINE_SRC];
    if (engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk');
    }
    manifest[ENGINE_SRC] = { ...engine, imports: [...(engine.imports ?? []), CODE_LOCK] };
    const row = rowOf(evaluate({ ...base, manifest }, LIMITS), 'puzzle-type chunk (br)');
    expect(row.status).toBe('FAIL');
    expect(row.note).toContain(`${CODE_LOCK} is in the engine closure`);
    // The same through the entry's static closure.
    const fromEntry = { ...base.manifest };
    const entry = fromEntry['index.html'];
    if (entry === undefined) {
      throw new Error('invariant: the base manifest has an entry');
    }
    fromEntry['index.html'] = { ...entry, imports: [...(entry.imports ?? []), CODE_LOCK] };
    const entryRow = rowOf(evaluate({ ...base, manifest: fromEntry }, LIMITS), 'puzzle-type chunk (br)');
    expect(entryRow.status).toBe('FAIL');
    expect(entryRow.note).toContain(`${CODE_LOCK} is in the entry static closure`);
  });

  test('budget: a lazy root behind a facade in the engine closure fails', () => {
    // RULINGS 92: a static import of a lazy root moves its code into a closure chunk, and Rolldown keeps the root's
    // dynamic entry as a re-export facade over it (the L15 probe: 0.1 KB, a false PASS).
    const facade = 'assets/PuzzleHost-f.js';
    const split = '_PuzzleHost-s.js';
    const base = withLazy(withEngine(inputs(), 50_000, 100_000), { [HOST]: { js: 100 } });
    const manifest = { ...base.manifest };
    const engine = manifest[ENGINE_SRC];
    const entry = manifest['index.html'];
    if (engine === undefined || entry === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk to the base entry');
    }
    manifest[HOST] = { file: facade, src: HOST, isDynamicEntry: true, imports: [split] };
    manifest[split] = { file: 'assets/PuzzleHost-s.js' };
    const files = [...base.files.filter((f) => f.path !== 'assets/PuzzleHost-z.js'), file(facade, 100), file('assets/PuzzleHost-s.js', 2_500)];
    const facades = new Set([facade]);
    const host = (over: Partial<BudgetInputs>): Row => rowOf(evaluate({ ...base, manifest, files, facades, ...over }, LIMITS), 'puzzle-host chunk (br)');
    // The engine imports the chunk that holds the root's code: it loads before the first line.
    const inEngine = { ...manifest, [ENGINE_SRC]: { ...engine, imports: [...(engine.imports ?? []), split] } };
    const row = host({ manifest: inEngine });
    expect(row.status).toBe('FAIL');
    expect(row.note).toBe(
      `${HOST}: its dynamic entry ${facade} only re-exports assets/PuzzleHost-s.js, which the engine closure loads before the first line (a static import of the root?)`,
    );
    // The same through the entry's static closure.
    const inEntry = { ...manifest, 'index.html': { ...entry, imports: [...(entry.imports ?? []), split] } };
    expect(host({ manifest: inEntry })).toMatchObject({
      status: 'FAIL',
      note: `${HOST}: its dynamic entry ${facade} only re-exports assets/PuzzleHost-s.js, which the entry static closure loads before the first line (a static import of the root?)`,
    });
    // Control: a facade over a chunk outside both closures (two lazy roots sharing code) is measured as today.
    expect(host({})).toMatchObject({ status: 'PASS', valueBytes: 2_600 });
    // Control: a root chunk with code of its own that imports an engine chunk keeps today's meaning.
    expect(host({ manifest: inEngine, facades: new Set() })).toMatchObject({ status: 'PASS', valueBytes: 100 });
  });

  test('budget: lazy row pending until its importer exists', () => {
    // Every lazy source present, no app/yields.ts, no dynamic entries (nothing imports them yet: W7).
    const rows = evaluate(inputs({ lazySources: ALL_LAZY }), LIMITS);
    for (const name of LAZY_ROWS) {
      expect(rowOf(rows, name), name).toMatchObject({ status: 'PENDING', valueBytes: null, note: 'src/app/yields.ts absent' });
    }
    // Built chunks change nothing while the importer is absent.
    const built = evaluate(withLazy(inputs(), { [CODE_LOCK]: { js: 9_000 } }, { yieldsSourceExists: false }), LIMITS);
    expect(rowOf(built, 'puzzle-type chunk (br)').status).toBe('PENDING');
  });

  test('budget: lazy row fails without dynamic entry once its importer exists', () => {
    const rows = evaluate(inputs({ yieldsSourceExists: true, lazySources: ALL_LAZY }), LIMITS);
    for (const name of LAZY_ROWS) {
      const row = rowOf(rows, name);
      expect(row.status, name).toBe('FAIL');
      expect(row.note, name).toContain('no dynamic entry for src/');
    }
    // A root merged into another chunk (in the manifest, not a dynamic entry) has no chunk of its own either.
    const base = inputs({ yieldsSourceExists: true, lazySources: new Set([HOST]) });
    const merged = { ...base.manifest, [HOST]: { file: 'assets/shared-b.js', src: HOST } };
    expect(rowOf(evaluate({ ...base, manifest: merged }, LIMITS), 'puzzle-host chunk (br)').status).toBe('FAIL');
    // A family whose sources are absent stays PENDING (the explore UI before LX).
    const puzzlesOnly = evaluate(withLazy(inputs(), { [CODE_LOCK]: { js: 2_000 }, [ORDER]: { js: 2_000 }, [HOST]: { js: 4_000 } }), LIMITS);
    expect(rowOf(puzzlesOnly, 'explore-ui chunk (br)')).toMatchObject({ status: 'PENDING', valueBytes: null });
    expect(rowOf(puzzlesOnly, 'puzzle-host chunk (br)')).toMatchObject({ status: 'PASS', valueBytes: 4_000 });
    // No manifest: the importer exists, so nothing can be measured.
    expect(rowOf(evaluate(inputs({ manifest: null, yieldsSourceExists: true, lazySources: ALL_LAZY }), LIMITS), 'puzzle-type chunk (br)').status).toBe('FAIL');
  });

  test('budget: lazy chunk over its limit fails', () => {
    const row = (name: string, chunks: Readonly<Record<string, LazyChunk>>): Row => rowOf(evaluate(withLazy(inputs(), chunks), LIMITS), name);
    // PZ "Red once": a 9 KB br type chunk fails; each type is its own chunk, so the largest decides (8 KB passes).
    expect(row('puzzle-type chunk (br)', { [CODE_LOCK]: { js: 9_000 }, [ORDER]: { js: 2_000 } })).toMatchObject({ status: 'FAIL', valueBytes: 9_000 });
    expect(row('puzzle-type chunk (br)', { [CODE_LOCK]: { js: 8_000 }, [ORDER]: { js: 8_000 } })).toMatchObject({ status: 'PASS', valueBytes: 8_000 });
    // JS + CSS; the entry's shared chunk it imports is downloaded already and not counted.
    expect(row('puzzle-type chunk (br)', { [ORDER]: { js: 7_500, css: 600 } })).toMatchObject({ status: 'FAIL', valueBytes: 8_100 });
    expect(row('puzzle-host chunk (br)', { [HOST]: { js: 10_100 } })).toMatchObject({ status: 'FAIL', valueBytes: 10_100 });
    expect(row('puzzle-host chunk (br)', { [HOST]: { js: 10_000 } }).status).toBe('PASS');
    // The explore UI is one family: its roots' union counts.
    expect(row('explore-ui chunk (br)', { [CONTROLLER]: { js: 8_100 }, [EXPLORE_VIEW]: { js: 8_000 } })).toMatchObject({ status: 'FAIL', valueBytes: 16_100 });
    expect(row('explore-ui chunk (br)', { [CONTROLLER]: { js: 8_000 }, [EXPLORE_VIEW]: { js: 8_000 } }).status).toBe('PASS');
    // A chunk the row reaches but dist lacks fails instead of measuring fewer bytes.
    const base = withLazy(inputs(), { [HOST]: { js: 4_000 } });
    const files = base.files.filter((f) => f.path !== 'assets/PuzzleHost-z.js');
    const gone = rowOf(evaluate({ ...base, files }, LIMITS), 'puzzle-host chunk (br)');
    expect(gone.status).toBe('FAIL');
    expect(gone.note).toContain('assets/PuzzleHost-z.js');
  });

  test('budget: the cue-stage family is measured and refused over its limit', () => {
    // Engine plan §11: the cue stage is its own lazy family, which app/yields.ts import()s (GM3s).
    const row = (b: BudgetInputs): Row => rowOf(evaluate(b, LIMITS), 'cue-stage chunk (br)');
    // The importer exists and the root's source does not (before the stage lands): PENDING, never a 0 KB PASS.
    expect(row(inputs({ yieldsSourceExists: true, lazySources: new Set([HOST]) }))).toMatchObject({
      status: 'PENDING',
      valueBytes: null,
      note: `no source of ${CUE_STAGE}`,
    });
    // Its own dynamic chunk, JS and CSS beyond the entry, against 8.5 KB (RULINGS 201).
    expect(LIMITS.cueStageChunkBr).toBe(8_500);
    expect(row(withLazy(inputs(), { [CUE_STAGE]: { js: 3_000, css: 300 } }))).toMatchObject({
      status: 'PASS',
      valueBytes: 3_300,
      limitBytes: LIMITS.cueStageChunkBr,
    });
    expect(row(withLazy(inputs(), { [CUE_STAGE]: { js: 8_500 } }))).toMatchObject({ status: 'PASS', valueBytes: 8_500 });
    expect(row(withLazy(inputs(), { [CUE_STAGE]: { js: 8_501 } }))).toMatchObject({ status: 'FAIL', valueBytes: 8_501 });
    // The engine reaches it by import() only: the engine row does not count it (nor a chunk split off its directory),
    // its own row does, without the Pixi chunk the engine already loaded.
    const base = withEngine(inputs(), 50_000, 179_000);
    const manifest = { ...base.manifest };
    const engine = manifest[ENGINE_SRC];
    if (engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk');
    }
    const player = 'src/cues/stage/player.ts';
    manifest[ENGINE_SRC] = { ...engine, dynamicImports: [CUE_STAGE, player] };
    manifest[CUE_STAGE] = { file: 'assets/index-s.js', src: CUE_STAGE, isDynamicEntry: true, imports: ['_pixi-e.js'] };
    manifest[player] = { file: 'assets/player-s.js', src: player, isDynamicEntry: true };
    const files = [...base.files, file('assets/index-s.js', 3_000), file('assets/player-s.js', 1_000)];
    const rows = evaluate({ ...base, manifest, files, yieldsSourceExists: true, lazySources: new Set([CUE_STAGE]) }, LIMITS);
    expect(rowOf(rows, 'engine closure JS (br)')).toMatchObject({ status: 'PASS', valueBytes: 229_000 });
    expect(rowOf(rows, 'cue-stage chunk (br)')).toMatchObject({ status: 'PASS', valueBytes: 3_000 });
  });

  test('budget: engine row excludes the lazy chunks', () => {
    // yields.ts lives in the engine closure and import()s the lazy families: those load after the first line.
    const base = withEngine(inputs(), 50_000, 179_000);
    const manifest = { ...base.manifest };
    const engine = manifest[ENGINE_SRC];
    if (engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk');
    }
    const panel = 'src/ui/explore/LockPanel.svelte';
    manifest[ENGINE_SRC] = { ...engine, dynamicImports: [CODE_LOCK, panel] };
    manifest[CODE_LOCK] = { file: 'assets/CodeLock-z.js', src: CODE_LOCK, isDynamicEntry: true, imports: ['_pixi-e.js'] };
    manifest[panel] = { file: 'assets/LockPanel-z.js', src: panel, isDynamicEntry: true };
    const files = [...base.files, file('assets/CodeLock-z.js', 5_000), file('assets/LockPanel-z.js', 3_000)];
    const rows = evaluate({ ...base, manifest, files, yieldsSourceExists: true, lazySources: new Set([CODE_LOCK]) }, LIMITS);
    // 50 000 + 179 000 as without them; a lazy-directory chunk that is no listed root is not counted either.
    expect(rowOf(rows, 'engine closure JS (br)')).toMatchObject({ status: 'PASS', valueBytes: 229_000 });
    expect(rowOf(rows, 'JS before the first line (br)').valueBytes).toBe(12_000 + 229_000);
    // The lazy row measures the chunk, without the Pixi chunk the engine already loaded.
    expect(rowOf(rows, 'puzzle-type chunk (br)')).toMatchObject({ status: 'PASS', valueBytes: 5_000 });
    // First-load to the first line counts the same JS.
    const plain = assetRows(assetInputs(), withEngine(inputs(), 50_000, 179_000));
    const lazy = assetRows(assetInputs(), { ...base, manifest, files });
    expect(rowOf(lazy, 'first-load ch1').valueBytes).toBe(rowOf(plain, 'first-load ch1').valueBytes);
  });

  test('budget: meta ui in entry closure fails', () => {
    // META M27: the overlays are a dynamic chunk of their own; the M1 facade rule applies to them unchanged.
    const base = withLazy(inputs(), { [META_UI]: { js: 6_000, css: 1_200 } }, { metaSourceExists: true });
    const row = (b: BudgetInputs): Row => rowOf(evaluate(b, LIMITS), 'meta-ui chunk (br)');
    // Control: its own dynamic chunk, JS and CSS beyond the entry.
    expect(row(base)).toMatchObject({ status: 'PASS', valueBytes: 7_200 });
    const manifest = { ...base.manifest };
    const entry = manifest['index.html'];
    if (entry === undefined) {
      throw new Error('invariant: the base manifest has an entry');
    }
    // The entry imports the overlays statically as well: they load before the first line.
    const inEntry = { ...manifest, 'index.html': { ...entry, imports: [...(entry.imports ?? []), META_UI] } };
    expect(row({ ...base, manifest: inEntry })).toMatchObject({ status: 'FAIL', note: `${META_UI} is in the entry static closure` });
    // A static import moved the code into an entry chunk, and the dynamic entry is a facade over it (RULINGS 92).
    const facade = 'assets/index-f.js';
    const overEntry = { ...manifest, [META_UI]: { file: facade, src: META_UI, isDynamicEntry: true, imports: ['_shared-b.js'] } };
    expect(row({ ...base, manifest: overEntry, files: [...base.files, file(facade, 60)], facades: new Set([facade]) })).toMatchObject({
      status: 'FAIL',
      note: `${META_UI}: its dynamic entry ${facade} only re-exports assets/shared-b.js, which the entry static closure loads before the first line (a static import of the root?)`,
    });
  });

  test('budget: meta row pending until its importer exists', () => {
    // Both roots built, but no app/meta.ts: PENDING, as the lazy rows without app/yields.ts (W7).
    const built = evaluate(withLazy(inputs(), { [META_UI]: { js: 6_000 }, [META_CTL]: { js: 3_500 } }, { metaSourceExists: false }), LIMITS);
    for (const name of META_ROWS) {
      expect(rowOf(built, name), name).toMatchObject({ status: 'PENDING', valueBytes: null, note: 'src/app/meta.ts absent' });
    }
    // The importer exists and nothing is a dynamic entry: FAIL, never a 0 KB PASS; the yields' rows do not follow it.
    const rows = evaluate(inputs({ metaSourceExists: true, lazySources: new Set([META_UI, META_CTL]) }), LIMITS);
    for (const name of META_ROWS) {
      const row = rowOf(rows, name);
      expect(row.status, name).toBe('FAIL');
      expect(row.note, name).toContain('no dynamic entry for src/');
    }
    for (const name of LAZY_ROWS) {
      expect(rowOf(rows, name).status, name).toBe('PENDING');
    }
  });

  /**
   * The built topology (the lever probe's manifest): the engine and the controller import the entry, the entry
   * import()s both, and the controller import()s the overlays.
   */
  function withMeta(controllerBr: number, uiBr: number): BudgetInputs {
    const base = withEngine(inputs(), 50_000, 100_000);
    const manifest = { ...base.manifest };
    const entry = manifest['index.html'];
    const engine = manifest[ENGINE_SRC];
    if (entry === undefined || engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk to the base entry');
    }
    manifest['index.html'] = { ...entry, dynamicImports: [ENGINE_SRC, META_CTL] };
    manifest[ENGINE_SRC] = { ...engine, imports: ['index.html', ...(engine.imports ?? [])] };
    manifest[META_CTL] = { file: 'assets/meta-m.js', src: META_CTL, isDynamicEntry: true, imports: ['index.html'], dynamicImports: [META_UI] };
    manifest[META_UI] = { file: 'assets/meta-u.js', src: META_UI, isDynamicEntry: true, imports: ['index.html'] };
    return {
      ...base,
      manifest,
      files: [...base.files, file('assets/meta-m.js', controllerBr), file('assets/meta-u.js', uiBr)],
      metaSourceExists: true,
      lazySources: new Set([META_CTL, META_UI]),
    };
  }

  test('budget: meta controller chunk outside the first line', () => {
    // RULINGS 149 (LFL): the controller's chunk is requested at the session's first step, a meta tap, an ending, a
    // launch parameter or Home idle, never on the path that taps Start as soon as it can. The first-line row is the
    // entry and engine closures; the controller is counted once, through its own row, and the overlays it import()s
    // load later. Neither is the engine's.
    const rows = evaluate(withMeta(3_500, 6_000), LIMITS);
    expect(rowOf(rows, 'engine closure JS (br)')).toMatchObject({ status: 'PASS', valueBytes: 150_000 });
    expect(rowOf(rows, 'JS before the first line (br)').valueBytes).toBe(12_000 + 150_000);
    expect(rowOf(rows, 'JS before the first line (br)').note).toBe('entry + engine closures');
    expect(rowOf(rows, 'meta controller chunk (br)')).toMatchObject({ status: 'PASS', valueBytes: 3_500 });
    expect(rowOf(rows, 'meta-ui chunk (br)')).toMatchObject({ status: 'PASS', valueBytes: 6_000 });
    // First-load to the first line counts neither.
    const plain = assetRows(assetInputs(), withEngine(inputs(), 50_000, 100_000));
    const meta = assetRows(assetInputs(), withMeta(3_500, 6_000));
    expect((rowOf(meta, 'first-load ch1').valueBytes ?? 0) - (rowOf(plain, 'first-load ch1').valueBytes ?? 0)).toBe(0);
    // The limit: 6.0 KB br.
    expect(rowOf(evaluate(withMeta(6_000, 6_000), LIMITS), 'meta controller chunk (br)').status).toBe('PASS');
    expect(rowOf(evaluate(withMeta(6_001, 6_000), LIMITS), 'meta controller chunk (br)').status).toBe('FAIL');
  });

  test('budget: meta controller imported statically fails', () => {
    const base = withMeta(3_500, 6_000);
    const row = (b: BudgetInputs): Row => rowOf(evaluate(b, LIMITS), 'meta controller chunk (br)');
    // Control: its own dynamic chunk.
    expect(row(base)).toMatchObject({ status: 'PASS', valueBytes: 3_500 });
    // Merged into the entry: no chunk of its own, so a FAIL, never a 0 KB PASS (RULINGS 105 point 3's guard).
    const { [META_CTL]: _merged, ...rest } = base.manifest ?? {};
    const entry = rest['index.html'];
    if (entry === undefined) {
      throw new Error('invariant: the base manifest has an entry');
    }
    const merged = { ...rest, 'index.html': { ...entry, dynamicImports: [ENGINE_SRC] } };
    expect(row({ ...base, manifest: merged })).toMatchObject({ status: 'FAIL', note: `no dynamic entry for ${META_CTL}` });
    // Imported as a value too: the dynamic entry is a facade over the entry chunk that holds the code.
    const facade = 'assets/meta-m.js';
    const overEntry = { ...base.manifest, [META_CTL]: { file: facade, src: META_CTL, isDynamicEntry: true, imports: ['index.html'] } };
    expect(row({ ...base, manifest: overEntry, facades: new Set([facade]) })).toMatchObject({
      status: 'FAIL',
      note: `${META_CTL}: its dynamic entry ${facade} only re-exports assets/index-a.js, which the entry static closure loads before the first line (a static import of the root?)`,
    });
  });

  test('budget: all js limit is 305 KB', () => {
    // META-PLAN "Budgets": 290 KB br plus the meta chunks.
    const base = inputs(); // 12 000 B of JS
    const all = (bytes: number): Row => rowOf(evaluate({ ...base, files: [...base.files, file('assets/lazy-0.js', bytes - 12_000)] }, LIMITS), 'all JS (br)');
    expect(all(300_000).status).toBe('PASS');
    expect(all(305_000)).toMatchObject({ status: 'PASS', valueBytes: 305_000 });
    expect(all(305_001).status).toBe('FAIL');
  });

  test('budget: every row is printed', () => {
    // A failing manifest does not stop later rows (no bail). PENDING: the engine row, the first-line row while the
    // engine is absent, the four lazy rows while app/yields.ts is, and the two meta rows while app/meta.ts is; with no
    // manifest the first-line row FAILs.
    const cases: ReadonlyArray<readonly [BudgetInputs, number]> = [
      [inputs(), 8],
      [inputs({ manifest: null }), 7],
    ];
    for (const [input, pendingRows] of cases) {
      const rows = evaluate(input, LIMITS);
      expect(rows.map((r) => r.name)).toEqual(ROW_NAMES);
      const text = formatRows(rows);
      for (const name of ROW_NAMES) {
        expect(text).toContain(`${name} |`);
      }
      const fail = rows.filter((r) => r.status === 'FAIL').length;
      const pass = rows.filter((r) => r.status === 'PASS').length;
      expect(text).toContain(`budget: ${rows.length} rows, ${pass} PASS, ${fail} FAIL, ${pendingRows} PENDING`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CLI: spawned the way `npm run build` runs it (Node type stripping), on a synthetic dist in a temp dir.

const CLIENT_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./budget.ts', import.meta.url));
/** A test that spawns the CLI: the 5 s default tripped under load (RULINGS 45: 6.3 s at 93 % CPU). */
const CLI_TIMEOUT_MS = 30_000;

/** Deterministic, incompressible bytes (mulberry32): brotli cannot shrink them, so raw size = budget size. */
function noise(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let a = seed >>> 0;
  for (let i = 0; i < length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (t ^ (t >>> 14)) & 0xff;
  }
  return out;
}

/**
 * A dist the way vite writes it. The manifest carries the engine as a dynamic entry, so the engine row is
 * PENDING while src/app/engine.ts does not exist and PASS once it does: either way this fixture cannot FAIL on
 * repository state.
 */
function writeDist(dir: string, entry: Uint8Array | string): void {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  mkdirSync(join(dir, '.vite'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'index-a.js'), entry);
  writeFileSync(join(dir, 'assets', 'engine-b.js'), 'export const createGame = () => 1;\n');
  writeFileSync(join(dir, 'assets', 'index-c.css'), 'body{margin:0}\n');
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head><script type="module" src="/assets/index-a.js"></script>' +
      '<link rel="stylesheet" href="/assets/index-c.css"></head><body><div id="app"></div></body></html>\n',
  );
  const manifest = {
    'index.html': {
      file: 'assets/index-a.js',
      src: 'index.html',
      isEntry: true,
      dynamicImports: [ENGINE_SRC],
      css: ['assets/index-c.css'],
    },
    [ENGINE_SRC]: { file: 'assets/engine-b.js', src: ENGINE_SRC, isDynamicEntry: true },
  };
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function runCli(
  dist: string,
  script = SCRIPT,
  nodeArgs: readonly string[] = [],
  args: readonly string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [...nodeArgs, script, '--dist', dist, ...args], { cwd: CLIENT_DIR, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('budget cli', () => {
  let tmp = '';
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'budget-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // The asset rows read the repository at --root: a synthetic one keeps these tests independent of repo state.

  test('budget: cli exits 1 on oversize dist', () => {
    const dist = join(tmp, 'dist');
    writeDist(dist, noise(310_000, 42)); // over the 305 KB of all JS too
    writeRepo(join(tmp, 'repo'), { bgWidth: 4096 });
    const r = runCli(dist, SCRIPT, [], ['--root', join(tmp, 'repo')]);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^entry closure JS \(br\) \| 310\.\d KB \| 40\.0 KB \| FAIL/m);
    expect(r.stdout).toMatch(/^all JS \(br\) \| .* \| FAIL/m);
    expect(r.stdout).toMatch(/^image bg\/cafe \| .* \| FAIL \| 4096×2048 over 2048 px/m);
    for (const name of ROW_NAMES) {
      expect(r.stdout).toContain(`${name} |`);
    }
  }, CLI_TIMEOUT_MS);

  test('budget: cli exits 0 on a small dist', () => {
    const dist = join(tmp, 'dist');
    writeDist(dist, 'export const main = 1;\n');
    writeRepo(join(tmp, 'repo'));
    const r = runCli(dist, SCRIPT, [], ['--root', join(tmp, 'repo')]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^manifest \| — \| — \| PASS/m);
    expect(r.stdout).toMatch(/^engine closure JS \(br\) \| .* \| (PENDING|PASS)/m);
    // The lazy rows read --root's client/: no app/yields.ts there, so PENDING whatever this repository holds.
    expect(r.stdout).toContain('puzzle-type chunk (br) | — | 8.0 KB | PENDING | src/app/yields.ts absent');
    expect(r.stdout).toContain('puzzle-host chunk (br) | — | 10.0 KB | PENDING | src/app/yields.ts absent');
    expect(r.stdout).toContain('explore-ui chunk (br) | — | 16.0 KB | PENDING | src/app/yields.ts absent');
    expect(r.stdout).toContain('cue-stage chunk (br) | — | 8.5 KB | PENDING | src/app/yields.ts absent');
    expect(r.stdout).toContain('meta-ui chunk (br) | — | 14.0 KB | PENDING | src/app/meta.ts absent');
    expect(r.stdout).toContain('meta controller chunk (br) | — | 6.0 KB | PENDING | src/app/meta.ts absent');
    expect(r.stdout).toMatch(/^budget: \d+ rows, \d+ PASS, 0 FAIL, \d+ PENDING$/m);
  }, CLI_TIMEOUT_MS);

  test('budget: the reader marks re-export-only chunks as facades', () => {
    // The PuzzleHost dynamic entry of the C1 probe build (fbcfd38, PuzzleHost.svelte also imported statically).
    const probe = 'export{n as default}from"./engine-CvlDvfLE.js";';
    const dist = join(tmp, 'dist');
    writeDist(dist, 'export const main = 1;\n');
    const put = (name: string, text: string): void => writeFileSync(join(dist, 'assets', name), text);
    put('facade-f.js', probe);
    put('facade-c.js', `/* a banner */\n${probe}\n`);
    put('facade-i.js', 'import{t as e}from"./shared-s.js";\nexport{e as default};\n');
    put('real-r.js', 'import{t as e}from"./shared-s.js";function o(n){return e(n)+1}export{o as run};\n');
    put('empty-e.js', '');
    const { inputs: read } = readInputs(dist, tmp);
    expect(read.facades).toEqual(new Set(['assets/facade-c.js', 'assets/facade-f.js', 'assets/facade-i.js']));
  });

  test("budget: the cli reads the scene's Pixi environment flag", () => {
    // The rows stop at Pixi's environment chunks only while the scene itself skips them: the CLI reads its flag.
    const dist = join(tmp, 'dist');
    writeDist(dist, 'export const main = 1;\n');
    expect(readInputs(dist, tmp).inputs.pixiEnvSkipped).toBe(SKIP_PIXI_ENV);
  });

  test('budget: cli runs through a linked path', () => {
    // Node runs the main module from its realpath while argv[1] keeps the caller's spelling (a junction, macOS's
    // symlinked /tmp): a guard that compares the two spellings skips main() and exits 0 without a word.
    const link = join(tmp, 'scripts');
    symlinkSync(dirname(SCRIPT), link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const r = runCli(join(tmp, 'no-such-dist'), join(link, 'budget.ts'));
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stderr).toMatch(/does not exist/);
    } finally {
      unlinkSync(link); // the link only: afterEach's recursive delete never meets a way into client/scripts
    }
  }, CLI_TIMEOUT_MS);

  test('budget: cli runs through a linked path under preserve-symlinks-main', () => {
    // With the flag (also reachable through NODE_OPTIONS) Node keeps the link's spelling in import.meta.url while the
    // guard canonicalises argv[1]: the guard must canonicalise its own side too, or main() is skipped and exits 0.
    const link = join(tmp, 'scripts');
    symlinkSync(dirname(SCRIPT), link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const r = runCli(join(tmp, 'no-such-dist'), join(link, 'budget.ts'), ['--preserve-symlinks-main']);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stderr).toMatch(/does not exist/);
    } finally {
      unlinkSync(link); // the link only: afterEach's recursive delete never meets a way into client/scripts
    }
  }, CLI_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------------------------
// L5: the asset rows. In-process on hand-built inputs (every value decoded through the real decoders), and through
// the reader and the CLI on a synthetic repository.

const MIB = 1_048_576;

function decodedOrThrow<T>(r: { ok: true; value: T } | { ok: false; error: unknown }, what: string): T {
  if (!r.ok) {
    throw new Error(`invariant: the ${what} fixture decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** An image entry; `name` is the file stem, the URL prefix its tier. */
function img(name: string, w: number, h: number, avif = 100_000, webp = 150_000, prefix = '/assets/'): ImageEntry {
  return { kind: 'image', w, h, decodedBytes: w * h * 4, avif: { url: `${prefix}${name}.avif`, bytes: avif }, webp: { url: `${prefix}${name}.webp`, bytes: webp } };
}

function clip(role: 'bgm' | 'sfx', name: string, bytes: number, durationMs: number, codec: 'wav' | 'm4a' = 'wav', prefix = '/assets/'): AssetEntry {
  return { kind: 'audio', role, durationMs, file: { url: `${prefix}${name}.${codec}`, bytes }, codec };
}

const bg = (name: string, avif = 100_000): ImageEntry => img(`bg-${name}-0a0a0a0a`, 1080, 2048, avif);
const cg = (name: string): ImageEntry => img(`cg-${name}-0b0b0b0b`, 1080, 2048);
const sprite = (char: string, expr: string): ImageEntry => img(`char-${char}-${expr}-0c0c0c0c`, 768, 1536);
const prop = (name: string, side = 512): ImageEntry => img(`prop-${name}-0d0d0d0d`, side, side, 20_000, 30_000);
const cover = (name: string, avif = 10_000): ImageEntry => img(`cover-${name}-0e0e0e0e`, 360, 640, avif, 15_000);

type ChapterSpec = {
  id: string;
  paid: boolean;
  next: string | null;
  assets: Record<string, AssetEntry>;
  /** knot → its assets and next knots; the first knot is the first key. */
  knots: Record<string, { assets: string[]; next: string[]; carried?: string[] }>;
};

const CATALOG_RAW = {
  bg: { cafe: { placeholder: { hue: 18 } }, archive: { placeholder: { hue: 45 } }, street: { placeholder: { hue: 215 } } },
  chars: { ally: { exprs: { neutral: { placeholder: { hue: 200 } } } } },
  cg: {},
  bgm: { calm: { placeholder: { hz: 220 } }, mystery: { placeholder: { hz: 196 } } },
  sfx: { door: { placeholder: { hz: 440 } } },
  prop: {},
  cover: { manor: { placeholder: { hue: 35 } }, tide: { placeholder: { hue: 200 } } },
};

/** ch1 (free) → ch2 (paid): a small story whose every asset row passes; the engine is absent (PENDING rows). */
function baseSpecs(): ChapterSpec[] {
  return [
    {
      id: 'ch1',
      paid: false,
      next: 'ch2',
      assets: { 'bg/cafe': bg('cafe'), 'bg/street': bg('street'), 'char/ally/neutral': sprite('ally', 'neutral'), 'bgm/calm': clip('bgm', 'bgm-calm-0f0f0f0f', 352_844, 8_000) },
      knots: { cafe: { assets: ['bg/cafe', 'char/ally/neutral', 'bgm/calm'], next: ['street'] }, street: { assets: ['bg/street'], next: [] } },
    },
    {
      id: 'ch2',
      paid: true,
      next: null,
      assets: { 'bg/archive': img('bg-archive-1a1a1a1a', 1080, 2048, 100_000, 150_000, '/api/assets/'), 'bgm/mystery': clip('bgm', 'bgm-mystery-1b1b1b1b', 352_844, 8_000, 'wav', '/api/assets/') },
      knots: { archive: { assets: ['bg/archive', 'bgm/mystery'], next: [] } },
    },
  ];
}

const SMALL: { rawBytes: number; brBytes: number } = { rawBytes: 2_000, brBytes: 500 };

/** AssetInputs for `specs`, every file present at its manifest size; `covers` the Home covers. */
function assetInputs(specs: readonly ChapterSpec[] = baseSpecs(), covers: Record<string, ImageEntry> = { 'cover/manor': cover('manor'), 'cover/tide': cover('tide') }): AssetInputs {
  const list = decodedOrThrow(
    decodeChapterList(specs.map((s) => ({ id: s.id, entry: `${s.id}/main.ink`, paid: s.paid, ...(s.paid ? { productId: `chapter:${s.id}` } : {}), next: s.next }))),
    'chapter list',
  );
  const usage = decodedOrThrow(
    decodeStoryUsage({
      chapters: Object.fromEntries(
        specs.map((s) => [
          s.id,
          {
            assets: [...new Set(Object.values(s.knots).flatMap((k) => k.assets))].sort(),
            knots: Object.fromEntries(Object.entries(s.knots).map(([k, v]) => [k, { assets: v.assets, next: v.next, carried: v.carried ?? [] }])),
          },
        ]),
      ),
    }),
    'usage',
  );
  const chapters: ChapterInputs[] = specs.map((s) => {
    const meta = decodedOrThrow(
      decodeChapterMeta({
        chapterId: s.id,
        storyVersion: '0123456789abcdef',
        firstKnot: Object.keys(s.knots)[0],
        globals: [],
        vars: [],
        knots: Object.fromEntries(Object.entries(s.knots).map(([k, v]) => [k, { assets: v.assets, next: v.next, ending: v.next.length === 0 }])),
        endings: {},
      }),
      'meta',
    );
    const manifest = decodedOrThrow(decodeAssetManifest({ chapterId: s.id, assets: s.assets }), 'manifest');
    return { id: s.id as ChapterId, paid: s.paid, story: SMALL, meta: { ...SMALL, value: meta }, en: SMALL, manifest: { ...SMALL, value: manifest }, world: null };
  });
  const coverManifest = decodedOrThrow(decodeCoverManifest({ assets: covers }), 'covers');
  const fileBytes = new Map<string, number>();
  for (const e of [...specs.flatMap((s) => Object.values(s.assets)), ...Object.values(covers)]) {
    for (const ref of e.kind === 'image' ? [e.avif, e.webp, ...(e.half === undefined ? [] : [e.half.avif, e.half.webp])] : [e.file]) {
      fileBytes.set(urlPath(ref.url) ?? ref.url, ref.bytes);
    }
  }
  return {
    problems: [],
    list,
    chapters,
    catalog: decodedOrThrow(decodeAssetCatalog(CATALOG_RAW), 'catalog'),
    usage,
    rooms: {},
    covers: { ...SMALL, value: coverManifest },
    chapterCatalog: SMALL,
    fileBytes,
  };
}

/** The base specs with chapter `id` changed by `edit`. */
function specsWith(id: string, edit: (s: ChapterSpec) => void): ChapterSpec[] {
  const specs = baseSpecs();
  const s = specs.find((x) => x.id === id);
  if (s === undefined) {
    throw new Error(`invariant: base specs hold ${id}`);
  }
  edit(s);
  return specs;
}

function chapterOf(a: AssetInputs, id: string): ChapterInputs {
  const c = a.chapters.find((x) => x.id === id);
  if (c === undefined) {
    throw new Error(`invariant: the inputs hold ${id}`);
  }
  return c;
}

function assetRows(a: AssetInputs, dist: BudgetInputs = inputs()): Row[] {
  return evaluateAssets(dist, a, LIMITS);
}

describe('budget assets', () => {
  test('budget: image over 2048 px fails', () => {
    const rows = assetRows(assetInputs(specsWith('ch1', (s) => (s.assets['bg/cafe'] = img('bg-cafe-0a0a0a0a', 4096, 2048)))));
    const row = rowOf(rows, 'image bg/cafe');
    expect(row.status).toBe('FAIL');
    expect(row.note).toContain('4096×2048 over 2048 px');
    expect(rowOf(assetRows(assetInputs()), 'image bg/cafe').status).toBe('PASS'); // control
  });

  test('budget: prop over 512 px fails', () => {
    const big = specsWith('ch1', (s) => {
      s.assets['prop/note'] = prop('note', 1024);
      s.knots['street']?.assets.push('prop/note');
    });
    const row = rowOf(assetRows(assetInputs(big)), 'image prop/note');
    expect(row.status).toBe('FAIL');
    expect(row.note).toContain('1024×1024, over 512×512 (prop)');
    const fits = specsWith('ch1', (s) => (s.assets['prop/note'] = prop('note', 512)));
    expect(rowOf(assetRows(assetInputs(fits)), 'image prop/note').status).toBe('PASS'); // control
  });

  test('budget: a trimmed background fails', () => {
    // MEMORY-PLAN 4.B: bg, cg and cover are opaque and never trimmed. The decoder refuses this entry, so it is patched
    // in after decoding: the row refuses it on its own rule too.
    const a = assetInputs();
    const ch1 = chapterOf(a, 'ch1');
    const m = ch1.manifest;
    if (m === null) {
      throw new Error('invariant: the base ch1 has a manifest');
    }
    const trimmed: ImageEntry = { ...bg('cafe'), trim: { canvasW: 1080, canvasH: 2048, x: 0, y: 0 } };
    const patched = { ...ch1, manifest: { ...m, value: { ...m.value, assets: { ...m.value.assets, ['bg/cafe' as AssetId]: trimmed } } } };
    const row = rowOf(assetRows({ ...a, chapters: a.chapters.map((c) => (c === ch1 ? patched : c)) }), 'image bg/cafe');
    expect(row.status).toBe('FAIL');
    expect(row.note).toBe('trim on a bg (only char and prop are trimmed)');
  });

  test('budget: a char canvas over 768x1536 fails', () => {
    // The stored 466×1394 fits DIMS; the canvas, which charPlacement sizes on, does not. The decoder admits it.
    const on = (canvasW: number, canvasH: number): Row => {
      const trim = { canvasW, canvasH, x: 151, y: 142 };
      const sprite: ImageEntry = { ...img('char-ally-neutral-0c0c0c0c', 466, 1394), trim };
      return rowOf(assetRows(assetInputs(specsWith('ch1', (s) => (s.assets['char/ally/neutral'] = sprite)))), 'image char/ally/neutral');
    };
    const row = on(800, 1600);
    expect(row.status).toBe('FAIL');
    expect(row.note).toBe('800×1600, over 768×1536 (char)');
    // Control: the same file on the canonical canvas passes, its note naming both sizes.
    expect(on(768, 1536)).toMatchObject({ status: 'PASS', note: '466×1394 in 768×1536, WebP 150.0 KB' });
  });

  test('budget: cover over 24 KB fails', () => {
    const row = rowOf(assetRows(assetInputs(baseSpecs(), { 'cover/manor': cover('manor', 30_000) })), 'image cover/manor');
    expect(row).toMatchObject({ status: 'FAIL', valueBytes: 30_000, limitBytes: 24_000 });
    expect(row.note).toContain('AVIF 30.0 KB over 24.0 KB');
    expect(rowOf(assetRows(assetInputs()), 'image cover/manor').status).toBe('PASS'); // control
  });

  test('budget: wav without placeholder fails', () => {
    // K23: a WAV ships only for a catalog placeholder. A real (non-placeholder) entry is typed but not yet decodable,
    // so the rule is fed through the typed catalog: the row FAILs on its own rule, not through `asset inputs`.
    const a = assetInputs();
    const catalog = a.catalog;
    if (catalog === null) {
      throw new Error('invariant: the base inputs hold a catalog');
    }
    const real: AssetCatalog = { ...catalog, bgm: { ...catalog.bgm, ['calm' as TrackId]: { src: 'calm.m4a' } } }; // a fixture id
    const rows = assetRows({ ...a, catalog: real });
    const row = rowOf(rows, 'audio bgm/calm');
    expect(row.status).toBe('FAIL');
    expect(row.note).toBe('WAV is allowed only for a catalog placeholder (K23)');
    expect(rowOf(rows, 'asset inputs').status).toBe('PASS');
    expect(rowOf(assetRows(a), 'audio bgm/calm').status).toBe('PASS'); // control: the placeholder WAV fits 400 KB
    // The same clip as AAC needs no placeholder.
    const m4a = assetInputs(specsWith('ch1', (s) => (s.assets['bgm/calm'] = clip('bgm', 'bgm-calm-0f0f0f0f', 352_844, 8_000, 'm4a'))));
    expect(rowOf(assetRows({ ...m4a, catalog: real }), 'audio bgm/calm').status).toBe('PASS');
  });

  test('budget: knot set over 32 MiB fails', () => {
    // Seven backgrounds and a CG in one knot, each with its kept 150,000 B file: 8 × 8.58 = 68.6 MiB.
    const huge = specsWith('ch1', (s) => {
      const names = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'];
      for (const n of names) {
        s.assets[`bg/${n}`] = bg(n);
      }
      s.assets['cg/letter'] = cg('letter');
      s.knots['street'] = { assets: [...names.map((n) => `bg/${n}`), 'cg/letter'], next: [] };
    });
    const row = rowOf(assetRows(assetInputs(huge)), 'knot-set ch1/street');
    expect(row).toMatchObject({ status: 'FAIL', unit: 'MiB', valueBytes: 8 * (1080 * 2048 * 4 + 150_000) });
    expect(row.valueBytes ?? 0).toBeGreaterThan(60 * MIB);
  });

  test('budget: knot-set counts carried stage', () => {
    // PP:3115: B's own set (bg + 2 sprites = 17.9 MiB with their kept files) fits; the stage carried into B (bg + CG +
    // 2 sprites = 26.4 MiB) puts it at 44.3 MiB.
    const carried = specsWith('ch1', (s) => {
      Object.assign(s.assets, {
        'char/stranger/neutral': sprite('stranger', 'neutral'),
        'char/keeper/neutral': sprite('keeper', 'neutral'),
        'char/ally/smile': sprite('ally', 'smile'),
        'cg/letter': cg('letter'),
      });
      s.knots = {
        a: { assets: ['bg/cafe', 'cg/letter', 'char/keeper/neutral', 'char/ally/smile'], next: ['b'] },
        b: { assets: ['bg/street', 'char/ally/neutral', 'char/stranger/neutral'], next: [], carried: ['bg/cafe', 'cg/letter', 'char/ally/smile', 'char/keeper/neutral'] },
      };
    });
    const row = rowOf(assetRows(assetInputs(carried)), 'knot-set ch1/b');
    // Each image counts its kept file, the larger variant (WebP, 150,000 B).
    const own = 1080 * 2048 * 4 + 150_000 + 2 * (768 * 1536 * 4 + 150_000);
    const stage = 2 * (1080 * 2048 * 4 + 150_000) + 2 * (768 * 1536 * 4 + 150_000);
    expect((own / MIB).toFixed(1)).toBe('17.9');
    expect((stage / MIB).toFixed(1)).toBe('26.4');
    expect(row).toMatchObject({ status: 'FAIL', valueBytes: own + stage });
    expect(row.note).toBe('own 17.9 MiB + carried 26.4 MiB');
  });

  test('budget: room-set counts props and close-up', () => {
    // PZ:1710, with the kept files: bg 8.6 + close-up 8.6 + 16 props of 1.03 MiB = 33.6 MiB, over 32 MiB.
    const props = Array.from({ length: 16 }, (_, i) => `prop/p${i}`);
    const a = assetInputs(
      specsWith('ch1', (s) => {
        s.assets['bg/hall'] = bg('hall');
        s.assets['cg/drawer'] = cg('drawer');
        for (const p of props) {
          s.assets[p] = prop(p.slice('prop/'.length));
        }
      }),
    );
    const room = { bg: 'bg/hall', props, closeups: ['cg/drawer'], neighbours: [] };
    const rows = assetRows({ ...a, rooms: { 'ch1/hall/main': room } as unknown as AssetInputs['rooms'] }); // ids are fixture literals
    const row = rowOf(rows, 'room-set ch1/hall/main');
    expect(row).toMatchObject({ status: 'FAIL', unit: 'MiB', valueBytes: 2 * (1080 * 2048 * 4 + 150_000) + 16 * (MIB + 30_000) });
    expect(((row.valueBytes ?? 0) / MIB).toFixed(1)).toBe('33.6');
    // Without the close-up the same room fits (25.0 MiB): the close-up term is what tips it.
    const open = assetRows({ ...a, rooms: { 'ch1/hall/main': { ...room, closeups: [] } } as unknown as AssetInputs['rooms'] });
    expect(rowOf(open, 'room-set ch1/hall/main').status).toBe('PASS');
    expect(rows.some((r) => r.name === 'room-set')).toBe(false); // no PENDING row once a room is measured
  });

  test('budget: knot-set counts kept encoded bytes', () => {
    // MEMORY-PLAN M2: a live record keeps its encoded file, so the set counts it. Three bgs of 1080 × 2048 and one of
    // 1024 × 1712 decode to exactly 32 MiB (the decoder fixes decodedBytes = w × h × 4); four 1 B files put it over.
    const ids = ['k1', 'k2', 'k3', 'k4'];
    const specs = specsWith('ch1', (s) => {
      ids.forEach((n, i) => {
        s.assets[`bg/${n}`] = i < 3 ? img(`bg-${n}-0a0a0a0a`, 1080, 2048, 1, 1) : img(`bg-${n}-0a0a0a0a`, 1024, 1712, 1, 1);
      });
      s.knots['street'] = { assets: ids.map((n) => `bg/${n}`), next: [] };
    });
    const pixels = 3 * 1080 * 2048 * 4 + 1024 * 1712 * 4;
    expect(pixels, 'the decoded bytes alone are at the limit').toBe(32 * MIB);
    const row = rowOf(assetRows(assetInputs(specs)), 'knot-set ch1/street');
    expect(row).toMatchObject({ status: 'FAIL', unit: 'MiB', valueBytes: pixels + 4 });
  });

  test('budget: room-set counts kept encoded bytes', () => {
    // A bg and a neighbour bg of 1080 × 2048, 15 props of 512 × 512 and one of 256 × 128: exactly 32 MiB decoded;
    // the 18 files of 1 B put it over.
    const props = Array.from({ length: 16 }, (_, i) => `prop/q${i}`);
    const a = assetInputs(
      specsWith('ch1', (s) => {
        s.assets['bg/hall'] = img('bg-hall-0a0a0a0a', 1080, 2048, 1, 1);
        s.assets['bg/yard'] = img('bg-yard-0a0a0a0a', 1080, 2048, 1, 1);
        props.forEach((p, i) => {
          const name = `prop-${p.slice('prop/'.length)}-0d0d0d0d`;
          s.assets[p] = i < 15 ? img(name, 512, 512, 1, 1) : img(name, 256, 128, 1, 1);
        });
      }),
    );
    const pixels = 2 * 1080 * 2048 * 4 + 15 * 512 * 512 * 4 + 256 * 128 * 4;
    expect(pixels, 'the decoded bytes alone are at the limit').toBe(32 * MIB);
    const room = { bg: 'bg/hall', props, closeups: [], neighbours: ['bg/yard'] };
    const rows = assetRows({ ...a, rooms: { 'ch1/hall/main': room } as unknown as AssetInputs['rooms'] }); // ids are fixture literals
    expect(rowOf(rows, 'room-set ch1/hall/main')).toMatchObject({ status: 'FAIL', unit: 'MiB', valueBytes: pixels + 18 });
  });

  test('budget: knot-set and room-set limits are the registry steady cap', () => {
    // The rows bound what the registry admits as preloads: one number (MEMORY-PLAN M2), not a copy that can drift.
    expect({ knotSet: LIMITS.knotSet, roomSet: LIMITS.roomSet }).toEqual({ knotSet: STEADY_CAP_BYTES, roomSet: STEADY_CAP_BYTES });
  });

  test('budget: world with sections and no rooms fails', () => {
    const a = assetInputs();
    const ch1 = chapterOf(a, 'ch1');
    const sectioned = { ...a, chapters: a.chapters.map((c) => (c === ch1 ? { ...c, world: { hasSections: true, public: SMALL } } : c)) };
    const row = rowOf(assetRows(sectioned), 'room-set ch1');
    expect(row.status).toBe('FAIL');
    expect(row.note).toContain('usage.json has no rooms for ch1');
    // A world without sections (ch2's in the demo) needs no rooms: the row stays PENDING.
    const flat = { ...a, chapters: a.chapters.map((c) => (c === ch1 ? { ...c, world: { hasSections: false, public: SMALL } } : c)) };
    expect(rowOf(assetRows(flat), 'room-set').status).toBe('PENDING');
  });

  test('budget: first-load row per story', () => {
    // Two stories: ch1 → ch2 and ch3 → ch4; ch3's first knot shows three 290 KB backgrounds, over 800 KB.
    const specs = baseSpecs();
    specs[1] = { ...(specs[1] as ChapterSpec), next: null };
    specs.push(
      {
        id: 'ch3',
        paid: false,
        next: 'ch4',
        assets: { 'bg/shore': bg('shore', 290_000), 'bg/lighthouse': bg('lighthouse', 290_000), 'bg/lamp': bg('lamp', 290_000) },
        knots: { shore: { assets: ['bg/shore', 'bg/lighthouse', 'bg/lamp'], next: [] } },
      },
      { id: 'ch4', paid: true, next: null, assets: {}, knots: { dawn: { assets: [], next: [] } } },
    );
    const dist = withEngine(inputs(), 50_000, 150_000);
    const rows = assetRows(assetInputs(specs), dist);
    expect(rows.filter((r) => r.name.startsWith('first-load ')).map((r) => [r.name, r.status])).toEqual([
      ['first-load ch1', 'PASS'],
      ['first-load ch3', 'FAIL'],
    ]);
    const ch3 = rowOf(rows, 'first-load ch3');
    expect(ch3.valueBytes ?? 0).toBeGreaterThan(870_000);
  });

  test('budget: each asset row fails on its oversize input', () => {
    type Case = readonly [string, () => AssetInputs, string, string?];
    const sized = (c: string, field: 'story' | 'en', s: { rawBytes: number; brBytes: number }) => (): AssetInputs => {
      const a = assetInputs();
      return { ...a, chapters: a.chapters.map((x) => (x.id === c ? { ...x, [field]: s } : x)) };
    };
    const world = (pub: { rawBytes: number; brBytes: number } | null) => (): AssetInputs => {
      const a = assetInputs();
      return { ...a, chapters: a.chapters.map((x) => (x.id === 'ch1' ? { ...x, world: { hasSections: false, public: pub } } : x)) };
    };
    const entry = (id: string, e: AssetEntry) => (): AssetInputs => assetInputs(specsWith('ch1', (s) => (s.assets[id] = e)));
    const files = (edit: (m: Map<string, number>) => void) => (): AssetInputs => {
      const a = assetInputs();
      const m = new Map(a.fileBytes);
      edit(m);
      return { ...a, fileBytes: m };
    };
    const patched = (id: string, edit: (e: ImageEntry) => ImageEntry) => (): AssetInputs => {
      const a = assetInputs();
      return {
        ...a,
        chapters: a.chapters.map((c) => {
          const m = c.manifest;
          const e = m?.value.assets[id as AssetId];
          if (m === null || e?.kind !== 'image') {
            return c;
          }
          return { ...c, manifest: { ...m, value: { ...m.value, assets: { ...m.value.assets, [id]: edit(e) } } } };
        }),
      };
    };
    const cafe = 'client/public/assets/bg-cafe-0a0a0a0a.avif';
    const cases: readonly Case[] = [
      ['story json raw', sized('ch1', 'story', { rawBytes: 160_001, brBytes: 500 }), 'story json ch1'],
      ['story json br', sized('ch2', 'story', { rawBytes: 2_000, brBytes: 35_001 }), 'story json ch2'],
      ['en table raw', sized('ch1', 'en', { rawBytes: 48_001, brBytes: 500 }), 'en table ch1'],
      ['world json raw', world({ rawBytes: 32_001, brBytes: 500 }), 'world json ch1'],
      ['world json br', world({ rawBytes: 2_000, brBytes: 8_001 }), 'world json ch1'],
      ['world source without its public output', world(null), 'world json ch1', 'public world output missing'],
      [
        'transfer over 6 MB',
        () =>
          assetInputs(
            specsWith('ch1', (s) => {
              for (const n of ['a', 'b', 'c']) {
                s.assets[`bgm/${n}`] = clip('bgm', `bgm-${n}-2a2a2a2a`, 2_500_000, 60_000, 'm4a');
              }
            }),
          ),
        'transfer ch1',
      ],
      [
        'first knot images',
        () =>
          assetInputs(
            specsWith('ch1', (s) => {
              s.assets['bg/cafe'] = img('bg-cafe-0a0a0a0a', 1080, 2048, 290_000);
              s.assets['char/ally/neutral'] = img('char-ally-neutral-0c0c0c0c', 768, 1536, 290_000);
            }),
          ),
        'first knot images ch1',
      ],
      ['bg AVIF', entry('bg/cafe', img('bg-cafe-0a0a0a0a', 1080, 2048, 300_001)), 'image bg/cafe', 'AVIF'],
      ['bg WebP', entry('bg/cafe', img('bg-cafe-0a0a0a0a', 1080, 2048, 100_000, 450_001)), 'image bg/cafe', 'WebP'],
      ['sprite AVIF', entry('char/ally/neutral', img('char-ally-neutral-0c0c0c0c', 768, 1536, 300_001)), 'image char/ally/neutral', 'AVIF'],
      ['prop AVIF', entry('prop/note', img('prop-note-0d0d0d0d', 512, 512, 60_001, 30_000)), 'image prop/note', 'AVIF'],
      ['prop WebP', entry('prop/note', img('prop-note-0d0d0d0d', 512, 512, 20_000, 90_001)), 'image prop/note', 'WebP'],
      ['cover WebP', () => assetInputs(baseSpecs(), { 'cover/manor': img('cover-manor-0e0e0e0e', 360, 640, 10_000, 36_001) }), 'image cover/manor', 'WebP'],
      ['bg not 1080×2048', entry('bg/cafe', img('bg-cafe-0a0a0a0a', 1080, 1920)), 'image bg/cafe', 'not exactly 1080×2048'],
      ['sprite over 768×1536', entry('char/ally/neutral', img('char-ally-neutral-0c0c0c0c', 800, 1536)), 'image char/ally/neutral', 'over 768×1536'],
      ['cover not 360×640', () => assetInputs(baseSpecs(), { 'cover/manor': img('cover-manor-0e0e0e0e', 360, 600, 10_000, 15_000) }), 'image cover/manor', 'not exactly 360×640'],
      // The decoder refuses this one; the row checks it too, on a value patched after decoding.
      ['decoded bytes', patched('bg/cafe', (e) => ({ ...e, decodedBytes: 1 })), 'image bg/cafe', 'decodedBytes'],
      ['a missing file', files((m) => m.delete(cafe)), 'image bg/cafe', `${cafe} missing`],
      ['bytes not the file size', files((m) => m.set(cafe, 99_999)), 'image bg/cafe', 'the manifest says 100000'],
      ['m4a over 3 MB', entry('bgm/calm', clip('bgm', 'bgm-calm-0f0f0f0f', 3_000_001, 60_000, 'm4a')), 'audio bgm/calm'],
      ['m4a over 240 s', entry('bgm/calm', clip('bgm', 'bgm-calm-0f0f0f0f', 2_000_000, 240_001, 'm4a')), 'audio bgm/calm', 'ms over'],
      ['sfx over 100 KB', entry('sfx/door', clip('sfx', 'sfx-door-3a3a3a3a', 100_001, 600)), 'audio sfx/door'],
      ['sfx over 3 s', entry('sfx/door', clip('sfx', 'sfx-door-3a3a3a3a', 26_504, 3_001)), 'audio sfx/door', 'ms over'],
      ['bgm WAV over 400 KB', entry('bgm/calm', clip('bgm', 'bgm-calm-0f0f0f0f', 400_001, 8_000)), 'audio bgm/calm', 'wav 400.0 KB over 400.0 KB'],
    ];
    // Control: the base input has no FAIL row at all.
    const base = assetRows(assetInputs());
    expect(base.filter((r) => r.status === 'FAIL').map((r) => `${r.name}: ${r.note}`)).toEqual([]);
    expect(base.every((r) => r.status === 'PASS' || r.status === 'PENDING')).toBe(true);
    for (const [label, make, name, note] of cases) {
      const row = rowOf(assetRows(make()), name);
      expect(row.status, `${label}: ${row.note}`).toBe('FAIL');
      if (note !== undefined) {
        expect(row.note, label).toContain(note);
      }
    }
  });

  test('budget: asset rows fail on a conflict or a lacking id', () => {
    // Control: the base inputs fail no row.
    expect(assetRows(assetInputs()).filter((r) => r.status === 'FAIL').map((r) => r.name)).toEqual([]);
    // An id whose entry differs between two manifests (a stale one): its row FAILs, an image and a clip alike.
    const conflicted = specsWith('ch2', (s) => {
      s.assets['bg/cafe'] = img('bg-cafe-0a0a0a0a', 1080, 2048, 120_000, 150_000, '/api/assets/');
      s.assets['bgm/calm'] = clip('bgm', 'bgm-calm-0f0f0f0f', 352_000, 8_000, 'wav', '/api/assets/');
    });
    const rows = assetRows(assetInputs(conflicted));
    for (const name of ['image bg/cafe', 'audio bgm/calm']) {
      const row = rowOf(rows, name);
      expect(row.status, name).toBe('FAIL');
      expect(row.note, name).toContain("the entry in ch2 differs from an earlier manifest's (a stale manifest?)");
    }
    // The same entry in both manifests is no conflict.
    const shared = specsWith('ch2', (s) => {
      s.assets['bg/cafe'] = bg('cafe');
    });
    expect(rowOf(assetRows(assetInputs(shared)), 'image bg/cafe').status).toBe('PASS');
    // A knot naming an asset its chapter's manifest lacks cannot be summed: FAIL, not a smaller PASS.
    const lacking = specsWith('ch1', (s) => {
      s.knots['street']?.assets.push('bg/ghost');
    });
    const knot = rowOf(assetRows(assetInputs(lacking)), 'knot-set ch1/street');
    expect(knot.status).toBe('FAIL');
    expect(knot.note).toContain("not in ch1's manifest: bg/ghost");
    // A room naming a close-up the manifest lacks, likewise.
    const a = assetInputs();
    const room = { bg: 'bg/cafe', props: [], closeups: ['cg/drawer'], neighbours: ['bg/street'] };
    const roomRow = rowOf(assetRows({ ...a, rooms: { 'ch1/hall/main': room } as unknown as AssetInputs['rooms'] }), 'room-set ch1/hall/main'); // ids are fixture literals
    expect(roomRow.status).toBe('FAIL');
    expect(roomRow.note).toContain("not in ch1's manifest: cg/drawer");
    const fits = { ...room, closeups: [] };
    expect(rowOf(assetRows({ ...a, rooms: { 'ch1/hall/main': fits } as unknown as AssetInputs['rooms'] }), 'room-set ch1/hall/main').status).toBe('PASS');
  });

  // MEMORY-PLAN 4.C, §7: an image's half-tier file, exactly half its stored size, beside it under the same prefix.
  const halfFile = (name: string, w: number, h: number, avif = 30_000, webp = 45_000): HalfFile => ({
    w,
    h,
    decodedBytes: w * h * 4,
    avif: { url: `/assets/${name}-half-0f0f0f0f.avif`, bytes: avif },
    webp: { url: `/assets/${name}-half-0f0f0f0f.webp`, bytes: webp },
  });
  const cafeWithHalf = (avif?: number, webp?: number): ChapterSpec[] =>
    specsWith('ch1', (s) => (s.assets['bg/cafe'] = { ...bg('cafe'), half: halfFile('bg-cafe', 540, 1024, avif, webp) }));

  test('budget: a half whose LOW count exceeds its full count fails', () => {
    // I2 needs small files: a full-size bg's half would need files over 6.7 MB. A 4×4 prop (64 B decoded, 10 B files)
    // with a 2×2 half (16 B) in 100 B files counts 116 B on a LOW phone against 74 B on the full tier.
    const tiny = (half: HalfFile): ChapterSpec[] =>
      specsWith('ch1', (s) => {
        s.assets['prop/note'] = { ...img('prop-note-0d0d0d0d', 4, 4, 10, 10), half };
        s.knots['street']?.assets.push('prop/note');
      });
    const row = rowOf(assetRows(assetInputs(tiny(halfFile('prop-note', 2, 2, 100, 100)))), 'image prop/note');
    expect(row.status).toBe('FAIL');
    expect(row.note).toBe("half counts 116 B > the full file's 74 B (I2: a LOW record must not count more than its full record)");
    // Control: a half in 10 B files counts 26 B.
    expect(rowOf(assetRows(assetInputs(tiny(halfFile('prop-note', 2, 2, 10, 10)))), 'image prop/note').status).toBe('PASS');
  });

  test("budget: a half file over its kind's file limit fails", () => {
    const avif = rowOf(assetRows(assetInputs(cafeWithHalf(300_001))), 'image bg/cafe');
    expect(avif.status).toBe('FAIL');
    expect(avif.note).toContain('half AVIF 300.0 KB over 300.0 KB');
    const webp = rowOf(assetRows(assetInputs(cafeWithHalf(30_000, 450_001))), 'image bg/cafe');
    expect(webp.status).toBe('FAIL');
    expect(webp.note).toContain('half WebP 450.0 KB over 450.0 KB');
    // Control: a half within the limits passes, and its row reads the full AVIF, its note the half.
    const fits = rowOf(assetRows(assetInputs(cafeWithHalf())), 'image bg/cafe');
    expect(fits).toMatchObject({ status: 'PASS', valueBytes: 100_000, note: '1080×2048, WebP 150.0 KB; half 540×1024, WebP 45.0 KB' });
  });

  test('budget: a missing half file fails', () => {
    const a = assetInputs(cafeWithHalf());
    const rel = 'client/public/assets/bg-cafe-half-0f0f0f0f.avif';
    expect(a.fileBytes.get(rel), 'the fixture states the half file').toBe(30_000);
    const missing = new Map(a.fileBytes);
    missing.delete(rel);
    const gone = rowOf(assetRows({ ...a, fileBytes: missing }), 'image bg/cafe');
    expect(gone.status).toBe('FAIL');
    expect(gone.note).toContain(`${rel} missing`);
    const resized = rowOf(assetRows({ ...a, fileBytes: new Map([...a.fileBytes, [rel, 29_999]]) }), 'image bg/cafe');
    expect(resized.status).toBe('FAIL');
    expect(resized.note).toContain(`${rel} is 29999 B on disk, the manifest says 30000`);
  });

  test("budget: the half transfer row counts each entry's half file", () => {
    const rows = assetRows(assetInputs(cafeWithHalf()));
    const full = rowOf(rows, 'transfer ch1');
    const half = rowOf(rows, 'transfer ch1 (half)');
    // bg/cafe's half AVIF replaces its full one; every other entry counts its full file.
    expect(half.valueBytes).toBe((full.valueBytes ?? 0) - 100_000 + 30_000);
    expect(half).toMatchObject({ limitBytes: 6_000_000, status: 'PASS' });
    // A chapter with no half counts what its full row counts.
    expect(rowOf(rows, 'transfer ch2 (half)').valueBytes).toBe(rowOf(rows, 'transfer ch2').valueBytes);
    // A chapter without a manifest cannot be summed.
    const a = assetInputs();
    const noManifest = assetRows({ ...a, chapters: a.chapters.map((c) => (c.id === 'ch2' ? { ...c, manifest: null } : c)) });
    expect(rowOf(noManifest, 'transfer ch2 (half)')).toMatchObject({ status: 'FAIL', note: 'manifest missing' });
  });

  test('budget: asset rows pending without their subject', () => {
    const rows = assetRows(assetInputs());
    // No world source, no sectioned world: nothing to measure yet. The engine is absent: first-load is partial.
    expect(rowOf(rows, 'world json')).toMatchObject({ status: 'PENDING', valueBytes: null });
    expect(rowOf(rows, 'room-set')).toMatchObject({ status: 'PENDING', valueBytes: null });
    expect(rowOf(rows, 'first-load ch1').status).toBe('PENDING');
    // A PENDING row is printed and never counted as a PASS.
    const text = formatRows(rows);
    const pass = rows.filter((r) => r.status === 'PASS').length;
    expect(text).toContain(`budget: ${rows.length} rows, ${pass} PASS, 0 FAIL, ${rows.length - pass} PENDING`);
    expect(rows.length - pass).toBe(3);
    // With the engine there, first-load is measured.
    expect(rowOf(assetRows(assetInputs(), withEngine(inputs(), 50_000, 150_000)), 'first-load ch1').status).toBe('PASS');
  });

  test('budget: asset inputs fail on a missing or undecodable input', () => {
    // W2: the one row that notices an input it cannot read; through the reader on a synthetic repository.
    const tmp = mkdtempSync(join(tmpdir(), 'budget-inputs-'));
    try {
      const cases: ReadonlyArray<readonly [string, Readonly<Record<string, string | null>>, string]> = [
        ['a listed chapter manifest missing', { 'client/src/story-gen/free/ch1.assets.json': null }, 'client/src/story-gen/free/ch1.assets.json: missing'],
        ['usage.json missing', { 'server/content/build/usage.json': null }, 'server/content/build/usage.json: missing'],
        ['covers.json undecodable', { 'client/src/story-gen/covers.json': '{"assets": 5}' }, 'client/src/story-gen/covers.json: assets: not an object'],
        ['catalog undecodable', { 'assets/catalog.json': '{"bg": {}}' }, 'assets/catalog.json: chars: missing'],
        ['catalog not JSON', { 'assets/catalog.json': '{"bg":' }, 'assets/catalog.json: not JSON'],
        ['an image without webp', { 'client/src/story-gen/free/ch1.assets.json': JSON.stringify({ chapterId: 'ch1', assets: { 'bg/cafe': { ...repoCafe(1080), webp: undefined } } }) }, 'client/src/story-gen/free/ch1.assets.json: assets.bg/cafe.webp: missing'],
        ['a meta of another chapter', { 'client/src/story-gen/free/ch1.meta.json': JSON.stringify({ ...REPO_META, chapterId: 'ch3' }) }, 'chapterId is ch3, not ch1'],
      ];
      // Control: the complete repository reads clean and its chapter produces every per-chapter row.
      const clean = join(tmp, 'clean');
      writeRepo(clean);
      const ok = readAssetInputs(clean);
      expect(ok.problems).toEqual([]);
      const okRows = assetRows(ok);
      expect(rowOf(okRows, 'asset inputs').status).toBe('PASS');
      for (const name of ['story json ch1', 'en table ch1', 'transfer ch1', 'first knot images ch1', 'knot-set ch1/start', 'image bg/cafe', 'audio bgm/calm', 'image cover/manor', 'first-load ch1']) {
        expect(rowOf(okRows, name).status, name).not.toBe('FAIL');
      }
      for (const [label, edit, problem] of cases) {
        const repo = join(tmp, label.replace(/[^a-z0-9]+/gi, '-'));
        writeRepo(repo, { override: edit });
        const row = rowOf(assetRows(readAssetInputs(repo)), 'asset inputs');
        expect(row.status, label).toBe('FAIL');
        expect(row.note, label).toContain(problem);
      }
      // The CLI exits 1, and the chapter's rows say what they could not measure instead of vanishing.
      const dist = join(tmp, 'dist');
      writeDist(dist, 'export const main = 1;\n');
      const repo = join(tmp, 'a-listed-chapter-manifest-missing');
      const r = runCli(dist, SCRIPT, [], ['--root', repo]);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/^asset inputs \| — \| — \| FAIL \| client\/src\/story-gen\/free\/ch1\.assets\.json: missing/m);
      expect(r.stdout).toMatch(/^transfer ch1 \| — \| 6000\.0 KB \| FAIL \| manifest missing$/m);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT_MS);

  test('budget: cli prints asset rows from the root', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'budget-root-'));
    try {
      const dist = join(tmp, 'dist');
      writeDist(dist, 'export const main = 1;\n');
      writeRepo(join(tmp, 'repo'));
      const r = runCli(dist, SCRIPT, [], ['--root', join(tmp, 'repo')]);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      for (const row of [
        /^asset inputs \| — \| — \| PASS \| 1 chapters$/m,
        /^story json ch1 \| .* \| 35\.0 KB \| PASS/m,
        /^en table ch1 \| .* \| 48\.0 KB \| PASS/m,
        /^transfer ch1 \| .* \| 6000\.0 KB \| PASS/m,
        /^first knot images ch1 \| .* \| 450\.0 KB \| PASS/m,
        /^world json \| — \| 8\.0 KB \| PENDING/m,
        /^image bg\/cafe \| .* \| 300\.0 KB \| PASS \| 1080×2048/m,
        /^image cover\/manor \| .* \| 24\.0 KB \| PASS \| 360×640/m,
        /^audio bgm\/calm \| .* \| 400\.0 KB \| PASS \| wav, 8000 ms$/m,
        /^knot-set ch1\/start \| 8\.4 MiB \| 32\.0 MiB \| PASS/m,
        /^room-set \| — \| 32\.0 MiB \| PENDING/m,
        /^first-load ch1 \| .* \| 800\.0 KB \| PENDING/m,
      ]) {
        expect(r.stdout).toMatch(row);
      }
      expect(r.stdout).toMatch(/^budget: \d+ rows, \d+ PASS, 0 FAIL, 11 PENDING$/m);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT_MS);
});

// A synthetic repository as `npm run story && npm run assets` leaves it: one free chapter (ch1) naming bg/cafe and
// bgm/calm in its first knot, one cover; the encoded files are noise at the sizes the manifests state.

const REPO_META = {
  chapterId: 'ch1',
  storyVersion: '0123456789abcdef',
  firstKnot: 'start',
  globals: [],
  vars: [],
  knots: { start: { assets: ['bg/cafe', 'bgm/calm'], next: [], ending: true } },
  endings: {},
};

function repoCafe(width: number): Record<string, unknown> {
  return {
    kind: 'image',
    w: width,
    h: 2048,
    decodedBytes: width * 2048 * 4,
    avif: { url: '/assets/bg-cafe-aaaaaaaa.avif', bytes: 3_000 },
    webp: { url: '/assets/bg-cafe-bbbbbbbb.webp', bytes: 5_000 },
  };
}

function writeRepo(root: string, opts: { bgWidth?: number; override?: Readonly<Record<string, string | null>> } = {}): void {
  const files: Record<string, string | Uint8Array | null> = {
    'story/chapters.json': JSON.stringify([{ id: 'ch1', entry: 'ch1/main.ink', paid: false, next: null }]),
    'assets/catalog.json': JSON.stringify({ ...CATALOG_RAW, cover: { manor: { placeholder: { hue: 35 } } } }),
    'server/content/build/usage.json': JSON.stringify({
      chapters: { ch1: { assets: ['bg/cafe', 'bgm/calm'], knots: { start: { assets: ['bg/cafe', 'bgm/calm'], next: [], carried: [] } } } },
    }),
    'client/src/story-gen/catalog.json': JSON.stringify({ chapters: [], cast: {} }),
    'client/src/story-gen/covers.json': JSON.stringify({
      assets: {
        'cover/manor': {
          kind: 'image',
          w: 360,
          h: 640,
          decodedBytes: 360 * 640 * 4,
          avif: { url: '/assets/cover-manor-cccccccc.avif', bytes: 1_000 },
          webp: { url: '/assets/cover-manor-dddddddd.webp', bytes: 1_200 },
        },
      },
    }),
    'client/src/story-gen/free/ch1.story.json': '{"inkVersion":21,"root":[]}',
    'client/src/story-gen/free/ch1.meta.json': JSON.stringify(REPO_META),
    'client/src/story-gen/free/ch1.en.json': '{}',
    'client/src/story-gen/free/ch1.assets.json': JSON.stringify({
      chapterId: 'ch1',
      assets: {
        'bg/cafe': repoCafe(opts.bgWidth ?? 1080),
        'bgm/calm': { kind: 'audio', role: 'bgm', durationMs: 8_000, file: { url: '/assets/bgm-calm-eeeeeeee.wav', bytes: 6_000 }, codec: 'wav' },
      },
    }),
    'client/public/assets/bg-cafe-aaaaaaaa.avif': noise(3_000, 1),
    'client/public/assets/bg-cafe-bbbbbbbb.webp': noise(5_000, 2),
    'client/public/assets/bgm-calm-eeeeeeee.wav': noise(6_000, 3),
    'client/public/assets/cover-manor-cccccccc.avif': noise(1_000, 4),
    'client/public/assets/cover-manor-dddddddd.webp': noise(1_200, 5),
    ...opts.override,
  };
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) {
      continue;
    }
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}
