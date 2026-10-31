// The story meta of STAGING-DSL §9 "Story meta" (META-PLAN M2, M4, M5, "Source file"): the choice points of a
// compiled chapter's classified sources, and story/meta.json decoded against the story list, those choice points and
// the worlds' puzzles, every finding under `catalog/meta` (§11), none stopping the run. Pure, no node:*, no inkjs:
// story.ts reads the files; the graph comes in as a type only. The meta texts are server-only
// (M7): emit.ts routes them to server/content/meta.json alone, so emit.ts, which scan-dist.ts reaches, imports this
// module as types only.
import { CHAPTER_ID_RE } from '../../src/story/catalog.ts';
import type { EndingName, StoryId } from '../../src/story/catalog.ts';
import type { ChapterId, LineId, PuzzleLocalId } from '../../src/story/staging.ts';
import { LINE_ID_RE } from '../../src/story/tags.ts';
import { classify } from './classify.ts';
import type { StoryLine } from './graph.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding } from './lint.ts';
import type { StoryPlan } from './stories.ts';

export const META_FILE = 'story/meta.json';
/** META-PLAN "Ids" `AchievementId`. */
export const ACHIEVEMENT_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
/** M4: text lengths in code points, achievements per story, and the conditions of an `all` (M5). */
export const META_LIMITS = { title: 40, name: 40, desc: 140, perStory: 50, allMin: 2, allMax: 4 } as const;
/** `<ch>.<local>`: the server's chapter-qualified `PuzzleId` (server/src/ids.rs), its chapter and local id. */
const PUZZLE_REF_RE = /^(ch[1-9][0-9]*)\.([a-z][a-z0-9_]*)$/;

/** A server-side text in both languages, the shape of every server text format. */
export type LangText = { ru: string; en: string };
export type AchievementId = string & { readonly __brand: 'AchievementId' };
/** M5: exactly one kind per condition; `hints: 0` only beside `puzzle`; an `all` holds 2-4 conditions and no `all`. */
export type MetaCondition =
  | { ending: EndingName }
  | { endings: number }
  | { allEndings: true }
  | { choice: LineId }
  | { chapter: ChapterId }
  | { puzzle: string; hints?: 0 }
  | { all: readonly MetaCondition[] };
export type AchievementSource = { hidden: boolean; when: MetaCondition; name: LangText; desc: LangText };
export type StoryMeta = {
  endings: Readonly<Record<EndingName, LangText>>;
  /** The object order is the display order (M4). */
  achievements: Readonly<Record<AchievementId, AchievementSource>>;
};
/** story/meta.json decoded: only the stories the file holds (a story that declares no ending may be absent). */
export type MetaSource = Readonly<Record<StoryId, StoryMeta>>;
/** A chapter's choice vocabulary (M2): option line ID → its point's id (the point's first option), in source order. */
export type ChoiceMap = ReadonlyMap<LineId, LineId>;

const CONDITION_KINDS = ['ending', 'endings', 'allEndings', 'choice', 'chapter', 'puzzle', 'all'] as const;
type ConditionKind = (typeof CONDITION_KINDS)[number];
const STORY_KEYS = ['endings', 'achievements'] as const;
const ACHIEVEMENT_KEYS = ['hidden', 'when', 'name', 'desc'] as const;
const LANGS = ['ru', 'en'] as const;

type Raw = Readonly<Record<string, unknown>>;
type Report = (path: string, detail: string) => void;
/** What the conditions of one story are judged against (rule 5). */
type Context = {
  story: StoryPlan;
  choices: ReadonlyMap<ChapterId, ChoiceMap>;
  puzzles: ReadonlyMap<ChapterId, ReadonlySet<PuzzleLocalId> | null>;
  report: Report;
};

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function shown(v: unknown): string {
  return JSON.stringify(v) ?? 'undefined';
}

function isKind(key: string): key is ConditionKind {
  return (CONDITION_KINDS as readonly string[]).includes(key);
}

