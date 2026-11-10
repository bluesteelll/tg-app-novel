// The shot list (docs/plans/shots §2.1-2.4, lane SH2): story/shots.json decoded against the asset catalog, the
// effective catalog (a declared shot without a catalog bg gets an implied placeholder, so `parseTags` accepts it) and
// the effective shots (a catalog bg the list does not declare is an implied cast-less shot, `frame: room` where a world
// room names it). Pure, no node:*: the story tool reads the file and hands the parsed JSON in.
import type { AssetCatalog, Result } from '../../../src/story/catalog.ts';
import type { BgId, CharId, ExprId } from '../../../src/story/staging.ts';
import type { WorldPublicBody } from '../../../src/world/types.ts';

/** The shot list, repo-relative (its findings name it). */
export const SHOTS_FILE = 'story/shots.json';

/** A location: the shots of one scene share it (§2.2, `shot/loc-change`). A local brand: staging.ts names none. */
export type LocId = string & { readonly __brand: 'LocId' };
export const FRAMES = ['wide', 'medium', 'close', 'ots', 'two', 'insert', 'room'] as const;
export type Frame = (typeof FRAMES)[number];
export const VIEWS = ['face', 'back'] as const;
/** `face`: the face is visible, so its states can change; `back`: a back or shoulder, hair locks only (§2.1). */
export type View = (typeof VIEWS)[number];
/** One cast member of a shot; `figure`: the whole figure is cut out as a plane (`anim: hop | bounce` need it). */
export type CastMember = { readonly char: CharId; readonly view: View; readonly rest: ExprId; readonly figure: boolean };
/** A shot; `cast` is in draw order, back to front (§2.1). */
export type Shot = { readonly id: BgId; readonly loc: LocId; readonly frame: Frame; readonly cast: readonly CastMember[] };
/** A location with its light note (the owner's art direction; null until written). */
export type Loc = { readonly id: LocId; readonly light: string | null };
export type ShotList = { readonly locs: readonly Loc[]; readonly shots: readonly Shot[] };
/** A shot of the effective list: declared in story/shots.json, or implied by a catalog bg the list lacks (cast-less). */
export type EffectiveShot = Shot & { readonly declared: boolean };

const ID_RE = /^[a-z][a-z0-9_]*$/;

type Raw = Readonly<Record<string, unknown>>;

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every key of `v` outside `keys` and `optional`, and every missing key of `keys`, as issues. */
function keysExactly(v: Raw, keys: readonly string[], path: string, issues: string[], optional: readonly string[] = []): void {
  const known = [...keys, ...optional];
  for (const k of Object.keys(v).filter((x) => !known.includes(x))) {
    issues.push(`${path}.${k}: unknown key (expected ${known.join(', ')})`);
  }
  for (const k of keys.filter((x) => !Object.hasOwn(v, x))) {
    issues.push(`${path}.${k}: missing`);
  }
}

/** An id-shaped string at `path`, or null with an issue. */
function idAt(v: unknown, path: string, issues: string[]): string | null {
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    issues.push(`${path}: ${JSON.stringify(v) ?? 'undefined'} is not an id [a-z][a-z0-9_]*`);
    return null;
  }
  return v;
}

/** The array at `key` of `raw`, or [] with an issue (a missing key is keysExactly's). */
function arrayAt(raw: Raw, key: string, issues: string[]): readonly unknown[] {
  const v = raw[key];
  if (v === undefined) {
    return [];
  }
  if (!Array.isArray(v)) {
    issues.push(`${key}: not an array`);
    return [];
  }
  return v;
}

