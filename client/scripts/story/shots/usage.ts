// build/shots.json (docs/plans/shots §3.6, lane SH2): the story tool -> asset tool contract. Per chapter: the shots it
// shows with their needs (cast, the face states with their lines, camera targets, motions, the room it draws), every
// shot-family file it needs (§2.6: the asset tool tiers each with `tierOf`), each window's lookahead and entry
// alternatives (§3.4), and whether it still names legacy sprites. Encoded with sorted keys, so two runs write the same
// bytes; decoded with exact keys, each shot-file id checked by its structure against the chapter's needs, never with
// `ASSET_ID_RE` (which admits no `sheet` / `face` / `talk` id before SH3a, rev. 5 m8). Pure, no node:*.
import { ASSET_ID_RE, CHAPTER_ID_RE } from '../../../src/story/catalog.ts';
import type { Result } from '../../../src/story/catalog.ts';
import type { AssetId, BgId, CamTarget, ChapterId, CharId, ExprId, LineId, Motion } from '../../../src/story/staging.ts';
import { LINE_ID_RE } from '../../../src/story/tags.ts';
import type { RoomId, WorldPublicBody } from '../../../src/world/types.ts';
import { entries, lookahead, namesSprites } from './flow.ts';
import type { ChapterFlow, Lookahead, RoomEvents, WindowKey } from './flow.ts';
import { faceNeeds, usedShots } from './lint.ts';
import { FRAMES, VIEWS } from './list.ts';
import type { EffectiveShot, Frame, LocId, View } from './list.ts';

/** Where the story tool writes it, repo-relative (beside `usage.json`; build-only, never loaded by the server). */
export const SHOT_USAGE_FILE = 'server/content/build/shots.json';

/** What one chapter needs of one shot it shows. */
export type ShotNeed = {
  readonly cast: Readonly<Record<CharId, { readonly view: View; readonly rest: ExprId; readonly figure: boolean }>>;
  /** Per face member, every expression the chapter shows it in (at rest included): whether it speaks in it, the lines. */
  readonly faces: Readonly<Record<CharId, readonly { readonly expr: ExprId; readonly talk: boolean; readonly lines: readonly LineId[] }[]>>;
  readonly frame: Frame;
  readonly loc: LocId;
  /** The `cam:` targets (push / pan to a character or the centre) while the shot may be in effect. */
  readonly camTargets: readonly CamTarget[];
  /** The `anim:` motions while the shot may be in effect. */
  readonly motions: readonly Motion[];
  /** The room of the chapter's world that draws this shot (the first by id), else null. */
  readonly room: RoomId | null;
};
/** A window's lookahead as written (§3.4 `Lookahead`). */
export type WindowRefs = Lookahead;
export type ChapterShots = {
  readonly shots: Readonly<Record<BgId, ShotNeed>>;
  /** Every shot-family file the chapter needs (§2.6), sorted. */
  readonly assets: readonly AssetId[];
  readonly look: Readonly<Record<WindowKey, WindowRefs>>;
  /** Per window, one alternative per possible top image (§3.4 "Entry alternatives"; a room window: its room, D9). */
  readonly entry: Readonly<Record<WindowKey, readonly (readonly AssetId[])[]>>;
  /** Some `show:` / `hide:`: the chapter keeps the knot-set rows until it is restaged (rev. 3, W5). */
  readonly sprites: boolean;
};
export type ShotUsage = { readonly chapters: Readonly<Record<ChapterId, ChapterShots>> };

/** One compiled chapter as the shot pass has it. */
export type UsageChapter = { readonly id: ChapterId; readonly flow: ChapterFlow; readonly world: WorldPublicBody | null; readonly rooms: RoomEvents };

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The camera targets and motions of the batches while shot `s` may be in effect. */
function staged(flow: ChapterFlow, s: BgId): { cams: Set<CamTarget>; motions: Set<Motion> } {
  const cams = new Set<CamTarget>();
  const motions = new Set<Motion>();
  for (const step of flow.steps.values()) {
    for (const b of step.batches.filter((x) => x.effect.shots.has(s))) {
      for (const { cmd } of b.commands) {
        if (cmd.kind === 'cam' && cmd.cam.kind !== 'pull' && cmd.cam.to !== 'left' && cmd.cam.to !== 'right') {
          cams.add(cmd.cam.to);
        } else if (cmd.kind === 'anim') {
          motions.add(cmd.motion);
        }
      }
    }
  }
  return { cams, motions };
}

