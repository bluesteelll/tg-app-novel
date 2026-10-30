import { describe, expect, test } from 'vitest';

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
