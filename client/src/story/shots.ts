// A chapter manifest's shot rigs, loop rigs and lookahead windows (docs/plans/shots §4.5, lane SH3a): the types and
// decoders of the opaque top-level `shots`, `loops` and `look` that catalog.ts admits verbatim (the CH D26 pattern),
// the window a step hands the scene (`stepWindow`), a room's whole shot for the neighbour preload (`shotImages`) and the
// faces a chapter's rigs answer for (`faceIndex`). Pure, type imports only; no module of the entry closure imports it
// (engine errata item 9): its first runtime importers are SH4 and SH5a.
import type { AssetManifest, Result } from './catalog.ts';
import type { AssetId, BgId, CharId, ExprId, PropId } from './staging.ts';

export type Frame = 'wide' | 'medium' | 'close' | 'ots' | 'two' | 'insert' | 'room';
/** A rectangle in px: `[x, y, w, h]`. */
export type Box = readonly [x: number, y: number, w: number, h: number];
/** One packed layer: where it sits in its file (`frame`, that file's px) and on the plate (`at`, plate px). */
export type Member = {
  /** Its `sheet`, `face` or `talk` file: the one it sits in, a reused rest state's copy included (§2.6). */
  readonly file: AssetId;
  readonly frame: Box;
  readonly at: Box;
  /** Rev. 3 (m7): alpha is the dilated diff, not a rectangle. */
  readonly masked?: true;
};
/** One expression's motion layers, each cut against that expression's base (rev. 2, W4). */
export type MotionSet = {
  readonly blink: { readonly half: Member; readonly closed: Member };
  /** The talk mouths; [] where the character never speaks in this expression. */
  readonly talk: readonly Member[];
  readonly accent: Member;
  /** Rev. 3 (m7): blink drawn on the accent state. */
  readonly joint?: { readonly half: Member; readonly closed: Member };
};
export type FaceRig = {
  readonly rest: ExprId;
  /** `layer` null: the rest expression (the plate already shows it). */
  readonly exprs: Readonly<Record<ExprId, { readonly layer: Member | null; readonly motion: MotionSet }>>;
  /** The plateau's bbox: the push target and the neck point. */
  readonly head: Box;
};
export type CastRig = {
  readonly view: 'face' | 'back';
  readonly face: FaceRig | null;
  readonly body: { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly rot: number; readonly feet: readonly [number, number] };
  /** Rev. 2 (W3): the mean depth over the plateau, u8 / 255. */
  readonly headDepth: number;
  /** Rev. 3 (W3): base64 bitmask over the 25 × 47 vertices. */
  readonly plateau: string;
  /** Rev. 3 (C2): the same over 13 × 24, the S-D fallback lattice. */
  readonly plateauCoarse: string;
  /** Rev. 3: the head-motion falloff, plate px. */
  readonly band: number;
  /** Rev. 3: the head group (one shared affine). */
  readonly group: number;
  readonly figure: Member | null;
  /** At least one (R9). */
  readonly hair: readonly { readonly member: Member; readonly pivot: readonly [number, number] }[];
};
export type AmbientRig =
  | { readonly kind: 'flicker'; readonly member: Member; readonly amp: number; readonly hz: number; readonly z: 'back' | 'front' }
  | { readonly kind: 'loop'; readonly frames: readonly Member[]; readonly fps: number; readonly z: 'back' | 'front' }
  | { readonly kind: 'particles'; readonly preset: 'dust' | 'rain' | 'snow' | 'embers'; readonly sprite: Member; readonly rect: Box; readonly count: number }
  | { readonly kind: 'sway'; readonly plane: number; readonly amp: number };
export type ShotRig = {
  readonly w: number;
  readonly h: number;
  readonly frame: Frame;
  readonly focus: readonly [number, number];
  /** Back to front. */
  readonly cast: readonly (CastRig & { readonly char: CharId })[];
  readonly planes: readonly { readonly member: Member; readonly depth: number; readonly pivot: readonly [number, number]; readonly front: boolean }[];
  readonly ambient: readonly AmbientRig[];
  /** base64 of the 13 × 24 u8 depth grid. */
  readonly depth: string;
};
/** Rev. 2 (W10): a loop prop's frames inside its own atlas `prop/<id>`, keyed by that prop id. */
export type LoopRig = { readonly frames: readonly Box[]; readonly fps: number };
/**
 * Rev. 5 (W1): the window a step hands the scene with its batch. `need` = cur ∪ certain, `warm` = possible in look
 * order (`warm[0, near)` fetched before the tag preloads, the rest after), `hope` = d2 then d3; the certain / possible
 * split and the distance stay build-only.
 */
