// The one decoder of world JSON (docs/PUZZLES-PLAN.md "World data", X7): the source `story/<ch>/world.json` and the
// public world the client loads, plus the two projections the story tool emits from a decoded source. Every issue is
// reported once, never the first only (lint `world/schema`). Keys are strict: an unknown key is an issue, and every
// key of the format is required except `take.then` and `lock.onOpen` (default []). References between ids (an exit's
// room, a slot's item) are not resolved here: that is `world/unknown-ref` (LW3). Pure (X4).
import { PUZZLE_RULES, isPuzzleType } from '../puzzles/rules/index.ts';
import type { CodeParams } from '../puzzles/rules/code.ts';
import type { PuzzleType } from '../puzzles/rules/index.ts';
import type { OrderParams } from '../puzzles/rules/order.ts';
import { KNOT_NAME_RE } from '../story/catalog.ts';
import type { Result } from '../story/catalog.ts';
import type {
  BgId,
  CgId,
  ChapterId,
  KnotName,
  LineId,
  PropId,
  PuzzleLocalId,
  Rect,
  SectionId,
  SfxId,
  TrackId,
} from '../story/staging.ts';
import { LINE_ID_RE } from '../story/tags.ts';
import { GLYPHS } from './types.ts';
import type {
  Doc,
  DocId,
  Effect,
  ExitTarget,
  Gift,
  Glyph,
  HintTiers,
  Hotspot,
  HotspotId,
  HotspotKey,
  Item,
  ItemId,
  Lock,
  LockSlot,
  PublicPuzzle,
  PuzzleBody,
  Room,
  RoomId,
  Section,
  ServerPuzzle,
  ServerPuzzleContent,
  SourcePuzzle,
  WorldPublic,
  WorldPublicBody,
  WorldSource,
  WorldText,
} from './types.ts';

/**
 * One problem in a world file; `path` is the dotted JSON path ('' = the whole file). LW3 maps the reason to a lint
 * code: 'line-id' → `id/missing` / `id/format`, 'hint-count' → `world/hint-count`, every other reason →
 * `world/schema`. 'secret' is a `solution` / `hints` key in a public world (X7).
 */
export type WorldIssue = {
  path: string;
  reason: 'shape' | 'id' | 'line-id' | 'range' | 'hint-count' | 'secret';
  detail: string;
};

type Raw = Readonly<Record<string, unknown>>;
type Reason = WorldIssue['reason'];
type Report = (path: string, reason: Reason, detail: string) => void;
/** A decoder returns undefined exactly when it reported at least one issue; null is a valid value of its own. */
type Decoder<T> = (v: unknown, path: string, report: Report) => T | undefined;

// PUZZLES-PLAN "Identifiers"; the same pattern as story/catalog.ts's private one. It rules out `__proto__`.
const ID_RE = /^[a-z][a-z0-9_]*$/;
const HOTSPOT_KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
/** X9 "World version": sha256, first 16 hex. */
const VERSION_RE = /^[0-9a-f]{16}$/;
const MAX_ATTEMPTS = 9;
const MAX_HINTS = 3;
const SECRET_KEYS = ['solution', 'hints'] as const;

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function at(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

function show(v: unknown): string {
  return JSON.stringify(v) ?? 'undefined';
}

/** Reports every unknown key and every missing required key; false when any was reported. */
function exactKeys(
  value: Raw,
  required: readonly string[],
  path: string,
  report: Report,
  optional: readonly string[] = [],
  secret: readonly string[] = [],
): boolean {
  let ok = true;
  for (const key of Object.keys(value)) {
    if (secret.includes(key)) {
      report(at(path, key), 'secret', `'${key}' is server-only: a public world carries hintTiers instead (X7)`);
      ok = false;
    } else if (!required.includes(key) && !optional.includes(key)) {
      report(at(path, key), 'shape', `unknown key (expected ${[...required, ...optional].join(', ')})`);
      ok = false;
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      report(at(path, key), 'shape', 'missing');
      ok = false;
    }
  }
  return ok;
}

/** `value[key]` through `decode`; a missing key yields undefined silently, because exactKeys reported it. */
function field<T>(value: Raw, key: string, path: string, report: Report, decode: Decoder<T>): T | undefined {
  return Object.hasOwn(value, key) ? decode(value[key], at(path, key), report) : undefined;
}

/** A string matching `re`, typed as the brand whose whole contract that pattern is. */
function matching<T extends string>(re: RegExp, reason: Reason = 'id'): Decoder<T> {
  return (v, path, report) => {
    if (typeof v !== 'string' || !re.test(v)) {
      report(path, reason, `${show(v)} does not match ${re.source}`);
      return undefined;
    }
    return v as T; // checked against the brand's pattern on the line above
  };
}

function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (v, path, report) => (v === null ? null : decode(v, path, report));
}

