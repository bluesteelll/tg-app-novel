// The story build's outputs (PROTOTYPE-PLAN.md "Build outputs", STORIES-PLAN Y5, principle 0): free chapters to the
// public story-gen directory, paid chapters to server/content; the public chapter catalog with its story list (no
// ending), each chapter's meta (its story endings) and en table, the server story index, the usage file and the paid
// line fingerprints; the `paid/leak` check over story-gen. From LW3 a chapter's world (PUZZLES-PLAN "Build outputs"):
// its public projection stamped with `worldVersion`, routed like the chapter, and the server puzzle content of every
// chapter; the hint texts never leave server/content. Builds a plan (path → text); IO stays in story.ts.
// compile.ts and graph.ts come in as types only, so scan-dist.ts, which imports the decoders below, never loads
// inkjs/full or the graph code; stories.ts adds no module lint.ts does not already load.
import { createHash } from 'node:crypto';

import { RULES_VERSION, lockOf } from '../../src/explore/reduce.ts';
import { ASSET_ID_RE, CHAPTER_ID_RE, KNOT_NAME_RE } from '../../src/story/catalog.ts';
import type { Cast, ChapterCatalog, ChapterListEntry, ChapterMeta, EndingName, Result, StoryId } from '../../src/story/catalog.ts';
import type { AssetId, ChapterId, KnotName, LineId, ProductId, SpeakerId, StoryVersion } from '../../src/story/staging.ts';
import { LINE_ID_RE } from '../../src/story/tags.ts';
import { toPublic, toServer } from '../../src/world/decode.ts';
import type { ServerPuzzleContent, WorldPublic, WorldPublicBody, WorldSource } from '../../src/world/types.ts';
import type { CompiledChapter } from './compile.ts';
import type { ChapterGraph } from './graph.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding } from './lint.ts';
import { endingKnots } from './stories.ts';
import type { StoryPlan } from './stories.ts';

/** Output roots, repo-relative posix. Paid chapters and the story index never go under `client/`. */
export const OUT = {
  storyGen: 'client/src/story-gen',
  free: 'client/src/story-gen/free',
  paid: 'server/content/chapters',
  build: 'server/content/build',
  /** The server story index (STORIES-PLAN "Server formats"): it names every ending, paid ones included. */
  stories: 'server/content/stories.json',
  /** `<ch>.json` per listed chapter (PUZZLES-PLAN "Server formats"): solutions and hint texts, server-only (X7). */
  puzzles: 'server/content/puzzles',
} as const;

/**
 * Chapter titles, speaker names, story titles and teasers for the public catalog and the server story index, from
 * story/locales/{ru,en}/story.json (STAGING-DSL §4).
 */
export type StoryNames = {
  chapters: Record<ChapterId, { ru: string; en: string }>;
  speakers: Record<SpeakerId, { ru: string; en: string }>;
  stories: Record<StoryId, { ru: string; en: string }>;
  teasers: Record<StoryId, { ru: string; en: string }>;
};
/** server/content/stories.json (L6b's `ContentStore` reads it; the committed fixture is the contract). */
export type ServerStoryIndex = {
  format: 1;
  stories: ReadonlyArray<{
    id: StoryId;
    title: { ru: string; en: string };
    chapters: ReadonlyArray<{ id: ChapterId; paid: boolean; productId: ProductId | null; title: { ru: string; en: string } }>;
    endings: Readonly<Record<EndingName, { chapter: ChapterId }>>;
  }>;
};
/** A room's images (PUZZLES-PLAN `budget/room-set`): its bg, its props, its locks' closeups, its neighbours' bgs. */
export type StoryRoomUsage = {
  bg: AssetId;
  props: readonly AssetId[];
  closeups: readonly AssetId[];
  neighbours: readonly AssetId[];
};
/**
 * server/content/build/usage.json: per chapter, the union of its knots' assets and per knot the K9 index; for a
 * chapter with a world also `worldAssets` (every asset its world names), and `rooms` keyed `<ch>/<section>/<room>`
 * when some room exists. Both are written only then, and optional on read: a pre-LW3 usage.json still decodes (D4).
 */