function exactKeys(value: Raw, keys: readonly string[], path: string, report: Report): void {
  for (const key of Object.keys(value).filter((k) => !keys.includes(k))) {
    report(`${path}.${key}`, `unknown key (expected ${keys.join(', ')})`);
  }
  for (const key of keys.filter((k) => !Object.hasOwn(value, k))) {
    report(`${path}.${key}`, 'missing');
  }
}

/** A `{ ru, en }` text of 1-`max` code points in each language, non-blank (rules 2 and 3); null after a finding. */
function langText(raw: unknown, path: string, max: number, report: Report): LangText | null {
  if (!isObject(raw)) {
    report(path, `${shown(raw)} is not an object { ru, en }`);
    return null;
  }
  let ok = true;
  const fail = (at: string, detail: string): void => {
    ok = false;
    report(at, detail);
  };
  for (const key of Object.keys(raw).filter((k) => k !== 'ru' && k !== 'en')) {
    fail(`${path}.${key}`, 'unknown key (expected ru, en)');
  }
  for (const lang of LANGS) {
    const v = raw[lang];
    const n = typeof v === 'string' ? [...v].length : 0;
    if (!Object.hasOwn(raw, lang)) {
      fail(`${path}.${lang}`, 'missing');
    } else if (typeof v !== 'string') {
      fail(`${path}.${lang}`, `${shown(v)} is not a string`);
    } else if (v.trim() === '') {
      fail(`${path}.${lang}`, 'blank');
    } else if (n > max) {
      fail(`${path}.${lang}`, `${n} code points (1-${max})`);
    }
  }
  return ok ? { ru: String(raw['ru']), en: String(raw['en']) } : null;
}

/**
 * One condition (rules 4 and 5): exactly one kind, `hints: 0` only beside `puzzle`, an `all` of 2-4 conditions without
 * a nested `all`; then what it names, on the story's chain. A `choice` into a chapter absent from `choices` (it did not
 * compile) or a `puzzle` into a world given as null (it did not decode) is not judged: that chapter's own error already
 * fails the run. Returns null after a finding.
 */
