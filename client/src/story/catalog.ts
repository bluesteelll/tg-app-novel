// The asset catalog (assets/catalog.json) and the cast (story/cast.json): types, decoders and the AssetIndex that
// parseTags reads. Decoded at the edge, never trusted blindly; every lookup is an own-property lookup, so a tag
// naming `constructor` is an unknown asset, not Object.prototype's. L3b and L5 append their parts of this module.
// Pure (PUZZLES-PLAN X4, the arch test's pure-world rule): no clock, randomness, DOM, network or storage.
import type {
  AssetId,
  AssetIndex,
  BgId,
  CgId,
  ChapterId,
  CharId,
  ExprId,
  KnotName,
  ProductId,
  PropId,
  SfxId,
  SpeakerId,
  StoryVersion,
  TrackId,
  VarName,
} from './staging.ts';

/** PROTOTYPE-PLAN.md "Result at module edges", verbatim. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** One problem in a catalog or build-output file; `path` is the dotted JSON path ('' = the whole file). */
export type CatalogIssue = {
  file: 'assets/catalog.json' | 'story/cast.json' | 'story/chapters.json' | 'story-gen/catalog.json' | 'meta.json';
  path: string;
  detail: string;
};
/** A generated image's parameter (PROTOTYPE-PLAN K23): its hue; the label drawn is the asset id. */
export type ImagePlaceholder = { readonly hue: number };
/** A synthesized clip's parameter (K23): the sine tone in Hz. */
export type AudioPlaceholder = { readonly hz: number };
/** An image entry (bg, a character expression, cg, prop, cover); its canonical size is its namespace's. */
export type CatalogImage = { readonly placeholder: ImagePlaceholder };
/**
 * An audio entry (bgm, sfx). The decoder accepts only the placeholder form: real audio is PP "Later". The `src` form
 * is typed so budget's K23 rule (WAV only for a placeholder) is reachable on a typed input and is seen failing before
 * that lane, which makes it decodable.
 */
export type CatalogAudio = { readonly placeholder: AudioPlaceholder } | { readonly src: string };
/** Any catalog entry. */
export type CatalogEntry = CatalogImage | CatalogAudio;
/** `cover/<id>` (STORIES-PLAN Y15): a story's Home cover. A local brand: staging.ts names no cover. */
export type CoverId = string & { readonly __brand: 'CoverId' };
/** STAGING-DSL §8: one namespace per kind; a character's expressions are a map, one asset each. */
export type AssetCatalog = {
  bg: Readonly<Record<BgId, CatalogImage>>;
  chars: Readonly<Record<CharId, { exprs: Readonly<Record<ExprId, CatalogImage>> }>>;
  cg: Readonly<Record<CgId, CatalogImage>>;
  bgm: Readonly<Record<TrackId, CatalogAudio>>;
  sfx: Readonly<Record<SfxId, CatalogAudio>>;
  /** PUZZLES-PLAN X11: named by world data, never by a tag; ≤ 512×512. */
  prop: Readonly<Record<PropId, CatalogImage>>;
  /** STORIES-PLAN Y15: always public, exactly 360×640. */
  cover: Readonly<Record<CoverId, CatalogImage>>;
};
/** STAGING-DSL §5: speaker → sprite character (or none). */
export type Cast = Readonly<Record<SpeakerId, { char: CharId | null }>>;

/** STAGING-DSL §2: the words a tag uses in an id slot (`hide: all`, `cg: off`, `bgm: stop`); never an asset id. */
export const RESERVED_IDS = ['all', 'off', 'stop'] as const;

// §8 asset names and §5 speaker ids share one shape. It also rules out `__proto__`, the one key whose assignment
// would set a prototype instead of an own property.
const ID_RE = /^[a-z][a-z0-9_]*$/;
const NAMESPACES = ['bg', 'chars', 'cg', 'bgm', 'sfx', 'prop', 'cover'] as const;
type Namespace = (typeof NAMESPACES)[number];
/** Placeholder parameter ranges: a hue in degrees; a tone from A1 to A6, audible on a phone speaker. */
const HUE = { min: 0, max: 359 } as const;
const HZ = { min: 55, max: 1760 } as const;

type Raw = Readonly<Record<string, unknown>>;
type Report = (path: string, detail: string) => void;

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function idProblem(id: string): string | null {
  if (!ID_RE.test(id)) {
    return `'${id}' is not an id [a-z][a-z0-9_]*`;
  }
  if ((RESERVED_IDS as readonly string[]).includes(id)) {
    return `'${id}' is a reserved word (${RESERVED_IDS.join(', ')})`;
  }
  return null;
}

