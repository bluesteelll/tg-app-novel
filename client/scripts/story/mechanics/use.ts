// Module `use`'s build half (engine plan §6.1): its text walker (each rule's `say`, each item's and room's `refuse`,
// role toast) and its world lint: `world/use-unknown-ref` (a rule names an id the world or the chapter lacks),
// `world/use-cross-section` (X15 against S's own facts, `ownScope`: a rule reads and writes only its own section, a gift
// belongs to one section) with its `when` through the gating condition lint, and `world/keep-consumed` (a tool that
// stays held is used up elsewhere). Build only and pure, no node:*: world.ts imports the registry and scan-dist.ts
// imports world.ts. Its imports from index.ts and lint.ts are `import type`; it never imports world.ts (index.ts's
// header).
import { hotspotKey, lockOf, own, sectionScope, worldIndex } from '../../../src/explore/reduce.ts';
import type { UseData, UseRule } from '../../../src/mechanics/data/use.ts';
import { ownScope } from '../../../src/mechanics/rules/search.ts';
import type { SectionId } from '../../../src/story/staging.ts';
import { toPublic } from '../../../src/world/decode.ts';
import type { HotspotKey, ItemId, RoomId } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import { condFindings } from './conditions.ts';
import type { CondSite } from './conditions.ts';
import type { WorldLint, WorldLintInput } from './index.ts';
import type { ModuleText, TextWalker } from './texts.ts';

/**
 * The texts of `use`'s data in source order: every item's `refuse`, then per room each target's rules' `say` and the
 * room's `refuse`; all toasts (a note that lives seconds), never a clue.
 */
export const USE_TEXTS: TextWalker<UseData> = (w, d, at) => {
  const out: ModuleText[] = [];
  for (const [id, text] of Object.entries(d.refuse.items)) {
    out.push({ text, path: `${at.item(id as ItemId)}.refuse`, role: 'toast', reach: [] }); // a key of a decoded `refuse.items`
  }
  for (const s of Object.values(w.sections)) {
    for (const [room, r] of Object.entries(s.rooms)) {
      const rid = room as RoomId; // a key of a decoded section's rooms
      for (const h of r.hotspots) {
        const key = hotspotKey(rid, h.id);
        (own(d.uses, key) ?? []).forEach((rule, i) => {
          if (rule.say !== null) {
            out.push({ text: rule.say, path: `${at.hotspot(key)}.uses.${i}.say`, role: 'toast', reach: [] });
          }
        });
      }
      const refuse = own(d.refuse.rooms, rid);
      if (refuse !== undefined) {
        out.push({ text: refuse, path: `${at.room(rid)}.refuse`, role: 'toast', reach: [] });
      }
    }
  }
  return out;
};

/** Every `use` code with its severity: a dangling id or a cross-section rule is an authoring fault the proof would carry. */
export const USE_CODES = {
  'world/use-unknown-ref': 'E',
  'world/use-cross-section': 'E',
  'world/keep-consumed': 'W',
} as const satisfies Readonly<Record<string, Severity>>;
type UseCode = keyof typeof USE_CODES;

/** One target's rules with its source path. */
type Target = { readonly key: HotspotKey; readonly path: string; readonly rules: readonly UseRule[] };

function targetsOf(d: UseData): Target[] {
  // The keys of a decoded `uses` are hotspot keys.
  return (Object.entries(d.uses) as Array<[HotspotKey, readonly UseRule[]]>).map(([key, rules]) => ({ key, path: d.paths[`hotspot:${key}`] ?? '', rules }));
}

/** `world/keep-consumed`: each keeping slot whose item another slot without `keep` or a consuming rule takes. */
function keepFindings(input: WorldLintInput, d: UseData, report: (code: UseCode, path: string, message: string) => void): void {
  if (d.keep.length === 0) {
    return;
  }
  const ix = worldIndex(toPublic(input.world));
  const accepts = (slot: string): ItemId | undefined => {
    const [key = '', index = ''] = slot.split('#');
    const entry = ix.hotspots.get(key as HotspotKey); // a slot id is `<HotspotKey>#<index>`
    return (entry === undefined ? null : lockOf(entry.hotspot))?.slots[Number(index)]?.accepts;
  };
  const kept = new Set(d.keep);
  for (const slot of d.keep) {
    const item = accepts(slot);
    if (item === undefined) {
      continue;
    }
    const consumers: string[] = [];
    for (const [key, entry] of ix.hotspots) {
      lockOf(entry.hotspot)?.slots.forEach((s, i) => {
        if (s.accepts === item && !kept.has(`${key}#${i}`)) {
          consumers.push(`slot ${key}#${i}`);
        }
      });
    }
    for (const t of targetsOf(d)) {
      t.rules.forEach((r, i) => {
        if (r.item === item && !r.keep) {
          consumers.push(`rule ${i} of ${t.key}`);
        }
      });
    }
    if (consumers.length > 0) {
      const path = `${d.paths[`slot:${slot}`] ?? ''}.keep`;
      report('world/keep-consumed', path, `slot ${slot} keeps item '${item}' held, but ${consumers.join(', ')} consume${consumers.length === 1 ? 's' : ''} it: a tool that stays is never used up (§6.1)`);
    }
  }
}