function condition(raw: unknown, path: string, ctx: Context, nested: boolean): MetaCondition | null {
  const { story, report } = ctx;
  if (!isObject(raw)) {
    report(path, `${shown(raw)} is not a condition object`);
    return null;
  }
  const keys = Object.keys(raw);
  const kinds = keys.filter(isKind);
  let ok = true;
  const fail = (at: string, detail: string): void => {
    ok = false;
    report(at, detail);
  };
  for (const key of keys.filter((k) => !isKind(k) && k !== 'hints')) {
    fail(`${path}.${key}`, `unknown key (a condition is one of ${CONDITION_KINDS.join(', ')})`);
  }
  const kind = kinds[0];
  if (kind === undefined || kinds.length > 1) {
    fail(path, kind === undefined ? 'no condition kind' : `${kinds.length} condition kinds (${kinds.join(', ')}): a condition has exactly one`);
    return null;
  }
  if (Object.hasOwn(raw, 'hints')) {
    if (kind !== 'puzzle') {
      fail(`${path}.hints`, `beside '${kind}': hints only beside puzzle`);
    } else if (raw['hints'] !== 0) {
      fail(`${path}.hints`, `${shown(raw['hints'])} is not 0`);
    }
  }
  const at = `${path}.${kind}`;
  const v = raw[kind];
  const declared = Object.keys(story.endings);
  const chain: readonly string[] = story.chapters;
  const onChain = `a chapter on ${story.id}'s chain`;
  let out: MetaCondition | null = null;
  switch (kind) {
    case 'ending':
      if (typeof v !== 'string') {
        fail(at, `${shown(v)} is not an ending name`);
      } else if (!declared.includes(v)) {
        fail(at, `'${v}' is not an ending of ${story.id}`);
      } else {
        out = { ending: v as EndingName }; // a declared name: decoded by catalog/stories
      }
      break;
    case 'endings':
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        fail(at, `${shown(v)} is not an integer`);
      } else if (declared.length === 0) {
        fail(at, `${story.id} declares no ending`);
      } else if (v < 1 || v > declared.length) {
        fail(at, `${v} is not between 1 and ${declared.length} (the endings ${story.id} declares)`);
      } else {
        out = { endings: v };
      }
      break;
    case 'allEndings':
      if (v !== true) {
        fail(at, `${shown(v)} is not true`);
      } else if (declared.length === 0) {
        fail(at, `${story.id} declares no ending`);
      } else {
        out = { allEndings: true };
      }
      break;
    case 'choice': {
      const chapter = typeof v === 'string' && LINE_ID_RE.test(v) ? v.slice(0, v.indexOf('.')) : null;
      if (typeof v !== 'string' || chapter === null) {
        fail(at, `${shown(v)} is not a line ID`);
      } else if (!chain.includes(chapter)) {
        fail(at, `'${v}' is not an option of ${onChain}`);
      } else if (ctx.choices.get(chapter as ChapterId)?.has(v as LineId) === false) {
        fail(at, `'${v}' is not a choice with text of ${chapter}`);
      } else {
        out = { choice: v as LineId }; // LINE_ID_RE above
      }
      break;
    }
    case 'chapter':
      if (typeof v !== 'string' || !CHAPTER_ID_RE.test(v)) {
        fail(at, `${shown(v)} is not a chapter id`);
      } else if (!chain.includes(v)) {
        fail(at, `'${v}' is not on ${story.id}'s chain (${story.chapters.join(' → ')})`);
      } else {
        out = { chapter: v as ChapterId }; // CHAPTER_ID_RE above
      }
      break;
    case 'puzzle': {
      const m = typeof v === 'string' ? PUZZLE_REF_RE.exec(v) : null;
      const chapter = m?.[1];
      const local = m?.[2];
      // Absent from `puzzles`: no world is known for the chapter, so nothing it names exists.
      const known = chapter === undefined ? undefined : ctx.puzzles.get(chapter as ChapterId);
      if (typeof v !== 'string' || chapter === undefined || local === undefined) {
        fail(at, `${shown(v)} is not a puzzle id <chapter>.<puzzle>`);
      } else if (!chain.includes(chapter)) {
        fail(at, `'${v}' is not a puzzle of ${onChain}`);
      } else if (known !== null && known?.has(local as PuzzleLocalId) !== true) {
        fail(at, known === undefined || known.size === 0 ? `'${v}': ${chapter} has no world` : `'${v}' is not a puzzle of ${chapter}'s world`);
      } else {
        out = raw['hints'] === 0 ? { puzzle: v, hints: 0 } : { puzzle: v };
      }
      break;
    }
    case 'all': {
      if (nested) {
        fail(path, 'a nested all');
        break;
      }
      if (!Array.isArray(v)) {
        fail(at, `${shown(v)} is not an array of conditions`);
        break;
      }
      if (v.length < META_LIMITS.allMin || v.length > META_LIMITS.allMax) {
        fail(at, `${v.length} conditions (${META_LIMITS.allMin}-${META_LIMITS.allMax})`);
      }
      const parts = v.map((c: unknown, i) => condition(c, `${at}.${i}`, ctx, true));
      const all = parts.flatMap((c) => (c === null ? [] : [c]));
      if (all.length === parts.length) {
        out = { all };
      } else {
        ok = false;
      }
      break;
    }
    default: {
      const _never: never = kind;
      return _never;
    }
  }
  return ok ? out : null;
}