/** One entry's decoder: the typed entry, or null after reporting why not. */
type EntryDecoder<E> = (entry: Raw, path: string, report: Report) => E | null;

/** Exactly `{ placeholder: { <key>: <integer in range> } }`; every problem is reported. */
function placeholderParam(
  entry: Raw,
  path: string,
  key: 'hue' | 'hz',
  range: { readonly min: number; readonly max: number },
  report: Report,
): number | null {
  for (const k of Object.keys(entry).filter((name) => name !== 'placeholder')) {
    report(`${path}.${k}`, "unknown key (an entry holds only 'placeholder')");
  }
  if (!Object.hasOwn(entry, 'placeholder')) {
    report(`${path}.placeholder`, 'missing');
    return null;
  }
  const params = entry['placeholder'];
  if (!isObject(params)) {
    report(`${path}.placeholder`, 'not an object');
    return null;
  }
  for (const k of Object.keys(params).filter((name) => name !== key)) {
    report(`${path}.placeholder.${k}`, `unknown key (expected ${key})`);
  }
  if (!Object.hasOwn(params, key)) {
    report(`${path}.placeholder.${key}`, 'missing');
    return null;
  }
  const value = params[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < range.min || value > range.max) {
    report(`${path}.placeholder.${key}`, `${JSON.stringify(value) ?? 'undefined'} is not an integer ${range.min}..${range.max}`);
    return null;
  }
  return value;
}

const imageEntry: EntryDecoder<CatalogImage> = (entry, path, report) => {
  const hue = placeholderParam(entry, path, 'hue', HUE, report);
  return hue === null ? null : { placeholder: { hue } };
};

const audioEntry: EntryDecoder<CatalogAudio> = (entry, path, report) => {
  const hz = placeholderParam(entry, path, 'hz', HZ, report);
  return hz === null ? null : { placeholder: { hz } };
};

/** The well-formed `id → entry` pairs of one object; every other key is reported. */
function entries<E>(value: unknown, path: string, report: Report, decode: EntryDecoder<E>): Record<string, E> {
  const out: Record<string, E> = {};
  if (!isObject(value)) {
    report(path, 'not an object');
    return out;
  }
  for (const [id, entry] of Object.entries(value)) {
    const problem = idProblem(id);
    if (problem !== null) {
      report(`${path}.${id}`, problem);
    } else if (!isObject(entry)) {
      report(`${path}.${id}`, 'entry is not an object');
    } else {
      const decoded = decode(entry, `${path}.${id}`, report);
      if (decoded !== null) {
        out[id] = decoded;
      }
    }
  }
  return out;
}

/**
 * Two placeholders of one role with one tone synthesize the same bytes, so a public clip and a paid-only one would
 * share a content hash and the dist scan would flag the public one as the paid file (critique O5).
 */
function distinctTones(ns: 'bgm' | 'sfx', clips: Readonly<Record<string, CatalogAudio>>, report: Report): void {
  const first = new Map<number, string>();
  for (const [id, clip] of Object.entries(clips)) {
    if (!('placeholder' in clip)) {
      continue;
    }
    const hz = clip.placeholder.hz;
    const owner = first.get(hz);
    if (owner === undefined) {
      first.set(hz, id);
    } else {
      report(`${ns}.${id}.placeholder.hz`, `${hz} Hz is also ${ns}/${owner}'s: two placeholders of one role would be the same bytes`);
    }
  }
}

function characters(value: unknown, report: Report): Record<string, { exprs: Record<string, CatalogImage> }> {
  const out: Record<string, { exprs: Record<string, CatalogImage> }> = {};
  if (!isObject(value)) {
    report('chars', 'not an object');
    return out;
  }
  for (const [id, entry] of Object.entries(value)) {
    const path = `chars.${id}`;
    const problem = idProblem(id);
    if (problem !== null) {
      report(path, problem);
      continue;
    }
    if (!isObject(entry)) {
      report(path, 'entry is not an object');
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (key !== 'exprs') {
        report(`${path}.${key}`, "unknown key (a character holds only 'exprs')");
      }
    }
    if (!Object.hasOwn(entry, 'exprs')) {
      report(`${path}.exprs`, 'missing: a character needs at least one expression');
      continue;
    }
    const exprs = entries(entry['exprs'], `${path}.exprs`, report, imageEntry);
    if (isObject(entry['exprs']) && Object.keys(entry['exprs']).length === 0) {
      report(`${path}.exprs`, 'empty: a character needs at least one expression');
    }
    out[id] = { exprs };
  }
  return out;
}

