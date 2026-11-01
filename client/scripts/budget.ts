// Load budgets of the built client (principle 4): every row printed, exit 1 on any FAIL (the CLI, below).
// Sizes are brotli quality 11 bytes; 1 KB = 1000 B, like the plan's MB; memory rows are in MiB (1,048,576 B).
// The dist rows (L1) read dist/; the asset rows (L5) read the story and asset tools' outputs under the repository.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

import type { AssetCatalog, AssetEntry, AssetManifest, ChapterListEntry, ChapterMeta, CoverManifest, ImageEntry } from '../src/story/catalog.ts';
import type { AssetId, ChapterId } from '../src/story/staging.ts';
import {
  assetUsage,
  catalogAudio,
  decodeAssetCatalog,
  decodeAssetManifest,
  decodeChapterMeta,
  decodeCoverManifest,
  urlPath,
  worldHasSections,
} from './assets/manifest.ts';
import type { AssetUsage } from './assets/manifest.ts';
import { imageKind } from './assets/placeholder.ts';
import type { ImageKind } from './assets/placeholder.ts';
import { decodeChapterList, decodeStoryUsage } from './story/emit.ts';
import type { StoryUsage } from './story/emit.ts';

export type Status = 'PASS' | 'FAIL' | 'PENDING';
export type Row = {
  name: string;
  valueBytes: number | null;
  limitBytes: number | null;
  status: Status;
  note: string;
  /** KB = 1000 B (transfer sizes); MiB = 1,048,576 B (decoded memory). */
  unit: 'KB' | 'MiB';
};
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
  /** `src/app/yields.ts` exists: the importer of every lazy family (PUZZLES-PLAN X14, W7). */
  yieldsSourceExists: boolean;
  /** The LAZY_FAMILIES roots that exist under client/, by their manifest `src`. */
  lazySources: ReadonlySet<string>;
};
export type Limits = {
  entryJsBr: number;
  engineJsBr: number;
  /** PUZZLES-PLAN: entry + engine closures, what loads before the first line. */
  firstLineJsBr: number;
  /** PUZZLES-PLAN "Budgets": JS + CSS of each puzzle type chunk, of the puzzle host, of the explore UI. */
  puzzleTypeChunkBr: number;
  puzzleHostChunkBr: number;
  exploreUiChunkBr: number;
  allJsBr: number;
  cssBr: number;
  htmlBr: number;
  storyRaw: number;
  storyBr: number;
  enRaw: number;
  worldRaw: number;
  worldBr: number;
  transfer: number;
  firstKnotImages: number;
  knotSet: number;
  roomSet: number;
  firstLoad: number;
  image: Readonly<Record<ImageKind, { avif: number; webp: number }>>;
  bgmM4aBytes: number;
  bgmMs: number;
  /** K23: a WAV only for a catalog placeholder. */
  bgmWavBytes: number;
  sfxBytes: number;
  sfxMs: number;
};

const MIB = 1_048_576;
const PHOTO = { avif: 300_000, webp: 450_000 };

/** PROTOTYPE-PLAN "Budgets", PUZZLES-PLAN and STORIES-PLAN "Budgets and validation". */
export const LIMITS: Limits = {
  entryJsBr: 40_000,
  engineJsBr: 230_000,
  firstLineJsBr: 270_000,
  puzzleTypeChunkBr: 8_000,
  puzzleHostChunkBr: 10_000,
  exploreUiChunkBr: 16_000,
  allJsBr: 290_000,
  cssBr: 12_000,
  htmlBr: 2_000,
  storyRaw: 160_000,
  storyBr: 35_000,
  enRaw: 48_000,
  worldRaw: 32_000,
  worldBr: 8_000,
  transfer: 6_000_000,
  firstKnotImages: 450_000,
  knotSet: 32 * MIB,
  roomSet: 32 * MIB,
  firstLoad: 800_000,
  image: { bg: PHOTO, cg: PHOTO, char: PHOTO, prop: { avif: 60_000, webp: 90_000 }, cover: { avif: 24_000, webp: 36_000 } },
  bgmM4aBytes: 3_000_000,
  bgmMs: 240_000,
  bgmWavBytes: 400_000,
  sfxBytes: 100_000,
  sfxMs: 3_000,
};
/** The dynamic-import root of the engine chunk (two-stage boot); its manifest key and `src`. */
export const ENGINE_SRC = 'src/app/engine.ts';
/** The importer of every lazy family (PUZZLES-PLAN X14): the lazy rows are PENDING until it exists (W7). */
export const YIELDS_SRC = 'src/app/yields.ts';

/** One lazy chunk family: its roots (manifest `src`), its limit, and whether the largest root or their union counts. */
export type LazyFamily = {
  name: string;
  roots: readonly string[];
  limit: 'puzzleTypeChunkBr' | 'puzzleHostChunkBr' | 'exploreUiChunkBr';
  measure: 'largest' | 'union';
};
/** PUZZLES-PLAN X14: every family is a dynamic chunk, never in the entry or the engine closure. */
export const LAZY_FAMILIES: readonly LazyFamily[] = [
  {
    name: 'puzzle-type chunk (br)',
    roots: ['src/puzzles/ui/CodeLock.svelte', 'src/puzzles/ui/OrderPuzzle.svelte'],
    limit: 'puzzleTypeChunkBr',
    measure: 'largest',
  },
  { name: 'puzzle-host chunk (br)', roots: ['src/ui/puzzles/PuzzleHost.svelte'], limit: 'puzzleHostChunkBr', measure: 'largest' },
  {
    name: 'explore-ui chunk (br)',
    roots: ['src/explore/controller.ts', 'src/ui/explore/ExploreView.svelte'],
    limit: 'exploreUiChunkBr',
    measure: 'union',
  },
];
const LAZY_ROOTS: ReadonlySet<string> = new Set(LAZY_FAMILIES.flatMap((f) => f.roots));
/** The arch rule's lazy directories: a chunk from one of them loads after the first line, listed root or not. */
const LAZY_DIRS = ['src/puzzles/ui/', 'src/ui/puzzles/', 'src/ui/explore/'];

