// Module `view`'s rules half (engine plan §6.3): a view is a room with `view: { of }`, a zoom of its parent `of`. An
// exit of `of` into the view zooms in, its exit back (if any) and `leave-view` zoom out: `moveHow` names the kind of
// every move core's exit tap makes, and `leave-view` moves through core's own `arrive`, so a leave is the same state an
// exit back reaches. `nearRooms` is THE exit-rooms rule the explore controller preloads by and the story tool writes
// as a room's usage neighbours (GM4g carry 1). Explore-ui chunk code (the `rules-lazy` arch rule): rules/index.ts
// builds the entry from these function declarations, as it does core's (the core.ts <-> view.ts imports are function
// declarations only). Pure.
import { own, worldIndex } from '../../explore/reduce.ts';
import type { WorldState } from '../../explore/state.ts';
import type { RoomId } from '../../world/types.ts';
import type { FactAtom, KernelWorld } from '../contract.ts';
import { arrive } from './core.ts';
import type { KernelWriter } from './writer.ts';

/** Back out of a view to its parent: the proof enumerates it, the controller's `back()` dispatches it. */
export type ViewAction = { readonly kind: 'leave-view' };

const LEAVE: readonly ViewAction[] = [{ kind: 'leave-view' }];

/** `of` of a view room; null: not a view. The public body alone has no `mods` (the proof path's runtime guard). */
export function viewParent(w: KernelWorld, room: RoomId): RoomId | null {
  const d = w.mods?.view;
  return d === undefined ? null : (own(d.of, room) ?? null);
}

/** The kind of a move from -> to: 'zoom-in' (to is a view of from), 'zoom-out' (from is a view of to), else 'walk'. */
export function moveHow(w: KernelWorld, from: RoomId, to: RoomId): 'walk' | 'zoom-in' | 'zoom-out' {
  return viewParent(w, to) === from ? 'zoom-in' : viewParent(w, from) === to ? 'zoom-out' : 'walk';
}

/**
 * THE exit-rooms rule (GM4g carry 1): a view's parent first, then the rooms R's exits lead to, in hotspot order;
 * distinct; a locked exit included; a story exit, R itself and a room of another section not (on a built world every
 * exit to a room is same-section: `world/cross-section-exit`).
 */
export function nearRooms(w: KernelWorld, room: RoomId): RoomId[] {
  const ix = worldIndex(w);
  const entry = ix.rooms.get(room);
  if (entry === undefined) {
    return [];
  }
  const out: RoomId[] = [];
  const add = (r: RoomId | null): void => {
    if (r !== null && r !== room && !out.includes(r) && ix.rooms.get(r)?.section === entry.section) {
      out.push(r);
    }
  };
  add(viewParent(w, room));
  for (const h of entry.room.hotspots) {
    add(h.kind === 'exit' && 'room' in h.to ? h.to.room : null);
  }
  return out;
}

/** `leave-view` in a view of a current section with no event knot pending; nothing elsewhere. */
export function viewActions(w: KernelWorld, s: WorldState): readonly ViewAction[] {
  return s.section !== null && s.room !== null && s.pendingStory.length === 0 && viewParent(w, s.room) !== null ? LEAVE : [];
}

/** `leave-view`: core's `arrive` at the parent, a zoom-out from the view by no exit; guarded as `viewActions` offers it. */
export function applyView(w: KernelWorld, _a: ViewAction, out: KernelWriter<'view', never>): void {
  const s = out.state;
  const room = s.room;
  const of = room === null ? null : viewParent(w, room);
  if (s.section === null || room === null || of === null || s.pendingStory.length > 0) {
    return;
  }
  arrive(out, of, { sfx: null, from: room, via: null, how: 'zoom-out' }, { verb: 'leave-view', at: null, item: null, via: null });
}

/** None: `room` is already a part of every section key (search.ts), and no rule of the module reads a fact. */
export function viewReads(): readonly FactAtom[] {
  return [];
}
