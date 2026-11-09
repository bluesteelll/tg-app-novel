// The condition evaluator (engine plan §4): whether a decoded condition holds in a state. The rules half (explore-ui
// chunk code, the `rules-lazy` arch rule); the story tool runs it in the build's proofs. The registries are read only
// inside the function, as every rules module reads them (rules/index.ts). Pure.
import { runOf } from '../../explore/reduce.ts';
import type { WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import type { KernelWorld, RulesRegistry } from '../contract.ts';
import { condEntry } from '../data/conditions.ts';
import type { Cond } from '../data/conditions.ts';
import { MECHANIC_DATA } from '../data/index.ts';
import type { DataRegistry } from '../data/index.ts';
import { MECHANIC_RULES } from './index.ts';

/**
 * Whether `c` holds in `s`: a kernel atom on the state's lists (`has` = held or used; `solved` / `failed` = the puzzle's
 * outcome), `all` every member, `any` some, `not` none; a module's atom through the `holds` of the rules half whose
 * data half declares it (`rules`, `data`: a test's fixture registries beside the real ones).
 */
export function holds(w: KernelWorld, s: WorldState, c: Cond, rules: RulesRegistry = MECHANIC_RULES, data: DataRegistry = MECHANIC_DATA): boolean {
  const [kind, value] = condEntry(c);
  const id = typeof value === 'string' ? value : '';
  const among = (list: readonly string[]): boolean => list.includes(id);
  switch (kind) {
    case 'all':
      return (value as readonly Cond[]).every((m) => holds(w, s, m, rules, data)); // a decoded combinator's members
    case 'any':
      return (value as readonly Cond[]).some((m) => holds(w, s, m, rules, data)); // a decoded combinator's members
    case 'not':
      return !holds(w, s, value as Cond, rules, data); // a decoded `not` holds one condition
    case 'held':
      return among(s.held);
    case 'used':
      return among(s.used);
    case 'has':
      return among(s.held) || among(s.used);
    case 'doc':
      return among(s.docs);
    case 'taken':
      return among(s.taken);
    case 'examined':
      return among(s.examined);
    case 'open':
      return among(s.open);
    case 'visited':
      return among(s.visited);
    case 'solved':
    case 'failed':
      return runOf(s, id as PuzzleLocalId).outcome === kind; // a decoded atom's id passed the puzzle id pattern
    default: {
      const owner = data.find((d) => d.atoms !== undefined && Object.hasOwn(d.atoms, kind));
      const half = owner === undefined ? undefined : rules.find((r) => r.id === owner.id);
      if (half?.holds === undefined) {
        throw new Error('invariant: a decoded condition holds only declared atoms');
      }
      return half.holds(w, s, { kind, value });
    }
  }
}