/** One story's entry (rules 1-5): exactly `endings` and `achievements`; null after a finding. */
function storyMeta(raw: unknown, ctx: Context): StoryMeta | null {
  const { story, report } = ctx;
  const id: string = story.id;
  if (!isObject(raw)) {
    report(id, `${shown(raw)} is not an object { endings, achievements }`);
    return null;
  }
  let ok = true;
  const fail: Report = (at, detail) => {
    ok = false;
    report(at, detail);
  };
  exactKeys(raw, STORY_KEYS, id, fail);
  // Rule 2: exactly the declared endings, each titled.
  const endings: Record<string, LangText> = {};
  const rawEndings = raw['endings'];
  if (Object.hasOwn(raw, 'endings') && !isObject(rawEndings)) {
    fail(`${id}.endings`, `${shown(rawEndings)} is not an object`);
  } else if (isObject(rawEndings)) {
    const declared = Object.keys(story.endings);
    for (const name of declared.filter((n) => !Object.hasOwn(rawEndings, n))) {
      fail(`${id}.endings.${name}`, 'missing');
    }
    for (const [name, title] of Object.entries(rawEndings)) {
      if (!declared.includes(name)) {
        fail(`${id}.endings.${name}`, `not an ending ${id} declares`);
        continue;
      }
      const text = langText(title, `${id}.endings.${name}`, META_LIMITS.title, fail);
      if (text !== null) {
        endings[name] = text;
      }
    }
  }
  // Rule 3: the achievements, each with its condition (rules 4 and 5).
  const achievements: Record<string, AchievementSource> = {};
  const rawAchievements = raw['achievements'];
  if (Object.hasOwn(raw, 'achievements') && !isObject(rawAchievements)) {
    fail(`${id}.achievements`, `${shown(rawAchievements)} is not an object`);
  } else if (isObject(rawAchievements)) {
    const entries = Object.entries(rawAchievements);
    if (entries.length > META_LIMITS.perStory) {
      fail(`${id}.achievements`, `${entries.length} achievements (at most ${META_LIMITS.perStory} per story)`);
    }
    for (const [key, value] of entries) {
      const at = `${id}.achievements.${key}`;
      if (!ACHIEVEMENT_ID_RE.test(key)) {
        fail(at, `'${key}' does not match ${ACHIEVEMENT_ID_RE.source}`);
      }
      if (!isObject(value)) {
        fail(at, `${shown(value)} is not an object { hidden, when, name, desc }`);
        continue;
      }
      exactKeys(value, ACHIEVEMENT_KEYS, at, fail);
      const hidden = value['hidden'];
      if (Object.hasOwn(value, 'hidden') && typeof hidden !== 'boolean') {
        fail(`${at}.hidden`, `${shown(hidden)} is not a boolean`);
      }
      const when = Object.hasOwn(value, 'when') ? condition(value['when'], `${at}.when`, { ...ctx, report: fail }, false) : null;
      const name = Object.hasOwn(value, 'name') ? langText(value['name'], `${at}.name`, META_LIMITS.name, fail) : null;
      const desc = Object.hasOwn(value, 'desc') ? langText(value['desc'], `${at}.desc`, META_LIMITS.desc, fail) : null;
      if (ok && typeof hidden === 'boolean' && when !== null && name !== null && desc !== null) {
        achievements[key] = { hidden, when, name, desc };
      }
    }
  }
  // Every key was judged above: the brands are earned by the declared names and ACHIEVEMENT_ID_RE.
  return ok ? { endings: endings as StoryMeta['endings'], achievements: achievements as StoryMeta['achievements'] } : null;
}

/**
 * The choice points of one chapter (M2): its files (`CompiledChapter.files`, story-relative) walked in order through
 * the classifier, each file from a clean state. The options at depth d of one knot or stitch form one point until a
 * knot or stitch header (which closes every point) or a gather of depth <= d; a choice of depth d first closes every
 * deeper point, then joins the open point of depth d or opens one. Text, logic, divert and block lines are
 * transparent. An option's ID is the graph's (`lines`, joined by file and line: the gate's own ID rule), so a choice
 * without one is no option and changes nothing: a fallback (no text), or a choice whose ID is missing or malformed,
 * whose `id/*` finding already fails the run. A point's id is its first option's ID; the map is in source order.
 */
