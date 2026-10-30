// Load budgets of the built client (principle 4): every row printed, exit 1 on any FAIL (the CLI, below).
// Sizes are brotli quality 11 bytes; 1 KB = 1000 B, like the plan's MB.

export type Status = 'PASS' | 'FAIL' | 'PENDING';
export type Row = { name: string; valueBytes: number | null; limitBytes: number | null; status: Status; note: string };
/** One file of dist/: path relative to dist with '/' separators. */
export type DistFile = { path: string; rawBytes: number; brBytes: number };
/** One entry of dist/.vite/manifest.json; `imports` and `dynamicImports` name other manifest keys. */
export type ManifestChunk = {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
};
export type BudgetInputs = {
  manifest: Record<string, ManifestChunk> | null;
  manifestStale: boolean;
  indexHtml: string | null;
  files: DistFile[];
  engineSourceExists: boolean;
};
export type Limits = { entryJsBr: number; engineJsBr: number; allJsBr: number; cssBr: number; htmlBr: number };

export const LIMITS: Limits = { entryJsBr: 40_000, engineJsBr: 230_000, allJsBr: 270_000, cssBr: 12_000, htmlBr: 2_000 };
/** The dynamic-import root of the engine chunk (two-stage boot); its manifest key and `src`. */
export const ENGINE_SRC = 'src/app/engine.ts';

const JS = /\.m?js$/;

type Closure = { keys: Set<string>; missing: string[] };
type Entry = { ok: true; key: string; chunk: ManifestChunk } | { ok: false; reason: string };

export function evaluate(inputs: BudgetInputs, limits: Limits): Row[] {
  const sizes = new Map(inputs.files.map((f) => [f.path, f.brBytes]));
  const entry = findEntry(inputs.manifest);
  const entryClosure = entry.ok && inputs.manifest !== null ? closure(inputs.manifest, entry.key) : null;
  return [
    manifestRow(inputs, entry, sizes),
    entryRow(inputs, entry, entryClosure, sizes, limits),
    engineRow(inputs, entryClosure, sizes, limits),
    sumRow('all JS (br)', inputs.files, (p) => JS.test(p), limits.allJsBr),
    sumRow('CSS total (br)', inputs.files, (p) => p.endsWith('.css'), limits.cssBr),
    htmlRow(sizes, limits),
  ];
}

function findEntry(manifest: Record<string, ManifestChunk> | null): Entry {
  if (manifest === null) {
    return { ok: false, reason: 'dist/.vite/manifest.json missing' };
  }
  const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry === true);
  const first = entries[0];
  if (entries.length !== 1 || first === undefined) {
    return { ok: false, reason: `${entries.length} isEntry chunks in the manifest (expected 1)` };
  }
  return { ok: true, key: first[0], chunk: first[1] };
}

/** The chunk and everything it imports statically, transitively (what loads before it runs). */
function closure(manifest: Record<string, ManifestChunk>, start: string): Closure {
  const keys = new Set<string>();
  const missing: string[] = [];
  const queue = [start];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    if (keys.has(key)) {
      continue;
    }
    const chunk = manifest[key];
    if (chunk === undefined) {
      missing.push(key);
      continue;
    }
    keys.add(key);
    queue.push(...(chunk.imports ?? []));
  }
  return { keys, missing };
}

/** Sums the brotli size of the JS files of `keys`; a chunk without its file in dist is an input error. */
function jsBytes(
  manifest: Record<string, ManifestChunk>,
  keys: Iterable<string>,
  sizes: ReadonlyMap<string, number>,
): { bytes: number; missing: string[] } {
  let bytes = 0;
  const missing: string[] = [];
  for (const key of keys) {
    const file = manifest[key]?.file;
    if (file === undefined || !JS.test(file)) {
      continue;
    }
    const size = sizes.get(file);
    if (size === undefined) {
      missing.push(file);
    } else {
      bytes += size;
    }
  }
  return { bytes, missing };
}

function measured(name: string, bytes: number, limit: number, note = ''): Row {
  return { name, valueBytes: bytes, limitBytes: limit, status: bytes <= limit ? 'PASS' : 'FAIL', note };
}

function failed(name: string, limit: number | null, note: string): Row {
  return { name, valueBytes: null, limitBytes: limit, status: 'FAIL', note };
}

