// The localization checks of the story gate (STAGING-DSL §4, §11): the en tables (`loc/missing-en`, `loc/empty-en`,
// `loc/stale-en`, `loc/orphan-en`), the names, titles and teasers of story.json (`loc/missing-name`), and the two ID
// rules no single chapter can see: `id/duplicate` across chapters and `id/retired`. Pure, no node:*: story.ts reads the
// files.
// Findings name story-relative files (`locales/en/ch1.json`, `retired-ids.txt`) and the 1-based line of a key, or 0
// for the whole file; ink lines come from the chapter graphs, so the static extractor is graph.ts's alone.
import type { Cast, ChapterListEntry, StoryId } from '../../src/story/catalog.ts';
import type { ChapterId, SpeakerId } from '../../src/story/staging.ts';
import { LINE_ID_RE } from '../../src/story/tags.ts';
import type { StoryNames } from './emit.ts';
import type { ChapterGraph, StoryLine } from './graph.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding, LintCode } from './lint.ts';

export type EnEntry = { ru: string; en: string };
/** story/locales/en/<ch>.json decoded: the well-formed entries, and where each key is written. */
export type EnTable = { file: string; entries: ReadonlyMap<string, EnEntry>; keyLine: (key: string) => number };
export type NameSection = 'names' | 'chapters' | 'stories' | 'teasers';
/** story/locales/<lang>/story.json decoded: the string values of each section, and where each key is. */
export type NameTable = {
  file: string;
  names: ReadonlyMap<string, string>;
  chapters: ReadonlyMap<string, string>;
  /** Story titles (STAGING-DSL §4, §9). */
  stories: ReadonlyMap<string, string>;
  /** Story teasers: one sentence for the story's card. */
  teasers: ReadonlyMap<string, string>;
  keyLine: (section: NameSection, key: string) => number;
};
export type LocaleInput = {
  /** Null when story/chapters.json did not decode: then no table can be judged a stray. */
  chapters: readonly ChapterListEntry[] | null;
  /** The compiled chapters only: a chapter that failed to compile is judged once it compiles. */
  graphs: ReadonlyMap<ChapterId, ChapterGraph>;
  /** Every story/locales/en/<name>.json except story.json, keyed by <name>. */
  en: ReadonlyMap<string, EnTable>;
  names: { ru: NameTable; en: NameTable };
  cast: Cast;
  retired: ReadonlySet<string>;
  /** The decoded stories: each needs a title and a teaser in both languages ([] when stories.json did not decode). */
  stories: readonly StoryId[];
};

export const RETIRED_FILE = 'retired-ids.txt';
const BOM = String.fromCharCode(0xfeff);
const NAME_SECTIONS: readonly NameSection[] = ['names', 'chapters', 'stories', 'teasers'];
/** What a missing entry of each section is called in a finding. */
const NAME_WHAT: Readonly<Record<NameSection, string>> = { names: 'name', chapters: 'title', stories: 'title', teasers: 'teaser' };

type Raw = Readonly<Record<string, unknown>>;