export type ShotWindow = {
  readonly need: readonly AssetId[];
  readonly warm: readonly AssetId[];
  readonly near: number;
  readonly hope: readonly AssetId[];
};
/** The image table and the windows that index it; keys: a line ID, `k:<knot>` or `r:<room>`. */
export type LookIndex = {
  readonly images: readonly AssetId[];
  readonly windows: Readonly<Record<string, readonly [need: readonly number[], warm: readonly number[], near: number, hope: readonly number[]]>>;
};

const FRAMES: readonly Frame[] = ['wide', 'medium', 'close', 'ots', 'two', 'insert', 'room'];
const ID = '[a-z][a-z0-9_]*';
const ID_RE = new RegExp(`^${ID}$`);
/** A shot file of a rig: `sheet/<shot>`, `face|talk/<shot>/<char>/<expr>`. */
const SHOT_FILE_RE = new RegExp(`^(?:sheet/(${ID})|(face|talk)/(${ID})/(${ID})/${ID})$`);
/** The image ids a window may hold (catalog.ts `ASSET_ID_RE`'s image namespaces, covers excepted). */
const IMAGE_ID_RE = new RegExp(`^(?:(?:bg|cg|prop|sheet)/${ID}|char/${ID}/${ID}|(?:face|talk)/${ID}/${ID}/${ID})$`);
/** A window key: a line ID (tags.ts `LINE_ID_RE`), `k:<knot>` or `r:<room>`. */
const WINDOW_KEY_RE = new RegExp(`^(?:ch[1-9][0-9]*\\.${ID}\\.[0-9a-z]{4}|[kr]:${ID})$`);
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
/** The two plateau lattices and the depth grid (§4.2 steps 5-6). */
const PLATEAU_BITS = 25 * 47;
const COARSE_BITS = 13 * 24;
const DEPTH_BYTES = 13 * 24;
const MAX_LOOP_FRAMES = 12;

type Raw = Readonly<Record<string, unknown>>;
type Issues = string[];

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function at(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

/** An object with exactly `keys` (plus any of `optional`); else null, every problem reported. */
function exact(v: unknown, path: string, issues: Issues, keys: readonly string[], optional: readonly string[] = []): Raw | null {
  if (!isObject(v)) {
    issues.push(`${path}: not an object`);
    return null;
  }
  const before = issues.length;
  for (const k of Object.keys(v).filter((x) => !keys.includes(x) && !optional.includes(x))) {
    issues.push(`${at(path, k)}: unknown key (expected ${[...keys, ...optional].join(', ')})`);
  }
  for (const k of keys.filter((x) => !Object.hasOwn(v, x))) {
    issues.push(`${at(path, k)}: missing`);
  }
  return issues.length === before ? v : null;
}

function int(v: unknown, path: string, issues: Issues, min = 0): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
    issues.push(`${path}: ${JSON.stringify(v) ?? 'undefined'} is not an integer >= ${min}`);
    return null;
  }
  return v;
}

function num(v: unknown, path: string, issues: Issues, min = -Infinity, max = Infinity): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    issues.push(`${path}: ${JSON.stringify(v) ?? 'undefined'} is not a number in ${min}..${max}`);
    return null;
  }
  return v;
}

function bool(v: unknown, path: string, issues: Issues): boolean | null {
  if (typeof v !== 'boolean') {
    issues.push(`${path}: not a boolean`);
    return null;
  }
  return v;
}

function oneOf<T extends string>(v: unknown, all: readonly T[], path: string, issues: Issues): T | null {
  const hit = all.find((x) => x === v);
  if (hit === undefined) {
    issues.push(`${path}: ${JSON.stringify(v) ?? 'undefined'} is not one of ${all.join(', ')}`);
    return null;
  }
  return hit;
}

function list(v: unknown, path: string, issues: Issues): readonly unknown[] | null {
  if (!Array.isArray(v)) {
    issues.push(`${path}: not an array`);
    return null;
  }
  return v;
}

