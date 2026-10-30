import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ENGINE_SRC, LIMITS, evaluate, formatRows } from './budget.ts';
import type { BudgetInputs, DistFile, ManifestChunk, Row } from './budget.ts';

const ROW_NAMES = [
  'manifest',
  'entry closure JS (br)',
  'engine closure JS (br)',
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

describe('budget evaluate', () => {
  test('budget: entry over limit fails', () => {
    const big = inputs();
    big.files = big.files.map((f) => (f.path === 'assets/index-a.js' ? file(f.path, 300_000) : f));
    const rows = evaluate(big, LIMITS);
    const entry = rowOf(rows, 'entry closure JS (br)');
    expect(entry.status).toBe('FAIL');
    expect(entry.valueBytes).toBe(302_000);
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
    // Pixi's default Application.init() downloads its environment chunk through a dynamic import (browserAll,
    // which pulls more): the engine's real boot download, and the 230 KB basis, include it.
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
    const base = inputs();
    const lazy = Array.from({ length: 10 }, (_, i) => file(`assets/lazy-${i}.js`, 27_000));
    const rows = evaluate({ ...base, files: [...base.files, ...lazy] }, LIMITS);
    expect(rowOf(rows, 'entry closure JS (br)').status).toBe('PASS');
    const all = rowOf(rows, 'all JS (br)');
    expect(all.valueBytes).toBe(282_000);
    expect(all.status).toBe('FAIL');
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

  test('budget: every row is printed', () => {
    // A failing manifest does not stop later rows (no bail).
    for (const input of [inputs(), inputs({ manifest: null })]) {
      const rows = evaluate(input, LIMITS);
      expect(rows.map((r) => r.name)).toEqual(ROW_NAMES);
      const text = formatRows(rows);
      for (const name of ROW_NAMES) {
        expect(text).toContain(`${name} |`);
      }
      const fail = rows.filter((r) => r.status === 'FAIL').length;
      const pass = rows.filter((r) => r.status === 'PASS').length;
      expect(text).toContain(`budget: ${rows.length} rows, ${pass} PASS, ${fail} FAIL, 1 PENDING`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CLI: spawned the way `npm run build` runs it (Node type stripping), on a synthetic dist in a temp dir.

const CLIENT_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./budget.ts', import.meta.url));

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

function runCli(dist: string, script = SCRIPT): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [script, '--dist', dist], { cwd: CLIENT_DIR, encoding: 'utf8' });
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

  test('budget: cli exits 1 on oversize dist', () => {
    writeDist(tmp, noise(300_000, 42));
    const r = runCli(tmp);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^entry closure JS \(br\) \| 300\.\d KB \| 40\.0 KB \| FAIL/m);
    expect(r.stdout).toMatch(/^all JS \(br\) \| .* \| FAIL/m);
    for (const name of ROW_NAMES) {
      expect(r.stdout).toContain(`${name} |`);
    }
  });

  test('budget: cli exits 0 on a small dist', () => {
    writeDist(tmp, 'export const main = 1;\n');
    const r = runCli(tmp);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^manifest \| — \| — \| PASS/m);
    expect(r.stdout).toMatch(/^engine closure JS \(br\) \| .* \| (PENDING|PASS)/m);
    expect(r.stdout).toMatch(/^budget: 6 rows, \d PASS, 0 FAIL, [01] PENDING$/m);
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
  });
});
