// The presenter table (engine plan §8.4, §8.5): every cue key's default overlay motion, the control defaults and the
// targets they play on. Cue-stage chunk code: the stage reads it, the gates' tests check it (`motions.test.ts`).
import type { Haptic, Cue, CueKey, ControlCue } from '../types.ts';
import { CORE_CONTROLS } from '../types.ts';
import type { CauseVerb } from '../../mechanics/contract.ts';
import type { PresetId } from './presets.ts';

/** Where a motion plays; the DOM targets are found by `CUE_TARGET_ATTRS` (§8.5 "Cue targets"). */
export type CueTarget =
  | 'control'
  | 'box'
  | 'point'
  | 'ribbon'
  | 'stage'
  | 'frame'
  | 'panel'
  | 'edge'
  // The bar's Inventory control, where documents are kept.
  | 'inventory'
  // `[data-cue-status]` inside the frame or the device bar; fallback 'frame'.
  | 'status'
  | 'attempts'
  | 'part'
  | 'tier'
  | 'ladder'
  | 'alert'
  | 'notice';

type Brand<T, B extends string> = T & { readonly __brand: B };
/** MR1's union of named scene motions (SH10 declares them and the `SceneMotion` contract). */
export type SceneMotionId = Brand<string, 'SceneMotionId'>;

/** A second motion of a row, played with the first; skipped when its target does not resolve. */
export type WithMotion = {
  readonly preset: PresetId;
  readonly ms: number;
  readonly target: CueTarget;
  readonly reduced: PresetId;
  readonly resolveAt?: 'emit';
};

export type MotionSpec = {
  readonly preset: PresetId;
  readonly ms: number;
  readonly target: CueTarget;
  readonly reduced: PresetId;
  readonly haptic: Haptic | null;
  readonly scene: SceneMotionId | null;
  /** `'emit'` when the target exists before the emitting block and may leave with it; absent = `'flush'` (§8.1 "When
   *  a cue's DOM target is found"). A `control` target is `'emit'` by kind. */
  readonly resolveAt?: 'emit';
  /** The target leaves with its family root's outro (exactly the element-site motions of the end rows
   *  `puzzle:solved` / `failed` / `closed`, on the frame wrapper): played with `fill: 'forwards'`, so the target keeps
   *  its last frame until the outro removes it; every other motion keeps `fill: 'none'` (§8.6). If the target leaves
   *  the document mid-motion, the motion moves to its ghost as any `'emit'` motion does. */
  readonly holdEnd?: true;
  /** A held motion: the player loops the first motion on its target until a cue of the same puzzle with a key in
   *  `until` runs, and cancels the loop where it stands in that run, in the step that starts the key's first motion. */
  readonly until?: readonly CueKey[];
  /** A variant per cause (`fact:held:added` with cause `carry` flies in from the stage `edge`). */
  readonly byCause?: { readonly [V in CauseVerb]?: Omit<MotionSpec, 'byCause'> };
  /** The row's second motions, played with the first; each is checked by the gate as its own spec. */
  readonly with?: readonly WithMotion[];
};

/** The attribute each DOM target is found by: one table for the resolver (GM3s) and the resolve tests. In the stage
 *  chunk, not in `cues/types.ts`, so no engine closure keeps it. */
export const CUE_TARGET_ATTRS: {
  readonly [T in Exclude<CueTarget, 'control' | 'box' | 'point' | 'stage' | 'edge'>]: string;
} = {
  // `[data-cue-item="<item>"]` inside a live `[data-cue-ribbon]`.
  ribbon: 'data-cue-item',
  // `[data-cue="bar-inventory"]`.
  inventory: 'data-cue',
  frame: 'data-cue-frame',
  panel: 'data-cue-panel',
  status: 'data-cue-status',
  attempts: 'data-cue-attempts',
  part: 'data-cue-part',
  tier: 'data-cue-tier',
  // `[data-cue-panel="hints"]`.
  ladder: 'data-cue-panel',
  alert: 'data-cue-alert',
  notice: 'data-cue-notice',
};

/** Every key's scene motion is owed by MR1: until MR1, every key is pending and `scene` is null. MR1 sets this to
 *  `never`; tsc then requires a non-null `scene` on every entry. No partial narrowing, no exemption list. */
export type ScenePending = CueKey;
type ControlKey = `ui:${ControlCue}`;
type Owed<K> = K extends ScenePending ? object : { readonly scene: SceneMotionId };

/** The keys that end `busy` or the frame (the state gate's `SETTLE_KEYS` + `puzzle:closed`): a `puzzle:checking`
 *  loop of the same puzzle ends at their run. */
export const CHECKING_ENDS = [
  'puzzle:wrong',
  'puzzle:failed',
  'puzzle:solved',
  'puzzle:offline',
  'puzzle:rate-limited',
  'puzzle:ready',
  'puzzle:renewed',
  'puzzle:reset',
  'puzzle:closed',
] as const satisfies readonly CueKey[];