function finding(code: LintCode, file: string, line: number, message: string): Finding {
  return { code, severity: LINT_CODES[code], file, line, message };
}

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The text parsed as JSON, or why not. */
function parse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text.startsWith(BOM) ? text.slice(1) : text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The 1-based line of the first `"<key>":` at or after `from` in `text`, or 0 when it is not written plainly. */
function keyLineIn(text: string, key: string, from = 0): number {
  const re = new RegExp(`${JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'g');
  re.lastIndex = from;
  const m = re.exec(text);
  return m === null ? 0 : text.slice(0, m.index).split('\n').length;
}

/** The character index of line `line` (1-based) in `text`; 0 for line 0. */
function lineStart(text: string, line: number): number {
  let at = 0;
  for (let l = 1; l < line; l += 1) {
    at = text.indexOf('\n', at) + 1;
  }
  return at;
}

/** Decodes an en table. A missing file (`text` null) is empty with no finding: each line it lacks is reported. */
export function decodeEnTable(file: string, text: string | null): { table: EnTable; findings: Finding[] } {
  const entries = new Map<string, EnEntry>();
  const keyLine = (key: string): number => (text === null ? 0 : keyLineIn(text, key));
  const table: EnTable = { file, entries, keyLine };
  if (text === null) {
    return { table, findings: [] };
  }
  const parsed = parse(text);
  if (!parsed.ok || !isObject(parsed.value)) {
    const why = parsed.ok ? 'not a JSON object of line IDs' : `not JSON: ${parsed.error}`;
    return { table, findings: [finding('loc/missing-en', file, 0, `${why}; nothing in it is read`)] };
  }
  const findings: Finding[] = [];
  for (const [key, value] of Object.entries(parsed.value)) {
    if (!LINE_ID_RE.test(key)) {
      findings.push(finding('loc/orphan-en', file, keyLine(key), `'${key}' is not a line ID, so it names no ink line (§4)`));
    } else if (!isObject(value) || Object.keys(value).length !== 2 || typeof value['ru'] !== 'string' || typeof value['en'] !== 'string') {
      findings.push(finding('loc/missing-en', file, keyLine(key), `'${key}': the entry is not { "ru": string, "en": string } (§4)`));
    } else {
      entries.set(key, { ru: value['ru'], en: value['en'] });
    }
  }
  return { table, findings };
}

/** Decodes a story.json of names and titles. A missing file is empty with no finding: each name it lacks is. */
export function decodeNameTable(file: string, text: string | null): { table: NameTable; findings: Finding[] } {
  const sections = { names: new Map<string, string>(), chapters: new Map<string, string>(), stories: new Map<string, string>(), teasers: new Map<string, string>() };
  const keyLine = (section: NameSection, key: string): number => {
    if (text === null) {
      return 0;
    }
    const at = keyLineIn(text, section);
    return at === 0 ? 0 : keyLineIn(text, key, lineStart(text, at));
  };
  const table: NameTable = { file, ...sections, keyLine };
  if (text === null) {
    return { table, findings: [] };
  }
  const parsed = parse(text);
  if (!parsed.ok || !isObject(parsed.value)) {
    const why = parsed.ok ? `not a JSON object of the sections ${NAME_SECTIONS.join(', ')}` : `not JSON: ${parsed.error}`;
    return { table, findings: [finding('loc/missing-name', file, 0, `${why}; nothing in it is read`)] };
  }
  const findings: Finding[] = [];
  for (const [key, value] of Object.entries(parsed.value)) {
    const section = NAME_SECTIONS.find((s) => s === key);
    if (section === undefined) {
      findings.push(finding('loc/missing-name', file, keyLineIn(text, key), `'${key}': unknown key (expected ${NAME_SECTIONS.join(', ')}) (§4)`));
    } else if (!isObject(value)) {
      findings.push(finding('loc/missing-name', file, keyLineIn(text, key), `'${key}' is not an object of names (§4)`));
    } else {
      for (const [id, name] of Object.entries(value)) {
        if (typeof name === 'string') {
          sections[section].set(id, name);
        }
      }
    }
  }
  return { table, findings };
}

/** Decodes story/retired-ids.txt: one ID per line, trimmed, blank lines ignored. A missing file retires nothing. */
export function decodeRetired(text: string | null): { ids: ReadonlySet<string>; findings: Finding[] } {
  const ids = new Set<string>();
  const findings: Finding[] = [];
  for (const [i, raw] of (text ?? '').split(/\r?\n/).entries()) {
    const line = (i === 0 && raw.startsWith(BOM) ? raw.slice(1) : raw).trim();
    if (line === '') {
      continue;
    }
    if (LINE_ID_RE.test(line)) {
      ids.add(line);
    } else {
      findings.push(finding('id/format', RETIRED_FILE, i + 1, `'${line}' is not a line ID: the file lists retired IDs, one per line (§4)`));
    }
  }
  return { ids, findings };
}

/** The en table checks of one compiled chapter (`file` is the table's story-relative path). */
function enChecks(ch: ChapterId, lines: readonly StoryLine[], table: EnTable, out: Finding[]): void {
  const first = new Map<string, StoryLine>();
  for (const l of lines) {
    if (!first.has(l.id)) {
      first.set(l.id, l);
    }
  }
  for (const [id, l] of first) {
    const entry = table.entries.get(id);
    if (entry === undefined) {
      out.push(finding('loc/missing-en', l.file, l.line, `'${id}' has no entry in story/${table.file} (run --sync-locales)`));
      continue;
    }
    if (entry.en.trim() === '') {
      out.push(finding('loc/empty-en', table.file, table.keyLine(id), `'${id}': en is empty (§4)`));
    }
    if (entry.ru !== l.text) {
      const what = `the entry's ru ${JSON.stringify(entry.ru)} is not the source ${JSON.stringify(l.text)}`;
      out.push(finding('loc/stale-en', table.file, table.keyLine(id), `'${id}': ${what} (update en, then copy the new ru)`));
    }
  }
  for (const id of table.entries.keys()) {
    if (!first.has(id)) {
      out.push(finding('loc/orphan-en', table.file, table.keyLine(id), `'${id}' names no line of ${ch}: retire it (§4)`));
    }
  }
}