function isLazySrc(src: string | undefined): boolean {
  return src !== undefined && (LAZY_ROOTS.has(src) || LAZY_DIRS.some((dir) => src.startsWith(dir)));
}
/** telegram-web-app.js, loaded by index.html before the entry [R1]. */
export const TWA_BYTES = 16_200;
/** Principle 4: no image side over 2048 px. */
const MAX_SIDE = 2048;
/** Image dimensions per kind: the canonical size exactly, or at most (PP "Budgets", PZ X11, SP Y15). */
const DIMS: Readonly<Record<ImageKind, { w: number; h: number; exact: boolean }>> = {
  bg: { w: 1080, h: 2048, exact: true },
  cg: { w: 1080, h: 2048, exact: true },
  char: { w: 768, h: 1536, exact: false },
  prop: { w: 512, h: 512, exact: false },
  cover: { w: 360, h: 640, exact: true },
};

const JS = /\.m?js$/;

type Closure = { keys: Set<string>; missing: string[] };
/** `imports` load before a chunk runs; `dynamicImports` load when it calls them (Pixi's `init` always does). */
type Edges = 'static' | 'static+dynamic';
type Entry = { ok: true; key: string; chunk: ManifestChunk } | { ok: false; reason: string };
/** A JS closure's brotli bytes, or why it cannot be measured. */
type Measure = { ok: true; bytes: number; note: string } | { ok: false; problem: string };