function list<T>(item: Decoder<T>): Decoder<T[]> {
  return (v, path, report) => {
    if (!Array.isArray(v)) {
      report(path, 'shape', 'not an array');
      return undefined;
    }
    const out: T[] = [];
    let ok = true;
    v.forEach((entry: unknown, i) => {
      const decoded = item(entry, at(path, i), report);
      if (decoded === undefined) {
        ok = false;
      } else {
        out.push(decoded);
      }
    });
    return ok ? out : undefined;
  };
}

/** An object keyed by ids: every key must be id-shaped. */
function record<K extends string, T>(entry: Decoder<T>): Decoder<Record<K, T>> {
  return (v, path, report) => {
    if (!isObject(v)) {
      report(path, 'shape', 'not an object');
      return undefined;
    }
    const out: Record<string, T> = {};
    let ok = true;
    for (const [key, value] of Object.entries(v)) {
      if (!ID_RE.test(key)) {
        report(at(path, key), 'id', `'${key}' is not an id ${ID_RE.source}`);
        ok = false;
        continue;
      }
      const decoded = entry(value, at(path, key), report);
      if (decoded === undefined) {
        ok = false;
      } else {
        out[key] = decoded;
      }
    }
    return ok ? (out as Record<K, T>) : undefined; // every key passed ID_RE, the brand's whole contract
  };
}

/** An object whose only key is one of `kinds`: the key and its value. */
function oneKey(v: unknown, kinds: readonly string[], path: string, report: Report): [string, unknown] | undefined {
  const keys = isObject(v) ? Object.keys(v) : [];
  const [key] = keys;
  if (!isObject(v) || keys.length !== 1 || key === undefined || !kinds.includes(key)) {
    report(path, 'shape', `${show(v)} is not an object with exactly one key of ${kinds.join(', ')}`);
    return undefined;
  }
  return [key, v[key]];
}

const itemId = matching<ItemId>(ID_RE);
const knotName = matching<KnotName>(KNOT_NAME_RE);

function text(missingId: Reason): Decoder<WorldText> {
  return (v, path, report) => {
    if (!isObject(v)) {
      report(path, 'shape', 'not a { id, ru } text');
      return undefined;
    }
    let ok = true;
    for (const key of Object.keys(v)) {
      if (key !== 'id' && key !== 'ru') {
        report(at(path, key), 'shape', 'unknown key (a text has id, ru)');
        ok = false;
      }
    }
    let lineId: LineId | undefined;
    if (Object.hasOwn(v, 'id')) {
      lineId = matching<LineId>(LINE_ID_RE, 'line-id')(v['id'], at(path, 'id'), report);
    } else {
      report(at(path, 'id'), missingId, 'missing: every world text carries a line ID (STAGING-DSL §4)');
    }
    const ru = v['ru'];
    if (typeof ru !== 'string') {
      report(at(path, 'ru'), 'shape', `${show(ru)}: ru must be a string`);
    }
    return ok && lineId !== undefined && typeof ru === 'string' ? { id: lineId, ru } : undefined;
  };
}