/** A box: four non-negative integers. */
function box(v: unknown, path: string, issues: Issues): Box | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) {
    issues.push(`${path}: ${JSON.stringify(v) ?? 'undefined'} is not a box [x, y, w, h] of non-negative integers`);
    return null;
  }
  return [v[0], v[1], v[2], v[3]] as Box; // four checked integers
}

function point(v: unknown, path: string, issues: Issues): readonly [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    issues.push(`${path}: ${JSON.stringify(v) ?? 'undefined'} is not a point [x, y]`);
    return null;
  }
  return [v[0], v[1]] as const;
}

/** base64 of exactly `bytes` bytes (the writer pads nothing it does not need). */
function base64(v: unknown, bytes: number, path: string, issues: Issues): string | null {
  const length = Math.ceil(bytes / 3) * 4;
  if (typeof v !== 'string' || v.length !== length || !BASE64_RE.test(v)) {
    issues.push(`${path}: not base64 of ${bytes} bytes (${length} characters)`);
    return null;
  }
  return v;
}

type Plate = { readonly shot: string; readonly char: string | null; readonly w: number; readonly h: number };

/** A member: its file one of this shot's (a face or talk file of this character's), its plate box on the plate. */
function member(v: unknown, path: string, issues: Issues, plate: Plate): Member | null {
  const o = exact(v, path, issues, ['file', 'frame', 'at'], ['masked']);
  if (o === null) {
    return null;
  }
  const before = issues.length;
  const file = o['file'];
  const m = typeof file === 'string' ? SHOT_FILE_RE.exec(file) : null;
  const shot = m?.[1] ?? m?.[3];
  const char = m?.[4];
  if (m === null || shot !== plate.shot || (char !== undefined && char !== plate.char)) {
    const whose = plate.char === null ? '' : ` or ${plate.char}'s face / talk file`;
    issues.push(`${path}.file: ${JSON.stringify(file) ?? 'undefined'} is not sheet/${plate.shot}${whose} of ${plate.shot}`);
  }
  const frame = box(o['frame'], `${path}.frame`, issues);
  const atBox = box(o['at'], `${path}.at`, issues);
  if (atBox !== null && (atBox[0] + atBox[2] > plate.w || atBox[1] + atBox[3] > plate.h)) {
    issues.push(`${path}.at: ${JSON.stringify(atBox)} is past the ${plate.w} × ${plate.h} plate`);
  }
  if (Object.hasOwn(o, 'masked') && o['masked'] !== true) {
    issues.push(`${path}.masked: only true (absent: a rectangle)`);
  }
  if (issues.length !== before || frame === null || atBox === null) {
    return null;
  }
  return { file: file as AssetId, frame, at: atBox, ...(o['masked'] === true ? { masked: true as const } : {}) }; // matched SHOT_FILE_RE
}

function pairOf(v: unknown, path: string, issues: Issues, plate: Plate): { half: Member; closed: Member } | null {
  const o = exact(v, path, issues, ['half', 'closed']);
  if (o === null) {
    return null;
  }
  const half = member(o['half'], `${path}.half`, issues, plate);
  const closed = member(o['closed'], `${path}.closed`, issues, plate);
  return half === null || closed === null ? null : { half, closed };
}

function motionSet(v: unknown, path: string, issues: Issues, plate: Plate): MotionSet | null {
  const o = exact(v, path, issues, ['blink', 'talk', 'accent'], ['joint']);
  if (o === null) {
    return null;
  }
  const before = issues.length;
  const blink = pairOf(o['blink'], `${path}.blink`, issues, plate);
  const talk = (list(o['talk'], `${path}.talk`, issues) ?? []).map((t, i) => member(t, `${path}.talk.${i}`, issues, plate));
  const accent = member(o['accent'], `${path}.accent`, issues, plate);
  const joint = Object.hasOwn(o, 'joint') ? pairOf(o['joint'], `${path}.joint`, issues, plate) : undefined;
  if (issues.length !== before || blink === null || accent === null || joint === null) {
    return null;
  }
  return { blink, talk: talk.filter((t): t is Member => t !== null), accent, ...(joint === undefined ? {} : { joint }) };
}

