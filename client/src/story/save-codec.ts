// The save body (PROTOTYPE-PLAN "Save format and resume", PUZZLES-PLAN X9, engine plan §5.2): the format is the
// client's, the server stores it opaque. Every field is checked by shape and id grammar on read; anything unreadable is
// an error value, never a throw (principle 1: validated at the edge). Unknown keys are ignored and never copied, so a
// body from a newer build within one format still loads; an incompatible change bumps `format`. A body of an older
// format is read by that format's frozen decoder and upgraded, so `decodeSave` returns the current format only.
// Pure: no clock, storage or network.
import type { PuzzleOutcome, PuzzleRun, WorldState } from '../explore/state.ts';
import type { AnchorKey, FlagId } from '../mechanics/contract.ts';
import type { DocId, HotspotKey, ItemId, RoomId } from '../world/types.ts';
import { CHAPTER_ID_RE, KNOT_NAME_RE } from './catalog.ts';
import type { InkScalar, Result } from './catalog.ts';
import type {
  BgId,
  CamState,
  CamTarget,
  CgId,
  ChapterId,
  CharId,
  ExprId,
  KnotName,
  LineId,
  PropId,
  PropPlacement,
  PuzzleLocalId,
  Rect,
  SectionId,
  Slot,
  SpeakerId,
  StagingSnapshot,
  StoryVersion,
  TrackId,
  VarName,
  YieldCommand,
} from './staging.ts';
import { LINE_ID_RE } from './tags.ts';

/** One backlog line; `chosen` is the choice taken right after it. */
export type BacklogEntry = { lineId: LineId; speaker: SpeakerId | null; ru: string; chosen?: LineId };
/** The format this build writes; `decodeSave` reads it and every older one. */
export const SAVE_FORMAT = 2;
/** The opaque save body, format 2. */
export type SaveBody = {
  format: typeof SAVE_FORMAT;
  chapterId: ChapterId;
  storyVersion: StoryVersion;
  /** story.state.toJson(); null = the chapter is not started yet (a paywall pending). */
  ink: string | null;
  at: { lineId: LineId | null; knot: KnotName | null; yield: YieldCommand | null };
  /** The stage at save time. */
  staging: StagingSnapshot;
  /** The last knot entry. */
  checkpoint: { knot: KnotName; vars: Record<VarName, InkScalar>; staging: StagingSnapshot } | null;
  /** The values and the items carried INTO this chapter (`items`: no chapter carries one yet). */
  chapterStart: { carry: Record<VarName, InkScalar>; items: readonly ItemId[] };
  /** The last BACKLOG_MAX lines. */
  backlog: ReadonlyArray<BacklogEntry>;
  /** EMPTY_WORLD_STATE for a chapter without a world. */
  world: WorldState;
  /** The public world's `version` at save time; null without a world. */
  worldVersion: string | null;
};

// Format 1, frozen (engine plan §5.2): its shapes and its decoder stay as format 1 wrote them, so every format-1 body a
// player holds reads as it always did and then upgrades. A new key belongs to the next format, never here.
/** A puzzle run, format 1. */
export type PuzzleRunV1 = { readonly outcome: PuzzleOutcome | null; readonly attempts: number; readonly hintsOpened: number };
/** A prop placement, format 1. */
export type PropPlacementV1 = { readonly prop: PropId; readonly rect: Rect };
/** The stage, format 1. */
export type StagingSnapshotV1 = {
  bg: BgId | null;
  cg: CgId | null;
  chars: ReadonlyArray<{ char: CharId; expr: ExprId; at: Slot }>;
  bgm: { track: TrackId; vol: number } | null;
  props: readonly PropPlacementV1[];
};
/** The world, format 1. */
export type WorldStateV1 = {
  readonly format: 1;
  readonly section: SectionId | null;
  readonly room: RoomId | null;
  readonly lastRoom: Readonly<Record<SectionId, RoomId>>;
  readonly visited: readonly RoomId[];
  readonly held: readonly ItemId[];
  readonly used: readonly ItemId[];
  readonly docs: readonly DocId[];
  readonly taken: readonly HotspotKey[];
  readonly examined: readonly HotspotKey[];
  readonly slots: Readonly<Record<HotspotKey, ReadonlyArray<ItemId | null>>>;
  readonly open: readonly HotspotKey[];
  readonly fired: readonly string[];
  readonly pendingStory: readonly KnotName[];
  readonly puzzles: Readonly<Record<PuzzleLocalId, PuzzleRunV1>>;
  readonly unproved: readonly SectionId[];
};
/** The opaque save body, format 1. */
export type SaveBodyV1 = {
  format: 1;
  chapterId: ChapterId;
  storyVersion: StoryVersion;
  ink: string | null;
  at: { lineId: LineId | null; knot: KnotName | null; yield: YieldCommand | null };
  staging: StagingSnapshotV1;
  checkpoint: { knot: KnotName; vars: Record<VarName, InkScalar>; staging: StagingSnapshotV1 } | null;
  chapterStart: { carry: Record<VarName, InkScalar> };
  backlog: ReadonlyArray<BacklogEntry>;
  world: WorldStateV1;
  worldVersion: string | null;
};

