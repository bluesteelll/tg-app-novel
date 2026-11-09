// The rules registry (engine plan §3.2): every module's rules half, in the data registry's order (`mechanics: data and
// rules registries align`). Explore-ui chunk code (the `rules-lazy` arch rule). Each module lane appends its entry.
//
// core.ts and this module import each other: core's `reduce` runs the registry's hooks, and the registry holds core's
// entry. So core's entry is built here from core.ts's function declarations, which ESM binds when the modules are
// instantiated, and core.ts reads MECHANIC_RULES only inside function bodies. A `const` of core.ts read at this
// module's top level would throw whenever core.ts loads first (`mechanics: the rules registry loads from either module
// first`).
import type { ExploreAction } from '../../explore/reduce.ts';
import type { MechanicRules } from '../contract.ts';
import { actions, applyCore, reads } from './core.ts';

const core = { id: 'core', actions, apply: applyCore, reads, cues: [] } satisfies MechanicRules<'core', ExploreAction, never>;

export const MECHANIC_RULES = [core] as const;