const worldText = text('line-id');
const effects = list<Effect>((v, path, report) => {
  const pair = oneKey(v, ['give', 'unlock', 'story'], path, report);
  if (pair === undefined) {
    return undefined;
  }
  const [kind, value] = pair;
  const p = at(path, kind);
  if (kind === 'give') {
    const give = itemId(value, p, report);
    return give === undefined ? undefined : { give };
  }
  if (kind === 'unlock') {
    const unlock = matching<HotspotKey>(HOTSPOT_KEY_RE)(value, p, report);
    return unlock === undefined ? undefined : { unlock };
  }
  const story = knotName(value, p, report);
  return story === undefined ? undefined : { story };
});

const gift: Decoder<Gift> = (v, path, report) => {
  const pair = oneKey(v, ['item', 'doc'], path, report);
  if (pair === undefined) {
    return undefined;
  }
  const [kind, value] = pair;
  if (kind === 'item') {
    const item = itemId(value, at(path, kind), report);
    return item === undefined ? undefined : { item };
  }
  const doc = matching<DocId>(ID_RE)(value, at(path, kind), report);
  return doc === undefined ? undefined : { doc };
};

const exitTarget: Decoder<ExitTarget> = (v, path, report) => {
  const pair = oneKey(v, ['room', 'story'], path, report);
  if (pair === undefined) {
    return undefined;
  }
  const [kind, value] = pair;
  if (kind === 'room') {
    const room = matching<RoomId>(ID_RE)(value, at(path, kind), report);
    return room === undefined ? undefined : { room };
  }
  const story = knotName(value, at(path, kind), report);
  return story === undefined ? undefined : { story };
};

/** Integer source px of the 1080×2048 room space: x, y ≥ 0 and w, h > 0 (the safe frame is `world/hotspot-frame`). */
const rect: Decoder<Rect> = (v, path, report) => {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n: unknown) => typeof n === 'number' && Number.isInteger(n))) {
    report(path, 'shape', `${show(v)} is not [x, y, w, h] in integers`);
    return undefined;
  }
  const [x, y, w, h] = v as [number, number, number, number]; // four integers, checked above
  if (x < 0 || y < 0 || w <= 0 || h <= 0) {
    report(path, 'range', `${show(v)}: x, y must be ≥ 0 and w, h > 0`);
    return undefined;
  }
  return [x, y, w, h];
};

const slot: Decoder<LockSlot> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a { accepts } slot');
    return undefined;
  }
  const keysOk = exactKeys(v, ['accepts'], path, report);
  const accepts = field(v, 'accepts', path, report, itemId);
  return keysOk && accepts !== undefined ? { accepts } : undefined;
};

const lock: Decoder<Lock> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a lock object (or null)');
    return undefined;
  }
  const keysOk = exactKeys(v, ['slots', 'puzzle', 'locked', 'onFail'], path, report, ['onOpen']);
  const slots = field(v, 'slots', path, report, list(slot));
  const puzzle = field(v, 'puzzle', path, report, nullable(matching<PuzzleLocalId>(ID_RE)));
  const locked = field(v, 'locked', path, report, worldText);
  const onOpen = Object.hasOwn(v, 'onOpen') ? field(v, 'onOpen', path, report, effects) : [];
  const onFail = field(v, 'onFail', path, report, effects);
  if (!keysOk || slots === undefined || puzzle === undefined || locked === undefined || onOpen === undefined || onFail === undefined) {
    return undefined;
  }
  return { slots, puzzle, locked, onOpen, onFail };
};

const HOTSPOT_COMMON = ['id', 'kind', 'rect', 'label'] as const;
const propId = nullable(matching<PropId>(ID_RE));