const FIELDS_1 = [
  'format',
  'section',
  'room',
  'lastRoom',
  'visited',
  'held',
  'used',
  'docs',
  'taken',
  'examined',
  'slots',
  'open',
  'fired',
  'pendingStory',
  'puzzles',
  'unproved',
] as const;
/**
 * The keys of a save's `world` per format (engine plan §3.2, §3.6): a mechanic's `slice` is saved under its key there,
 * so every slice key is in the current format's list (`mechanics: slice keys pinned to SAVE_FORMAT`), and a new one is
 * a format bump with its upgrader.
 */
export const SAVE_FIELDS: { readonly 1: readonly (keyof WorldStateV1)[]; readonly 2: readonly (keyof WorldState)[] } = {
  1: FIELDS_1,
  2: [...FIELDS_1, 'flags'],
};
/** The backlog lines a body keeps. */
export const BACKLOG_MAX = 50;
export type SaveDecodeError = { kind: 'malformed' | 'unknown-format'; detail: string };

/** STAGING-DSL §6 positional ids and names (tags.ts NAME_RE, catalog.ts ID_RE). */
const NAME_RE = /^[a-z][a-z0-9_]*$/;
const HEX16_RE = /^[0-9a-f]{16}$/;
const SLOTS: Readonly<Record<Slot, true>> = { left: true, center: true, right: true };
const OUTCOMES: Readonly<Record<PuzzleOutcome, true>> = { solved: true, failed: true, abandoned: true };

type Raw = Readonly<Record<string, unknown>>;
/** One value's reader; `path` is its JSON path from `save`. */
type Field<T> = (value: unknown, path: string) => Result<T, string>;
/** An optional key's reader (`optional`): an absent key yields no key, a present one is read strictly. */
type Optional<T> = { readonly optional: Field<T> };
/** A reader per key: a required key takes a Field, an optional one an Optional, and neither passes for the other. */
type Shape<T> = { readonly [K in keyof T]-?: {} extends Pick<T, K> ? Optional<Exclude<T[K], undefined>> : Field<T[K]> };

const ok = <T>(value: T): Result<T, string> => ({ ok: true, value });
const problem = (path: string, what: string): Result<never, string> => ({ ok: false, error: `${path}: ${what}` });

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function shown(v: unknown): string {
  if (typeof v === 'string') {
    return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  }
  return v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v;
}

const str: Field<string> = (v, p) => (typeof v === 'string' ? ok(v) : problem(p, `expected a string, got ${shown(v)}`));
const count: Field<number> = (v, p) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? ok(v) : problem(p, `expected an integer ≥ 0, got ${shown(v)}`);

/** A string matching `re`, typed as the brand the grammar earns. */
function matching<T extends string>(re: RegExp, what: string): Field<T> {
  return (v, p) => (typeof v === 'string' && re.test(v) ? ok(v as T) : problem(p, `expected ${what}, got ${shown(v)}`));
}

function literal<T extends string | number>(value: T): Field<T> {
  return (v, p) => (v === value ? ok(value) : problem(p, `expected ${JSON.stringify(value)}, got ${shown(v)}`));
}

function oneOf<T extends string>(set: Readonly<Record<T, true>>): Field<T> {
  // The own-key test proves membership, which is what the cast states.
  return (v, p) => (typeof v === 'string' && Object.hasOwn(set, v) ? ok(v as T) : problem(p, `unknown value ${shown(v)}`));
}

