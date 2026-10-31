// The story build's outputs (PROTOTYPE-PLAN.md "Build outputs", principle 0): free chapters to the public story-gen
// directory, paid chapters to server/content; the public chapter catalog, each chapter's meta and en table, the usage
// file and the paid line fingerprints; the `paid/leak` check over story-gen. Builds a plan (path → text); IO stays in
// story.ts.
// compile.ts and graph.ts come in as types only, so scan-dist.ts, which imports the decoders below, never loads
// inkjs/full or the graph code.
import { createHash } from 'node:crypto';

import { ASSET_ID_RE, CHAPTER_ID_RE, KNOT_NAME_RE } from '../../src/story/catalog.ts';
import type { Cast, ChapterCatalog, ChapterListEntry, ChapterMeta, Result } from '../../src/story/catalog.ts';
import type { AssetId, ChapterId, KnotName, LineId, SpeakerId, StoryVersion } from '../../src/story/staging.ts';
import { LINE_ID_RE } from '../../src/story/tags.ts';
import type { CompiledChapter } from './compile.ts';
import type { ChapterGraph } from './graph.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding } from './lint.ts';

/** Output roots, repo-relative posix. Paid chapters never go under `client/`. */
export const OUT = {
  storyGen: 'client/src/story-gen',
  free: 'client/src/story-gen/free',
  paid: 'server/content/chapters',
  build: 'server/content/build',
} as const;

/** Chapter titles and speaker names for the public catalog, from story/locales/{ru,en}/story.json (STAGING-DSL §4). */
export type StoryNames = {
  chapters: Record<ChapterId, { ru: string; en: string }>;
  speakers: Record<SpeakerId, { ru: string; en: string }>;
};
/** server/content/build/usage.json: per chapter, the union of its knots' assets and per knot the K9 index. */
export type StoryUsage = {
  chapters: Record<
    ChapterId,
    {
      assets: readonly AssetId[];
      knots: Record<KnotName, { assets: readonly AssetId[]; next: readonly KnotName[]; carried: readonly AssetId[] }>;
    }
  >;
};
/** server/content/build/fingerprints.lines.json: what scan-dist looks for in dist/. */
export type LineFingerprints = { lineIds: readonly LineId[]; texts: readonly string[] };

/** Text samples: every 10th eligible line of at least 24 code points, plus each paid chapter's longest. */
const SAMPLE_MIN_CODE_POINTS = 24;
const SAMPLE_EVERY = 10;