export type StoryUsage = {
  chapters: Record<
    ChapterId,
    {
      assets: readonly AssetId[];
      knots: Record<KnotName, { assets: readonly AssetId[]; next: readonly KnotName[]; carried: readonly AssetId[] }>;
      worldAssets?: readonly AssetId[];
    }
  >;
  rooms?: Record<string, StoryRoomUsage>;
};
/** server/content/build/fingerprints.lines.json: what scan-dist looks for in dist/. */
export type LineFingerprints = { lineIds: readonly LineId[]; texts: readonly string[] };
/**
 * The world needles of `paid/leak` and scan-dist (PUZZLES-PLAN X7), built from the world sources: every hint's ID and
 * text (free and paid chapters alike), and the paid worlds' IDs and texts.
 */
export type WorldNeedles = {
  hintIds: readonly LineId[];
  hintTexts: readonly string[];
  paidIds: readonly LineId[];
  paidTexts: readonly string[];
};

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

/** Where a chapter's outputs go: a paid chapter's under server/content only (principle 0). */
export function chapterPaths(ch: Pick<ChapterListEntry, 'id' | 'paid'>): { story: string; meta: string; en: string; world: string } {
  const paid = `${OUT.paid}/${ch.id}`;
  const free = `${OUT.free}/${ch.id}`;
  return ch.paid
    ? { story: `${paid}/story.json`, meta: `${paid}/meta.json`, en: `${paid}/en.json`, world: `${paid}/world.json` }
    : { story: `${free}.story.json`, meta: `${free}.meta.json`, en: `${free}.en.json`, world: `${free}.world.json` };
}

/**
 * The world's version (PUZZLES-PLAN X9 "World version"): the first 16 hex of sha256 over `{ rules, body }`, with every
 * text (`{ id, ru }`) replaced by `1`: a text edit keeps saves, a rules edit (or a RULES_VERSION bump) does not.
 * `rules` exists for the bump test only (RULINGS 21 Q2).
 */
export function worldVersion(body: WorldPublicBody, rules: number = RULES_VERSION): string {
  return createHash('sha256').update(JSON.stringify({ rules, body: textless(body) }), 'utf8').digest('hex').slice(0, 16);
}

/** `v` with every plain object whose own keys are exactly `id` and `ru`, both strings, replaced by `1`. */
function textless(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(textless);
  }
  if (typeof v !== 'object' || v === null) {
    return v;
  }
  const o = v as Readonly<Record<string, unknown>>; // a plain JSON object: the world decoder built it
  const keys = Object.keys(o);
  if (keys.length === 2 && typeof o['id'] === 'string' && typeof o['ru'] === 'string') {
    return 1;
  }
  return Object.fromEntries(keys.map((k) => [k, textless(o[k])]));
}

/** The line IDs of a world's hints: shipped only in server/content/puzzles (X7, D10). */
export function hintIdsOf(w: WorldSource): Set<LineId> {
  return new Set(Object.values(w.puzzles).flatMap((p) => p.hints.map((h) => h.id)));
}

type EmitInput = {
  chapters: readonly ChapterListEntry[];
  compiled: ReadonlyMap<ChapterId, CompiledChapter>;
  graphs: ReadonlyMap<ChapterId, ChapterGraph>;
  cast: Cast;
  names: StoryNames;
  /**
   * Per chapter, the English text of each of its line IDs (STAGING-DSL §4), its world's hints included: shipped as
   * `{ id: en }` beside it without the hint IDs, which go to the server puzzle content only (D10).
   */
  en: ReadonlyMap<ChapterId, Readonly<Record<LineId, string>>>;
  /** The decoded story list (STAGING-DSL §9), in Home order: every listed chapter is on one chain. */
  stories: readonly StoryPlan[];
  /** Per chapter with a `story/<ch>/world.json`, its decoded source world (default none). */
  worlds?: ReadonlyMap<ChapterId, WorldSource>;
};
type Built = { ch: ChapterListEntry; compiled: CompiledChapter; graph: ChapterGraph; firstKnot: KnotName; world: WorldPublicBody | null };

function meta(b: Built, endings: ReadonlyMap<KnotName, EndingName> | undefined): ChapterMeta {
  const knots = Object.fromEntries([...b.graph.knots].map(([k, n]) => [k, { assets: n.assets, next: n.next, ending: n.ending }]));
  return {
    chapterId: b.ch.id,
    storyVersion: storyVersion(b.compiled.json),
    firstKnot: b.firstKnot,
    globals: b.graph.globals,
    vars: b.graph.vars,
    knots: knots as ChapterMeta['knots'], // keys are the graph's knot names
    endings: Object.fromEntries(endings ?? []) as ChapterMeta['endings'], // keys are knots `catalog/stories` checked
  };
}