function nullable<T>(f: Field<T>): Field<T | null> {
  return (v, p) => (v === null ? ok(null) : f(v, p));
}

function optional<T>(f: Field<T>): Optional<T> {
  return { optional: f };
}

function arrayOf<T>(f: Field<T>): Field<T[]> {
  return (v, p) => {
    if (!Array.isArray(v)) {
      return problem(p, `expected an array, got ${shown(v)}`);
    }
    const out: T[] = [];
    for (const [i, item] of v.entries()) {
      const r = f(item, `${p}[${i}]`);
      if (!r.ok) {
        return r;
      }
      out.push(r.value);
    }
    return ok(out);
  };
}

/** A JSON object read as a map; built with Object.fromEntries, so a key such as `__proto__` stays a plain key. */
function recordOf<K extends string, T>(f: Field<T>): Field<Record<K, T>> {
  return (v, p) => {
    if (!isRecord(v)) {
      return problem(p, `expected an object, got ${shown(v)}`);
    }
    const out: Array<[string, T]> = [];
    for (const [key, item] of Object.entries(v)) {
      const r = f(item, `${p}.${key}`);
      if (!r.ok) {
        return r;
      }
      out.push([key, r.value]);
    }
    // Keys are kept as written: a name the current story or world does not know is dropped by its reader.
    return ok(Object.fromEntries(out) as Record<K, T>);
  };
}

/**
 * Exactly the shape's keys are read; any other key is ignored and never copied. A required key that is absent is
 * `missing`; an absent optional key yields no key in the result (never `undefined`), a `null` is not absent.
 */
function object<T>(shape: Shape<T>): Field<T> {
  return (v, p) => {
    if (!isRecord(v)) {
      return problem(p, `expected an object, got ${shown(v)}`);
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries<Field<unknown> | Optional<unknown>>(shape)) {
      const required = typeof entry === 'function';
      if (!Object.hasOwn(v, key)) {
        if (required) {
          return problem(`${p}.${key}`, 'missing');
        }
        continue;
      }
      const r = (required ? entry : entry.optional)(v[key], `${p}.${key}`);
      if (!r.ok) {
        return r;
      }
      out[key] = r.value;
    }
    // Every required key of the shape, and every optional one present, was read into `out` by its own reader.
    return ok(out as T);
  };
}

const lineId = matching<LineId>(LINE_ID_RE, 'a line id');
const knotName = matching<KnotName>(KNOT_NAME_RE, 'a knot name');
const scalar: Field<InkScalar> = (v, p) =>
  typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
    ? ok(v)
    : problem(p, `expected a number, boolean or string, got ${shown(v)}`);
const vars = recordOf<VarName, InkScalar>(scalar);

/** x, y, w, h: integer source px. */
const rect: Field<Rect> = (v, p) => {
  const r = arrayOf(count)(v, p);
  if (!r.ok) {
    return r;
  }
  const [x, y, w, h] = r.value;
  return r.value.length === 4 && x !== undefined && y !== undefined && w !== undefined && h !== undefined
    ? ok([x, y, w, h] as const)
    : problem(p, `expected [x, y, w, h], got ${r.value.length} numbers`);
};
const volume: Field<number> = (v, p) => {
  const r = count(v, p);
  return !r.ok || r.value <= 100 ? r : problem(p, `expected a volume 0..100, got ${r.value}`);
};

const placementV1Shape: Shape<PropPlacementV1> = { prop: matching(NAME_RE, 'a prop id'), rect };
const stagingV1Shape: Shape<StagingSnapshotV1> = {
  bg: nullable(matching(NAME_RE, 'a bg id')),
  cg: nullable(matching(NAME_RE, 'a cg id')),
  chars: arrayOf(object({ char: matching(NAME_RE, 'a character id'), expr: matching(NAME_RE, 'an expression id'), at: oneOf(SLOTS) })),
  bgm: nullable(object<NonNullable<StagingSnapshotV1['bgm']>>({ track: matching(NAME_RE, 'a track id'), vol: volume })),
  props: arrayOf(object(placementV1Shape)),
};
const stagingV1 = object(stagingV1Shape);

