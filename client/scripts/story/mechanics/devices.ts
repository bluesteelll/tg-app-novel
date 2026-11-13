// Module `devices`' build half (engine plan §7.5 "Placement lints", the band): its world lint, with its own codes (all
// errors), and the device bar's band constants. A puzzle whose type is `presentation: 'view'` is the puzzle of exactly
// one lock, the zero-slot lock of a view room's `device` hotspot, and a `device` sits only in a view
// (`world/view-type-site`); a device's hotspot carries a zero-slot lock with a puzzle of a view type
// (`world/device-type`); a view type has no close-up (`world/device-closeup`). A `device` naming a hotspot its room lacks
// is the DSL's `world/unknown-ref`. The types are a parameter (`types`, the registry the world was decoded with: a
// fixture view type in tests, since no registered type is a view before GM8a). A device carries no text and enters no
// knot, so the module has no text or story walker. Build only and pure, no node:*: world.ts imports the registry and
// scan-dist.ts imports world.ts. Its imports from index.ts and lint.ts are `import type`; it never imports world.ts
// (index.ts's header). It alone imports geom/cover.ts: the module's src halves stay pure-world.
import { lockOf, own } from '../../../src/explore/reduce.ts';
import { ROOM_SOURCE } from '../../../src/geom/cover.ts';
import { PUZZLE_TYPES } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleTypes } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleLocalId } from '../../../src/story/staging.ts';
import type { RoomId } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** Every code of the module with its severity: all errors (a device that breaks one cannot be played or abandoned). */
export const DEVICES_CODES = {
  'world/view-type-site': 'E',
  'world/device-type': 'E',
  // Registered with no check behind it yet (RULINGS 353 Q1 (c)): GM8a, the first real view type, adds the part-rects
  // accessor and the check (each part inside HOTSPOT_SAFE_FRAME, each side at least HOTSPOT_MIN_SOURCE_PX, both from
  // geom/cover.ts, and its top at or below DEVICE_BAND_Y). No world can hold a device before then: `world/device-type`
  // refuses every type that is not a view, and none is registered.
  'world/device-parts-frame': 'E',
  'world/device-closeup': 'E',
  'world/device-failed-state': 'E',
  'world/device-object': 'E',
  'world/device-when': 'E',
  'world/device-alone': 'E',
  'world/device-unlock': 'E',
  'world/device-part': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type DevicesCode = keyof typeof DEVICES_CODES;

/** The device bar's height bound, in CSS px (07 §7.5 round 6: its three rows come to 118, rounded up). */
export const DEVICE_BAR_CSS_H = 120;
/** The largest top inset above the bar, in CSS px: 0 while no launch path enters fullscreen (GM8h verifies it). */
export const DEVICE_TOP_INSET_CSS = 0;
/** The worst supported cover's width, in CSS px: 320 at 9:16, the safe frame's widest aspect (07 §7.5). */
const BAND_WIDTH_CSS = 320;
/** The canonical px a 9:16 cover crops at the top: (2048 - 1080 x 16 / 9) / 2 = 64. */
const TOP_CROP = (ROOM_SOURCE.h - (ROOM_SOURCE.w * 16) / 9) / 2;

/** The canonical y of the band's bottom edge for a bar of `barCss` under a top inset of `insetCss` at the worst cover
 *  (07 §7.5's integer form: each CSS px is 1080 / 320 = 3.375 canonical px, rounded up). */
export function deviceBandY(barCss: number, insetCss: number): number {
  return TOP_CROP + Math.ceil(((8 + barCss + insetCss) * ROOM_SOURCE.w) / BAND_WIDTH_CSS);
}

/**
 * Every device part's top edge lies at or below this canonical y (`world/device-parts-frame`, GM8a's check): 64 + 432 =
 * 496 at the 320 px worst case. At the 360 px design width (telegram/viewport.ts, Q67) the same formula gives 448, so
 * 496 is the stricter bound and stays.
 */
export const DEVICE_BAND_Y = deviceBandY(DEVICE_BAR_CSS_H, DEVICE_TOP_INSET_CSS);

/**
 * `devices`' lint of one world, in source order per room (each device room's `device`), then per puzzle of a view type
 * (its close-up, then every lock that carries it), against `types`.
 */
export function devicesFindings(input: WorldLintInput, types: PuzzleTypes = PUZZLE_TYPES): Finding[] {
  const out: Finding[] = [];
  // A module code takes its own table's severity; the DSL's `world/unknown-ref` is E in lint.ts's table, which this file
  // may only type-import (index.ts's header).
  const report = (code: DevicesCode | 'world/unknown-ref', path: string, message: string): void => {
    out.push({ code, severity: code === 'world/unknown-ref' ? 'E' : DEVICES_CODES[code], file: input.file, line: input.line(path), message: `${path}: ${message}` });
  };
  const w = input.world;
  const d = w.mods.devices;
  const typeOf = (p: PuzzleLocalId): string | undefined => own(w.puzzles, p)?.type;
  const isView = (p: PuzzleLocalId): boolean => {
    const t = typeOf(p);
    return types.find((x) => x.type === t)?.presentation === 'view';
  };
  // Every lock that carries a view-type puzzle, by puzzle; a lock is a device's when its room is a view whose `device`
  // names its hotspot and it has no slot.
  const viewLocks = new Map<PuzzleLocalId, Array<{ readonly path: string; readonly device: boolean; readonly slots: boolean }>>();
  for (const [sid, s] of Object.entries(w.sections)) {
    for (const [rid, r] of Object.entries(s.rooms)) {
      const room = rid as RoomId; // a key of a decoded section's rooms
      const base = `sections.${sid}.rooms.${rid}`;
      const isViewRoom = own(w.mods.view.of, room) !== undefined;
      const id = own(d.device, room);
      if (id !== undefined) {
        const at = `${base}.device`;
        if (!isViewRoom) {
          report('world/view-type-site', at, `room '${rid}' is no view: a device sits in a view room (§7.5)`);
        }
        const h = r.hotspots.find((x) => x.id === id);
        const lock = h === undefined ? null : lockOf(h);
        if (h === undefined) {
          report('world/unknown-ref', at, `device '${id}' names no hotspot of room '${rid}'`);
        } else if (lock === null || lock.slots.length > 0 || lock.puzzle === null) {
          const why = lock === null ? 'no lock' : lock.slots.length > 0 ? 'a lock with slots' : 'a lock with no puzzle';
          report('world/device-type', at, `hotspot '${id}' carries ${why}: a device's hotspot carries a zero-slot lock with its puzzle (§7.5)`);
        } else if (typeOf(lock.puzzle) !== undefined && !isView(lock.puzzle)) {
          report('world/device-type', at, `puzzle '${lock.puzzle}' is a ${String(typeOf(lock.puzzle))} puzzle: a device's puzzle is of a view type (§7.5)`);
        }
      }
      r.hotspots.forEach((h, i) => {
        const lock = lockOf(h);
        const p = lock === null ? null : lock.puzzle;
        if (lock === null || p === null || !isView(p)) {
          return;
        }
        const list = viewLocks.get(p) ?? [];
        list.push({ path: `${base}.hotspots.${i}.lock.puzzle`, device: isViewRoom && id === h.id && lock.slots.length === 0, slots: lock.slots.length > 0 });
        viewLocks.set(p, list);
      });
    }
  }
  for (const [pid, p] of Object.entries(w.puzzles)) {
    const puzzle = pid as PuzzleLocalId; // a key of a decoded world's puzzles
    if (!isView(puzzle)) {
      continue;
    }
    if (p.closeup !== null) {
      report('world/device-closeup', `puzzles.${pid}.closeup`, `view-type puzzle '${pid}' has close-up '${p.closeup}': a device is played in its room, never under a close-up (§7.5)`);
    }
    const locks = viewLocks.get(puzzle) ?? [];
    if (locks.length === 0) {
      report('world/view-type-site', `puzzles.${pid}`, `view-type puzzle '${pid}' is on no lock: a view type is played only by its device, never as a linear yield (§7.5)`);
    }
    for (const l of locks.filter((x) => !x.device)) {
      const where = l.slots ? 'a lock with slots' : "a lock that is no view room's device";
      report('world/view-type-site', l.path, `view-type puzzle '${pid}' is on ${where}: a view type is the puzzle of its device's zero-slot lock (§7.5)`);
    }
  }
  return out;
}

export const DEVICES_LINT = { id: 'devices', codes: DEVICES_CODES, lint: (input: WorldLintInput) => devicesFindings(input) } satisfies WorldLint<DevicesCode>;