export function evaluate(inputs: BudgetInputs, limits: Limits): Row[] {
  const sizes = new Map(inputs.files.map((f) => [f.path, f.brBytes]));
  const entry = findEntry(inputs.manifest);
  const entryClosure = entry.ok && inputs.manifest !== null ? closure(inputs.manifest, entry.key, 'static') : null;
  return [
    manifestRow(inputs, entry, sizes),
    entryRow(inputs, entry, entryClosure, sizes, limits),
    engineRow(inputs, entryClosure, sizes, limits),
    firstLineRow(inputs, entry, entryClosure, sizes, limits),
    ...LAZY_FAMILIES.map((family) => lazyRow(inputs, family, entryClosure, sizes, limits)),
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

/** The chunk and everything it reaches through `edges`, transitively; a dynamic edge to a `stop` key is not followed. */
function closure(manifest: Record<string, ManifestChunk>, start: string, edges: Edges, stop: (key: string) => boolean = () => false): Closure {
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
    if (edges === 'static+dynamic') {
      queue.push(...(chunk.dynamicImports ?? []).filter((k) => !stop(k)));
    }
  }
  return { keys, missing };
}

/** Sums the brotli size of the JS files and the CSS files of `keys`; a file missing from dist is an input error. */
function chunkBytes(
  manifest: Record<string, ManifestChunk>,
  keys: Iterable<string>,
  sizes: ReadonlyMap<string, number>,
): { bytes: number; missing: string[] } {
  const list = [...keys];
  const js = jsBytes(manifest, list, sizes);
  const css = new Set(list.flatMap((key) => manifest[key]?.css ?? []));
  let bytes = js.bytes;
  const missing = [...js.missing];
  for (const file of css) {
    const size = sizes.get(file);
    if (size === undefined) {
      missing.push(file);
    } else {
      bytes += size;
    }
  }
  return { bytes, missing };
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

function measured(name: string, bytes: number, limit: number, note = '', unit: Row['unit'] = 'KB'): Row {
  return { name, valueBytes: bytes, limitBytes: limit, status: bytes <= limit ? 'PASS' : 'FAIL', note, unit };
}

function failed(name: string, limit: number | null, note: string, unit: Row['unit'] = 'KB'): Row {
  return { name, valueBytes: null, limitBytes: limit, status: 'FAIL', note, unit };
}

function pending(name: string, limit: number | null, note: string, unit: Row['unit'] = 'KB'): Row {
  return { name, valueBytes: null, limitBytes: limit, status: 'PENDING', note, unit };
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
  return { name, valueBytes: null, limitBytes: null, status: 'PASS', note: `entry ${entry.chunk.file}`, unit: 'KB' };
}

function entryMeasure(inputs: BudgetInputs, entry: Entry, entryClosure: Closure | null, sizes: ReadonlyMap<string, number>): Measure {
  if (!entry.ok || inputs.manifest === null || entryClosure === null) {
    return { ok: false, problem: entry.ok ? 'manifest missing' : entry.reason };
  }
  const { bytes, missing } = jsBytes(inputs.manifest, entryClosure.keys, sizes);
  const absent = [...entryClosure.missing, ...missing];
  if (absent.length > 0) {
    return { ok: false, problem: `missing from manifest/dist: ${absent.join(', ')}` };
  }
  return { ok: true, bytes, note: `${entryClosure.keys.size} chunks` };
}

/** The engine's chunks, or why they cannot be found; null while the engine source does not exist (PENDING). */
type EngineClosure =
  | { ok: true; manifest: Record<string, ManifestChunk>; keys: Set<string>; missing: string[] }
  | { ok: false; problem: string }
  | null;

function engineClosure(inputs: BudgetInputs): EngineClosure {
  if (!inputs.engineSourceExists) {
    return null;
  }
  if (inputs.manifest === null) {
    return { ok: false, problem: 'dist/.vite/manifest.json missing' };
  }
  const manifest = inputs.manifest;
  const roots = Object.keys(manifest).filter((key) => {
    const chunk = manifest[key];
    return chunk?.isDynamicEntry === true && chunk.src === ENGINE_SRC;
  });
  // An engine merged into the entry (or not built) would measure 0 KB here: that is a FAIL, never a PASS.
  if (roots.length === 0) {
    return { ok: false, problem: `no dynamic entry for ${ENGINE_SRC} in the manifest` };
  }
  const keys = new Set<string>();
  const missing: string[] = [];
  // Application.init() always imports Pixi's environment chunk (browserAll) dynamically, and the 230 KB basis
  // (P:1739, R4 145.1 K) counts it: the engine row follows dynamic imports too; the entry row stays static (P:1738).
  // The walk stops at a lazy chunk (yields.ts imports them): they load after the first line (PUZZLES-PLAN X14), so
  // neither the engine row nor the first-line and first-load rows count them; their own rows do.
  for (const root of roots) {
    const c = closure(manifest, root, 'static+dynamic', (key) => isLazySrc(manifest[key]?.src));
    c.keys.forEach((k) => keys.add(k));
    missing.push(...c.missing);
  }
  return { ok: true, manifest, keys, missing };
}

/** The engine's download beyond the entry closure; null while the engine source does not exist (PENDING). */
function engineMeasure(inputs: BudgetInputs, entryClosure: Closure | null, sizes: ReadonlyMap<string, number>): Measure | null {
  const engine = engineClosure(inputs);
  if (engine === null || !engine.ok) {
    return engine;
  }
  const keys = new Set(engine.keys);
  const absent = [...engine.missing];
  // Chunks the entry already loaded are downloaded once; the engine row counts only what the engine adds.
  for (const key of entryClosure?.keys ?? []) {
    keys.delete(key);
  }
  const { bytes, missing } = jsBytes(engine.manifest, keys, sizes);
  absent.push(...missing);
  if (absent.length > 0) {
    return { ok: false, problem: `missing from manifest/dist: ${absent.join(', ')}` };
  }
  return { ok: true, bytes, note: `${keys.size} chunks beyond the entry closure` };
}

function entryRow(
  inputs: BudgetInputs,
  entry: Entry,
  entryClosure: Closure | null,
  sizes: ReadonlyMap<string, number>,
  limits: Limits,
): Row {
  const name = 'entry closure JS (br)';
  const m = entryMeasure(inputs, entry, entryClosure, sizes);
  return m.ok ? measured(name, m.bytes, limits.entryJsBr, m.note) : failed(name, limits.entryJsBr, m.problem);
}

function engineRow(inputs: BudgetInputs, entryClosure: Closure | null, sizes: ReadonlyMap<string, number>, limits: Limits): Row {
  const name = 'engine closure JS (br)';
  const m = engineMeasure(inputs, entryClosure, sizes);
  if (m === null) {
    return pending(name, limits.engineJsBr, `${ENGINE_SRC} absent`);
  }
  return m.ok ? measured(name, m.bytes, limits.engineJsBr, m.note) : failed(name, limits.engineJsBr, m.problem);
}

/**
 * Entry + engine closures: what loads before the first line. While the engine source does not exist the sum is
 * partial: PENDING, or FAIL when the entry alone is already over (a partial PASS would be a 0 KB pass).
 */
function firstLineJs(
  inputs: BudgetInputs,
  entry: Entry,
  entryClosure: Closure | null,
  sizes: ReadonlyMap<string, number>,
): { ok: true; bytes: number; partial: boolean } | { ok: false; problem: string } {
  const e = entryMeasure(inputs, entry, entryClosure, sizes);
  if (!e.ok) {
    return { ok: false, problem: `entry closure: ${e.problem}` };
  }
  const g = engineMeasure(inputs, entryClosure, sizes);
  if (g === null) {
    return { ok: true, bytes: e.bytes, partial: true };
  }
  return g.ok ? { ok: true, bytes: e.bytes + g.bytes, partial: false } : { ok: false, problem: `engine closure: ${g.problem}` };
}

function firstLineRow(
  inputs: BudgetInputs,
  entry: Entry,
  entryClosure: Closure | null,
  sizes: ReadonlyMap<string, number>,
  limits: Limits,
): Row {
  const name = 'JS before the first line (br)';
  const js = firstLineJs(inputs, entry, entryClosure, sizes);
  if (!js.ok) {
    return failed(name, limits.firstLineJsBr, js.problem);
  }
  return partialRow(name, js.bytes, limits.firstLineJsBr, js.partial, 'entry + engine closures');
}

/** A sum that lacks the engine while its source is absent: PENDING (with the partial value) unless already over. */
function partialRow(name: string, bytes: number, limit: number, partial: boolean, note: string): Row {
  if (!partial) {
    return measured(name, bytes, limit, note);
  }
  const why = `${ENGINE_SRC} absent: partial sum without the engine closure`;
  return { name, valueBytes: bytes, limitBytes: limit, status: bytes > limit ? 'FAIL' : 'PENDING', note: why, unit: 'KB' };
}

/**
 * A lazy family's row, keyed on its importer like the engine row on `app/engine.ts` (PUZZLES-PLAN W7): PENDING while
 * `src/app/yields.ts` or every root source is absent. Once both exist, a present root FAILs without a dynamic entry
 * of its own, or inside the entry or the engine closure (it would load before the first line). Its bytes are the JS
 * and CSS of its static closure beyond the entry and engine closures (downloaded once): the largest root's, or the
 * union of the roots'.
 */
function lazyRow(inputs: BudgetInputs, family: LazyFamily, entryClosure: Closure | null, sizes: ReadonlyMap<string, number>, limits: Limits): Row {
  const { name } = family;
  const limit = limits[family.limit];
  if (!inputs.yieldsSourceExists) {
    return pending(name, limit, `${YIELDS_SRC} absent`);
  }
  const present = family.roots.filter((root) => inputs.lazySources.has(root));
  if (present.length === 0) {
    return pending(name, limit, `no source of ${family.roots.join(', ')}`);
  }
  if (inputs.manifest === null) {
    return failed(name, limit, 'dist/.vite/manifest.json missing');
  }
  const manifest = inputs.manifest;
  const entryKeys = entryClosure?.keys ?? new Set<string>();
  const engine = engineClosure(inputs);
  const engineKeys = engine?.ok === true ? engine.keys : new Set<string>();
  const problems: string[] = [];
  const perRoot: Array<{ root: string; keys: Set<string> }> = [];
  for (const root of present) {
    const chunks = Object.keys(manifest).filter((key) => manifest[key]?.src === root && manifest[key]?.isDynamicEntry === true);
    if (chunks.length === 0) {
      problems.push(`no dynamic entry for ${root}`);
      continue;
    }
    if (chunks.some((key) => entryKeys.has(key))) {
      problems.push(`${root} is in the entry static closure`);
    }
    if (chunks.some((key) => engineKeys.has(key))) {
      problems.push(`${root} is in the engine closure`);
    }
    const keys = new Set<string>();
    for (const key of chunks) {
      const c = closure(manifest, key, 'static');
      c.keys.forEach((k) => keys.add(k));
      problems.push(...c.missing.map((k) => `missing from manifest: ${k}`));
    }
    for (const key of [...entryKeys, ...engineKeys]) {
      keys.delete(key);
    }
    perRoot.push({ root, keys });
  }
  const sized = perRoot.map((r) => ({ ...r, ...chunkBytes(manifest, r.keys, sizes) }));
  problems.push(...sized.flatMap((r) => r.missing.map((file) => `missing from dist: ${file}`)));
  if (problems.length > 0) {
    return failed(name, limit, problems.join('; '));
  }
  if (family.measure === 'union') {
    const union = new Set(perRoot.flatMap((r) => [...r.keys]));
    const { bytes } = chunkBytes(manifest, union, sizes);
    return measured(name, bytes, limit, `${union.size} chunks of ${present.length} roots`);
  }
  const largest = sized.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  return measured(name, largest.bytes, limit, `largest: ${largest.root}, ${largest.keys.size} chunks`);
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

// ---------------------------------------------------------------------------------------------------------------
// Asset rows (L5): images, audio, story JSON, en tables, world JSON, per-chapter transfer, first knot, the knot and
// room working sets, and first-load per story, from the story and asset tools' outputs.

/** A file's size, raw and brotli q11. */
export type Sized = { rawBytes: number; brBytes: number };
/** One listed chapter's inputs; null = missing or undecodable (listed in `AssetInputs.problems`). */
export type ChapterInputs = {
  id: ChapterId;
  paid: boolean;
  story: Sized | null;
  meta: (Sized & { value: ChapterMeta }) | null;
  en: Sized | null;
  manifest: (Sized & { value: AssetManifest }) | null;
  /** `story/<ch>/world.json`: null when the chapter has none; `public` is the emitted public world, null if absent. */
  world: { hasSections: boolean; public: Sized | null } | null;
};
export type AssetInputs = {
  /** Every input that is missing or does not decode: the `asset inputs` row FAILs listing them. */
  problems: readonly string[];
  /** story/chapters.json, in play order; `next` decides the story heads (first-load). */
  list: readonly ChapterListEntry[];
  chapters: readonly ChapterInputs[];
  catalog: AssetCatalog | null;
  usage: StoryUsage | null;
  rooms: AssetUsage['rooms'];
  covers: (Sized & { value: CoverManifest }) | null;
  /** client/src/story-gen/catalog.json (the public chapter catalog, fetched at boot). */
  chapterCatalog: Sized | null;
  /** On-disk size of the file each manifest URL names (repo-relative path); absent = no such regular file. */
  fileBytes: ReadonlyMap<string, number>;
};

function mib(bytes: number): string {
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

function kbText(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} KB`;
}

/** Every image and clip of every manifest and covers.json, once per id; a later entry that differs is a violation. */
function allEntries(a: AssetInputs): { entries: Map<AssetId, AssetEntry>; conflicts: Map<AssetId, string> } {
  const entries = new Map<AssetId, AssetEntry>();
  const conflicts = new Map<AssetId, string>();
  const sources: Array<readonly [string, Readonly<Record<AssetId, AssetEntry>>]> = [
    ...a.chapters.flatMap((c) => (c.manifest === null ? [] : [[c.id, c.manifest.value.assets] as const])),
    ...(a.covers === null ? [] : [['covers.json', a.covers.value.assets] as const]),
  ];
  for (const [source, assets] of sources) {
    for (const [id, entry] of Object.entries(assets) as Array<[AssetId, AssetEntry]>) {
      const seen = entries.get(id);
      if (seen === undefined) {
        entries.set(id, entry);
      } else if (JSON.stringify(seen) !== JSON.stringify(entry)) {
        conflicts.set(id, `the entry in ${source} differs from an earlier manifest's (a stale manifest?)`);
      }
    }
  }
  return { entries, conflicts };
}

