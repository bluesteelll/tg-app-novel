// The asset catalog (assets/catalog.json) and the cast (story/cast.json): types, decoders and the AssetIndex that
// parseTags reads. Decoded at the edge, never trusted blindly; every lookup is an own-property lookup, so a tag
// naming `constructor` is an unknown asset, not Object.prototype's. L3b and L5 append their parts of this module.
import type { AssetIndex, BgId, CgId, CharId, ExprId, SfxId, SpeakerId, TrackId } from './staging.ts';

/** PROTOTYPE-PLAN.md "Result at module edges", verbatim. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** One problem in a catalog file; `path` is the dotted JSON path ('' = the whole file). */
export type CatalogIssue = { file: 'assets/catalog.json' | 'story/cast.json'; path: string; detail: string };
/** Opaque here; L5 defines the source / placeholder / size fields and makes them required. */
export type CatalogEntry = Readonly<Record<string, unknown>>;
/** STAGING-DSL §8: one namespace per kind; a character's expressions are a map, one asset each. */
export type AssetCatalog = {
  bg: Readonly<Record<BgId, CatalogEntry>>;
  chars: Readonly<Record<CharId, { exprs: Readonly<Record<ExprId, CatalogEntry>> }>>;
  cg: Readonly<Record<CgId, CatalogEntry>>;
  bgm: Readonly<Record<TrackId, CatalogEntry>>;
  sfx: Readonly<Record<SfxId, CatalogEntry>>;
};
/** STAGING-DSL §5: speaker → sprite character (or none). */
export type Cast = Readonly<Record<SpeakerId, { char: CharId | null }>>;

/** STAGING-DSL §2: the words a tag uses in an id slot (`hide: all`, `cg: off`, `bgm: stop`); never an asset id. */
export const RESERVED_IDS = ['all', 'off', 'stop'] as const;

// §8 asset names and §5 speaker ids share one shape. It also rules out `__proto__`, the one key whose assignment
// would set a prototype instead of an own property.
const ID_RE = /^[a-z][a-z0-9_]*$/;
const NAMESPACES = ['bg', 'chars', 'cg', 'bgm', 'sfx'] as const;
type Namespace = (typeof NAMESPACES)[number];

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

/** The well-formed `id → entry` pairs of one object; every other key is reported. */
function entries(value: unknown, path: string, report: Report): Record<string, CatalogEntry> {
  const out: Record<string, CatalogEntry> = {};
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
      out[id] = entry;
    }
  }
  return out;
}

function characters(value: unknown, report: Report): Record<string, { exprs: Record<string, CatalogEntry> }> {
  const out: Record<string, { exprs: Record<string, CatalogEntry> }> = {};
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
    const exprs = entries(entry['exprs'], `${path}.exprs`, report);
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
  const bg = entries(field('bg'), 'bg', report);
  const chars = characters(field('chars'), report);
  const cg = entries(field('cg'), 'cg', report);
  const bgm = entries(field('bgm'), 'bgm', report);
  const sfx = entries(field('sfx'), 'sfx', report);
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  // The brands are earned here: every key passed ID_RE and the reserved-word check above.
  const value = { bg, chars, cg, bgm, sfx } as AssetCatalog;
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
