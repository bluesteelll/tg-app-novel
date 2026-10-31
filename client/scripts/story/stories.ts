// The story list of STAGING-DSL §9 (STORIES-PLAN Y2, Y4): story/stories.json decoded against the chapter list and
// the asset catalog, every finding under `catalog/stories` (§11). Pure, no node:*: story.ts reads the file. The graph
// and emit modules come in as types only, so emit.ts, which scan-dist.ts reaches, loads no graph code through here.
import { CHAPTER_ID_RE, ENDING_NAME_RE, KNOT_NAME_RE, STORY_ID_RE } from '../../src/story/catalog.ts';
import type { AssetCatalog, ChapterListEntry, EndingName, Result, StoryId } from '../../src/story/catalog.ts';
import type { AssetId, ChapterId, KnotName } from '../../src/story/staging.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding } from './lint.ts';

/** story/stories.json, one entry as written: the array order is the Home order. */
export type StorySource = {
  id: StoryId;
  first: ChapterId;
  cover: AssetId;
  endings: Readonly<Record<EndingName, { chapter: ChapterId; knot: KnotName }>>;
};
/** A decoded story with its resolved chain: `first`, then each `next`, in play order. */
export type StoryPlan = StorySource & { chapters: readonly ChapterId[] };

export const STORIES_FILE = 'story/stories.json';
const STORY_KEYS = ['id', 'first', 'cover', 'endings'] as const;
const ENDING_KEYS = ['chapter', 'knot'] as const;
const COVER_RE = /^cover\/([a-z][a-z0-9_]*)$/;

type Raw = Readonly<Record<string, unknown>>;
type Report = (path: string, detail: string) => void;

function finding(file: string, message: string): Finding {
  return { code: 'catalog/stories', severity: LINT_CODES['catalog/stories'], file, line: 0, message };
}

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function shown(v: unknown): string {
  return JSON.stringify(v) ?? 'undefined';
}

function exactKeys(value: Raw, keys: readonly string[], path: string, report: Report): void {
  for (const key of Object.keys(value).filter((k) => !keys.includes(k))) {
    report(`${path}.${key}`, `unknown key (expected ${keys.join(', ')})`);
  }
  for (const key of keys.filter((k) => !Object.hasOwn(value, k))) {
    report(`${path}.${key}`, 'missing');
  }
}

function matching(value: unknown, re: RegExp, path: string, report: Report): string | null {
  if (typeof value !== 'string' || !re.test(value)) {
    report(path, `${shown(value)} does not match ${re.source}`);
    return null;
  }
  return value;
}

/**
 * The chain from `first` along `next` (rule 4: it visits no chapter twice). A repeat ends the walk, so the chain holds
 * each chapter once; `repeat` names the chapter reached again, if any.
 */
function chainFrom(first: ChapterId, byId: ReadonlyMap<string, ChapterListEntry>): { chain: ChapterId[]; repeat: ChapterId | null } {
  const chain: ChapterId[] = [];
  for (let at: ChapterId | null = first; at !== null; at = byId.get(at)?.next ?? null) {
    if (chain.includes(at)) {
      return { chain, repeat: at };
    }
    chain.push(at);
  }
  return { chain, repeat: null };
}

/**
 * Decodes story/stories.json, rules 1-7 of `catalog/stories` (STAGING-DSL §11): a non-empty array of exactly
 * `{ id, first, cover, endings }`; unique ids of the `StoryId` grammar; a free, listed `first` that no `next` names; a
 * chain without a repeat; every listed chapter on exactly one chain; a listed `cover/<name>`; ending names of the
 * `EndingName` grammar whose chapter is on the story's chain. `chapters` is the decoded list. Every finding names
 * story/stories.json (line 0) and is returned, never only the first; the plans come only from a file without one.
 */
