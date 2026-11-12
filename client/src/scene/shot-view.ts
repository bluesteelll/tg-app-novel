// The shot view (docs/plans/shots §5.1-5.2, lane SH4): a shot's rest framing on the stage, the drawn members of its
// faces and the files a stage of it holds, from the chapter manifest's rigs (story/shots.ts). Pure: no Pixi, no GSAP;
// the executor draws what it plans, the stage route ensures what it names.
import { cover } from '../geom/cover.ts';
import type { Size } from '../geom/cover.ts';
import type { AssetManifest } from '../story/catalog.ts';
import { decodeShotRigs } from '../story/shots.ts';
import type { Box, FaceRig, ShotRig } from '../story/shots.ts';
import type { AssetId, BgId, CharId, ExprId } from '../story/staging.ts';
import type { SceneSnapshot } from './executor.ts';

/** Plate px to stage px: stage = plate × k + (x, y). */
export type StageXform = { readonly x: number; readonly y: number; readonly k: number };
/** One drawn member: an expression's layer, a hair lock over it, or a figure plane (`expr` null for the last two). */
export type LayerPlan = {
  readonly char: CharId;
  readonly expr: ExprId | null;
  readonly kind: 'layer' | 'hair' | 'figure';
  readonly file: AssetId;
  readonly frame: Box;
  readonly at: Box;
};

/** §5.4: the rest overscan's ceiling, and the push's. */
const MAX_OVERSCAN = 1.03;
const MAX_PUSH = 1.3;

/** Device px per plate px at cover() (×2 on the half tier, whose texture has half the px). */
function kDev(rig: ShotRig, stage: Size, resolution: number, half: boolean): number {
  return cover(stage, rig).scale * resolution * (half ? 2 : 1);
}

/** z0 = room ? 1 : clamp(1 / kDev, 1, 1.03): never a zoom past the plate's own px, never a zoom-out. */
export function overscan(rig: ShotRig, stage: Size, resolution: number, half: boolean): number {
  return rig.frame === 'room' ? 1 : Math.min(MAX_OVERSCAN, Math.max(1, 1 / kDev(rig, stage, resolution, half)));
}

/** The zoom over cover(): [z0, max(z0, min(1.30, 1 / kDev))]; equal ends: no push on this stage (SH6 reads it). */
export function zoomRange(rig: ShotRig, stage: Size, resolution: number, half: boolean): { min: number; max: number } {
  const z0 = overscan(rig, stage, resolution, half);
  return { min: z0, max: Math.max(z0, Math.min(MAX_PUSH, 1 / kDev(rig, stage, resolution, half))) };
}

/** Per side, how far the plate at `x.k` reaches past the stage on each axis (never negative). */
export function slack(rig: ShotRig, stage: Size, x: StageXform): { sx: number; sy: number } {
  return { sx: Math.max(0, (rig.w * x.k - stage.w) / 2), sy: Math.max(0, (rig.h * x.k - stage.h) / 2) };
}

/**
 * cover() × z0, the crop moved toward the rig's focus inside the slack. A `room` frame is cover() exactly (z0 = 1,
 * centred), so it equals backdropPlacement and the props mapping.
 */
export function restFraming(rig: ShotRig, stage: Size, resolution: number, half: boolean): StageXform {
  const c = cover(stage, rig);
  if (rig.frame === 'room') {
    return { x: c.offsetX, y: c.offsetY, k: c.scale };
  }
  const k = c.scale * overscan(rig, stage, resolution, half);
  const centred = { x: (stage.w - rig.w * k) / 2, y: (stage.h - rig.h * k) / 2, k };
  const { sx, sy } = slack(rig, stage, centred);
  // The focus moves toward the stage centre, as far as the slack lets it.
  const toward = (centre: number, focus: number, at: number, s: number): number => at + Math.min(s, Math.max(-s, centre - (focus * k + at)));
  return { x: toward(stage.w / 2, rig.focus[0], centred.x, sx), y: toward(stage.h / 2, rig.focus[1], centred.y, sy), k };
}

