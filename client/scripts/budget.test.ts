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
import { ENGINE_SRC, ENTRY_STEP_TTFL, LABELS_BOUND, LIMITS, evaluate, evaluateAssets, firstLineFiles, formatRows, imgIds, readAssetInputs, readInputs } from './budget.ts';
import type { AssetInputs, BudgetInputs, ChapterInputs, DistFile, ManifestChunk, Row } from './budget.ts';
import { decodeChapterList, decodeStoryUsage } from './story/emit.ts';
import { decodeShotUsage } from './story/shots/usage.ts';
import type { ShotUsage } from './story/shots/usage.ts';

/** The lazy family rows (PUZZLES-PLAN X14, "Budgets"). */
const LAZY_ROWS = ['puzzle-type chunk (br)', 'puzzle-host chunk (br)', 'explore-ui chunk (br)', 'cue-stage chunk (br)'];
/** The meta families' rows (META-PLAN M27, "Budgets"; RULINGS 105): app/meta.ts is their importer. */
const META_ROWS = ['meta-ui chunk (br)', 'meta controller chunk (br)'];
/** The purchase flow's row (lever P): app/game.ts is its importer. */
const PURCHASE_ROW = 'purchase-flow chunk (br)';
/** The in-play overlays' row (lever O5): app/game.ts is its importer. */
const OVERLAYS_ROW = 'overlays chunk (br)';
/** The scene's motion chunk's row (shots §10, W6; SH3b): scene/controller.ts is its importer. */
const MOTION_ROW = 'scene-motion chunk (br)';

