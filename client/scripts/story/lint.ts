// The source lint of docs/STAGING-DSL.md §11: pure functions over ink sources already read from disk (L3b's story
// tool reads the files and calls them). Every finding is reported, never only the first. No node:*: the app program
// compiles this module too, through src/story/dsl-doc.test.ts.
import type { Cast } from '../../src/story/catalog.ts';
import type { AssetIndex, ChapterId, TagError } from '../../src/story/staging.ts';
import { LINE_ID_RE, SPEAKER_RE, parseTags, tagKind } from '../../src/story/tags.ts';
import { classify, findUnescaped, unescapeInk } from './classify.ts';
import type { Divert, LineClass, RawTag, SourceLine } from './classify.ts';

export type Severity = 'E' | 'W';

/** Every §11 code with its severity, exactly as the doc's table (dsl-doc.test.ts holds the two in step). */
export const LINT_CODES = {
  'catalog/chapters': 'E',
  'catalog/assets': 'E',
  'tag/syntax': 'E',
  'tag/unknown-kind': 'E',
  'tag/missing-arg': 'E',
  'tag/bad-arg': 'E',
  'tag/unknown-asset': 'E',
  'tag/dynamic': 'E',
  'tag/global': 'E',
  'tag/in-choice': 'E',
  'tag/after-choice-bracket': 'E',
  'batch/conflict': 'E',
  'id/missing': 'E',
  'id/format': 'E',
  'id/multiple': 'E',
  'id/duplicate': 'E',
  'id/chapter-prefix': 'E',
  'id/retired': 'E',
  'id/on-non-text': 'E',
  'speaker/unknown': 'E',
  'speaker/in-choice': 'E',
  'choice/text-after': 'E',
  'choice/too-many': 'W',
  'text/inline-logic': 'E',
  'text/glue': 'E',
  'text/divert-on-line': 'E',
  'text/long': 'W',
  'ink/compile': 'E',
  'ink/todo': 'W',
  'ink/forbidden': 'E',
  'ink/include': 'E',
  'ink/entry': 'E',
  'ink/name': 'E',
  'vars/global-prefix': 'E',
  'vars/write-only': 'W',
  'graph/unreachable-knot': 'E',
  'graph/no-end': 'E',
  'graph/entry-below-top': 'E',
  'play/runtime-error': 'E',
  'play/step-cap': 'E',
  'play/knot-not-visited': 'E',
  'play/ending-not-reached': 'E',
  'play/line-without-id': 'E',
  'loc/missing-en': 'E',
  'loc/empty-en': 'E',
  'loc/orphan-en': 'E',
  'loc/stale-en': 'W',
  'loc/missing-name': 'E',
  'budget/knot-set': 'E',
  'paid/leak': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
export type LintCode = keyof typeof LINT_CODES;

/** `line` is 1-based; 0 means the whole file (a JSON catalog finding). */
export type Finding = { code: LintCode; severity: Severity; file: string; line: number; message: string };

/** How a parser error value reads as a lint code. */
export const TAG_REASON_CODE: Readonly<Record<TagError['reason'], LintCode>> = {
  syntax: 'tag/syntax',
  'unknown-kind': 'tag/unknown-kind',
  'missing-arg': 'tag/missing-arg',
  'bad-arg': 'tag/bad-arg',
  'unknown-asset': 'tag/unknown-asset',
  'bad-id': 'id/format',
  'multiple-id': 'id/multiple',
  conflict: 'batch/conflict',
};

/** STAGING-DSL §9: the shared declarations every chapter includes (story-relative). */
export const GLOBALS_PATH = 'common/globals.ink';

/** A chapter as story/chapters.json lists it; `entry` is story-relative posix, e.g. 'ch1/main.ink'. */
export type SourceChapter = { id: ChapterId; paid: boolean; entry: string };
/** The ink sources (story-relative posix path → text), the chapters, and the decoded catalog and cast. */
export type SourceLintInput = {
  files: ReadonlyMap<string, string>;
  chapters: readonly SourceChapter[];
  assets: AssetIndex;
  cast: Cast;
};

const TEXT_LONG_GRAPHEMES = 160;
const CHOICES_PER_BLOCK = 4;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function finding(code: LintCode, file: string, line: number, message: string): Finding {
  return { code, severity: LINT_CODES[code], file, line, message };
}

// ---------------------------------------------------------------------------------------------------------------
// Line shapes

/** The displayed content of a text-bearing line that is not a choice (text, gather, block branch), or null. */
type Said = { speaker: string | null; text: string; tags: RawTag[]; diverts: Divert[] };

function said(cls: LineClass): Said | null {
  switch (cls.kind) {
    case 'text':
    case 'gather':
    case 'block-open':
    case 'block-branch':
      return cls.text !== '' || cls.speaker !== null ? cls : null;
    default:
      return null;
  }
}

/** A choice's own tags (inside the brackets, or every tag when it has none) and the tags after `]`. */
function choiceTags(cls: Extract<LineClass, { kind: 'choice' }>): { own: RawTag[]; trailing: RawTag[] } {
  return cls.bracket === null ? { own: cls.afterTags, trailing: [] } : { own: cls.bracket.tags, trailing: cls.afterTags };
}

function choiceHasText(cls: Extract<LineClass, { kind: 'choice' }>): boolean {
  return (cls.bracket?.text ?? '') !== '' || cls.outside !== '';
}

/** Every tag written on the line, in source order. */
export function tagsOf(cls: LineClass): RawTag[] {
  switch (cls.kind) {
    case 'tags':
    case 'text':
    case 'gather':
    case 'divert':
    case 'logic':
    case 'block-open':
    case 'block-branch':
      return cls.tags;
    case 'choice':
      return [...(cls.bracket?.tags ?? []), ...cls.afterTags];
    default:
      return [];
  }
}

function isId(tag: RawTag): boolean {
  return tagKind(tag.text) === 'id';
}

/** A well-formed line ID carried by a tag, or null. */
function lineIdOf(tag: RawTag): string | null {
  if (!isId(tag)) {
    return null;
  }
  const id = tag.text.slice(tag.text.indexOf(':') + 1).trim();
  return LINE_ID_RE.test(id) ? id : null;
}

/** The IDs a line legitimately carries: on a text-bearing line, or inside the own tags of a choice with text. */
function placedIds(cls: LineClass): RawTag[] {
  if (cls.kind === 'choice') {
    return choiceHasText(cls) ? choiceTags(cls).own.filter(isId) : [];
  }
  return said(cls)?.tags.filter(isId) ?? [];
}

function isDynamic(tag: RawTag): boolean {
  return tag.text.includes('{');
}

function graphemes(text: string): number {
  return [...GRAPHEMES.segment(text)].length;
}

// ---------------------------------------------------------------------------------------------------------------
// Chapters: which files a chapter's INCLUDEs reach (STAGING-DSL §9)

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** Joins and normalizes posix segments; a result above the story root keeps its leading `..` segments. */
function resolvePath(dir: string, path: string): string {
  const out: string[] = [];
  for (const segment of `${dir}/${path}`.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join('/');
}

type Include = { file: string; line: number; path: string; resolved: string };
type Walk = { chapter: SourceChapter; files: string[]; includes: Include[] };

/**
 * The files a chapter reaches from its entry. Every INCLUDE resolves against the entry's directory, as the story
 * build's file handler does (R4 §INCLUDE: Inky semantics), never against the including file's. A path with no file
 * is skipped here: it is the compiler's error (`ink/compile`), not the lint's.
 */
function walk(chapter: SourceChapter, parsed: ReadonlyMap<string, readonly SourceLine[]>): Walk {
  const base = dirname(chapter.entry);
  const files: string[] = [];
  const includes: Include[] = [];
  const queue = [chapter.entry];
  const seen = new Set(queue);
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const lines = parsed.get(file);
    if (lines === undefined) {
      continue;
    }
    files.push(file);
    for (const l of lines) {
      if (l.cls.kind !== 'include') {
        continue;
      }
      const resolved = resolvePath(base, l.cls.path);
      includes.push({ file, line: l.line, path: l.cls.path, resolved });
      if (!seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return { chapter, files, includes };
}

// ---------------------------------------------------------------------------------------------------------------
// Line-level rules

type Ctx = { assets: AssetIndex; cast: Cast; owners: ReadonlySet<string> };
type Tagged = { line: number; tag: RawTag };

/** Per-tag parser errors of one line or choice (`tag/*`, `id/format`, `id/multiple`); conflicts are batch-level. */
function tagGroup(file: string, line: number, tags: readonly RawTag[], assets: AssetIndex, out: Finding[]): void {
  const literal: string[] = [];
  for (const tag of tags) {
    if (isDynamic(tag)) {
      out.push(finding('tag/dynamic', file, line, `'${tag.text}': tags are literal, no '{' (§2)`));
    } else {
      literal.push(tag.text);
    }
  }
  for (const e of parseTags(literal, assets).errors) {
    if (e.reason !== 'conflict') {
      out.push(finding(TAG_REASON_CODE[e.reason], file, line, `'${e.tag}': ${e.detail}`));
    }
  }
}

/** §7 conflicts of one batch, each reported on the line of the later tag. */
function batch(file: string, tags: readonly Tagged[], assets: AssetIndex, out: Finding[]): void {
  const literal = tags.filter((t) => !isDynamic(t.tag));
  let known = 0;
  for (let k = 1; k <= literal.length; k += 1) {
    const conflicts = parseTags(
      literal.slice(0, k).map((t) => t.tag.text),
      assets,
    ).errors.filter((e) => e.reason === 'conflict');
    for (const e of conflicts.slice(known)) {
      out.push(finding('batch/conflict', file, literal[k - 1]?.line ?? 0, `'${e.tag}' ${e.detail}`));
    }
    known = conflicts.length;
  }
}

function choiceRules(file: string, l: SourceLine, cls: Extract<LineClass, { kind: 'choice' }>, ctx: Ctx, out: Finding[]): void {
  const { own, trailing } = choiceTags(cls);
  const text = cls.bracket?.text ?? '';
  const hasText = choiceHasText(cls);
  tagGroup(file, l.line, own, ctx.assets, out);
  tagGroup(file, l.line, trailing, ctx.assets, out);
  for (const tag of own) {
    if (!isId(tag)) {
      out.push(finding('tag/in-choice', file, l.line, `'${tag.text}': only an id goes inside the brackets (§3.4)`));
    }
  }
  for (const tag of trailing) {
    out.push(finding('tag/after-choice-bracket', file, l.line, `'${tag.text}' after ']': put it on the next line (§3.4)`));
  }
  if (cls.outside !== '') {
    out.push(finding('choice/text-after', file, l.line, `'${cls.outside}' outside the brackets is printed with no ID (§3.4)`));
  }
  const ids = own.filter(isId);
  if (hasText && ids.length === 0) {
    out.push(finding('id/missing', file, l.line, 'a choice with text needs an id inside its brackets (§4)'));
  }
  if (!hasText) {
    for (const tag of ids) {
      out.push(finding('id/on-non-text', file, l.line, `'${tag.text}' on a choice with no text (§4)`));
    }
  }
  for (const shown of [text, cls.outside]) {
    if (SPEAKER_RE.test(shown)) {
      out.push(finding('speaker/in-choice', file, l.line, `'${shown}': a choice text has no speaker prefix (§5)`));
    }
    if (findUnescaped(shown, '{', 0) >= 0) {
      out.push(finding('text/inline-logic', file, l.line, `'${shown}': no inline logic in choice text (§10)`));
    }
  }
  const length = graphemes(unescapeInk([text, cls.outside].join(' ').trim()));
  if (length > TEXT_LONG_GRAPHEMES) {
    out.push(finding('text/long', file, l.line, `${length} graphemes (over ${TEXT_LONG_GRAPHEMES})`));
  }
}

function saidRules(file: string, l: SourceLine, s: Said, ctx: Ctx, out: Finding[]): void {
  tagGroup(file, l.line, s.tags, ctx.assets, out);
  if (!s.tags.some(isId)) {
    out.push(finding('id/missing', file, l.line, 'a text line needs an id tag (§4)'));
  }
  if (s.speaker !== null && !Object.hasOwn(ctx.cast, s.speaker)) {
    out.push(finding('speaker/unknown', file, l.line, `speaker '${s.speaker}' is not in story/cast.json (§5)`));
  }
  if (findUnescaped(s.text, '{', 0) >= 0) {
    out.push(finding('text/inline-logic', file, l.line, 'no inline logic in a text line: write whole lines (§10)'));
  }
  if (s.diverts.length > 0) {
    out.push(finding('text/divert-on-line', file, l.line, 'put the divert on its own line (§10)'));
  }
  const length = graphemes(unescapeInk(s.text));
  if (length > TEXT_LONG_GRAPHEMES) {
    out.push(finding('text/long', file, l.line, `${length} graphemes (over ${TEXT_LONG_GRAPHEMES})`));
  }
}

/** Rules that look at one line at a time, plus batches (cut D4) and choice blocks, within one file. */
function lintLines(file: string, lines: readonly SourceLine[], ctx: Ctx, out: Finding[]): void {
  let run: Tagged[] = [];
  const flush = (): void => {
    batch(file, run, ctx.assets, out);
    run = [];
  };
  const choices = new Map<number, number>();
  for (const l of lines) {
    const cls = l.cls;
    if (l.code.includes('<>')) {
      out.push(finding('text/glue', file, l.line, 'no glue: a line is one translatable unit (§10)'));
    }
    for (const tag of placedIds(cls)) {
      const id = lineIdOf(tag);
      const chapter = id?.slice(0, id.indexOf('.'));
      if (chapter !== undefined && ctx.owners.size > 0 && !ctx.owners.has(chapter)) {
        const owners = [...ctx.owners].sort().join(', ');
        out.push(finding('id/chapter-prefix', file, l.line, `'${id}' is in a file of ${owners} (§4)`));
      }
    }
    const s = said(cls);
    if (cls.kind === 'blank' || cls.kind === 'comment') {
      continue;
    }
    if (cls.kind === 'tags') {
      tagGroup(file, l.line, cls.tags, ctx.assets, out);
      for (const tag of cls.tags.filter(isId)) {
        out.push(finding('id/on-non-text', file, l.line, `'${tag.text}' on a tag-only line belongs on its text line (§4)`));
      }
      run.push(...cls.tags.map((tag) => ({ line: l.line, tag })));
      continue;
    }
    if (s !== null) {
      saidRules(file, l, s, ctx, out);
      run.push(...s.tags.map((tag) => ({ line: l.line, tag })));
      flush();
    } else {
      flush();
      if (cls.kind === 'choice') {
        choiceRules(file, l, cls, ctx, out);
        batch(file, choiceTags(cls).own.map((tag) => ({ line: l.line, tag })), ctx.assets, out);
      } else {
        const tags = tagsOf(cls);
        tagGroup(file, l.line, tags, ctx.assets, out);
        for (const tag of tags.filter(isId)) {
          out.push(finding('id/on-non-text', file, l.line, `'${tag.text}' on a line with no text (§4)`));
        }
        batch(file, tags.map((tag) => ({ line: l.line, tag })), ctx.assets, out);
      }
    }
    // choice/too-many: non-fallback choices of one depth between delimiters (a gather of that depth or less, or a
    // knot or stitch header); a deeper choice block restarts under each new parent choice.
    if (cls.kind === 'knot' || cls.kind === 'stitch') {
      choices.clear();
    } else if (cls.kind === 'gather') {
      for (const depth of [...choices.keys()]) {
        if (depth >= cls.depth) {
          choices.delete(depth);
        }
      }
    } else if (cls.kind === 'choice') {
      for (const depth of [...choices.keys()]) {
        if (depth > cls.depth) {
          choices.delete(depth);
        }
      }
      if (choiceHasText(cls)) {
        const count = (choices.get(cls.depth) ?? 0) + 1;
        choices.set(cls.depth, count);
        if (count === CHOICES_PER_BLOCK + 1) {
          out.push(finding('choice/too-many', file, l.line, `more than ${CHOICES_PER_BLOCK} choices in one block (portrait UI)`));
        }
      }
    }
  }
  flush();
}

/** `id/duplicate` within one chapter (L3c reports pairs across chapters); the first occurrence keeps the ID. */
function duplicateIds(groups: ReadonlyArray<readonly string[]>, parsed: ReadonlyMap<string, readonly SourceLine[]>, out: Finding[]): void {
  for (const files of groups) {
    const first = new Map<string, string>();
    for (const file of files) {
      for (const l of parsed.get(file) ?? []) {
        for (const tag of placedIds(l.cls)) {
          const id = lineIdOf(tag);
          if (id === null) {
            continue;
          }
          const where = first.get(id);
          if (where === undefined) {
            first.set(id, `${file}:${l.line}`);
          } else {
            out.push(finding('id/duplicate', file, l.line, `'${id}' is already used at ${where} (§4)`));
          }
        }
      }
    }
  }
}

function sortAndDedup(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = JSON.stringify([f.file, f.line, f.code, f.message]);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  }
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => order(a.file, b.file) || a.line - b.line || order(a.code, b.code) || order(a.message, b.message));
}

/**
 * Lints the ink sources: every finding, deduplicated by (file, line, code, message) and sorted by file, line and
 * code. Line rules run on every file; IDs are checked against the chapters whose INCLUDE walk reaches the file.
 */
export function lintSources(input: SourceLintInput): Finding[] {
  const parsed = new Map<string, readonly SourceLine[]>();
  for (const [file, text] of input.files) {
    parsed.set(file, classify(text));
  }
  const walks = input.chapters.map((chapter) => walk(chapter, parsed));
  const owners = new Map<string, Set<string>>();
  for (const w of walks) {
    for (const file of w.files) {
      const set = owners.get(file) ?? new Set<string>();
      set.add(w.chapter.id);
      owners.set(file, set);
    }
  }
  const out: Finding[] = [];
  for (const [file, lines] of parsed) {
    lintLines(file, lines, { assets: input.assets, cast: input.cast, owners: owners.get(file) ?? new Set() }, out);
  }
  const unowned = [...parsed.keys()].filter((file) => !owners.has(file)).map((file) => [file]);
  duplicateIds([...walks.map((w) => w.files), ...unowned], parsed, out);
  return sortAndDedup(out);
}
