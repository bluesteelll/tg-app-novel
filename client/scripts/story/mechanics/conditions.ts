// The condition lints of engine plan §4 ("Two scopes", "Limits"): a gating condition reads only its own section, so
// its atoms are in the section key (`world/cross-section-cond`) and no visual-only atom gates (`world/visual-only-atom`);
// every condition is bounded (`world/cond-size`). A build pass of the world lint registry (§3.2) over the world's
// clues; a module lane calls `condFindings` from its own lint file for its own sites (GM3's `uses.when` as gating,
// GM3b's `is` as visual). Build only and pure, no node:*: world.ts imports the registry and scan-dist.ts imports
// world.ts. Its imports from index.ts and lint.ts are `import type`; it imports nothing from world.ts, not even a type
// (index.ts's header).
import { sectionScope } from '../../../src/explore/reduce.ts';
import type { SectionScope } from '../../../src/explore/reduce.ts';
import { COND_MAX_ATOMS, COND_MAX_DEPTH, condEntry, condSize } from '../../../src/mechanics/data/conditions.ts';
import type { Cond } from '../../../src/mechanics/data/conditions.ts';
import { MECHANIC_DATA } from '../../../src/mechanics/data/index.ts';
import type { DataRegistry } from '../../../src/mechanics/data/index.ts';
import type { SectionId } from '../../../src/story/staging.ts';
import { toPublic } from '../../../src/world/decode.ts';
import type { WorldPublicBody, WorldSource } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** Every condition code with its severity: each is an authoring fault the proof or the runtime would carry. */
export const COND_CODES = {
  'world/cross-section-cond': 'E',
  'world/visual-only-atom': 'E',
  'world/cond-size': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type CondCode = keyof typeof COND_CODES;

/**
 * Where a condition sits, which decides its scope: `gating` (a hotspot `when`, `uses.when`, a recipe `when`: its
 * section's ids only), `visual` (`is`, `decor.is`: any id of the chapter) or `clue` (scoped by `world/clue-reachable`,
 * RULINGS 183). `path` is its dotted source path.
 */
export type CondSite = { readonly cond: Cond; readonly path: string; readonly scope: { readonly gating: SectionId } | 'visual' | 'clue' };

/** The id kind each kernel atom names, and the ids of that kind a section holds (its scope, the section key's). */
const SCOPED: Readonly<Record<string, readonly [string, (s: SectionScope) => ReadonlySet<string>]>> = {
  visited: ['room', (s) => s.rooms],
  taken: ['hotspot', (s) => s.hotspots],
  examined: ['hotspot', (s) => s.hotspots],
  open: ['hotspot', (s) => s.hotspots],
  held: ['item', (s) => s.items],
  used: ['item', (s) => s.items],
  has: ['item', (s) => s.items],
  doc: ['doc', (s) => s.docs],
  solved: ['puzzle', (s) => new Set(s.puzzles)],
  failed: ['puzzle', (s) => new Set(s.puzzles)],
};

/** Every atom of `c` in tree order (a `not`'s included), as a one-key condition. */
function atomsOf(c: Cond): Cond[] {
  const [kind, value] = condEntry(c);
  if (kind === 'all' || kind === 'any') {
    return (value as readonly Cond[]).flatMap(atomsOf); // a decoded combinator holds its members
  }
  return kind === 'not' ? atomsOf(value as Cond) : [c]; // a decoded `not` holds one condition
}

/**
 * The condition findings of `sites` (`data`: the data registry the world was decoded with, whose module atoms say
 * whether they may gate), each at its site's line: `world/cond-size` in every scope; in a gating one,
 * `world/cross-section-cond` per kernel atom naming no id of the section (its rooms, hotspot keys, the items and docs
 * it gives, its lock puzzles: `sectionScope`, the keys `sectionKey` reads) and `world/visual-only-atom` per module atom
 * declared `gating: false`. Another module's gating atom is its own module's to scope (flags' `world/flag-scope`).
 */
export function condFindings(input: WorldLintInput, sites: readonly CondSite[], data: DataRegistry = MECHANIC_DATA): Finding[] {
  const out: Finding[] = [];
  let pub: WorldPublicBody | null = null; // the section index, built at the first gating site
  for (const { cond, path, scope } of sites) {
    const report = (code: CondCode, message: string): void => {
      out.push({ code, severity: COND_CODES[code], file: input.file, line: input.line(path), message: `${path}: ${message}` });
    };
    const size = condSize(cond);
    if (size.depth > COND_MAX_DEPTH || size.atoms > COND_MAX_ATOMS) {
      const limit = `at most ${COND_MAX_DEPTH} deep and ${COND_MAX_ATOMS} atoms (bounded evaluation, §4)`;
      report('world/cond-size', `the condition is ${size.depth} deep with ${size.atoms} atoms: ${limit}`);
    }
    if (typeof scope !== 'object') {
      continue;
    }
    pub ??= toPublic(input.world);
    const section = sectionScope(pub, scope.gating);
    for (const atom of atomsOf(cond)) {
      const [kind, value] = condEntry(atom);
      const scoped = SCOPED[kind];
      if (scoped !== undefined) {
        const [what, ids] = scoped;
        if (!ids(section).has(typeof value === 'string' ? value : '')) {
          report('world/cross-section-cond', `${JSON.stringify(atom)} names no ${what} of section ${scope.gating}: a gating condition reads only its own section (§4)`);
        }
      } else if (data.some((d) => d.atoms !== undefined && Object.hasOwn(d.atoms, kind) && d.atoms[kind]?.gating === false)) {
        report('world/visual-only-atom', `${JSON.stringify(atom)} is a visual-only atom: a gating condition never reads it (§4)`);
      }
    }
  }
  return out;
}

/** Every puzzle's clues, as sites of scope `clue`. */
function clueSites(w: WorldSource): CondSite[] {
  return Object.entries(w.puzzles).flatMap(([pid, p]) => p.clues.map((cond, i): CondSite => ({ cond, path: `puzzles.${pid}.clues.${i}`, scope: 'clue' })));
}

export const CONDITIONS_LINT: WorldLint<CondCode> = { id: 'conditions', codes: COND_CODES, lint: (input) => condFindings(input, clueSites(input.world)) };
