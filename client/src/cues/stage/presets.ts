// The overlay presets (engine plan §8.4): Web Animations keyframes the cue player plays on DOM. Each preset has a site:
// the target element itself, a drawing on the stage layer at the target's box, or the stage. A preset played backwards
// is its own id (`<base>-back`, the base keyframes in reverse order, the base's site), so a `MotionSpec` names one
// preset. Reduced motion plays opacity / colour presets only (§8.6). Values are CLAIM defaults, tuned with the stage.

export const PRESET_IDS = [
  'press',
  'pulse',
  'shake',
  'wobble',
  'roll',
  'breathe',
  'flourish',
  'jam',
  'lift',
  'settle',
  'unfold',
  'glint',
  'tick',
  'burst',
  'ripple',
  'iris',
  'fly',
  'drop',
  'sweep',
  'vignette',
  'dim',
  'caption',
  // Played backwards (§8.4: `tick` undraws, `pulse` / `sweep` reversed, R-E20's fold, `roll` back, `iris` out,
  // `vignette` close, `caption` out, a ghost flying from the ribbon back to its box).
  'tick-back',
  'pulse-back',
  'sweep-back',
  'unfold-back',
  'roll-back',
  'iris-back',
  'vignette-back',
  'caption-back',
  'fly-back',
  // Reduced motion: opacity only.
  'fade',
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** What a preset moves: the target element itself, a drawing on the stage layer at the target's box, or the stage. */
export type PresetSite = 'element' | 'box' | 'stage';

export const PRESET_SITE: { readonly [P in PresetId]: PresetSite } = {
  press: 'element',
  pulse: 'element',
  shake: 'element',
  wobble: 'element',
  roll: 'element',
  breathe: 'element',
  flourish: 'element',
  jam: 'element',
  lift: 'element',
  settle: 'element',
  unfold: 'element',
  glint: 'box',
  tick: 'box',
  burst: 'box',
  ripple: 'box',
  iris: 'box',
  fly: 'box',
  drop: 'box',
  sweep: 'stage',
  vignette: 'stage',
  dim: 'stage',
  caption: 'stage',
  'tick-back': 'box',
  'pulse-back': 'element',
  'sweep-back': 'stage',
  'unfold-back': 'element',
  'roll-back': 'element',
  'iris-back': 'box',
  'vignette-back': 'stage',
  'caption-back': 'stage',
  'fly-back': 'box',
  fade: 'element',
};

/** The base keyframes in reverse order, each explicit offset mirrored so the offsets still rise. */
function reversed(kf: readonly Keyframe[]): readonly Keyframe[] {
  return [...kf].reverse().map((f) => (typeof f.offset === 'number' ? { ...f, offset: 1 - f.offset } : f));
}

const GLOW_OFF = '0 0 0 0 rgba(255, 255, 255, 0)';
const GLOW_ON = '0 0 0 6px rgba(255, 255, 255, 0.55)';
const SHADE_OFF = 'inset 0 0 0 0 rgba(0, 0, 0, 0)';
const SHADE_ON = 'inset 0 0 96px 48px rgba(0, 0, 0, 0.6)';

const BASE = {
  press: [{ transform: 'scale(1)' }, { transform: 'scale(0.92)' }, { transform: 'scale(1)' }],
  pulse: [
    { transform: 'scale(1)', boxShadow: GLOW_OFF },
    { transform: 'scale(1.06)', boxShadow: GLOW_ON, offset: 0.4 },
    { transform: 'scale(1)', boxShadow: GLOW_OFF },
  ],
  shake: [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(6px)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(6px)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(0)' },
  ],
  wobble: [
    { transform: 'rotate(0deg)' },
    { transform: 'rotate(-4deg)' },
    { transform: 'rotate(4deg)' },
    { transform: 'rotate(-4deg)' },
    { transform: 'rotate(4deg)' },
    { transform: 'rotate(0deg)' },
  ],
  roll: [
    { transform: 'translateY(-40%)', opacity: 0 },
    { transform: 'translateY(0)', opacity: 1 },
  ],
  // At rest at both ends with a small amplitude: a loop cancelled where it stands snaps back at most that far (§8.5).
  breathe: [{ transform: 'scale(1)' }, { transform: 'scale(1.02)', boxShadow: GLOW_ON }, { transform: 'scale(1)' }],
  // Ends scaled out and bright: an end motion holds its last frame until the frame's outro removes it.
  flourish: [
    { transform: 'scale(1)', filter: 'brightness(1)' },
    { transform: 'scale(1.04)', filter: 'brightness(1.35)', offset: 0.35 },
    { transform: 'scale(0.96)', filter: 'brightness(1.1)', opacity: 0.85 },
  ],
  // Three 160 ms shake cycles over 480 ms, dimming: ends jammed and dimmed.
  jam: [
    { transform: 'translateX(0)', filter: 'brightness(1)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(6px)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(6px)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(0)', filter: 'brightness(0.6)' },
  ],
  lift: [
    { transform: 'translateY(0)', boxShadow: GLOW_OFF },
    { transform: 'translateY(-6px)', boxShadow: GLOW_ON, offset: 0.5 },
    { transform: 'translateY(0)', boxShadow: GLOW_OFF },
  ],
  settle: [
    { transform: 'translateY(0)', opacity: 1 },
    { transform: 'translateY(6px)', opacity: 0 },
  ],
  unfold: [
    { transform: 'scaleY(0.6)', opacity: 0 },
    { transform: 'scaleY(1)', opacity: 1 },
  ],
  glint: [
    { transform: 'translateX(-30%)', opacity: 0 },
    { opacity: 0.9, offset: 0.5 },
    { transform: 'translateX(30%)', opacity: 0 },
  ],
  tick: [
    { transform: 'scale(0.6)', opacity: 0 },
    { transform: 'scale(1)', opacity: 1 },
  ],
  burst: [
    { transform: 'scale(0.5)', opacity: 1 },
    { transform: 'scale(1.6)', opacity: 0 },
  ],
  ripple: [
    { transform: 'scale(0.2)', opacity: 0.8 },
    { transform: 'scale(2)', opacity: 0 },
  ],
  iris: [
    { transform: 'scale(0.2)', opacity: 0 },
    { transform: 'scale(1)', opacity: 1 },
  ],
  // A glyph arriving at its box; the player adds the travel from the other endpoint (`TRAVEL`).
  fly: [
    { transform: 'scale(0.8)', opacity: 0.6 },
    { transform: 'scale(1)', opacity: 1 },
  ],
  drop: [
    { transform: 'scale(1)', opacity: 1 },
    { transform: 'scale(0.6)', opacity: 0 },
  ],
  sweep: [
    { transform: 'translateX(-100%)', opacity: 0 },
    { opacity: 0.5, offset: 0.5 },
    { transform: 'translateX(100%)', opacity: 0 },
  ],
  vignette: [{ boxShadow: SHADE_ON }, { boxShadow: SHADE_OFF }],
  dim: [{ backgroundColor: 'rgba(0, 0, 0, 0)' }, { backgroundColor: 'rgba(0, 0, 0, 0.4)' }, { backgroundColor: 'rgba(0, 0, 0, 0)' }],
  caption: [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
  fade: [{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }],
} as const satisfies Readonly<Record<string, readonly Keyframe[]>>;

/** Every preset's keyframes. */
export const PRESETS: { readonly [P in PresetId]: readonly Keyframe[] } = {
  ...BASE,
  'tick-back': reversed(BASE.tick),
  'pulse-back': reversed(BASE.pulse),
  'sweep-back': reversed(BASE.sweep),
  'unfold-back': reversed(BASE.unfold),
  'roll-back': reversed(BASE.roll),
  'iris-back': reversed(BASE.iris),
  'vignette-back': reversed(BASE.vignette),
  'caption-back': reversed(BASE.caption),
  'fly-back': reversed(BASE.fly),
};

/** The two-endpoint presets (§8.1: both endpoints resolved at the motion's point): the ghost travels between the cue's
 *  own box (`CueEvent.box`) and its target's box, `to-target` ending on the target (`fly`: box -> ribbon slot) and
 *  `to-box` ending on the cue's box (`drop`: slot -> box). Reduced motion plays them in place (nothing travels, §8.6). */
export const TRAVEL: { readonly [P in PresetId]?: 'to-target' | 'to-box' } = {
  fly: 'to-target',
  'fly-back': 'to-box',
  drop: 'to-box',
};
