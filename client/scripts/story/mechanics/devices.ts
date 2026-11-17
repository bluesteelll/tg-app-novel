// Module `devices`' build half (engine plan §7.5 "Placement lints", the band): its world lint, with its own codes (all
// errors), and the device bar's band constants. A puzzle whose type is `presentation: 'view'` is the puzzle of exactly
// one lock, the zero-slot lock of a view room's `device` hotspot, and a `device` sits only in a view
// (`world/view-type-site`); a device's hotspot carries a zero-slot lock with a puzzle of a view type
// (`world/device-type`); a view type has no close-up (`world/device-closeup`). The device hotspot is a plain `object`
// with no `uses` (`world/device-object`), always present (`world/device-when`), the room's only puzzle lock
// (`world/device-alone`) and no trigger's `unlock` target (`world/device-unlock`): the arrival hook opens its session,
// so nothing else may hide, open or replace it. A capped device shows its jam (`world/device-failed-state`), and a `part`
// atom reads its own room's device within the type's answer shape (`world/device-part`). Each part of a device's puzzle,
// as its type's lint half gives it (`partRects`), lies inside the safe frame, under the device bar's band, with each side
// at least the hotspot minimum, and over no other part (`world/device-parts-frame`); a view type whose lint half gives no
// rects is skipped here and held to them by the registry pin. A `device` naming a hotspot its room lacks is the DSL's
// `world/unknown-ref`. The registries are parameters (`types`, the one the world was decoded with, and `lints`, the
// puzzle lint halves): a fixture view type in tests beside the registered ones. A device carries no text and enters no
// knot, so the module has no text or story walker. Build only and pure, no node:*: world.ts imports the registry and
// scan-dist.ts imports world.ts. Its imports from index.ts and lint.ts are `import type`; it never imports world.ts
// (index.ts's value graph has no edge back), and the puzzle lint registry it reads imports nothing of mechanics/. It
// alone imports geom/cover.ts: the module's src halves stay pure-world.
import { hotspotKey, lockOf, own } from '../../../src/explore/reduce.ts';
import { HOTSPOT_MIN_SOURCE_PX, HOTSPOT_SAFE_FRAME, ROOM_SOURCE } from '../../../src/geom/cover.ts';
import { condEntry, condReads } from '../../../src/mechanics/data/conditions.ts';
import type { Cond } from '../../../src/mechanics/data/conditions.ts';
import type { PartAtom } from '../../../src/mechanics/data/devices.ts';
import { PUZZLE_TYPES } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleTypes } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleLocalId, Rect } from '../../../src/story/staging.ts';
import type { Effect, HotspotKey, RoomId } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import { PUZZLE_LINTS } from '../puzzles/index.ts';
import type { PuzzleLintRegistry } from '../puzzles/shape.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** Every code of the module with its severity: all errors (a device that breaks one cannot be played or abandoned). */
export const DEVICES_CODES = {
  'world/view-type-site': 'E',
  'world/device-type': 'E',
  // This module's check (RULINGS 353 Q1 (c)) over GM8a's part-rects accessor (`PuzzleTypeLint.partRects`): each part
  // inside HOTSPOT_SAFE_FRAME, each side at least HOTSPOT_MIN_SOURCE_PX, both from geom/cover.ts, its top at or below
  // DEVICE_BAND_Y, and no part over another.
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
 * Every device part's top edge lies at or below this canonical y (`world/device-parts-frame`, this module's check):
 * 64 + 432 = 496 at the 320 px worst case. At the 360 px design width (telegram/viewport.ts, Q67) the same formula gives
 * 448, so 496 is the stricter bound and stays.
 */
export const DEVICE_BAND_Y = deviceBandY(DEVICE_BAR_CSS_H, DEVICE_TOP_INSET_CSS);

/** Every `part` atom of `c`, in tree order (a `not`'s included). */
function partsOf(c: Cond): PartAtom[] {
  const [kind, value] = condEntry(c);
  if (kind === 'all' || kind === 'any') {
    return (value as readonly Cond[]).flatMap(partsOf); // a decoded combinator holds its members
  }
  if (kind === 'not') {
    return partsOf(value as Cond); // a decoded `not` holds one condition
  }
  return kind === 'part' ? [value as PartAtom] : []; // module devices' decoder keeps a `part` atom's value
}

