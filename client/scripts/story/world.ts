// The world side of the story gate (docs/PUZZLES-PLAN.md "Lint codes", STAGING-DSL §11 "Enforced from LW3"): a
// chapter's story/<ch>/world.json decoded (`world/schema` and the line-ID codes of its texts), every `world/*` rule
// over the decoded world (given the knot names, the yielded puzzles and the VAR types of the compiled chapter), and
// the per-section soft-lock check; plus the world texts as lines for the locale checks, and the world needles of
// `paid/leak` and scan-dist (D12). Pure, no node:*: scan-dist.ts imports this module, so it never loads inkjs;
// compile.ts, emit.ts and graph.ts come in as types only.
import { searchSection, sectionEntry } from '../../src/explore/reconcile.ts';
import { RESUME_STATE_CAP, hotspotKey, lockOf } from '../../src/explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../../src/explore/state.ts';
import type { WorldState } from '../../src/explore/state.ts';
import { HOTSPOT_SAFE_FRAME } from '../../src/geom/cover.ts';
import { PUZZLE_RULES } from '../../src/puzzles/rules/index.ts';
import type { AssetCatalog } from '../../src/story/catalog.ts';
import type { KnotName, PuzzleLocalId, Rect, SectionId, VarName } from '../../src/story/staging.ts';
import { decodeWorldSource, toPublic } from '../../src/world/decode.ts';
import type { WorldIssue } from '../../src/world/decode.ts';
import type {
  DocId,
  Effect,
  Hotspot,
  HotspotKey,
  ItemId,
  Lock,
  Room,
  RoomId,
  SourcePuzzle,
  WorldSource,
  WorldText,
} from '../../src/world/types.ts';
import type { WorldNeedles } from './emit.ts';
import type { StoryLine } from './graph.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';
import { checkWorld } from './softlock.ts';

/** `story/<ch>/<WORLD_FILE>`: the chapter's world source (PUZZLES-PLAN "World data"). */
export const WORLD_FILE = 'world.json';
/** A world text as a line of the locale checks: `path` is its dotted JSON path; `hint` marks a hint tier's text. */
export type WorldLine = StoryLine & { hint: boolean; path: string };
/** The literal type of a VAR's declared value (`world/var-type`). */
export type VarLiteral = 'int' | 'float' | 'bool' | 'string' | 'other';
/** One section's soft-lock verdict; `states` is null when the search hit RESUME_STATE_CAP. */
export type SectionReport = { section: SectionId; rooms: number; states: number | null; ok: boolean };

/** PUZZLES-PLAN `world/title-long`: the invoice title `Подсказка 3: <title>` must fit 32 chars. */
const TITLE_GRAPHEMES = 18;
/** `world/hotspot-small`: 44 CSS px at a 0.296 scale (320×568). */
const HOTSPOT_MIN_PX = 150;
/** `world/props-per-room`. */
const PROPS_PER_ROOM = 8;
const BOM = String.fromCharCode(0xfeff);
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

type Raw = Readonly<Record<string, unknown>>;

function finding(code: LintCode, file: string, line: number, message: string): Finding {
  return { code, severity: LINT_CODES[code], file, line, message };
}

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A decoded record's own entries, keyed by the brand its keys were checked against. */
function entriesOf<K extends string, V>(r: Readonly<Record<K, V>>): Array<[K, V]> {
  return Object.entries(r) as Array<[K, V]>; // the keys of a decoded record are its ids
}

function has(r: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.hasOwn(r, key);
}

