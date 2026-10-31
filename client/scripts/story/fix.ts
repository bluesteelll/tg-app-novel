// Source fixers of the story tool (STAGING-DSL §4): `--fix-ids` writes a fresh line ID into each line the source lint
// reports as `id/missing`, and into each world text that lacks one (`fixWorldIds`); `--sync-locales` adds the missing
// entries of an en table. Pure, no node:*: story.ts reads the files, injects the random suffixes and writes what
// changed. Every ID patch is checked by the one line classifier; a line it cannot place is skipped, never guessed.
import type { ChapterId, LineId } from '../../src/story/staging.ts';
import { LINE_ID_RE } from '../../src/story/tags.ts';
import { classify, findUnescaped } from './classify.ts';
import type { LineClass, SourceLine } from './classify.ts';
import type { StoryLine } from './graph.ts';
import { tagsOf } from './lint.ts';

/** An `id/missing` finding of `lintSources`: a story-relative file and its 1-based line. */
export type IdTarget = { file: string; line: number };
export type FixIdsInput = {
  /** Story-relative posix path → the file's RAW text (BOM and line endings as on disk). */
  files: ReadonlyMap<string, string>;
  /** Exactly the `id/missing` findings of `lintSources`, so "needs an ID" has one definition. */
  targets: readonly IdTarget[];
  /** The listed chapters: a file under `<ch>/` belongs to `<ch>` (its entry is `<ch>/main.ink`). */
  chapters: readonly ChapterId[];
  /** Every ID-shaped string of the ink sources, retired-ids.txt and the en tables: a new ID is none of them. */
  taken: ReadonlySet<string>;
  /** Four characters of [0-9a-z]; the CLI draws them at random, tests inject a sequence. */
  suffix: () => string;
};
export type FixIdsResult = {
  /** The changed files only, each with its full new raw text. */
  files: ReadonlyMap<string, string>;
  added: ReadonlyArray<IdTarget & { id: LineId }>;
  skipped: ReadonlyArray<IdTarget & { reason: string }>;
};

/** Anything shaped like a line ID, anywhere in a text (a superset scan: `taken` may hold more than real IDs). */
export const ID_SHAPED_RE = /ch[1-9][0-9]*\.[a-z][a-z0-9_]*\.[0-9a-z]{4}/g;

const BOM = String.fromCharCode(0xfeff);
const KNOT_PART_RE = /^[a-z][a-z0-9_]*$/;
const SUFFIX_RE = /^[0-9a-z]{4}$/;
/** 36^4 suffixes per prefix: 100 taken in a row means the suffix source is broken. */
const SUFFIX_TRIES = 100;

/** What the player sees of a line and where it leads; a patch must leave it unchanged. Null: no text to carry an ID. */
function shownOf(cls: LineClass): string | null {
  switch (cls.kind) {
    case 'text':
    case 'gather':
    case 'block-open':
    case 'block-branch':
    case 'block-close':
      return cls.text !== '' || cls.speaker !== null ? JSON.stringify([cls.kind, cls.speaker, cls.text, cls.diverts.map((d) => d.target)]) : null;
    case 'choice': {
      const text = (cls.bracket?.text ?? '') !== '' || cls.outside !== '';
      return text ? JSON.stringify([cls.kind, cls.bracket?.text ?? null, cls.outside, cls.diverts.map((d) => d.target)]) : null;
    }
    default:
      return null;
  }
}

/** The patched line carries `id` where the DSL reads it (inside the brackets of a choice) and shows the same text. */
function placed(before: SourceLine, after: SourceLine | undefined, id: string): boolean {
  if (after === undefined || shownOf(after.cls) !== shownOf(before.cls)) {
    return false;
  }
  const tags = after.cls.kind === 'choice' ? (after.cls.bracket?.tags ?? []) : tagsOf(after.cls);
  return tags.some((t) => t.text === `id:${id}`);
}

/** Candidate raw lines with ` #id:<id>` written in: after the text, or before a closing `]` of a choice. */
function candidates(l: SourceLine, id: string): string[] {
  const tag = ` #id:${id}`;
  const at = (i: number): string => `${l.raw.slice(0, i)}${tag}${l.raw.slice(i)}`;
  if (l.cls.kind !== 'choice') {
    return [at(l.code.trimEnd().length)];
  }
  // Every unescaped `]` in turn, inner trailing blanks kept after the ID; the classifier picks the bracket.
  const out: string[] = [];
  for (let close = findUnescaped(l.code, ']', 0); close >= 0; close = findUnescaped(l.code, ']', close + 1)) {
    out.push(at(l.code.slice(0, close).trimEnd().length));
  }
  return out;
}

