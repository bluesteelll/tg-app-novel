// The story tool (STAGING-DSL §11): catalog checks (chapters, assets, cast, the story list) → the worlds decoded →
// source lint → compile → knot graph (given the world) and story endings → the world lint and the soft-lock check →
// localization and invoice titles → seeded playthroughs (through the worlds' yields) → emit. Every finding is
// printed, never only the first; outputs are written (and stale ones deleted)
// only when no error remains, then story-gen is read back for paid leaks. Exit 1 iff an error remains. The story
// sources are rewritten only on request (STAGING-DSL §4): `--fix-ids` writes the missing line IDs into the ink files
// before the lint, `--sync-locales` appends the new IDs to the en tables before the localization checks.
// Usage: node scripts/story.ts [--strict] [--fix-ids] [--sync-locales] [--root <repo>]   (`--strict`: every warning is
// an error; the repo root defaults to two levels above this script, never the cwd)
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetIndex, decodeChapterList } from '../src/story/catalog.ts';
import type { AssetCatalog, Cast, CatalogIssue, ChapterListEntry, EndingName, StoryId } from '../src/story/catalog.ts';
import type { AssetIndex, ChapterId, KnotName, LineId, PuzzleLocalId } from '../src/story/staging.ts';
import { toPublic } from '../src/world/decode.ts';
import type { WorldPublicBody, WorldSource } from '../src/world/types.ts';
import { compileChapter } from './story/compile.ts';
import type { CompiledChapter } from './story/compile.ts';
import { OUT, chapterPaths, decodeLineFingerprints, hintIdsOf, paidLeak, planEmit, storyVersion } from './story/emit.ts';
import type { StoryNames, WorldNeedles } from './story/emit.ts';
import { ID_SHAPED_RE, fixIds, fixWorldIds, syncLocales } from './story/fix.ts';
import { buildGraph } from './story/graph.ts';
import type { ChapterGraph, GraphFacts, WorldRef } from './story/graph.ts';
import { LINT_CODES, lintCatalog, lintSources } from './story/lint.ts';
import type { Finding, LintCode, SourceChapter, SourceLintInput } from './story/lint.ts';
import { RETIRED_FILE, checkLocales, decodeEnTable, decodeNameTable, decodeRetired } from './story/locales.ts';
import type { EnTable } from './story/locales.ts';
import { ALLOW_FILE, coverageLine, decodeAllow, playChapter } from './story/playthrough.ts';
import type { CarrySnapshot, ChapterPlay } from './story/playthrough.ts';
import { STORIES_FILE, checkEndings, checkInvoiceTitles, decodeStories, endingKnots } from './story/stories.ts';
import type { StoryPlan } from './story/stories.ts';
import { WORLD_FILE, decodeWorldFile, lintWorld, worldFingerprints, worldLines } from './story/world.ts';
import type { SectionReport, WorldLine } from './story/world.ts';

const USAGE = 'usage: node scripts/story.ts [--strict] [--fix-ids] [--sync-locales] [--root <repo>]';
/** The en tables (STAGING-DSL §4): `<ch>.json` per chapter, beside the names and titles of `story.json`. */
const EN_DIR = 'story/locales/en';
const NAME_TABLE = 'story.json';
const BOM = String.fromCharCode(0xfeff);
const SUFFIX_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

function finding(code: LintCode, file: string, message: string): Finding {
  return { code, severity: LINT_CODES[code], file, line: 0, message };
}

/** Findings of the source lint, the compiler and the graph name story-relative files; printed repo-relative. */
function inStory(findings: readonly Finding[]): Finding[] {
  return findings.map((f) => ({ ...f, file: `story/${f.file}` }));
}

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** A JSON file of the repo, parsed; a missing or unparsable file is a `code` finding. */
function readJson(root: string, rel: string, code: LintCode, out: Finding[]): { ok: true; value: unknown } | { ok: false } {
  const abs = path.join(root, ...rel.split('/'));
  if (!existsSync(abs)) {
    out.push(finding(code, rel, 'missing'));
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(stripBom(readFileSync(abs, 'utf8'))) };
  } catch (e) {
    out.push(finding(code, rel, `not JSON: ${e instanceof Error ? e.message : String(e)}`));
    return { ok: false };
  }
}

/**
 * Every file under `dir` (repo-relative posix keys under `rel`), filtered by `keep`, with any BOM stripped unless
 * `raw`; none if `dir` is missing.
 */
