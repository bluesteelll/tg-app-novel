// The rules registry (engine plan §3.2): every module's rules half, in the data registry's order (`mechanics: data and
// rules registries align`), and the dispatch by action kind. Explore-ui chunk code (the `rules-lazy` arch rule). Each
// module lane appends its entry and its kinds' handlers.
//
// core.ts and this module import each other: core's `reduce` runs the registry's hooks and dispatches through `APPLY`,
// and the registry holds core's entry. So core's entry and its handlers are built here from core.ts's function
// declarations, which ESM binds when the modules are instantiated, and core.ts reads MECHANIC_RULES and APPLY only
// inside function bodies. A `const` of core.ts read at this module's top level before core.ts has run would throw in
// Node (the `story` run, unbundled ESM) and read undefined silently in the bundle (it declares the registry with `var`)
// and in vitest's module runner (`mechanics: the rules registry loads from either module first` compares every member).
import type { ExploreAction } from '../../explore/reduce.ts';
import type { KernelWorld, MechanicRules, SectionAction } from '../contract.ts';
import { applyCombine, combineActions, combineReads, combineScope } from './combine.ts';
import type { CombineAction, CombineCue } from './combine.ts';
import { actions, applyCore, reads } from './core.ts';
import type { CoreCue } from './core.ts';
import { applyFlags, flagEffects, flagReads, flagScope, flagsActions, holdsFlag } from './flags.ts';
import type { FlagsAction } from './flags.ts';
import { applyUse, useActions, useReads, useScope } from './use.ts';
import type { UseAction, UseCue } from './use.ts';
import { applyVisual, visualActions, visualReads, visuals } from './visual.ts';
import type { VisualAction } from './visual.ts';
import { applyView, viewActions, viewReads } from './view.ts';
import type { ViewAction } from './view.ts';
import type { KernelWriter } from './writer.ts';

const core = {
  id: 'core',
  actions,
  apply: applyCore,
  reads,
  cues: ['look', 'locked', 'refused', 'reset'] as const,
} satisfies MechanicRules<'core', ExploreAction, CoreCue>;

const use = {
  id: 'use',
  actions: useActions,
  apply: applyUse,
  reads: useReads,
  scope: useScope,
  cues: ['refused', 'said'] as const,
} satisfies MechanicRules<'use', UseAction, UseCue>;

const visual = {
  id: 'visual',
  actions: visualActions,
  apply: applyVisual,
  reads: visualReads,
  cues: [] as const,
  visuals,
} satisfies MechanicRules<'visual', VisualAction, never>;

const view = {
  id: 'view',
  actions: viewActions,
  apply: applyView,
  reads: viewReads,
  cues: [] as const,
} satisfies MechanicRules<'view', ViewAction, never>;

const combine = {
  id: 'combine',
  actions: combineActions,
  apply: applyCombine,
  reads: combineReads,
  scope: combineScope,
  cues: ['refused', 'refused-with'] as const,
} satisfies MechanicRules<'combine', CombineAction, CombineCue>;

const flags = {
  id: 'flags',
  actions: flagsActions,
  apply: applyFlags,
  reads: flagReads,
  scope: flagScope,
  cues: [] as const,
  effects: flagEffects,
  holds: holdsFlag,
} satisfies MechanicRules<'flags', FlagsAction, never>;

export const MECHANIC_RULES = [core, use, visual, view, combine, flags] as const;

/**
 * The dispatch (engine plan §3.2 "Exhaustiveness: dispatch is a typed map over the tuple"): one handler per action kind
 * the registry's modules emit, each handed the kernel's writer. A kind without a handler fails check; two modules that
 * emit one kind fail `mechanics: every key has one owner`.
 */
export const APPLY: { readonly [K in SectionAction['kind']]: (w: KernelWorld, a: Extract<SectionAction, { kind: K }>, out: KernelWriter) => void } = {
  'enter-section': applyCore,
  'event-returned': applyCore,
  tap: applyCore,
  insert: applyCore,
  'attempt-failed': applyCore,
  'hint-opened': applyCore,
  'puzzle-ended': applyCore,
  use: applyUse,
  'leave-view': applyView,
  combine: applyCombine,
};