/** A file reference's checks: its file exists in the tier directory its URL names, at the size the manifest says. */
function fileProblems(a: AssetInputs, ref: { url: string; bytes: number }): string[] {
  const rel = urlPath(ref.url);
  const size = rel === null ? undefined : a.fileBytes.get(rel);
  if (rel === null || size === undefined) {
    return [`${rel ?? ref.url} missing`];
  }
  return size === ref.bytes ? [] : [`${rel} is ${size} B on disk, the manifest says ${ref.bytes}`];
}

function imageRow(a: AssetInputs, id: AssetId, e: ImageEntry, conflict: string | undefined, limits: Limits): Row {
  const name = `image ${id}`;
  const kind = imageKind(id);
  if (kind === null) {
    return failed(name, null, 'not an image namespace');
  }
  const limit = limits.image[kind];
  const dims = DIMS[kind];
  const v: string[] = [];
  if (e.w > MAX_SIDE || e.h > MAX_SIDE) {
    v.push(`${e.w}×${e.h} over ${MAX_SIDE} px`);
  }
  if (dims.exact ? e.w !== dims.w || e.h !== dims.h : e.w > dims.w || e.h > dims.h) {
    v.push(`${e.w}×${e.h}, ${dims.exact ? 'not exactly' : 'over'} ${dims.w}×${dims.h} (${kind})`);
  }
  if (e.decodedBytes !== e.w * e.h * 4) {
    v.push(`decodedBytes ${e.decodedBytes} ≠ w × h × 4`);
  }
  if (e.avif.bytes > limit.avif) {
    v.push(`AVIF ${kbText(e.avif.bytes)} over ${kbText(limit.avif)}`);
  }
  if (e.webp.bytes > limit.webp) {
    v.push(`WebP ${kbText(e.webp.bytes)} over ${kbText(limit.webp)}`);
  }
  v.push(...fileProblems(a, e.avif), ...fileProblems(a, e.webp));
  if (conflict !== undefined) {
    v.push(conflict);
  }
  const note = v.length > 0 ? v.join('; ') : `${e.w}×${e.h}, WebP ${kbText(e.webp.bytes)}`;
  return { name, valueBytes: e.avif.bytes, limitBytes: limit.avif, status: v.length > 0 ? 'FAIL' : 'PASS', note, unit: 'KB' };
}