function readTree(root: string, rel: string, keep: (name: string) => boolean, raw = false): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (relDir: string): void => {
    const abs = path.join(root, ...relDir.split('/'));
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(child);
      } else if (entry.isFile() && keep(entry.name)) {
        const text = readFileSync(path.join(abs, entry.name), 'utf8');
        out.set(child, raw ? text : stripBom(text));
      }
    }
  };
  if (existsSync(path.join(root, ...rel.split('/')))) {
    visit(rel);
  }
  return out;
}

/**
 * Before a write: every entry of story-gen/free/ whose `<ch>.` prefix is not a free chapter now (a chapter removed,
 * or flipped to paid: its story, meta and asset manifest must leave the public build input), every
 * server/content/chapters/<ch>/ whose <ch> is not a paid chapter now, every server/content/puzzles/ entry that is not
 * `<listed ch>.json` (the server refuses to start on a puzzle file whose chapter left the index), and the world output
 * of each listed chapter that has no world now (`withWorld`: a stale paid world would still be served).
 */
function deleteStale(root: string, chapters: readonly ChapterListEntry[], withWorld: ReadonlySet<ChapterId>): void {
  const free = new Set<string>(chapters.filter((c) => !c.paid).map((c) => c.id));
  const paid = new Set<string>(chapters.filter((c) => c.paid).map((c) => c.id));
  const sweep = (rel: string, keep: (name: string) => boolean): void => {
    const dir = path.join(root, ...rel.split('/'));
    if (!existsSync(dir)) {
      return;
    }
    for (const name of readdirSync(dir).filter((n) => !keep(n))) {
      rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  };
  sweep(OUT.free, (name) => {
    const dot = name.indexOf('.');
    return dot > 0 && free.has(name.slice(0, dot));
  });
  sweep(OUT.paid, (name) => paid.has(name));
  const listed = new Set(chapters.map((c) => `${c.id}.json`));
  sweep(OUT.puzzles, (name) => listed.has(name));
  for (const ch of chapters.filter((c) => !withWorld.has(c.id))) {
    rmSync(path.join(root, ...chapterPaths(ch).world.split('/')), { force: true });
  }
}

function write(root: string, plan: ReadonlyMap<string, string>): void {
  for (const [rel, text] of plan) {
    const abs = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text, 'utf8');
  }
}

/** A repo file's text as stored (a BOM is the locale decoders' to strip), or null when it does not exist. */
function readRaw(root: string, rel: string): string | null {
  const abs = path.join(root, ...rel.split('/'));
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** Every story/locales/en/<name>.json except story.json, as stored, keyed by <name> in name order. */
function readEnTables(root: string): Map<string, string> {
  const dir = path.join(root, ...EN_DIR.split('/'));
  if (!existsSync(dir)) {
    return new Map();
  }
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== NAME_TABLE)
    .map((e) => e.name)
    .sort();
  return new Map(names.map((name) => [name.slice(0, -'.json'.length), readFileSync(path.join(dir, name), 'utf8')]));
}

/**
 * `--sync-locales` (STAGING-DSL §4): per compiled chapter, in list order, its en table with an entry appended for each
 * new line ID, written only when the text changed; `tables` (<ch> → text) then holds the new text. Returns the report
 * lines.
 */
function syncPass(
  root: string,
  chapters: readonly ChapterListEntry[],
  graphs: ReadonlyMap<ChapterId, ChapterGraph>,
  worlds: ReadonlyMap<ChapterId, readonly WorldLine[]>,
  tables: Map<string, string>,
): string[] {
  const notes: string[] = [];
  for (const ch of chapters) {
    const graph = graphs.get(ch.id);
    if (graph === undefined) {
      continue;
    }
    const rel = `${EN_DIR}/${ch.id}.json`;
    const before = tables.get(ch.id) ?? null;
    // The world's texts after the ink lines, its hints included: a hint's en is shipped by the server (D10).
    const r = syncLocales({ text: before }, [...graph.lines, ...(worlds.get(ch.id) ?? [])]);
    if ('error' in r) {
      notes.push(`sync-locales: ${rel} is not a valid table; not rewritten`);
      continue;
    }
    if (r.text !== before) {
      write(root, new Map([[rel, r.text]]));
      tables.set(ch.id, r.text);
    }
    notes.push(`sync-locales: ${ch.id} +${r.added.length} entries`);
  }
  return notes;
}

/**
 * Stage 5 (STAGING-DSL §4, §11): the en tables (`texts`, <ch> → text), story/locales/{ru,en}/story.json and
 * story/retired-ids.txt decoded and checked; their findings go to `out`. Returns the decoded en tables and the
 * catalog's names and titles (null iff one is missing).
 */
