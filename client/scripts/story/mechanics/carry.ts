// Module `carry`'s build half (engine plan §6.6): the proof that a required item carried from chapter c to chapter r is
// held when r starts. Two lint entries with disjoint codes: the per-world pass over a receiver's own data
// (`world/inherit-count`, `world/inherit-item`), and a story-level entry whose rules run from scripts/story.ts over every
// chapter at once (story/items.json, the giver's paths, its leaves, what consumes a carried item, the tiers). Build only
// and pure, no node:*: world.ts imports the registry and scan-dist.ts imports world.ts. Its imports from index.ts and
// lint.ts are `import type`; it never imports `world.ts`, `graph.ts` or `softlock.ts` (index.ts's header): story.ts hands
// it the graph's facts as plain data, and softlock.ts reads its code table.
import { ownScope } from '../../../src/mechanics/rules/search.ts';
import type { SectionId } from '../../../src/story/staging.ts';
import { toPublic } from '../../../src/world/decode.ts';
import type { Finding, Severity } from '../lint.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** D2: at most this many optional inherited items per receiver, so each section proves at most 2^3 starts. */
export const MAX_OPTIONAL_INHERITS = 3;

/** The per-world codes: a receiver's own data. Each is a refusal. */
export const CARRY_CODES = {
  'world/inherit-count': 'E',
  'world/inherit-item': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type CarryCode = keyof typeof CARRY_CODES;

/** The story-level codes (scripts/story.ts runs their rules over every chapter; softlock.ts raises `world/carry-leave`).
 *  Each is a refusal: a carry that does not hold would inject at r's start what play never gave. */
export const CARRY_PROOF_CODES = {
  'world/carry-registry': 'E',
  'world/carry-inherit': 'E',
  'world/carry-mark': 'E',
  'world/carry-required-path': 'E',
  'world/carry-giver-prefix': 'E',
  'world/carry-leave': 'E',
  'world/carry-consumed': 'E',
  'world/carry-tier': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
export type CarryProofCode = keyof typeof CARRY_PROOF_CODES;

/**
 * A receiver's own data: more than MAX_OPTIONAL_INHERITS optional inherited items (`world/inherit-count`: its sections
 * are then not searched), and an inherited item it does not declare or that a section of it gives (`world/inherit-item`:
 * S's own items, `ownScope`, kernel and module gifts alike, are what `resetSection` drops, so a section's start would
 * lose the inherited item).
 */
export function carryFindings(input: WorldLintInput): Finding[] {
  const w = input.world;
  const d = w.mods.carry;
  if (d.inherits.length === 0) {
    return [];
  }
  const out: Finding[] = [];
  const report = (code: CarryCode, path: string, message: string): void => {
    out.push({ code, severity: CARRY_CODES[code], file: input.file, line: input.line(path), message });
  };
  const optional = d.inherits.filter((e) => !e.required).length;
  if (optional > MAX_OPTIONAL_INHERITS) {
    report('world/inherit-count', 'inherits', `${optional} optional inherited items: at most ${MAX_OPTIONAL_INHERITS}, each doubles the starts a section proves (§6.6)`);
  }
  const kw = { ...toPublic(w), mods: w.mods };
  const sections = Object.keys(w.sections) as SectionId[]; // the keys of a decoded world's sections
  d.inherits.forEach((e, n) => {
    const path = `inherits.${n}`;
    if (!Object.hasOwn(w.items, e.id)) {
      report('world/inherit-item', path, `item '${e.id}' is inherited but not declared in items: the receiver declares its texts (§6.6)`);
      return;
    }
    for (const s of sections.filter((x) => ownScope(kw, x).items.has(e.id))) {
      report('world/inherit-item', path, `item '${e.id}' is inherited and given in section ${s}: its reset would drop the inherited item (§6.6)`);
    }
  });
  return out;
}

export const CARRY_LINT: WorldLint<CarryCode> = { id: 'carry', codes: CARRY_CODES, lint: carryFindings };
export const CARRY_PROOF_LINT: WorldLint<CarryProofCode> = { id: 'carry-proof', codes: CARRY_PROOF_CODES, runsFrom: 'story' };