function decodeLocs(raw: Raw, issues: string[]): Loc[] {
  const out: Loc[] = [];
  const seen = new Set<string>();
  arrayAt(raw, 'locs', issues).forEach((entry, i) => {
    const path = `locs.${i}`;
    if (!isObject(entry)) {
      issues.push(`${path}: not an object`);
      return;
    }
    keysExactly(entry, ['id', 'light'], path, issues);
    const id = idAt(entry['id'], `${path}.id`, issues);
    const light = entry['light'];
    if (light !== null && typeof light !== 'string') {
      issues.push(`${path}.light: not a string or null`);
    }
    if (id === null) {
      return;
    }
    if (seen.has(id)) {
      issues.push(`${path}.id: duplicate location '${id}'`);
      return;
    }
    seen.add(id);
    out.push({ id: id as LocId, light: typeof light === 'string' ? light : null }); // an id-shaped, unique string
  });
  return out;
}

function decodeCast(raw: unknown, path: string, catalog: AssetCatalog, issues: string[]): CastMember[] {
  if (!Array.isArray(raw)) {
    issues.push(`${path}: not an array`);
    return [];
  }
  const out: CastMember[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, i) => {
    const at = `${path}.${i}`;
    if (!isObject(entry)) {
      issues.push(`${at}: not an object`);
      return;
    }
    keysExactly(entry, ['char', 'view', 'rest'], at, issues, ['figure']);
    const char = idAt(entry['char'], `${at}.char`, issues);
    const known = char !== null && Object.hasOwn(catalog.chars, char);
    if (char !== null && !known) {
      issues.push(`${at}.char: '${char}' is not a character of assets/catalog.json`);
    }
    if (char !== null && seen.has(char)) {
      issues.push(`${at}.char: '${char}' is twice in the cast`);
    }
    const view = entry['view'];
    const okView = VIEWS.find((x) => x === view);
    if (okView === undefined) {
      issues.push(`${at}.view: ${JSON.stringify(view) ?? 'undefined'} is not face or back`);
    }
    const rest = idAt(entry['rest'], `${at}.rest`, issues);
    const exprs = known ? catalog.chars[char as CharId]?.exprs : undefined; // an own key, checked above
    if (rest !== null && exprs !== undefined && !Object.hasOwn(exprs, rest)) {
      issues.push(`${at}.rest: '${rest}' is not an expression of '${char ?? ''}' in assets/catalog.json`);
    }
    const figure = entry['figure'] ?? false;
    if (typeof figure !== 'boolean') {
      issues.push(`${at}.figure: not a boolean`);
    }
    if (char === null || !known || seen.has(char) || okView === undefined || rest === null || exprs === undefined || !Object.hasOwn(exprs, rest)) {
      if (char !== null) {
        seen.add(char);
      }
      return;
    }
    seen.add(char);
    // Each brand is earned above: a catalog character and one of its expressions.
    out.push({ char: char as CharId, view: okView, rest: rest as ExprId, figure: figure === true });
  });
  return out;
}

/**
 * Decodes story/shots.json: exactly `{ "locs": [ { "id", "light" } ], "shots": [ { "id", "loc", "frame", "cast": [ { "char",
 * "view", "rest", "figure"? } ] } ] }`. Every problem is an issue (`shot/list`), never only the first: an unknown or
 * missing key, a wrong type, an id not `[a-z][a-z0-9_]*`, a duplicate location, shot or cast character, a shot's
 * unknown location, a character outside the catalog, a `rest` outside its expressions, a view other than face / back,
 * a frame outside `FRAMES`.
 */