const hotspot: Decoder<Hotspot> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a hotspot object');
    return undefined;
  }
  const get = <T>(key: string, decode: Decoder<T>): T | undefined => field(v, key, path, report, decode);
  const id = get('id', matching<HotspotId>(ID_RE));
  const r = get('rect', rect);
  const label = get('label', worldText);
  const kind = v['kind'];
  switch (kind) {
    case 'look': {
      const keysOk = exactKeys(v, [...HOTSPOT_COMMON, 'look', 'then'], path, report);
      const look = get('look', worldText);
      const then = get('then', effects);
      return keysOk && id !== undefined && r !== undefined && label !== undefined && look !== undefined && then !== undefined
        ? { id, kind, rect: r, label, look, then }
        : undefined;
    }
    case 'take': {
      const keysOk = exactKeys(v, [...HOTSPOT_COMMON, 'gives', 'prop'], path, report, ['then']);
      const gives = get('gives', gift);
      const prop = get('prop', propId);
      const then = Object.hasOwn(v, 'then') ? get('then', effects) : [];
      return keysOk && id !== undefined && r !== undefined && label !== undefined && gives !== undefined && prop !== undefined && then !== undefined
        ? { id, kind, rect: r, label, gives, prop, then }
        : undefined;
    }
    case 'exit': {
      const keysOk = exactKeys(v, [...HOTSPOT_COMMON, 'to', 'lock', 'sfx'], path, report);
      const to = get('to', exitTarget);
      const lk = get('lock', nullable(lock));
      const sfx = get('sfx', nullable(matching<SfxId>(ID_RE)));
      return keysOk && id !== undefined && r !== undefined && label !== undefined && to !== undefined && lk !== undefined && sfx !== undefined
        ? { id, kind, rect: r, label, to, lock: lk, sfx }
        : undefined;
    }
    case 'object': {
      const keysOk = exactKeys(v, [...HOTSPOT_COMMON, 'lock', 'then', 'look', 'prop'], path, report);
      const lk = get('lock', nullable(lock));
      const then = get('then', effects);
      const look = get('look', nullable(worldText));
      const prop = get('prop', propId);
      return keysOk && id !== undefined && r !== undefined && label !== undefined && lk !== undefined && then !== undefined && look !== undefined && prop !== undefined
        ? { id, kind, rect: r, label, lock: lk, then, look, prop }
        : undefined;
    }
    default:
      report(at(path, 'kind'), 'shape', `${show(kind)} is not look, take, exit or object`);
      return undefined;
  }
};

const room: Decoder<Room> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a room object');
    return undefined;
  }
  const keysOk = exactKeys(v, ['bg', 'title', 'onEnter', 'hotspots'], path, report);
  const bg = field(v, 'bg', path, report, matching<BgId>(ID_RE));
  const title = field(v, 'title', path, report, worldText);
  const onEnter = field(v, 'onEnter', path, report, effects);
  const hotspots = field(v, 'hotspots', path, report, list(hotspot));
  let unique = true;
  // A HotspotKey names one hotspot only while ids are unique within their room.
  hotspots?.forEach((h, i) => {
    if (hotspots.findIndex((o) => o.id === h.id) !== i) {
      report(at(at(at(path, 'hotspots'), i), 'id'), 'id', `hotspot id '${h.id}' repeats in this room`);
      unique = false;
    }
  });
  if (!keysOk || !unique || bg === undefined || title === undefined || onEnter === undefined || hotspots === undefined) {
    return undefined;
  }
  return { bg, title, onEnter, hotspots };
};

const section: Decoder<Section> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a section object');
    return undefined;
  }
  const keysOk = exactKeys(v, ['start', 'bgm', 'rooms'], path, report);
  const start = field(v, 'start', path, report, matching<RoomId>(ID_RE));
  const bgm = field(v, 'bgm', path, report, nullable(matching<TrackId>(ID_RE)));
  const rooms = field(v, 'rooms', path, report, record<RoomId, Room>(room));
  return keysOk && start !== undefined && bgm !== undefined && rooms !== undefined ? { start, bgm, rooms } : undefined;
};