export function choicePoints(input: { files: readonly string[]; sources: ReadonlyMap<string, string>; lines: readonly StoryLine[] }): ChoiceMap {
  const ids = new Map(input.lines.map((l) => [`${l.file}:${l.line}`, l.id] as const));
  const out = new Map<LineId, LineId>();
  for (const file of input.files) {
    /** Depth → the id of the point open at that depth. */
    const open = new Map<number, LineId>();
    const closeFrom = (depth: number): void => {
      for (const d of [...open.keys()].filter((k) => k >= depth)) {
        open.delete(d);
      }
    };
    for (const l of classify(input.sources.get(file) ?? '')) {
      const cls = l.cls;
      if (cls.kind === 'knot' || cls.kind === 'stitch') {
        open.clear();
      } else if (cls.kind === 'gather') {
        closeFrom(cls.depth);
      } else if (cls.kind === 'choice') {
        const id = ids.get(`${file}:${l.line}`);
        if (id === undefined) {
          continue;
        }
        closeFrom(cls.depth + 1);
        const point = open.get(cls.depth) ?? id;
        open.set(cls.depth, point);
        out.set(id, point);
      }
    }
  }
  return out;
}

/**
 * `catalog/meta` (STAGING-DSL §11): rule 1, the file is an object of story entries of `story/stories.json` (a missing
 * file, `text` null, counts as `{}`); rule 2, every declared ending titled and no other; rule 3, the achievements; rule
 * 4, each condition's shape; rule 5, what it names. `choices` holds the compiled chapters only and `puzzles` every
 * listed chapter (an empty set: no world; null: a world that did not decode), so a reference into a chapter whose own
 * error fails the run is not judged twice. Every finding names story/meta.json (line 0) and is returned, never only
 * the first; `meta` is null iff there is one.
 */
export function lintMeta(input: {
  text: string | null;
  stories: readonly StoryPlan[];
  choices: ReadonlyMap<ChapterId, ChoiceMap>;
  puzzles: ReadonlyMap<ChapterId, ReadonlySet<PuzzleLocalId> | null>;
}): { findings: Finding[]; meta: MetaSource | null } {
  const findings: Finding[] = [];
  const report: Report = (path, detail) =>
    findings.push({ code: 'catalog/meta', severity: LINT_CODES['catalog/meta'], file: META_FILE, line: 0, message: path === '' ? detail : `${path}: ${detail}` });
  let root: unknown = {};
  if (input.text !== null) {
    try {
      root = JSON.parse(input.text);
    } catch (e) {
      report('', `not JSON: ${e instanceof Error ? e.message : String(e)}`);
      return { findings, meta: null };
    }
  }
  if (!isObject(root)) {
    report('', `${Array.isArray(root) ? 'an array' : shown(root)} is not a JSON object of stories`);
    return { findings, meta: null };
  }
  const byId = new Map<string, StoryPlan>(input.stories.map((s) => [s.id, s]));
  const meta: Record<string, StoryMeta> = {};
  for (const [key, value] of Object.entries(root)) {
    const story = byId.get(key);
    if (story === undefined) {
      report(key, 'not a story of story/stories.json');
      continue;
    }
    const decoded = storyMeta(value, { story, choices: input.choices, puzzles: input.puzzles, report });
    if (decoded !== null) {
      meta[key] = decoded;
    }
  }
  for (const story of input.stories) {
    const declared = Object.keys(story.endings);
    if (!Object.hasOwn(root, story.id) && declared.length > 0) {
      report(story.id, `missing (it declares endings ${declared.join(', ')})`);
    }
  }
  return findings.length > 0 ? { findings, meta: null } : { findings, meta: meta as MetaSource }; // keys are listed story ids
}