function audioRow(a: AssetInputs, id: AssetId, e: Extract<AssetEntry, { kind: 'audio' }>, conflict: string | undefined, limits: Limits): Row {
  const name = `audio ${id}`;
  const v: string[] = [];
  const wav = e.codec === 'wav';
  // K23: WAV is the placeholder format only; a real clip ships as AAC/M4A (the real-audio lane).
  const entry = a.catalog === null ? undefined : catalogAudio(a.catalog, id);
  if (wav && (entry === undefined || !('placeholder' in entry))) {
    v.push('WAV is allowed only for a catalog placeholder (K23)');
  }
  let limit: number;
  if (e.role === 'bgm') {
    limit = wav ? limits.bgmWavBytes : limits.bgmM4aBytes;
    if (e.durationMs > limits.bgmMs) {
      v.push(`${e.durationMs} ms over ${limits.bgmMs} ms`);
    }
  } else {
    limit = limits.sfxBytes;
    if (e.durationMs > limits.sfxMs) {
      v.push(`${e.durationMs} ms over ${limits.sfxMs} ms`);
    }
  }
  if (e.file.bytes > limit) {
    v.push(`${e.codec} ${kbText(e.file.bytes)} over ${kbText(limit)}`);
  }
  v.push(...fileProblems(a, e.file));
  if (conflict !== undefined) {
    v.push(conflict);
  }
  const note = v.length > 0 ? v.join('; ') : `${e.codec}, ${e.durationMs} ms`;
  return { name, valueBytes: e.file.bytes, limitBytes: limit, status: v.length > 0 ? 'FAIL' : 'PASS', note, unit: 'KB' };
}

/** Raw and brotli limits on one file; the value shown is the brotli size. */
function sizedRow(name: string, file: Sized | null, rawLimit: number, brLimit: number | null, missing: string): Row {
  if (file === null) {
    return failed(name, brLimit ?? rawLimit, missing);
  }
  if (brLimit === null) {
    return measured(name, file.rawBytes, rawLimit, 'raw');
  }
  const over = file.rawBytes > rawLimit ? `raw ${kbText(file.rawBytes)} over ${kbText(rawLimit)}` : `raw ${kbText(file.rawBytes)}`;
  const status = file.rawBytes > rawLimit || file.brBytes > brLimit ? 'FAIL' : 'PASS';
  return { name, valueBytes: file.brBytes, limitBytes: brLimit, status, note: over, unit: 'KB' };
}

function decoded(e: AssetEntry | undefined): number | null {
  return e?.kind === 'image' ? e.decodedBytes : null;
}

/** The images of `ids` in `manifest`: their decoded bytes; an id the manifest lacks is reported. */
function decodedOf(manifest: AssetManifest, ids: Iterable<AssetId>, lacking: string[]): Map<AssetId, number> {
  const out = new Map<AssetId, number>();
  for (const id of ids) {
    if (imageKind(id) === null) {
      continue;
    }
    const bytes = decoded(manifest.assets[id]);
    if (bytes === null) {
      lacking.push(id);
    } else {
      out.set(id, bytes);
    }
  }
  return out;
}

/**
 * bound(carried): what a predecessor may leave on stage, one of each slot: the largest bg, the largest CG, per
 * character its largest expression (PP "Budgets", `budget/knot-set`); a carried prop stays as itself.
 */
function carriedBound(carried: ReadonlyMap<AssetId, number>): number {
  const slots = new Map<string, number>();
  for (const [id, bytes] of carried) {
    const parts = id.split('/');
    const slot = parts[0] === 'char' ? `char/${parts[1] ?? ''}` : parts[0] === 'prop' ? id : (parts[0] ?? id);
    slots.set(slot, Math.max(slots.get(slot) ?? 0, bytes));
  }
  return [...slots.values()].reduce((s, b) => s + b, 0);
}

function knotRows(a: AssetInputs, limits: Limits): Row[] {
  const rows: Row[] = [];
  if (a.usage === null) {
    return rows;
  }
  for (const c of a.chapters) {
    const knots = a.usage.chapters[c.id]?.knots;
    if (c.manifest === null || knots === undefined) {
      continue; // a missing manifest or usage chapter is an `asset inputs` problem
    }
    for (const [knot, k] of Object.entries(knots).sort(([x], [y]) => (x < y ? -1 : 1))) {
      const name = `knot-set ${c.id}/${knot}`;
      const lacking: string[] = [];
      const own = new Set<AssetId>([...k.assets, ...k.next.flatMap((n) => knots[n]?.assets ?? [])]);
      const ownBytes = [...decodedOf(c.manifest.value, own, lacking).values()].reduce((s, b) => s + b, 0);
      const carriedBytes = carriedBound(decodedOf(c.manifest.value, k.carried, lacking));
      const total = ownBytes + carriedBytes;
      const note = `own ${mib(ownBytes)} + carried ${mib(carriedBytes)}`;
      rows.push(
        lacking.length > 0
          ? failed(name, limits.knotSet, `${note}; not in ${c.id}'s manifest: ${lacking.join(', ')}`, 'MiB')
          : measured(name, total, limits.knotSet, note, 'MiB'),
      );
    }
  }
  return rows;
}

/** PUZZLES-PLAN `budget/room-set`: per room, bg + props + max(largest neighbour bg, largest close-up). */
function roomRows(a: AssetInputs, limits: Limits): Row[] {
  const rows: Row[] = [];
  for (const [key, room] of Object.entries(a.rooms).sort(([x], [y]) => (x < y ? -1 : 1))) {
    const name = `room-set ${key}`;
    const ch = key.slice(0, key.indexOf('/'));
    const manifest = a.chapters.find((c) => c.id === ch)?.manifest ?? null;
    if (manifest === null) {
      rows.push(failed(name, limits.roomSet, `no manifest for ${ch}`, 'MiB'));
      continue;
    }
    const lacking: string[] = [];
    const sum = (ids: readonly AssetId[]): number => [...decodedOf(manifest.value, ids, lacking).values()].reduce((s, b) => s + b, 0);
    const max = (ids: readonly AssetId[]): number => Math.max(0, ...decodedOf(manifest.value, ids, lacking).values());
    const total = sum([room.bg]) + sum(room.props) + Math.max(max(room.neighbours), max(room.closeups));
    const note = `bg + ${room.props.length} props + max(neighbour bg, close-up)`;
    rows.push(
      lacking.length > 0
        ? failed(name, limits.roomSet, `not in ${ch}'s manifest: ${lacking.join(', ')}`, 'MiB')
        : measured(name, total, limits.roomSet, note, 'MiB'),
    );
  }
  const sectioned = a.chapters.filter((c) => c.world?.hasSections === true);
  for (const c of sectioned.filter((ch) => !Object.keys(a.rooms).some((key) => key.startsWith(`${ch.id}/`)))) {
    rows.push(failed(`room-set ${c.id}`, limits.roomSet, `story/${c.id}/world.json has sections and usage.json has no rooms for ${c.id}`, 'MiB'));
  }
  if (sectioned.length === 0 && Object.keys(a.rooms).length === 0) {
    rows.push(pending('room-set', limits.roomSet, 'no world with sections', 'MiB'));
  }
  return rows;
}

