// The one decoder of world JSON (docs/PUZZLES-PLAN.md "World data", X7): the source `story/<ch>/world.json` and the
// public world the client loads, plus the two projections the story tool emits from a decoded source. Every issue is
// reported once, never the first only (lint `world/schema`). Keys are strict: an unknown key is an issue, and every
// key of the format is required except `take.then`, `lock.onOpen` and a source puzzle's `clues` (default []), and the
// world's `renamed` (absent = none).
// The composed decoder (engine plan §3.2): a place (the world, an item, a room, a hotspot, a slot, an effect) also
// admits the keys the data registry's modules own there; each owned value goes to its module's `decode` as an
// `OwnedAt` with its source path, the results to `world.mods`, and `toPublic` writes them back through `encode`. A key
// owned at one place is still unknown at every other.
// References between ids (an exit's room, a slot's item, a clue's fact) are not resolved here: that is
// `world/unknown-ref` (LW3) and `world/clue-reachable` (GM1d). Pure (X4).
import type { DecodeCtx, OwnedAt, Place } from '../mechanics/contract.ts';
import { MECHANIC_DATA } from '../mechanics/data/index.ts';
import type { DataRegistry } from '../mechanics/data/index.ts';
import { PUZZLE_TYPES, puzzleInstance } from '../puzzles/rules/index.ts';
import type { PuzzleTypeData, PuzzleTypes } from '../puzzles/rules/index.ts';
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
  ClueAtom,
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
  Renames,
  Room,
  RoomId,
  Section,
  ServerPuzzle,
  ServerPuzzleContent,
  SourcePuzzle,
  WorldMods,
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
/** A list or record entry's decoder: it also gets the entry's index or key. */
type Entry<T, K> = (v: unknown, path: string, report: Report, key: K) => T | undefined;

/**
 * One decode's view of its data registry (the composed decoder): the keys the modules own at a place, admitted beside
 * the kernel's, and `take`, which hands a place object's owned keys to their modules (`OwnedAt`, in walk order).
 */
type Owners = {
  readonly keys: (place: Place) => readonly string[];
  readonly take: (place: Place, id: string, path: string, v: Raw) => void;
};

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

function list<T>(item: Entry<T, number>): Decoder<T[]> {
  return (v, path, report) => {
    if (!Array.isArray(v)) {
      report(path, 'shape', 'not an array');
      return undefined;
    }
    const out: T[] = [];
    let ok = true;
    v.forEach((entry: unknown, i) => {
      const decoded = item(entry, at(path, i), report, i);
      if (decoded === undefined) {
        ok = false;
      } else {
        out.push(decoded);
      }
    });
    return ok ? out : undefined;
  };
}