/**
 * build/shots.json from the compiled chapters (§3.6). A chapter's talk files are its own: a talk file is listed, and
 * held by a window, only where the chapter has that character speak in that expression in that shot (a file a chapter
 * does not list is one its tier may not grant).
 */
export function shotUsage(chapters: readonly UsageChapter[], shots: ReadonlyMap<BgId, EffectiveShot>): ShotUsage {
  const out: Record<string, ChapterShots> = {};
  for (const ch of chapters) {
    const needs = faceNeeds(ch.flow, shots);
    const input = { flow: ch.flow, files: { shots, talk: new Set(needs.filter((n) => n.talk).map((n) => `${n.shot}/${n.char}/${n.expr}`)) }, rooms: ch.rooms };
    const need: Record<string, ShotNeed> = {};
    const assets = new Set<string>();
    for (const s of [...usedShots(ch.flow, ch.world)].sort(order)) {
      const shot = shots.get(s);
      if (shot === undefined) {
        continue; // no catalog bg and not declared: the parse refused its tag, the world lint its room
      }
      assets.add(`bg/${s}`);
      if (shot.cast.length > 0) {
        assets.add(`sheet/${s}`);
      }
      const faces: Record<string, Array<{ expr: ExprId; talk: boolean; lines: readonly LineId[] }>> = {};
      for (const n of needs.filter((x) => x.shot === s)) {
        (faces[n.char] ??= []).push({ expr: n.expr, talk: n.talk, lines: n.lines });
        if (n.expr !== shot.cast.find((m) => m.char === n.char)?.rest) {
          assets.add(`face/${s}/${n.char}/${n.expr}`);
        }
        if (n.talk) {
          assets.add(`talk/${s}/${n.char}/${n.expr}`);
        }
      }
      const { cams, motions } = staged(ch.flow, s);
      need[s] = {
        cast: Object.fromEntries(shot.cast.map((m) => [m.char, { view: m.view, rest: m.rest, figure: m.figure }])),
        faces,
        frame: shot.frame,
        loc: shot.loc,
        camTargets: [...cams].sort(order),
        motions: [...motions].sort(order),
        room: [...ch.rooms].filter(([, r]) => r.shot === s).map(([id]) => id).sort(order)[0] ?? null,
      };
    }
    out[ch.id] = {
      shots: need,
      assets: [...assets].sort(order) as AssetId[], // shot-file ids built from decoded shot, cast and expression ids
      look: Object.fromEntries(lookahead(input)),
      entry: Object.fromEntries(entries(input)),
      sprites: namesSprites(ch.flow),
    };
  }
  return { chapters: out };
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(sortKeys);
  }
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => order(a, b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

/** Two-space JSON with every object's keys sorted (arrays keep their order), so two runs write the same bytes. */
export function encodeSorted(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

/** The file's text (`possible` keeps its near-first order). */
export function encodeShotUsage(u: ShotUsage): string {
  return encodeSorted(u);
}

// ---------------------------------------------------------------------------------------------------------------
// The decoder (the asset tool's side of the seam)

/** A shot-family file id (§2.4): `bg/<s>`, `sheet/<s>`, `face/<s>/<c>/<x>`, `talk/<s>/<c>/<x>`. */
export type ShotFileId =
  | { readonly ns: 'bg' | 'sheet'; readonly shot: BgId }
  | { readonly ns: 'face' | 'talk'; readonly shot: BgId; readonly char: CharId; readonly expr: ExprId };

const SHOT_FILE_RE = /^(?:(bg|sheet)\/([a-z][a-z0-9_]*)|(face|talk)\/([a-z][a-z0-9_]*)\/([a-z][a-z0-9_]*)\/([a-z][a-z0-9_]*))$/;

/** Parses a shot-file id by its structure (a fixed number of segments per namespace), else null. */
export function parseShotFileId(id: string): ShotFileId | null {
  const [, ns, shot, fns, fshot, char, expr] = SHOT_FILE_RE.exec(id) ?? [];
  if ((ns === 'bg' || ns === 'sheet') && shot !== undefined) {
    return { ns, shot: shot as BgId }; // matched the id grammar
  }
  if ((fns === 'face' || fns === 'talk') && fshot !== undefined && char !== undefined && expr !== undefined) {
    return { ns: fns, shot: fshot as BgId, char: char as CharId, expr: expr as ExprId }; // matched the id grammar
  }
  return null;
}

type Raw = Readonly<Record<string, unknown>>;

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function keysExactly(v: Raw, keys: readonly string[], path: string, issues: string[]): void {
  for (const k of Object.keys(v).filter((x) => !keys.includes(x))) {
    issues.push(`${path}.${k}: unknown key (expected ${keys.join(', ')})`);
  }
  for (const k of keys.filter((x) => !Object.hasOwn(v, x))) {
    issues.push(`${path}.${k}: missing`);
  }
}

const ID_RE = /^[a-z][a-z0-9_]*$/;
const WINDOW_KEY_RE = /^(?:k|r):[a-z][a-z0-9_]*$/;
/** Every motion, so that a new one fails `check` here until it is listed. */
const MOTIONS: Readonly<Record<Motion, true>> = { nod: true, shake: true, lean_in: true, lean_back: true, sigh: true, tremble: true, hop: true, bounce: true };

function strings(v: unknown, path: string, issues: string[], ok: (s: string) => boolean, what: string): string[] {
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

function oneOf<T extends string>(v: unknown, all: readonly T[], path: string, issues: string[]): T {
  const hit = all.find((x) => x === v);
  if (hit === undefined) {
    issues.push(`${path}: ${JSON.stringify(v) ?? 'undefined'} is not one of ${all.join(', ')}`);
    return all[0] as T; // reported; the value is never used
  }
  return hit;
}

function bool(v: unknown, path: string, issues: string[]): boolean {
  if (typeof v !== 'boolean') {
    issues.push(`${path}: not a boolean`);
    return false;
  }
  return v;
}

function count(v: unknown, path: string, issues: string[]): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    issues.push(`${path}: not a whole number`);
    return 0;
  }
  return v;
}

function decodeNeed(raw: unknown, path: string, issues: string[]): ShotNeed | null {
  if (!isObject(raw)) {
    issues.push(`${path}: not an object`);
    return null;
  }
  keysExactly(raw, ['camTargets', 'cast', 'faces', 'frame', 'loc', 'motions', 'room'], path, issues);
  const cast: Record<string, { view: View; rest: ExprId; figure: boolean }> = {};
  const rawCast = raw['cast'];
  for (const [c, m] of Object.entries(isObject(rawCast) ? rawCast : {})) {
    const mp = `${path}.cast.${c}`;
    if (!ID_RE.test(c) || !isObject(m)) {
      issues.push(`${mp}: not a character id with an object`);
      continue;
    }
    keysExactly(m, ['figure', 'rest', 'view'], mp, issues);
    const rest = m['rest'];
    if (typeof rest !== 'string' || !ID_RE.test(rest)) {
      issues.push(`${mp}.rest: not an expression id`);
    }
    cast[c] = { view: oneOf(m['view'], VIEWS, `${mp}.view`, issues), rest: String(rest) as ExprId, figure: bool(m['figure'], `${mp}.figure`, issues) };
  }
  if (!isObject(rawCast)) {
    issues.push(`${path}.cast: not an object`);
  }
  const faces: Record<string, Array<{ expr: ExprId; talk: boolean; lines: LineId[] }>> = {};
  const rawFaces = raw['faces'];
  for (const [c, list] of Object.entries(isObject(rawFaces) ? rawFaces : {})) {
    const fp = `${path}.faces.${c}`;
    if (!Object.hasOwn(cast, c) || !Array.isArray(list)) {
      issues.push(`${fp}: not a cast member with a list`);
      continue;
    }
    faces[c] = list.flatMap((f: unknown, i) => {
      const ep = `${fp}.${i}`;
      if (!isObject(f)) {
        issues.push(`${ep}: not an object`);
        return [];
      }
      keysExactly(f, ['expr', 'lines', 'talk'], ep, issues);
      const expr = f['expr'];
      if (typeof expr !== 'string' || !ID_RE.test(expr)) {
        issues.push(`${ep}.expr: not an expression id`);
        return [];
      }
      const lines = strings(f['lines'], `${ep}.lines`, issues, (s) => LINE_ID_RE.test(s), 'a line id') as LineId[]; // the brand is earned by the pattern
      return [{ expr: expr as ExprId, talk: bool(f['talk'], `${ep}.talk`, issues), lines }];
    });
  }
  if (!isObject(rawFaces)) {
    issues.push(`${path}.faces: not an object`);
  }
  const loc = raw['loc'];
  if (typeof loc !== 'string' || !ID_RE.test(loc)) {
    issues.push(`${path}.loc: not a location id`);
  }
  const room = raw['room'];
  if (room !== null && (typeof room !== 'string' || !ID_RE.test(room))) {
    issues.push(`${path}.room: not a room id or null`);
  }
  const camTargets = strings(raw['camTargets'], `${path}.camTargets`, issues, (s) => s === 'center' || Object.hasOwn(cast, s), 'a cast member or center') as CamTarget[];
  const motions = strings(raw['motions'], `${path}.motions`, issues, (s) => Object.hasOwn(MOTIONS, s), 'a motion') as Motion[];
  return {
    cast: cast as ShotNeed['cast'], // keys passed the id pattern above
    faces: faces as ShotNeed['faces'], // keys are cast members
    frame: oneOf(raw['frame'], FRAMES, `${path}.frame`, issues),
    loc: String(loc) as LocId,
    camTargets,
    motions,
    room: typeof room === 'string' ? (room as RoomId) : null, // reported above when it is no room id
  };
}

/** Whether `id` names a need of `shots`: its shot, and for a face or talk file a cast member and one of its expressions. */
function namesNeed(f: ShotFileId, shots: Readonly<Record<string, ShotNeed>>): boolean {
  const need = Object.hasOwn(shots, f.shot) ? shots[f.shot] : undefined;
  if (need === undefined) {
    return false;
  }
  if (!('char' in f)) {
    return true; // a plate or a sheet: its shot is enough
  }
  const faces = Object.hasOwn(need.faces, f.char) ? need.faces[f.char] : undefined;
  return (faces ?? []).some((x) => x.expr === f.expr);
}

function windowFiles(v: unknown, path: string, issues: string[], shots: Readonly<Record<string, ShotNeed>>): AssetId[] {
  return strings(
    v,
    path,
    issues,
    (s) => {
      const f = parseShotFileId(s);
      return f === null ? ASSET_ID_RE.test(s) : namesNeed(f, shots);
    },
    "an asset id or a shot file of the chapter's needs",
  ) as AssetId[]; // each matched ASSET_ID_RE or the shot-file grammar
}

function decodeChapter(raw: unknown, path: string, issues: string[]): ChapterShots | null {
  if (!isObject(raw)) {
    issues.push(`${path}: not an object`);
    return null;
  }
  keysExactly(raw, ['assets', 'entry', 'look', 'shots', 'sprites'], path, issues);
  const shots: Record<string, ShotNeed> = {};
  const rawShots = raw['shots'];
  if (!isObject(rawShots)) {
    issues.push(`${path}.shots: not an object`);
  }
  for (const [s, n] of Object.entries(isObject(rawShots) ? rawShots : {})) {
    const need = ID_RE.test(s) ? decodeNeed(n, `${path}.shots.${s}`, issues) : null;
    if (need === null) {
      issues.push(`${path}.shots.${s}: not a shot id with its need`);
      continue;
    }
    shots[s] = need;
  }
  const assets = strings(
    raw['assets'],
    `${path}.assets`,
    issues,
    (s) => {
      const f = parseShotFileId(s);
      return f !== null && namesNeed(f, shots);
    },
    "a shot file of the chapter's needs",
  ) as AssetId[]; // each matched the shot-file grammar
  const look: Record<string, WindowRefs> = {};
  const rawLook = raw['look'];
  if (!isObject(rawLook)) {
    issues.push(`${path}.look: not an object`);
  }
  for (const [k, w] of Object.entries(isObject(rawLook) ? rawLook : {})) {
    const wp = `${path}.look.${k}`;
    if (!(LINE_ID_RE.test(k) || WINDOW_KEY_RE.test(k)) || !isObject(w)) {
      issues.push(`${wp}: not a window key with an object`);
      continue;
    }
    keysExactly(w, ['certain', 'certainDist', 'cur', 'd2', 'd3', 'labels', 'near', 'possible'], wp, issues);
    const possible = windowFiles(w['possible'], `${wp}.possible`, issues, shots);
    const near = count(w['near'], `${wp}.near`, issues);
    if (near > possible.length) {
      issues.push(`${wp}.near: ${near} is more than the ${possible.length} possible files`);
    }
    look[k] = {
      cur: windowFiles(w['cur'], `${wp}.cur`, issues, shots),
      certain: windowFiles(w['certain'], `${wp}.certain`, issues, shots),
      certainDist: count(w['certainDist'], `${wp}.certainDist`, issues),
      possible,
      near,
      d2: windowFiles(w['d2'], `${wp}.d2`, issues, shots),
      d3: windowFiles(w['d3'], `${wp}.d3`, issues, shots),
      labels: bool(w['labels'], `${wp}.labels`, issues),
    };
  }
  const entry: Record<string, AssetId[][]> = {};
  const rawEntry = raw['entry'];
  if (!isObject(rawEntry)) {
    issues.push(`${path}.entry: not an object`);
  }
  for (const [k, alts] of Object.entries(isObject(rawEntry) ? rawEntry : {})) {
    const ep = `${path}.entry.${k}`;
    if (!(LINE_ID_RE.test(k) || WINDOW_KEY_RE.test(k)) || !Array.isArray(alts)) {
      issues.push(`${ep}: not a window key with a list`);
      continue;
    }
    entry[k] = alts.map((a: unknown, i) => windowFiles(a, `${ep}.${i}`, issues, shots));
  }
  return {
    shots: shots as ChapterShots['shots'], // keys passed the id pattern above
    assets,
    look: look as ChapterShots['look'], // keys passed the window-key patterns above
    entry: entry as ChapterShots['entry'], // keys passed the window-key patterns above
    sprites: bool(raw['sprites'], `${path}.sprites`, issues),
  };
}

/** Decodes build/shots.json: exact keys at every level, every problem reported (as `decodeStoryUsage`). */
export function decodeShotUsage(raw: unknown): Result<ShotUsage, string[]> {
  if (!isObject(raw)) {
    return { ok: false, error: ['not a JSON object'] };
  }
  const issues: string[] = [];
  for (const k of Object.keys(raw).filter((x) => x !== 'chapters')) {
    issues.push(`${k}: unknown key (expected chapters)`);
  }
  const rawChapters = raw['chapters'];
  if (!isObject(rawChapters)) {
    issues.push('chapters: not an object');
  }
  const chapters: Record<string, ChapterShots> = {};
  for (const [id, ch] of Object.entries(isObject(rawChapters) ? rawChapters : {})) {
    const decoded = CHAPTER_ID_RE.test(id) ? decodeChapter(ch, `chapters.${id}`, issues) : null;
    if (decoded === null) {
      issues.push(`chapters.${id}: not a chapter id with its shots`);
      continue;
    }
    chapters[id] = decoded;
  }
  return issues.length > 0 ? { ok: false, error: issues } : { ok: true, value: { chapters: chapters as ShotUsage['chapters'] } }; // keys passed CHAPTER_ID_RE
}