function worldRows(a: AssetInputs, limits: Limits): Row[] {
  const worlds = a.chapters.filter((c) => c.world !== null);
  if (worlds.length === 0) {
    return [pending('world json', limits.worldBr, 'no story/<ch>/world.json')];
  }
  // The public world the client downloads (PUZZLES-PLAN "Build outputs"), not the source with its solutions.
  return worlds.map((c) => sizedRow(`world json ${c.id}`, c.world?.public ?? null, limits.worldRaw, limits.worldBr, 'public world output missing'));
}

/** The AVIF bytes of a chapter's first knot images, or why they cannot be summed. */
function firstKnotAvif(c: ChapterInputs): { ok: true; bytes: number } | { ok: false; problem: string } {
  if (c.meta === null || c.manifest === null) {
    return { ok: false, problem: `${c.meta === null ? 'meta' : 'manifest'} missing` };
  }
  const ids = c.meta.value.knots[c.meta.value.firstKnot]?.assets ?? [];
  let bytes = 0;
  const lacking: string[] = [];
  for (const id of ids.filter((x) => imageKind(x) !== null)) {
    const e = c.manifest.value.assets[id];
    if (e?.kind === 'image') {
      bytes += e.avif.bytes;
    } else {
      lacking.push(id);
    }
  }
  return lacking.length > 0 ? { ok: false, problem: `not in the manifest: ${lacking.join(', ')}` } : { ok: true, bytes };
}

function transferRow(c: ChapterInputs, limits: Limits): Row {
  const name = `transfer ${c.id}`;
  if (c.manifest === null) {
    return failed(name, limits.transfer, 'manifest missing');
  }
  const entries = Object.values(c.manifest.value.assets);
  const bytes = entries.reduce((s, e) => s + (e.kind === 'image' ? e.avif.bytes : e.file.bytes), 0);
  return measured(name, bytes, limits.transfer, `${entries.length} assets (images as AVIF)`);
}

/**
 * First-load to the first line, per story (STORIES-PLAN "Budgets and validation"): the head of every chain (a free
 * chapter that no `next` names). The JS is entry + engine closures; PENDING while the engine source is absent.
 */
function firstLoadRows(dist: BudgetInputs, a: AssetInputs, limits: Limits): Row[] {
  const sizes = new Map(dist.files.map((f) => [f.path, f.brBytes]));
  const entry = findEntry(dist.manifest);
  const entryClosure = entry.ok && dist.manifest !== null ? closure(dist.manifest, entry.key, 'static') : null;
  const js = firstLineJs(dist, entry, entryClosure, sizes);
  const css = dist.files.filter((f) => f.path.endsWith('.css')).reduce((s, f) => s + f.brBytes, 0);
  const html = sizes.get('index.html');
  const named = new Set(a.list.flatMap((c) => (c.next === null ? [] : [c.next])));
  const heads = a.list.filter((c) => !c.paid && !named.has(c.id));
  // The 3 largest covers bound the 3 eager Home cards whatever their order (STORIES-PLAN Y15).
  const coverAvifs = Object.values(a.covers?.value.assets ?? {})
    .map((e) => e.avif.bytes)
    .sort((x, y) => y - x)
    .slice(0, 3)
    .reduce((s, b) => s + b, 0);
  return heads.map((head) => {
    const name = `first-load ${head.id}`;
    const c = a.chapters.find((x) => x.id === head.id);
    const knot = c === undefined ? null : firstKnotAvif(c);
    const parts: ReadonlyArray<readonly [string, number | null]> = [
      [js.ok ? 'JS' : `JS (${js.problem})`, js.ok ? js.bytes : null],
      ['index.html', html ?? null],
      ['story-gen/catalog.json', a.chapterCatalog?.brBytes ?? null],
      ['covers.json', a.covers?.brBytes ?? null],
      [`${head.id} story`, c?.story?.brBytes ?? null],
      [`${head.id} meta`, c?.meta?.brBytes ?? null],
      [`${head.id} manifest`, c?.manifest?.brBytes ?? null],
      [knot?.ok === false ? `first knot images (${knot.problem})` : 'first knot images', knot?.ok === true ? knot.bytes : null],
    ];
    const missing = parts.filter(([, bytes]) => bytes === null).map(([part]) => part);
    if (missing.length > 0) {
      return failed(name, limits.firstLoad, `cannot sum: ${missing.join(', ')} missing`);
    }
    const bytes = parts.reduce((s, [, b]) => s + (b ?? 0), 0) + css + TWA_BYTES + coverAvifs;
    return partialRow(name, bytes, limits.firstLoad, js.ok && js.partial, 'JS + CSS + html + TWA + catalog + covers + chapter + first knot');
  });
}