function manifestRow(inputs: BudgetInputs, entry: Entry, sizes: ReadonlyMap<string, number>): Row {
  const name = 'manifest';
  if (!entry.ok) {
    return failed(name, null, entry.reason);
  }
  if (inputs.manifestStale) {
    return failed(name, null, 'manifest older than index.html (another build)');
  }
  if (inputs.indexHtml === null) {
    return failed(name, null, 'index.html missing');
  }
  // The same build wrote both: index.html loads exactly the entry file this manifest names.
  if (!inputs.indexHtml.includes(entry.chunk.file)) {
    return failed(name, null, `entry ${entry.chunk.file} not referenced by index.html (another build)`);
  }
  if (!sizes.has(entry.chunk.file)) {
    return failed(name, null, `entry ${entry.chunk.file} absent from dist`);
  }
  return { name, valueBytes: null, limitBytes: null, status: 'PASS', note: `entry ${entry.chunk.file}` };
}

function entryRow(
  inputs: BudgetInputs,
  entry: Entry,
  entryClosure: Closure | null,
  sizes: ReadonlyMap<string, number>,
  limits: Limits,
): Row {
  const name = 'entry closure JS (br)';
  if (!entry.ok || inputs.manifest === null || entryClosure === null) {
    return failed(name, limits.entryJsBr, entry.ok ? 'manifest missing' : entry.reason);
  }
  const { bytes, missing } = jsBytes(inputs.manifest, entryClosure.keys, sizes);
  const absent = [...entryClosure.missing, ...missing];
  if (absent.length > 0) {
    return failed(name, limits.entryJsBr, `missing from manifest/dist: ${absent.join(', ')}`);
  }
  return measured(name, bytes, limits.entryJsBr, `${entryClosure.keys.size} chunks`);
}

function engineRow(
  inputs: BudgetInputs,
  entryClosure: Closure | null,
  sizes: ReadonlyMap<string, number>,
  limits: Limits,
): Row {
  const name = 'engine closure JS (br)';
  if (!inputs.engineSourceExists) {
    return { name, valueBytes: null, limitBytes: limits.engineJsBr, status: 'PENDING', note: `${ENGINE_SRC} absent` };
  }
  if (inputs.manifest === null) {
    return failed(name, limits.engineJsBr, 'dist/.vite/manifest.json missing');
  }
  const manifest = inputs.manifest;
  const roots = Object.keys(manifest).filter((key) => {
    const chunk = manifest[key];
    return chunk?.isDynamicEntry === true && chunk.src === ENGINE_SRC;
  });
  // An engine merged into the entry (or not built) would measure 0 KB here: that is a FAIL, never a PASS.
  if (roots.length === 0) {
    return failed(name, limits.engineJsBr, `no dynamic entry for ${ENGINE_SRC} in the manifest`);
  }
  const keys = new Set<string>();
  const absent: string[] = [];
  for (const root of roots) {
    const c = closure(manifest, root);
    c.keys.forEach((k) => keys.add(k));
    absent.push(...c.missing);
  }
  // Chunks the entry already loaded are downloaded once; the engine row counts only what the engine adds.
  for (const key of entryClosure?.keys ?? []) {
    keys.delete(key);
  }
  const { bytes, missing } = jsBytes(manifest, keys, sizes);
  absent.push(...missing);
  if (absent.length > 0) {
    return failed(name, limits.engineJsBr, `missing from manifest/dist: ${absent.join(', ')}`);
  }
  return measured(name, bytes, limits.engineJsBr, `${keys.size} chunks beyond the entry closure`);
}

function sumRow(name: string, files: readonly DistFile[], pick: (path: string) => boolean, limit: number): Row {
  const picked = files.filter((f) => pick(f.path));
  const bytes = picked.reduce((sum, f) => sum + f.brBytes, 0);
  return measured(name, bytes, limit, `${picked.length} files`);
}

function htmlRow(sizes: ReadonlyMap<string, number>, limits: Limits): Row {
  const name = 'index.html (br)';
  const bytes = sizes.get('index.html');
  return bytes === undefined ? failed(name, limits.htmlBr, 'index.html missing') : measured(name, bytes, limits.htmlBr);
}

function kb(bytes: number | null): string {
  return bytes === null ? '—' : `${(bytes / 1000).toFixed(1)} KB`;
}

/** One `name | value | limit | STATUS` line per row (the note after it), then the tally line. */
export function formatRows(rows: Row[]): string {
  const lines = rows.map((r) => {
    const line = `${r.name} | ${kb(r.valueBytes)} | ${kb(r.limitBytes)} | ${r.status}`;
    return r.note === '' ? line : `${line} | ${r.note}`;
  });
  const count = (s: Status): number => rows.filter((r) => r.status === s).length;
  lines.push(`budget: ${rows.length} rows, ${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('PENDING')} PENDING`);
  return lines.join('\n');
}
