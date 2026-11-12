// Module `combine`'s rules half (engine plan §6.2): two held items, one tapped onto the other in either order, run the
// first recipe of the pair whose `when` holds: the inputs not kept leave the hands (`held - inputs`, `used + inputs`)
// and the product arrives (`held + gives`); no recipe refuses with both ribbon items shaking. "Combine anywhere" (R11):
// `applyCombine` runs in any section, while `combineActions` lists a recipe only while its own section is current, so
// the section searches stay per section; the lint `world/recipe-scope` (the build half) keeps a recipe's facts out of
// every other section's reads. Explore-ui chunk code (the `rules-lazy` arch rule): rules/index.ts builds the entry from
// these function declarations, as it does core's. Pure.
import { sectionScope } from '../../explore/reduce.ts';
import type { WorldState } from '../../explore/state.ts';
import type { SectionId } from '../../story/staging.ts';
import type { ItemId } from '../../world/types.ts';
import type { Cause, FactAtom, KernelWorld, ModuleScope } from '../contract.ts';
import { condReads } from '../data/conditions.ts';
import type { Recipe } from '../data/combine.ts';
import { holds } from './conditions.ts';
import { useScope } from './use.ts';
import { added } from './writer.ts';
import type { KernelWriter } from './writer.ts';

/** Item `a` (the selected one) tapped onto item `b`; the search lists each pair once, `a` the smaller id. */
export type CombineAction = { readonly kind: 'combine'; readonly a: ItemId; readonly b: ItemId };
/** `refused` on the selected item (the error haptic, MR1's scene cell); `refused-with` on the item tapped onto it
 *  (its shake alone): one refusal, one signal (RULINGS 306). */
export type CombineCue = 'refused' | 'refused-with';

const NO_RECIPES: readonly Recipe[] = [];

function recipesOf(w: KernelWorld): readonly Recipe[] {
  return w.mods?.combine.recipes ?? NO_RECIPES; // the public body alone has no `mods` (the proof path's runtime guard)
}

/**
 * The index of the first recipe in source order whose inputs are `{a, b}` as an unordered pair and whose `when` holds
 * in `s` (`use`'s first-rule rule, unordered); -1: none.
 */
export function firstRecipe(w: KernelWorld, s: WorldState, a: ItemId, b: ItemId): number {
  return recipesOf(w).findIndex((r) => ((r.a === a && r.b === b) || (r.a === b && r.b === a)) && (r.when === null || holds(w, s, r.when)));
}

// Per world: the recipes' sections never change for a decoded world. A module-level const read only inside function
// bodies (the registry cycle's rule, rules/index.ts).
const SECTIONS = new WeakMap<KernelWorld, readonly (SectionId | null)[]>();

/**
 * Each recipe's section: the first section (in `w.sections` order) that gives both its inputs, where a section gives
 * its kernel gifts, its `use` rules' gifts and the products of its own recipes (a chain), resolved to a fixed point so a
 * chain resolves in any source order; null: no one section gives both (`world/recipe-scope` refuses it).
 */
export function recipeSections(w: KernelWorld): readonly (SectionId | null)[] {
  const cached = SECTIONS.get(w);
  if (cached !== undefined) {
    return cached;
  }
  const recipes = recipesOf(w);
  const ids = Object.keys(w.sections) as SectionId[]; // the keys of a decoded world's sections
  const gifts = new Map<SectionId, Set<ItemId>>(ids.map((id) => [id, new Set([...sectionScope(w, id).items, ...useScope(w, id).items])]));
  const out: (SectionId | null)[] = recipes.map(() => null);
  for (let pass = 0; pass < recipes.length; pass++) {
    let changed = false;
    recipes.forEach((r, i) => {
      if (out[i] !== null) {
        return;
      }
      const section = ids.find((id) => gifts.get(id)?.has(r.a) === true && gifts.get(id)?.has(r.b) === true);
      if (section !== undefined) {
        out[i] = section;
        gifts.get(section)?.add(r.gives);
        changed = true;
      }
    });
    if (!changed) {
      break;
    }
  }
  SECTIONS.set(w, out);
  return out;
}