/** Decodes assets/catalog.json; every problem is reported, never only the first. */
export function decodeAssetCatalog(raw: unknown): Result<AssetCatalog, CatalogIssue[]> {
  const issues: CatalogIssue[] = [];
  const report: Report = (path, detail) => issues.push({ file: 'assets/catalog.json', path, detail });
  if (!isObject(raw)) {
    report('', 'not a JSON object');
    return { ok: false, error: issues };
  }
  for (const key of Object.keys(raw)) {
    if (!(NAMESPACES as readonly string[]).includes(key)) {
      report(key, `unknown top-level key (expected ${NAMESPACES.join(', ')})`);
    }
  }
  const field = (ns: Namespace): unknown => {
    if (!Object.hasOwn(raw, ns)) {
      report(ns, 'missing');
      return {};
    }
    return raw[ns];
  };
  const bg = entries(field('bg'), 'bg', report, imageEntry);
  const chars = characters(field('chars'), report);
  const cg = entries(field('cg'), 'cg', report, imageEntry);
  const bgm = entries(field('bgm'), 'bgm', report, audioEntry);
  const sfx = entries(field('sfx'), 'sfx', report, audioEntry);
  const prop = entries(field('prop'), 'prop', report, imageEntry);
  const cover = entries(field('cover'), 'cover', report, imageEntry);
  distinctTones('bgm', bgm, report);
  distinctTones('sfx', sfx, report);
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  // The brands are earned here: every key passed ID_RE and the reserved-word check above.
  const value = { bg, chars, cg, bgm, sfx, prop, cover } as AssetCatalog;
  return { ok: true, value };
}

/** Decodes story/cast.json against a decoded catalog: exactly `{ char }` per speaker, the char in `catalog.chars`. */
export function decodeCast(raw: unknown, catalog: AssetCatalog): Result<Cast, CatalogIssue[]> {
  const issues: CatalogIssue[] = [];
  const report: Report = (path, detail) => issues.push({ file: 'story/cast.json', path, detail });
  if (!isObject(raw)) {
    report('', 'not a JSON object');
    return { ok: false, error: issues };
  }
  const out: Record<string, { char: CharId | null }> = {};
  for (const [speaker, entry] of Object.entries(raw)) {
    if (!ID_RE.test(speaker)) {
      report(speaker, `'${speaker}' is not a speaker id [a-z][a-z0-9_]*`);
      continue;
    }
    if (!isObject(entry)) {
      report(speaker, 'entry is not an object');
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (key !== 'char') {
        report(`${speaker}.${key}`, "unknown key (a speaker holds only 'char')");
      }
    }
    const char = entry['char'];
    if (!Object.hasOwn(entry, 'char')) {
      report(`${speaker}.char`, 'missing');
    } else if (char === null) {
      out[speaker] = { char: null };
    } else if (typeof char !== 'string') {
      report(`${speaker}.char`, 'must be a character id or null');
    } else if (!Object.hasOwn(catalog.chars, char)) {
      report(`${speaker}.char`, `character '${char}' is not in assets/catalog.json chars`);
    } else {
      out[speaker] = { char: char as CharId }; // the brand is earned by the catalog lookup above
    }
  }
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  return { ok: true, value: out as Cast }; // every key passed ID_RE above
}

