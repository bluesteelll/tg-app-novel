// The cue channel's types (engine plan §8.1): what the yields emit when a fact, a move, a module, a control, a panel or
// a puzzle changes, and the name tuples their keys derive from. Types and constants only: the registry references are
// `import type`, so no chunk pays for them; no engine module reads the name tuples at run time (only the gates' tests
// do), so a tree-shaking build drops them. Pure (`isPureWorld`): no DOM, clock or Svelte.
import type { Box } from '../geom/cover.ts';
import type { MECHANIC_DATA } from '../mechanics/data/index.ts';
import type {
  AnchorKey,
  Cause,
  FactAtom,
  FactKind,
  MechanicId,
  ModuleCueKey,
  StateName,
} from '../mechanics/contract.ts';
import type { PUZZLE_TYPES } from '../puzzles/rules/index.ts';
import type { PuzzleLocalId } from '../story/staging.ts';
import type { ScreenKind } from '../ui/screens.ts';
import type { HotspotKey, ItemId, RoomId } from '../world/types.ts';
import type { PresetId } from './stage/presets.ts';

/** One state change the player sees, as data: the cue stage maps each to its overlay motion, MR1 to its scene motion. */
export type Cue =
  | { readonly kind: 'fact'; readonly fact: FactAtom; readonly change: 'added' | 'removed'; readonly cause: Cause }
  | {
      readonly kind: 'move';
      readonly from: RoomId | null;
      /** Null only for `leave` (a section left for a knot). */
      readonly to: RoomId | null;
      readonly via: HotspotKey | null;
      readonly how: MoveHow;
    }
  | {
      readonly kind: 'module';
      readonly module: MechanicId;
      readonly name: string;
      readonly at: HotspotKey | null;
      readonly item: ItemId | null;
    }
  | { readonly kind: 'ui'; readonly control: ControlCue; readonly item: ItemId | null; readonly index: number | null }
  | { readonly kind: 'ui-state'; readonly name: UiStateCue; readonly panel: ScreenKind | null; readonly item: ItemId | null }
  | { readonly kind: 'puzzle'; readonly puzzle: PuzzleLocalId; readonly name: PuzzleCue; readonly index: number | null };

/** The DOM events a control may declare as its trigger; the family root listens for each kind (§8.3). */
export const CUE_TRIGGERS = ['click', 'pointerdown', 'input', 'change', 'keydown'] as const;
export type CueTrigger = (typeof CUE_TRIGGERS)[number];

/** Touch feedback on top of a motion, never instead of it: the Telegram client's `impact`, `selection` and `notify`. */
export type Haptic = 'light' | 'medium' | 'selection' | 'success' | 'warning' | 'error';

/** One declared control (module data halves, type data halves): its trigger, an optional preset that replaces
 *  `UI_MOTIONS`' default, and touch feedback on top of the motion. */
export type ControlDecl = {
  readonly name: string;
  readonly on: CueTrigger | 'gesture';
  readonly motion?: PresetId;
  readonly haptic?: Haptic;
};

/** Controls of the kernel's UI and of GM3u / GM4u's; module and type controls derive from their registries. */
export const CORE_CONTROLS = [
  'hotspot',
  'bar-inventory',
  'bar-reveal',
  'inventory-tab',
  'inventory-doc',
  'doc-close',
  'lock-item',
  'ribbon-item',
  'bare-art',
  'view-leave',
  'dial-up',
  'dial-down',
  'order-slot',
  'puzzle-try',
  'puzzle-hint',
  'puzzle-retry',
  'give-up-ask',
  'give-up-no',
  'give-up-yes',
  'hint-use',
  'hint-more',
] as const;
// `controls` is optional, so the entries are read through a distributive conditional, not an index. A data half
// annotated with its interface (`const X: PuzzleTypeData<...>`) widens `controls` and contributes no name: a type that
// declares controls keeps its literal type (`satisfies`).
type ControlsOf<T> = T extends { readonly controls: readonly (infer C)[] } ? C : never;
type TypeControlEntry = ControlsOf<(typeof PUZZLE_TYPES)[number]>;
type ModuleControlEntry = ControlsOf<(typeof MECHANIC_DATA)[number]>;
type NameOf<C> = C extends { readonly name: infer N } ? N : never;
export type ControlCue = (typeof CORE_CONTROLS)[number] | NameOf<TypeControlEntry> | NameOf<ModuleControlEntry>;
/** The controls whose steps a gesture surface emits (`oncue`), one cue per step. */
export type GestureCue = NameOf<Extract<TypeControlEntry | ModuleControlEntry, { readonly on: 'gesture' }>>;

