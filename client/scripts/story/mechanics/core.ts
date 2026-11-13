// Module `core`'s world lint entry (engine plan §3.2): the kernel's `renamed` rules (§5.3), so a rename the load
// cannot follow never ships. The kernel's other world rules are lintWorld's (world.ts) with LINT_CODES. Build only and
// pure, no node:*: world.ts imports the registry and scan-dist.ts imports world.ts. Its imports from index.ts and
// lint.ts are `import type`; it never imports world.ts (index.ts's value graph has no edge back).
import { hotspotKey } from '../../../src/explore/reduce.ts';
import { RENAME_KINDS, finalTarget } from '../../../src/world/decode.ts';
import type { RoomId, WorldSource } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** Every `renamed` code with its severity: all errors. */
export const RENAME_CODES = {
  'world/renamed-target': 'E',
  'world/renamed-source': 'E',
  'world/renamed-cycle': 'E',
  'world/renamed-puzzles': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type RenameCode = keyof typeof RENAME_CODES;
type Kind = (typeof RENAME_KINDS)[number];

/** The ids of the world per kind: what a rename's chain must end at and its source must no longer be. */
function liveIds(w: WorldSource): Readonly<Record<Kind, ReadonlySet<string>>> {
  const rooms = new Set<string>();
  const hotspots = new Set<string>();
  for (const s of Object.values(w.sections)) {
    for (const [room, r] of Object.entries(s.rooms)) {
      rooms.add(room);
      for (const h of r.hotspots) {
        hotspots.add(hotspotKey(room as RoomId, h.id)); // a key of a decoded section's rooms
      }
    }
  }
  return {
    items: new Set(Object.keys(w.items)),
    docs: new Set(Object.keys(w.docs)),
    rooms,
    sections: new Set(Object.keys(w.sections)),
    hotspots,
    // Module `flags`' declarations (engine plan §6.5): a declared flag is a live rename target.
    flags: new Set(Object.keys(w.mods.flags.flags)),
    puzzles: new Set(Object.keys(w.puzzles)),
  };
}

/**
 * The `renamed` findings of one world, each at its entry: `world/renamed-source` for a source the world still has,
 * `world/renamed-cycle` for an entry whose chain returns to itself, else `world/renamed-target` for a chain that ends
 * at an id the world lacks, and `world/renamed-puzzles` for every puzzle entry (R-E4: refused until per-player GM6c1b
 * re-keys the stored puzzles). A hotspot entry is `<room>.<hotspot>` both sides; a room's rename moves none.
 */
export function renameFindings(input: WorldLintInput): Finding[] {
  const out: Finding[] = [];
  const r = input.world.renamed;
  if (r === undefined) {
    return out;
  }
  const report = (code: RenameCode, path: string, message: string): void => {
    out.push({ code, severity: RENAME_CODES[code], file: input.file, line: input.line(path), message });
  };
  const live = liveIds(input.world);
  for (const kind of RENAME_KINDS) {
    const map: Readonly<Record<string, string>> = r[kind] ?? {};
    for (const from of Object.keys(map)) {
      const path = `renamed.${kind}.${from}`;
      if (kind === 'puzzles') {
        report('world/renamed-puzzles', path, `renamed.puzzles: '${from}' is refused until stored puzzles are re-keyed (R-E4, per-player GM6c1b)`);
      }
      if (live[kind].has(from)) {
        report('world/renamed-source', path, `renamed.${kind}: '${from}' is still in this world: a rename's source is an id it no longer has (§5.3)`);
      }
      const end = finalTarget(map, from);
      if (end === null) {
        report('world/renamed-cycle', path, `renamed.${kind}: the chain from '${from}' returns to itself and ends at no id (§5.3)`);
      } else if (!live[kind].has(end)) {
        report('world/renamed-target', path, `renamed.${kind}: '${from}' ends at '${end}', which is not in this world (§5.3)`);
      }
    }
  }
  return out;
}

export const CORE_LINT = { id: 'core', codes: RENAME_CODES, lint: renameFindings } satisfies WorldLint<RenameCode>;