function isGlyph(v: unknown): v is Glyph {
  return GLYPHS.some((g) => g === v);
}

const item: Decoder<Item> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not an item object');
    return undefined;
  }
  const keysOk = exactKeys(v, ['name', 'desc', 'glyph'], path, report);
  const name = field(v, 'name', path, report, worldText);
  const desc = field(v, 'desc', path, report, worldText);
  const glyph = field<Glyph>(v, 'glyph', path, report, (g, p, r) => {
    if (isGlyph(g)) {
      return g;
    }
    r(p, 'shape', `${show(g)} is not one of ${GLYPHS.join(', ')}`);
    return undefined;
  });
  return keysOk && name !== undefined && desc !== undefined && glyph !== undefined ? { name, desc, glyph } : undefined;
};

const doc: Decoder<Doc> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a document object');
    return undefined;
  }
  const keysOk = exactKeys(v, ['title', 'body'], path, report);
  const title = field(v, 'title', path, report, worldText);
  const body = field(v, 'body', path, report, list(worldText));
  return keysOk && title !== undefined && body !== undefined ? { title, body } : undefined;
};

type Typed = { readonly type: 'code'; readonly params: CodeParams } | { readonly type: 'order'; readonly params: OrderParams };
type Common = Omit<PuzzleBody, 'type' | 'params'>;

/** The puzzle body in the format's key order (LW3 hashes the emitted public JSON for `version`, X9). */
function makeBody(t: Typed, c: Common): PuzzleBody {
  const { title, prompt, closeup, maxAttempts, giveUp } = c;
  switch (t.type) {
    case 'code':
      return { type: t.type, title, prompt, closeup, params: t.params, maxAttempts, giveUp };
    case 'order':
      return { type: t.type, title, prompt, closeup, params: t.params, maxAttempts, giveUp };
    default: {
      const never: never = t;
      return never;
    }
  }
}

/** `params` through `PUZZLE_RULES[type].decodeParams` (X17: dials 2..6, pieces 2..5). */
function typedParams(type: PuzzleType): Decoder<Typed> {
  return (v, path, report) => {
    switch (type) {
      case 'code': {
        const r = PUZZLE_RULES.code.decodeParams(v);
        if (r.ok) {
          return { type, params: r.value };
        }
        report(path, 'shape', r.error);
        return undefined;
      }
      case 'order': {
        const r = PUZZLE_RULES.order.decodeParams(v);
        if (r.ok) {
          return { type, params: r.value };
        }
        report(path, 'shape', r.error);
        return undefined;
      }
      default: {
        const never: never = type;
        return never;
      }
    }
  };
}

const maxAttempts: Decoder<number | null> = (v, path, report) => {
  if (v === null) {
    return null;
  }
  if (typeof v !== 'number') {
    report(path, 'shape', `${show(v)} is not a number or null`);
    return undefined;
  }
  if (!Number.isInteger(v) || v < 1 || v > MAX_ATTEMPTS) {
    report(path, 'range', `${show(v)} is not an integer in 1..${MAX_ATTEMPTS}`);
    return undefined;
  }
  return v;
};

const boolean: Decoder<boolean> = (v, path, report) => {
  if (typeof v === 'boolean') {
    return v;
  }
  report(path, 'shape', `${show(v)} is not a boolean`);
  return undefined;
};

const PUZZLE_KEYS = ['type', 'title', 'prompt', 'closeup', 'params', 'maxAttempts', 'giveUp'] as const;