function faceRig(v: unknown, path: string, issues: Issues, plate: Plate): FaceRig | null {
  const o = exact(v, path, issues, ['rest', 'exprs', 'head']);
  if (o === null) {
    return null;
  }
  const before = issues.length;
  const rest = o['rest'];
  if (typeof rest !== 'string' || !ID_RE.test(rest)) {
    issues.push(`${path}.rest: not an expression id`);
  }
  const exprs: Record<string, { layer: Member | null; motion: MotionSet }> = {};
  const rawExprs = o['exprs'];
  if (!isObject(rawExprs)) {
    issues.push(`${path}.exprs: not an object`);
  }
  for (const [x, e] of Object.entries(isObject(rawExprs) ? rawExprs : {})) {
    const ep = `${path}.exprs.${x}`;
    const eo = ID_RE.test(x) ? exact(e, ep, issues, ['layer', 'motion']) : null;
    if (!ID_RE.test(x)) {
      issues.push(`${ep}: not an expression id`);
    }
    if (eo === null) {
      continue;
    }
    // The rest expression has no layer (the plate shows it); every other expression has one.
    const known = issues.length;
    let layer: Member | null = null;
    if (eo['layer'] === null) {
      if (x !== rest) {
        issues.push(`${ep}.layer: null only for the rest expression`);
      }
    } else {
      layer = member(eo['layer'], `${ep}.layer`, issues, plate);
      if (x === rest) {
        issues.push(`${ep}.layer: the rest expression has none (null)`);
      }
    }
    const motion = motionSet(eo['motion'], `${ep}.motion`, issues, plate);
    if (issues.length === known && motion !== null) {
      exprs[x] = { layer, motion };
    }
  }
  if (typeof rest === 'string' && isObject(rawExprs) && !Object.hasOwn(rawExprs, rest)) {
    issues.push(`${path}.exprs: no entry for the rest expression ${rest}`);
  }
  const head = box(o['head'], `${path}.head`, issues);
  if (issues.length !== before || head === null) {
    return null;
  }
  return { rest: rest as ExprId, exprs: exprs as FaceRig['exprs'], head }; // ids checked by ID_RE above
}

function castRig(v: unknown, path: string, issues: Issues, shot: string, w: number, h: number): (CastRig & { char: CharId }) | null {
  const keys = ['char', 'view', 'face', 'body', 'headDepth', 'plateau', 'plateauCoarse', 'band', 'group', 'figure', 'hair'];
  const o = exact(v, path, issues, keys);
  if (o === null) {
    return null;
  }
  const before = issues.length;
  const char = o['char'];
  if (typeof char !== 'string' || !ID_RE.test(char)) {
    issues.push(`${path}.char: not a character id`);
  }
  const plate: Plate = { shot, char: typeof char === 'string' ? char : null, w, h };
  const view = oneOf(o['view'], ['face', 'back'] as const, `${path}.view`, issues);
  // A face member has its face rig; a back view has none (§2.1: hair locks only).
  let face: FaceRig | null = null;
  if (view === 'face') {
    face = o['face'] === null ? null : faceRig(o['face'], `${path}.face`, issues, plate);
    if (o['face'] === null) {
      issues.push(`${path}.face: a face member needs its face rig`);
    }
  } else if (view === 'back' && o['face'] !== null) {
    issues.push(`${path}.face: a back view has no face rig (null)`);
  }
  const b = exact(o['body'], `${path}.body`, issues, ['cx', 'cy', 'rx', 'ry', 'rot', 'feet']);
  const body =
    b === null
      ? null
      : {
          cx: num(b['cx'], `${path}.body.cx`, issues, 0),
          cy: num(b['cy'], `${path}.body.cy`, issues, 0),
          rx: num(b['rx'], `${path}.body.rx`, issues, 0),
          ry: num(b['ry'], `${path}.body.ry`, issues, 0),
          rot: num(b['rot'], `${path}.body.rot`, issues),
          feet: point(b['feet'], `${path}.body.feet`, issues),
        };
  const headDepth = num(o['headDepth'], `${path}.headDepth`, issues, 0, 1);
  const plateau = base64(o['plateau'], Math.ceil(PLATEAU_BITS / 8), `${path}.plateau`, issues);
  const plateauCoarse = base64(o['plateauCoarse'], Math.ceil(COARSE_BITS / 8), `${path}.plateauCoarse`, issues);
  const band = num(o['band'], `${path}.band`, issues, 0);
  const group = int(o['group'], `${path}.group`, issues);
  const figure = o['figure'] === null ? null : member(o['figure'], `${path}.figure`, issues, plate);
  const rawHair = list(o['hair'], `${path}.hair`, issues);
  if (rawHair !== null && rawHair.length === 0) {
    issues.push(`${path}.hair: empty (R9: every cast member has a hair lock)`);
  }
  const hair = (rawHair ?? []).map((x, i) => {
    const hp = `${path}.hair.${i}`;
    const ho = exact(x, hp, issues, ['member', 'pivot']);
    const m = ho === null ? null : member(ho['member'], `${hp}.member`, issues, plate);
    const pivot = ho === null ? null : point(ho['pivot'], `${hp}.pivot`, issues);
    return m === null || pivot === null ? null : { member: m, pivot };
  });
  if (issues.length !== before || view === null || body === null || headDepth === null || plateau === null || plateauCoarse === null || band === null || group === null) {
    return null;
  }
  return {
    char: char as CharId, // checked by ID_RE above
    view,
    face,
    body: body as CastRig['body'], // every field reported above when it did not decode
    headDepth,
    plateau,
    plateauCoarse,
    band,
    group,
    figure,
    hair: hair.filter((x): x is { member: Member; pivot: readonly [number, number] } => x !== null),
  };
}