/** The asset rows; `dist` feeds the first-load rows' JS, CSS and html. */
export function evaluateAssets(dist: BudgetInputs, a: AssetInputs, limits: Limits): Row[] {
  const rows: Row[] = [];
  rows.push(
    a.problems.length === 0
      ? { name: 'asset inputs', valueBytes: null, limitBytes: null, status: 'PASS', note: `${a.chapters.length} chapters`, unit: 'KB' }
      : failed('asset inputs', null, a.problems.join('; ')),
  );
  for (const c of a.chapters) {
    rows.push(sizedRow(`story json ${c.id}`, c.story, limits.storyRaw, limits.storyBr, 'story missing'));
    rows.push(sizedRow(`en table ${c.id}`, c.en, limits.enRaw, null, 'en table missing'));
    rows.push(transferRow(c, limits));
    const knot = firstKnotAvif(c);
    rows.push(
      knot.ok
        ? measured(`first knot images ${c.id}`, knot.bytes, limits.firstKnotImages, 'AVIF')
        : failed(`first knot images ${c.id}`, limits.firstKnotImages, knot.problem),
    );
  }
  rows.push(...worldRows(a, limits));
  const { entries, conflicts } = allEntries(a);
  for (const [id, e] of [...entries].sort(([x], [y]) => (x < y ? -1 : 1))) {
    rows.push(e.kind === 'image' ? imageRow(a, id, e, conflicts.get(id), limits) : audioRow(a, id, e, conflicts.get(id), limits));
  }
  rows.push(...knotRows(a, limits), ...roomRows(a, limits), ...firstLoadRows(dist, a, limits));
  return rows;
}

function kb(bytes: number | null): string {
  return bytes === null ? '—' : `${(bytes / 1000).toFixed(1)} KB`;
}

function amount(bytes: number | null, unit: Row['unit']): string {
  return unit === 'MiB' && bytes !== null ? mib(bytes) : kb(bytes);
}

/** One `name | value | limit | STATUS` line per row (the note after it), then the tally line. */
export function formatRows(rows: Row[]): string {
  const lines = rows.map((r) => {
    const line = `${r.name} | ${amount(r.valueBytes, r.unit)} | ${amount(r.limitBytes, r.unit)} | ${r.status}`;
    return r.note === '' ? line : `${line} | ${r.note}`;
  });
  const count = (s: Status): number => rows.filter((r) => r.status === s).length;
  lines.push(`budget: ${rows.length} rows, ${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('PENDING')} PENDING`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// CLI: node scripts/budget.ts [--dist <dir>] [--root <repo>]   (cwd = client/; exit 1 iff a row FAILs or dist is
// missing). --root (default: the repository this script is in) is where every non-dist input is read.

/** rolldown writes the files of one build in any order; only a manifest older than this is another build's. */
const STALE_MS = 2_000;

/** Every regular file under `root`, dot-directories included, symlinks not followed; '/' separators. */
export function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  };
  visit(root, '');
  return out.sort();
}

function brotliBytes(data: Buffer): number {
  return brotliCompressSync(data, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
  }).length;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown, what: string): string[] | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
    throw new Error(`${what} is not a string array`);
  }
  return v;
}

function optional<T>(v: unknown, kind: 'string' | 'boolean', what: string): T | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (typeof v !== kind) {
    throw new Error(`${what} is not a ${kind}`);
  }
  return v as T; // checked by typeof against `kind` on the line above
}

/** dist/.vite/manifest.json -> chunks; throws on a shape this script does not understand. */
export function parseManifest(json: unknown): Record<string, ManifestChunk> {
  if (!isRecord(json)) {
    throw new Error('manifest is not an object');
  }
  const out: Record<string, ManifestChunk> = {};
  for (const [key, raw] of Object.entries(json)) {
    if (!isRecord(raw) || typeof raw.file !== 'string') {
      throw new Error(`manifest entry ${key} has no file`);
    }
    out[key] = {
      file: raw.file,
      src: optional<string>(raw.src, 'string', `${key}.src`),
      isEntry: optional<boolean>(raw.isEntry, 'boolean', `${key}.isEntry`),
      isDynamicEntry: optional<boolean>(raw.isDynamicEntry, 'boolean', `${key}.isDynamicEntry`),
      imports: stringArray(raw.imports, `${key}.imports`),
      dynamicImports: stringArray(raw.dynamicImports, `${key}.dynamicImports`),
      css: stringArray(raw.css, `${key}.css`),
    };
  }
  return out;
}