/**
 * Every held pair whose first matching recipe belongs to the current section, while no event knot is pending (R11's
 * third condition: S's search enumerates S's recipes only while S is current); each unordered pair once, `a` the
 * smaller id, in recipe order, so two states that differ only in the order items were taken list the same actions.
 */
export function combineActions(w: KernelWorld, s: WorldState): CombineAction[] {
  const recipes = recipesOf(w);
  if (recipes.length === 0 || s.section === null || s.pendingStory.length > 0) {
    return [];
  }
  const sections = recipeSections(w);
  const seen = new Set<string>();
  const out: CombineAction[] = [];
  for (const r of recipes) {
    const [a, b] = r.a < r.b ? [r.a, r.b] : [r.b, r.a];
    const pair = `${a}+${b}`;
    if (seen.has(pair) || !s.held.includes(a) || !s.held.includes(b)) {
      continue;
    }
    seen.add(pair);
    const i = firstRecipe(w, s, a, b);
    if (i !== -1 && sections[i] === s.section) {
      out.push({ kind: 'combine', a, b });
    }
  }
  return out;
}

/**
 * `combine {a, b}` in any current section ("combine anywhere"): the first matching recipe writes `held - inputs not
 * kept`, `used + those`, then `held + gives` with its name toast and its `say`; no recipe writes nothing and shakes both
 * ribbon items (`refused` on `a`, `refused-with` on `b`).
 */
export function applyCombine(w: KernelWorld, x: CombineAction, out: KernelWriter<'combine', CombineCue>): void {
  const s = out.state;
  if (w.mods?.combine === undefined || s.section === null || s.pendingStory.length > 0 || x.a === x.b || !s.held.includes(x.a) || !s.held.includes(x.b)) {
    return;
  }
  const r = recipesOf(w)[firstRecipe(w, s, x.a, x.b)];
  if (r === undefined) {
    out.cue('combine', 'refused', null, x.a);
    out.cue('combine', 'refused-with', null, x.b);
    return;
  }
  const cause: Cause = { verb: 'combine', at: null, item: x.a, via: null };
  const inputs = [r.a, r.b].filter((id) => !r.keep.includes(id));
  out.set('held', s.held.filter((id) => !inputs.includes(id)), cause);
  out.set('used', inputs.reduce((used, id) => added(used, id), out.state.used), cause);
  out.set('held', added(out.state.held, r.gives), cause);
  out.effect({ kind: 'got', gift: { item: r.gives }, at: null });
  if (r.say !== null) {
    out.effect({ kind: 'look', text: r.say, at: null });
  }
}

/** The recipes of `section`, by their section (`recipeSections`). */
function recipesIn(w: KernelWorld, section: SectionId): Recipe[] {
  const sections = recipeSections(w);
  return recipesOf(w).filter((_, i) => sections[i] === section);
}

/** `combine`'s share of S's own facts (`MechanicRules.scope`): the products of S's recipes; it writes no `fired` key. */
export function combineScope(w: KernelWorld, section: SectionId): ModuleScope {
  return { items: recipesIn(w, section).map((r) => r.gives), fired: [] };
}

/** Every fact S's recipes read: `held` / `used` of each input and product, and every atom of its `when`. */
export function combineReads(w: KernelWorld, section: SectionId): readonly FactAtom[] {
  const atoms: FactAtom[] = [];
  for (const r of recipesIn(w, section)) {
    for (const id of [r.a, r.b, r.gives]) {
      atoms.push({ kind: 'held', id }, { kind: 'used', id });
    }
    if (r.when !== null) {
      atoms.push(...condReads(r.when));
    }
  }
  return atoms;
}