function localeStage(
  root: string,
  input: {
    chapters: readonly ChapterListEntry[] | null;
    graphs: ReadonlyMap<ChapterId, ChapterGraph>;
    cast: Cast;
    texts: ReadonlyMap<string, string>;
    /** The decoded stories, whose titles and teasers are required ([] when the story list did not decode). */
    stories: readonly StoryId[];
    /** Per chapter whose world decoded, its texts (story-relative files, like the graphs' lines). */
    worlds: ReadonlyMap<ChapterId, readonly WorldLine[]>;
  },
  out: Finding[],
): { en: ReadonlyMap<string, EnTable>; names: StoryNames | null } {
  const en = new Map<string, EnTable>();
  for (const [name, text] of input.texts) {
    const d = decodeEnTable(`locales/en/${name}.json`, text);
    out.push(...inStory(d.findings));
    en.set(name, d.table);
  }
  const ru = decodeNameTable('locales/ru/story.json', readRaw(root, 'story/locales/ru/story.json'));
  const enNames = decodeNameTable('locales/en/story.json', readRaw(root, `${EN_DIR}/${NAME_TABLE}`));
  const retired = decodeRetired(readRaw(root, `story/${RETIRED_FILE}`));
  out.push(...inStory([...ru.findings, ...enNames.findings, ...retired.findings]));
  const r = checkLocales({
    chapters: input.chapters,
    graphs: input.graphs,
    en,
    names: { ru: ru.table, en: enNames.table },
    cast: input.cast,
    retired: retired.ids,
    stories: input.stories,
    worlds: input.worlds,
  });
  out.push(...inStory(r.findings));
  return { en, names: r.names };
}

/**
 * `--fix-ids` (STAGING-DSL §4): first a fresh ID into every world text that has none, in each listed chapter's
 * story/<ch>/world.json (D13: on the raw JSON, since such a world does not decode; it is read after this pass); then
 * a fresh ID into every line the source lint reports as `id/missing`, written into the ink file as read from disk
 * (BOM and line endings kept); `files` (story-relative, BOM-stripped) then holds the new text. The taken IDs are every
 * ID-shaped string of the ink sources, the worlds, the en tables and retired-ids.txt. Returns the report lines.
 */
function fixPass(root: string, files: Map<string, string>, input: Omit<SourceLintInput, 'files'>): string[] {
  const raw = new Map([...readTree(root, 'story', (name) => name.endsWith('.ink'), true)].map(([key, text]) => [key.slice('story/'.length), text]));
  const targets = lintSources({ ...input, files })
    .filter((f) => f.code === 'id/missing')
    .map((f) => ({ file: f.file, line: f.line }));
  const taken = new Set<string>();
  const scan = (text: string): void => {
    for (const m of text.matchAll(ID_SHAPED_RE)) {
      taken.add(m[0]);
    }
  };
  raw.forEach(scan);
  readTree(root, 'story', (name) => name === WORLD_FILE, true).forEach(scan);
  readTree(root, 'story/locales/en', (name) => name.endsWith('.json')).forEach(scan);
  const retired = path.join(root, 'story', 'retired-ids.txt');
  if (existsSync(retired)) {
    scan(readFileSync(retired, 'utf8'));
  }
  const suffix = (): string => Array.from({ length: 4 }, () => SUFFIX_CHARS.charAt(randomInt(SUFFIX_CHARS.length))).join('');
  const notes: string[] = [];
  let worldAdded = 0;
  let worldFiles = 0;
  for (const ch of input.chapters) {
    const rel = `story/${ch.id}/${WORLD_FILE}`;
    const text = readRaw(root, rel);
    if (text === null) {
      continue;
    }
    const w = fixWorldIds({ text, chapter: ch.id, taken, suffix });
    if ('error' in w) {
      notes.push(`fix-ids: ${rel} is ${w.error}; not rewritten`);
      continue;
    }
    notes.push(...w.skipped.map((s) => `fix-ids: skipped ${rel}#${s.path}: ${s.reason}`));
    if (w.added.length > 0) {
      write(root, new Map([[rel, w.text]]));
      for (const a of w.added) {
        taken.add(a.id);
      }
      worldAdded += w.added.length;
      worldFiles += 1;
    }
  }
  const r = fixIds({ files: raw, targets, chapters: input.chapters.map((c) => c.id), taken, suffix });
  write(root, new Map([...r.files].map(([key, text]) => [`story/${key}`, text])));
  for (const [key, text] of r.files) {
    files.set(key, stripBom(text));
  }
  return [
    ...notes,
    ...r.skipped.map((s) => `fix-ids: skipped story/${s.file}:${s.line}: ${s.reason}`),
    `fix-ids: ${r.added.length + worldAdded} ids added in ${r.files.size + worldFiles} files`,
  ];
}