/** Reads a built dist into evaluate()'s inputs; `problems` explains a manifest that could not be used. */
export function readInputs(distDir: string, clientRoot: string): { inputs: BudgetInputs; problems: string[] } {
  const problems: string[] = [];
  const files = walkFiles(distDir).map((rel): DistFile => {
    const data = readFileSync(path.join(distDir, rel));
    return { path: rel, rawBytes: data.length, brBytes: brotliBytes(data) };
  });
  const manifestPath = path.join(distDir, '.vite', 'manifest.json');
  const htmlPath = path.join(distDir, 'index.html');
  let manifest: Record<string, ManifestChunk> | null = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
    } catch (e) {
      problems.push(`dist/.vite/manifest.json unreadable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const indexHtml = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : null;
  const manifestStale =
    manifest !== null && indexHtml !== null && statSync(manifestPath).mtimeMs < statSync(htmlPath).mtimeMs - STALE_MS;
  const sourceExists = (src: string): boolean => existsSync(path.join(clientRoot, ...src.split('/')));
  const engineSourceExists = sourceExists(ENGINE_SRC);
  const yieldsSourceExists = sourceExists(YIELDS_SRC);
  const lazySources = new Set([...LAZY_ROOTS].filter(sourceExists));
  return { inputs: { manifest, manifestStale, indexHtml, files, engineSourceExists, yieldsSourceExists, lazySources }, problems };
}

/** The repository's story and asset tool outputs as evaluateAssets() reads them; every unusable input is a problem. */
export function readAssetInputs(root: string): AssetInputs {
  const problems: string[] = [];
  const abs = (rel: string): string => path.join(root, ...rel.split('/'));
  /** A file's bytes, or null (a problem) when it is not there. */
  const bytesOf = (rel: string, required = true): Buffer | null => {
    if (!existsSync(abs(rel)) || !statSync(abs(rel)).isFile()) {
      if (required) {
        problems.push(`${rel}: missing`);
      }
      return null;
    }
    return readFileSync(abs(rel));
  };
  const sized = (data: Buffer): Sized => ({ rawBytes: data.length, brBytes: brotliBytes(data) });
  /** A JSON file decoded, with its sizes; null (a problem) when missing, not JSON, or refused by `decode`. */
  const decodedFile = <T>(rel: string, decode: (raw: unknown) => { ok: true; value: T } | { ok: false; error: readonly unknown[] }): (Sized & { value: T }) | null => {
    const data = bytesOf(rel);
    if (data === null) {
      return null;
    }
    let raw: unknown;
    try {
      const text = data.toString('utf8');
      raw = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text);
    } catch (e) {
      problems.push(`${rel}: not JSON: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    const r = decode(raw);
    if (!r.ok) {
      problems.push(...r.error.map((issue) => `${rel}: ${issueText(issue)}`));
      return null;
    }
    return { ...sized(data), value: r.value };
  };
  const anyJson = (raw: unknown): { ok: true; value: unknown } => ({ ok: true, value: raw });
  const list = decodedFile('story/chapters.json', decodeChapterList)?.value ?? [];
  const catalog = decodedFile('assets/catalog.json', decodeAssetCatalog)?.value ?? null;
  const usage = decodedFile('server/content/build/usage.json', decodeStoryUsage)?.value ?? null;
  const covers = decodedFile('client/src/story-gen/covers.json', decodeCoverManifest);
  const catalogFile = decodedFile('client/src/story-gen/catalog.json', anyJson);
  const chapters: ChapterInputs[] = list.map((c) => {
    const dir = c.paid ? `server/content/chapters/${c.id}/` : `client/src/story-gen/free/${c.id}.`;
    const story = decodedFile(`${dir}story.json`, anyJson);
    const meta = decodedFile(`${dir}meta.json`, decodeChapterMeta);
    const en = decodedFile(`${dir}en.json`, anyJson);
    const manifest = decodedFile(`${dir}assets.json`, decodeAssetManifest);
    if (meta !== null && meta.value.chapterId !== c.id) {
      problems.push(`${dir}meta.json: chapterId is ${meta.value.chapterId}, not ${c.id}`);
    }
    if (manifest !== null && manifest.value.chapterId !== c.id) {
      problems.push(`${dir}assets.json: chapterId is ${manifest.value.chapterId}, not ${c.id}`);
    }
    // PUZZLES-PLAN: a chapter's world is optional; when the source exists it must decode, and its public output is
    // what the client downloads (measured by the world json row).
    const source = bytesOf(`story/${c.id}/world.json`, false);
    let world: ChapterInputs['world'] = null;
    if (source !== null) {
      const sections = decodedFile(`story/${c.id}/world.json`, worldHasSections);
      const out = bytesOf(`${dir}world.json`, false);
      world = { hasSections: sections?.value ?? false, public: out === null ? null : sized(out) };
    }
    const strip = <T>(f: (Sized & { value: T }) | null): Sized | null => (f === null ? null : { rawBytes: f.rawBytes, brBytes: f.brBytes });
    return { id: c.id, paid: c.paid, story: strip(story), meta, en: strip(en), manifest, world };
  });
  if (usage !== null) {
    for (const c of list.filter((ch) => usage.chapters[ch.id] === undefined)) {
      problems.push(`server/content/build/usage.json: no chapter ${c.id}`);
    }
  }
  const fileBytes = new Map<string, number>();
  const refs = [
    ...chapters.flatMap((c) => Object.values(c.manifest?.value.assets ?? {})),
    ...Object.values(covers?.value.assets ?? {}),
  ].flatMap((e) => (e.kind === 'image' ? [e.avif, e.webp] : [e.file]));
  for (const ref of refs) {
    const rel = urlPath(ref.url);
    if (rel !== null && existsSync(abs(rel)) && statSync(abs(rel)).isFile()) {
      fileBytes.set(rel, statSync(abs(rel)).size);
    }
  }
  return {
    problems,
    list,
    chapters,
    catalog,
    usage,
    rooms: usage === null ? {} : assetUsage(usage).rooms,
    covers,
    chapterCatalog: catalogFile === null ? null : { rawBytes: catalogFile.rawBytes, brBytes: catalogFile.brBytes },
    fileBytes,
  };
}

/** A decoder issue as text: the story tool's strings as they are, a catalog issue as `<path>: <detail>`. */
function issueText(issue: unknown): string {
  if (typeof issue === 'string') {
    return issue;
  }
  const i = issue as { path?: unknown; detail?: unknown }; // a CatalogIssue of the src/ decoders
  return `${String(i.path)}: ${String(i.detail)}`;
}

/** Runs the CLI; returns the exit code. */
export function main(argv: readonly string[], clientRoot: string): number {
  let dist = 'dist';
  let root = path.resolve(clientRoot, '..');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--dist' && value !== undefined) {
      dist = value;
      i++;
    } else if (arg === '--root' && value !== undefined) {
      root = path.resolve(value);
      i++;
    } else {
      console.error(`budget: unknown argument ${arg ?? ''}; usage: node scripts/budget.ts [--dist <dir>] [--root <repo>]`);
      return 2;
    }
  }
  const distDir = path.resolve(dist);
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    console.error(`budget: ${distDir} does not exist; run vite build first`);
    return 1;
  }
  const { inputs, problems } = readInputs(distDir, path.join(root, 'client'));
  const assets = readAssetInputs(root);
  const rows = [...evaluate(inputs, LIMITS), ...evaluateAssets(inputs, assets, LIMITS)];
  console.log(`budget: dist ${distDir}; ${inputs.files.length} files; root ${root}; brotli q11; KB = 1000 B, MiB = 1,048,576 B`);
  for (const problem of problems) {
    console.log(`budget: ${problem}`);
  }
  console.log(formatRows(rows));
  return rows.some((r) => r.status === 'FAIL') ? 1 : 0;
}

/** A path with its links resolved the way Node resolves the main module; as given when it does not exist. */
function canonical(p: string): string {
  const resolved = path.resolve(p);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function invokedDirectly(moduleUrl: string): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) {
    return false;
  }
  // Node loads the main module from its realpath while argv[1] keeps the caller's spelling (a junction, a symlinked
  // /tmp): only canonical forms compare, or a linked path would skip main() and exit 0 without a word.
  const self = canonical(fileURLToPath(moduleUrl));
  const invoked = canonical(argv1);
  // Windows paths compare case-insensitively (drive letters arrive as d: or D:).
  return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}

if (invokedDirectly(import.meta.url)) {
  const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = main(process.argv.slice(2), clientRoot);
}