function at(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

/** The text parsed as JSON (a BOM stripped), or why not. */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text.startsWith(BOM) ? text.slice(1) : text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Where a JSON path is written: findings carry the 1-based line of the deepest key of their path (an authoring aid).

/**
 * The 1-based line of every member key and array element of a JSON text that parses, by dotted path. A minimal
 * scanner: JSON.parse already accepted the text, so only structure and line breaks are tracked.
 */
function pathLines(text: string): Map<string, number> {
  const lines = new Map<string, number>();
  let i = text.startsWith(BOM) ? 1 : 0;
  let line = 1;
  const blank = (): void => {
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') {
        line += 1;
      } else if (c !== ' ' && c !== '\t' && c !== '\r') {
        return;
      }
    }
  };
  const string = (): string => {
    const start = i;
    for (i += 1; i < text.length && text[i] !== '"'; i++) {
      if (text[i] === '\\') {
        i += 1;
      }
    }
    i += 1;
    return JSON.parse(text.slice(start, i)) as string; // a string token of a text JSON.parse accepted
  };
  const value = (path: string): void => {
    blank();
    const c = text[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i += 1;
      blank();
      for (let n = 0; text[i] !== close && i < text.length; n++) {
        blank();
        let child = at(path, n);
        if (c === '{') {
          const keyLine = line;
          child = at(path, string());
          lines.set(child, keyLine);
          blank();
          i += 1; // ':'
        } else {
          lines.set(child, line);
        }
        value(child);
        blank();
        if (text[i] === ',') {
          i += 1;
          blank();
        }
      }
      i += 1;
    } else if (c === '"') {
      string();
    } else {
      while (i < text.length && !/[\s,\]}]/.test(text[i] ?? '')) {
        i += 1;
      }
    }
  };
  value('');
  return lines;
}

