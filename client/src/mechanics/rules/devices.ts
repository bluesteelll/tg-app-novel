// Module `devices`' rules half (engine plan §7.5): a device view's session opens on arrival. The `arrived` hook runs
// once per `room` effect into the room (core's three pushes: a move, a resume, an event return; never while a knot is
// pending, core's own guard): a device with no outcome whose hotspot is not open and is present opens its puzzle, the
// same `puzzle` effect its hotspot's tap reaches through the zero-slot lock (`lockTap`), so the proof's states are
// unchanged; a solved device plays `module:devices:done`, a failed one `module:devices:jammed`, and neither opens. The
// hook keys on the room's `device` key alone, never on the puzzle type's presentation: the registry entry sees the
// default types only, and the type is the story gate's (`world/device-type`). `device-moved` writes a part move into
// the device's run (`run.work`) through the writer: never enumerated by `actions`, it stays outside the section key,
// and a stale move (no live device run in the current room) writes nothing. The visual atom `part` reads the saved work,
// or the type's `initial` while there is none. Every read of the module's data goes through `w.mods?.devices`: the
// soft-lock proof also runs a public body without `mods`, which has no device.
// Explore-ui chunk code (the `rules-lazy` arch rule): rules/index.ts builds the entry from these function
// declarations, and the registry is read only inside function bodies (devices.ts -> flags.ts -> conditions.ts ->
// index.ts is on the registry's import cycle). Pure.
import { hotspotKey, lockOf, own, runOf, worldIndex } from '../../explore/reduce.ts';
import type { WorldState } from '../../explore/state.ts';
import { PUZZLE_TYPES, puzzleInstance } from '../../puzzles/rules/index.ts';
import type { PuzzleTypes } from '../../puzzles/rules/index.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import type { HotspotKey, RoomId } from '../../world/types.ts';
import type { ArrivalOut, FactAtom, KernelWorld } from '../contract.ts';
import type { PartAtom } from '../data/devices.ts';
import { present } from './flags.ts';
import type { KernelWriter } from './writer.ts';

/** The module's cue names: an arrival at a solved device, an arrival at a failed one. */
export type DevicesCue = 'done' | 'jammed';
/** A device's part move: the session's whole working answer after it (§7.5 "One write path"). */
export type DeviceMoved = { readonly kind: 'device-moved'; readonly puzzle: PuzzleLocalId; readonly work: readonly number[] };

/**
 * The device of room `room`: its hotspot key and its lock's puzzle, when the room's `device` names a hotspot of the room
 * whose lock has no slot and a puzzle of the world; else null (a reference the story gate would reject opens nothing).
 */
export function deviceAt(w: KernelWorld, room: RoomId): { readonly key: HotspotKey; readonly puzzle: PuzzleLocalId } | null {
  const d = w.mods?.devices;
  const id = d === undefined ? undefined : own(d.device, room);
  if (id === undefined) {
    return null;
  }
  const ix = worldIndex(w);
  const key = hotspotKey(room, id);
  const entry = ix.hotspots.get(key);
  const lock = entry === undefined ? null : lockOf(entry.hotspot);
  return lock === null || lock.slots.length > 0 || lock.puzzle === null || !ix.puzzles.has(lock.puzzle) ? null : { key, puzzle: lock.puzzle };
}

/** The arrival hook (`MechanicRules.arrived`): the device's session, or its outcome's cue. It writes no state. */
export function arriveDevice(w: KernelWorld, s: WorldState, room: RoomId, out: ArrivalOut<'devices', DevicesCue>): void {
  const device = deviceAt(w, room);
  if (device === null) {
    return;
  }
  const outcome = runOf(s, device.puzzle).outcome;
  if (outcome === 'solved') {
    out.cue('devices', 'done', device.key);
  } else if (outcome === 'failed') {
    out.cue('devices', 'jammed', device.key);
  } else if (outcome === null && !s.open.includes(device.key) && present(w, s, device.key)) {
    // `lockTap`'s condition on a zero-slot lock (every slot of none is filled): the edge the device's own tap reaches.
    out.effect({ kind: 'puzzle', puzzle: device.puzzle, hotspot: device.key });
  }
}

/** None: a part move is the device session's, never a proof step (§7.5: outside the key). */
export function devicesActions(): readonly DeviceMoved[] {
  return [];
}

/** A value the save keeps (the save codec's `count`): a non-negative safe integer. */
function isCount(v: number): boolean {
  return Number.isSafeInteger(v) && v >= 0;
}

/**
 * `device-moved`: the run's `work` becomes the move's, its part changes recorded as `work` facts at the device. A move
 * outside a section's room, while a knot is pending, for a puzzle that is not the room's device or whose run has ended,
 * or with a value the save cannot keep, is a no-op: each guard reads the world and the state, never a type, so none can
 * refuse a move a live device session made.
 */
export function applyDevices(w: KernelWorld, a: DeviceMoved, out: KernelWriter<'devices', DevicesCue>): void {
  const s = out.state;
  if (s.section === null || s.room === null || s.pendingStory.length > 0 || !a.work.every(isCount)) {
    return;
  }
  const device = deviceAt(w, s.room);
  const run = runOf(s, a.puzzle);
  if (device === null || device.puzzle !== a.puzzle || run.outcome !== null) {
    return;
  }
  out.run(a.puzzle, { ...run, work: [...a.work] }, { verb: 'device', at: device.key, item: null, via: null });
}

/** A device's saved working configuration: its run's `work`, else its type's `initial` (a reset run), else null (a
 *  puzzle the world lacks, or a type `types` lacks). */
export function savedWork(w: KernelWorld, s: WorldState, p: PuzzleLocalId, types: PuzzleTypes = PUZZLE_TYPES): readonly number[] | null {
  const work = runOf(s, p).work;
  if (work !== undefined) {
    return work;
  }
  const puzzle = own(w.puzzles, p);
  return puzzle === undefined ? null : (puzzleInstance(puzzle, types)?.initial() ?? null);
}

/** `{ part: { puzzle, index, is } }` holds while part `index` of the puzzle's saved work is at `is`. */
export function partHolds(w: KernelWorld, s: WorldState, atom: PartAtom, types: PuzzleTypes = PUZZLE_TYPES): boolean {
  return savedWork(w, s, atom.puzzle, types)?.[atom.index] === atom.is;
}

/** The registry's `holds` for the module's atom, with the default types. */
export function holdsPart(w: KernelWorld, s: WorldState, atom: { readonly kind: string; readonly value: unknown }): boolean {
  return partHolds(w, s, atom.value as PartAtom); // a decoded `part` atom's value (`decodePartAtom`)
}

/** None: the module's rules read no fact a gating rule keys (a device's arrival opens what its tap opens). */
export function devicesReads(): readonly FactAtom[] {
  return [];
}