function freshId(prefix: string, used: ReadonlySet<string>, suffix: () => string): LineId {
  for (let i = 0; i < SUFFIX_TRIES; i += 1) {
    const s = suffix();
    if (!SUFFIX_RE.test(s)) {
      throw new Error(`invariant: a suffix is four characters of [0-9a-z], got '${s}'`);
    }
    const id = `${prefix}.${s}`;
    if (!LINE_ID_RE.test(id)) {
      throw new Error(`invariant: a listed chapter and a checked knot name make a line ID, got '${id}'`);
    }
    if (!used.has(id)) {
      return id as LineId; // the brand is earned by LINE_ID_RE
    }
  }
  throw new Error(`invariant: ${SUFFIX_TRIES} suffixes in a row were taken for '${prefix}'`);
}

/** The ID prefix of `l` (an `id/missing` line of a file owned by `owner`), or why no ID is written into it. */
function prefixOf(l: SourceLine, owner: string | null): { ok: true; prefix: string } | { ok: false; reason: string } {
  const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  if (owner === null) {
    return no("the file is under no listed chapter's directory, so the ID would have no chapter (§4)");
  }
  if (l.knot === null) {
    return no('the line is outside any knot, so the ID would have no knot part (§4)');
  }
  if (!KNOT_PART_RE.test(l.knot)) {
    return no(`knot '${l.knot}' is not [a-z][a-z0-9_]* (ink/name)`);
  }
  if (!l.raw.startsWith(l.code)) {
    return no('an inline /* */ comment shifts the line: write the ID by hand');
  }
  if (l.cls.kind === 'choice' && l.cls.bracket === null) {
    return no('a choice without brackets has no place for its ID: put its text inside [ ] (choice/text-after)');
  }
  if (shownOf(l.cls) === null) {
    return no('the line shows no text');
  }
  return { ok: true, prefix: `${owner}.${l.knot}` };
}

/** Writes a fresh ID into every target it can place; existing IDs, separators, a BOM and comments stay as they are. */
export function fixIds(input: FixIdsInput): FixIdsResult {
  const chapters = new Set<string>(input.chapters);
  const used = new Set<string>(input.taken);
  const byFile = new Map<string, Set<number>>();
  for (const t of input.targets) {
    byFile.set(t.file, (byFile.get(t.file) ?? new Set()).add(t.line));
  }
  const files = new Map<string, string>();
  const added: Array<IdTarget & { id: LineId }> = [];
  const skipped: Array<IdTarget & { reason: string }> = [];
  for (const [file, targets] of byFile) {
    const raw = input.files.get(file);
    const lines = [...targets].sort((a, b) => a - b);
    if (raw === undefined) {
      skipped.push(...lines.map((line) => ({ file, line, reason: 'no such ink file' })));
      continue;
    }
    const bom = raw.startsWith(BOM) ? BOM : '';
    // Even indices are lines, odd ones the separators that followed them: each line keeps its own.
    const parts = raw.slice(bom.length).split(/(\r?\n)/);
    const slash = file.indexOf('/');
    const owner = slash > 0 && chapters.has(file.slice(0, slash)) ? file.slice(0, slash) : null;
    let classified = classify(raw);
    let changed = false;
    for (const line of lines) {
      const l = classified[line - 1];
      if (l === undefined || parts[2 * (line - 1)] !== l.raw) {
        skipped.push({ file, line, reason: 'no such line' });
        continue;
      }
      const prefix = prefixOf(l, owner);
      if (!prefix.ok) {
        skipped.push({ file, line, reason: prefix.reason });
        continue;
      }
      const id = freshId(prefix.prefix, used, input.suffix);
      let accepted = false;
      for (const candidate of candidates(l, id)) {
        parts[2 * (line - 1)] = candidate;
        const next = classify(bom + parts.join(''));
        if (placed(l, next[line - 1], id)) {
          classified = next;
          accepted = true;
          break;
        }
      }
      if (!accepted) {
        parts[2 * (line - 1)] = l.raw;
        skipped.push({ file, line, reason: 'the classifier does not read the patched line as the same line with this ID' });
        continue;
      }
      used.add(id);
      added.push({ file, line, id });
      changed = true;
    }
    if (changed) {
      files.set(file, bom + parts.join(''));
    }
  }
  return { files, added, skipped };
}

