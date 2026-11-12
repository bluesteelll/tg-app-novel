// Module `combine`'s build half (engine plan §6.2): its world lint, with its own codes (both errors).
// `world/recipe-unknown-ref`: a recipe names an item the world lacks. `world/recipe-scope` (R11's first condition): a
// recipe's inputs belong to one section S (`recipeSections`: no one section gives both is refused), its product is given
// only by recipes of S (never by a take, a trigger or a `use` rule of any section, nor by a recipe of another section),
// and no lock of another section accepts its product (X15: the kernel's `world/cross-section-item` reads kernel gifts
// only, so a recipe's gift needs this clause, as `use`'s gifts have theirs). Each `when` is a gating condition of S
// through the condition lint (`world/cross-section-cond`, `world/cond-size`). Build only and pure, no node:*: world.ts
// imports the registry and scan-dist.ts imports world.ts. Its imports from index.ts and lint.ts are `import type`; it
// never imports world.ts (index.ts's header).
import { sectionScope } from '../../../src/explore/reduce.ts';
import { recipeSections } from '../../../src/mechanics/rules/combine.ts';
import { useScope } from '../../../src/mechanics/rules/use.ts';
import type { SectionId } from '../../../src/story/staging.ts';
import { toPublic } from '../../../src/world/decode.ts';
import type { ItemId } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import { condFindings } from './conditions.ts';
import type { CondSite } from './conditions.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** Every `combine` code with its severity: a dangling id or a recipe across sections is an authoring fault the proof
 *  would carry. */
export const COMBINE_CODES = {
  'world/recipe-unknown-ref': 'E',
  'world/recipe-scope': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type CombineCode = keyof typeof COMBINE_CODES;

/**
 * `combine`'s lint of one world, per recipe in source order: its unknown ids (then its scope checks are skipped), else
 * its section, its product's other givers and the locks of other sections that accept it; each `when` a gating site of
 * its section. A world without recipes builds no proof world here.
 */
export function combineFindings(input: WorldLintInput): Finding[] {
  const recipes = input.world.mods.combine.recipes;
  if (recipes.length === 0) {
    return [];
  }
  const out: Finding[] = [];
  const report = (code: CombineCode, path: string, message: string): void => {
    out.push({ code, severity: COMBINE_CODES[code], file: input.file, line: input.line(path), message: `${path}: ${message}` });
  };
  const w = input.world;
  const kw = { ...toPublic(w), mods: w.mods };
  const sections = Object.keys(w.sections) as SectionId[]; // the keys of a decoded world's sections
  const of = recipeSections(kw);
  // What each section gives besides its recipes: the kernel's gifts and its `use` rules' gifts.
  const base = new Map(sections.map((id) => [id, new Set<ItemId>([...sectionScope(kw, id).items, ...useScope(kw, id).items])]));
  const sites: CondSite[] = [];
  recipes.forEach((r, i) => {
    const at = `recipes.${i}`;
    const unknown = [
      ...(['a', 'b', 'gives'] as const).map((k) => [`${at}.${k}`, r[k]] as const),
      ...r.keep.map((id, j) => [`${at}.keep.${j}`, id] as const),
    ].filter(([, id]) => !Object.hasOwn(w.items, id));
    for (const [path, id] of unknown) {
      report('world/recipe-unknown-ref', path, `item '${id}' is not defined`);
    }
    if (unknown.length > 0) {
      return;
    }
    const section = of[i] ?? null;
    if (section === null) {
      report('world/recipe-scope', at, `no one section gives both '${r.a}' and '${r.b}': a recipe combines items of one section (R11)`);
      return;
    }
    for (const other of sections) {
      if (base.get(other)?.has(r.gives) === true) {
        report('world/recipe-scope', `${at}.gives`, `item '${r.gives}' is given in section ${other}: a recipe's product is given only by recipes of its section (R11)`);
      }
    }
    recipes.forEach((q, j) => {
      const by = of[j] ?? null;
      if (j !== i && q.gives === r.gives && by !== null && by !== section) {
        report('world/recipe-scope', `${at}.gives`, `item '${r.gives}' is also given by recipe ${j} of section ${by}: a recipe's product is given only by recipes of its section (R11)`);
      }
    });
    for (const other of sections.filter((x) => x !== section)) {
      for (const l of sectionScope(kw, other).locks.filter((x) => x.lock.slots.some((s) => s.accepts === r.gives))) {
        report('world/recipe-scope', `${at}.gives`, `item '${r.gives}' is given in section ${section} and required by lock ${l.key} of section ${other} (X15)`);
      }
    }
    if (r.when !== null) {
      sites.push({ cond: r.when, path: `${at}.when`, scope: { gating: section } });
    }
  });
  return [...out, ...condFindings(input, sites)];
}

export const COMBINE_LINT: WorldLint<CombineCode> = { id: 'combine', codes: COMBINE_CODES, lint: combineFindings };