/** The AssetIndex of a decoded catalog. Own-property lookups only: inherited names are never assets. */
export function assetIndex(c: AssetCatalog): AssetIndex {
  return {
    hasBg: (id) => Object.hasOwn(c.bg, id),
    hasChar: (id) => Object.hasOwn(c.chars, id),
    hasExpr: (char, expr) => {
      if (!Object.hasOwn(c.chars, char)) {
        return false;
      }
      const entry = c.chars[char as CharId]; // an own key, checked on the line above
      return entry !== undefined && Object.hasOwn(entry.exprs, expr);
    },
    hasCg: (id) => Object.hasOwn(c.cg, id),
    hasTrack: (id) => Object.hasOwn(c.bgm, id),
    hasSfx: (id) => Object.hasOwn(c.sfx, id),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Story build outputs (L3b): the chapter list as the story tool reads it, the public chapter catalog and the
// per-chapter meta. The client decodes the outputs at load; they are never trusted blindly.

/** One chapter of story/chapters.json (STAGING-DSL §9), in play order; `entry` is story-relative posix. */
export type ChapterListEntry = { id: ChapterId; entry: string; paid: boolean; productId: ProductId | null; next: ChapterId | null };
/** client/src/story-gen/catalog.json (public): chapters, titles and cast names; no paid content. */
export type ChapterCatalog = {
  chapters: ReadonlyArray<{
    id: ChapterId;
    paid: boolean;
    productId: ProductId | null;
    next: ChapterId | null;
    title: { ru: string; en: string };
  }>;
  cast: Record<SpeakerId, { char: CharId | null; name: { ru: string; en: string } }>;
};
/** A carry value: DSL v1 globals are scalars (STAGING-DSL §9). */
export type InkScalar = number | boolean | string;
/** `<ch>.meta.json`: the chapter's knot index (STAGING-DSL §8) and what a resume needs. */
export type ChapterMeta = {
  chapterId: ChapterId;
  /** sha256 of the exact story.json bytes, hex, first 16 chars. */
  storyVersion: StoryVersion;
  firstKnot: KnotName;
  /** The carry set (every g_ VAR). */
  globals: readonly VarName[];
  /** Every VAR the story declares (for checkpoint restore). */
  vars: readonly VarName[];
  /** ending: a `-> END` divert is written in the knot. */
  knots: Record<KnotName, { assets: readonly AssetId[]; next: readonly KnotName[]; ending: boolean }>;
};

/** STAGING-DSL §9: `ch<N>`. */
export const CHAPTER_ID_RE = /^ch[1-9][0-9]*$/;
/** `chapter:ch2` (server/src/ids.rs `ProductId`): a kind and a name. */
const PRODUCT_ID_RE = /^[a-z][a-z0-9_]*:[a-z0-9_]+$/;
/** STAGING-DSL §10 `ink/name`. */
export const KNOT_NAME_RE = /^[a-z][a-z0-9_]*$/;
const VAR_NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;
/**
 * STAGING-DSL §8: `bg/<bg>`, `char/<char>/<expr>`, `cg/<cg>`, `bgm/<track>`, `sfx/<sfx>`, `prop/<prop>` (PUZZLES-PLAN
 * X11), `cover/<cover>` (STORIES-PLAN Y15).
 */
export const ASSET_ID_RE = /^(?:(?:bg|cg|bgm|sfx|prop|cover)\/[a-z][a-z0-9_]*|char\/[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*)$/;
const STORY_VERSION_RE = /^[0-9a-f]{16}$/;

/** Reports every key of `value` that is not in `keys`, and every key of `keys` that is missing. */
function exactKeys(value: Raw, keys: readonly string[], path: string, report: Report): void {
  const at = (key: string): string => (path === '' ? key : `${path}.${key}`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      report(at(key), `unknown key (expected ${keys.join(', ')})`);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      report(at(key), 'missing');
    }
  }
}

/** A string matching `re`, else reported; `nullable` admits null. */
function matching(value: unknown, re: RegExp, path: string, report: Report, nullable = false): string | null {
  if (nullable && value === null) {
    return null;
  }
  if (typeof value !== 'string' || !re.test(value)) {
    report(path, `${JSON.stringify(value) ?? 'undefined'} does not match ${re.source}${nullable ? ' (or null)' : ''}`);
    return null;
  }
  return value;
}

function stringList(value: unknown, re: RegExp, path: string, report: Report): string[] {
  if (!Array.isArray(value)) {
    report(path, 'not an array');
    return [];
  }
  return value.flatMap((v: unknown, i) => matching(v, re, `${path}.${i}`, report) ?? []);
}

function names(value: unknown, path: string, report: Report): { ru: string; en: string } {
  if (!isObject(value)) {
    report(path, 'not an object');
    return { ru: '', en: '' };
  }
  exactKeys(value, ['ru', 'en'], path, report);
  const ru = value['ru'];
  const en = value['en'];
  if (typeof ru !== 'string' || typeof en !== 'string') {
    report(path, 'ru and en must be strings');
    return { ru: '', en: '' };
  }
  return { ru, en };
}

/**
 * Decodes story/chapters.json (STAGING-DSL §9, §11 `catalog/chapters`): a non-empty array in play order; ids `ch<N>`,
 * unique; `entry` is `<id>/main.ink` (the lint's paid-directory isolation keys on the entry's directory); `paid`
 * requires a `productId`, a free chapter has none, and no two chapters share one (each product unlocks one chapter);
 * `next` is a listed id or null. Whether the entry file exists is the story tool's check.
 */
export function decodeChapterList(raw: unknown): Result<readonly ChapterListEntry[], CatalogIssue[]> {
  const issues: CatalogIssue[] = [];
  const report: Report = (path, detail) => issues.push({ file: 'story/chapters.json', path, detail });
  if (!Array.isArray(raw)) {
    report('', 'not a JSON array of chapters');
    return { ok: false, error: issues };
  }
  if (raw.length === 0) {
    report('', '0 chapters: a run that compiles no chapter is an error, not a green');
    return { ok: false, error: issues };
  }
  const out: ChapterListEntry[] = [];
  const nexts: Array<readonly [path: string, next: string]> = [];
  raw.forEach((entry: unknown, i) => {
    const path = String(i);
    if (!isObject(entry)) {
      report(path, 'not an object');
      return;
    }
    for (const key of Object.keys(entry).filter((k) => !['id', 'entry', 'paid', 'productId', 'next'].includes(k))) {
      report(`${path}.${key}`, 'unknown key (expected id, entry, paid, productId, next)');
    }
    for (const key of ['id', 'entry', 'paid', 'next'].filter((k) => !Object.hasOwn(entry, k))) {
      report(`${path}.${key}`, 'missing');
    }
    const id = matching(entry['id'], CHAPTER_ID_RE, `${path}.id`, report);
    if (id !== null && out.some((c) => c.id === id)) {
      report(`${path}.id`, `duplicate id '${id}'`);
    }
    if (id !== null && entry['entry'] !== `${id}/main.ink`) {
      report(`${path}.entry`, `${JSON.stringify(entry['entry']) ?? 'undefined'}: the entry of ${id} is '${id}/main.ink' (§9 layout)`);
    }
    const paid = entry['paid'];
    if (typeof paid !== 'boolean') {
      report(`${path}.paid`, 'not a boolean');
    }
    const hasProduct = Object.hasOwn(entry, 'productId');
    if (paid === true && !hasProduct) {
      report(`${path}.productId`, 'a paid chapter needs a productId');
    }
    if (paid !== true && hasProduct) {
      report(`${path}.productId`, 'a free chapter has no productId');
    }
    const productId = paid === true && hasProduct ? matching(entry['productId'], PRODUCT_ID_RE, `${path}.productId`, report) : null;
    if (productId !== null && out.some((c) => c.productId === productId)) {
      report(`${path}.productId`, `duplicate product '${productId}': one product unlocks one chapter`);
    }
    const next = Object.hasOwn(entry, 'next') ? matching(entry['next'], CHAPTER_ID_RE, `${path}.next`, report, true) : null;
    if (next !== null) {
      nexts.push([`${path}.next`, next]);
    }
    if (id !== null && typeof paid === 'boolean') {
      // The brands are earned by the patterns above.
      out.push({ id: id as ChapterId, entry: `${id}/main.ink`, paid, productId: productId as ProductId | null, next: next as ChapterId | null });
    }
  });
  for (const [path, next] of nexts) {
    if (!out.some((c) => c.id === next)) {
      report(path, `'${next}' is not a listed chapter`);
    }
  }
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  return { ok: true, value: out };
}

/** Decodes client/src/story-gen/catalog.json; every problem is reported. */
export function decodeChapterCatalog(raw: unknown): Result<ChapterCatalog, CatalogIssue[]> {
  const issues: CatalogIssue[] = [];
  const report: Report = (path, detail) => issues.push({ file: 'story-gen/catalog.json', path, detail });
  if (!isObject(raw)) {
    report('', 'not a JSON object');
    return { ok: false, error: issues };
  }
  exactKeys(raw, ['chapters', 'cast'], '', report);
  const chapters: Array<ChapterCatalog['chapters'][number]> = [];
  const list = raw['chapters'];
  if (!Array.isArray(list)) {
    report('chapters', 'not an array');
  } else {
    list.forEach((entry: unknown, i) => {
      const path = `chapters.${i}`;
      if (!isObject(entry)) {
        report(path, 'not an object');
        return;
      }
      exactKeys(entry, ['id', 'paid', 'productId', 'next', 'title'], path, report);
      const id = matching(entry['id'], CHAPTER_ID_RE, `${path}.id`, report);
      const productId = matching(entry['productId'], PRODUCT_ID_RE, `${path}.productId`, report, true);
      const next = matching(entry['next'], CHAPTER_ID_RE, `${path}.next`, report, true);
      const paid = entry['paid'];
      if (typeof paid !== 'boolean') {
        report(`${path}.paid`, 'not a boolean');
      }
      const title = names(entry['title'], `${path}.title`, report);
      if (id !== null && typeof paid === 'boolean') {
        // The brands are earned by the patterns above.
        chapters.push({ id: id as ChapterId, paid, productId: productId as ProductId | null, next: next as ChapterId | null, title });
      }
    });
  }
  const cast: Record<string, { char: CharId | null; name: { ru: string; en: string } }> = {};
  const people = raw['cast'];
  if (!isObject(people)) {
    report('cast', 'not an object');
  } else {
    for (const [speaker, entry] of Object.entries(people)) {
      const path = `cast.${speaker}`;
      if (!ID_RE.test(speaker)) {
        report(path, `'${speaker}' is not a speaker id [a-z][a-z0-9_]*`);
      } else if (!isObject(entry)) {
        report(path, 'not an object');
      } else {
        exactKeys(entry, ['char', 'name'], path, report);
        const char = matching(entry['char'], ID_RE, `${path}.char`, report, true);
        cast[speaker] = { char: char as CharId | null, name: names(entry['name'], `${path}.name`, report) };
      }
    }
  }
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  return { ok: true, value: { chapters, cast } }; // every speaker key passed ID_RE above
}

/** Decodes a `<ch>.meta.json`; also checks that `firstKnot` and every `next` name a knot of the index. */
export function decodeChapterMeta(raw: unknown): Result<ChapterMeta, CatalogIssue[]> {
  const issues: CatalogIssue[] = [];
  const report: Report = (path, detail) => issues.push({ file: 'meta.json', path, detail });
  if (!isObject(raw)) {
    report('', 'not a JSON object');
    return { ok: false, error: issues };
  }
  exactKeys(raw, ['chapterId', 'storyVersion', 'firstKnot', 'globals', 'vars', 'knots'], '', report);
  const chapterId = matching(raw['chapterId'], CHAPTER_ID_RE, 'chapterId', report);
  const storyVersion = matching(raw['storyVersion'], STORY_VERSION_RE, 'storyVersion', report);
  const firstKnot = matching(raw['firstKnot'], KNOT_NAME_RE, 'firstKnot', report);
  const globals = stringList(raw['globals'], VAR_NAME_RE, 'globals', report);
  const vars = stringList(raw['vars'], VAR_NAME_RE, 'vars', report);
  for (const g of globals.filter((name) => !vars.includes(name))) {
    report('globals', `'${g}' is not in vars`);
  }
  const knots: Record<string, { assets: readonly AssetId[]; next: readonly KnotName[]; ending: boolean }> = {};
  const index = raw['knots'];
  if (!isObject(index)) {
    report('knots', 'not an object');
  } else {
    for (const [name, entry] of Object.entries(index)) {
      const path = `knots.${name}`;
      if (!KNOT_NAME_RE.test(name)) {
        report(path, `'${name}' is not a knot name [a-z][a-z0-9_]*`);
      } else if (!isObject(entry)) {
        report(path, 'not an object');
      } else {
        exactKeys(entry, ['assets', 'next', 'ending'], path, report);
        const ending = entry['ending'];
        if (typeof ending !== 'boolean') {
          report(`${path}.ending`, 'not a boolean');
        }
        knots[name] = {
          // The brands are earned by the patterns `stringList` checks.
          assets: stringList(entry['assets'], ASSET_ID_RE, `${path}.assets`, report) as AssetId[],
          next: stringList(entry['next'], KNOT_NAME_RE, `${path}.next`, report) as KnotName[],
          ending: ending === true,
        };
      }
    }
    for (const [name, knot] of Object.entries(knots)) {
      for (const n of knot.next.filter((k) => !Object.hasOwn(knots, k))) {
        report(`knots.${name}.next`, `'${n}' is not a knot of this index`);
      }
    }
    if (firstKnot !== null && !Object.hasOwn(knots, firstKnot)) {
      report('firstKnot', `'${firstKnot}' is not a knot of this index`);
    }
  }
  if (issues.length > 0 || chapterId === null || storyVersion === null || firstKnot === null) {
    return { ok: false, error: issues };
  }
  // The brands are earned by the patterns above.
  return {
    ok: true,
    value: {
      chapterId: chapterId as ChapterId,
      storyVersion: storyVersion as StoryVersion,
      firstKnot: firstKnot as KnotName,
      globals: globals as VarName[],
      vars: vars as VarName[],
      knots,
    },
  };
}
