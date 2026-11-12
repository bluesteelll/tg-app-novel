// Module `view`'s build half (engine plan §6.3 "Lints"): its world lint, with its own codes (all errors). A view's
// `of` chain is at most two long and never a cycle (`world/view-depth`); its parent is a room of its own section
// (`world/view-section`); it is entered only by an exit of its parent (`world/view-entry`), and its exits lead only back
// to its parent or into its own child views (`world/view-exits`; a story exit is allowed). A parent that names no room is
// the DSL's `world/unknown-ref`. A view's hotspots sit inside the safe frame by `world/hotspot-frame`, which runs on
// every room. A view carries no text and enters no knot, so the module has no text or story walker. Build only and
// pure, no node:*: world.ts imports the registry and scan-dist.ts imports world.ts. Its imports from index.ts and
// lint.ts are `import type`; it never imports world.ts (index.ts's header).
import type { SectionId } from '../../../src/story/staging.ts';
import type { RoomId } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** Every code of the module with its severity: all errors. */
export const VIEW_CODES = {
  'world/view-depth': 'E',
  'world/view-section': 'E',
  'world/view-entry': 'E',
  'world/view-exits': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type ViewCode = keyof typeof VIEW_CODES;

/** The longest `of` chain: a view of a view of a room. */
export const VIEW_MAX_DEPTH = 2;

/**
 * `view`'s lint of one world, in source order per room: the room's own `view` (an unknown parent, else another
 * section's, else a chain too long or a cycle), then each of its exits to a room (an entry into a view from a room
 * other than its parent, and a view's exit to a room other than its parent or its own child view). An exit to a room
 * the world lacks is the kernel's to report.
 */
export function viewFindings(input: WorldLintInput): Finding[] {
  const out: Finding[] = [];
  // A module code takes its own table's severity (index.ts: "findings take `codes[code]`"); the DSL's
  // `world/unknown-ref` is E in lint.ts's table, which this file may only type-import (the header).
  const report = (code: ViewCode | 'world/unknown-ref', path: string, message: string): void => {
    out.push({ code, severity: code === 'world/unknown-ref' ? 'E' : VIEW_CODES[code], file: input.file, line: input.line(path), message: `${path}: ${message}` });
  };
  const d = input.world.mods.view;
  const sectionOf = new Map<RoomId, SectionId>();
  for (const [sid, s] of Object.entries(input.world.sections)) {
    for (const rid of Object.keys(s.rooms)) {
      sectionOf.set(rid as RoomId, sid as SectionId); // keys of a decoded world's sections and rooms
    }
  }
  const parent = (room: RoomId): RoomId | undefined => (Object.hasOwn(d.of, room) ? d.of[room] : undefined);
  for (const [sid, s] of Object.entries(input.world.sections)) {
    for (const [rid, r] of Object.entries(s.rooms)) {
      const room = rid as RoomId; // a key of a decoded section's rooms
      const base = `sections.${sid}.rooms.${rid}`;
      const of = parent(room);
      if (of !== undefined) {
        const at = `${base}.view`;
        if (!sectionOf.has(of)) {
          report('world/unknown-ref', at, `view.of '${of}' names no room`);
        } else if (sectionOf.get(of) !== sid) {
          report('world/view-section', at, `view.of '${of}' is a room of section ${String(sectionOf.get(of))}: a view zooms into a room of its own section (§6.3)`);
        } else {
          // Up the parents until a room that is no view (the chain's end) or one already on the chain (a cycle).
          const chain: RoomId[] = [room];
          let next = parent(room);
          while (next !== undefined && !chain.includes(next)) {
            chain.push(next);
            next = parent(next);
          }
          if (next !== undefined) {
            report('world/view-depth', at, `the views' parents return to '${next}' (${[...chain, next].join(' -> ')}): a cycle (§6.3)`);
          } else if (chain.length - 1 > VIEW_MAX_DEPTH) {
            report('world/view-depth', at, `a view ${chain.length - 1} levels deep (${chain.join(' -> ')}): at most ${VIEW_MAX_DEPTH} (§6.3)`);
          }
        }
      }
      r.hotspots.forEach((h, i) => {
        const to = h.kind === 'exit' && 'room' in h.to ? h.to.room : null;
        if (to === null || !sectionOf.has(to)) {
          return;
        }
        const at = `${base}.hotspots.${i}.to.room`;
        const toOf = parent(to);
        if (toOf !== undefined && toOf !== room) {
          report('world/view-entry', at, `an exit into view '${to}' from '${rid}': a view is entered only from its parent '${toOf}' (§6.3)`);
        }
        if (of !== undefined && to !== of && toOf !== room) {
          report('world/view-exits', at, `view '${rid}' leads to '${to}': a view's exits lead back to its parent '${of}' or into its own views (§6.3)`);
        }
      });
    }
  }
  return out;
}

export const VIEW_LINT = { id: 'view', codes: VIEW_CODES, lint: viewFindings } satisfies WorldLint<ViewCode>;