/** Whether two rects share an area; edge-touching ones do not (world.ts's local copy of the same test). */
function overlaps(a: Rect, b: Rect): boolean {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

/**
 * Where `rect` sits among `params`' own keys, by identity: `.<key>` for a value that is it, `.<key>.<i>` for an array
 * holding it; null when no key holds it (a lint half that returns copies). Both real halves return the decoded params'
 * own rects (levers' `rects`, setting's `rects` and `pull`).
 */
function paramPath(params: unknown, rect: Rect): string | null {
  if (typeof params !== 'object' || params === null) {
    return null;
  }
  for (const [key, v] of Object.entries(params)) {
    if (v === rect) {
      return `.${key}`;
    }
    const i = Array.isArray(v) ? v.indexOf(rect) : -1;
    if (i >= 0) {
      return `.${key}.${i}`;
    }
  }
  return null;
}

/**
 * `devices`' lint of one world, against `types` and `lints`: in source order per room (each device room's `device`: its
 * site, its hotspot and lock, the room's other puzzle locks, its failed state, then, in a device room, its puzzle's parts
 * once per puzzle, at its first device room), then per puzzle of a view type (its close-up, then every lock that carries
 * it), then per room again (each trigger list's `unlock` of a device, each visual condition's `part` atoms).
 */
export function devicesFindings(input: WorldLintInput, types: PuzzleTypes = PUZZLE_TYPES, lints: PuzzleLintRegistry = PUZZLE_LINTS): Finding[] {
  const out: Finding[] = [];
  // A module code takes its own table's severity; the DSL's `world/unknown-ref` is E in lint.ts's table, which this file
  // may only type-import (index.ts's header).
  const report = (code: DevicesCode | 'world/unknown-ref', path: string, message: string): void => {
    out.push({ code, severity: code === 'world/unknown-ref' ? 'E' : DEVICES_CODES[code], file: input.file, line: input.line(path), message: `${path}: ${message}` });
  };
  const w = input.world;
  const { devices: d, flags, use, visual } = w.mods;
  const typeOf = (p: PuzzleLocalId): string | undefined => own(w.puzzles, p)?.type;
  const isView = (p: PuzzleLocalId): boolean => {
    const t = typeOf(p);
    return types.find((x) => x.type === t)?.presentation === 'view';
  };
  // Every lock that carries a view-type puzzle, by puzzle; a lock is a device's when its room is a view whose `device`
  // names its hotspot and it has no slot.
  const viewLocks = new Map<PuzzleLocalId, Array<{ readonly path: string; readonly device: boolean; readonly slots: boolean }>>();
  // Each device's hotspot key, and each device room's puzzle (its device lock's), for the second pass.
  const deviceKeys = new Set<HotspotKey>();
  const devicePuzzle = new Map<RoomId, PuzzleLocalId>();
  // The device puzzles whose parts were judged: a puzzle that is the device of two rooms is one root cause, one finding.
  const judged = new Set<PuzzleLocalId>();
  const frame = HOTSPOT_SAFE_FRAME;
  /** The part rects of device puzzle `pid` (null: its type's lint half gives none, D2), judged once. */
  const partsOfDevice = (pid: PuzzleLocalId): readonly Rect[] | null => {
    const body = own(w.puzzles, pid);
    const half = body === undefined || !Object.hasOwn(lints, body.type) ? undefined : lints[body.type];
    const rects = body === undefined || half?.partRects === undefined ? null : half.partRects(body.params);
    if (body === undefined || rects === null || judged.has(pid)) {
      return rects;
    }
    judged.add(pid);
    const top = Math.max(frame.y0, DEVICE_BAND_Y);
    const floor = frame.y1;
    rects.forEach((rect, i) => {
      const [x, y, rw, rh] = rect;
      const causes: string[] = [];
      if (x < frame.x0) {
        causes.push(`starts at x ${x}, left of the safe frame's x ${frame.x0}`);
      }
      if (x + rw > frame.x1) {
        causes.push(`ends at x ${x + rw}, right of the safe frame's x ${frame.x1}`);
      }
      if (y < top) {
        causes.push(`starts at y ${y}, above the device bar's band at y ${top}`);
      }
      if (y + rh > floor) {
        causes.push(`ends at y ${y + rh}, below the safe frame's y ${frame.y1}`);
      }
      if (rw < HOTSPOT_MIN_SOURCE_PX || rh < HOTSPOT_MIN_SOURCE_PX) {
        causes.push(`is ${rw}×${rh}, a side under ${HOTSPOT_MIN_SOURCE_PX} source px`);
      }
      rects.slice(0, i).forEach((o, j) => {
        if (overlaps(rect, o)) {
          causes.push(`overlaps part ${j}, which then takes its taps`);
        }
      });
      if (causes.length > 0) {
        const at = `puzzles.${pid}.params${paramPath(body.params, rect) ?? ''}`;
        report('world/device-parts-frame', at, `part ${i} of puzzle '${pid}' [${rect.join(', ')}] ${causes.join('; ')} (§7.5)`);
      }
    });
    return rects;
  };
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
        if (h !== undefined) {
          const key = hotspotKey(room, h.id);
          const spot = `${base}.hotspots.${r.hotspots.indexOf(h)}`;
          deviceKeys.add(key);
          if (h.kind !== 'object') {
            report('world/device-object', spot, `device hotspot '${id}' is ${h.kind === 'exit' ? 'an' : 'a'} ${h.kind}: a device's hotspot is an object (§7.5)`);
          }
          if (own(use.uses, key) !== undefined) {
            report('world/device-object', `${spot}.uses`, `device hotspot '${id}' carries uses: a device is played by its parts, never used on (§7.5)`);
          }
          if (own(flags.when, key) !== undefined) {
            report('world/device-when', `${spot}.when`, `device hotspot '${id}' has a when: a device is always present in its view (§7.5)`);
          }
          r.hotspots.forEach((x, j) => {
            const other = lockOf(x);
            if (x !== h && other !== null && other.puzzle !== null) {
              const message = `hotspot '${x.id}' carries puzzle '${other.puzzle}' beside device '${id}': a device room holds no other puzzle lock (§7.5)`;
              report('world/device-alone', `${base}.hotspots.${j}.lock.puzzle`, message);
            }
          });
          const p = lock === null ? null : lock.puzzle;
          const capped = p === null ? null : (own(w.puzzles, p)?.maxAttempts ?? null);
          if (p !== null) {
            devicePuzzle.set(room, p);
          }
          // The jam is shown by a decor state of the room or by the device hotspot's own state reading `{ failed: p }`.
          const rules = [...(own(visual.decor, room) ?? []).flatMap((x) => x.is), ...(own(visual.hotspots, key)?.is ?? [])];
          if (p !== null && capped !== null && !rules.some((x) => condReads(x.when).some((f) => f.kind === 'failed' && f.id === p))) {
            const message = `puzzle '${p}' has maxAttempts ${capped} and no decor or device state reads { failed: '${p}' }: a jammed device never looks live (§7.5)`;
            report('world/device-failed-state', at, message);
          }
          // A device room: a view whose `device` hotspot carries a zero-slot lock with a view-type puzzle (the lock the
          // view-lock pass below marks the device's). Any other room with a `device` key is refused above and judged no
          // further.
          if (isViewRoom && lock !== null && lock.slots.length === 0 && p !== null && isView(p)) {
            partsOfDevice(p);
          }
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
  for (const [sid, s] of Object.entries(w.sections)) {
    for (const [rid, r] of Object.entries(s.rooms)) {
      const room = rid as RoomId; // a key of a decoded section's rooms
      const base = `sections.${sid}.rooms.${rid}`;
      // A trigger's `unlock` of a device would open it past its own puzzle; reported at the list's path (a kernel list's
      // index is compacted around a module's effect, world.ts's `TriggerAt`), naming the trigger as world.ts does.
      const unlocks = (effects: readonly Effect[], path: string, owner: string): void => {
        for (const e of effects) {
          if ('unlock' in e && deviceKeys.has(e.unlock)) {
            report('world/device-unlock', path, `${owner} unlocks device ${e.unlock}: a device opens only by its own puzzle (§7.5)`);
          }
        }
      };
      unlocks(r.onEnter, `${base}.onEnter`, `room ${rid} onEnter`);
      const sites: Array<{ readonly cond: Cond; readonly path: string }> = [];
      r.hotspots.forEach((h, i) => {
        const key = hotspotKey(room, h.id);
        const spot = `${base}.hotspots.${i}`;
        if (h.kind !== 'exit') {
          unlocks(h.then, `${spot}.then`, `${key} then`);
        }
        const lock = lockOf(h);
        if (lock !== null) {
          unlocks(lock.onOpen, `${spot}.lock.onOpen`, `${key} onOpen`);
          unlocks(lock.onFail, `${spot}.lock.onFail`, `${key} onFail`);
        }
        (own(use.uses, key) ?? []).forEach((x, j) => unlocks(x.do, `${spot}.uses.${j}.do`, `rule ${j} of ${key}`));
        (own(visual.hotspots, key)?.is ?? []).forEach((x, j) => sites.push({ cond: x.when, path: `${spot}.is.${j}.when` }));
      });
      (own(visual.decor, room) ?? []).forEach((x, j) => x.is.forEach((y, i) => sites.push({ cond: y.when, path: `${base}.decor.${j}.is.${i}.when` })));
      // A part reads its own room's device's saved work, within the type's answer shape (`shapeProblem`'s range).
      const device = devicePuzzle.get(room) ?? null;
      const data = device === null ? undefined : types.find((x) => x.type === typeOf(device));
      const params = device === null ? undefined : own(w.puzzles, device)?.params;
      const shape = data === undefined || params === undefined ? null : data.answerShape(params);
      for (const { cond, path } of sites) {
        for (const a of partsOf(cond)) {
          const atom = JSON.stringify({ part: a });
          if (a.puzzle !== device) {
            const which = device === null ? `room '${rid}' has no device` : `room '${rid}''s device is '${device}'`;
            report('world/device-part', path, `${atom} reads puzzle '${a.puzzle}', but ${which}: a part reads its own room's device (§7.5)`);
          } else if (shape !== null && a.index >= shape.len) {
            report('world/device-part', path, `${atom}: index ${a.index} is not below the device's ${shape.len} parts (§7.5)`);
          } else if (shape !== null && a.is > shape.max) {
            report('world/device-part', path, `${atom}: is ${a.is} is outside the part's range 0..${shape.max} (§7.5)`);
          }
        }
      }
    }
  }
  return out;
}

export const DEVICES_LINT = { id: 'devices', codes: DEVICES_CODES, lint: (input: WorldLintInput) => devicesFindings(input) } satisfies WorldLint<DevicesCode>;