export function decodeStories(raw: unknown, chapters: readonly ChapterListEntry[], assets: AssetCatalog): Result<readonly StoryPlan[], Finding[]> {
  const out: Finding[] = [];
  const report: Report = (path, detail) => out.push(finding(STORIES_FILE, path === '' ? detail : `${path}: ${detail}`));
  if (!Array.isArray(raw)) {
    report('', 'not a JSON array of stories');
    return { ok: false, error: out };
  }
  if (raw.length === 0) {
    report('', '0 stories: every listed chapter lies on exactly one story (§9)');
    return { ok: false, error: out };
  }
  const byId: ReadonlyMap<string, ChapterListEntry> = new Map(chapters.map((c) => [c.id, c]));
  const plans: StoryPlan[] = [];
  /** Per chapter, the stories whose chain holds it (by id, or by index when the id is invalid). */
  const owners = new Map<ChapterId, string[]>();
  const ids: string[] = [];
  raw.forEach((entry: unknown, i) => {
    const path = String(i);
    const before = out.length;
    if (!isObject(entry)) {
      report(path, 'not an object');
      return;
    }
    exactKeys(entry, STORY_KEYS, path, report);
    const id = matching(entry['id'], STORY_ID_RE, `${path}.id`, report);
    if (id !== null && ids.includes(id)) {
      report(`${path}.id`, `duplicate id '${id}'`);
    }
    if (id !== null) {
      ids.push(id);
    }
    const rawFirst = entry['first'];
    const first = typeof rawFirst === 'string' ? byId.get(rawFirst) : undefined;
    let chain: ChapterId[] = [];
    if (first === undefined) {
      report(`${path}.first`, `${shown(rawFirst)} is not a listed chapter`);
    } else {
      if (first.paid) {
        report(`${path}.first`, `'${first.id}' is paid: the first chapter of a story is free (§9)`);
      }
      for (const pred of chapters.filter((c) => c.next === first.id)) {
        report(`${path}.first`, `'${first.id}' is the next of '${pred.id}': a story starts where no chain leads (§9)`);
      }
      const walk = chainFrom(first.id, byId);
      if (walk.repeat !== null) {
        report(`${path}.first`, `the chain from '${first.id}' visits '${walk.repeat}' twice`);
      }
      chain = walk.chain;
    }
    const owner = id ?? `#${i}`;
    for (const ch of chain) {
      owners.set(ch, [...(owners.get(ch) ?? []), owner]);
    }
    const cover = entry['cover'];
    const coverName = typeof cover === 'string' ? (COVER_RE.exec(cover)?.[1] ?? null) : null;
    if (coverName === null) {
      report(`${path}.cover`, `${shown(cover)} does not match ${COVER_RE.source}`);
    } else if (!Object.hasOwn(assets.cover, coverName)) {
      report(`${path}.cover`, `'${String(cover)}' is not in assets/catalog.json`);
    }
    const endings: Record<string, { chapter: ChapterId; knot: KnotName }> = {};
    const rawEndings = entry['endings'];
    if (Object.hasOwn(entry, 'endings') && !isObject(rawEndings)) {
      report(`${path}.endings`, 'not an object');
    }
    for (const [name, ending] of Object.entries(isObject(rawEndings) ? rawEndings : {})) {
      const at = `${path}.endings.${name}`;
      if (!ENDING_NAME_RE.test(name)) {
        report(at, `'${name}' does not match ${ENDING_NAME_RE.source}`);
        continue;
      }
      if (!isObject(ending)) {
        report(at, 'not an object');
        continue;
      }
      exactKeys(ending, ENDING_KEYS, at, report);
      const chapter = matching(ending['chapter'], CHAPTER_ID_RE, `${at}.chapter`, report);
      const knot = matching(ending['knot'], KNOT_NAME_RE, `${at}.knot`, report);
      if (chapter !== null && first !== undefined && !chain.some((c) => c === chapter)) {
        report(`${at}.chapter`, `'${chapter}' is not on the chain of the story (${chain.join(' → ')})`);
      }
      if (chapter !== null && knot !== null) {
        endings[name] = { chapter: chapter as ChapterId, knot: knot as KnotName }; // the brands are earned above
      }
    }
    if (out.length === before && id !== null && first !== undefined && coverName !== null) {
      // The brands are earned by the patterns above.
      plans.push({ id: id as StoryId, first: first.id, cover: cover as AssetId, endings: endings as StorySource['endings'], chapters: chain });
    }
  });
  for (const c of chapters) {
    const owned = owners.get(c.id) ?? [];
    if (owned.length === 0) {
      report('', `${c.id} lies on no story's chain: every listed chapter belongs to exactly one story (§9)`);
    } else if (owned.length > 1) {
      report('', `${c.id} lies on the chains of ${owned.join(' and ')}: a chapter belongs to exactly one story (§9)`);
    }
  }
  if (out.length > 0) {
    return { ok: false, error: out };
  }
  return { ok: true, value: plans };
}