type Row = MotionSpec;
/** A row's spec with the fields every row shares by default. */
function row(preset: PresetId, ms: number, target: CueTarget, rest: Partial<Row> = {}): Row {
  return { preset, ms, target, reduced: 'fade', haptic: null, scene: null, ...rest };
}

const SLOT_PULSE: WithMotion = { preset: 'pulse', ms: 420, target: 'ribbon', reduced: 'fade' };

/** Every non-control key, exhaustive (tsc). Five lanes add entries: GM3m, GM3, GM5, GM5f, GM8i. */
export const CUE_MOTIONS: { readonly [K in Exclude<CueKey, ControlKey>]: MotionSpec & Owed<K> } = {
  'fact:held:added': row('fly', 480, 'ribbon', {
    haptic: 'success',
    with: [SLOT_PULSE],
    byCause: { carry: row('fly', 480, 'edge', { haptic: 'success', with: [SLOT_PULSE] }) },
  }),
  'fact:held:removed': row('settle', 240, 'ribbon', {
    resolveAt: 'emit',
    with: [{ preset: 'fly-back', ms: 480, target: 'ribbon', reduced: 'fade', resolveAt: 'emit' }],
  }),
  'fact:used:added': row('drop', 420, 'ribbon', { resolveAt: 'emit', haptic: 'light' }),
  'fact:used:removed': row('fly', 480, 'ribbon', { with: [SLOT_PULSE] }),
  'fact:doc:added': row('fly', 480, 'inventory', {
    haptic: 'success',
    with: [{ preset: 'pulse', ms: 420, target: 'inventory', reduced: 'fade' }],
  }),
  'fact:doc:removed': row('glint', 420, 'inventory', {
    resolveAt: 'emit',
    with: [{ preset: 'settle', ms: 240, target: 'inventory', reduced: 'fade', resolveAt: 'emit' }],
  }),
  'fact:taken:added': row('glint', 420, 'box'),
  'fact:taken:removed': row('glint', 420, 'box'),
  'fact:examined:added': row('tick', 360, 'box'),
  'fact:examined:removed': row('tick-back', 360, 'box'),
  'fact:open:added': row('burst', 480, 'box', { haptic: 'success' }),
  'fact:open:removed': row('iris-back', 360, 'box'),
  'fact:slot:added': row('drop', 420, 'ribbon', { resolveAt: 'emit', haptic: 'light' }),
  'fact:slot:removed': row('fly', 480, 'ribbon', { with: [SLOT_PULSE] }),
  'fact:fired:added': row('pulse', 420, 'box'),
  'fact:fired:removed': row('pulse-back', 420, 'box'),
  'fact:visited:added': row('vignette', 600, 'stage', {
    with: [{ preset: 'caption', ms: 1200, target: 'stage', reduced: 'fade' }],
  }),
  'fact:visited:removed': row('caption-back', 600, 'stage'),
  'fact:solved:added': row('flourish', 480, 'box', { haptic: 'success' }),
  'fact:solved:removed': row('sweep-back', 600, 'box'),
  'fact:failed:added': row('jam', 480, 'box', { haptic: 'error' }),
  'fact:failed:removed': row('sweep-back', 600, 'box'),
  'fact:abandoned:added': row('iris-back', 360, 'box'),
  'fact:abandoned:removed': row('sweep-back', 600, 'box'),
  'fact:attempt:added': row('shake', 360, 'box', { haptic: 'error' }),
  'fact:attempt:removed': row('roll-back', 300, 'box'),
  'fact:hint:added': row('pulse', 420, 'ladder'),
  'fact:hint:removed': row('pulse', 420, 'box'),
  'fact:story:added': row('dim', 600, 'stage'),
  'fact:story:removed': row('vignette', 600, 'stage'),
  'move:walk': row('sweep', 600, 'stage'),
  'move:zoom-in': row('iris', 360, 'box'),
  'move:zoom-out': row('iris-back', 360, 'box'),
  'move:enter': row('vignette', 600, 'stage'),
  'move:return': row('vignette', 600, 'stage'),
  'move:resume': row('vignette', 600, 'stage'),
  'move:leave': row('vignette-back', 600, 'stage'),
  'ui-state:select': row('lift', 240, 'ribbon', { haptic: 'light' }),
  'ui-state:deselect': row('settle', 240, 'ribbon', { resolveAt: 'emit', haptic: 'light' }),
  // The panel slides in; a `dim` pulse darkens the stage onto the sheet's own backdrop.
  'ui-state:panel-open': row('lift', 300, 'panel', { with: [{ preset: 'dim', ms: 300, target: 'stage', reduced: 'fade' }] }),
  'ui-state:panel-close': row('settle', 300, 'panel', { resolveAt: 'emit' }),
  'ui-state:reveal': row('glint', 600, 'stage'),
  'ui-state:tab': row('glint', 300, 'panel'),
  // A hold: looped from `WAIT_DELAY_MS` until the `waited` of the same panel (the player's wait hold).
  'ui-state:waiting': row('breathe', 900, 'box'),
  // The hold releases on the element (or box) its own `waiting` played on, captured at the emit.
  'ui-state:waited': row('settle', 240, 'box', { resolveAt: 'emit' }),
  'puzzle:opened': row('iris', 360, 'frame'),
  'puzzle:input': row('roll', 300, 'part', { haptic: 'light' }),
  'puzzle:blocked': row('shake', 360, 'part', { haptic: 'error' }),
  'puzzle:checking': row('breathe', 900, 'frame', { until: CHECKING_ENDS }),
  'puzzle:wrong': row('shake', 360, 'frame', { haptic: 'error' }),
  'puzzle:failed': row('jam', 480, 'frame', { resolveAt: 'emit', holdEnd: true, haptic: 'error' }),
  'puzzle:solved': row('flourish', 480, 'frame', { resolveAt: 'emit', holdEnd: true, haptic: 'success' }),
  'puzzle:reached': row('pulse', 420, 'frame'),
  'puzzle:reset': row('jam', 480, 'frame', { haptic: 'error' }),
  'puzzle:hint-shown': row('unfold', 300, 'tier'),
  'puzzle:closed': row('iris-back', 360, 'frame', { resolveAt: 'emit' }),
  'puzzle:renewed': row('breathe', 900, 'frame', {
    with: [{ preset: 'roll', ms: 300, target: 'attempts', reduced: 'fade' }],
  }),
  'puzzle:demo': row('pulse', 420, 'part'),
  'puzzle:hint-renewing': row('unfold-back', 300, 'tier'),
  'puzzle:offline': row('wobble', 360, 'status', { haptic: 'error' }),
  'puzzle:rate-limited': row('roll', 300, 'status'),
  'puzzle:ready': row('glint', 420, 'frame', {
    with: [{ preset: 'roll', ms: 300, target: 'attempts', reduced: 'fade' }],
  }),
  'puzzle:ladder': row('glint', 420, 'ladder'),
  'puzzle:hint-failed': row('wobble', 360, 'alert', { haptic: 'error' }),
  'puzzle:load-failed': row('wobble', 360, 'notice', { haptic: 'error' }),
};

