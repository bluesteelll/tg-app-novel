// What "visible" means for a motion (engine plan §8.1, §8.5): the cue gate and per-player's value-motion gate (E-P8)
// both refuse keyframes that leave every visible property unchanged. Also the layer transitions' data (the room UI's and
// the puzzle frame's entrance and exit), which `cues/root.ts` turns into Svelte transitions. Pure (`isPureWorld`).
import { FRAME_OPEN_MS } from './types.ts';

/** The properties a viewer sees change, each with its resting value (a keyframe that omits one shows the rest). */
const VISIBLE_REST: Readonly<Record<string, string>> = {
  opacity: '1',
  transform: 'none',
  translate: 'none',
  scale: 'none',
  rotate: 'none',
  filter: 'none',
  boxShadow: 'none',
  background: 'none',
  backgroundColor: 'transparent',
  color: 'currentcolor',
};

/** Some visible property differs between two of the frames (an omitted property counts as its resting value). */
export function keyframesVisible(kf: readonly Keyframe[]): boolean {
  return Object.entries(VISIBLE_REST).some(([prop, rest]) => new Set(kf.map((f) => String(f[prop] ?? rest))).size > 1);
}

export type LayerMotion = {
  readonly keyframes: readonly Keyframe[];
  readonly ms: number;
  readonly reduced: { readonly keyframes: readonly Keyframe[]; readonly ms: number };
};

const FADE_IN: readonly Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const FADE_OUT: readonly Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

/** The room UI's and the puzzle frame's entrance and exit; the frame root leaves with `frameOut`, which lasts at least
 *  as long as every element-site end motion on the frame's wrapper inside it (gate `cues: a frame's end motion ends
 *  before its frame leaves`), so the wrapper stays attached until its end motion is over. A motion's reduced preset
 *  plays with the motion's own `ms` (§8.6), so `frameOut`'s reduced form lasts as long as its full one. */
export const LAYER_MOTIONS: { readonly in: LayerMotion; readonly out: LayerMotion; readonly frameOut: LayerMotion } = {
  in: {
    keyframes: [
      { opacity: 0, transform: 'scale(0.98)' },
      { opacity: 1, transform: 'scale(1)' },
    ],
    ms: FRAME_OPEN_MS,
    reduced: { keyframes: FADE_IN, ms: 150 },
  },
  out: {
    keyframes: [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.98)' },
    ],
    ms: 300,
    reduced: { keyframes: FADE_OUT, ms: 150 },
  },
  frameOut: {
    keyframes: [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.98)' },
    ],
    ms: 480,
    reduced: { keyframes: FADE_OUT, ms: 480 },
  },
};