export function decodeShotList(raw: unknown, catalog: AssetCatalog): Result<ShotList, string[]> {
  if (!isObject(raw)) {
    return { ok: false, error: ['not a JSON object { "locs": [...], "shots": [...] }'] };
  }
  const issues: string[] = [];
  for (const k of Object.keys(raw).filter((x) => x !== 'locs' && x !== 'shots')) {
    issues.push(`${k}: unknown key (expected locs, shots)`);
  }
  for (const k of ['locs', 'shots'].filter((x) => !Object.hasOwn(raw, x))) {
    issues.push(`${k}: missing`);
  }
  const locs = decodeLocs(raw, issues);
  const locIds = new Set<string>(locs.map((l) => l.id));
  const shots: Shot[] = [];
  const seen = new Set<string>();
  arrayAt(raw, 'shots', issues).forEach((entry, i) => {
    const path = `shots.${i}`;
    if (!isObject(entry)) {
      issues.push(`${path}: not an object`);
      return;
    }
    keysExactly(entry, ['id', 'loc', 'frame', 'cast'], path, issues);
    const id = idAt(entry['id'], `${path}.id`, issues);
    if (id !== null && seen.has(id)) {
      issues.push(`${path}.id: duplicate shot '${id}'`);
    }
    const loc = idAt(entry['loc'], `${path}.loc`, issues);
    if (loc !== null && !locIds.has(loc)) {
      issues.push(`${path}.loc: '${loc}' is not a location of locs`);
    }
    const frame = FRAMES.find((f) => f === entry['frame']);
    if (frame === undefined) {
      issues.push(`${path}.frame: ${JSON.stringify(entry['frame']) ?? 'undefined'} is not one of ${FRAMES.join(', ')}`);
    }
    const cast = decodeCast(entry['cast'], `${path}.cast`, catalog, issues);
    if (id === null || seen.has(id) || loc === null || !locIds.has(loc) || frame === undefined) {
      if (id !== null) {
        seen.add(id);
      }
      return;
    }
    seen.add(id);
    shots.push({ id: id as BgId, loc: loc as LocId, frame, cast }); // an id-shaped unique shot id; a declared location
  });
  return issues.length > 0 ? { ok: false, error: issues } : { ok: true, value: { locs, shots } };
}

/** FNV-1a 32 of the id (its code units: ids are `[a-z0-9_]`), mod 360: an implied placeholder's hue (§2.4). */
export function placeholderHue(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

/** The declared shots without a catalog bg (W `shot/implied-placeholder` when used; the art list's "to draw"). */
export function impliedPlaceholders(catalog: AssetCatalog, list: ShotList): BgId[] {
  return list.shots.filter((s) => !Object.hasOwn(catalog.bg, s.id)).map((s) => s.id);
}

/**
 * The catalog the story stages parse against: `catalog` with an implied placeholder `bg` for every declared shot it
 * lacks (§2.4), so a `bg:` / `scene:` naming a declared shot passes `tag/unknown-asset`.
 */
export function effectiveCatalog(catalog: AssetCatalog, list: ShotList): AssetCatalog {
  const implied = impliedPlaceholders(catalog, list);
  if (implied.length === 0) {
    return catalog;
  }
  const bg = { ...catalog.bg };
  for (const id of implied) {
    bg[id] = { placeholder: { hue: placeholderHue(id) } };
  }
  return { ...catalog, bg };
}

/** Every bg a room of the worlds names (§2.3: such a bg is an implied `frame: room` shot). */
function roomBgs(worlds: readonly WorldPublicBody[]): Set<string> {
  return new Set(worlds.flatMap((w) => Object.values(w.sections).flatMap((s) => Object.values(s.rooms).map((r) => r.bg))));
}

/**
 * Every shot by id: the declared ones, then one implied cast-less shot per bg of `catalog` (the effective catalog)
 * the list does not declare, `frame: room` when a room of some listed chapter's world names it, else `wide`; its
 * `loc` is its id (§2.4, W `shot/undeclared` when used).
 */
export function effectiveShots(catalog: AssetCatalog, list: ShotList, worlds: readonly WorldPublicBody[]): ReadonlyMap<BgId, EffectiveShot> {
  const out = new Map<BgId, EffectiveShot>(list.shots.map((s) => [s.id, { ...s, declared: true }]));
  const rooms = roomBgs(worlds);
  for (const id of Object.keys(catalog.bg) as BgId[]) {
    // keys of the decoded catalog
    if (!out.has(id)) {
      out.set(id, { id, loc: id as string as LocId, frame: rooms.has(id) ? 'room' : 'wide', cast: [], declared: false });
    }
  }
  return out;
}