/** A room batch waits on a load / its loads ended; also the hint ladder's request (`panel: 'hints'`) and a frame's
 *  chunk loads (`panel: 'puzzle'`); the player keeps one hold per `panel` (null: the room batch). */
export const UI_STATE_CUES = [
  'select',
  'deselect',
  'panel-open',
  'panel-close',
  'reveal',
  'tab',
  'waiting',
  'waited',
] as const;
export type UiStateCue = (typeof UI_STATE_CUES)[number];

export const PUZZLE_CUES = [
  'opened',
  'input',
  'blocked',
  'checking',
  'wrong',
  'failed',
  'solved',
  'reached',
  'reset',
  'hint-shown',
  'closed',
  // Per-player R-E14: the run changed under an open frame.
  'renewed',
  // One step of a device's demonstration (index = part).
  'demo',
  // Per-player R-E20: a tier text dropped by a run change (index = tier).
  'hint-renewing',
  // A `network` / `not-entitled` reply.
  'offline',
  // One per countdown second (index = seconds left).
  'rate-limited',
  // Per-player R-E26: a wait ended with nothing posted; the frame takes input again.
  'ready',
  // A server answer rewrote the hint ladder (index null).
  'ladder',
  // A ladder status or a hint purchase failed (index = tier or null).
  'hint-failed',
  // The type or host chunk did not load (the notice and Retry).
  'load-failed',
] as const;
export type PuzzleCue = (typeof PUZZLE_CUES)[number];

/** How a move entered or left a room; a runtime tuple so the every-key gate builds its key set from data. */
export const MOVE_HOWS = ['walk', 'zoom-in', 'zoom-out', 'enter', 'return', 'resume', 'leave'] as const;
export type MoveHow = (typeof MOVE_HOWS)[number];

export type CueKey =
  | `fact:${FactKind}:${'added' | 'removed'}`
  | `move:${MoveHow}`
  | ModuleCueKey
  | `ui:${ControlCue}`
  | `ui-state:${UiStateCue}`
  | `puzzle:${PuzzleCue}`;

/** A floor, never a ceiling: every cue motion and every value motion (per-player E-P8) lasts at least this long. */
export const MIN_VISIBLE_MS = 120;
/** The puzzle frame's entrance (`LAYER_MOTIONS.in`, defined from it): SH7 covers the scene only once an opaque frame's
 *  entrance has ended (design-shots I-7). */
export const FRAME_OPEN_MS = 300;

/** A point in stage coordinates (CSS px). */
export type Point = { readonly x: number; readonly y: number };
/** One anchor's state change in a dispatch (§6.4's shape); GM3b produces it. */
export type VisualDiff = { readonly at: AnchorKey; readonly from: StateName | null; readonly to: StateName | null };
export type Unsubscribe = () => void;

/** What the bus carries: the cue, the stage box of its hotspot (resolved by the controller, which has the cover
 *  mapping, even for a taken hotspot), the pointer point, the dispatch's visual diff, and for a `ui` cue the control
 *  element and its box at emit time (a `control` target is an `'emit'` target: the motion plays on the element while it
 *  is in the document and continues on a ghost clone at `box` from the moment it leaves). */
export type CueEvent = {
  readonly cue: Cue;
  readonly box: Box | null;
  readonly point: Point | null;
  readonly diff: readonly VisualDiff[];
  readonly el: Element | null;
};