/** A story's title or teaser; the locale check reports a missing one, so an emitting run has both. */
function storyText(section: Record<StoryId, { ru: string; en: string }>, id: StoryId, what: 'title' | 'teaser'): { ru: string; en: string } {
  const text = section[id];
  if (text === undefined) {
    throw new Error(`invariant: story ${id} has a ${what}`);
  }
  return text;
}

function chapterTitle(input: EmitInput, id: ChapterId): { ru: string; en: string } {
  const t = input.names.chapters[id];
  if (t === undefined) {
    throw new Error(`invariant: chapter ${id} has a title`);
  }
  return t;
}

function catalog(built: readonly Built[], input: EmitInput): ChapterCatalog {
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
    // No ending: the public catalog never names one, paid or free (principle 0, STORIES-PLAN Y5).
    stories: input.stories.map((s) => ({
      id: s.id,
      chapters: s.chapters,
      cover: s.cover,
      title: storyText(input.names.stories, s.id, 'title'),
      teaser: storyText(input.names.teasers, s.id, 'teaser'),
    })),
    chapters: built.map(({ ch }) => ({ id: ch.id, paid: ch.paid, productId: ch.productId, next: ch.next, title: chapterTitle(input, ch.id) })),
    cast: cast as ChapterCatalog['cast'], // keys are the decoded cast's speakers
  };
}

/** The server story index: per story its title, its chapters in chain order and its endings with their chapter. */
function storyIndex(input: EmitInput): ServerStoryIndex {
  const listed = new Map(input.chapters.map((c) => [c.id, c]));
  return {
    format: 1,
    stories: input.stories.map((s) => ({
      id: s.id,
      title: storyText(input.names.stories, s.id, 'title'),
      chapters: s.chapters.map((id) => {
        const ch = listed.get(id);
        if (ch === undefined) {
          throw new Error(`invariant: story ${s.id}'s chapter ${id} is listed`);
        }
        return { id, paid: ch.paid, productId: ch.productId, title: chapterTitle(input, id) };
      }),
      endings: Object.fromEntries(Object.entries(s.endings).map(([name, e]) => [name, { chapter: e.chapter }])) as ServerStoryIndex['stories'][number]['endings'], // keys are the decoded ending names
    })),
  };
}

/** Sorted, once each; the ids come from a decoded world, whose decoder checked every id's shape. */
function assetSet(ids: Iterable<string>): AssetId[] {
  return [...new Set(ids)].sort() as AssetId[];
}

/** Every asset a world names: room bgs and props, every puzzle's closeup, section bgms and exit sfx. */
function worldAssets(w: WorldPublicBody): AssetId[] {
  const ids: string[] = Object.values(w.puzzles).flatMap((p) => (p.closeup === null ? [] : [`cg/${p.closeup}`]));
  for (const s of Object.values(w.sections)) {
    if (s.bgm !== null) {
      ids.push(`bgm/${s.bgm}`);
    }
    for (const room of Object.values(s.rooms)) {
      ids.push(`bg/${room.bg}`);
      for (const h of room.hotspots) {
        if ((h.kind === 'take' || h.kind === 'object') && h.prop !== null) {
          ids.push(`prop/${h.prop}`);
        } else if (h.kind === 'exit' && h.sfx !== null) {
          ids.push(`sfx/${h.sfx}`);
        }
      }
    }
  }
  return assetSet(ids);
}

/** Per room `<ch>/<section>/<room>`: its bg, its take and object props, its locks' closeups, its neighbours' bgs. */
function roomUsage(ch: ChapterId, w: WorldPublicBody): Array<[string, StoryRoomUsage]> {
  return Object.entries(w.sections).flatMap(([sid, s]) =>
    Object.entries(s.rooms).map(([rid, room]): [string, StoryRoomUsage] => {
      const props = room.hotspots.flatMap((h) => ((h.kind === 'take' || h.kind === 'object') && h.prop !== null ? [`prop/${h.prop}`] : []));
      const closeups = room.hotspots.flatMap((h) => {
        const puzzle = lockOf(h)?.puzzle ?? null;
        const closeup = puzzle === null || !Object.hasOwn(w.puzzles, puzzle) ? null : (w.puzzles[puzzle]?.closeup ?? null);
        return closeup === null ? [] : [`cg/${closeup}`];
      });
      const neighbours = room.hotspots.flatMap((h) => {
        const to = h.kind === 'exit' && 'room' in h.to ? h.to.room : null;
        const next = to === null || !Object.hasOwn(s.rooms, to) ? undefined : s.rooms[to]; // a cross-section exit is `world/cross-section-exit`
        return next === undefined ? [] : [`bg/${next.bg}`];
      });
      const usage = { bg: `bg/${room.bg}` as AssetId, props: assetSet(props), closeups: assetSet(closeups), neighbours: assetSet(neighbours) };
      return [`${ch}/${sid}/${rid}`, usage];
    }),
  );
}