function ambientRig(v: unknown, path: string, issues: Issues, plate: Plate): AmbientRig | null {
  const kind = isObject(v) ? v['kind'] : undefined;
  const z = (o: Raw): 'back' | 'front' | null => oneOf(o['z'], ['back', 'front'] as const, `${path}.z`, issues);
  switch (kind) {
    case 'flicker': {
      const o = exact(v, path, issues, ['kind', 'member', 'amp', 'hz', 'z']);
      if (o === null) {
        return null;
      }
      const m = member(o['member'], `${path}.member`, issues, plate);
      const amp = num(o['amp'], `${path}.amp`, issues, 0, 1);
      const hz = num(o['hz'], `${path}.hz`, issues, 0);
      const zz = z(o);
      return m === null || amp === null || hz === null || zz === null ? null : { kind, member: m, amp, hz, z: zz };
    }
    case 'loop': {
      const o = exact(v, path, issues, ['kind', 'frames', 'fps', 'z']);
      if (o === null) {
        return null;
      }
      const before = issues.length;
      const frames = (list(o['frames'], `${path}.frames`, issues) ?? []).map((f, i) => member(f, `${path}.frames.${i}`, issues, plate));
      const fps = int(o['fps'], `${path}.fps`, issues, 1);
      const zz = z(o);
      return issues.length !== before || fps === null || zz === null ? null : { kind, frames: frames.filter((f): f is Member => f !== null), fps, z: zz };
    }
    case 'particles': {
      const o = exact(v, path, issues, ['kind', 'preset', 'sprite', 'rect', 'count']);
      if (o === null) {
        return null;
      }
      const preset = oneOf(o['preset'], ['dust', 'rain', 'snow', 'embers'] as const, `${path}.preset`, issues);
      const sprite = member(o['sprite'], `${path}.sprite`, issues, plate);
      const rect = box(o['rect'], `${path}.rect`, issues);
      const count = int(o['count'], `${path}.count`, issues, 1);
      return preset === null || sprite === null || rect === null || count === null ? null : { kind, preset, sprite, rect, count };
    }
    case 'sway': {
      const o = exact(v, path, issues, ['kind', 'plane', 'amp']);
      if (o === null) {
        return null;
      }
      const plane = int(o['plane'], `${path}.plane`, issues);
      const amp = num(o['amp'], `${path}.amp`, issues, 0);
      return plane === null || amp === null ? null : { kind, plane, amp };
    }
    default:
      issues.push(`${path}.kind: ${JSON.stringify(kind) ?? 'undefined'} is not one of flicker, loop, particles, sway`);
      return null;
  }
}