/** An object keyed by ids: every key must match `keys` (an id; a hotspot key in `renamed.hotspots`). */
function record<K extends string, T>(entry: Entry<T, K>, keys: RegExp = ID_RE): Decoder<Record<K, T>> {
  return (v, path, report) => {
    if (!isObject(v)) {
      report(path, 'shape', 'not an object');
      return undefined;
    }
    const out: Record<string, T> = {};
    let ok = true;
    for (const [key, value] of Object.entries(v)) {
      if (!keys.test(key)) {
        report(at(path, key), 'id', `'${key}' is not an id ${keys.source}`);
        ok = false;
        continue;
      }
      const decoded = entry(value, at(path, key), report, key as K); // it passed `keys`, the brand's whole contract
      if (decoded === undefined) {
        ok = false;
      } else {
        out[key] = decoded;
      }
    }
    return ok ? (out as Record<K, T>) : undefined; // every key passed `keys`, the brand's whole contract
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

/**
 * A trigger's effects. An effect whose one key a module owns goes to that module as `<trigger>#<its source index>` and
 * stays out of the kernel's list, which keeps the source order of the rest; issue paths keep source indices.
 */
function effects(o: Owners, trigger: string): Decoder<Effect[]> {
  const own = o.keys('effect');
  const decode = list<Effect | null>((v, path, report, j) => {
    const pair = oneKey(v, ['give', 'unlock', 'story', ...own], path, report);
    if (pair === undefined) {
      return undefined;
    }
    const [kind, value] = pair;
    const p = at(path, kind);
    if (own.includes(kind)) {
      o.take('effect', `${trigger}#${j}`, path, { [kind]: value });
      return null;
    }
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
  return (v, path, report) => decode(v, path, report)?.filter((e) => e !== null);
}

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

/** A slot of the lock of hotspot `key`; its id is `<key>#<index>`. */
function slot(o: Owners, key: string): Entry<LockSlot, number> {
  const own = o.keys('slot');
  return (v, path, report, j) => {
    if (!isObject(v)) {
      report(path, 'shape', 'not a { accepts } slot');
      return undefined;
    }
    o.take('slot', `${key}#${j}`, path, v);
    const keysOk = exactKeys(v, ['accepts'], path, report, own);
    const accepts = field(v, 'accepts', path, report, itemId);
    return keysOk && accepts !== undefined ? { accepts } : undefined;
  };
}

/** The lock of hotspot `key`: its triggers are `open:<key>` and `fail:<key>`. */
function lock(o: Owners, key: string): Decoder<Lock> {
  return (v, path, report) => {
    if (!isObject(v)) {
      report(path, 'shape', 'not a lock object (or null)');
      return undefined;
    }
    const keysOk = exactKeys(v, ['slots', 'puzzle', 'locked', 'onFail'], path, report, ['onOpen']);
    const slots = field(v, 'slots', path, report, list(slot(o, key)));
    const puzzle = field(v, 'puzzle', path, report, nullable(matching<PuzzleLocalId>(ID_RE)));
    const locked = field(v, 'locked', path, report, worldText);
    const onOpen = Object.hasOwn(v, 'onOpen') ? field(v, 'onOpen', path, report, effects(o, `open:${key}`)) : [];
    const onFail = field(v, 'onFail', path, report, effects(o, `fail:${key}`));
    if (!keysOk || slots === undefined || puzzle === undefined || locked === undefined || onOpen === undefined || onFail === undefined) {
      return undefined;
    }
    return { slots, puzzle, locked, onOpen, onFail };
  };
}

const HOTSPOT_COMMON = ['id', 'kind', 'rect', 'label'] as const;
const propId = nullable(matching<PropId>(ID_RE));

/** A hotspot of room `room`: its id is its HotspotKey; its `then` is the trigger `then:<key>`. */
function hotspot(o: Owners, room: RoomId): Decoder<Hotspot> {
  const own = o.keys('hotspot');
  return (v, path, report) => {
    if (!isObject(v)) {
      report(path, 'shape', 'not a hotspot object');
      return undefined;
    }
    const get = <T>(key: string, decode: Decoder<T>): T | undefined => field(v, key, path, report, decode);
    const id = get('id', matching<HotspotId>(ID_RE));
    const key = `${room}.${id ?? ''}`;
    o.take('hotspot', key, path, v);
    const then = effects(o, `then:${key}`);
    const r = get('rect', rect);
    const label = get('label', worldText);
    const kind = v['kind'];
    switch (kind) {
      case 'look': {
        const keysOk = exactKeys(v, [...HOTSPOT_COMMON, 'look', 'then'], path, report, own);
        const look = get('look', worldText);
        const th = get('then', then);
        return keysOk && id !== undefined && r !== undefined && label !== undefined && look !== undefined && th !== undefined
          ? { id, kind, rect: r, label, look, then: th }
          : undefined;
      }
      case 'take': {
        const keysOk = exactKeys(v, [...HOTSPOT_COMMON, 'gives', 'prop'], path, report, ['then', ...own]);
        const gives = get('gives', gift);
        const prop = get('prop', propId);
        const th = Object.hasOwn(v, 'then') ? get('then', then) : [];
        return keysOk && id !== undefined && r !== undefined && label !== undefined && gives !== undefined && prop !== undefined && th !== undefined
          ? { id, kind, rect: r, label, gives, prop, then: th }
          : undefined;
      }
      case 'exit': {
        const keysOk = exactKeys(v, [...HOTSPOT_COMMON, 'to', 'lock', 'sfx'], path, report, own);
        const to = get('to', exitTarget);
        const lk = get('lock', nullable(lock(o, key)));
        const sfx = get('sfx', nullable(matching<SfxId>(ID_RE)));
        return keysOk && id !== undefined && r !== undefined && label !== undefined && to !== undefined && lk !== undefined && sfx !== undefined
          ? { id, kind, rect: r, label, to, lock: lk, sfx }
          : undefined;
      }
      case 'object': {
        const keysOk = exactKeys(v, [...HOTSPOT_COMMON, 'lock', 'then', 'look', 'prop'], path, report, own);
        // `then` before the lock: a module's owned values arrive per hotspot as `then`, then the lock's parts.
        const th = get('then', then);
        const lk = get('lock', nullable(lock(o, key)));
        const look = get('look', nullable(worldText));
        const prop = get('prop', propId);
        return keysOk && id !== undefined && r !== undefined && label !== undefined && lk !== undefined && th !== undefined && look !== undefined && prop !== undefined
          ? { id, kind, rect: r, label, lock: lk, then: th, look, prop }
          : undefined;
      }
      default:
        report(at(path, 'kind'), 'shape', `${show(kind)} is not look, take, exit or object`);
        return undefined;
    }
  };
}

/** A room: its id is its key; its `onEnter` is the trigger `enter:<room>`. */
function room(o: Owners): Entry<Room, RoomId> {
  const own = o.keys('room');
  return (v, path, report, id) => {
    if (!isObject(v)) {
      report(path, 'shape', 'not a room object');
      return undefined;
    }
    o.take('room', id, path, v);
    const keysOk = exactKeys(v, ['bg', 'title', 'onEnter', 'hotspots'], path, report, own);
    const bg = field(v, 'bg', path, report, matching<BgId>(ID_RE));
    const title = field(v, 'title', path, report, worldText);
    const onEnter = field(v, 'onEnter', path, report, effects(o, `enter:${id}`));
    const hotspots = field(v, 'hotspots', path, report, list(hotspot(o, id)));
    let unique = true;
    // A HotspotKey names one hotspot only while ids are unique within their room.
    hotspots?.forEach((h, i) => {
      if (hotspots.findIndex((x) => x.id === h.id) !== i) {
        report(at(at(at(path, 'hotspots'), i), 'id'), 'id', `hotspot id '${h.id}' repeats in this room`);
        unique = false;
      }
    });
    if (!keysOk || !unique || bg === undefined || title === undefined || onEnter === undefined || hotspots === undefined) {
      return undefined;
    }
    return { bg, title, onEnter, hotspots };
  };
}

function section(o: Owners): Decoder<Section> {
  return (v, path, report) => {
    if (!isObject(v)) {
      report(path, 'shape', 'not a section object');
      return undefined;
    }
    const keysOk = exactKeys(v, ['start', 'bgm', 'rooms'], path, report);
    const start = field(v, 'start', path, report, matching<RoomId>(ID_RE));
    const bgm = field(v, 'bgm', path, report, nullable(matching<TrackId>(ID_RE)));
    const rooms = field(v, 'rooms', path, report, record<RoomId, Room>(room(o)));
    return keysOk && start !== undefined && bgm !== undefined && rooms !== undefined ? { start, bgm, rooms } : undefined;
  };
}

function isGlyph(v: unknown): v is Glyph {
  return GLYPHS.some((g) => g === v);
}

function item(o: Owners): Entry<Item, ItemId> {
  const own = o.keys('item');
  return (v, path, report, id) => {
    if (!isObject(v)) {
      report(path, 'shape', 'not an item object');
      return undefined;
    }
    o.take('item', id, path, v);
    const keysOk = exactKeys(v, ['name', 'desc', 'glyph'], path, report, own);
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
}

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

/** A puzzle's type and the `params` its own data half decoded. */
type Typed = { readonly type: string; readonly params: unknown };
type Common = Omit<PuzzleBody, 'type' | 'params'>;

/** The puzzle body in the format's key order (LW3 hashes the emitted public JSON for `version`, X9). */
function makeBody(t: Typed, c: Common): PuzzleBody {
  const { title, prompt, closeup, maxAttempts, giveUp } = c;
  // `params` is what the type's own `decodeParams` returned (`typedParams`), so the pair is a PuzzleBody member; a
  // type outside PuzzleType is a test's fixture, passed as `types` (engine plan §7.1 round 5).
  return { type: t.type, title, prompt, closeup, params: t.params, maxAttempts, giveUp } as PuzzleBody;
}

/** `params` through the type's own `decodeParams` (X17: dials 2..6, pieces 2..5). */
function typedParams(data: PuzzleTypeData<string, unknown>): Decoder<Typed> {
  return (v, path, report) => {
    const r = data.decodeParams(v);
    if (r.ok) {
      return { type: data.type, params: r.value };
    }
    report(path, 'shape', r.error);
    return undefined;
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

/** The type-independent half of a puzzle, its type looked up in `types` (its keys are checked by the caller). */
function puzzleBody(v: Raw, path: string, report: Report, types: PuzzleTypes): PuzzleBody | undefined {
  const get = <T>(key: string, decode: Decoder<T>): T | undefined => field(v, key, path, report, decode);
  const data = get<PuzzleTypeData<string, unknown>>('type', (t, p, r) => {
    const found = types.find((d) => d.type === t);
    if (found !== undefined) {
      return found;
    }
    r(p, 'shape', `${show(t)} is not ${types.map((d) => d.type).join(' or ')}`);
    return undefined;
  });
  const typed = data === undefined ? undefined : get('params', typedParams(data));
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

/** A clue's kinds: the kernel fact atoms of the condition grammar (engine plan §4). */
const CLUE_KINDS = ['held', 'used', 'has', 'doc', 'taken', 'examined', 'open', 'visited', 'solved', 'failed'] as const;

/** One clue atom: exactly one key, its id in that kind's grammar; whether the fact exists is `world/clue-reachable`. */
const clue: Decoder<ClueAtom> = (v, path, report) => {
  const pair = oneKey(v, CLUE_KINDS, path, report);
  if (pair === undefined) {
    return undefined;
  }
  const [kind, value] = pair;
  const p = at(path, kind);
  const atom = <T>(decode: Decoder<T>, make: (id: T) => ClueAtom): ClueAtom | undefined => {
    const id = decode(value, p, report);
    return id === undefined ? undefined : make(id);
  };
  const hotspotKey = matching<HotspotKey>(HOTSPOT_KEY_RE);
  const puzzleId = matching<PuzzleLocalId>(ID_RE);
  switch (kind) {
    case 'held':
      return atom(itemId, (held) => ({ held }));
    case 'used':
      return atom(itemId, (used) => ({ used }));
    case 'has':
      return atom(itemId, (has) => ({ has }));
    case 'doc':
      return atom(matching<DocId>(ID_RE), (doc) => ({ doc }));
    case 'taken':
      return atom(hotspotKey, (taken) => ({ taken }));
    case 'examined':
      return atom(hotspotKey, (examined) => ({ examined }));
    case 'open':
      return atom(hotspotKey, (open) => ({ open }));
    case 'visited':
      return atom(matching<RoomId>(ID_RE), (visited) => ({ visited }));
    case 'solved':
      return atom(puzzleId, (solved) => ({ solved }));
    default:
      return atom(puzzleId, (failed) => ({ failed })); // oneKey admits CLUE_KINDS only: the last one, 'failed'
  }
};

const sourcePuzzle = (types: PuzzleTypes): Decoder<SourcePuzzle> => (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a puzzle object');
    return undefined;
  }
  const keysOk = exactKeys(v, [...PUZZLE_KEYS, ...SECRET_KEYS], path, report, ['clues']);
  const body = puzzleBody(v, path, report, types);
  const sol = field(v, 'solution', path, report, solution);
  const hints = field(v, 'hints', path, report, hintTexts);
  const clues = Object.hasOwn(v, 'clues') ? field(v, 'clues', path, report, list(clue)) : [];
  if (!keysOk || body === undefined || sol === undefined || hints === undefined || clues === undefined) {
    return undefined;
  }
  return { ...body, solution: sol, hints, clues };
};

const hintTiers: Decoder<HintTiers> = (v, path, report) => {
  if (v === 0 || v === 1 || v === 2 || v === 3) {
    return v;
  }
  report(path, typeof v === 'number' ? 'range' : 'shape', `${show(v)} is not a hint tier count 0..${MAX_HINTS}`);
  return undefined;
};

const publicPuzzle = (types: PuzzleTypes): Decoder<PublicPuzzle> => (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not a puzzle object');
    return undefined;
  }
  const keysOk = exactKeys(v, [...PUZZLE_KEYS, 'hintTiers'], path, report, [], SECRET_KEYS);
  const body = puzzleBody(v, path, report, types);
  const tiers = field(v, 'hintTiers', path, report, hintTiers);
  return keysOk && body !== undefined && tiers !== undefined ? { ...body, hintTiers: tiers } : undefined;
};

/** The kinds of `renamed` (engine plan §5.1, the kernel's key), in the order a decoded map keeps them. */
export const RENAME_KINDS = ['items', 'docs', 'rooms', 'sections', 'hotspots', 'flags', 'puzzles'] as const satisfies readonly (keyof Renames)[];

/** `renamed`: per kind, old id -> new id, both in the kind's grammar (a hotspot's is `<room>.<hotspot>`). */
const renames: Decoder<Renames> = (v, path, report) => {
  if (!isObject(v)) {
    report(path, 'shape', 'not an object');
    return undefined;
  }
  let ok = exactKeys(v, [], path, report, RENAME_KINDS);
  const out: Record<string, Readonly<Record<string, string>>> = {};
  for (const kind of RENAME_KINDS) {
    const re = kind === 'hotspots' ? HOTSPOT_KEY_RE : ID_RE;
    const map = Object.hasOwn(v, kind) ? field(v, kind, path, report, record<string, string>(matching<string>(re), re)) : null;
    if (map === undefined) {
      ok = false;
    } else if (map !== null) {
      out[kind] = map;
    }
  }
  return ok ? (out as Renames) : undefined; // each kind's keys and values passed that kind's pattern, its brand's contract
};

const TOP_KEYS = ['format', 'items', 'docs', 'puzzles', 'sections'] as const;
/** The world's optional keys (absent = none). */
const TOP_OPTIONAL = ['renamed'] as const;

type Decoded<P> = Omit<WorldSource, 'puzzles'> & { readonly puzzles: Readonly<Record<PuzzleLocalId, P>> };

/**
 * The kernel's line-ID text decoder as a module sees it (`DecodeCtx.text`): a text with an issue (reported through the
 * module's `report`) comes back empty, and the module's error result keeps it out of every decoded world.
 */
// The empty ID is no LineId: it stands in only beside a reported issue, so no decoded world ever holds it.
const CTX: DecodeCtx = { text: (v, path, report) => worldText(v, path, report) ?? { id: '' as LineId, ru: '' } };

/** Every registry module's `decode` over its owned values (`[]` when it owns none present, so `mods` has every id). */
function decodeMods(mechanics: DataRegistry, owned: readonly OwnedAt[][], report: Report): WorldMods | undefined {
  const mods: Record<string, unknown> = {};
  let ok = true;
  mechanics.forEach((m, i) => {
    const r = m.decode(owned[i] ?? [], CTX);
    if (r.ok) {
      mods[m.id] = r.value;
    } else {
      ok = false;
      for (const e of r.error) {
        report(e.path, e.reason, e.detail);
      }
    }
  });
  return ok ? (mods as WorldMods) : undefined; // each registry module's data under its id: ModsOf the registry
}

/** The world: `top` its required top-level keys, `mechanics` the data registry whose modules own keys in its places. */
function decodeWorld<P>(raw: Raw, top: readonly string[], puzzle: Decoder<P>, report: Report, mechanics: DataRegistry): Decoded<P> | undefined {
  const owned = mechanics.map((): OwnedAt[] => []);
  const o: Owners = {
    keys: (place) => mechanics.flatMap((m) => m.owns[place] ?? []),
    take: (place, id, path, v) =>
      mechanics.forEach((m, i) => {
        const keys = Object.entries(v).filter(([k]) => m.owns[place]?.includes(k));
        if (keys.length > 0) {
          owned[i]?.push({ place, id, path, raw: Object.fromEntries(keys) });
        }
      }),
  };
  const keysOk = exactKeys(raw, top, '', report, [...TOP_OPTIONAL, ...o.keys('world')]);
  o.take('world', '', '', raw);
  const get = <T>(key: string, decode: Decoder<T>): T | undefined => field(raw, key, '', report, decode);
  const format = get<1>('format', (f, p, r) => {
    if (f === 1) {
      return f;
    }
    r(p, 'shape', `${show(f)}: the world format is 1`);
    return undefined;
  });
  const items = get('items', record<ItemId, Item>(item(o)));
  const docs = get('docs', record<DocId, Doc>(doc));
  const puzzles = get('puzzles', record<PuzzleLocalId, P>(puzzle));
  const sections = get('sections', record<SectionId, Section>(section(o)));
  const renamed = Object.hasOwn(raw, 'renamed') ? get('renamed', renames) : null;
  const mods = decodeMods(mechanics, owned, report);
  if (!keysOk || format === undefined || items === undefined || docs === undefined || puzzles === undefined || sections === undefined || renamed === undefined || mods === undefined) {
    return undefined;
  }
  // An absent `renamed` stays absent: the value (and so the world version) of a world that never renamed is unchanged.
  return renamed === null ? { format, items, docs, puzzles, sections, mods } : { format, items, docs, puzzles, sections, renamed, mods };
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

/**
 * What a world decoder reads puzzle types (`PUZZLE_TYPES`) and the modules that own keys in its places
 * (`MECHANIC_DATA`) from, unless a test passes fixtures beside them.
 */
export type DecodeOptions = { readonly types?: PuzzleTypes; readonly mechanics?: DataRegistry };

/** `story/<ch>/world.json`: puzzles carry `solution` and `hints`. */
export function decodeWorldSource(raw: unknown, o: DecodeOptions = {}): Result<WorldSource, WorldIssue[]> {
  return collect(raw, (w, report) => decodeWorld(w, TOP_KEYS, sourcePuzzle(o.types ?? PUZZLE_TYPES), report, o.mechanics ?? MECHANIC_DATA));
}

/** A public world (story-gen or a paid payload): refuses `solution` / `hints`, requires the stamped `version`. */
export function decodeWorldPublic(raw: unknown, o: DecodeOptions = {}): Result<WorldPublic, WorldIssue[]> {
  return collect(raw, (w, report): WorldPublic | undefined => {
    const world = decodeWorld(w, [...TOP_KEYS, 'version'], publicPuzzle(o.types ?? PUZZLE_TYPES), report, o.mechanics ?? MECHANIC_DATA);
    const version = field(w, 'version', '', report, matching<string>(VERSION_RE, 'shape'));
    return world !== undefined && version !== undefined ? { ...world, version } : undefined;
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

/**
 * Where a rename chain from `from` ends (engine plan §5.3): the map followed while it has an own entry; null on a
 * cycle. The one walker of emit and lint (`world/renamed-target`, `world/renamed-cycle`): the client never walks one.
 */
export function finalTarget<K extends string>(map: Readonly<Record<K, K>>, from: K): K | null {
  const seen = new Set<K>();
  let at = from;
  while (Object.hasOwn(map, at)) {
    if (seen.has(at)) {
      return null;
    }
    seen.add(at);
    at = map[at] ?? at; // an own entry, so never undefined; a repeat is caught as a cycle above
  }
  return at;
}

/** `renamed` with every chain resolved to its final target; a cycle's entries and a kind left empty are left out. */
function resolved(r: Renames): Renames | null {
  const out: Record<string, Readonly<Record<string, string>>> = {};
  for (const kind of RENAME_KINDS) {
    const map: Readonly<Record<string, string>> = r[kind] ?? {};
    const ends = Object.keys(map).flatMap((from) => {
      const to = finalTarget(map, from);
      return to === null ? [] : [[from, to] as const];
    });
    if (ends.length > 0) {
      out[kind] = Object.fromEntries(ends);
    }
  }
  return Object.keys(out).length === 0 ? null : (out as Renames); // each kind's ids are the decoded map's own
}

/**
 * `node` with `raw` merged into the object at `keys` after its own keys, each object and list on the way copied (the
 * source world's are never written); with `insert`, `raw` (an effect) goes into the list at `keys` at its last key.
 */
function putBack(node: unknown, keys: readonly string[], raw: Raw, insert: boolean): unknown {
  const [k, ...rest] = keys;
  if (k === undefined) {
    return { ...(node as Raw), ...raw }; // an encoded place: an object of the body
  }
  if (Array.isArray(node)) {
    const copy: unknown[] = [...node];
    if (insert && rest.length === 0) {
      copy.splice(Number(k), 0, raw);
    } else {
      copy[Number(k)] = putBack(copy[Number(k)], rest, raw, insert);
    }
    return copy;
  }
  const obj = node as Raw; // an encoded place's path walks the body's objects and lists
  return { ...obj, [k]: putBack(obj[k], rest, raw, insert) };
}

/** An owned effect's source index (the last key of its path); -1 for every other place. */
function effectIndex(a: OwnedAt): number {
  return a.place === 'effect' ? Number(a.path.slice(a.path.lastIndexOf('.') + 1)) : -1;
}

/**
 * The public body (no `version`: LW3's emit stamps it): `solution` and `hints` stripped, the tier count kept, the
 * renames resolved (§5.3). A world with no rename has no `renamed` key, so its value and version are as before. Each
 * registry module's `encode(w.mods[id])` goes back into its places (`o.mechanics`: the registry `w` was decoded with):
 * owned keys after the kernel's keys of their place, an owned effect into its list at its source index. While no world
 * has a module key every `encode` returns [], and the body is the kernel's own object, byte for byte.
 */
export function toPublic(w: WorldSource, o: DecodeOptions = {}): WorldPublicBody {
  const puzzles: Record<PuzzleLocalId, PublicPuzzle> = {};
  for (const [pid, p] of entriesOf(w.puzzles)) {
    puzzles[pid] = { ...makeBody(p, p), hintTiers: tiersOf(p.hints) };
  }
  const kernel: WorldPublicBody = { format: 1, items: w.items, docs: w.docs, puzzles, sections: w.sections };
  const renamed = w.renamed === undefined ? null : resolved(w.renamed);
  const body = renamed === null ? kernel : { ...kernel, renamed };
  const mods: Readonly<Record<string, unknown>> = w.mods;
  const owned = (o.mechanics ?? MECHANIC_DATA).flatMap((m) => {
    if (!Object.hasOwn(mods, m.id)) {
      throw new Error(`invariant: toPublic takes the registry its world was decoded with, which has no '${m.id}'`);
    }
    return m.encode(mods[m.id]);
  });
  // Effects in ascending source index (a stable sort keeps the other places first): each lands where it was written.
  const order = [...owned].sort((a, b) => effectIndex(a) - effectIndex(b));
  // The modules' keys sit in the body's own places: the result is a WorldPublicBody with them.
  return order.reduce<unknown>((out, a) => putBack(out, a.path === '' ? [] : a.path.split('.'), a.raw, a.place === 'effect'), body) as WorldPublicBody;
}

function bilingual(t: WorldText, en: Readonly<Record<LineId, string>>): { ru: string; en: string } {
  // A missing en entry is `loc/missing-en`; the server's startup check needs a non-empty title either way.
  return { ru: t.ru, en: Object.hasOwn(en, t.id) ? (en[t.id] ?? t.ru) : t.ru };
}

/** The build's hint texts of one puzzle after rendering (a type's lint half; `src/` may not import `scripts/`). */
export type HintRenderer = (p: SourcePuzzle, hints: readonly { ru: string; en: string }[]) => readonly { ru: string; en: string }[];

/**
 * `server/content/puzzles/<ch>.json`: the answer shape from the type's data half, the solution, titles and hints, the
 * hints through `renderHints` (the identity by default). `o` is what the world was decoded with: its types hold
 * each puzzle's data half (`PUZZLE_TYPES` by default; a test's fixture type beside them).
 */
export function toServer(
  w: WorldSource,
  en: Readonly<Record<LineId, string>>,
  chapter: ChapterId,
  renderHints: HintRenderer = (_p, hints) => hints,
  o: DecodeOptions = {},
): ServerPuzzleContent {
  const puzzles: Record<PuzzleLocalId, ServerPuzzle> = {};
  for (const [pid, p] of entriesOf(w.puzzles)) {
    const instance = puzzleInstance(p, o.types);
    if (instance === null) {
      throw new Error(`invariant: the story tool decodes its worlds with PUZZLE_TYPES, not '${p.type}'`);
    }
    puzzles[pid] = {
      type: p.type,
      answerLen: instance.shape.len,
      answerMax: instance.shape.max,
      solution: [...p.solution],
      title: bilingual(p.title, en),
      hints: renderHints(p, p.hints.map((h) => bilingual(h, en))),
    };
  }
  return { format: 1, chapterId: chapter, puzzles };
}
