// Where a story step's commands go and which images they name: the routing GameSession applies to every batch, kept
// out of game.ts so that lanes adding a tag kind (the shots plan's SH1 onward) leave game.ts alone.
import type { AudioCommand } from '../audio/manager.ts';
import { reduce } from '../scene/executor.ts';
import type { SceneSnapshot, VisualCommand } from '../scene/executor.ts';
import { EMPTY_WINDOW } from '../scene/preload.ts';
import type { StageWindow } from '../scene/preload.ts';
import { chapterRigs, shotSlots } from '../scene/shot-view.ts';
import type { AssetManifest, Result } from '../story/catalog.ts';
import { decodeLook, faceIndex, stepWindow } from '../story/shots.ts';
import type { LookIndex, ShotWindow } from '../story/shots.ts';
import type { AssetId, AssetIndex, BgId, StagingCommand } from '../story/staging.ts';

const IMAGE_ID = /^(?:bg|cg|char|prop)\//;

/**
 * D14: the AssetIndex `parseTags` checks a loaded chapter's tags against: the keys of its own manifest, never
 * assets/catalog.json (outside src/, and naming paid-only assets). The story gate checked every tag against the catalog.
 * A shot chapter's faces also answer from its own rigs (shots §5.2), so a `face:` validates without a sprite.
 */
export function manifestIndex(m: AssetManifest): AssetIndex {
  const has = (id: string): boolean => Object.hasOwn(m.assets, id);
  const chars = new Set(Object.keys(m.assets).flatMap((k) => (k.startsWith('char/') ? [k.split('/')[1] ?? ''] : [])));
  const rigs = chapterRigs(m);
  const faces = rigs === null ? null : faceIndex(rigs);
  return {
    hasBg: (id) => has(`bg/${id}`),
    hasExpr: (char, expr) => has(`char/${char}/${expr}`) || faces?.hasExpr(char, expr) === true,
    hasChar: (id) => chars.has(id) || faces?.hasChar(id) === true,
    hasCg: (id) => has(`cg/${id}`),
    hasTrack: (id) => has(`bgm/${id}`),
    hasSfx: (id) => has(`sfx/${id}`),
  };
}

/**
 * A batch's commands by consumer (F2): the scene's, the audio's, and `think` for the session (a line nobody speaks
 * aloud: the shots plan's SH7 reads it); a yield is its step's own, never a command here.
 */
export function splitBatch(cmds: readonly StagingCommand[]): { visual: VisualCommand[]; audio: AudioCommand[]; think: boolean } {
  const visual: VisualCommand[] = [];
  const audio: AudioCommand[] = [];
  let think = false;
  for (const c of cmds) {
    switch (c.kind) {
      case 'bgm':
      case 'sfx':
        audio.push(c);
        break;
      case 'bg':
      case 'scene':
      case 'show':
      case 'hide':
      case 'cg':
      case 'wait':
      case 'face':
      case 'cam':
      case 'anim':
      case 'fx':
        visual.push(c);
        break;
      case 'think':
        think = true;
        break;
      case 'puzzle':
      case 'explore':
        break;
      default: {
        const _never: never = c;
        return _never;
      }
    }
  }
  return { visual, audio, think };
}

/**
 * The image asset ids a visual batch shows (STAGING-DSL §8), for `ensure`. With the stage before the batch and the
 * chapter's manifest, a shot chapter's batch that cuts or changes a face names its shot's drawn files (shots §5.2,
 * rev. 4 W4): the shot in effect after the cut, with the persisted faces, gives the plate, the sheet by its rule and
 * every visible face file not at rest; never a talk file (motion, never awaited). Else the ids are the sprite stage's.
 */
export function imageIds(cmds: readonly VisualCommand[], ctx?: { stage: SceneSnapshot; manifest: AssetManifest | null }): AssetId[] {
  // The brands hold: parseTags and the world decoder admit only ids the chapter's manifest lists.
  const rigs = ctx?.manifest ? chapterRigs(ctx.manifest) : null;
  const s = ctx !== undefined && rigs !== null ? reduce(ctx.stage, cmds, true) : null;
  const rig = s?.bg ? rigs?.get(s.bg) : undefined;
  const drawn = s !== null && rig !== undefined && cmds.some((c) => c.kind === 'bg' || c.kind === 'scene' || c.kind === 'face');
  const out: AssetId[] = drawn ? [...shotSlots(rig, s)].flatMap(([slot, id]) => (slot.startsWith('talk:') ? [] : [id])) : [];
  for (const c of cmds) {
    if (c.kind === 'bg' || c.kind === 'scene') {
      if (rig === undefined) {
        out.push(`bg/${c.bg}` as AssetId);
      }
    } else if (c.kind === 'show' || (c.kind === 'face' && rigs === null)) {
      // On a sprite stage a face is a show without `at`: its expression's sprite, ensured before the line.
      out.push(`char/${c.char}/${c.expr}` as AssetId);
    } else if (c.kind === 'cg' && c.cg !== null) {
      out.push(`cg/${c.cg}` as AssetId);
    } else if (c.kind === 'props') {
      out.push(...c.props.map((p) => `prop/${p.prop}` as AssetId));
    }
  }
  return out;
}