/** The line of `path`, else of its nearest written ancestor, else 0. */
function lineOf(lines: ReadonlyMap<string, number>, path: string): number {
  for (let p = path; p !== ''; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '') {
    const line = lines.get(p);
    if (line !== undefined) {
      return line;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Decoding

/** The value at a dotted path of a parsed JSON value, or undefined. */
function valueAt(raw: unknown, path: string): unknown {
  let v: unknown = raw;
  for (const part of path === '' ? [] : path.split('.')) {
    if (Array.isArray(v)) {
      v = v[Number(part)];
    } else if (isObject(v) && Object.hasOwn(v, part)) {
      v = v[part];
    } else {
      return undefined;
    }
  }
  return v;
}

/** Whether the text object owning an `<text>.id` issue path has an own `id` key. */
function hasOwnId(raw: unknown, idPath: string): boolean {
  const owner = valueAt(raw, idPath.endsWith('.id') ? idPath.slice(0, -'.id'.length) : idPath);
  return isObject(owner) && Object.hasOwn(owner, 'id');
}

/** decode.ts's reason map (its WorldIssue comment), with a missing `id` told from a malformed one structurally. */
function issueCode(issue: WorldIssue, raw: unknown): LintCode {
  switch (issue.reason) {
    case 'line-id':
      return hasOwnId(raw, issue.path) ? 'id/format' : 'id/missing';
    case 'hint-count':
      return issue.path.endsWith('.id') && !hasOwnId(raw, issue.path) ? 'id/missing' : 'world/hint-count';
    case 'shape':
    case 'id':
    case 'range':
    case 'secret':
      return 'world/schema';
    default: {
      const never: never = issue.reason;
      return never;
    }
  }
}

/**
 * Decodes `story/<ch>/world.json` (`file` is the findings' file): the world, or null with every issue as a finding
 * (`world/schema`, `world/hint-count`, `id/missing`, `id/format`), never the first only.
 */
export function decodeWorldFile(f: { file: string; text: string }): { world: WorldSource | null; findings: Finding[] } {
  const parsed = parseJson(f.text);
  if (!parsed.ok) {
    return { world: null, findings: [finding('world/schema', f.file, 0, `not JSON: ${parsed.error}`)] };
  }
  const r = decodeWorldSource(parsed.value);
  if (r.ok) {
    return { world: r.value, findings: [] };
  }
  const lines = pathLines(f.text);
  const findings = r.error.map((i) => finding(issueCode(i, parsed.value), f.file, lineOf(lines, i.path), i.path === '' ? i.detail : `${i.path}: ${i.detail}`));
  return { world: null, findings };
}

// ---------------------------------------------------------------------------------------------------------------
// The world's places: every room, hotspot, lock and trigger once, with its section and its JSON path.

type RoomAt = { section: SectionId; room: RoomId; value: Room; path: string };
type SpotAt = RoomAt & { hotspot: Hotspot; key: HotspotKey; spath: string };
type LockAt = SpotAt & { lock: Lock; lpath: string };
/** A trigger's effects: a room's `onEnter`, a hotspot's `then`, a lock's `onOpen` / `onFail`; `owner` names it. */
type TriggerAt = { section: SectionId; room: RoomId; effects: readonly Effect[]; path: string; owner: string };

type Places = {
  rooms: RoomAt[];
  /** The first definition of each room id (`world/duplicate-id` reports the others). */
  roomOf: Map<RoomId, RoomAt>;
  spots: SpotAt[];
  locks: LockAt[];
  triggers: TriggerAt[];
};

function placesOf(w: WorldSource): Places {
  const p: Places = { rooms: [], roomOf: new Map(), spots: [], locks: [], triggers: [] };
  for (const [section, s] of entriesOf(w.sections)) {
    for (const [room, value] of entriesOf(s.rooms)) {
      const r: RoomAt = { section, room, value, path: `sections.${section}.rooms.${room}` };
      p.rooms.push(r);
      if (!p.roomOf.has(room)) {
        p.roomOf.set(room, r);
      }
      p.triggers.push({ section, room, effects: value.onEnter, path: `${r.path}.onEnter`, owner: `room ${room} onEnter` });
      value.hotspots.forEach((hotspot, i) => {
        const spot: SpotAt = { ...r, hotspot, key: hotspotKey(room, hotspot.id), spath: `${r.path}.hotspots.${i}` };
        p.spots.push(spot);
        if (hotspot.kind !== 'exit') {
          p.triggers.push({ section, room, effects: hotspot.then, path: `${spot.spath}.then`, owner: `${spot.key} then` });
        }
        const lock = lockOf(hotspot);
        if (lock !== null) {
          const l: LockAt = { ...spot, lock, lpath: `${spot.spath}.lock` };
          p.locks.push(l);
          p.triggers.push({ section, room, effects: lock.onOpen, path: `${l.lpath}.onOpen`, owner: `${spot.key} onOpen` });
          p.triggers.push({ section, room, effects: lock.onFail, path: `${l.lpath}.onFail`, owner: `${spot.key} onFail` });
        }
      });
    }
  }
  return p;
}

/** Every gift of the world with its section and path: a `take`'s `gives`, a `{ give }` effect. */
function giftsOf(p: Places): Array<{ section: SectionId; item: ItemId | null; doc: DocId | null; path: string }> {
  const out: Array<{ section: SectionId; item: ItemId | null; doc: DocId | null; path: string }> = [];
  for (const s of p.spots) {
    if (s.hotspot.kind === 'take') {
      const g = s.hotspot.gives;
      out.push('item' in g ? { section: s.section, item: g.item, doc: null, path: `${s.spath}.gives.item` } : { section: s.section, item: null, doc: g.doc, path: `${s.spath}.gives.doc` });
    }
  }
  for (const t of p.triggers) {
    t.effects.forEach((e, i) => {
      if ('give' in e) {
        out.push({ section: t.section, item: e.give, doc: null, path: `${t.path}.${i}.give` });
      }
    });
  }
  return out;
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Whether `s` is the puzzle's initial state, and else why `validateSolution` refuses it (null: valid). */
function solutionCheck(p: SourcePuzzle): { initial: boolean; problem: string | null } {
  const same = (a: readonly number[]): boolean => a.length === p.solution.length && a.every((v, i) => v === p.solution[i]);
  switch (p.type) {
    case 'code':
      return { initial: same(PUZZLE_RULES.code.initial(p.params)), problem: PUZZLE_RULES.code.validateSolution(p.params, p.solution) };
    case 'order':
      return { initial: same(PUZZLE_RULES.order.initial(p.params)), problem: PUZZLE_RULES.order.validateSolution(p.params, p.solution) };
    default: {
      const never: never = p;
      return never;
    }
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

// ---------------------------------------------------------------------------------------------------------------
// The world texts

/** Every world text in file order, with its dotted path; `file` and `text` are the source's, for the lines. */
export function worldLines(w: WorldSource, file: string, text: string): WorldLine[] {
  const lines = pathLines(text);
  const out: WorldLine[] = [];
  const add = (t: WorldText, path: string, hint = false): void => {
    out.push({ id: t.id, text: t.ru, file, line: lineOf(lines, path), hint, path });
  };
  for (const [id, item] of entriesOf(w.items)) {
    add(item.name, `items.${id}.name`);
    add(item.desc, `items.${id}.desc`);
  }
  for (const [id, doc] of entriesOf(w.docs)) {
    add(doc.title, `docs.${id}.title`);
    doc.body.forEach((t, i) => add(t, `docs.${id}.body.${i}`));
  }
  for (const [id, p] of entriesOf(w.puzzles)) {
    add(p.title, `puzzles.${id}.title`);
    add(p.prompt, `puzzles.${id}.prompt`);
    p.hints.forEach((t, i) => add(t, `puzzles.${id}.hints.${i}`, true));
  }
  for (const r of placesOf(w).rooms) {
    add(r.value.title, `${r.path}.title`);
    r.value.hotspots.forEach((h, i) => {
      const path = `${r.path}.hotspots.${i}`;
      add(h.label, `${path}.label`);
      const lock = lockOf(h);
      if (lock !== null) {
        add(lock.locked, `${path}.lock.locked`);
      }
      const look = h.kind === 'look' || h.kind === 'object' ? h.look : null;
      if (look !== null) {
        add(look, `${path}.look`);
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The world needles (PUZZLES-PLAN X7, D12)

/** A text needle's minimum length in code points: a shorter text is too common to fingerprint (D12). */
export const TEXT_NEEDLE_MIN_CODE_POINTS = 12;

/**
 * The text needles of `texts`: each of at least 12 code points that occurs inside no public text, plus its
 * JSON-escaped form when that differs (a JSON chunk escapes `"` and `\`); sorted, once each.
 */
export function textNeedles(texts: Iterable<string>, publicTexts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if ([...t].length < TEXT_NEEDLE_MIN_CODE_POINTS || publicTexts.some((p) => p.includes(t))) {
      continue;
    }
    out.add(t);
    const escaped = JSON.stringify(t).slice(1, -1);
    if (escaped !== t) {
      out.add(escaped);
    }
  }
  return [...out].sort();
}

/**
 * The needles of one chapter's world, built from its source and its en table (`en`: line ID → English): every hint's
 * ID and its texts (ru, and the en), free and paid chapters alike; for a paid world also every other text's ID and
 * texts. A text inside a public text is dropped (a chapter's inventory may repeat a public name), an ID never is.
 * `publicTexts` is what a free build legitimately ships, never a hint source (critique C1): the caller builds it.
 */
export function worldFingerprints(w: { world: WorldSource; paid: boolean; en: ReadonlyMap<string, string> }, publicTexts: readonly string[]): WorldNeedles {
  const lines = worldLines(w.world, '', '');
  const hints = lines.filter((l) => l.hint);
  const others = w.paid ? lines.filter((l) => !l.hint) : [];
  const texts = (of: readonly WorldLine[]): string[] => textNeedles(of.flatMap((l) => [l.text, w.en.get(l.id) ?? '']), publicTexts);
  return {
    hintIds: [...new Set(hints.map((l) => l.id))].sort(),
    hintTexts: texts(hints),
    paidIds: [...new Set(others.map((l) => l.id))].sort(),
    paidTexts: texts(others),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The lint

/**
 * Every `world/*` finding of a decoded world (PUZZLES-PLAN "Lint codes"; `world/linear-requires` holds by
 * construction, RULINGS 21 Q6) plus `id/chapter-prefix` of its texts, sorted by line, code and message; and the
 * soft-lock verdict per section. `knots` null: effect knots are not judged (the chapter did not compile); `yielded`
 * null: linear puzzles are not judged unreachable.
 */
export function lintWorld(input: {
  chapter: SourceChapter;
  file: string;
  text: string;
  world: WorldSource;
  catalog: AssetCatalog;
  knots: ReadonlySet<KnotName> | null;
  yielded: ReadonlySet<PuzzleLocalId> | null;
  declared: ReadonlyMap<VarName, VarLiteral>;
}): { findings: Finding[]; sections: SectionReport[] } {
  const { chapter, file, world: w, catalog } = input;
  const lines = pathLines(input.text);
  const out: Finding[] = [];
  const report = (code: LintCode, path: string, message: string): void => {
    out.push(finding(code, file, lineOf(lines, path), message));
  };
  const p = placesOf(w);
  const sectionOf = (room: RoomId): SectionId | undefined => p.roomOf.get(room)?.section;

  // Ids: rooms are unique across sections; a puzzle id never ends in `_hints` (its pz_ VAR would collide).
  for (const r of p.rooms) {
    const first = p.roomOf.get(r.room);
    if (first !== undefined && first !== r) {
      report('world/duplicate-id', r.path, `room '${r.room}' is defined in sections ${first.section} and ${r.section}: room ids are unique in the chapter`);
    }
  }
  for (const id of Object.keys(w.puzzles)) {
    if (id.endsWith('_hints')) {
      report('world/id-reserved', `puzzles.${id}`, `puzzle id '${id}' ends in _hints: pz_${id} would read as the hint count of puzzle '${id.slice(0, -'_hints'.length)}' (X2)`);
    }
  }

  // Assets.
  const asset = (ok: boolean, path: string, what: string): void => {
    if (!ok) {
      report('world/unknown-asset', path, `${what} is not in assets/catalog.json`);
    }
  };
  for (const [sid, s] of entriesOf(w.sections)) {
    if (s.bgm !== null) {
      asset(has(catalog.bgm, s.bgm), `sections.${sid}.bgm`, `bgm '${s.bgm}'`);
    }
  }
  for (const r of p.rooms) {
    asset(has(catalog.bg, r.value.bg), `${r.path}.bg`, `bg '${r.value.bg}'`);
  }
  for (const s of p.spots) {
    const h = s.hotspot;
    if ((h.kind === 'take' || h.kind === 'object') && h.prop !== null) {
      asset(has(catalog.prop, h.prop), `${s.spath}.prop`, `prop '${h.prop}'`);
    }
    if (h.kind === 'exit' && h.sfx !== null) {
      asset(has(catalog.sfx, h.sfx), `${s.spath}.sfx`, `sfx '${h.sfx}'`);
    }
  }
  for (const [pid, pz] of entriesOf(w.puzzles)) {
    if (pz.closeup !== null) {
      asset(has(catalog.cg, pz.closeup), `puzzles.${pid}.closeup`, `close-up cg '${pz.closeup}'`);
    }
  }

  // References.
  const ref = (ok: boolean, path: string, what: string): void => {
    if (!ok) {
      report('world/unknown-ref', path, `${what} is not defined`);
    }
  };
  const item = (id: ItemId, path: string): void => ref(has(w.items, id), path, `item '${id}'`);
  for (const [sid, s] of entriesOf(w.sections)) {
    ref(p.roomOf.get(s.start)?.section === sid, `sections.${sid}.start`, `start room '${s.start}' of section ${sid}`);
  }
  for (const s of p.spots) {
    const h = s.hotspot;
    if (h.kind === 'take') {
      if ('item' in h.gives) {
        item(h.gives.item, `${s.spath}.gives.item`);
      } else {
        ref(has(w.docs, h.gives.doc), `${s.spath}.gives.doc`, `doc '${h.gives.doc}'`);
      }
    }
    if (h.kind === 'exit') {
      if ('room' in h.to) {
        ref(p.roomOf.has(h.to.room), `${s.spath}.to.room`, `room '${h.to.room}' (exit ${s.key})`);
      } else if (input.knots !== null) {
        ref(input.knots.has(h.to.story), `${s.spath}.to.story`, `knot '${h.to.story}' (exit ${s.key}) of ${chapter.id}`);
      }
    }
  }
  for (const l of p.locks) {
    l.lock.slots.forEach((slot, i) => item(slot.accepts, `${l.lpath}.slots.${i}.accepts`));
    if (l.lock.puzzle !== null) {
      ref(has(w.puzzles, l.lock.puzzle), `${l.lpath}.puzzle`, `puzzle '${l.lock.puzzle}' (lock ${l.key})`);
    }
  }
  for (const t of p.triggers) {
    t.effects.forEach((e, i) => {
      if ('give' in e) {
        item(e.give, `${t.path}.${i}.give`);
      } else if ('unlock' in e) {
        const [room = '', spot = ''] = e.unlock.split('.');
        const target = p.roomOf.get(room as RoomId); // a lookup key: a missing room misses
        ref(target?.value.hotspots.some((h) => h.id === spot) === true, `${t.path}.${i}.unlock`, `hotspot '${e.unlock}'`);
      } else if (input.knots !== null) {
        ref(input.knots.has(e.story), `${t.path}.${i}.story`, `knot '${e.story}' of ${chapter.id}`);
      }
    });
  }
  for (const [pid, pz] of entriesOf(w.puzzles)) {
    if (pz.type === 'order') {
      pz.params.pieces.forEach((piece, i) => item(piece, `puzzles.${pid}.params.pieces.${i}`));
    }
  }

  // Exits: room→room exits come in pairs and stay in their section.
  for (const s of p.spots) {
    const h = s.hotspot;
    if (h.kind !== 'exit' || !('room' in h.to)) {
      continue;
    }
    const target = p.roomOf.get(h.to.room);
    if (target === undefined) {
      continue; // `world/unknown-ref`
    }
    if (target.section !== s.section) {
      report('world/cross-section-exit', `${s.spath}.to.room`, `exit ${s.key} leads to room ${h.to.room} of section ${target.section}, not of its own section ${s.section} (X15)`);
    }
    const back = target.value.hotspots.some((o) => o.kind === 'exit' && 'room' in o.to && o.to.room === s.room);
    if (!back) {
      report('world/one-way-exit', `${s.spath}.to.room`, `exit ${s.key} leads to room ${h.to.room}, which has no exit back to ${s.room}`);
    }
  }

  // Hotspot geometry and props.
  const frame = HOTSPOT_SAFE_FRAME;
  for (const r of p.rooms) {
    const spots = p.spots.filter((s) => s.path === r.path);
    spots.forEach((s, i) => {
      const [x, y, rw, rh] = s.hotspot.rect;
      if (x < frame.x0 || y < frame.y0 || x + rw > frame.x1 || y + rh > frame.y1) {
        report('world/hotspot-frame', `${s.spath}.rect`, `${s.key} [${s.hotspot.rect.join(', ')}] leaves the safe frame x ${frame.x0}–${frame.x1}, y ${frame.y0}–${frame.y1}`);
      }
      if (rw < HOTSPOT_MIN_PX || rh < HOTSPOT_MIN_PX) {
        report('world/hotspot-small', `${s.spath}.rect`, `${s.key} is ${rw}×${rh}: under ${HOTSPOT_MIN_PX}×${HOTSPOT_MIN_PX} source px (a 44 CSS px target)`);
      }
      for (const o of spots.slice(0, i)) {
        if (overlaps(o.hotspot.rect, s.hotspot.rect)) {
          report('world/hotspot-overlap', `${s.spath}.rect`, `${s.key} overlaps ${o.key}`);
        }
      }
    });
    const props = spots.filter((s) => (s.hotspot.kind === 'take' || s.hotspot.kind === 'object') && s.hotspot.prop !== null).length;
    if (props > PROPS_PER_ROOM) {
      report('world/props-per-room', r.path, `room ${r.room} shows ${props} props: at most ${PROPS_PER_ROOM}`);
    }
  }

  // Puzzles.
  const locksOf = new Map<PuzzleLocalId, LockAt[]>();
  for (const l of p.locks) {
    if (l.lock.puzzle !== null && has(w.puzzles, l.lock.puzzle)) {
      locksOf.set(l.lock.puzzle, [...(locksOf.get(l.lock.puzzle) ?? []), l]);
    }
  }
  for (const [pid, pz] of entriesOf(w.puzzles)) {
    const path = `puzzles.${pid}`;
    const sol = solutionCheck(pz);
    if (sol.initial) {
      report('world/solution-initial', `${path}.solution`, `puzzle '${pid}': the solution [${pz.solution.join(', ')}] is the initial state (X17)`);
    } else if (sol.problem !== null) {
      report('world/solution', `${path}.solution`, `puzzle '${pid}': ${sol.problem}`);
    }
    const graphemes = [...GRAPHEMES.segment(pz.title.ru)].length;
    if (graphemes > TITLE_GRAPHEMES) {
      report('world/title-long', `${path}.title`, `puzzle '${pid}': the title is ${graphemes} graphemes, at most ${TITLE_GRAPHEMES} (the hint invoice title)`);
    }
    const locks = locksOf.get(pid) ?? [];
    if (pz.giveUp && locks.length > 0) {
      report('world/giveup-in-section', `${path}.giveUp`, `puzzle '${pid}' is the puzzle of lock ${locks.map((l) => l.key).join(', ')}: Give up is for linear puzzles only (X8)`);
    }
    if (locks.length > 1) {
      report('world/puzzle-multi-lock', path, `puzzle '${pid}' is the puzzle of ${locks.length} locks: ${locks.map((l) => l.key).join(', ')} (X15: one lock per puzzle)`);
    }
    for (const l of locks) {
      if (pz.maxAttempts !== null && l.lock.onFail.length === 0) {
        report('world/fail-without-effect', `${l.lpath}.onFail`, `lock ${l.key}: puzzle '${pid}' has maxAttempts ${pz.maxAttempts} and the lock has no onFail effect`);
      }
      if (pz.type === 'order' && !sameMembers(pz.params.pieces, l.lock.slots.map((s) => s.accepts))) {
        report('world/order-pieces', `${l.lpath}.puzzle`, `lock ${l.key}: order puzzle '${pid}' has pieces [${pz.params.pieces.join(', ')}], the slots accept [${l.lock.slots.map((s) => s.accepts).join(', ')}] (X17)`);
      }
    }
  }

  // Sections are self-contained (X15): items, unlocks and gifts stay in their section.
  const gifts = giftsOf(p);
  const givenIn = new Map<string, SectionId[]>();
  for (const g of gifts) {
    const key = g.item !== null ? `item '${g.item}'` : `doc '${g.doc ?? ''}'`;
    const sections = givenIn.get(key) ?? [];
    const first = sections[0];
    if (first !== undefined && !sections.includes(g.section)) {
      report('world/cross-section-effect', g.path, `${key} is given in section ${g.section} and in section ${first} (X15: a gift belongs to one section)`);
    }
    givenIn.set(key, sections.includes(g.section) ? sections : [...sections, g.section]);
  }
  for (const t of p.triggers) {
    t.effects.forEach((e, i) => {
      if ('unlock' in e) {
        const target = sectionOf(e.unlock.split('.')[0] as RoomId); // a lookup key
        if (target !== undefined && target !== t.section) {
          report('world/cross-section-effect', `${t.path}.${i}.unlock`, `${t.owner} (section ${t.section}) unlocks ${e.unlock} of section ${target} (X15: a trigger writes only its own section)`);
        }
      }
    });
  }
  for (const l of p.locks) {
    const required: Array<{ item: ItemId; path: string }> = l.lock.slots.map((s, i) => ({ item: s.accepts, path: `${l.lpath}.slots.${i}.accepts` }));
    const pz = l.lock.puzzle === null ? undefined : (Object.hasOwn(w.puzzles, l.lock.puzzle) ? w.puzzles[l.lock.puzzle] : undefined);
    if (pz?.type === 'order') {
      required.push(...pz.params.pieces.map((piece, i) => ({ item: piece, path: `puzzles.${l.lock.puzzle ?? ''}.params.pieces.${i}` })));
    }
    for (const r of required) {
      const sections = givenIn.get(`item '${r.item}'`) ?? [];
      if (sections.length > 0 && !sections.includes(l.section)) {
        report('world/cross-section-item', r.path, `item '${r.item}' is obtained in section ${sections.join(', ')} and required by lock ${l.key} of section ${l.section} (X15)`);
      }
    }
  }

  // The projection VARs the chapter declares (X2).
  const varType = (name: string, want: VarLiteral, path: string): void => {
    const got = input.declared.get(name as VarName); // a lookup key
    if (got !== undefined && got !== want) {
      report('world/var-type', path, `VAR ${name} is declared ${got}: the projection writes ${want === 'int' ? 'an int' : 'a bool'} (X2)`);
    }
  };
  for (const pid of Object.keys(w.puzzles)) {
    varType(`pz_${pid}`, 'int', `puzzles.${pid}`);
    varType(`pz_${pid}_hints`, 'int', `puzzles.${pid}`);
  }
  for (const id of Object.keys(w.items)) {
    varType(`it_${id}`, 'bool', `items.${id}`);
  }
  for (const id of Object.keys(w.docs)) {
    varType(`dc_${id}`, 'bool', `docs.${id}`);
  }

  // Line IDs belong to the chapter (STAGING-DSL §4).
  for (const l of worldLines(w, file, input.text)) {
    if (!l.id.startsWith(`${chapter.id}.`)) {
      report('id/chapter-prefix', l.path, `'${l.id}' is in a world of ${chapter.id} (§4)`);
    }
  }

  // The soft-lock check per section, then one more search per proved section for what no reachable state touches.
  const pub = toPublic(w);
  const checks = checkWorld(pub, file);
  for (const c of checks) {
    out.push(...c.findings.map((f) => ({ ...f, line: lineOf(lines, `sections.${c.section}`) })));
  }
  const touched = { rooms: new Set<RoomId>(), items: new Set<ItemId>(), docs: new Set<DocId>(), puzzles: new Set<PuzzleLocalId>() };
  const touch = (s: WorldState): void => {
    if (s.room !== null) {
      touched.rooms.add(s.room);
    }
    for (const i of [...s.held, ...s.used]) {
      touched.items.add(i);
    }
    for (const d of s.docs) {
      touched.docs.add(d);
    }
  };
  const capped = new Set<SectionId>();
  for (const c of checks) {
    if (c.states === null) {
      capped.add(c.section);
      continue;
    }
    const start = sectionEntry(pub, EMPTY_WORLD_STATE, c.section);
    touch(start);
    searchSection(pub, start, c.section, RESUME_STATE_CAP, {
      onEdge: (_from, succ) => {
        touch(succ.state);
        if (succ.step.kind === 'closed' || succ.step.kind === 'puzzle-ended') {
          touched.puzzles.add(succ.step.puzzle);
        }
      },
    });
  }
  const givenOnlyInCapped = (key: string): boolean => {
    const sections = givenIn.get(key) ?? [];
    return sections.length > 0 && sections.every((s) => capped.has(s));
  };
  for (const r of p.roomOf.values()) {
    if (!capped.has(r.section) && !touched.rooms.has(r.room)) {
      report('world/unreachable', r.path, `room ${r.room}: no reachable state of section ${r.section} enters it`);
    }
  }
  for (const id of Object.keys(w.items) as ItemId[]) {
    if (!touched.items.has(id) && !givenOnlyInCapped(`item '${id}'`)) {
      report('world/unreachable', `items.${id}`, `item '${id}': no reachable state holds it`);
    }
  }
  for (const id of Object.keys(w.docs) as DocId[]) {
    if (!touched.docs.has(id) && !givenOnlyInCapped(`doc '${id}'`)) {
      report('world/unreachable', `docs.${id}`, `doc '${id}': no reachable state finds it`);
    }
  }
  for (const pid of Object.keys(w.puzzles) as PuzzleLocalId[]) {
    const locks = locksOf.get(pid) ?? [];
    if (locks.length > 0) {
      if (!touched.puzzles.has(pid) && !locks.every((l) => capped.has(l.section))) {
        report('world/unreachable', `puzzles.${pid}`, `puzzle '${pid}': no reachable state opens lock ${locks.map((l) => l.key).join(', ')}`);
      }
    } else if (input.yielded !== null && !input.yielded.has(pid)) {
      report('world/unreachable', `puzzles.${pid}`, `puzzle '${pid}': no lock carries it and no puzzle tag of ${chapter.id} yields it`);
    }
  }

  const sections: SectionReport[] = checks.map((c) => ({
    section: c.section,
    rooms: Object.keys(w.sections[c.section]?.rooms ?? {}).length,
    states: c.states,
    ok: c.findings.length === 0,
  }));
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  out.sort((a, b) => a.line - b.line || order(a.code, b.code) || order(a.message, b.message));
  return { findings: out, sections };
}