/** The type-independent half of a puzzle (its keys are checked by the caller). */
function puzzleBody(v: Raw, path: string, report: Report): PuzzleBody | undefined {
  const get = <T>(key: string, decode: Decoder<T>): T | undefined => field(v, key, path, report, decode);
  const type = get<PuzzleType>('type', (t, p, r) => {
    if (isPuzzleType(t)) {
      return t;
    }
    r(p, 'shape', `${show(t)} is not code or order`);
    return undefined;
  });
  const typed = type === undefined ? undefined : get('params', typedParams(type));
  const title = get('title', worldText);
  const prompt = get('prompt', worldText);
  const closeup = get('closeup', nullable(matching<CgId>(ID_RE)));
  const attempts = get('maxAttempts', maxAttempts);
  const giveUp = get('giveUp', boolean);
  if (typed === undefined || title === undefined || prompt === undefined || closeup === undefined || attempts === undefined || giveUp === undefined) {
    return undefined;
  }
  return makeBody(typed, { title, prompt, closeup, maxAttempts: attempts, giveUp });
}

const solution: Decoder<number[]> = (v, path, report) => {
  if (Array.isArray(v) && v.every((n: unknown) => typeof n === 'number' && Number.isInteger(n))) {
    return v.map((n: number) => n); // integers, checked above; range and ≠ initial are `world/solution` (LW3)
  }
  report(path, 'shape', `${show(v)} is not an array of integers`);
  return undefined;
};

const hintTexts: Decoder<WorldText[]> = (v, path, report) => {
  if (Array.isArray(v) && v.length > MAX_HINTS) {
    report(path, 'hint-count', `${v.length} hints: at most ${MAX_HINTS} tiers (X18)`);
    return undefined;
  }
  return list(text('hint-count'))(v, path, report);
};

const sourcePuzzle: Decoder<SourcePuzzle> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a puzzle object');
    return undefined;
  }
  const keysOk = exactKeys(v, [...PUZZLE_KEYS, ...SECRET_KEYS], path, report);
  const body = puzzleBody(v, path, report);
  const sol = field(v, 'solution', path, report, solution);
  const hints = field(v, 'hints', path, report, hintTexts);
  return keysOk && body !== undefined && sol !== undefined && hints !== undefined ? { ...body, solution: sol, hints } : undefined;
};

const hintTiers: Decoder<HintTiers> = (v, path, report) => {
  if (v === 0 || v === 1 || v === 2 || v === 3) {
    return v;
  }
  report(path, typeof v === 'number' ? 'range' : 'shape', `${show(v)} is not a hint tier count 0..${MAX_HINTS}`);
  return undefined;
};

const publicPuzzle: Decoder<PublicPuzzle> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a puzzle object');
    return undefined;
  }
  const keysOk = exactKeys(v, [...PUZZLE_KEYS, 'hintTiers'], path, report, [], SECRET_KEYS);
  const body = puzzleBody(v, path, report);
  const tiers = field(v, 'hintTiers', path, report, hintTiers);
  return keysOk && body !== undefined && tiers !== undefined ? { ...body, hintTiers: tiers } : undefined;
};

const TOP_KEYS = ['format', 'items', 'docs', 'puzzles', 'sections'] as const;

type Decoded<P> = Omit<WorldSource, 'puzzles'> & { readonly puzzles: Readonly<Record<PuzzleLocalId, P>> };

function decodeWorld<P>(raw: Raw, puzzle: Decoder<P>, report: Report): Decoded<P> | undefined {
  const get = <T>(key: string, decode: Decoder<T>): T | undefined => field(raw, key, '', report, decode);
  const format = get<1>('format', (f, p, r) => {
    if (f === 1) {
      return f;
    }
    r(p, 'shape', `${show(f)}: the world format is 1`);
    return undefined;
  });
  const items = get('items', record<ItemId, Item>(item));
  const docs = get('docs', record<DocId, Doc>(doc));
  const puzzles = get('puzzles', record<PuzzleLocalId, P>(puzzle));
  const sections = get('sections', record<SectionId, Section>(section));
  if (format === undefined || items === undefined || docs === undefined || puzzles === undefined || sections === undefined) {
    return undefined;
  }
  return { format, items, docs, puzzles, sections };
}

