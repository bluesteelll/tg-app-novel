// The story tool (STAGING-DSL §11): catalog checks → source lint → compile → knot graph → localization → emit. Every
// finding is printed, never only the first; outputs are written (and stale ones deleted) only when no error remains,
// then story-gen is read back for paid leaks. Exit 1 iff an error remains. The story sources are rewritten only on
// request (STAGING-DSL §4): `--fix-ids` writes the missing line IDs into the ink files before the lint,
// `--sync-locales` appends the new IDs to the en tables before the localization checks.
// Usage: node scripts/story.ts [--strict] [--fix-ids] [--sync-locales] [--root <repo>]   (`--strict`: every warning is
// an error; the repo root defaults to two levels above this script, never the cwd)
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetIndex, decodeChapterList } from '../src/story/catalog.ts';
import type { Cast, CatalogIssue, ChapterListEntry } from '../src/story/catalog.ts';
import type { AssetIndex, ChapterId } from '../src/story/staging.ts';
import { compileChapter } from './story/compile.ts';
import type { CompiledChapter } from './story/compile.ts';
import { OUT, decodeLineFingerprints, paidLeak, planEmit, storyVersion } from './story/emit.ts';
import type { StoryNames } from './story/emit.ts';
import { ID_SHAPED_RE, fixIds, syncLocales } from './story/fix.ts';
import { buildGraph } from './story/graph.ts';
import type { ChapterGraph } from './story/graph.ts';
import { LINT_CODES, lintCatalog, lintSources } from './story/lint.ts';
import type { Finding, LintCode, SourceChapter, SourceLintInput } from './story/lint.ts';
import { RETIRED_FILE, checkLocales, decodeEnTable, decodeNameTable, decodeRetired } from './story/locales.ts';
import type { EnTable } from './story/locales.ts';

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
 * or flipped to paid: its story, meta and asset manifest must leave the public build input), and every
 * server/content/chapters/<ch>/ whose <ch> is not a paid chapter now.
 */
