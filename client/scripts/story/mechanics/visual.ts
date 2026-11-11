// Module `visual`'s build half (engine plan §6.4): its world lint. A state's picture, a patch and a decor picture must be
// catalog props (`world/unknown-asset`, the DSL's code for the same fault in a hotspot `prop`); `states` and `is` sit
// only on a `take` or an `object` hotspot, the kinds that carry a picture (`world/schema`: the module's decoder gets
// only its owned keys, so the kind is checked here); every `is.when` is a visual condition, bounded by
// `world/cond-size` and free to read any section (§4 "Two scopes"). It registers no code of its own (RULINGS 245 Q2).
// An undeclared `is.state` is the decoder's refusal. A visual state carries no text and enters no knot, so the module
// has no text or story walker. Build only and pure, no node:*: world.ts imports the registry and scan-dist.ts imports
// world.ts. Its imports from index.ts and lint.ts are `import type`; it never imports world.ts (index.ts's header).
import { hotspotKey, own } from '../../../src/explore/reduce.ts';
import type { IsRule, StateArt } from '../../../src/mechanics/data/visual.ts';
import type { PropId } from '../../../src/story/staging.ts';
import type { RoomId } from '../../../src/world/types.ts';
import type { Finding, LintCode } from '../lint.ts';
import { condFindings } from './conditions.ts';
import type { CondSite } from './conditions.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** The kinds whose hotspot draws a picture (`prop`). */
const PICTURE_KINDS: readonly string[] = ['take', 'object'];

/**
 * `visual`'s lint of one world, in source order per room (each hotspot, then the room's decor), the condition findings
 * last: every catalog miss of a state picture, a patch or a decor picture, every `states` / `is` on a kind with no
 * picture, and `world/cond-size` per `is.when`.
 */
export function visualFindings(input: WorldLintInput): Finding[] {
  const out: Finding[] = [];
  const report = (code: Extract<LintCode, 'world/unknown-asset' | 'world/schema'>, path: string, message: string): void => {
    out.push({ code, severity: 'E', file: input.file, line: input.line(path), message: `${path}: ${message}` });
  };
  const d = input.world.mods.visual;
  const prop = (id: PropId, path: string, what: string): void => {
    if (!Object.hasOwn(input.catalog.prop, id)) {
      report('world/unknown-asset', path, `${what} '${id}' is not in assets/catalog.json`);
    }
  };
  const sites: CondSite[] = [];
  const art = (states: Readonly<Record<string, StateArt>>, is: readonly IsRule[], path: string): void => {
    for (const [name, a] of Object.entries(states)) {
      if ('patch' in a) {
        prop(a.patch, `${path}.states.${name}.patch`, `state '${name}''s patch`);
      } else if (a.prop !== null) {
        prop(a.prop, `${path}.states.${name}.prop`, `state '${name}''s prop`);
      }
    }
    is.forEach((r, i) => sites.push({ cond: r.when, path: `${path}.is.${i}.when`, scope: 'visual' }));
  };
  for (const s of Object.values(input.world.sections)) {
    for (const [room, r] of Object.entries(s.rooms)) {
      const rid = room as RoomId; // a key of a decoded section's rooms
      for (const h of r.hotspots) {
        const key = hotspotKey(rid, h.id);
        const v = own(d.hotspots, key);
        const path = d.paths[`hotspot:${key}`];
        if (v === undefined || path === undefined) {
          continue;
        }
        if (!PICTURE_KINDS.includes(h.kind)) {
          const at = Object.keys(v.states).length > 0 ? `${path}.states` : `${path}.is`;
          report('world/schema', at, `a ${h.kind} hotspot draws no picture: states and is sit on a take or an object (§6.4)`);
        }
        art(v.states, v.is, path);
      }
      const path = d.paths[`room:${rid}`];
      (own(d.decor, rid) ?? []).forEach((x, j) => {
        const at = `${path ?? ''}.decor.${j}`;
        prop(x.prop, `${at}.prop`, `decor '${x.id}''s prop`);
        art(x.states, x.is, at);
      });
    }
  }
  return [...out, ...condFindings(input, sites)];
}

export const VISUAL_LINT: WorldLint<never> = { id: 'visual', codes: {}, lint: visualFindings };