/** A knot's preload ids by consumer: images for the scene, the rest (bgm, sfx) for the audio. */
export function knotAssets(ids: readonly AssetId[]): { images: AssetId[]; sounds: AssetId[] } {
  return { images: ids.filter((id) => IMAGE_ID.test(id)), sounds: ids.filter((id) => !IMAGE_ID.test(id)) };
}

/** Where a step stands in the explore world: the yields' world state's section and room, null outside a section. */
export type WorldAt = { readonly section: string | null; readonly room: string | null };

/** Each manifest's look, decoded once (shots §4.5); the manifest object is the chapter's for its whole life. */
const looks = new WeakMap<AssetManifest, Result<LookIndex, string[]>>();

/** The chapter's look; not ok when the manifest has none or it does not decode (a legacy step then holds today's preloads). */
export function lookOf(m: AssetManifest): Result<LookIndex, string[]> {
  const have = looks.get(m);
  if (have !== undefined) {
    return have;
  }
  const r: Result<LookIndex, string[]> = m.look === undefined ? { ok: false, error: ['look: absent'] } : decodeLook(m.look);
  looks.set(m, r);
  return r;
}

/**
 * The event's room (shots §5.8): `w` with, as its own class `eventRoom`, the room window's need files that `w` lists in
 * no class, in order; none without a room window.
 */
export function withEventRoom(w: ShotWindow, room: ShotWindow | null): StageWindow {
  const listed = new Set([...w.need, ...w.warm, ...w.hope]);
  return { ...w, eventRoom: room === null ? [] : room.need.filter((id) => !listed.has(id)) };
}

/**
 * A presented step's window (shots §5.8, cut D1): its key's window in the chapter's look (a line's ID, a choice set's
 * first choice ID, a room's `r:<room>`), else its knot's index `k:<knot>`, else the empty window; with the room as
 * `eventRoom` when a section and room are current and the key is not that room's own.
 */
export function windowFor(m: AssetManifest | null, key: string | null, knot: string | null, at: WorldAt | null): StageWindow {
  const look = m === null ? null : lookOf(m);
  if (look === null || !look.ok) {
    return EMPTY_WINDOW;
  }
  const w = (key === null ? null : stepWindow(look.value, key)) ?? (knot === null ? null : stepWindow(look.value, `k:${knot}`));
  if (w === null) {
    return EMPTY_WINDOW;
  }
  const own = at === null || at.section === null || at.room === null ? null : `r:${at.room}`;
  return withEventRoom(w, own === null || own === key ? null : stepWindow(look.value, own));
}

/**
 * A room batch's window key (shots §5.8 "At each room batch"): `r:<room>` while a section is current, the batch sets no
 * CG (a close-up has none) and the look has the key; else null.
 */
export function roomWindowKey(visual: readonly VisualCommand[], at: WorldAt | null, look: LookIndex): string | null {
  if (at === null || at.section === null || at.room === null || visual.some((c) => c.kind === 'cg' && c.cg !== null)) {
    return null;
  }
  const key = `r:${at.room}`;
  return Object.hasOwn(look.windows, key) ? key : null;
}

/**
 * Room props on a story cut (shots §5.8, W8): a batch whose last `bg` / `scene` shows a room of the current section
 * gets that room's state commands appended verbatim, as `roomFor` builds them from the world; else it is unchanged.
 */
export function withRoomProps(batch: readonly VisualCommand[], roomFor: (bg: BgId) => readonly VisualCommand[] | null): VisualCommand[] {
  const cut = batch.findLast((c) => c.kind === 'bg' || c.kind === 'scene');
  const props = cut?.kind === 'bg' || cut?.kind === 'scene' ? roomFor(cut.bg) : null;
  return props === null ? [...batch] : [...batch, ...props];
}