/** sha256 of the story's UTF-8 bytes, hex, first 16 chars (PROTOTYPE-PLAN.md `ChapterMeta.storyVersion`). */
export function storyVersion(storyJson: string): StoryVersion {
  return createHash('sha256').update(storyJson, 'utf8').digest('hex').slice(0, 16) as StoryVersion;
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function codePoints(text: string): number {
  return [...text].length;
}

function chapterPaths(ch: ChapterListEntry): { story: string; meta: string; en: string } {
  return ch.paid
    ? { story: `${OUT.paid}/${ch.id}/story.json`, meta: `${OUT.paid}/${ch.id}/meta.json`, en: `${OUT.paid}/${ch.id}/en.json` }
    : { story: `${OUT.free}/${ch.id}.story.json`, meta: `${OUT.free}/${ch.id}.meta.json`, en: `${OUT.free}/${ch.id}.en.json` };
}

type EmitInput = {
  chapters: readonly ChapterListEntry[];
  compiled: ReadonlyMap<ChapterId, CompiledChapter>;
  graphs: ReadonlyMap<ChapterId, ChapterGraph>;
  cast: Cast;
  names: StoryNames;
  /** Per chapter, the English text of each of its line IDs (STAGING-DSL §4): shipped as `{ id: en }` beside it. */
  en: ReadonlyMap<ChapterId, Readonly<Record<LineId, string>>>;
};
type Built = { ch: ChapterListEntry; compiled: CompiledChapter; graph: ChapterGraph; firstKnot: KnotName };

function meta(b: Built): ChapterMeta {
  const knots = Object.fromEntries([...b.graph.knots].map(([k, n]) => [k, { assets: n.assets, next: n.next, ending: n.ending }]));
  return {
    chapterId: b.ch.id,
    storyVersion: storyVersion(b.compiled.json),
    firstKnot: b.firstKnot,
    globals: b.graph.globals,
    vars: b.graph.vars,
    knots: knots as ChapterMeta['knots'], // keys are the graph's knot names
  };
}

function catalog(built: readonly Built[], input: EmitInput): ChapterCatalog {
  const title = (id: ChapterId): { ru: string; en: string } => {
    const t = input.names.chapters[id];
    if (t === undefined) {
      throw new Error(`invariant: chapter ${id} has a title`);
    }
    return t;
  };
  const cast = Object.fromEntries(
    Object.entries(input.cast).map(([speaker, entry]) => {
      const name = input.names.speakers[speaker as SpeakerId]; // a key of the decoded cast
      if (name === undefined) {
        throw new Error(`invariant: speaker ${speaker} has a name`);
      }
      return [speaker, { char: entry.char, name }];
    }),
  );
  return {
    chapters: built.map(({ ch }) => ({ id: ch.id, paid: ch.paid, productId: ch.productId, next: ch.next, title: title(ch.id) })),
    cast: cast as ChapterCatalog['cast'], // keys are the decoded cast's speakers
  };
}

function usage(built: readonly Built[]): StoryUsage {
  const chapters = Object.fromEntries(
    built.map(({ ch, graph }) => {
      const knots = Object.fromEntries(
        [...graph.knots].map(([k, n]) => [k, { assets: n.assets, next: n.next, carried: graph.carried.get(k) ?? [] }]),
      );
      const assets = [...new Set([...graph.knots.values()].flatMap((n) => n.assets))].sort();
      return [ch.id, { assets, knots }];
    }),
  );
  return { chapters: chapters as StoryUsage['chapters'] }; // keys are chapter ids and knot names
}

/**
 * Every ID of every paid line and choice; per paid chapter, text samples that occur verbatim in its story.json
 * (inkjs escapes `"` and `\` in JSON, so such a line could never match a leaked copy) and in no free chapter's
 * story.json (a needle shared with public text would fail every build). The free set comes from the chapter list,
 * never from whatever sits in story-gen, so a mis-routed paid chapter cannot launder its own samples.
 */
function fingerprints(built: readonly Built[]): LineFingerprints {
  const free = built.filter((b) => !b.ch.paid).map((b) => b.compiled.json);
  const lineIds = new Set<LineId>();
  const texts: string[] = [];
  for (const b of built.filter((x) => x.ch.paid)) {
    for (const l of b.graph.lines) {
      lineIds.add(l.id);
    }
    const eligible = b.graph.lines
      .map((l) => l.text)
      .filter((t) => t !== '' && b.compiled.json.includes(t) && !free.some((f) => f.includes(t)));
    const sampled = eligible.filter((t) => codePoints(t) >= SAMPLE_MIN_CODE_POINTS).filter((_, i) => i % SAMPLE_EVERY === 0);
    const longest = eligible.reduce((best, t) => (codePoints(t) > codePoints(best) ? t : best), '');
    for (const t of [...sampled, longest]) {
      if (t !== '' && !texts.includes(t)) {
        texts.push(t);
      }
    }
  }
  return { lineIds: [...lineIds].sort(), texts };
}

/**
 * The output plan: repo-relative posix path → exact file text, for every chapter of the list (each compiled, with a
 * graph whose first knot is known and an en table: the CLI emits only when no error remains). Deterministic: the same
 * inputs give the same bytes.
 */
export function planEmit(input: EmitInput): ReadonlyMap<string, string> {
  const built: Built[] = input.chapters.map((ch) => {
    const compiled = input.compiled.get(ch.id);
    const graph = input.graphs.get(ch.id);
    const firstKnot = graph?.firstKnot ?? null;
    if (compiled === undefined || graph === undefined || firstKnot === null) {
      throw new Error(`invariant: chapter ${ch.id} is compiled and has a first knot before emit`);
    }
    return { ch, compiled, graph, firstKnot };
  });
  const out = new Map<string, string>();
  const put = (path: string, text: string): void => {
    if (out.has(path)) {
      throw new Error(`invariant: one producer per output, ${path} planned twice`);
    }
    out.set(path, text);
  };
  for (const b of built) {
    const paths = chapterPaths(b.ch);
    if (b.ch.paid && [paths.story, paths.meta, paths.en].some((p) => p.startsWith('client/'))) {
      throw new Error(`invariant: paid chapter ${b.ch.id} is never routed under client/ (principle 0)`);
    }
    const en = input.en.get(b.ch.id);
    if (en === undefined) {
      throw new Error(`invariant: chapter ${b.ch.id} has its en table before emit`);
    }
    put(paths.story, b.compiled.json);
    put(paths.meta, pretty(meta(b)));
    put(paths.en, pretty(en));
  }
  put(`${OUT.storyGen}/catalog.json`, pretty(catalog(built, input)));
  put(`${OUT.build}/usage.json`, pretty(usage(built)));
  put(`${OUT.build}/fingerprints.lines.json`, pretty(fingerprints(built)));
  return out;
}

/** `paid/leak` (STAGING-DSL §11): every paid line ID or text sample found in a story-gen file (path → text). */
export function paidLeak(storyGen: ReadonlyMap<string, string>, fp: LineFingerprints): Finding[] {
  const out: Finding[] = [];
  const leak = (file: string, what: string): void => {
    out.push({ code: 'paid/leak', severity: LINT_CODES['paid/leak'], file, line: 0, message: `${what} in the public build input (principle 0)` });
  };
  for (const [file, text] of storyGen) {
    for (const id of fp.lineIds.filter((i) => text.includes(i))) {
      leak(file, `paid line ID '${id}'`);
    }
    for (const t of fp.texts.filter((s) => text.includes(s))) {
      leak(file, `paid text ${JSON.stringify(t)}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Decoders of the two build files other tools read (scan-dist; L5's asset tool and budget)

// scan-dist reads story/chapters.json with the story tool's own decoder, through this module: the main module's
// relative imports must stay under scripts/, which is all a junction to scripts/ reaches when Node keeps the link's
// spelling (`--preserve-symlinks-main`, scan-dist.test.ts).
export { decodeChapterList } from '../../src/story/catalog.ts';

type Raw = Readonly<Record<string, unknown>>;

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function keysExactly(v: Raw, keys: readonly string[], path: string, issues: string[]): void {
  for (const k of Object.keys(v).filter((x) => !keys.includes(x))) {
    issues.push(`${path}${k}: unknown key (expected ${keys.join(', ')})`);
  }
  for (const k of keys.filter((x) => !Object.hasOwn(v, x))) {
    issues.push(`${path}${k}: missing`);
  }
}

function list(v: unknown, path: string, issues: string[], ok: (s: string) => boolean, what: string): string[] {
  if (!Array.isArray(v)) {
    issues.push(`${path}: not an array`);
    return [];
  }
  return v.flatMap((x: unknown, i) => {
    if (typeof x !== 'string' || !ok(x)) {
      issues.push(`${path}.${i}: ${JSON.stringify(x) ?? 'undefined'} is not ${what}`);
      return [];
    }
    return [x];
  });
}

const assetList = (v: unknown, path: string, issues: string[]): AssetId[] =>
  list(v, path, issues, (s) => ASSET_ID_RE.test(s), 'an asset id') as AssetId[]; // the brand is earned by the pattern
const knotList = (v: unknown, path: string, issues: string[]): KnotName[] =>
  list(v, path, issues, (s) => KNOT_NAME_RE.test(s), 'a knot name') as KnotName[]; // the brand is earned by the pattern

/** Decodes usage.json; every problem is reported. */
export function decodeStoryUsage(raw: unknown): Result<StoryUsage, string[]> {
  const issues: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, error: ['not a JSON object'] };
  }
  keysExactly(raw, ['chapters'], '', issues);
  const chapters: Record<string, StoryUsage['chapters'][ChapterId]> = {};
  const raws = raw['chapters'];
  if (!isObject(raws)) {
    issues.push('chapters: not an object');
  } else {
    for (const [id, entry] of Object.entries(raws)) {
      const path = `chapters.${id}`;
      if (!CHAPTER_ID_RE.test(id)) {
        issues.push(`${path}: not a chapter id`);
        continue;
      }
      if (!isObject(entry)) {
        issues.push(`${path}: not an object`);
        continue;
      }
      keysExactly(entry, ['assets', 'knots'], `${path}.`, issues);
      const knots: Record<string, { assets: AssetId[]; next: KnotName[]; carried: AssetId[] }> = {};
      const rawKnots = entry['knots'];
      if (!isObject(rawKnots)) {
        issues.push(`${path}.knots: not an object`);
      } else {
        for (const [k, knot] of Object.entries(rawKnots)) {
          const kp = `${path}.knots.${k}`;
          if (!KNOT_NAME_RE.test(k) || !isObject(knot)) {
            issues.push(`${kp}: not a knot name with an object`);
            continue;
          }
          keysExactly(knot, ['assets', 'next', 'carried'], `${kp}.`, issues);
          knots[k] = {
            assets: assetList(knot['assets'], `${kp}.assets`, issues),
            next: knotList(knot['next'], `${kp}.next`, issues),
            carried: assetList(knot['carried'], `${kp}.carried`, issues),
          };
        }
      }
      chapters[id] = { assets: assetList(entry['assets'], `${path}.assets`, issues), knots: knots as StoryUsage['chapters'][ChapterId]['knots'] };
    }
  }
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  return { ok: true, value: { chapters: chapters as StoryUsage['chapters'] } }; // keys passed the patterns above
}

/** Decodes fingerprints.lines.json. An empty text is refused: as a needle it would match every file. */
export function decodeLineFingerprints(raw: unknown): Result<LineFingerprints, string[]> {
  const issues: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, error: ['not a JSON object'] };
  }
  keysExactly(raw, ['lineIds', 'texts'], '', issues);
  const lineIds = list(raw['lineIds'], 'lineIds', issues, (s) => LINE_ID_RE.test(s), 'a line ID') as LineId[]; // by LINE_ID_RE
  const texts = list(raw['texts'], 'texts', issues, (s) => s !== '', 'a non-empty text');
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  return { ok: true, value: { lineIds, texts } };
}