function deleteStale(root: string, chapters: readonly ChapterListEntry[]): void {
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
function syncPass(root: string, chapters: readonly ChapterListEntry[], graphs: ReadonlyMap<ChapterId, ChapterGraph>, tables: Map<string, string>): string[] {
  const notes: string[] = [];
  for (const ch of chapters) {
    const graph = graphs.get(ch.id);
    if (graph === undefined) {
      continue;
    }
    const rel = `${EN_DIR}/${ch.id}.json`;
    const before = tables.get(ch.id) ?? null;
    const r = syncLocales({ text: before }, graph.lines);
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
  input: { chapters: readonly ChapterListEntry[] | null; graphs: ReadonlyMap<ChapterId, ChapterGraph>; cast: Cast; texts: ReadonlyMap<string, string> },
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
  const r = checkLocales({ chapters: input.chapters, graphs: input.graphs, en, names: { ru: ru.table, en: enNames.table }, cast: input.cast, retired: retired.ids });
  out.push(...inStory(r.findings));
  return { en, names: r.names };
}

/**
 * `--fix-ids` (STAGING-DSL §4): a fresh ID into every line the source lint reports as `id/missing`, written into the
 * ink file as read from disk (BOM and line endings kept); `files` (story-relative, BOM-stripped) then holds the new
 * text. Returns the report lines.
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
  readTree(root, 'story/locales/en', (name) => name.endsWith('.json')).forEach(scan);
  const retired = path.join(root, 'story', 'retired-ids.txt');
  if (existsSync(retired)) {
    scan(readFileSync(retired, 'utf8'));
  }
  const suffix = (): string => Array.from({ length: 4 }, () => SUFFIX_CHARS.charAt(randomInt(SUFFIX_CHARS.length))).join('');
  const r = fixIds({ files: raw, targets, chapters: input.chapters.map((c) => c.id), taken, suffix });
  write(root, new Map([...r.files].map(([key, text]) => [`story/${key}`, text])));
  for (const [key, text] of r.files) {
    files.set(key, stripBom(text));
  }
  return [
    ...r.skipped.map((s) => `fix-ids: skipped story/${s.file}:${s.line}: ${s.reason}`),
    `fix-ids: ${r.added.length} ids added in ${r.files.size} files`,
  ];
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

  // 2. The asset catalog and the cast: without both, no tag can be checked, so nothing below runs.
  const catalogJson = readJson(root, 'assets/catalog.json', 'catalog/assets', found);
  const castJson = readJson(root, 'story/cast.json', 'catalog/assets', found);
  let assets: AssetIndex | null = null;
  let cast: Cast | null = null;
  if (catalogJson.ok && castJson.ok) {
    const linted = lintCatalog(catalogJson.value, castJson.value);
    found.push(...linted.findings);
    assets = linted.catalog === null ? null : assetIndex(linted.catalog);
    cast = linted.cast;
  }

  // 3-4. Source lint over every .ink file (after `--fix-ids` wrote the missing IDs); per chapter the compiler, and the
  // graph of what compiled.
  const compiled = new Map<ChapterId, CompiledChapter>();
  const graphs = new Map<ChapterId, ChapterGraph>();
  if (assets !== null && cast !== null) {
    const sources: SourceChapter[] = chapters.map((c) => ({ id: c.id, paid: c.paid, entry: c.entry }));
    if (fix) {
      // Without the list, no file has an owning chapter, so no ID could be formed.
      notes.push(...(decoded?.ok === true ? fixPass(root, files, { chapters: sources, assets, cast }) : ['fix-ids: skipped (story/chapters.json has errors)']));
    }
    found.push(...inStory(lintSources({ files, chapters: sources, assets, cast })));
    for (const ch of sources.filter((c) => files.has(c.entry))) {
      const r = compileChapter(ch, (key) => files.get(key) ?? null);
      found.push(...inStory(r.findings));
      if (r.compiled !== null) {
        compiled.set(ch.id, r.compiled);
        const g = buildGraph({ chapter: ch, files: r.compiled.files, sources: files, assets });
        found.push(...inStory(g.findings));
        graphs.set(ch.id, g.graph);
      }
    }
  } else if (fix) {
    notes.push(`fix-ids: skipped (${assets === null ? 'assets/catalog.json' : 'story/cast.json'} has errors)`);
  }

  // 5. Localization (after `--sync-locales` appended the new IDs): the en tables of the compiled chapters, the names
  // and titles, and the ID rules no single chapter can see. Without the cast no name can be checked.
  const enTexts = readEnTables(root);
  if (sync) {
    notes.push(...syncPass(root, chapters, graphs, enTexts));
  }
  const localized = cast === null ? null : localeStage(root, { chapters: decoded?.ok === true ? decoded.value : null, graphs, cast, texts: enTexts }, found);

  const findings = strict ? found.map((f): Finding => (f.severity === 'W' ? { ...f, severity: 'E' } : f)) : found;
  // 6. Emit only from a clean run: a failed run writes and deletes nothing.
  if (!findings.some((f) => f.severity === 'E')) {
    if (cast === null) {
      throw new Error('invariant: a run with no error decoded the cast');
    }
    // `loc/missing-name` is an error, so a run without one has every name and title.
    const names = localized?.names ?? null;
    if (names === null) {
      throw new Error('invariant: a run with no error has names');
    }
    const plan = planEmit({ chapters, compiled, graphs, cast, names });
    deleteStale(root, chapters);
    write(root, plan);
    const fp = decodeLineFingerprints(JSON.parse(plan.get(`${OUT.build}/fingerprints.lines.json`) ?? 'null'));
    if (!fp.ok) {
      throw new Error(`invariant: the planned fingerprints decode: ${fp.error.join('; ')}`);
    }
    findings.push(...paidLeak(readTree(root, OUT.storyGen, () => true), fp.value));
  }

  // 7. Report.
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