/** `loc/missing-name` over both languages; the names and titles when none is missing. */
function nameChecks(input: LocaleInput, out: Finding[]): StoryNames | null {
  const speakers = Object.keys(input.cast) as SpeakerId[]; // the decoded cast's keys
  const chapters = (input.chapters ?? []).map((c) => c.id);
  const before = out.length;
  const get = (t: NameTable, section: NameSection, id: string, what: string): string => {
    const value = t[section].get(id);
    if (value === undefined || value.trim() === '') {
      out.push(finding('loc/missing-name', t.file, t.keyLine(section, id), `${what} '${id}' has no ${NAME_WHAT[section]} in story/${t.file} (§4)`));
      return '';
    }
    return value;
  };
  const pair = (section: NameSection, id: string, what: string): { ru: string; en: string } => ({
    ru: get(input.names.ru, section, id, what),
    en: get(input.names.en, section, id, what),
  });
  const named = {
    chapters: Object.fromEntries(chapters.map((id) => [id, pair('chapters', id, 'chapter')])),
    speakers: Object.fromEntries(speakers.map((id) => [id, pair('names', id, 'speaker')])),
  };
  for (const id of input.stories) {
    pair('stories', id, 'story');
    pair('teasers', id, 'story');
  }
  return out.length > before ? null : (named as StoryNames); // keys are the listed chapters and the cast's speakers
}

/**
 * Every localization finding of the compiled chapters, in chapter order, and the catalog's names and titles (null
 * iff a `loc/missing-name` is reported). The tables' own decode findings are the decoders'.
 */
export function checkLocales(input: LocaleInput): { findings: Finding[]; names: StoryNames | null } {
  const out: Finding[] = [];
  const order = input.chapters === null ? [...input.graphs.keys()] : input.chapters.map((c) => c.id);
  const played = order.flatMap((ch) => {
    const g = input.graphs.get(ch);
    return g === undefined ? [] : [{ ch, lines: g.lines }];
  });
  for (const { ch, lines } of played) {
    const table = input.en.get(ch) ?? decodeEnTable(`locales/en/${ch}.json`, null).table;
    enChecks(ch, lines, table, out);
  }
  if (input.chapters !== null) {
    const listed = new Set<string>(input.chapters.map((c) => c.id));
    for (const [name, table] of input.en) {
      if (!listed.has(name)) {
        out.push(finding('loc/orphan-en', table.file, 0, `'${name}' is not a listed chapter: no line can use this table (§4)`));
      }
    }
  }
  // One occurrence per source line: a file two chapters reach is `ink/include`'s, not a duplicate.
  const seen = new Set<string>();
  const firstUse = new Map<string, { at: string; ch: ChapterId }>();
  for (const { ch, lines } of played) {
    for (const l of lines) {
      const at = `${l.file}:${l.line}`;
      if (seen.has(at)) {
        continue;
      }
      seen.add(at);
      if (input.retired.has(l.id)) {
        out.push(finding('id/retired', l.file, l.line, `'${l.id}' is in story/${RETIRED_FILE}: a retired ID is never reused (§4)`));
      }
      const used = firstUse.get(l.id);
      if (used === undefined) {
        firstUse.set(l.id, { at, ch });
      } else if (used.ch !== ch) {
        out.push(finding('id/duplicate', l.file, l.line, `'${l.id}' is already used at ${used.at} (chapter ${used.ch}) (§4)`));
      }
    }
  }
  const names = nameChecks(input, out);
  return { findings: out, names };
}