/** Control keys: a default per trigger kind and overrides for the core controls; a type or module control takes its
 *  `ControlDecl.motion` (and `haptic`) instead, so a type lane never edits this file for its controls. */
export const UI_MOTIONS: {
  readonly control: MotionSpec & Owed<ControlKey>;
  readonly gesture: MotionSpec & Owed<ControlKey>;
  readonly overrides: { readonly [C in (typeof CORE_CONTROLS)[number]]?: MotionSpec & Owed<ControlKey> };
} = {
  control: row('press', 180, 'control', { resolveAt: 'emit' }),
  // A gesture step: a `pulse` at the step's cell (the control element the step's cue carries).
  gesture: row('pulse', 240, 'control', { resolveAt: 'emit' }),
  overrides: {
    'bare-art': row('ripple', 420, 'point'),
    'ribbon-item': row('lift', 240, 'control', { resolveAt: 'emit', haptic: 'light' }),
  },
};

function isCoreControl(control: ControlCue): control is (typeof CORE_CONTROLS)[number] {
  return (CORE_CONTROLS as readonly string[]).includes(control);
}

/** The one resolver the player and the gate share: override -> default by trigger kind. */
export function uiMotion(control: ControlCue): MotionSpec {
  return (isCoreControl(control) ? UI_MOTIONS.overrides[control] : undefined) ?? UI_MOTIONS.control;
}

/** A cue's key: `CUE_MOTIONS`' index for every kind but `ui`, whose motion is `uiMotion`'s. */
export function cueKey(cue: Cue): CueKey {
  switch (cue.kind) {
    case 'fact':
      return `fact:${cue.fact.kind}:${cue.change}`;
    case 'move':
      return `move:${cue.how}`;
    case 'module':
      // A module's names are its rules half's `cues`; the emitter (the writer's `cue`) takes them as strings.
      return `module:${cue.module}:${cue.name}` as CueKey;
    case 'ui':
      return `ui:${cue.control}`;
    case 'ui-state':
      return `ui-state:${cue.name}`;
    case 'puzzle':
      return `puzzle:${cue.name}`;
    default: {
      const never: never = cue;
      return never;
    }
  }
}

/** The motion a cue plays: a control's through `uiMotion`, every other key's row, its cause's variant when it has one. */
export function motionOf(cue: Cue): Omit<MotionSpec, 'byCause'> {
  if (cue.kind === 'ui') {
    return uiMotion(cue.control);
  }
  // Not a `ui` cue, so its key is no control key; tsc does not narrow a template union by the cue's kind.
  const spec: MotionSpec = CUE_MOTIONS[cueKey(cue) as Exclude<CueKey, ControlKey>];
  return (cue.kind === 'fact' ? spec.byCause?.[cue.cause.verb] : undefined) ?? spec;
}