function shotRig(v: unknown, path: string, issues: Issues, shot: string): ShotRig | null {
  const o = exact(v, path, issues, ['w', 'h', 'frame', 'focus', 'cast', 'planes', 'ambient', 'depth']);
  if (o === null) {
    return null;
  }
  const before = issues.length;
  const w = int(o['w'], `${path}.w`, issues, 1);
  const h = int(o['h'], `${path}.h`, issues, 1);
  const frame = oneOf(o['frame'], FRAMES, `${path}.frame`, issues);
  const focus = point(o['focus'], `${path}.focus`, issues);
  const plate: Plate = { shot, char: null, w: w ?? 0, h: h ?? 0 };
  const cast = (list(o['cast'], `${path}.cast`, issues) ?? []).map((c, i) => castRig(c, `${path}.cast.${i}`, issues, shot, plate.w, plate.h));
  const planes = (list(o['planes'], `${path}.planes`, issues) ?? []).map((p, i) => {
    const pp = `${path}.planes.${i}`;
    const po = exact(p, pp, issues, ['member', 'depth', 'pivot', 'front']);
    if (po === null) {
      return null;
    }
    const m = member(po['member'], `${pp}.member`, issues, plate);
    const depth = num(po['depth'], `${pp}.depth`, issues, 0, 1);
    const pivot = point(po['pivot'], `${pp}.pivot`, issues);
    const front = bool(po['front'], `${pp}.front`, issues);
    return m === null || depth === null || pivot === null || front === null ? null : { member: m, depth, pivot, front };
  });
  const ambient = (list(o['ambient'], `${path}.ambient`, issues) ?? []).map((a, i) => ambientRig(a, `${path}.ambient.${i}`, issues, plate));
  const depth = base64(o['depth'], DEPTH_BYTES, `${path}.depth`, issues);
  if (issues.length !== before || w === null || h === null || frame === null || focus === null || depth === null) {
    return null;
  }
  const kept = <T>(xs: readonly (T | null)[]): T[] => xs.filter((x): x is T => x !== null);
  return { w, h, frame, focus, cast: kept(cast), planes: kept(planes), ambient: kept(ambient), depth };
}

/** Decodes a manifest's `shots`: one rig per shot id, exact keys at every level; every problem reported. */
export function decodeShotRigs(raw: unknown): Result<ReadonlyMap<BgId, ShotRig>, string[]> {
  const issues: Issues = [];
  if (!isObject(raw)) {
    return { ok: false, error: ['shots: not an object'] };
  }
  const out = new Map<BgId, ShotRig>();
  for (const [s, v] of Object.entries(raw)) {
    if (!ID_RE.test(s)) {
      issues.push(`${s}: not a shot id`);
      continue;
    }
    const rig = shotRig(v, s, issues, s);
    if (rig !== null) {
      out.set(s as BgId, rig); // checked by ID_RE above
    }
  }
  return issues.length > 0 ? { ok: false, error: issues } : { ok: true, value: out };
}

/** Decodes a manifest's `loops`: per loop prop, 1..12 frame boxes of its atlas and a positive integer fps. */
export function decodeLoops(raw: unknown): Result<ReadonlyMap<PropId, LoopRig>, string[]> {
  const issues: Issues = [];
  if (!isObject(raw)) {
    return { ok: false, error: ['loops: not an object'] };
  }
  const out = new Map<PropId, LoopRig>();
  for (const [p, v] of Object.entries(raw)) {
    if (!ID_RE.test(p)) {
      issues.push(`${p}: not a prop id`);
      continue;
    }
    const o = exact(v, p, issues, ['frames', 'fps']);
    if (o === null) {
      continue;
    }
    const before = issues.length;
    const rawFrames = list(o['frames'], `${p}.frames`, issues);
    if (rawFrames !== null && (rawFrames.length === 0 || rawFrames.length > MAX_LOOP_FRAMES)) {
      issues.push(`${p}.frames: ${rawFrames.length} frames (a loop has 1..${MAX_LOOP_FRAMES})`);
    }
    const frames = (rawFrames ?? []).map((f, i) => box(f, `${p}.frames.${i}`, issues));
    const fps = int(o['fps'], `${p}.fps`, issues, 1);
    if (issues.length === before && fps !== null) {
      out.set(p as PropId, { frames: frames.filter((f): f is Box => f !== null), fps }); // checked by ID_RE above
    }
  }
  return issues.length > 0 ? { ok: false, error: issues } : { ok: true, value: out };
}