const backlogEntry: Field<BacklogEntry> = (v, p) => {
  const head = object<Omit<BacklogEntry, 'chosen'>>({ lineId, speaker: nullable(matching<SpeakerId>(NAME_RE, 'a speaker id')), ru: str })(v, p);
  if (!head.ok || !isRecord(v) || !Object.hasOwn(v, 'chosen')) {
    return head;
  }
  const chosen = lineId(v['chosen'], `${p}.chosen`);
  return chosen.ok ? ok({ ...head.value, chosen: chosen.value }) : chosen;
};
/** The last BACKLOG_MAX entries; every entry is checked first. */
const backlog: Field<BacklogEntry[]> = (v, p) => {
  const r = arrayOf(backlogEntry)(v, p);
  return r.ok ? ok(r.value.slice(-BACKLOG_MAX)) : r;
};

/** The yield the story is stopped at (STAGING-DSL §6 `puzzle`, `explore`). */
const yieldCommand: Field<YieldCommand> = (v, p) => {
  if (!isRecord(v)) {
    return problem(p, `expected a yield command, got ${shown(v)}`);
  }
  switch (v['kind']) {
    case 'puzzle':
      return object<Extract<YieldCommand, { kind: 'puzzle' }>>({
        kind: literal('puzzle'),
        puzzle: matching(NAME_RE, 'a puzzle id'),
        then: matching(NAME_RE, 'a knot name'),
      })(v, p);
    case 'explore':
      return object<Extract<YieldCommand, { kind: 'explore' }>>({ kind: literal('explore'), section: matching(NAME_RE, 'a section id') })(v, p);
    default:
      return problem(`${p}.kind`, `expected 'puzzle' or 'explore', got ${shown(v['kind'])}`);
  }
};

const puzzleRunV1Shape: Shape<PuzzleRunV1> = { outcome: nullable(oneOf(OUTCOMES)), attempts: count, hintsOpened: count };
/**
 * A world id, structural only: any string. Reconcile drops the ids the current world lacks (X9 step 1), which is
 * where the brand is earned; a grammar check here would refuse a save that reconcile can still repair.
 */
function worldId<T extends string>(): Field<T> {
  return (v, p) => (typeof v === 'string' ? ok(v as T) : problem(p, `expected a string, got ${shown(v)}`));
}
const worldV1Shape: Shape<WorldStateV1> = {
  format: literal(1),
  section: nullable(worldId<SectionId>()),
  room: nullable(worldId<RoomId>()),
  lastRoom: recordOf<SectionId, RoomId>(worldId<RoomId>()),
  visited: arrayOf(worldId<RoomId>()),
  held: arrayOf(worldId<ItemId>()),
  used: arrayOf(worldId<ItemId>()),
  docs: arrayOf(worldId<DocId>()),
  taken: arrayOf(worldId<HotspotKey>()),
  examined: arrayOf(worldId<HotspotKey>()),
  slots: recordOf<HotspotKey, Array<ItemId | null>>(arrayOf(nullable(worldId<ItemId>()))),
  open: arrayOf(worldId<HotspotKey>()),
  fired: arrayOf(str),
  pendingStory: arrayOf(worldId<KnotName>()),
  puzzles: recordOf<PuzzleLocalId, PuzzleRunV1>(object(puzzleRunV1Shape)),
  unproved: arrayOf(worldId<SectionId>()),
};

const bodyV1Shape: Shape<SaveBodyV1> = {
  format: literal(1),
  chapterId: matching<ChapterId>(CHAPTER_ID_RE, 'a chapter id'),
  storyVersion: matching<StoryVersion>(HEX16_RE, 'a story version (16 hex)'),
  ink: nullable(str),
  at: object<SaveBodyV1['at']>({ lineId: nullable(lineId), knot: nullable(knotName), yield: nullable(yieldCommand) }),
  staging: stagingV1,
  checkpoint: nullable(object({ knot: knotName, vars, staging: stagingV1 })),
  chapterStart: object({ carry: vars }),
  backlog,
  world: object(worldV1Shape),
  worldVersion: nullable(matching(HEX16_RE, 'a world version (16 hex)')),
};
const bodyV1 = object(bodyV1Shape);

