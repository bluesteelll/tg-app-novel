// Module `flags`'s build half (engine plan §6.5): its world lint, with its own codes (both errors).
// `world/flag-unknown-ref`: a declaration's `section` the world lacks, a `set` of an undeclared flag, a `flag` atom of
// an undeclared flag at any condition site (a hotspot `when`, a `uses.when`, a recipe `when`, a visual `is` /
// `decor.is`, a puzzle clue). `world/flag-scope` (X15, §4): a flag belongs to the section that declares it, whose reset
// alone clears it, so a `set` in a trigger of section T (by its key's room) of a flag declared in S ≠ T is refused, and
// so is a `flag` atom in a gating site of T naming a flag of S ≠ T: a hotspot `when` by its hotspot's room, a
// `uses.when` by its target's room, a recipe `when` by `recipeSections`. A visual site and a clue read any flag of the
// chapter. Each hotspot `when` is also a gating condition of its section through the condition lint
// (`world/cross-section-cond`, `world/visual-only-atom`, `world/cond-size`), the one guard on its kernel atoms. The
// module owns no text and enters no knot. Build only and pure, no node:*: world.ts imports the registry and scan-dist.ts
// imports world.ts. Its imports from index.ts and lint.ts are `import type`; it never imports world.ts (index.ts's
// header).
import { own, worldIndex } from '../../../src/explore/reduce.ts';
import type { FlagId, KernelWorld } from '../../../src/mechanics/contract.ts';
import { condReads } from '../../../src/mechanics/data/conditions.ts';
import type { Cond } from '../../../src/mechanics/data/conditions.ts';
import type { UseRule } from '../../../src/mechanics/data/use.ts';
import { recipeSections } from '../../../src/mechanics/rules/combine.ts';
import type { SectionId } from '../../../src/story/staging.ts';
import { toPublic } from '../../../src/world/decode.ts';
import type { HotspotKey, RoomId } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import { condFindings } from './conditions.ts';
import type { CondSite } from './conditions.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** Every `flags` code with its severity: a dangling flag or one read or set across sections is an authoring fault the
 *  proof would carry (a flag outlives its reader's reset). */
export const FLAGS_CODES = {
  'world/flag-unknown-ref': 'E',
  'world/flag-scope': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type FlagsCode = keyof typeof FLAGS_CODES;

/** One condition site: its dotted source path and the section whose flags it reads (null: any flag of the chapter). */
type Site = { readonly cond: Cond; readonly path: string; readonly gating: SectionId | null };

/**
 * `flags`' lint of one world: the declarations, then each `set` (source order of the decoded sets), then each flag atom
 * per site (hotspot `when`s, `uses.when`s, recipe `when`s, visual `is` rules, clues), then the condition findings of
 * the hotspot `when`s. A world that declares, sets and reads no flag reports nothing.
 */
export function flagsFindings(input: WorldLintInput): Finding[] {
  const w = input.world;
  const d = w.mods.flags;
  const out: Finding[] = [];
  const report = (code: FlagsCode, path: string, message: string): void => {
    out.push({ code, severity: FLAGS_CODES[code], file: input.file, line: input.line(path), message: `${path}: ${message}` });
  };
  let kernel: KernelWorld | null = null; // the proof world (the section index, the recipes' sections), built on first use
  const kw = (): KernelWorld => (kernel ??= { ...toPublic(w), mods: w.mods });
  const sectionOf = (key: HotspotKey): SectionId | null => worldIndex(kw()).hotspots.get(key)?.section ?? null;

  for (const [f, decl] of Object.entries(d.flags)) {
    if (!Object.hasOwn(w.sections, decl.section)) {
      report('world/flag-unknown-ref', `flags.${f}.section`, `section '${decl.section}' of flag '${f}' is not defined`);
    }
  }
  for (const [key, f] of Object.entries(d.sets)) {
    const path = `${d.paths[`effect:${key}`] ?? ''}.set`;
    const decl = own(d.flags, f);
    if (decl === undefined) {
      report('world/flag-unknown-ref', path, `flag '${f}' is not declared`);
      continue;
    }
    // `<kind>:<target>#<source index>`: an `enter` trigger's target is its room, every other one's a hotspot key.
    const trigger = key.slice(0, key.lastIndexOf('#'));
    const target = trigger.slice(trigger.indexOf(':') + 1);
    const ix = worldIndex(kw());
    const section = trigger.startsWith('enter:') ? ix.rooms.get(target as RoomId)?.section : ix.hotspots.get(target as HotspotKey)?.section; // lookup keys only
    if (section !== undefined && section !== decl.section) {
      report('world/flag-scope', path, `flag '${f}' is declared in section ${decl.section} and set in section ${section}: a flag is set only by its own section's effects (X15)`);
    }
  }

  const sites: Site[] = [];
  const whens: CondSite[] = [];
  for (const [key, cond] of Object.entries(d.when) as Array<[HotspotKey, Cond]>) {
    // The keys of a decoded `when` table are hotspot keys.
    const path = `${d.paths[`hotspot:${key}`] ?? ''}.when`;
    const section = sectionOf(key);
    sites.push({ cond, path, gating: section });
    if (section !== null) {
      whens.push({ cond, path, scope: { gating: section } });
    }
  }
  const use = w.mods.use;
  for (const [key, rules] of Object.entries(use.uses) as Array<[HotspotKey, readonly UseRule[]]>) {
    // The keys of a decoded `uses` table are hotspot keys.
    rules.forEach((r, i) => {
      if (r.when !== null) {
        sites.push({ cond: r.when, path: `${use.paths[`hotspot:${key}`] ?? ''}.uses.${i}.when`, gating: sectionOf(key) });
      }
    });
  }
  const recipes = w.mods.combine.recipes;
  recipes.forEach((r, i) => {
    if (r.when !== null) {
      sites.push({ cond: r.when, path: `recipes.${i}.when`, gating: recipeSections(kw())[i] ?? null });
    }
  });
  const visual = w.mods.visual;
  for (const [key, v] of Object.entries(visual.hotspots)) {
    v.is.forEach((r, i) => sites.push({ cond: r.when, path: `${visual.paths[`hotspot:${key}`] ?? ''}.is.${i}.when`, gating: null }));
  }
  for (const [room, decor] of Object.entries(visual.decor)) {
    decor.forEach((x, j) => x.is.forEach((r, i) => sites.push({ cond: r.when, path: `${visual.paths[`room:${room}`] ?? ''}.decor.${j}.is.${i}.when`, gating: null })));
  }
  for (const [pid, p] of Object.entries(w.puzzles)) {
    p.clues.forEach((cond, i) => sites.push({ cond, path: `puzzles.${pid}.clues.${i}`, gating: null }));
  }

  for (const { cond, path, gating } of sites) {
    for (const atom of condReads(cond).filter((a) => a.kind === 'flag')) {
      const decl = own(d.flags, atom.id as FlagId); // a lookup key
      if (decl === undefined) {
        report('world/flag-unknown-ref', path, `flag '${atom.id}' is not declared`);
      } else if (gating !== null && decl.section !== gating) {
        report('world/flag-scope', path, `flag '${atom.id}' is declared in section ${decl.section}: a gating condition of section ${gating} reads only its own section's flags (§4)`);
      }
    }
  }
  return [...out, ...condFindings(input, whens)];
}

export const FLAGS_LINT: WorldLint<FlagsCode> = { id: 'flags', codes: FLAGS_CODES, lint: flagsFindings };