/** A listed chapter's world (PUZZLES-PLAN "World data"): none, a file that did not decode, or the decoded source. */
type ChapterWorld =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'ok'; source: WorldSource; text: string; lines: readonly WorldLine[] };

/**
 * Each listed chapter's story/<ch>/world.json decoded (`world/schema` and the line-ID codes of its texts go to `out`,
 * repo-relative); its texts as lines with story-relative files, for the locale checks beside the graphs' lines.
 */
function readWorlds(root: string, chapters: readonly ChapterListEntry[], out: Finding[]): Map<ChapterId, ChapterWorld> {
  const worlds = new Map<ChapterId, ChapterWorld>();
  for (const ch of chapters) {
    const key = `${ch.id}/${WORLD_FILE}`;
    const text = readRaw(root, `story/${key}`);
    if (text === null) {
      worlds.set(ch.id, { kind: 'none' });
      continue;
    }
    const d = decodeWorldFile({ file: `story/${key}`, text });
    out.push(...d.findings);
    worlds.set(ch.id, d.world === null ? { kind: 'invalid' } : { kind: 'ok', source: d.world, text, lines: worldLines(d.world, key, text) });
  }
  return worlds;
}

/** The graph's world input (D6): a world that did not decode skips the world-dependent graph codes. */
function worldRef(w: ChapterWorld | undefined): WorldRef {
  if (w === undefined || w.kind === 'none') {
    return { kind: 'none' };
  }
  return w.kind === 'invalid' ? { kind: 'invalid' } : { kind: 'ok', body: toPublic(w.source) };
}

