// Module `devices`' data half (engine plan §7.5): a view room's `device: <hotspot>` names the hotspot whose zero-slot
// lock holds the room's device puzzle. The device is drawn by the device, never as a hotspot button, and its session
// opens on arrival (the rules half). Its fact kind `work` (a part's position, `<puzzle>.<index>=<v>`) records the
// changes of a run's `work`, a device's working configuration, which stays outside the section key; its visual atom
// `{ part: { puzzle, index, is } }` holds while part `index` of the device's work is at `is` (a decor state's picture,
// never a gating read). Engine half: decoded at chapter load into `world.mods.devices`, written back by `encode` for
// emission and the version hash. Function declarations and types only: mechanics/data/index.ts builds the entry from
// them. Its data is plain JSON. Whether the hotspot exists, carries the right lock and sits in a view is the story
// gate's (client/scripts/story/mechanics/devices.ts). At resume, normalize drops a saved work its type judges no longer
// fits the puzzle, or throws on (`fitWork`). Pure.
import type { PuzzleRun, WorldState } from '../../explore/state.ts';
import { PUZZLE_TYPES } from '../../puzzles/rules/index.ts';
import type { PuzzleTypes } from '../../puzzles/rules/index.ts';
import type { Result } from '../../story/catalog.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import type { HotspotId, RoomId } from '../../world/types.ts';
import type { Issue, IssueReport, KernelWorld, OwnedAt, OwnedRaw } from '../contract.ts';

export type DevicesData = {
  /** Each device room's device hotspot (its id within the room), in source order; a room with no device is absent. */
  readonly device: Readonly<Record<RoomId, HotspotId>>;
  /** Each device room's source path (`OwnedAt.path`): `encode` writes its `device` back there. */
  readonly paths: Readonly<Record<RoomId, string>>;
};

/** The `part` atom's value: part `index` of puzzle `puzzle`'s working configuration is at `is`. */
export type PartAtom = { readonly puzzle: PuzzleLocalId; readonly index: number; readonly is: number };

const ID_RE = /^[a-z][a-z0-9_]*$/;
const PART_KEYS = ['puzzle', 'index', 'is'];

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

/**
 * The `part` atom's value (`atoms.part`, visual only): exactly `{ puzzle, index, is }`, a puzzle id and two integers
 * >= 0, every issue reported. Whether `puzzle` is a device (a visual site's its own room's, a clue's any room's) and the
 * integers are in its type's range is the story gate's (`world/device-part`, with the types).
 */
export function decodePartAtom(v: unknown, path: string, report: IssueReport): PartAtom | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    report(path, 'shape', `${JSON.stringify(v) ?? 'undefined'} is not a { puzzle, index, is } object`);
    return undefined;
  }
  const o = v as Readonly<Record<string, unknown>>; // an object, checked above
  let ok = true;
  for (const key of Object.keys(o).filter((x) => !PART_KEYS.includes(x))) {
    report(`${path}.${key}`, 'shape', `unknown key (a part has ${PART_KEYS.join(', ')})`);
    ok = false;
  }
  const { puzzle, index, is } = o;
  if (typeof puzzle !== 'string' || !ID_RE.test(puzzle)) {
    report(`${path}.puzzle`, 'id', `${JSON.stringify(puzzle) ?? 'undefined'} is not a puzzle id ${ID_RE.source}`);
    ok = false;
  }
  for (const [key, n] of [['index', index], ['is', is]] as const) {
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
      report(`${path}.${key}`, 'shape', `${JSON.stringify(n) ?? 'undefined'} is not an integer >= 0`);
      ok = false;
    }
  }
  // Each field checked above: a puzzle id and two integers.
  return ok ? { puzzle: puzzle as PuzzleLocalId, index: index as number, is: is as number } : undefined;
}

/**
 * Every run's saved `work` that its puzzle's type judges no longer fits the puzzle (`workFits` false, a new version's
 * params) goes, as `work:<puzzle>` in `dropped`; the run itself stays. A `workFits` that throws is a misfit too
 * (`instanceOf.fits`' reading, RULINGS 368): that work goes, unlogged, and every other run is judged as before. A type
 * with no `workFits`, or one `types` lacks, keeps its work: the drop belongs to the type that can judge it (a view
 * type's session seeds from a kept work only after its own check). `types` is read at call time, so the registry's load
 * order holds (data/index.ts's header).
 */
export function fitWork(w: KernelWorld, s: WorldState, dropped: string[], types: PuzzleTypes = PUZZLE_TYPES): WorldState {
  let puzzles: Record<PuzzleLocalId, PuzzleRun> | null = null;
  for (const [id, run] of Object.entries(s.puzzles)) {
    const p = id as PuzzleLocalId; // a key of the state's runs
    const body = Object.hasOwn(w.puzzles, p) ? w.puzzles[p] : undefined;
    if (run.work === undefined || body === undefined) {
      continue; // no work, or a puzzle the world lost (reconcile drops its whole run)
    }
    let fits: boolean | undefined;
    try {
      fits = types.find((t) => t.type === body.type)?.workFits?.(body.params, run.work);
    } catch {
      fits = false; // per run: one type's throw never stops the walk
    }
    if (fits === false) {
      const { work: _gone, ...kept } = run;
      puzzles ??= { ...s.puzzles };
      puzzles[p] = kept;
      dropped.push(`work:${p}`);
    }
  }
  return puzzles === null ? s : { ...s, puzzles };
}

/** At resume: a saved work that no longer fits its device goes (`fitWork` over the registered types). */
export function normalizeDevices(w: KernelWorld, s: WorldState, dropped: string[]): WorldState {
  return fitWork(w, s, dropped);
}