function usage(built: readonly Built[]): StoryUsage {
  const chapters = Object.fromEntries(
    built.map(({ ch, graph, world }) => {
      const knots = Object.fromEntries(
        [...graph.knots].map(([k, n]) => [k, { assets: n.assets, next: n.next, carried: graph.carried.get(k) ?? [] }]),
      );
      const assets = [...new Set([...graph.knots.values()].flatMap((n) => n.assets))].sort();
      return [ch.id, world === null ? { assets, knots } : { assets, knots, worldAssets: worldAssets(world) }];
    }),
  );
  const rooms = built.flatMap(({ ch, world }) => (world === null ? [] : roomUsage(ch.id, world)));
  // keys are chapter ids and knot names; `rooms` only when some room exists, so a world-less usage.json is unchanged
  const typed = chapters as StoryUsage['chapters'];
  return rooms.length === 0 ? { chapters: typed } : { chapters: typed, rooms: Object.fromEntries(rooms) };
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
    const source = input.worlds?.get(ch.id);
    return { ch, compiled, graph, firstKnot, world: source === undefined ? null : toPublic(source) };
  });
  const out = new Map<string, string>();
  const put = (path: string, text: string): void => {
    if (out.has(path)) {
      throw new Error(`invariant: one producer per output, ${path} planned twice`);
    }
    out.set(path, text);
  };
  const endings = endingKnots(input.stories);
  if (OUT.puzzles.startsWith('client/')) {
    throw new Error('invariant: the server puzzle content, which holds solutions and hints, is never routed under client/ (X7)');
  }
  for (const b of built) {
    const paths = chapterPaths(b.ch);
    if (b.ch.paid && [paths.story, paths.meta, paths.en, paths.world].some((p) => p.startsWith('client/'))) {
      throw new Error(`invariant: paid chapter ${b.ch.id} is never routed under client/ (principle 0)`);
    }
    const en = input.en.get(b.ch.id);
    if (en === undefined) {
      throw new Error(`invariant: chapter ${b.ch.id} has its en table before emit`);
    }
    const source = input.worlds?.get(b.ch.id);
    const hints = source === undefined ? new Set<LineId>() : hintIdsOf(source);
    put(paths.story, b.compiled.json);
    put(paths.meta, pretty(meta(b, endings.get(b.ch.id))));
    put(paths.en, pretty(Object.fromEntries(Object.entries(en).filter(([id]) => !hints.has(id as LineId))))); // keys of the en table
    if (b.world !== null) {
      const world: WorldPublic = { ...b.world, version: worldVersion(b.world) };
      put(paths.world, pretty(world));
    }
    const server: ServerPuzzleContent = source === undefined ? { format: 1, chapterId: b.ch.id, puzzles: {} } : toServer(source, en, b.ch.id);
    put(`${OUT.puzzles}/${b.ch.id}.json`, pretty(server));
  }
  put(`${OUT.storyGen}/catalog.json`, pretty(catalog(built, input)));
  if (OUT.stories.startsWith('client/')) {
    throw new Error('invariant: the story index, which names paid endings, is never routed under client/ (principle 0)');
  }
  put(OUT.stories, pretty(storyIndex(input)));
  put(`${OUT.build}/usage.json`, pretty(usage(built)));
  put(`${OUT.build}/fingerprints.lines.json`, pretty(fingerprints(built)));
  return out;
}

/**
 * `paid/leak` (STAGING-DSL §11): every paid line ID or text sample found in a story-gen file (path → text); with
 * `world` (default none) also every hint ID or text and every paid world ID or text (PUZZLES-PLAN X7).
 */
