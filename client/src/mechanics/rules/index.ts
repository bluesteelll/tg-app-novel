// The rules registry (engine plan §3.2): every module's rules half, in the data registry's order (`mechanics: data and
// rules registries align`), and the dispatch by action kind. Explore-ui chunk code (the `rules-lazy` arch rule). Each
// module lane appends its entry and its kinds' handlers.
//
// core.ts and this module import each other: core's `reduce` runs the registry's hooks and dispatches through `APPLY`,
// and the registry holds core's entry. So core's entry and its handlers are built here from core.ts's function
// declarations, which ESM binds when the modules are instantiated, and core.ts reads MECHANIC_RULES and APPLY only
// inside function bodies. A `const` of core.ts read at this module's top level would throw whenever core.ts loads first
// (`mechanics: the rules registry loads from either module first`).
import type { ExploreAction } from '../../explore/reduce.ts';
import type { KernelWorld, MechanicRules, SectionAction } from '../contract.ts';
import { actions, applyCore, reads } from './core.ts';
import type { CoreCue } from './core.ts';
import type { KernelWriter } from './writer.ts';

const core = {
  id: 'core',
  actions,
  apply: applyCore,
  reads,
  cues: ['look', 'locked', 'refused', 'reset'] as const,
} satisfies MechanicRules<'core', ExploreAction, CoreCue>;

export const MECHANIC_RULES = [core] as const;

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
};
