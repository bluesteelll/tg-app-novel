// Where a story step's commands go and which images they name: the routing GameSession applies to every batch, kept
// out of game.ts so that lanes adding a tag kind (the shots plan's SH1 onward) leave game.ts alone.
import type { AudioCommand } from '../audio/manager.ts';
import type { VisualCommand } from '../scene/executor.ts';
import type { AssetManifest } from '../story/catalog.ts';
import type { AssetId, AssetIndex, StagingCommand } from '../story/staging.ts';

const IMAGE_ID = /^(?:bg|cg|char|prop)\//;

/**
 * D14: the AssetIndex `parseTags` checks a loaded chapter's tags against: the keys of its own manifest, never
 * assets/catalog.json (outside src/, and naming paid-only assets). The story gate checked every tag against the catalog.
 */
export function manifestIndex(m: AssetManifest): AssetIndex {
  const has = (id: string): boolean => Object.hasOwn(m.assets, id);
  const chars = new Set(Object.keys(m.assets).flatMap((k) => (k.startsWith('char/') ? [k.split('/')[1] ?? ''] : [])));
  return {
    hasBg: (id) => has(`bg/${id}`),
    hasExpr: (char, expr) => has(`char/${char}/${expr}`),
    hasChar: (id) => chars.has(id),
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

/** The image asset ids a visual batch shows (STAGING-DSL §8), for `ensure`. */
export function imageIds(cmds: readonly VisualCommand[]): AssetId[] {
  // The brands hold: parseTags and the world decoder admit only ids the chapter's manifest lists.
  const out: AssetId[] = [];
  for (const c of cmds) {
    if (c.kind === 'bg' || c.kind === 'scene') {
      out.push(`bg/${c.bg}` as AssetId);
    } else if (c.kind === 'show' || c.kind === 'face') {
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