export function paidLeak(storyGen: ReadonlyMap<string, string>, fp: LineFingerprints, world?: WorldNeedles): Finding[] {
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
    for (const id of (world?.hintIds ?? []).filter((i) => text.includes(i))) {
      leak(file, `hint ID '${id}'`);
    }
    for (const t of (world?.hintTexts ?? []).filter((s) => text.includes(s))) {
      leak(file, `hint text ${JSON.stringify(t)}`);
    }
    for (const id of (world?.paidIds ?? []).filter((i) => text.includes(i))) {
      leak(file, `paid world ID '${id}'`);
    }
    for (const t of (world?.paidTexts ?? []).filter((s) => text.includes(s))) {
      leak(file, `paid world text ${JSON.stringify(t)}`);
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

function keysExactly(v: Raw, keys: readonly string[], path: string, issues: string[], optional: readonly string[] = []): void {
  const known = [...keys, ...optional];
  for (const k of Object.keys(v).filter((x) => !known.includes(x))) {
    issues.push(`${path}${k}: unknown key (expected ${known.join(', ')})`);
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
/** An asset id of one namespace (`bg`, `prop`, `cg`). */
const inNamespace =
  (ns: string) =>
  (s: string): boolean =>
    ASSET_ID_RE.test(s) && s.startsWith(`${ns}/`);
/** `<ch>/<section>/<room>` (PUZZLES-PLAN "Build outputs"); group 1 is the chapter. */
const ROOM_KEY_RE = /^(ch[1-9][0-9]*)\/[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*$/;

function decodeRooms(raw: unknown, chapters: Readonly<Record<string, unknown>>, issues: string[]): Record<string, StoryRoomUsage> {
  const rooms: Record<string, StoryRoomUsage> = {};
  if (!isObject(raw)) {
    issues.push('rooms: not an object');
    return rooms;
  }
  for (const [key, room] of Object.entries(raw)) {
    const path = `rooms.${key}`;
    const ch = ROOM_KEY_RE.exec(key)?.[1];
    if (ch === undefined || !Object.hasOwn(chapters, ch)) {
      issues.push(`${path}: not a <ch>/<section>/<room> key of a chapter of usage.json`);
      continue;
    }
    if (!isObject(room)) {
      issues.push(`${path}: not an object`);
      continue;
    }
    keysExactly(room, ['bg', 'props', 'closeups', 'neighbours'], `${path}.`, issues);
    const bg = room['bg'];
    if (typeof bg !== 'string' || !inNamespace('bg')(bg)) {
      issues.push(`${path}.bg: ${JSON.stringify(bg) ?? 'undefined'} is not a bg asset id`);
    }
    rooms[key] = {
      bg: bg as AssetId, // checked just above; an issue fails the decode
      props: list(room['props'], `${path}.props`, issues, inNamespace('prop'), 'a prop asset id') as AssetId[], // by the pattern
      closeups: list(room['closeups'], `${path}.closeups`, issues, inNamespace('cg'), 'a cg asset id') as AssetId[], // by the pattern
      neighbours: list(room['neighbours'], `${path}.neighbours`, issues, inNamespace('bg'), 'a bg asset id') as AssetId[], // by the pattern
    };
  }
  return rooms;
}

/** Decodes usage.json (a pre-LW3 one too: `worldAssets` and `rooms` are optional); every problem is reported. */
export function decodeStoryUsage(raw: unknown): Result<StoryUsage, string[]> {
  const issues: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, error: ['not a JSON object'] };
  }
  keysExactly(raw, ['chapters'], '', issues, ['rooms']);
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
      keysExactly(entry, ['assets', 'knots'], `${path}.`, issues, ['worldAssets']);
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
      const assets = assetList(entry['assets'], `${path}.assets`, issues);
      const typed = knots as StoryUsage['chapters'][ChapterId]['knots']; // keys passed the pattern above
      chapters[id] = Object.hasOwn(entry, 'worldAssets')
        ? { assets, knots: typed, worldAssets: assetList(entry['worldAssets'], `${path}.worldAssets`, issues) }
        : { assets, knots: typed };
    }
  }
  const rooms = Object.hasOwn(raw, 'rooms') ? decodeRooms(raw['rooms'], chapters, issues) : null;
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  const value = { chapters: chapters as StoryUsage['chapters'] }; // keys passed the patterns above
  return { ok: true, value: rooms === null ? value : { ...value, rooms } };
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