const ROW_NAMES = [
  'manifest',
  'entry closure JS (br)',
  'engine closure JS (br)',
  'JS before the first line (br)',
  ...LAZY_ROWS,
  ...META_ROWS,
  PURCHASE_ROW,
  OVERLAYS_ROW,
  MOTION_ROW,
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
    gameSourceExists: false,
    sceneSourceExists: false,
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
const MOTION = 'src/scene/motion/index.ts';

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
    // 370 000 + 2 000 shared: over the entry's 40 KB and the 365 KB of all JS.
    big.files = big.files.map((f) => (f.path === 'assets/index-a.js' ? file(f.path, 370_000) : f));
    const rows = evaluate(big, LIMITS);
    const entry = rowOf(rows, 'entry closure JS (br)');
    expect(entry.status).toBe('FAIL');
    expect(entry.valueBytes).toBe(372_000);
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
    // RULINGS 201 QS3 re-set the limit to 365 KB br: 12 000 + 11 × 33 000 = 375 000 is over it.
    const base = inputs();
    const lazy = Array.from({ length: 11 }, (_, i) => file(`assets/lazy-${i}.js`, 33_000));
    const rows = evaluate({ ...base, files: [...base.files, ...lazy] }, LIMITS);
    expect(rowOf(rows, 'entry closure JS (br)').status).toBe('PASS');
    const all = rowOf(rows, 'all JS (br)');
    expect(all.valueBytes).toBe(375_000);
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

  /**
   * Lever P's built topology: the engine import()s the purchase flow, a dynamic entry of its own (JS, and CSS if
   * given); app/game.ts and the flow's source exist.
   */
  function withPurchase(jsBr: number, cssBr?: number): BudgetInputs {
    const base = withEngine(inputs(), 50_000, 179_000);
    const manifest = { ...base.manifest };
    const engine = manifest[ENGINE_SRC];
    if (engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk');
    }
    manifest[ENGINE_SRC] = { ...engine, dynamicImports: ['src/purchase/flow.ts'] };
    const css = cssBr === undefined ? [] : ['assets/flow-p.css'];
    manifest['src/purchase/flow.ts'] = { file: 'assets/flow-p.js', src: 'src/purchase/flow.ts', isDynamicEntry: true, css };
    const files = [...base.files, file('assets/flow-p.js', jsBr), ...css.map((c) => file(c, cssBr ?? 0))];
    return { ...base, manifest, files, gameSourceExists: true, lazySources: new Set(['src/purchase/flow.ts']) };
  }

  test('budget: the purchase-flow family is measured and refused over its limit', () => {
    // Lever P: game.ts import()s the flow at the paywall, so the engine walk stops at it and its own row counts it,
    // against 2.0 KB (the measured 1,468 B plus the per-lane tolerance).
    expect(LIMITS.purchaseFlowChunkBr).toBe(2_000);
    const row = (b: BudgetInputs): Row => rowOf(evaluate(b, LIMITS), PURCHASE_ROW);
    const rows = evaluate(withPurchase(1_468), LIMITS);
    expect(rowOf(rows, 'engine closure JS (br)')).toMatchObject({ status: 'PASS', valueBytes: 229_000 });
    expect(rowOf(rows, 'JS before the first line (br)')).toMatchObject({ status: 'PASS', valueBytes: 12_000 + 229_000 });
    expect(rowOf(rows, PURCHASE_ROW)).toMatchObject({
      status: 'PASS',
      valueBytes: 1_468,
      limitBytes: 2_000,
      note: 'largest: src/purchase/flow.ts, 1 chunks',
    });
    expect(row(withPurchase(2_000))).toMatchObject({ status: 'PASS', valueBytes: 2_000 });
    expect(row(withPurchase(2_001))).toMatchObject({ status: 'FAIL', valueBytes: 2_001 });
    // JS and CSS both count.
    expect(row(withPurchase(1_500, 300))).toMatchObject({ status: 'PASS', valueBytes: 1_800 });
    // First-load to the first line does not count it.
    const plain = assetRows(assetInputs(), withEngine(inputs(), 50_000, 179_000));
    const lazy = assetRows(assetInputs(), withPurchase(1_468));
    expect(rowOf(lazy, 'first-load ch1').valueBytes).toBe(rowOf(plain, 'first-load ch1').valueBytes);
  });

  test('budget: the purchase-flow row is pending until app/game.ts exists', () => {
    const row = (b: BudgetInputs): Row => rowOf(evaluate(b, LIMITS), PURCHASE_ROW);
    // The other importers exist and the game does not: PENDING, keyed on the game alone.
    expect(row({ ...withPurchase(1_468), gameSourceExists: false, yieldsSourceExists: true, metaSourceExists: true })).toMatchObject({
      status: 'PENDING',
      valueBytes: null,
      note: 'src/app/game.ts absent',
    });
    // The game exists and the other importers do not: measured.
    expect(row({ ...withPurchase(1_468), yieldsSourceExists: false, metaSourceExists: false })).toMatchObject({ status: 'PASS', valueBytes: 1_468 });
    // The game exists and the flow's source does not: PENDING, never a 0 KB PASS.
    expect(row({ ...withPurchase(1_468), lazySources: new Set() })).toMatchObject({
      status: 'PENDING',
      valueBytes: null,
      note: 'no source of src/purchase/flow.ts',
    });
    // Both exist and nothing makes the flow a dynamic entry: FAIL.
    expect(row(inputs({ gameSourceExists: true, lazySources: new Set(['src/purchase/flow.ts']) }))).toMatchObject({
      status: 'FAIL',
      note: 'no dynamic entry for src/purchase/flow.ts',
    });
  });

  test('budget: a purchase flow imported statically fails', () => {
    const base = withPurchase(1_468);
    const row = (b: BudgetInputs): Row => rowOf(evaluate(b, LIMITS), PURCHASE_ROW);
    // Control: its own dynamic chunk.
    expect(row(base)).toMatchObject({ status: 'PASS', valueBytes: 1_468 });
    // Merged into the engine (a static import, as before lever P): no chunk of its own, so a FAIL, never a 0 KB PASS.
    const { ['src/purchase/flow.ts']: _merged, ...rest } = base.manifest ?? {};
    const engine = rest[ENGINE_SRC];
    if (engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk');
    }
    const merged = { ...rest, [ENGINE_SRC]: { ...engine, dynamicImports: [] } };
    expect(row({ ...base, manifest: merged })).toMatchObject({ status: 'FAIL', note: 'no dynamic entry for src/purchase/flow.ts' });
    // Imported as a value too: the dynamic entry is a facade over the engine chunk that holds the code.
    const facade = 'assets/flow-p.js';
    const overEngine = {
      ...base.manifest,
      'src/purchase/flow.ts': { file: facade, src: 'src/purchase/flow.ts', isDynamicEntry: true, imports: [ENGINE_SRC] },
    };
    expect(row({ ...base, manifest: overEngine, facades: new Set([facade]) })).toMatchObject({
      status: 'FAIL',
      note: `src/purchase/flow.ts: its dynamic entry ${facade} only re-exports assets/engine-d.js, which the engine closure loads before the first line (a static import of the root?)`,
    });
  });

  /**
   * Lever O5's built topology: the engine import()s the overlays' barrel, a dynamic entry of its own (JS, and CSS if
   * given); app/game.ts and the barrel's source exist.
   */
  function withOverlays(jsBr: number, cssBr?: number): BudgetInputs {
    const base = withEngine(inputs(), 50_000, 179_000);
    const manifest = { ...base.manifest };
    const engine = manifest[ENGINE_SRC];
    if (engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk');
    }
    manifest[ENGINE_SRC] = { ...engine, dynamicImports: ['src/ui/overlays/index.ts'] };
    const css = cssBr === undefined ? [] : ['assets/overlays-o.css'];
    manifest['src/ui/overlays/index.ts'] = { file: 'assets/overlays-o.js', src: 'src/ui/overlays/index.ts', isDynamicEntry: true, css };
    const files = [...base.files, file('assets/overlays-o.js', jsBr), ...css.map((c) => file(c, cssBr ?? 0))];
    return { ...base, manifest, files, gameSourceExists: true, lazySources: new Set(['src/ui/overlays/index.ts']) };
  }

  test('budget: the overlays family is measured and refused over its limit', () => {
    // Lever O5: game.ts import()s the overlays after the first line's reveal and at a Menu or Backlog tap, so their own
    // row counts them, against 3.0 KB (C0's measured 2,496 B plus the per-lane tolerance, rounded up to 0.5 KB).
    expect(LIMITS.overlaysChunkBr).toBe(3_000);
    const row = (b: BudgetInputs): Row => rowOf(evaluate(b, LIMITS), OVERLAYS_ROW);
    expect(row(withOverlays(2_496))).toMatchObject({
      status: 'PASS',
      valueBytes: 2_496,
      limitBytes: 3_000,
      note: 'largest: src/ui/overlays/index.ts, 1 chunks',
    });
    expect(row(withOverlays(3_000))).toMatchObject({ status: 'PASS', valueBytes: 3_000 });
    expect(row(withOverlays(3_001))).toMatchObject({ status: 'FAIL', valueBytes: 3_001 });
    // JS and CSS both count.
    expect(row(withOverlays(2_500, 300))).toMatchObject({ status: 'PASS', valueBytes: 2_800 });
    // First-load to the first line does not count it.
    const plain = assetRows(assetInputs(), withEngine(inputs(), 50_000, 179_000));
    const lazy = assetRows(assetInputs(), withOverlays(2_496));
    expect(rowOf(lazy, 'first-load ch1').valueBytes).toBe(rowOf(plain, 'first-load ch1').valueBytes);
  });

  test('budget: the overlays family is PENDING until its source exists', () => {
    const row = (b: BudgetInputs): Row => rowOf(evaluate(b, LIMITS), OVERLAYS_ROW);
    // The game, its importer, is absent: PENDING, keyed on the game alone.
    expect(row({ ...withOverlays(2_496), gameSourceExists: false, yieldsSourceExists: true, metaSourceExists: true })).toMatchObject({
      status: 'PENDING',
      valueBytes: null,
      note: 'src/app/game.ts absent',
    });
    // The game exists and the barrel's source does not: PENDING, never a 0 KB PASS.
    expect(row({ ...withOverlays(2_496), lazySources: new Set() })).toMatchObject({
      status: 'PENDING',
      valueBytes: null,
      note: 'no source of src/ui/overlays/index.ts',
    });
    // Both exist and nothing makes the barrel a dynamic entry: FAIL.
    expect(row(inputs({ gameSourceExists: true, lazySources: new Set(['src/ui/overlays/index.ts']) }))).toMatchObject({
      status: 'FAIL',
      note: 'no dynamic entry for src/ui/overlays/index.ts',
    });
  });

  test('budget: the engine walk stops at the overlays chunk', () => {
    // The engine (50,000) and Pixi (179,000) fill 229,000 of 230,000: the overlays chunk the engine import()s (2,500)
    // would break the engine and first-line rows if the walk counted it; its own row counts it instead.
    const rows = evaluate(withOverlays(2_500), LIMITS);
    expect(rowOf(rows, 'engine closure JS (br)')).toMatchObject({ status: 'PASS', valueBytes: 229_000 });
    expect(rowOf(rows, 'JS before the first line (br)')).toMatchObject({ status: 'PASS', valueBytes: 12_000 + 229_000 });
    expect(rowOf(rows, OVERLAYS_ROW)).toMatchObject({ status: 'PASS', valueBytes: 2_500 });
  });

  test('budget: all js limit is 365 KB', () => {
    // RULINGS 201 QS3: Ledger 3 re-set once, to 365 KB br (the measured base, the queued levers and the remaining nets).
    const base = inputs(); // 12 000 B of JS
    const all = (bytes: number): Row => rowOf(evaluate({ ...base, files: [...base.files, file('assets/lazy-0.js', bytes - 12_000)] }, LIMITS), 'all JS (br)');
    expect(all(300_000).status).toBe('PASS');
    expect(all(365_000)).toMatchObject({ status: 'PASS', valueBytes: 365_000 });
    expect(all(365_001).status).toBe('FAIL');
  });

  test('budget: scene-motion chunk row is pending until its root exists', () => {
    // Shots §10 (W6): the scene's motion chunk (its root src/scene/motion/index.ts, which the scene controller import()s
    // after the first line, SH7) is its own lazy family against 8.0 KB of JS + CSS; PENDING while the controller or the
    // root is absent, never a 0 KB PASS.
    const row = (b: BudgetInputs): Row => rowOf(evaluate(b, LIMITS), MOTION_ROW);
    expect(row(inputs())).toMatchObject({ status: 'PENDING', valueBytes: null, limitBytes: 8_000, note: 'src/scene/controller.ts absent' });
    expect(row(inputs({ sceneSourceExists: true }))).toMatchObject({ status: 'PENDING', valueBytes: null, note: `no source of ${MOTION}` });
    const built = (motion: LazyChunk): BudgetInputs => withLazy(withEngine(inputs(), 50_000, 100_000), { [MOTION]: motion }, { sceneSourceExists: true });
    expect(row(built({ js: 8_000 }))).toMatchObject({ status: 'PASS', valueBytes: 8_000, note: `largest: ${MOTION}, 1 chunks` });
    expect(row(built({ js: 8_001 }))).toMatchObject({ status: 'FAIL', valueBytes: 8_001 });
    expect(row(built({ js: 7_500, css: 600 }))).toMatchObject({ status: 'FAIL', valueBytes: 8_100 });
    expect(LIMITS.sceneMotionChunkBr).toBe(8_000);
  });

  test('budget: a scene-motion root inside the engine closure fails', () => {
    // The scene controller is in the engine: its import() of the motion root, or of another chunk of src/scene/motion/,
    // stops the engine walk, and the family's row counts the root's closure. A static import of the root puts it in
    // the engine closure, before the first line: FAIL.
    const base = withEngine(inputs({ sceneSourceExists: true, lazySources: new Set([MOTION]) }), 50_000, 100_000);
    const engine = base.manifest?.[ENGINE_SRC];
    if (base.manifest === null || engine === undefined) {
      throw new Error('invariant: withEngine adds the engine chunk');
    }
    const WARP = 'src/scene/motion/warp.ts';
    const manifest: Record<string, ManifestChunk> = {
      ...base.manifest,
      [ENGINE_SRC]: { ...engine, dynamicImports: [MOTION, WARP] },
      [MOTION]: { file: 'assets/index-m.js', src: MOTION, isDynamicEntry: true, imports: ['_motion-n.js'] },
      '_motion-n.js': { file: 'assets/motion-n.js' },
      [WARP]: { file: 'assets/warp-w.js', src: WARP, isDynamicEntry: true },
    };
    const lazy = { ...base, manifest, files: [...base.files, file('assets/index-m.js', 5_000), file('assets/motion-n.js', 1_500), file('assets/warp-w.js', 1_000)] };
    const rows = evaluate(lazy, LIMITS);
    expect(rowOf(rows, MOTION_ROW)).toMatchObject({ status: 'PASS', valueBytes: 6_500 });
    expect(rowOf(rows, 'engine closure JS (br)')).toMatchObject({ status: 'PASS', valueBytes: 150_000 });
    const statically = { ...manifest, [ENGINE_SRC]: { ...engine, imports: [...(engine.imports ?? []), MOTION] } };
    const row = rowOf(evaluate({ ...lazy, manifest: statically }, LIMITS), MOTION_ROW);
    expect(row.status).toBe('FAIL');
    expect(row.note).toContain(`${MOTION} is in the engine closure`);
  });

  test('budget: every row is printed', () => {
    // A failing manifest does not stop later rows (no bail). PENDING: the engine row, the first-line row while the
    // engine is absent, the four lazy rows while app/yields.ts is, the two meta rows while app/meta.ts is, the
    // purchase-flow and overlays rows while app/game.ts is, and the scene-motion row while scene/controller.ts is; with
    // no manifest the first-line row FAILs.
    const cases: ReadonlyArray<readonly [BudgetInputs, number]> = [
      [inputs(), 11],
      [inputs({ manifest: null }), 10],
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
    writeDist(dist, noise(370_000, 42)); // over the 365 KB of all JS too
    writeRepo(join(tmp, 'repo'), { bgWidth: 4096 });
    const r = runCli(dist, SCRIPT, [], ['--root', join(tmp, 'repo')]);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^entry closure JS \(br\) \| 370\.\d KB \| 40\.0 KB \| FAIL/m);
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
    expect(r.stdout).toContain('purchase-flow chunk (br) | — | 2.0 KB | PENDING | src/app/game.ts absent');
    expect(r.stdout).toContain('overlays chunk (br) | — | 3.0 KB | PENDING | src/app/game.ts absent');
    expect(r.stdout).toContain('scene-motion chunk (br) | — | 8.0 KB | PENDING | src/scene/controller.ts absent');
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
  /** build/shots.json's legacy flag for the chapter (absent: true, it names sprites). */
  sprites?: boolean;
};

/** One window as build/shots.json writes it (shots §3.4 `Lookahead`); an unset term is empty. */
type WindowSpec = { cur?: string[]; certain?: string[]; certainDist?: number; possible?: string[]; labels?: boolean };
/** One chapter of build/shots.json: its windows, its entry alternatives per window, its legacy flag (default false). */
type ShotChapterSpec = { look: Record<string, WindowSpec>; entry?: Record<string, string[][]>; sprites?: boolean };

/**
 * build/shots.json for `chapters`, decoded through `decodeShotUsage`: one need per shot its windows and entries name, the
 * face and talk files' characters as face members of that shot with those expressions, cast-less otherwise (as the
 * real file has for a shot `story/shots.json` does not declare).
 */
function shotUsageOf(chapters: Readonly<Record<string, ShotChapterSpec>>): ShotUsage {
  const chapter = (c: ShotChapterSpec): Record<string, unknown> => {
    const files = [...Object.values(c.look).flatMap((w) => [...(w.cur ?? []), ...(w.certain ?? []), ...(w.possible ?? [])]), ...Object.values(c.entry ?? {}).flat(2)];
    const shots = new Map<string, Map<string, Map<string, boolean>>>();
    for (const f of files) {
      const [ns, s, char, expr] = f.split('/');
      if (s === undefined || !['bg', 'sheet', 'face', 'talk'].includes(ns ?? '')) {
        continue;
      }
      const faces = shots.get(s) ?? new Map<string, Map<string, boolean>>();
      shots.set(s, faces);
      if (char !== undefined && expr !== undefined) {
        const exprs = faces.get(char) ?? new Map<string, boolean>();
        faces.set(char, exprs);
        exprs.set(expr, (exprs.get(expr) ?? false) || ns === 'talk');
      }
    }
    const need = (faces: Map<string, Map<string, boolean>>): Record<string, unknown> => ({
      camTargets: [],
      cast: Object.fromEntries([...faces.keys()].map((ch) => [ch, { figure: false, rest: 'rest', view: 'face' }])),
      faces: Object.fromEntries([...faces].map(([ch, exprs]) => [ch, [...exprs].map(([expr, talk]) => ({ expr, lines: [], talk }))])),
      frame: 'wide',
      loc: 'here',
      motions: [],
      room: null,
    });
    const window = (w: WindowSpec): Record<string, unknown> => {
      const certain = w.certain ?? [];
      const possible = w.possible ?? [];
      const certainDist = w.certainDist ?? (certain.length > 0 ? 1 : 0);
      return { certain, certainDist, cur: w.cur ?? [], d2: [], d3: [], labels: w.labels ?? false, near: possible.length, possible };
    };
    return {
      assets: [...new Set(files.filter((f) => /^(?:bg|sheet|face|talk)\//.test(f)))].sort(),
      entry: c.entry ?? Object.fromEntries(Object.keys(c.look).map((k) => [k, []])),
      look: Object.fromEntries(Object.entries(c.look).map(([k, w]) => [k, window(w)])),
      shots: Object.fromEntries([...shots].map(([s, faces]) => [s, need(faces)])),
      sprites: c.sprites ?? false,
    };
  };
  return decodedOrThrow(decodeShotUsage({ chapters: Object.fromEntries(Object.entries(chapters).map(([id, c]) => [id, chapter(c)])) }), 'shots');
}

/**
 * The legacy build/shots.json of `specs` (the pin C1 moves, shots §3.6): one `k:<knot>` window per knot holding the
 * knot's images, its one entry alternative those images, `sprites: true` unless the spec says otherwise; one cast-less
 * need per bg of the specs.
 */
function legacyShots(specs: readonly ChapterSpec[]): ShotUsage {
  return shotUsageOf(
    Object.fromEntries(
      specs.map((s) => {
        const images = (ids: readonly string[]): string[] => ids.filter((id) => !id.startsWith('bgm/') && !id.startsWith('sfx/'));
        const look = Object.fromEntries(Object.entries(s.knots).map(([k, v]) => [`k:${k}`, { cur: images(v.assets) }]));
        const entry = Object.fromEntries(Object.entries(s.knots).map(([k, v]) => [`k:${k}`, [images(v.assets)]]));
        return [s.id, { look, entry, sprites: s.sprites ?? true }];
      }),
    ),
  );
}

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
    shotList: true,
    shots: legacyShots(specs),
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

/** One usage room of a fixture: its bg, props and close-ups (default none), and the room keys its exits lead to, in order. */
type RoomSpec = { bg: string; props?: readonly string[]; closeups?: readonly string[]; to?: readonly string[] };

/**
 * The usage rooms of `spec` (`<ch>/<section>/<room>` keys), as emit.ts writes them: `neighbourRooms` the `to` keys in
 * their order, `neighbours` the bgs of those of them `spec` holds, sorted and once each.
 */
function usageRooms(spec: Readonly<Record<string, RoomSpec>>): AssetInputs['rooms'] {
  const bgOf = (key: string): string[] => (Object.hasOwn(spec, key) ? [spec[key]?.bg ?? ''] : []);
  const rooms = Object.fromEntries(
    Object.entries(spec).map(([key, r]) => {
      const to = r.to ?? [];
      const neighbours = [...new Set(to.flatMap(bgOf))].sort();
      return [key, { bg: r.bg, props: r.props ?? [], closeups: r.closeups ?? [], neighbours, neighbourRooms: to }];
    }),
  );
  return rooms as unknown as AssetInputs['rooms']; // ids are fixture literals
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
    const room = { bg: 'bg/hall', props, closeups: ['cg/drawer'] };
    const rows = assetRows({ ...a, rooms: usageRooms({ 'ch1/hall/main': room }) });
    const row = rowOf(rows, 'room-set ch1/hall/main');
    expect(row).toMatchObject({ status: 'FAIL', unit: 'MiB', valueBytes: 2 * (1080 * 2048 * 4 + 150_000) + 16 * (MIB + 30_000) });
    expect(((row.valueBytes ?? 0) / MIB).toFixed(1)).toBe('33.6');
    // Without the close-up the same room fits (25.0 MiB): the close-up term is what tips it.
    const open = assetRows({ ...a, rooms: usageRooms({ 'ch1/hall/main': { ...room, closeups: [] } }) });
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
    const rooms = usageRooms({ 'ch1/hall/main': { bg: 'bg/hall', props, to: ['ch1/hall/yard'] }, 'ch1/hall/yard': { bg: 'bg/yard' } });
    const rows = assetRows({ ...a, rooms });
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
        'transfer over 12 MB',
        () =>
          assetInputs(
            specsWith('ch1', (s) => {
              for (const n of ['a', 'b', 'c', 'd', 'e']) {
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
      ['bg not 2048 high', entry('bg/cafe', img('bg-cafe-0a0a0a0a', 1080, 1920)), 'image bg/cafe', 'not a plate (h 2048, w even 1080-1440)'],
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
    const room = { bg: 'bg/cafe', closeups: ['cg/drawer'], to: ['ch1/hall/street'] };
    const street = { bg: 'bg/street' };
    const roomRow = rowOf(assetRows({ ...a, rooms: usageRooms({ 'ch1/hall/main': room, 'ch1/hall/street': street }) }), 'room-set ch1/hall/main');
    expect(roomRow.status).toBe('FAIL');
    expect(roomRow.note).toContain("not in ch1's manifest: cg/drawer");
    const fits = { ...room, closeups: [] };
    expect(rowOf(assetRows({ ...a, rooms: usageRooms({ 'ch1/hall/main': fits, 'ch1/hall/street': street }) }), 'room-set ch1/hall/main').status).toBe('PASS');
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
    expect(half).toMatchObject({ limitBytes: 12_000_000, status: 'PASS' });
    // A chapter with no half counts what its full row counts.
    expect(rowOf(rows, 'transfer ch2 (half)').valueBytes).toBe(rowOf(rows, 'transfer ch2').valueBytes);
    // A chapter without a manifest cannot be summed.
    const a = assetInputs();
    const noManifest = assetRows({ ...a, chapters: a.chapters.map((c) => (c.id === 'ch2' ? { ...c, manifest: null } : c)) });
    expect(rowOf(noManifest, 'transfer ch2 (half)')).toMatchObject({ status: 'FAIL', note: 'manifest missing' });
  });

  test('budget: transfer limit is 12 MB', () => {
    // OQ5 (RULINGS 154): the owner's default, 12 MB per chapter (shots §5.11: a shot chapter's images and audio ~9.2 to
    // ~10.6 MB), on the full and the half transfer rows alike.
    expect(LIMITS.transfer).toBe(12_000_000);
    // ch1's base assets are 652,844 B; four 2,836,789 B clips bring it to exactly 12,000,000.
    const at = (extra: number): Row[] =>
      assetRows(
        assetInputs(
          specsWith('ch1', (s) => {
            for (const [i, n] of ['a', 'b', 'c', 'd'].entries()) {
              s.assets[`bgm/${n}`] = clip('bgm', `bgm-${n}-2a2a2a2a`, 2_836_789 + (i === 0 ? extra : 0), 60_000, 'm4a');
            }
          }),
        ),
      );
    for (const name of ['transfer ch1', 'transfer ch1 (half)']) {
      expect(rowOf(at(0), name), name).toMatchObject({ status: 'PASS', valueBytes: 12_000_000, limitBytes: 12_000_000 });
      expect(rowOf(at(1), name), name).toMatchObject({ status: 'FAIL', valueBytes: 12_000_001 });
    }
  });

  test('budget: a room plate that is not 1080 x 2048 fails', () => {
    // Shots §4.4: a shot's plate may be up to 1440 wide (m10), a room's is exactly 1080 x 2048 (the explore view lays its
    // hotspots on that frame). The same 1440 plate passes as a shot's and fails as a room's, naming the room.
    const a = assetInputs(specsWith('ch1', (s) => (s.assets['bg/hall'] = img('bg-hall-0a0a0a0a', 1440, 2048, 300_000, 450_000))));
    const shot = rowOf(assetRows(a), 'image bg/hall');
    expect(shot.status, shot.note).toBe('PASS');
    const inRoom = (x: AssetInputs): Row => rowOf(assetRows({ ...x, rooms: usageRooms({ 'ch1/manor/hall': { bg: 'bg/hall' } }) }), 'image bg/hall');
    const row = inRoom(a);
    expect(row.status).toBe('FAIL');
    expect(row.note).toBe('1440×2048, not exactly 1080×2048 (room plate ch1/manor/hall)');
    // Control: a 1080 room plate passes.
    expect(inRoom(assetInputs(specsWith('ch1', (s) => (s.assets['bg/hall'] = bg('hall'))))).status).toBe('PASS');
  });

  test("budget: a 1440 plate's file limit scales with its width", () => {
    // Shots §4.4 (m10): a plate is 2048 high and an even width from 1080 to 1440, its files at most floor(300,000 x w /
    // 1080) B AVIF and floor(450,000 x w / 1080) B WebP: 400,000 and 600,000 at 1440, a 1080 plate's limits unchanged.
    const plate = (w: number, avif: number, webp: number, half?: number): Row => {
      const e = img('bg-cafe-0a0a0a0a', w, 2048, avif, webp);
      return rowOf(assetRows(assetInputs(specsWith('ch1', (s) => (s.assets['bg/cafe'] = half === undefined ? e : halved(e, half))))), 'image bg/cafe');
    };
    const at1440 = plate(1440, 400_000, 600_000);
    expect(at1440.status, at1440.note).toBe('PASS');
    expect(at1440.limitBytes).toBe(400_000);
    expect(plate(1440, 400_001, 600_000)).toMatchObject({ status: 'FAIL', note: 'AVIF 400.0 KB over 400.0 KB' });
    expect(plate(1440, 400_000, 600_001)).toMatchObject({ status: 'FAIL', note: 'WebP 600.0 KB over 600.0 KB' });
    expect(plate(1260, 350_000, 525_000)).toMatchObject({ status: 'PASS', limitBytes: 350_000 });
    expect(plate(1080, 300_001, 450_000)).toMatchObject({ status: 'FAIL', limitBytes: 300_000, note: 'AVIF 300.0 KB over 300.0 KB' });
    // A half is held to its full file's scaled limit, as today.
    expect(plate(1440, 300_000, 450_000, 400_001)).toMatchObject({ status: 'FAIL', note: 'half AVIF 400.0 KB over 400.0 KB' });
    // The width bounds: an odd width, one over 1440 and one under 1080 are no plate.
    for (const w of [1081, 1442, 1078]) {
      const row = plate(w, 100_000, 150_000);
      expect(row.status, `${w}`).toBe('FAIL');
      expect(row.note).toBe(`${w}×2048, not a plate (h 2048, w even 1080-1440)`);
    }
  });

  test("budget: room-set counts the room's sheet", () => {
    // Per-player §6.5 (Reconcile P2): img(n) = bg(n) + sheet(n), so room-set counts img(room) + props + max(the largest
    // neighbour's img + props, the largest close-up).
    const sheeted = specsWith('ch1', (s) => {
      Object.assign(s.assets, { 'bg/hall': bg('hall'), 'sheet/hall': cuSheetOf('hall'), 'bg/yard': bg('yard'), 'sheet/yard': cuSheetOf('yard'), 'cg/drawer': cg('drawer') });
    });
    const rooms = usageRooms({ 'ch1/manor/hall': { bg: 'bg/hall', closeups: ['cg/drawer'], to: ['ch1/manor/yard'] }, 'ch1/manor/yard': { bg: 'bg/yard' } });
    const roomRow = (a: AssetInputs): Row => rowOf(assetRows({ ...a, rooms }), 'room-set ch1/manor/hall');
    const a = assetInputs(sheeted);
    const plate = 1080 * 2048 * 4 + 150_000;
    const sheet = fullOf(cuSheetOf('hall'));
    const row = roomRow(a);
    expect(row.valueBytes).toBe(plate + sheet + (plate + sheet));
    expect(row).toMatchObject({ status: 'PASS', note: 'bg + 0 props + max(neighbour bg + props, close-up) (+ sheets); preloads 1 of 1 neighbours' });
    const manifest = chapterOf(a, 'ch1').manifest;
    if (manifest === null) {
      throw new Error('invariant: ch1 has a manifest');
    }
    expect(imgIds(manifest.value, 'bg/hall' as AssetId)).toEqual(['bg/hall', 'sheet/hall']);
    expect(imgIds(manifest.value, 'bg/cafe' as AssetId)).toEqual(['bg/cafe']);
    // Control: without sheets the room counts bg + max(neighbour bg + props, close-up), and its note has no sheets.
    const bare = roomRow(assetInputs(specsWith('ch1', (s) => Object.assign(s.assets, { 'bg/hall': bg('hall'), 'bg/yard': bg('yard'), 'cg/drawer': cg('drawer') }))));
    expect(bare).toMatchObject({ status: 'PASS', valueBytes: 2 * plate, note: 'bg + 0 props + max(neighbour bg + props, close-up); preloads 1 of 1 neighbours' });
  });

  test('budget: room-set counts the transition pair', () => {
    // Engine plan §6.3 "Gates" (O5): a crossfade has both rooms' sets on stage (`syncProps` fades both), so the row is
    // img(R) + props(R) + max over R's neighbour rooms n of (img(n) + props(n)), or the largest close-up. The hall has
    // no prop of its own and fails on the study's 16.
    const studyProps = Array.from({ length: 16 }, (_, i) => `prop/s${i}`);
    const a = assetInputs(
      specsWith('ch1', (s) => {
        Object.assign(s.assets, { 'bg/hall': bg('hall'), 'bg/yard': bg('yard'), 'bg/study': bg('study'), 'cg/drawer': cg('drawer') });
        for (const p of studyProps) {
          s.assets[p] = prop(p.slice('prop/'.length));
        }
      }),
    );
    const plate = 1080 * 2048 * 4 + 150_000;
    const one = 512 * 512 * 4 + 30_000;
    const hall = (props: number, to: readonly string[] = ['ch1/manor/yard', 'ch1/manor/study']): Row => {
      const rooms = usageRooms({
        'ch1/manor/hall': { bg: 'bg/hall', closeups: ['cg/drawer'], to },
        'ch1/manor/yard': { bg: 'bg/yard', to: ['ch1/manor/hall'] },
        'ch1/manor/study': { bg: 'bg/study', props: studyProps.slice(0, props), to: ['ch1/manor/hall'] },
      });
      return rowOf(assetRows({ ...a, rooms }), 'room-set ch1/manor/hall');
    };
    const row = hall(16);
    expect(row).toMatchObject({ status: 'FAIL', unit: 'MiB', valueBytes: plate + (plate + 16 * one) });
    expect(row.valueBytes).toBe(35_251_936);
    expect(row.note).toContain('max(neighbour bg + props, close-up)');
    // Control: with 7 props on the study the pair fits.
    expect(hall(7)).toMatchObject({ status: 'PASS', valueBytes: 25_544_752 });
    // A neighbour room usage.json lacks cannot be summed: FAIL, not a smaller PASS.
    const unknown = hall(7, ['ch1/manor/yard', 'ch1/manor/study', 'ch1/manor/attic']);
    expect(unknown).toMatchObject({ status: 'FAIL', valueBytes: null });
    expect(unknown.note).toContain('neighbour room ch1/manor/attic not in usage.json');
  });

  test("budget: the transition pair counts each room's sheet", () => {
    // Reconcile r1 (design-shots I-3): every image term of the pair goes through `imgIds`, the neighbour's sheet beside
    // its props: hall (plate + sheet) + yard (plate + room sheet + 4 props).
    const yardProps = ['prop/y0', 'prop/y1', 'prop/y2', 'prop/y3'];
    const a = assetInputs(
      specsWith('ch1', (s) => {
        Object.assign(s.assets, { 'bg/hall': bg('hall'), 'sheet/hall': cuSheetOf('hall'), 'bg/yard': bg('yard'), 'sheet/yard': roomSheetOf('yard') });
        for (const p of yardProps) {
          s.assets[p] = prop(p.slice('prop/'.length));
        }
      }),
    );
    const rooms = usageRooms({
      'ch1/manor/hall': { bg: 'bg/hall', to: ['ch1/manor/yard'] },
      'ch1/manor/yard': { bg: 'bg/yard', props: yardProps, to: ['ch1/manor/hall'] },
    });
    const plate = 1080 * 2048 * 4 + 150_000;
    const row = rowOf(assetRows({ ...a, rooms }), 'room-set ch1/manor/hall');
    expect(row.valueBytes).toBe(plate + fullOf(cuSheetOf('hall')) + (plate + fullOf(roomSheetOf('yard')) + 4 * (512 * 512 * 4 + 30_000)));
    expect(row).toMatchObject({ status: 'PASS', valueBytes: 29_062_784 });
    expect(row.note).toContain('(+ sheets)');
  });

  test('budget: room-set notes how many neighbours preload', () => {
    // Engine plan §6.3 "Preload (m2)", a report and never a FAIL: R's own images first, then each neighbour room's
    // img(n) first-fit under the steady cap (a refused one is skipped, an id already in the set joins at no byte), in
    // the worst order the runtime meets: plain exit order (a first entry), or, arrived from t, t and the neighbours R
    // shares with t first (live at arrival), then the rest in exit order.
    const m = (room: string): string => `ch1/manor/${room}`;
    const back = (room: string): RoomSpec['to'] => [m(room)];
    const inputsWith = (assets: Readonly<Record<string, AssetEntry>>): AssetInputs => assetInputs(specsWith('ch1', (s) => Object.assign(s.assets, assets)));
    const propSet = (prefix: string, n: number): Record<string, AssetEntry> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`prop/${prefix}${i}`, prop(`${prefix}${i}`)]));
    const roomRow = (a: AssetInputs, spec: Readonly<Record<string, RoomSpec>>, room = 'hall'): Row => rowOf(assetRows({ ...a, rooms: usageRooms(spec) }), `room-set ${m(room)}`);
    const formula = 'bg + 6 props + max(neighbour bg + props, close-up)';
    const six = propSet('h', 6);
    const hall = { bg: 'bg/hall', props: Object.keys(six) };
    // (A) Own 15,468,816 B leaves 18,085,616: exit order admits a and b and refuses c (13,130,032 with its sheet);
    // arrived from c, c is live and a and b load on tap. The worst order decides.
    const worst = inputsWith({ 'bg/hall': bg('hall'), ...six, 'bg/a': bg('a'), 'bg/b': bg('b'), 'bg/c': bg('c'), 'sheet/c': cuSheetOf('c') });
    const abc = { [m('hall')]: { ...hall, to: [m('a'), m('b'), m('c')] }, [m('a')]: { bg: 'bg/a', to: back('hall') }, [m('b')]: { bg: 'bg/b', to: back('hall') }, [m('c')]: { bg: 'bg/c', to: back('hall') } };
    expect(roomRow(worst, abc)).toMatchObject({ status: 'PASS', valueBytes: 28_598_848, note: `${formula} (+ sheets); preloads 1 of 3 neighbours (on tap: a, b)` });
    // (A') A refusal is skipped, not a stop: exit order admits x and z around y; arrived from y, x and z load on tap.
    const skip = inputsWith({ 'bg/hall': bg('hall'), ...six, 'bg/x': bg('x'), 'bg/y': bg('y'), 'sheet/y': cuSheetOf('y'), 'bg/z': bg('z') });
    const xyz = { [m('hall')]: { ...hall, to: [m('x'), m('y'), m('z')] }, [m('x')]: { bg: 'bg/x', to: back('hall') }, [m('y')]: { bg: 'bg/y', to: back('hall') }, [m('z')]: { bg: 'bg/z', to: back('hall') } };
    expect(roomRow(skip, xyz).note).toBe(`${formula} (+ sheets); preloads 1 of 3 neighbours (on tap: x, z)`);
    // (B) Two neighbour rooms on one plate: the second joins the first's bg at no byte, so every order admits all three.
    const shared = inputsWith({ 'bg/hall': bg('hall'), ...six, 'bg/a': bg('a'), 'bg/c': bg('c') });
    const onePlate = { [m('hall')]: { ...hall, to: [m('a'), m('b'), m('c')] }, [m('a')]: { bg: 'bg/a', to: back('hall') }, [m('b')]: { bg: 'bg/a', to: back('hall') }, [m('c')]: { bg: 'bg/c', to: back('hall') } };
    expect(roomRow(shared, onePlate).note).toBe(`${formula}; preloads 3 of 3 neighbours`);
    // (C) The registry admits a preload while used + need <= the cap: exactly the cap admits, one byte more refuses
    // (and the row fails by that byte).
    const fourteen = propSet('r', 14);
    const edge = (webp: number): Row =>
      roomRow(
        inputsWith({ 'bg/r': img('bg-r-0a0a0a0a', 1080, 2048, 100_000, webp), ...fourteen, 'bg/a': img('bg-a-0a0a0a0a', 1080, 2048, 100_000, 450_000) }),
        { [m('r')]: { bg: 'bg/r', props: Object.keys(fourteen), to: [m('a')] }, [m('a')]: { bg: 'bg/a', to: back('r') } },
        'r',
      );
    const edgeFormula = 'bg + 14 props + max(neighbour bg + props, close-up)';
    expect(edge(309_648)).toMatchObject({ status: 'PASS', valueBytes: STEADY_CAP_BYTES, note: `${edgeFormula}; preloads 1 of 1 neighbours` });
    expect(edge(309_649)).toMatchObject({ status: 'FAIL', valueBytes: STEADY_CAP_BYTES + 1, note: `${edgeFormula}; preloads 0 of 1 neighbours (on tap: a)` });
    // (D) No neighbour.
    expect(roomRow(worst, { [m('hall')]: hall }).note).toBe(`${formula}; preloads 0 of 0 neighbours`);
    // (E) The three-room cycle P <-> R <-> t2 <-> P (critique O2; u = 2,000,000 B, R's own set leaves 10u): from t1 (P),
    // t1 and t2 (a neighbour R shares with t1) are live first and fill the space, so s1 and s2 load on tap; exit order
    // and "t1, then exit order" would both admit three.
    const u = 2_000_000;
    const sized = (id: string, bytes: number): ImageEntry => img(`${id.replace('/', '-')}-0a0a0a0a`, 500, 500, bytes - 1_000_000, bytes - 1_000_000);
    const cycle = inputsWith({ 'bg/r': sized('bg/r', STEADY_CAP_BYTES - 10 * u), 'bg/s1': sized('bg/s1', u), 'bg/s2': sized('bg/s2', u), 'bg/t1': sized('bg/t1', 5 * u), 'bg/t2': sized('bg/t2', 5 * u) });
    const rooms = {
      [m('r')]: { bg: 'bg/r', to: [m('s1'), m('s2'), m('t1'), m('t2')] },
      [m('s1')]: { bg: 'bg/s1', to: back('r') },
      [m('s2')]: { bg: 'bg/s2', to: back('r') },
      [m('t1')]: { bg: 'bg/t1', to: [m('r'), m('t2')] },
      [m('t2')]: { bg: 'bg/t2', to: [m('r'), m('t1')] },
    };
    expect(roomRow(cycle, rooms, 'r')).toMatchObject({
      status: 'PASS',
      valueBytes: STEADY_CAP_BYTES - 10 * u + 5 * u,
      note: 'bg + 0 props + max(neighbour bg + props, close-up); preloads 2 of 4 neighbours (on tap: s1, s2)',
    });
  });

  test('budget: a loop prop atlas is held to its own limits', () => {
    // Shots §4.4 (W10): a loop prop's frames are one atlas `prop/<id>`, at most 2048 per side and 200,000 / 300,000 B,
    // not a still prop's 512 x 512 and 60,000 / 90,000 B; a still prop keeps its own.
    const catalog = decodedOrThrow(
      decodeAssetCatalog({ ...CATALOG_RAW, prop: { flame: { loop: { placeholder: { hue: 30, frames: 8 }, fps: 8 } }, note: { placeholder: { hue: 40 } } } }),
      'catalog',
    );
    const atlas = (w: number, h: number, avif: number, webp: number, id = 'prop/flame'): Row => {
      const a = assetInputs(specsWith('ch1', (s) => (s.assets[id] = img(`prop-${id.slice('prop/'.length)}-0d0d0d0d`, w, h, avif, webp))));
      return rowOf(assetRows({ ...a, catalog }), `image ${id}`);
    };
    const fits = atlas(1024, 512, 150_000, 250_000);
    expect(fits.status, fits.note).toBe('PASS');
    expect(fits.limitBytes).toBe(200_000);
    expect(atlas(2050, 512, 150_000, 250_000)).toMatchObject({ status: 'FAIL', note: '2050×512 over 2048 px' });
    expect(atlas(1024, 512, 200_001, 250_000)).toMatchObject({ status: 'FAIL', note: 'AVIF 200.0 KB over 200.0 KB' });
    expect(atlas(1024, 512, 150_000, 300_001)).toMatchObject({ status: 'FAIL', note: 'WebP 300.0 KB over 300.0 KB' });
    // A still prop at 1024 px still fails its 512 x 512.
    expect(atlas(1024, 512, 20_000, 30_000, 'prop/note')).toMatchObject({ status: 'FAIL', note: '1024×512, over 512×512 (prop)' });
  });

  test('budget: a sheet over 2048 px fails', () => {
    // Shots §4.4: a shot's packed file is at most 2048 per side. The kind's own rule (DIMS.sheet) is pinned by its own
    // message, beside the status: MAX_SIDE writes `… over 2048 px` for the same input, so a status alone would not
    // notice the kind's rule gone.
    const sheet = (w: number, h: number): Row => rowOf(assetRows(assetInputs(specsWith('ch1', (s) => (s.assets['sheet/cafe'] = img('sheet-cafe-5b5b5b5b', w, h, 100_000, 150_000))))), 'image sheet/cafe');
    const row = sheet(4096, 1024);
    expect(row.status).toBe('FAIL');
    expect(row.note).toContain('4096×1024, over 2048×2048 (sheet)');
    expect(row.note).toContain('4096×1024 over 2048 px');
    expect(sheet(2048, 1024).status).toBe('PASS'); // control
  });

  test('budget: a sheet file over its limit fails', () => {
    // Shots §4.4: a sheet's outlier guard, 200,000 B AVIF and 300,000 B WebP.
    const sheet = (avif: number, webp: number): Row => rowOf(assetRows(assetInputs(specsWith('ch1', (s) => (s.assets['sheet/cafe'] = img('sheet-cafe-5b5b5b5b', 1026, 968, avif, webp))))), 'image sheet/cafe');
    expect(sheet(200_000, 300_000)).toMatchObject({ status: 'PASS', limitBytes: 200_000 });
    expect(sheet(200_001, 300_000)).toMatchObject({ status: 'FAIL', note: 'AVIF 200.0 KB over 200.0 KB' });
    expect(sheet(200_000, 300_001)).toMatchObject({ status: 'FAIL', note: 'WebP 300.0 KB over 300.0 KB' });
  });

  test('budget: a face file and a talk file over their limits fail', () => {
    // Shots §4.4 (rev. 4): a face file (one expression) 120,000 / 180,000 B; a talk file 30,000 / 45,000 B.
    const file = (id: string, avif: number, webp: number): Row =>
      rowOf(assetRows(assetInputs(specsWith('ch1', (s) => (s.assets[id] = img(`${id.split('/').join('-')}-5a5a5a5a`, 512, 512, avif, webp))))), `image ${id}`);
    const cases = [
      ['face/cafe/ally/smile', 120_000, 180_000],
      ['talk/cafe/ally/smile', 30_000, 45_000],
    ] as const;
    for (const [id, avif, webp] of cases) {
      expect(file(id, avif, webp), id).toMatchObject({ status: 'PASS', limitBytes: avif });
      expect(file(id, avif + 1, webp), id).toMatchObject({ status: 'FAIL', note: `AVIF ${(avif / 1000).toFixed(1)} KB over ${(avif / 1000).toFixed(1)} KB` });
      expect(file(id, avif, webp + 1), id).toMatchObject({ status: 'FAIL', note: `WebP ${(webp / 1000).toFixed(1)} KB over ${(webp / 1000).toFixed(1)} KB` });
    }
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
      expect(r.stdout).toMatch(/^transfer ch1 \| — \| 12000\.0 KB \| FAIL \| manifest missing$/m);
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
        /^transfer ch1 \| .* \| 12000\.0 KB \| PASS/m,
        /^first knot images ch1 \| .* \| 450\.0 KB \| PASS/m,
        /^world json \| — \| 8\.0 KB \| PENDING/m,
        /^image bg\/cafe \| .* \| 300\.0 KB \| PASS \| 1080×2048/m,
        /^image cover\/manor \| .* \| 24\.0 KB \| PASS \| 360×640/m,
        /^audio bgm\/calm \| .* \| 400\.0 KB \| PASS \| wav, 8000 ms$/m,
        /^knot-set ch1\/start \| 8\.4 MiB \| 32\.0 MiB \| PASS/m,
        /^room-set \| — \| 32\.0 MiB \| PENDING/m,
        /^first-load ch1 \| .* \| 800\.0 KB \| PENDING/m,
        /^step-window \| — \| 32\.0 MiB \| PENDING \| no story\/shots\.json \(the shot pass is opt-in\)$/m,
        /^entry step images \| — \| 279\.0 KB \| PENDING \| no story\/shots\.json \(the shot pass is opt-in\)$/m,
      ]) {
        expect(r.stdout).toMatch(row);
      }
      // No client/src/app/*.ts under --root: the engine, first-line, four yields, two meta, purchase-flow and overlays
      // rows, and world json, room-set and first-load ch1 (lever P added the purchase-flow row, lever O5 the overlays');
      // no client/src/scene/controller.ts: the scene-motion row; no story/shots.json: the step-window and entry step
      // images rows (SH3b).
      expect(r.stdout).toMatch(/^budget: \d+ rows, \d+ PASS, 0 FAIL, 16 PENDING$/m);
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

// ---------------------------------------------------------------------------------------------------------------
// SH3b: the step model's rows (shots §3.4, §5.9, §5.11) on hand-built build/shots.json, decoded through
// `decodeShotUsage`, over manifests at §5.9's records (A): a 1080 plate 8.762 MiB, a 1440 plate 11.682, a close-up (CU)
// 12.703 on a 1080 plate and 15.623 on a 1440 one, a room shot with its props and label bound 16.562; kept bytes: a CU
// 500,000 B (0.477 MiB), a wide 380,000 B (0.362).

/** The gate's `full` (decoded + the larger kept file) and `kept` (the larger kept file alone) of an entry. */
const fullOf = (e: AssetEntry): number => (e.kind === 'image' ? e.decodedBytes + Math.max(e.avif.bytes, e.webp.bytes) : 0);
const keptOf = (e: AssetEntry): number => (e.kind === 'image' ? Math.max(e.avif.bytes, e.webp.bytes) : 0);
const sumFull = (files: Readonly<Record<string, AssetEntry>>): number => Object.values(files).reduce((s, e) => s + fullOf(e), 0);
const sumKept = (files: Readonly<Record<string, AssetEntry>>): number => Object.values(files).reduce((s, e) => s + keptOf(e), 0);
const mibOf = (bytes: number | null): string => ((bytes ?? Number.NaN) / MIB).toFixed(3);
const ids = (files: Readonly<Record<string, AssetEntry>>): string[] => Object.keys(files).sort();

/** A shot's plate: 1080 x 2048 (WebP kept 340,000 B: 8.762 MiB) or 1440 x 2048 (453,000 B: 11.682 MiB). */
function plateOf(s: string, w: 1080 | 1440 = 1080): ImageEntry {
  return w === 1080 ? img(`bg-${s}-5a5a5a5a`, 1080, 2048, 225_000, 340_000) : img(`bg-${s}-5a5a5a5a`, 1440, 2048, 300_000, 453_000);
}
/** A CU's sheet, the 0.5 MiB ambient allowance held in its pixels: 3.941 MiB (kept 160,000 B). */
const cuSheetOf = (s: string): ImageEntry => img(`sheet-${s}-5b5b5b5b`, 1026, 968, 103_445, 160_000);
/** A room shot's sheet (a frame loop and the ambient allowance): 2.500 MiB. */
const roomSheetOf = (s: string): ImageEntry => img(`sheet-${s}-5c5c5c5c`, 512, 1231, 70_000, 100_000);
/** A wide shot's sheet: kept 40,000 B, so the wide's kept bytes are 380,000 B. */
const wideSheetOf = (s: string): ImageEntry => img(`sheet-${s}-5d5d5d5d`, 2048, 175, 25_000, 40_000);

/** A CU shot `s`: its plate and its sheet. */
function cuShot(s: string, w: 1080 | 1440 = 1080): Record<string, AssetEntry> {
  return { [`bg/${s}`]: plateOf(s, w), [`sheet/${s}`]: cuSheetOf(s) };
}
/** A wide shot `s`: its plate and its sheet. */
function wideShot(s: string): Record<string, AssetEntry> {
  return { [`bg/${s}`]: plateOf(s), [`sheet/${s}`]: wideSheetOf(s) };
}
/** A room's shot `r`: its plate, its sheet and its props (3.300 MiB: three of 512 x 512 and one of 96 x 96). */
function roomShot(r: string): Record<string, AssetEntry> {
  const p = (n: string, side: number, avif: number, webp: number): [string, AssetEntry] => [`prop/${r}_${n}`, img(`prop-${r}_${n}-5e5e5e5e`, side, side, avif, webp)];
  const props = [p('a', 512, 60_000, 90_000), p('b', 512, 60_000, 90_000), p('c', 512, 60_000, 90_000), p('d', 96, 5_000, 8_000)];
  return { [`bg/${r}`]: plateOf(r), [`sheet/${r}`]: roomSheetOf(r), ...Object.fromEntries(props) };
}
const propsOf = (files: Readonly<Record<string, AssetEntry>>): string[] => ids(files).filter((id) => id.startsWith('prop/'));

/** One free chapter ch1 holding `assets`, its build/shots.json `c`, and the usage rooms `rooms` (`<ch>/<section>/<room>`). */
function shotInputs(assets: Record<string, AssetEntry>, c: ShotChapterSpec, rooms: Readonly<Record<string, { bg: string; props: string[] }>> = {}): AssetInputs {
  const a = assetInputs([{ id: 'ch1', paid: false, next: null, assets, knots: { scene: { assets: [], next: [] } } }]);
  return { ...a, shots: shotUsageOf({ ch1: c }), rooms: usageRooms(rooms) };
}

/** `e` with its half-tier file (exactly half per side, MEMORY-PLAN 4.C) of `avif` and `webp` bytes, beside its own. */
function halved(e: ImageEntry, avif: number, webp = avif): ImageEntry {
  const url = (u: string): string => u.replace(/\.(avif|webp)$/, '-half.$1');
  const w = e.w / 2;
  const h = e.h / 2;
  return { ...e, half: { w, h, decodedBytes: w * h * 4, avif: { url: url(e.avif.url), bytes: avif }, webp: { url: url(e.webp.url), bytes: webp } } };
}
/** `files` at the half tier: each half 0.375 x its full AVIF (§5.11's A: a quarter of the pixels at the same q). */
function atHalf(files: Readonly<Record<string, AssetEntry>>): Record<string, AssetEntry> {
  return Object.fromEntries(Object.entries(files).map(([id, e]) => [id, e.kind === 'image' ? halved(e, Math.round(e.avif.bytes * 0.375), Math.round(e.webp.bytes * 0.375)) : e]));
}
const halfAvif = (files: Readonly<Record<string, AssetEntry>>): number => Object.values(files).reduce((s, e) => s + (e.kind === 'image' ? (e.half ?? e).avif.bytes : 0), 0);
/** The chapter files the first line awaits (br), set on chapter `id` of `a`; `world` null = a world source without its output. */
function withChapterFiles(a: AssetInputs, id: string, files: { story: number; meta: number; manifest: number; en: number; world?: number | null }): AssetInputs {
  const br = (brBytes: number): { rawBytes: number; brBytes: number } => ({ rawBytes: brBytes * 3, brBytes });
  return {
    ...a,
    chapters: a.chapters.map((c) => {
      if (c.id !== id || c.meta === null || c.manifest === null) {
        return c;
      }
      const world = files.world === undefined ? null : { hasSections: false, public: files.world === null ? null : br(files.world) };
      return { ...c, story: br(files.story), meta: { ...c.meta, ...br(files.meta) }, manifest: { ...c.manifest, ...br(files.manifest) }, en: br(files.en), world };
    }),
  };
}
/** §5.11's chapter files at their medians: story 35,000, meta 2,000, manifest 14,000, world 8,000, en 15,000 = 74,000 B. */
const MEDIAN_FILES = { story: 35_000, meta: 2_000, manifest: 14_000, world: 8_000, en: 15_000 };

const K1 = 'ch1.scene.a001';
const K2 = 'ch1.scene.a002';
const CU_A = cuShot('a');
const CU_B = cuShot('b');
const CU_C = cuShot('c');
const CU_1440 = cuShot('c', 1440);
const CU = sumFull(CU_A);
const CU1440 = sumFull(CU_1440);

describe('budget shots', () => {
  test('budget: step window over 32 MiB fails', () => {
    // CU A + CU B + a 1440 CU on stage at one step: 12.703 + 12.703 + 15.623 = 41.029 MiB.
    const assets = { ...CU_A, ...CU_B, ...CU_1440 };
    const row = rowOf(assetRows(shotInputs(assets, { look: { [K1]: { cur: ids(assets) } } })), 'step-window ch1');
    expect(row).toMatchObject({ status: 'FAIL', unit: 'MiB', valueBytes: 2 * CU + CU1440, limitBytes: STEADY_CAP_BYTES });
    expect(mibOf(row.valueBytes)).toBe('41.029');
    // The limit is the registry's steady cap, one number with the knot-set and room-set rows (MEMORY-PLAN M2).
    expect(LIMITS.stepWindow).toBe(STEADY_CAP_BYTES);
    // Control: two CUs fit (25.406).
    const two = { ...CU_A, ...CU_B };
    expect(rowOf(assetRows(shotInputs(two, { look: { [K1]: { cur: ids(two) } } })), 'step-window ch1')).toMatchObject({ status: 'PASS', valueBytes: 2 * CU });
    // A window file the chapter's manifest lacks cannot be summed: FAIL, not a smaller PASS.
    const lacking = rowOf(assetRows(shotInputs(two, { look: { [K1]: { cur: [...ids(two), 'cg/ghost'] } } })), 'step-window ch1');
    expect(lacking).toMatchObject({ status: 'FAIL', valueBytes: null });
    expect(lacking.note).toContain("not in ch1's manifest: cg/ghost");
  });

  test('budget: step window counts the current shot once', () => {
    // CU A on stage, CU A and CU B certain at the next line, CU A's plate and CU B's sheet also listed as possible: every
    // file is counted once, at full: 12.703 + 12.703 = 25.406.
    const assets = { ...CU_A, ...CU_B };
    const look = { [K1]: { cur: ids(CU_A), certain: ids(assets), possible: ['bg/a', 'sheet/b'] } };
    const row = rowOf(assetRows(shotInputs(assets, { look })), 'step-window ch1');
    expect(row).toMatchObject({ status: 'PASS', valueBytes: 2 * CU });
    expect(mibOf(row.valueBytes)).toBe('25.406');
    expect(row.note).toBe(`${K1}: cur 12.70 + certain 12.70 (at 1) + possible 0.00 + labels 0.00 MiB`);
  });

  test("budget: step window counts a room's props and label bound in effect", () => {
    // §5.9: a story step in a room's shot (its props, its label bound) whose next cut is a 1440 CU: 16.562 + 15.623 =
    // 32.185, over. Without the room terms it would read 26.885 and pass.
    const hall = roomShot('hall');
    const assets = { ...hall, ...CU_1440 };
    const row = rowOf(assetRows(shotInputs(assets, { look: { [K1]: { cur: ids(hall), labels: true, certain: ids(CU_1440) } } })), 'step-window ch1');
    expect(row).toMatchObject({ status: 'FAIL', valueBytes: sumFull(hall) + LABELS_BOUND + CU1440 });
    expect(mibOf(row.valueBytes)).toBe('32.185');
    expect(mibOf(sumFull(hall) + LABELS_BOUND)).toBe('16.562');
    expect(LABELS_BOUND).toBe(4 * 512 * 256 * 4);
  });

  test('budget: step window counts a possible opener at its kept bytes', () => {
    // §5.9: a choice at CU A whose replies open on CU B and CU C: 12.703 + 2 x 0.477 = 13.657 (at full: 38.109, over).
    const assets = { ...CU_A, ...CU_B, ...CU_C };
    const row = rowOf(assetRows(shotInputs(assets, { look: { [K1]: { cur: ids(CU_A), possible: [...ids(CU_B), ...ids(CU_C)] } } })), 'step-window ch1');
    expect(row).toMatchObject({ status: 'PASS', valueBytes: CU + 2 * 500_000 });
    expect(sumKept(CU_B)).toBe(500_000);
    expect(mibOf(row.valueBytes)).toBe('13.657');
  });

  test('budget: step window counts a certain image at the step before it appears', () => {
    // §5.9: a line under a CG whose dismissal shares the next cut's batch holds CG + CU A + CU B = 34.168, over. Lever 1
    // (dismiss the CG one line earlier) moves the cut's certain term to a step without the CG: 25.406; the CG's step
    // then sees CU B at distance 2, not yet due.
    const cg = img('cg-letter-5f5f5f5f', 1080, 2048, 225_000, 340_000);
    const assets = { 'cg/letter': cg, ...CU_A, ...CU_B };
    const underCg = ['cg/letter', ...ids(CU_A)];
    const inCut = rowOf(assetRows(shotInputs(assets, { look: { [K1]: { cur: underCg, certain: ids(CU_B) } } })), 'step-window ch1');
    expect(inCut).toMatchObject({ status: 'FAIL', valueBytes: fullOf(cg) + 2 * CU });
    expect(mibOf(inCut.valueBytes)).toBe('34.168');
    const earlier = { [K1]: { cur: underCg, certain: ids(CU_B), certainDist: 2 }, [K2]: { cur: ids(CU_A), certain: ids(CU_B) } };
    const lever = rowOf(assetRows(shotInputs(assets, { look: earlier })), 'step-window ch1');
    expect(lever).toMatchObject({ status: 'PASS', valueBytes: 2 * CU });
    expect(mibOf(lever.valueBytes)).toBe('25.406');
    expect(lever.note.startsWith(`${K2}: `)).toBe(true);
  });

  test('budget: step window per room counts the room and the openers one action away', () => {
    // §5.9, the critic's fixture: a room whose three events open on distinct CUs and whose leave knot cuts to a wide:
    // 16.562 + 3 x 0.477 + 0.362 = 18.355 (at full: 64.838, over).
    const hall = roomShot('hall');
    const openers = { ...CU_B, ...CU_C, ...cuShot('d'), ...wideShot('w') };
    const look = { [K1]: { cur: ids(CU_B) }, 'r:hall': { cur: ids(hall), labels: true, possible: ids(openers) } };
    const rows = assetRows(shotInputs({ ...hall, ...openers }, { look }));
    const row = rowOf(rows, 'step-window ch1/r:hall');
    expect(row).toMatchObject({ status: 'PASS', unit: 'MiB', valueBytes: sumFull(hall) + LABELS_BOUND + 3 * 500_000 + 380_000 });
    expect(sumKept(wideShot('w'))).toBe(380_000);
    expect(mibOf(row.valueBytes)).toBe('18.355');
    expect(row.note).toBe('r:hall: cur 14.56 + certain 0.00 (at 1) + possible 1.79 + labels 2.00 MiB');
    // The room window is its own row: the chapter's row takes the story windows only.
    expect(rowOf(rows, 'step-window ch1')).toMatchObject({ status: 'PASS', valueBytes: CU });
  });

  test('budget: a failing step window prints its levers', () => {
    // Seven steps over the cap and one under: the note starts with the code, gives the worst step's terms, names the
    // failing steps worst first (five, then how many more), then §5.9's levers 1 and 2, in that order.
    const extra = { ...cuShot('e'), ...cuShot('f') };
    const assets = { ...CU_A, ...CU_B, ...CU_1440, ...extra };
    const heavy = ids({ ...CU_A, ...CU_B, ...CU_1440 });
    const look: Record<string, WindowSpec> = {
      'ch1.scene.a001': { cur: heavy },
      'ch1.scene.a002': { cur: heavy, possible: ids(cuShot('e')) },
      'ch1.scene.a003': { cur: heavy, possible: ids(extra) },
      'ch1.scene.a004': { cur: heavy, possible: ids(extra), labels: true },
      'ch1.scene.a005': { cur: heavy, labels: true },
      'ch1.scene.a006': { cur: heavy, possible: ids(cuShot('e')), labels: true },
      'ch1.scene.a007': { cur: heavy, possible: [...ids(extra), 'bg/a'], labels: true },
      'ch1.scene.a008': { cur: ids({ ...CU_A, ...CU_B }) },
    };
    const row = rowOf(assetRows(shotInputs(assets, { look })), 'step-window ch1');
    expect(row.status).toBe('FAIL');
    const head = 'budget/step-window: ch1.scene.a004: cur 41.03 + certain 0.00 (at 1) + possible 0.95 + labels 2.00 MiB; ';
    expect(row.note.startsWith(head), row.note).toBe(true);
    expect(row.note).toContain('failing: ch1.scene.a004 43.98, ch1.scene.a007 43.98, ch1.scene.a006 43.51, ch1.scene.a005 43.03, ch1.scene.a003 41.98 MiB and 2 more; ');
    expect(row.note).not.toContain('a008');
    const lever1 = row.note.indexOf('levers: 1. hold less at the step before the cut');
    const lever2 = row.note.indexOf('2. draw the larger shot on a 1080 plate');
    expect(lever1, row.note).toBeGreaterThan(row.note.indexOf('ch1.scene.a003 41.98'));
    expect(lever2, row.note).toBeGreaterThan(lever1);
    // A PASS carries the worst step's terms and no code.
    const fits = rowOf(assetRows(shotInputs(assets, { look: { [K1]: { cur: ids({ ...CU_A, ...CU_B }) } } })), 'step-window ch1');
    expect(fits.status).toBe('PASS');
    expect(fits.note).not.toContain('budget/step-window');
  });

  test("budget: step window at an event's last step counts the return to its room", () => {
    // §3.4 "An event's return": the event's last line on CU B, the return to the hall certain at distance 1. The window
    // holds the hall's plate, sheet and props (build/shots.json's certain) and its label bound, from the usage rooms
    // whose bg is certain and not in effect (build/shots.json's `labels` is the window's own room only): 12.703 + 16.562
    // = 29.265.
    const hall = roomShot('hall');
    const rooms = { 'ch1/manor/hall': { bg: 'bg/hall', props: propsOf(hall) } };
    const last = (cu: Record<string, AssetEntry>): Row => rowOf(assetRows(shotInputs({ ...hall, ...cu }, { look: { [K1]: { cur: ids(cu), certain: ids(hall) } } }, rooms)), 'step-window ch1');
    const on1080 = last(CU_B);
    expect(on1080).toMatchObject({ status: 'PASS', valueBytes: CU + sumFull(hall) + LABELS_BOUND });
    expect(mibOf(on1080.valueBytes)).toBe('29.265');
    // The last line on a 1440 CU: 15.623 + 16.562 = 32.185, over, with lever 2 printed.
    const on1440 = last(CU_1440);
    expect(on1440).toMatchObject({ status: 'FAIL', valueBytes: CU1440 + sumFull(hall) + LABELS_BOUND });
    expect(mibOf(on1440.valueBytes)).toBe('32.185');
    expect(on1440.note).toContain('2. draw the larger shot on a 1080 plate');
    // A step in another room's shot (the study, its labels in effect) whose next cut goes into the hall holds both label
    // bounds: the certain room's is charged whatever the window's own `labels` says: 16.562 + 16.562 = 33.123, over.
    const study = roomShot('study');
    const both = { ...rooms, 'ch1/manor/study': { bg: 'bg/study', props: propsOf(study) } };
    const cross = rowOf(assetRows(shotInputs({ ...hall, ...study }, { look: { [K1]: { cur: ids(study), labels: true, certain: ids(hall) } } }, both)), 'step-window ch1');
    expect(cross).toMatchObject({ status: 'FAIL', valueBytes: sumFull(study) + sumFull(hall) + 2 * LABELS_BOUND });
    expect(mibOf(cross.valueBytes)).toBe('33.123');
  });

  test('budget: the reader takes build/shots.json when story/shots.json exists', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'budget-shots-'));
    try {
      const need = { camTargets: [], cast: {}, faces: {}, frame: 'wide', loc: 'cafe', motions: [], room: null };
      const window = { certain: [], certainDist: 0, cur: ['bg/cafe'], d2: [], d3: [], labels: false, near: 0, possible: [] };
      const shotsJson = JSON.stringify({ chapters: { ch1: { assets: ['bg/cafe'], entry: { 'k:start': [['bg/cafe']] }, look: { 'k:start': window }, shots: { cafe: need }, sprites: true } } });
      // (a) Both files: the step rows are measured from build/shots.json.
      const both = join(tmp, 'both');
      writeRepo(both, { override: { 'story/shots.json': '{"locs": [], "shots": []}', 'server/content/build/shots.json': shotsJson } });
      const a = readAssetInputs(both);
      expect(a.problems).toEqual([]);
      expect(rowOf(assetRows(a), 'step-window ch1')).toMatchObject({ status: 'PASS', valueBytes: 1080 * 2048 * 4 + 5_000 });
      // (b) A shot list without build/shots.json, with one that lacks a listed chapter, or with one that does not
      // decode: the `asset inputs` row FAILs naming it, as the asset tool refuses it.
      const cases = [
        ['missing', null, 'server/content/build/shots.json: missing'],
        ['no chapter', '{"chapters": {}}', 'server/content/build/shots.json: no chapter ch1'],
        ['undecodable', '{"chapters": 5}', 'server/content/build/shots.json: chapters: not an object'],
      ] as const;
      for (const [label, file, problem] of cases) {
        const repo = join(tmp, label.replace(' ', '-'));
        writeRepo(repo, { override: { 'story/shots.json': '{}', 'server/content/build/shots.json': file } });
        const row = rowOf(assetRows(readAssetInputs(repo)), 'asset inputs');
        expect(row.status, label).toBe('FAIL');
        expect(row.note, label).toContain(problem);
      }
      // (c) No shot list (the shot pass is opt-in): a PENDING row, never a PASS; a stale build/shots.json is not read.
      const off = join(tmp, 'off');
      writeRepo(off, { override: { 'server/content/build/shots.json': shotsJson } });
      const c = readAssetInputs(off);
      expect(c).toMatchObject({ shotList: false, shots: null, problems: [] });
      const rows = assetRows(c);
      expect(rowOf(rows, 'step-window')).toMatchObject({ status: 'PENDING', valueBytes: null, note: 'no story/shots.json (the shot pass is opt-in)' });
      expect(rowOf(rows, 'entry step images')).toMatchObject({ status: 'PENDING', valueBytes: null, note: 'no story/shots.json (the shot pass is opt-in)' });
      expect(rows.filter((r) => r.name.startsWith('step-window ') || r.name.startsWith('entry step images ')).map((r) => r.name)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('budget: a shot chapter has no knot-set rows', () => {
    // Rev. 3 (W5): a restaged chapter (`sprites: false`) is gated by its step windows, not by knot-set: a cinematic knot
    // of 10 shots at the WebP limit would read 88.7 MiB as a knot set.
    const names = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const cinema = (sprites: boolean): ChapterSpec[] =>
      specsWith('ch1', (s) => {
        for (const n of names) {
          s.assets[`bg/${n}`] = img(`bg-${n}-0a0a0a0a`, 1080, 2048, 300_000, 450_000);
        }
        s.knots = { cinema: { assets: names.map((n) => `bg/${n}`), next: [] } };
        s.sprites = sprites;
      });
    const rows = assetRows(assetInputs(cinema(false)));
    expect(rows.filter((r) => r.name.startsWith('knot-set ch1/')).map((r) => r.name)).toEqual([]);
    // The legacy chapter beside it keeps its rows.
    expect(rowOf(rows, 'knot-set ch2/archive').status).toBe('PASS');
    // Control: the same knot in a legacy chapter is a knot-set row, at 88.7 MiB.
    const legacy = rowOf(assetRows(assetInputs(cinema(true))), 'knot-set ch1/cinema');
    expect(legacy).toMatchObject({ status: 'FAIL', valueBytes: 10 * (1080 * 2048 * 4 + 450_000) });
    expect(((legacy.valueBytes ?? 0) / MIB).toFixed(1)).toBe('88.7');
  });

  test('budget: a legacy chapter keeps its knot-set rows', () => {
    // Rev. 3 (W5): a chapter that still names sprites keeps today's knot-set rows until it is restaged: a bg and five
    // sprites in one knot hold 33.0 MiB, over.
    const crowd = Array.from({ length: 5 }, (_, i) => `char/c${i}/neutral`);
    const specs = specsWith('ch1', (s) => {
      crowd.forEach((id, i) => {
        s.assets[id] = img(`char-c${i}-neutral-0c0c0c0c`, 768, 1536, 100_000, 400_000);
      });
      s.knots['street'] = { assets: ['bg/street', ...crowd], next: [] };
    });
    const held = 1080 * 2048 * 4 + 150_000 + 5 * (768 * 1536 * 4 + 400_000);
    expect((held / MIB).toFixed(1)).toBe('33.0');
    const a = assetInputs(specs);
    expect(rowOf(assetRows(a), 'knot-set ch1/street')).toMatchObject({ status: 'FAIL', unit: 'MiB', valueBytes: held });
    // The safe side: a chapter build/shots.json does not list, and a story with no shot list, keep their rows too.
    expect(rowOf(assetRows({ ...a, shots: shotUsageOf({}) }), 'knot-set ch1/street')).toMatchObject({ status: 'FAIL', valueBytes: held });
    expect(rowOf(assetRows({ ...a, shotList: false, shots: null }), 'knot-set ch1/street')).toMatchObject({ status: 'FAIL', valueBytes: held });
  });

  test('budget: entry step images over 279,000 B fails', () => {
    // §5.11's resume fixture: a later step's one alternative is a 1440 shot at both file limits (400,000 + 200,000 B,
    // 225,000 at the half tier), the chapter files at their medians (74,000): 299,000, over by 20,000. The first step
    // (a CU) alone would pass: a resume may enter at any step.
    const big = { 'bg/c': halved(img('bg-c-5a5a5a5a', 1440, 2048, 400_000, 600_000), 150_000, 225_000), 'sheet/c': halved(img('sheet-c-5b5b5b5b', 1026, 968, 200_000, 300_000), 75_000, 112_500) };
    const cuA = atHalf(CU_A);
    const c: ShotChapterSpec = { look: { 'k:scene': {}, [K1]: { cur: ids(cuA) }, 'ch1.scene.a005': { cur: ids(big) } }, entry: { 'k:scene': [], [K1]: [ids(cuA)], 'ch1.scene.a005': [ids(big)] } };
    const a = withChapterFiles(shotInputs({ ...cuA, ...big }, c), 'ch1', MEDIAN_FILES);
    const row = rowOf(assetRows(a), 'entry step images ch1');
    expect(row).toMatchObject({ status: 'FAIL', unit: 'KB', valueBytes: 225_000 + 74_000, limitBytes: 279_000 });
    expect(row.note.startsWith('budget/entry-step: ch1.scene.a005: images 225.0 KB (half) + chapter files 74.0 KB'), row.note).toBe(true);
    expect(row.note).toContain("levers: shot.json q for that step's shots (both tiers); the chapter's own files");
    // Control: without the 1440 step the first CU step is the largest, and it fits (123,167 + 74,000).
    const small: ShotChapterSpec = { look: { 'k:scene': {}, [K1]: { cur: ids(cuA) } }, entry: { 'k:scene': [], [K1]: [ids(cuA)] } };
    const fits = rowOf(assetRows(withChapterFiles(shotInputs(cuA, small), 'ch1', MEDIAN_FILES)), 'entry step images ch1');
    expect(fits).toMatchObject({ status: 'PASS', valueBytes: 123_167 + 74_000 });
    expect(fits.note).not.toContain('budget/entry-step');
  });

  test('budget: entry step images prices the half tier', () => {
    // §5.11: the entry shows over the half-tier files: a CU of 225,000 + 103,445 B AVIF counts 84,375 + 38,792 =
    // 123,167 (its full files would count 328,445), plus the chapter files (4 x 500 B here).
    const cuA = atHalf(CU_A);
    expect(halfAvif(cuA)).toBe(123_167);
    const c: ShotChapterSpec = { look: { [K1]: { cur: ids(cuA) } }, entry: { [K1]: [ids(cuA)] } };
    expect(rowOf(assetRows(shotInputs(cuA, c)), 'entry step images ch1')).toMatchObject({ status: 'PASS', valueBytes: 123_167 + 2_000 });
    // A file with no half (a gated image, a char off its canvas) counts its own file: the CG's 300,000 B, over.
    const cg = { 'cg/letter': img('cg-letter-5f5f5f5f', 1080, 2048, 300_000, 450_000) };
    const onCg: ShotChapterSpec = { look: { [K1]: { cur: ids(cg) } }, entry: { [K1]: [ids(cg)] } };
    expect(rowOf(assetRows(shotInputs(cg, onCg)), 'entry step images ch1')).toMatchObject({ status: 'FAIL', valueBytes: 300_000 + 2_000 });
  });

  test('budget: entry step images charges the chapter files', () => {
    // §5.11: the first line awaits the chapter's story, meta, manifest, public world and en table (br,
    // chapters.ts:210-216): a CU entry with the medians' files is 123,167 + 74,000 = 197,167, and a 12 KB manifest growth
    // is charged.
    const cuA = atHalf(CU_A);
    const c: ShotChapterSpec = { look: { [K1]: { cur: ids(cuA) } }, entry: { [K1]: [ids(cuA)] } };
    const entryOf = (files: Parameters<typeof withChapterFiles>[2]): Row => rowOf(assetRows(withChapterFiles(shotInputs(cuA, c), 'ch1', files)), 'entry step images ch1');
    const median = entryOf(MEDIAN_FILES);
    expect(median).toMatchObject({ status: 'PASS', valueBytes: 197_167 });
    expect(median.note).toContain('chapter files 74.0 KB (story 35.0, meta 2.0, manifest 14.0, world 8.0, en 15.0)');
    expect(entryOf({ ...MEDIAN_FILES, manifest: 26_000 })).toMatchObject({ status: 'PASS', valueBytes: 209_167 });
    // A chapter without a world has no world term; a world source without its public output cannot be summed.
    expect(entryOf({ story: 35_000, meta: 2_000, manifest: 14_000, en: 15_000 })).toMatchObject({ valueBytes: 189_167 });
    const unbuilt = entryOf({ ...MEDIAN_FILES, world: null });
    expect(unbuilt).toMatchObject({ status: 'FAIL', valueBytes: null });
    expect(unbuilt.note).toContain('cannot sum: world missing');
  });

  test('budget: entry step images takes the largest alternative of a step', () => {
    // A step whose may-set holds a CG or CU A has two alternatives: a resume shows one top image, so the row prices the
    // larger alternative alone (CU A's 123,167, not the CG's 112,500 too).
    const cuA = atHalf(CU_A);
    const cg = atHalf({ 'cg/letter': img('cg-letter-5f5f5f5f', 1080, 2048, 300_000, 450_000) });
    expect(halfAvif(cg)).toBe(112_500);
    const c: ShotChapterSpec = { look: { [K1]: { cur: [...ids(cg), ...ids(cuA)] } }, entry: { [K1]: [ids(cg), ids(cuA)] } };
    const row = rowOf(assetRows(shotInputs({ ...cuA, ...cg }, c)), 'entry step images ch1');
    expect(row).toMatchObject({ status: 'PASS', valueBytes: 123_167 + 2_000 });
    // A file the manifest lacks cannot be summed.
    const lacking: ShotChapterSpec = { look: { [K1]: { cur: ids(cuA) } }, entry: { [K1]: [[...ids(cuA), 'cg/ghost']] } };
    const missing = rowOf(assetRows(shotInputs(cuA, lacking)), 'entry step images ch1');
    expect(missing).toMatchObject({ status: 'FAIL', valueBytes: null });
    expect(missing.note).toContain("not in ch1's manifest: cg/ghost");
  });

  test('budget: the entry row prints its derivation', () => {
    // §5.11: the limit is what the 6 s TTFL budget leaves for the entry's bytes on the e2e link, floored to 1,000 B; the
    // row prints that derivation on every build, with the largest step and its parts.
    const cuA = atHalf(CU_A);
    const c: ShotChapterSpec = { look: { [K1]: { cur: ids(cuA) } }, entry: { [K1]: [ids(cuA)] } };
    const row = rowOf(assetRows(shotInputs(cuA, c)), 'entry step images ch1');
    expect(row.note).toBe(
      `${K1}: images 123.2 KB (half) + chapter files 2.0 KB (story 0.5, meta 0.5, manifest 0.5, en 0.5); limit = (6,000 - 4,059 - 231 - 61 - 150 - 100) ms x 200 B/ms = 279,800, floored to 279,000`,
    );
    // The limit is that derivation, from the one term table the note prints.
    const t = ENTRY_STEP_TTFL;
    const left = t.budgetMs - t.ttflMs - t.twaMs - t.firstLineGrowthMs - t.resumeRttMs - t.decodeMs;
    expect(left * t.linkBytesPerMs).toBe(279_800);
    expect(LIMITS.entryStepImages).toBe(Math.floor((left * t.linkBytesPerMs) / 1_000) * 1_000);
  });

  test("budget: a legacy step's entry counts its sprites", () => {
    // Rev. 3 (W5): in a legacy chapter a step's alternative also holds the sprites in effect (build/shots.json's entry
    // lists them, as ch1.street.s016 does): the street's half plus three sprites' halves (37,500 B each).
    const street = atHalf({ 'bg/street': plateOf('street') });
    const sprites = atHalf({ 'char/ally/neutral': sprite('ally', 'neutral'), 'char/stranger/neutral': sprite('stranger', 'neutral'), 'char/stranger/smile': sprite('stranger', 'smile') });
    const alt = [...ids(street), ...ids(sprites)];
    const c: ShotChapterSpec = { look: { [K1]: { cur: alt } }, entry: { [K1]: [alt] }, sprites: true };
    const row = rowOf(assetRows(shotInputs({ ...street, ...sprites }, c)), 'entry step images ch1');
    expect(row).toMatchObject({ status: 'PASS', valueBytes: 84_375 + 3 * 37_500 + 2_000 });
  });

  test("budget: first-load counts the first step's half-tier images", () => {
    // §5.11 (D6): a shot chapter's first line awaits its first step's files at the half tier: the window k:<first knot>
    // holds nothing yet (the empty stage), its first batch shows CU A (certain at 1, talk file aside: motion, never
    // awaited) and may show B's plate. Its first knot names three plates, which a legacy chapter's row counts at full.
    const plates = atHalf({ 'bg/a': plateOf('a'), 'bg/b': plateOf('b'), 'bg/c': plateOf('c') });
    const talk = { 'talk/a/ally/smile': img('talk-a-ally-smile-5a5a5a5a', 256, 128, 6_000, 9_000) };
    const assets = { ...plates, ...atHalf({ 'sheet/a': cuSheetOf('a') }), ...talk };
    const specs = (sprites: boolean): ChapterSpec[] => [{ id: 'ch1', paid: false, next: null, assets, knots: { arrival: { assets: ['bg/a', 'bg/b', 'bg/c'], next: [] } }, sprites }];
    const look = { 'k:arrival': { certain: ['bg/a', 'sheet/a', 'talk/a/ally/smile'], possible: ['bg/b'] } };
    const dist = withEngine(inputs(), 50_000, 150_000);
    const firstLoad = (sprites: boolean, shots: ShotUsage | null): Row => {
      const a = assetInputs(specs(sprites), {});
      return rowOf(assetRows({ ...a, shotList: shots !== null, shots }, dist), 'first-load ch1');
    };
    const legacy = firstLoad(true, shotUsageOf({ ch1: { look, sprites: true } }));
    const shot = firstLoad(false, shotUsageOf({ ch1: { look, sprites: false } }));
    // Control: a legacy chapter keeps today's first-knot part (three full plates), the row as without a shot list.
    expect(legacy).toEqual(firstLoad(true, null));
    expect(legacy.note.endsWith('+ first knot')).toBe(true);
    const rest = (legacy.valueBytes ?? 0) - 3 * 225_000;
    expect((shot.valueBytes ?? 0) - rest).toBe(84_375 + 38_792 + 84_375);
    expect(shot.note.endsWith('+ first step (half)')).toBe(true);
    // A shot chapter without its first knot's window cannot be summed.
    const none = firstLoad(false, shotUsageOf({ ch1: { look: { [K1]: {} }, sprites: false } }));
    expect(none.status).toBe('FAIL');
    expect(none.note).toContain('first step images (half) (no window k:arrival) missing');
  });
});