/** Decodes a manifest's `look`: a table of image ids, once each, and windows of indices into it; `near` <= warm's length. */
export function decodeLook(raw: unknown): Result<LookIndex, string[]> {
  const issues: Issues = [];
  if (!isObject(raw)) {
    return { ok: false, error: ['look: not an object'] };
  }
  const o = exact(raw, '', issues, ['images', 'windows']);
  if (o === null) {
    return { ok: false, error: issues };
  }
  const images: string[] = [];
  (list(o['images'], 'images', issues) ?? []).forEach((v, i) => {
    if (typeof v !== 'string' || !IMAGE_ID_RE.test(v)) {
      issues.push(`images.${i}: ${JSON.stringify(v) ?? 'undefined'} is not an image id`);
    } else if (images.includes(v)) {
      issues.push(`images.${i}: ${v} is in the table twice`);
    }
    images.push(typeof v === 'string' ? v : '');
  });
  const windows: Record<string, readonly [number[], number[], number, number[]]> = {};
  const rawWindows = o['windows'];
  if (!isObject(rawWindows)) {
    issues.push('windows: not an object');
  }
  for (const [k, w] of Object.entries(isObject(rawWindows) ? rawWindows : {})) {
    const wp = `windows.${k}`;
    if (!WINDOW_KEY_RE.test(k)) {
      issues.push(`${wp}: not a line ID, k:<knot> or r:<room>`);
      continue;
    }
    if (!Array.isArray(w) || w.length !== 4) {
      issues.push(`${wp}: not [need, warm, near, hope]`);
      continue;
    }
    const before = issues.length;
    const slot = (v: unknown, n: number): number[] =>
      (list(v, `${wp}.${n}`, issues) ?? []).flatMap((x, i) => {
        if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x >= images.length) {
          issues.push(`${wp}.${n}.${i}: ${JSON.stringify(x) ?? 'undefined'} is not an index of the ${images.length} images`);
          return [];
        }
        return [x];
      });
    const need = slot(w[0], 0);
    const warm = slot(w[1], 1);
    const near = int(w[2], `${wp}.2`, issues);
    if (near !== null && near > warm.length) {
      issues.push(`${wp}.2: ${near} is more than the ${warm.length} warm files`);
    }
    const hope = slot(w[3], 3);
    if (issues.length === before && near !== null) {
      windows[k] = [need, warm, near, hope];
    }
  }
  return issues.length > 0 ? { ok: false, error: issues } : { ok: true, value: { images: images as AssetId[], windows } }; // images matched IMAGE_ID_RE
}

/** The window of a step (`<line ID>`, `k:<knot>`) or a room (`r:<room>`) as asset ids; null when the look has none. */
export function stepWindow(look: LookIndex, key: string): ShotWindow | null {
  const w = Object.hasOwn(look.windows, key) ? look.windows[key] : undefined;
  if (w === undefined) {
    return null;
  }
  const ids = (xs: readonly number[]): AssetId[] => xs.flatMap((i) => look.images[i] ?? []);
  return { need: ids(w[0]), warm: ids(w[1]), near: w[2], hope: ids(w[3]) };
}

/**
 * A room's whole shot for the neighbour preload (I-16): its plate and, when the chapter has one, its sheet; never a face
 * or talk file (a room is entered at rest). A manifest holds its own chapter's files only, so the sheet entry exists
 * exactly when the shot has a sheet there; no rig is decoded on this path.
 */
export function shotImages(manifest: AssetManifest, bg: BgId): readonly AssetId[] {
  const sheet = `sheet/${bg}` as AssetId; // a shot id makes a sheet id
  return Object.hasOwn(manifest.assets, sheet) ? [`bg/${bg}` as AssetId, sheet] : [`bg/${bg}` as AssetId];
}

/** What a chapter's rigs answer for a `face:` tag (§5.2): a character with a face rig, and its expressions. */
export function faceIndex(rigs: ReadonlyMap<BgId, ShotRig>): { hasChar(c: string): boolean; hasExpr(c: string, e: string): boolean } {
  const faces = [...rigs.values()].flatMap((r) => r.cast.flatMap((m) => (m.face === null ? [] : [[m.char as string, m.face] as const])));
  return {
    hasChar: (c) => faces.some(([char]) => char === c),
    hasExpr: (c, e) => faces.some(([char, face]) => char === c && Object.hasOwn(face.exprs, e)),
  };
}