function collect<T>(raw: unknown, decode: (raw: Raw, report: Report) => T | undefined): Result<T, WorldIssue[]> {
  const issues: WorldIssue[] = [];
  const report: Report = (path, reason, detail) => issues.push({ path, reason, detail });
  if (!isObject(raw)) {
    report('', 'shape', 'not a JSON object');
    return { ok: false, error: issues };
  }
  const value = decode(raw, report);
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  if (value === undefined) {
    throw new Error('invariant: a world decoder returns undefined only after reporting an issue');
  }
  return { ok: true, value };
}

/** `story/<ch>/world.json`: puzzles carry `solution` and `hints`. */
export function decodeWorldSource(raw: unknown): Result<WorldSource, WorldIssue[]> {
  return collect(raw, (w, report) => {
    const keysOk = exactKeys(w, TOP_KEYS, '', report);
    const world = decodeWorld(w, sourcePuzzle, report);
    return keysOk ? world : undefined;
  });
}

/** A public world (story-gen or a paid payload): refuses `solution` / `hints`, requires the stamped `version`. */
export function decodeWorldPublic(raw: unknown): Result<WorldPublic, WorldIssue[]> {
  return collect(raw, (w, report): WorldPublic | undefined => {
    const keysOk = exactKeys(w, [...TOP_KEYS, 'version'], '', report);
    const world = decodeWorld(w, publicPuzzle, report);
    const version = field(w, 'version', '', report, matching<string>(VERSION_RE, 'shape'));
    return keysOk && world !== undefined && version !== undefined ? { ...world, version } : undefined;
  });
}

function tiersOf(hints: readonly WorldText[]): HintTiers {
  switch (hints.length) {
    case 0:
    case 1:
    case 2:
    case 3:
      return hints.length;
    default:
      throw new Error('invariant: decodeWorldSource caps hints at 3');
  }
}

/** A decoded record's own entries, keyed by the brand its keys were checked against. */
function entriesOf<K extends string, V>(r: Readonly<Record<K, V>>): Array<[K, V]> {
  return Object.entries(r) as Array<[K, V]>; // the keys of a decoded record are its ids
}

/** The public body (no `version`: LW3's emit stamps it): `solution` and `hints` stripped, the tier count kept. */
export function toPublic(w: WorldSource): WorldPublicBody {
  const puzzles: Record<PuzzleLocalId, PublicPuzzle> = {};
  for (const [pid, p] of entriesOf(w.puzzles)) {
    puzzles[pid] = { ...makeBody(p, p), hintTiers: tiersOf(p.hints) };
  }
  return { format: 1, items: w.items, docs: w.docs, puzzles, sections: w.sections };
}

function answerShape(p: PuzzleBody): { len: number; max: number } {
  switch (p.type) {
    case 'code':
      return PUZZLE_RULES.code.answerShape(p.params);
    case 'order':
      return PUZZLE_RULES.order.answerShape(p.params);
    default: {
      const never: never = p;
      return never;
    }
  }
}

function bilingual(t: WorldText, en: Readonly<Record<LineId, string>>): { ru: string; en: string } {
  // A missing en entry is `loc/missing-en`; the server's startup check needs a non-empty title either way.
  return { ru: t.ru, en: Object.hasOwn(en, t.id) ? (en[t.id] ?? t.ru) : t.ru };
}

/** `server/content/puzzles/<ch>.json`: the answer shape from the type rules, the solution, titles and hints. */
export function toServer(w: WorldSource, en: Readonly<Record<LineId, string>>, chapter: ChapterId): ServerPuzzleContent {
  const puzzles: Record<PuzzleLocalId, ServerPuzzle> = {};
  for (const [pid, p] of entriesOf(w.puzzles)) {
    const shape = answerShape(p);
    puzzles[pid] = {
      type: p.type,
      answerLen: shape.len,
      answerMax: shape.max,
      solution: [...p.solution],
      title: bilingual(p.title, en),
      hints: p.hints.map((h) => bilingual(h, en)),
    };
  }
  return { format: 1, chapterId: chapter, puzzles };
}
