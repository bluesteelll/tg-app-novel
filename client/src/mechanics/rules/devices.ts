// Module `devices`' rules half (engine plan §7.5): a device view's session opens on arrival. The `arrived` hook runs
// once per `room` effect into the room (core's three pushes: a move, a resume, an event return; never while a knot is
// pending, core's own guard): a device with no outcome whose hotspot is not open and is present opens its puzzle, the
// same `puzzle` effect its hotspot's tap reaches through the zero-slot lock (`lockTap`), so the proof's states are
// unchanged; a solved device plays `module:devices:done`, a failed one `module:devices:jammed`, and neither opens. The
// hook keys on the room's `device` key alone, never on the puzzle type's presentation: the registry entry sees the
// default types only, and the type is the story gate's (`world/device-type`). Every read of the module's data goes
// through `w.mods?.devices`: the soft-lock proof also runs a public body without `mods`, which has no device.
// Explore-ui chunk code (the `rules-lazy` arch rule): rules/index.ts builds the entry from these function
// declarations, and the registry is read only inside function bodies (devices.ts -> flags.ts -> conditions.ts ->
// index.ts is on the registry's import cycle). Pure.
import { hotspotKey, lockOf, own, runOf, worldIndex } from '../../explore/reduce.ts';
import type { WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import type { HotspotKey, RoomId } from '../../world/types.ts';
import type { ArrivalOut, FactAtom, KernelWorld } from '../contract.ts';
import { present } from './flags.ts';

/** The module's cue names: an arrival at a solved device, an arrival at a failed one. */
export type DevicesCue = 'done' | 'jammed';
/** The module enables no action yet. */
export type DevicesAction = never;

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

/** No action yet. */
export function devicesActions(): readonly DevicesAction[] {
  return [];
}

/** Never called: the module has no action kind yet. */
export function applyDevices(): void {}

/** None: the module's rules read no fact a gating rule keys (a device's arrival opens what its tap opens). */
export function devicesReads(): readonly FactAtom[] {
  return [];
}