/**
 * `use`'s lint of one world. `world/keep-consumed` reads the data alone; the rules' checks, `world/use-unknown-ref` and
 * `world/use-cross-section` (S's own facts: `ownScope` over the proof world with `mods`) with each `when` a gating
 * condition of its target's section, run only for a world whose data holds a rule, so a world without one builds no
 * proof world here.
 */
export function useFindings(input: WorldLintInput): Finding[] {
  const out: Finding[] = [];
  const report = (code: UseCode, path: string, message: string): void => {
    out.push({ code, severity: USE_CODES[code], file: input.file, line: input.line(path), message });
  };
  const d = input.world.mods.use;
  keepFindings(input, d, report);
  const targets = targetsOf(d).filter((t) => t.rules.length > 0);
  if (targets.length === 0) {
    return out;
  }
  const w = input.world;
  const kw = { ...toPublic(w), mods: w.mods };
  const ix = worldIndex(kw);
  const sections = Object.keys(w.sections) as SectionId[]; // the keys of a decoded world's sections
  const sites: CondSite[] = [];
  for (const t of targets) {
    const section = ix.hotspots.get(t.key)?.section;
    if (section === undefined) {
      continue; // an owned hotspot key is a hotspot of the world
    }
    const scope = ownScope(kw, section);
    t.rules.forEach((r, i) => {
      const at = `${t.path}.uses.${i}`;
      const rule = `rule ${i} of ${t.key}`;
      const known = (id: ItemId): boolean => Object.hasOwn(w.items, id);
      if (!known(r.item)) {
        report('world/use-unknown-ref', `${at}.item`, `${rule}: item '${r.item}' is not defined`);
      } else if (!scope.items.has(r.item)) {
        report('world/use-cross-section', `${at}.item`, `${rule}: item '${r.item}' is no item section ${section} gives: a rule reads only its own section (X15)`);
      }
      r.do.forEach((e, j) => {
        const path = `${at}.do.${j}`;
        if ('give' in e) {
          if (!known(e.give)) {
            report('world/use-unknown-ref', `${path}.give`, `${rule}: item '${e.give}' is not defined`);
            return;
          }
          for (const other of sections.filter((x) => x !== section)) {
            if (ownScope(kw, other).items.has(e.give)) {
              report('world/use-cross-section', `${path}.give`, `${rule}: item '${e.give}' is given in section ${section} and in section ${other} (X15: a gift belongs to one section)`);
            }
            for (const l of sectionScope(kw, other).locks.filter((x) => x.lock.slots.some((s) => s.accepts === e.give))) {
              report('world/use-cross-section', `${path}.give`, `${rule}: item '${e.give}' is given in section ${section} and required by lock ${l.key} of section ${other} (X15)`);
            }
          }
        } else if ('unlock' in e) {
          const target = ix.hotspots.get(e.unlock);
          if (target === undefined || lockOf(target.hotspot) === null) {
            report('world/use-unknown-ref', `${path}.unlock`, `${rule}: hotspot '${e.unlock}' is ${target === undefined ? 'not defined' : 'no lock'}`);
          } else if (!scope.hotspots.has(e.unlock)) {
            report('world/use-cross-section', `${path}.unlock`, `${rule} (section ${section}) unlocks ${e.unlock} of section ${target.section} (X15: a rule writes only its own section)`);
          }
        } else if (input.knots !== null && !input.knots.has(e.story)) {
          report('world/use-unknown-ref', `${path}.story`, `${rule}: knot '${e.story}' of ${input.chapter.id} is not defined`);
        }
      });
      if (r.when !== null) {
        sites.push({ cond: r.when, path: `${at}.when`, scope: { gating: section } });
      }
    });
  }
  return [...out, ...condFindings(input, sites)];
}

export const USE_LINT: WorldLint<UseCode> = { id: 'use', codes: USE_CODES, lint: useFindings };