/** A face member's expression on `faces`: its entry when the rig has it, else its rest (drawn at rest, no slot). */
function exprOf(face: FaceRig, x: ExprId | undefined): ExprId {
  return x !== undefined && Object.hasOwn(face.exprs, x) ? x : face.rest;
}

/**
 * The drawn members, back to front: per cast member its figure plane (where it has one), then, for a face not at its
 * rest, that expression's own layer and the member's hair locks. A face at rest lists nothing (the plate shows it), and
 * no member of another expression's set is ever listed (RULINGS 273 O2). Motion members are SH7's: when it draws them,
 * they come from the same expression's `MotionSet` here.
 */
export function faceLayers(rig: ShotRig, faces: ReadonlyMap<CharId, ExprId>): readonly LayerPlan[] {
  const out: LayerPlan[] = [];
  for (const m of rig.cast) {
    if (m.figure !== null) {
      out.push({ char: m.char, expr: null, kind: 'figure', ...m.figure });
    }
    if (m.face === null) {
      continue;
    }
    const x = exprOf(m.face, faces.get(m.char));
    const layer = m.face.exprs[x]?.layer ?? null;
    if (x === m.face.rest || layer === null) {
      continue;
    }
    out.push({ char: m.char, expr: x, kind: 'layer', file: layer.file, frame: layer.frame, at: layer.at });
    for (const h of m.hair) {
      out.push({ char: m.char, expr: null, kind: 'hair', file: h.member.file, frame: h.member.frame, at: h.member.at });
    }
  }
  return out;
}

/** The faces a stage shows: its `chars` entries by character. */
export function facesOf(s: SceneSnapshot): ReadonlyMap<CharId, ExprId> {
  return new Map(s.chars.map((c) => [c.char, c.expr]));
}

/**
 * The files a stage of this shot holds, by slot (§5.2, rev. 5): `bg` its plate; `sheet` when a visible face is not at
 * rest or the shot has cut-outs; `face:<c>` the face file of a face not at rest; `talk:<c>` the first talk file of the
 * face's expression, rest included. The executor's slots and the stage route's ensure both read it.
 */
export function shotSlots(rig: ShotRig, s: SceneSnapshot): Map<string, AssetId> {
  // The brands hold: the shot id is the stage's bg, and every member file is one the manifest decoder admitted.
  const out = new Map<string, AssetId>();
  const bg = s.bg ?? '';
  out.set('bg', `bg/${bg}` as AssetId);
  const faces = facesOf(s);
  let sheet = rig.planes.length > 0;
  for (const m of rig.cast) {
    sheet ||= m.figure !== null;
    if (m.face === null) {
      continue;
    }
    const x = exprOf(m.face, faces.get(m.char));
    const e = m.face.exprs[x];
    if (x !== m.face.rest && e?.layer) {
      sheet = true;
      out.set(`face:${m.char}`, e.layer.file);
    }
    const talk = e?.motion.talk[0];
    if (talk !== undefined) {
      out.set(`talk:${m.char}`, talk.file);
    }
  }
  if (sheet) {
    out.set('sheet', `sheet/${bg}` as AssetId);
  }
  return out;
}

const decoded = new WeakMap<AssetManifest, ReadonlyMap<BgId, ShotRig> | null>();

/**
 * A chapter's shot rigs, or null for a legacy chapter: no `shots`, `shots` that do not decode (logged once; the chapter
 * then plays on sprites), or no rig with a cast (STAGING-DSL §14.1: a chapter whose every shot is cast-less is legacy).
 * Memoised per manifest object.
 */
export function chapterRigs(m: AssetManifest): ReadonlyMap<BgId, ShotRig> | null {
  if (decoded.has(m)) {
    return decoded.get(m) ?? null;
  }
  let rigs: ReadonlyMap<BgId, ShotRig> | null = null;
  if (m.shots !== undefined) {
    const r = decodeShotRigs(m.shots);
    if (!r.ok) {
      console.error(`scene: ${m.chapterId}'s shot rigs do not decode`, r.error);
    } else if ([...r.value.values()].some((rig) => rig.cast.length > 0)) {
      rigs = r.value;
    }
  }
  decoded.set(m, rigs);
  return rigs;
}