// Format 2: format 1's readers, and the keys format 2 changed or added.
/** `<room>.<hotspot>` or `<room>~<decor>` (AnchorKey). */
const ANCHOR_RE = /^[a-z][a-z0-9_]*[.~][a-z][a-z0-9_]*$/;
const PARTS: Readonly<Record<NonNullable<PropPlacement['part']>, true>> = { base: true, patch: true };
/** A push's zoom: an integer percent, 105..130. */
const zoom: Field<number> = (v, p) => {
  const r = count(v, p);
  return !r.ok || (r.value >= 105 && r.value <= 130) ? r : problem(p, `expected a zoom 105..130, got ${r.value}`);
};
const cam: Field<CamState> = (v, p) => {
  if (!isRecord(v)) {
    return problem(p, `expected a camera state, got ${shown(v)}`);
  }
  switch (v['kind']) {
    case 'rest':
      return object<Extract<CamState, { kind: 'rest' }>>({ kind: literal('rest') })(v, p);
    case 'push':
      return object<Extract<CamState, { kind: 'push' }>>({ kind: literal('push'), to: matching<CamTarget>(NAME_RE, 'a camera target'), z: zoom })(v, p);
    case 'pan':
      return object<Extract<CamState, { kind: 'pan' }>>({ kind: literal('pan'), to: matching(NAME_RE, 'a camera target') })(v, p);
    default:
      return problem(`${p}.kind`, `expected 'rest', 'push' or 'pan', got ${shown(v['kind'])}`);
  }
};
const placement = object<PropPlacement>({
  ...placementV1Shape,
  at: optional(matching<AnchorKey>(ANCHOR_RE, 'an anchor key')),
  part: optional(oneOf(PARTS)),
});
const staging = object<StagingSnapshot>({ ...stagingV1Shape, props: arrayOf(placement), cam: optional(cam) });
const puzzleRun = object<PuzzleRun>({ ...puzzleRunV1Shape, work: optional(arrayOf(count)) });
const world = object<WorldState>({
  ...worldV1Shape,
  format: literal(SAVE_FORMAT),
  puzzles: recordOf<PuzzleLocalId, PuzzleRun>(puzzleRun),
  flags: arrayOf(worldId<FlagId>()),
});
const body = object<SaveBody>({
  ...bodyV1Shape,
  format: literal(SAVE_FORMAT),
  staging,
  checkpoint: nullable(object({ knot: knotName, vars, staging })),
  chapterStart: object<SaveBody['chapterStart']>({ carry: vars, items: arrayOf(worldId<ItemId>()) }),
  world,
});

/** Format 1 -> 2: no flag set, no item carried; every other field is the format-1 value. */
function upgradeV1(b: SaveBodyV1): SaveBody {
  return { ...b, format: SAVE_FORMAT, chapterStart: { ...b.chapterStart, items: [] }, world: { ...b.world, format: SAVE_FORMAT, flags: [] } };
}

/** The body as JSON, its backlog cut to the last BACKLOG_MAX entries. */
export function encodeSave(b: SaveBody): string {
  return JSON.stringify({ ...b, backlog: b.backlog.slice(-BACKLOG_MAX) });
}

/**
 * The body in SAVE_FORMAT (a format-1 body read by format 1's decoder, then upgraded), or `malformed` (not JSON, a
 * wrong shape or id, naming the path) or `unknown-format` (no format this build reads: a newer build's body).
 */
export function decodeSave(raw: string): Result<SaveBody, SaveDecodeError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: { kind: 'malformed', detail: `save: not JSON (${e instanceof Error ? e.message : String(e)})` } };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: { kind: 'malformed', detail: `save: expected an object, got ${shown(parsed)}` } };
  }
  const format = parsed['format'];
  if (format === 1) {
    const r = bodyV1(parsed, 'save');
    return r.ok ? { ok: true, value: upgradeV1(r.value) } : { ok: false, error: { kind: 'malformed', detail: r.error } };
  }
  if (format !== SAVE_FORMAT) {
    return { ok: false, error: { kind: 'unknown-format', detail: `save.format: ${shown(format)}, this build reads 1..${SAVE_FORMAT}` } };
  }
  const r = body(parsed, 'save');
  return r.ok ? r : { ok: false, error: { kind: 'malformed', detail: r.error } };
}