export type FixWorldIdsInput = {
  /** story/<ch>/world.json's RAW text (a BOM kept). */
  text: string;
  chapter: ChapterId;
  /** Every ID-shaped string of the ink sources, the worlds, retired-ids.txt and the en tables. */
  taken: ReadonlySet<string>;
  /** Four characters of [0-9a-z]; the CLI draws them at random, tests inject a sequence. */
  suffix: () => string;
};
export type FixWorldIdsResult =
  | {
      /** The new raw text; the input text itself when nothing was added. */
      text: string;
      added: ReadonlyArray<{ path: string; id: LineId }>;
      /** World texts that got no ID, each with why (the world lint still reports them). */
      skipped: ReadonlyArray<{ path: string; reason: string }>;
    }
  | { error: string };

/** The world maps whose entry ids own the texts under them: the knot part of their IDs (PUZZLES-PLAN "Texts"). */
const WORLD_OWNERS = ['items', 'docs', 'puzzles', 'sections'];

/** A world text without its ID: a plain object whose keys are exactly `ru` (a string), PUZZLES-PLAN "Texts". */
function lacksId(v: unknown): v is { ru: string } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return false;
  }
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0] === 'ru' && typeof (v as { ru: unknown }).ru === 'string';
}

/**
 * `--fix-ids` for a world (D13): an `id` written first into each world text that has none, with the owning item, doc,
 * puzzle or section id as its knot part. Works on the raw JSON, since a world that lacks IDs does not decode. The
 * output is two-space JSON plus a newline, the BOM kept and the key order otherwise unchanged (world keys are never
 * integer-like); a file with nothing to add comes back as it was.
 */
export function fixWorldIds(input: FixWorldIdsInput): FixWorldIdsResult {
  const bom = input.text.startsWith(BOM) ? BOM : '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text.slice(bom.length));
  } catch (e) {
    return { error: `not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'not a JSON object' };
  }
  const used = new Set<string>([...input.taken, ...(input.text.match(ID_SHAPED_RE) ?? [])]);
  const added: Array<{ path: string; id: LineId }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const walk = (v: unknown, path: string, owner: string | null): unknown => {
    if (lacksId(v)) {
      if (owner === null || !KNOT_PART_RE.test(owner)) {
        const why = owner === null ? 'the text is under no item, doc, puzzle or section' : `owner '${owner}' is not [a-z][a-z0-9_]*`;
        skipped.push({ path, reason: `${why}, so the ID would have no knot part (§4)` });
        return v;
      }
      const id = freshId(`${input.chapter}.${owner}`, used, input.suffix);
      used.add(id);
      added.push({ path, id });
      return { id, ...v };
    }
    if (Array.isArray(v)) {
      return v.map((e: unknown, i) => walk(e, `${path}.${i}`, owner));
    }
    if (typeof v !== 'object' || v === null) {
      return v;
    }
    const top = path === '';
    return Object.fromEntries(
      Object.entries(v).map(([k, e]) => {
        const at = top ? k : `${path}.${k}`;
        // `<map>.<id>`: the entry's id owns everything below it.
        const parent = top ? null : path;
        const own = parent !== null && WORLD_OWNERS.includes(parent) ? k : owner;
        return [k, walk(e, at, own)];
      }),
    );
  };
  const out = walk(parsed, '', null);
  return { text: added.length === 0 ? input.text : `${bom}${JSON.stringify(out, null, 2)}\n`, added, skipped };
}

/**
 * `--sync-locales` (STAGING-DSL §4): the en table with `{ "ru": <text>, "en": "" }` appended for each ID of `lines`
 * (source order) that has no entry. Existing entries keep their order and values: `ru` is never rewritten and an
 * orphan is never removed (it is the reminder to retire its ID). A table that is not a JSON object is an error and is
 * left as it is. Line IDs are non-integer keys, so `JSON.stringify` keeps the insertion order.
 */
export function syncLocales(table: { text: string | null }, lines: readonly StoryLine[]): { text: string; added: LineId[] } | { error: string } {
  let entries: Record<string, unknown> = {};
  if (table.text !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(table.text.startsWith(BOM) ? table.text.slice(1) : table.text);
    } catch (e) {
      return { error: `not JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'not a JSON object of line IDs' };
    }
    entries = { ...parsed };
  }
  const added: LineId[] = [];
  for (const l of lines) {
    if (!Object.hasOwn(entries, l.id)) {
      entries[l.id] = { ru: l.text, en: '' };
      added.push(l.id);
    }
  }
  // Nothing to add: the table's bytes stay as they are, so the CLI writes nothing.
  const text = added.length === 0 && table.text !== null ? table.text : `${JSON.stringify(entries, null, 2)}\n`;
  return { text, added };
}
