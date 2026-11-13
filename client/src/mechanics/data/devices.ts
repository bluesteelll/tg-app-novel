// Module `devices`' data half (engine plan §7.5): a view room's `device: <hotspot>` names the hotspot whose zero-slot
// lock holds the room's device puzzle. The device is drawn by the device, never as a hotspot button, and its session
// opens on arrival (the rules half). Its fact kind `work` (a part's position, `<puzzle>.<index>=<v>`) records the
// changes of a run's `work`, a device's working configuration, which stays outside the section key. Engine half:
// decoded at chapter load into `world.mods.devices`, written back by `encode` for emission and the version hash.
// Function declarations and types only: mechanics/data/index.ts builds the entry from them. Its data is plain JSON.
// Whether the hotspot exists, carries the right lock and sits in a view is the story gate's
// (client/scripts/story/mechanics/devices.ts). Pure.
import type { WorldState } from '../../explore/state.ts';
import type { Result } from '../../story/catalog.ts';
import type { HotspotId, RoomId } from '../../world/types.ts';
import type { Issue, KernelWorld, OwnedAt, OwnedRaw } from '../contract.ts';

export type DevicesData = {
  /** Each device room's device hotspot (its id within the room), in source order; a room with no device is absent. */
  readonly device: Readonly<Record<RoomId, HotspotId>>;
  /** Each device room's source path (`OwnedAt.path`): `encode` writes its `device` back there. */
  readonly paths: Readonly<Record<RoomId, string>>;
};

const ID_RE = /^[a-z][a-z0-9_]*$/;

/** Strict: `device` is a hotspot id, one spelling (no null: a room with no device has no key); every issue is reported at
 *  `<room path>.device`. */
export function decodeDevices(raw: OwnedRaw): Result<DevicesData, Issue[]> {
  const error: Issue[] = [];
  const device: Record<string, HotspotId> = {};
  const paths: Record<string, string> = {};
  for (const a of raw) {
    const path = `${a.path}.device`;
    const v = a.raw['device'];
    if (typeof v !== 'string') {
      error.push({ path, reason: 'shape', detail: `${JSON.stringify(v) ?? 'undefined'} is not a hotspot id (a string)` });
      continue;
    }
    if (!ID_RE.test(v)) {
      error.push({ path, reason: 'id', detail: `'${v}' is not a hotspot id ${ID_RE.source}` });
      continue;
    }
    device[a.id] = v as HotspotId; // an id by the pattern; its hotspot is the story gate's (`world/unknown-ref`)
    paths[a.id] = a.path;
  }
  return error.length > 0 ? { ok: false, error } : { ok: true, value: { device, paths } };
}

/** The inverse of `decodeDevices`: a world with no device encodes [], so its body and version are unchanged. */
export function encodeDevices(d: DevicesData): OwnedRaw {
  return Object.entries(d.device).map(([id, device]): OwnedAt => ({ place: 'room', id, path: d.paths[id as RoomId] ?? '', raw: { device } }));
}

/** Nothing to drop yet: a device's working state lives in its run. */
export function normalizeDevices(_w: KernelWorld, s: WorldState): WorldState {
  return s;
}