/** The puzzles the chapter's `puzzle` tags yield (`world/unreachable` of a lock-less puzzle). */
function yieldedPuzzles(facts: GraphFacts): Set<PuzzleLocalId> {
  return new Set([...facts.yields.values()].flatMap((ys) => ys.flatMap((y) => (y.kind === 'puzzle' ? [y.puzzle] : []))));
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** A listed chapter's `world:` report line (D16); `sections` is undefined when the world lint did not run. */
function worldReport(ch: ChapterId, w: ChapterWorld | undefined, sections: readonly SectionReport[] | undefined): string {
  if (w === undefined || w.kind === 'none') {
    return `world: ${ch}: none`;
  }
  if (w.kind === 'invalid') {
    return `world: ${ch}: not checked (world/schema)`;
  }
  if (sections === undefined) {
    return `world: ${ch}: not checked (catalog/assets)`;
  }
  const rooms = sections.reduce((n, s) => n + s.rooms, 0);
  const head = `world: ${ch}: ${plural(sections.length, 'section')}, ${plural(rooms, 'room')}, ${plural(Object.keys(w.source.puzzles).length, 'puzzle')}`;
  const failed = sections.filter((s) => !s.ok).length;
  return failed > 0
    ? `${head}, softlock FAIL (${failed} of ${sections.length} sections)`
    : `${head}, softlock OK (${sections.reduce((n, s) => n + (s.states ?? 0), 0)} states)`;
}

/**
 * The world needles of `paid/leak` (D12, critique O8), unioned over the listed chapters whose world decoded: every
 * hint's ID and texts, and a paid world's IDs and texts. `publicTexts` is the public projection only (critique C1).
 */
function worldNeedles(
  chapters: readonly ChapterListEntry[],
  worlds: ReadonlyMap<ChapterId, ChapterWorld>,
  en: ReadonlyMap<string, EnTable>,
  publicTexts: readonly string[],
): WorldNeedles {
  const all = { hintIds: new Set<LineId>(), hintTexts: new Set<string>(), paidIds: new Set<LineId>(), paidTexts: new Set<string>() };
  for (const ch of chapters) {
    const w = worlds.get(ch.id);
    if (w?.kind !== 'ok') {
      continue;
    }
    const table = new Map([...(en.get(ch.id)?.entries ?? [])].map(([id, e]) => [id, e.en]));
    const fp = worldFingerprints({ world: w.source, paid: ch.paid, en: table }, publicTexts);
    fp.hintIds.forEach((x) => all.hintIds.add(x));
    fp.hintTexts.forEach((x) => all.hintTexts.add(x));
    fp.paidIds.forEach((x) => all.paidIds.add(x));
    fp.paidTexts.forEach((x) => all.paidTexts.add(x));
  }
  return { hintIds: [...all.hintIds].sort(), hintTexts: [...all.hintTexts].sort(), paidIds: [...all.paidIds].sort(), paidTexts: [...all.paidTexts].sort() };
}

/**
 * A chapter's en table for emit (STAGING-DSL §4): `{ id: en }` for each of its line IDs, in source order, then its
 * world's texts, hints included (planEmit ships the hints to the server only, D10). Emit runs only without an error,
 * and `loc/missing-en` / `loc/empty-en` are errors, so every ID has a non-empty text.
 */
function shippedEn(graph: ChapterGraph, world: readonly WorldLine[], table: EnTable | undefined): Record<LineId, string> {
  const out: Record<LineId, string> = {};
  for (const l of [...graph.lines, ...world]) {
    const text = table?.entries.get(l.id)?.en;
    if (text === undefined || text.trim() === '') {
      throw new Error(`invariant: a run with no error has an en text for ${l.id}`);
    }
    out[l.id] = text;
  }
  return out;
}

/**
 * Stage 6 (STAGING-DSL §11 "Seeded playthroughs"): every listed chapter in list order, seeded from its predecessor's
 * carries. A chapter is played only if it compiled with a first knot, no error of the lint, compile, graph or world
 * stage names one of its files or its world file (`sourceErrors`, read before `--strict`), and its predecessor, if
 * any, was played: a play
 * finding then always means a runtime-only defect, never a second report of a source finding, and a successor never
 * runs on defaults the game would not give it. A run that ended in a declared story ending of its chapter carries
 * nothing (STAGING-DSL §9 "Story end"); `catalog/stories` rule 8 fails a chapter whose every end is one. Each reason
 * not to play implies an error. Its findings go to `out`; returns one report line per listed chapter and how many were
 * not played.
 */
function playStage(
  root: string,
  input: {
    chapters: readonly ChapterListEntry[];
    /** The decoded list, or null: then no allowlist entry can be judged unlisted. */
    list: readonly ChapterListEntry[] | null;
    compiled: ReadonlyMap<ChapterId, CompiledChapter>;
    graphs: ReadonlyMap<ChapterId, ChapterGraph>;
    assets: AssetIndex | null;
    cast: Cast | null;
    en: ReadonlyMap<string, EnTable>;
    sourceErrors: ReadonlySet<string>;
    /** Per chapter, its declared story endings (knot → name); empty when the story list did not decode. */
    endings: ReadonlyMap<ChapterId, ReadonlyMap<KnotName, EndingName>>;
    /** Per chapter whose world decoded, its public world: the runs play through its yields (D14). */
    worlds: ReadonlyMap<ChapterId, WorldPublicBody>;
  },
  out: Finding[],
): { lines: string[]; skipped: number } {
  const allow = decodeAllow(readRaw(root, `story/${ALLOW_FILE}`), input.list, input.graphs);
  out.push(...inStory(allow.findings));
  const plays = new Map<ChapterId, ChapterPlay>();
  const lines: string[] = [];
  let skipped = 0;
  const skip = (ch: ChapterId, why: string): void => {
    lines.push(`play: ${ch}: not played (${why})`);
    skipped += 1;
  };
  for (const ch of input.chapters) {
    const c = input.compiled.get(ch.id);
    const g = input.graphs.get(ch.id);
    if (c === undefined || g === undefined || input.assets === null || input.cast === null) {
      skip(ch.id, 'not compiled');
      continue;
    }
    const sourceFiles = [...c.files, `${ch.id}/${WORLD_FILE}`];
    if (g.firstKnot === null || sourceFiles.some((key) => input.sourceErrors.has(`story/${key}`))) {
      skip(ch.id, 'errors in its sources');
      continue;
    }
    const pred = input.chapters.find((p) => p.next === ch.id);
    const prior = pred === undefined ? undefined : plays.get(pred.id);
    if (pred !== undefined && prior === undefined) {
      skip(ch.id, `${pred.id} was not played`);
      continue;
    }
    const r = playChapter({
      chapter: { id: ch.id, paid: ch.paid, entry: ch.entry },
      json: c.json,
      graph: g,
      assets: input.assets,
      cast: input.cast,
      en: input.en.get(ch.id)?.entries ?? new Map(),
      staticIds: new Set(g.lines.map((l) => l.id)),
      allow: allow.allow,
      carry: pred === undefined || prior === undefined ? null : { from: pred.id, snapshots: carriesOn(prior, input.endings.get(pred.id)) },
      world: input.worlds.get(ch.id),
    });
    out.push(...inStory(r.findings));
    plays.set(ch.id, r.play);
    lines.push(coverageLine(r.play, g));
  }
  return { lines, skipped };
}

/** The snapshots a played chapter hands its successor: every ended run's, except a run that ended the story. */
function carriesOn(play: ChapterPlay, endings: ReadonlyMap<KnotName, EndingName> | undefined): CarrySnapshot[] {
  return play.carries.filter((c) => endings?.has(c.knot) !== true).map((c) => c.vars);
}

function issueFindings(code: LintCode, issues: readonly CatalogIssue[]): Finding[] {
  return issues.map((i) => finding(code, i.file, i.path === '' ? i.detail : `${i.path}: ${i.detail}`));
}

/** Runs the tool; returns the exit code. */
export function main(argv: readonly string[], repoRoot: string): number {
  let strict = false;
  let fix = false;
  let sync = false;
  let root = repoRoot;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--strict') {
      strict = true;
    } else if (arg === '--fix-ids') {
      fix = true;
    } else if (arg === '--sync-locales') {
      sync = true;
    } else if (arg === '--root' && value !== undefined) {
      root = path.resolve(value);
      i++;
    } else {
      console.error(`story: unknown argument ${arg ?? ''}; ${USAGE}`);
      return 2;
    }
  }

  const found: Finding[] = [];
  /** Report lines of the source fixers, printed before the chapter lines. */
  const notes: string[] = [];
  // 1. The chapter list; an entry that names no file is the list's error.
  const list = readJson(root, 'story/chapters.json', 'catalog/chapters', found);
  const decoded = list.ok ? decodeChapterList(list.value) : null;
  if (decoded !== null && !decoded.ok) {
    found.push(...issueFindings('catalog/chapters', decoded.error));
  }
  const chapters = decoded?.ok === true ? decoded.value : [];
  const ink = readTree(root, 'story', (name) => name.endsWith('.ink'));
  const files = new Map([...ink].map(([key, text]) => [key.slice('story/'.length), text]));
  for (const c of chapters.filter((ch) => !files.has(ch.entry))) {
    found.push(finding('catalog/chapters', 'story/chapters.json', `${c.id}: the entry file story/${c.entry} is missing`));
  }
  // The list is in play order (§9): a chapter's successor comes after it, so a playthrough always has its
  // predecessor's carries (stage 6) and a chain cannot loop.
  const outOfOrder = chapters.filter((c, i) => c.next !== null && chapters.findIndex((n) => n.id === c.next) <= i);
  for (const c of outOfOrder) {
    found.push(finding('catalog/chapters', 'story/chapters.json', `${c.id}: next '${c.next ?? ''}' is not a later chapter: the list is in play order (§9)`));
  }

  // 2. The asset catalog and the cast: without both, no tag can be checked, so nothing below runs.
  const catalogJson = readJson(root, 'assets/catalog.json', 'catalog/assets', found);
  const castJson = readJson(root, 'story/cast.json', 'catalog/assets', found);
  let catalog: AssetCatalog | null = null;
  let assets: AssetIndex | null = null;
  let cast: Cast | null = null;
  if (catalogJson.ok && castJson.ok) {
    const linted = lintCatalog(catalogJson.value, castJson.value);
    found.push(...linted.findings);
    catalog = linted.catalog;
    assets = catalog === null ? null : assetIndex(catalog);
    cast = linted.cast;
  }

  // The story list (§9): judged only on a list that decoded in play order, so every chain is defined and a list error
  // is never reported again as story findings, and only with the asset catalog that holds the covers.
  let plans: readonly StoryPlan[] | null = null;
  if (decoded?.ok === true && outOfOrder.length === 0 && catalog !== null) {
    const storyJson = readJson(root, STORIES_FILE, 'catalog/stories', found);
    const r = storyJson.ok ? decodeStories(storyJson.value, chapters, catalog) : null;
    if (r?.ok === true) {
      plans = r.value;
    } else if (r !== null) {
      found.push(...r.error);
    }
  }

  // 3-4. Source lint over every .ink file (after `--fix-ids` wrote the missing IDs, the worlds' first); each listed
  // chapter's world decoded; per chapter the compiler, and the graph of what compiled, given its world; then the world
  // lint of each world that decoded, given its compiled chapter.
  const sources: SourceChapter[] = chapters.map((c) => ({ id: c.id, paid: c.paid, entry: c.entry }));
  if (fix && assets !== null && cast !== null) {
    // Without the list, no file has an owning chapter, so no ID could be formed.
    notes.push(...(decoded?.ok === true ? fixPass(root, files, { chapters: sources, assets, cast }) : ['fix-ids: skipped (story/chapters.json has errors)']));
  } else if (fix) {
    notes.push(`fix-ids: skipped (${assets === null ? 'assets/catalog.json' : 'story/cast.json'} has errors)`);
  }
  const worlds = readWorlds(root, chapters, found);
  const compiled = new Map<ChapterId, CompiledChapter>();
  const graphs = new Map<ChapterId, ChapterGraph>();
  const facts = new Map<ChapterId, GraphFacts>();
  if (assets !== null && cast !== null) {
    found.push(...inStory(lintSources({ files, chapters: sources, assets, cast })));
    for (const ch of sources.filter((c) => files.has(c.entry))) {
      const r = compileChapter(ch, (key) => files.get(key) ?? null);
      found.push(...inStory(r.findings));
      if (r.compiled !== null) {
        compiled.set(ch.id, r.compiled);
        const g = buildGraph({ chapter: ch, files: r.compiled.files, sources: files, assets, world: worldRef(worlds.get(ch.id)) });
        found.push(...inStory(g.findings));
        graphs.set(ch.id, g.graph);
        facts.set(ch.id, g.facts);
      }
    }
  }
  // Without the asset catalog no world asset can be judged, so no world is linted (its report line says so).
  const sectionReports = new Map<ChapterId, readonly SectionReport[]>();
  for (const ch of sources) {
    const w = worlds.get(ch.id);
    if (w?.kind !== 'ok' || catalog === null) {
      continue;
    }
    const g = graphs.get(ch.id);
    const f = facts.get(ch.id);
    const r = lintWorld({
      chapter: ch,
      file: `story/${ch.id}/${WORLD_FILE}`,
      text: w.text,
      world: w.source,
      catalog,
      knots: g === undefined ? null : new Set(g.knots.keys()),
      yielded: f === undefined ? null : yieldedPuzzles(f),
      declared: f?.declared ?? new Map(),
    });
    found.push(...r.findings);
    sectionReports.set(ch.id, r.sections);
  }
  // The declared endings against the graphs (`catalog/stories` rule 8): its findings name story/stories.json, never a
  // chapter's file, so they never keep a chapter from being played.
  if (plans !== null) {
    found.push(...checkEndings(plans, graphs, files));
  }

  // The files an error of stages 1-4 names: such a chapter is not played (stage 6). Localization errors do not gate play.
  const sourceErrors = new Set(found.filter((f) => f.severity === 'E').map((f) => f.file));

  // 5. Localization (after `--sync-locales` appended the new IDs): the en tables of the compiled chapters, the names
  // and titles, and the ID rules no single chapter can see. Without the cast no name can be checked.
  const enTexts = readEnTables(root);
  const worldTexts = new Map([...worlds].flatMap(([ch, w]) => (w.kind === 'ok' ? [[ch, w.lines] as const] : [])));
  if (sync) {
    notes.push(...syncPass(root, chapters, graphs, worldTexts, enTexts));
  }
  const stories = plans?.map((p) => p.id) ?? [];
  const localized =
    cast === null ? null : localeStage(root, { chapters: decoded?.ok === true ? decoded.value : null, graphs, cast, texts: enTexts, stories, worlds: worldTexts }, found);
  // A paid chapter's title is its invoice title (`catalog/stories` rule 9), judged once every title is known.
  if (plans !== null && localized !== null && localized.names !== null) {
    found.push(...checkInvoiceTitles(plans, chapters, localized.names));
  }

  // 6. Seeded playthroughs of the chapters, in list order.
  const endings = plans === null ? new Map<ChapterId, ReadonlyMap<KnotName, EndingName>>() : endingKnots(plans);
  const sourceWorlds = new Map([...worlds].flatMap(([ch, w]) => (w.kind === 'ok' ? [[ch, w.source] as const] : [])));
  const played = playStage(
    root,
    {
      chapters,
      list: decoded?.ok === true ? decoded.value : null,
      compiled,
      graphs,
      assets,
      cast,
      en: localized?.en ?? new Map(),
      sourceErrors,
      endings,
      worlds: new Map([...sourceWorlds].map(([ch, w]) => [ch, toPublic(w)])),
    },
    found,
  );
  // Each reason not to play implies an error: a slip here would be a chapter silently unchecked on a green run.
  if (played.skipped > 0 && !found.some((f) => f.severity === 'E')) {
    throw new Error('invariant: a listed chapter not played implies an error');
  }

  const findings = strict ? found.map((f): Finding => (f.severity === 'W' ? { ...f, severity: 'E' } : f)) : found;
  // 7. Emit only from a clean run: a failed run writes and deletes nothing.
  if (!findings.some((f) => f.severity === 'E')) {
    if (cast === null) {
      throw new Error('invariant: a run with no error decoded the cast');
    }
    // `loc/missing-name` is an error, so a run without one has every name, title and teaser.
    const names = localized?.names ?? null;
    if (names === null) {
      throw new Error('invariant: a run with no error has names');
    }
    const en = new Map(chapters.flatMap((ch) => {
      const g = graphs.get(ch.id);
      return g === undefined ? [] : [[ch.id, shippedEn(g, worldTexts.get(ch.id) ?? [], localized?.en.get(ch.id))] as const];
    }));
    // The story list is read on every run whose chapter list decoded, and its errors are errors.
    if (plans === null) {
      throw new Error('invariant: a run with no error decoded the stories');
    }
    const plan = planEmit({ chapters, compiled, graphs, cast, names, en, stories: plans, worlds: sourceWorlds });
    deleteStale(root, chapters, new Set(sourceWorlds.keys()));
    write(root, plan);
    const fp = decodeLineFingerprints(JSON.parse(plan.get(`${OUT.build}/fingerprints.lines.json`) ?? 'null'));
    if (!fp.ok) {
      throw new Error(`invariant: the planned fingerprints decode: ${fp.error.join('; ')}`);
    }
    // What a free build legitimately ships, from the inputs, never from story-gen (D12, critique C1 and W1): the free
    // chapters' lines, their worlds' non-hint texts and their shipped en values, and the names.
    const publicTexts: string[] = [];
    for (const ch of chapters.filter((c) => !c.paid)) {
      const source = sourceWorlds.get(ch.id);
      const hints = source === undefined ? new Set<LineId>() : hintIdsOf(source);
      publicTexts.push(...(graphs.get(ch.id)?.lines ?? []).map((l) => l.text));
      publicTexts.push(...(worldTexts.get(ch.id) ?? []).filter((l) => !l.hint).map((l) => l.text));
      publicTexts.push(...Object.entries(en.get(ch.id) ?? {}).flatMap(([id, text]) => (hints.has(id as LineId) ? [] : [text]))); // keys of an en record
    }
    publicTexts.push(...[names.chapters, names.speakers, names.stories, names.teasers].flatMap((section) => Object.values(section).flatMap((n) => [n.ru, n.en])));
    findings.push(...paidLeak(readTree(root, OUT.storyGen, () => true), fp.value, worldNeedles(chapters, worlds, localized?.en ?? new Map(), publicTexts)));
  }

  // 8. Report.
  for (const note of notes) {
    console.log(note);
  }
  for (const ch of chapters) {
    const c = compiled.get(ch.id);
    const g = graphs.get(ch.id);
    const tier = ch.paid ? 'paid' : 'free';
    console.log(
      c === undefined || g === undefined
        ? `story: ${ch.id} failed`
        : `story: ${ch.id} ${tier} knots ${g.knots.size} lines ${g.lines.length} version ${storyVersion(c.json)}`,
    );
  }
  for (const ch of chapters) {
    console.log(worldReport(ch.id, worlds.get(ch.id), sectionReports.get(ch.id)));
  }
  for (const p of plans ?? []) {
    console.log(`stories: ${p.id} (${p.chapters.join(' → ')}), endings ${Object.keys(p.endings).length}`);
  }
  for (const line of played.lines) {
    console.log(line);
  }
  for (const f of findings) {
    console.log(`${f.severity} ${f.file}:${f.line} ${f.code} ${f.message}`);
  }
  const errors = findings.filter((f) => f.severity === 'E').length;
  console.log(`story: ${errors} errors, ${findings.length - errors} warnings`);
  return errors > 0 ? 1 : 0;
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
  // /tmp): only canonical forms compare, or a linked path would skip main() and exit 0 having built nothing.
  const self = canonical(fileURLToPath(moduleUrl));
  const invoked = canonical(argv1);
  // Windows paths compare case-insensitively (drive letters arrive as d: or D:).
  return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}

if (invokedDirectly(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  process.exitCode = main(process.argv.slice(2), repoRoot);
}
