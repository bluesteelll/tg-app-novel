// LX: the explore controller (PUZZLES-PLAN X10, X12, X13, X16; the LX cut D2-D13 and its addendum) in node, over
// fixture worlds the decoder accepts. The stage host is two sizes and a fake ResizeObserver; the scene port is a log
// shared with the effects, so the order of holder calls against the effects is visible.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ROOM_SOURCE, cover, minTarget, toStage } from '../geom/cover.ts';
import type { Size } from '../geom/cover.ts';
import { createAssetScheduler } from '../scene/preload.ts';
import { STEADY_CAP_BYTES, createAssetRegistry } from '../scene/registry.ts';
import type { AssetError, LoadImage } from '../scene/registry.ts';
import type { AssetEntry, AssetManifest, ImageEntry } from '../story/catalog.ts';
import type { AssetId, ChapterId, SectionId } from '../story/staging.ts';
import type { ExploreViewStore } from '../ui/explore-view.svelte.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, ItemId, RoomId, WorldPublic, WorldText } from '../world/types.ts';
import { MIN_TARGET_PX, REVEAL_MS, createExploreController } from './controller.ts';
import type { ExploreController, ExploreControllerDeps } from './controller.ts';
import type { ExploreAction, ExploreEffect } from './reduce.ts';
import { EMPTY_WORLD_STATE } from './state.ts';
import type { WorldState } from './state.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture worlds: written in the source format and decoded, then stamped with a version (explore.test.ts:87-101).

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (ru: string): Json => ({ id: `ch1.cx.${(lineCounter++).toString(36).padStart(4, '0')}`, ru });
const RECT = [100, 200, 200, 200];

const exit = (id: string, to: string | { story: string }, o: { lock?: Json | null; rect?: number[] } = {}): Json => ({
  id,
  kind: 'exit',
  rect: o.rect ?? RECT,
  label: txt(`exit ${id}`),
  to: typeof to === 'string' ? { room: to } : to,
  lock: o.lock ?? null,
  sfx: null,
});
const take = (id: string, gives: { item: string } | { doc: string }, then: Json[] = [], prop: string | null = null): Json => ({
  id,
  kind: 'take',
  rect: RECT,
  label: txt(`take ${id}`),
  gives,
  prop,
  then,
});
const look = (id: string, rect: number[] = RECT): Json => ({ id, kind: 'look', rect, label: txt(`look ${id}`), look: txt(`seen ${id}`), then: [] });
const object = (id: string, lock: Json | null, then: Json[] = [], prop: string | null = null): Json => ({
  id,
  kind: 'object',
  rect: RECT,
  label: txt(`object ${id}`),
  lock,
  then,
  look: null,
  prop,
});
const lock = (accepts: string[], puzzle: string | null = null): Json => ({
  slots: accepts.map((a) => ({ accepts: a })),
  puzzle,
  locked: txt('locked'),
  onOpen: [],
  onFail: [],
});
const room = (bg: string, hotspots: Json[], onEnter: Json[] = []): Json => ({ bg, title: txt(`room ${bg}`), onEnter, hotspots });
const code = (closeup: string | null): Json => ({
  type: 'code',
  title: txt('code'),
  prompt: txt('prompt'),
  closeup,
  params: { dials: 4 },
  maxAttempts: null,
  giveUp: false,
  solution: [1, 1, 1, 1],
  hints: [txt('hint')],
});
const order = (pieces: string[]): Json => ({
  type: 'order',
  title: txt('order'),
  prompt: txt('prompt'),
  closeup: null,
  params: { pieces },
  maxAttempts: 3,
  giveUp: false,
  solution: pieces.map((_, i) => (i + 1) % pieces.length),
  hints: [txt('hint')],
});

type WorldSpec = {
  items?: Record<string, string>;
  docs?: string[];
  puzzles?: Record<string, Json>;
  sections: Record<string, { start: string; rooms: Record<string, Json> }>;
};

const V1 = '1111111111111111';
const V2 = '2222222222222222';

function world(spec: WorldSpec, version = V1): WorldPublic {
  const raw = {
    format: 1,
    items: Object.fromEntries(Object.entries(spec.items ?? {}).map(([id, glyph]) => [id, { name: txt(`name ${id}`), desc: txt(`desc ${id}`), glyph }])),
    docs: Object.fromEntries((spec.docs ?? []).map((id) => [id, { title: txt(`title ${id}`), body: [txt(`p1 ${id}`), txt(`p2 ${id}`)] }])),
    puzzles: spec.puzzles ?? {},
    sections: Object.fromEntries(Object.entries(spec.sections).map(([id, s]) => [id, { start: s.start, bgm: null, rooms: s.rooms }])),
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), version };
}

/** One room with a full-frame look and a 100 px look (the cover.test.ts numbers). */
function frame(): WorldPublic {
  return world({ sections: { frame: { start: 'box', rooms: { box: room('box', [look('big', [80, 160, 920, 1600]), look('small', [500, 900, 100, 100])]) } } } });
}

/** The LW2 round-3 world (explore.test.ts:795-815): a lever (v1) or the key's own `then` (v2) opens the vault. */
function house(version: 1 | 2, withYard = false): WorldPublic {
  return world(
    {
      items: { k: 'key' },
      sections: {
        house: {
          start: 'hall',
          rooms: {
            hall: room('hall', [
              exit('to_vault', 'vault', { lock: lock([]) }),
              exit('to_garden', { story: 'garden' }),
              ...(version === 1 ? [object('lever', null, [{ unlock: 'hall.to_vault' }])] : []),
              take('k', { item: 'k' }, version === 2 ? [{ unlock: 'hall.to_vault' }] : []),
            ]),
            vault: room('vault', [exit('to_hall', 'hall', { lock: version === 2 ? lock(['k']) : null })]),
          },
        },
        ...(withYard ? { yard: { start: 'yard', rooms: { yard: room('yard', [exit('out', { story: 'yard_out' })]) } } } : {}),
      },
    },
    version === 1 ? V1 : V2,
  );
}

const MEDALS = ['medal_sun', 'medal_moon', 'medal_star'];

/** The demo section (PUZZLES-PLAN "Demo content outline"): the cellar's onEnter runs an event knot. */
function manor(): WorldPublic {
  return world({
    items: { medal_sun: 'sun', medal_moon: 'moon', medal_star: 'star' },
    docs: ['letter', 'diary'],
    puzzles: { drawer: code('drawer'), gate: order(MEDALS) },
    sections: {
      manor: {
        start: 'hall',
        rooms: {
          hall: room('hall', [
            exit('to_study', 'study'),
            exit('to_cellar', 'cellar'),
            exit('gate', { story: 'manor_out' }, { lock: lock(MEDALS, 'gate') }),
            look('inscription'),
          ]),
          study: room('study', [
            take('medal', { item: 'medal_sun' }, [], 'medal_sun'),
            object('drawer', lock([], 'drawer'), [{ give: 'medal_moon' }]),
            take('letter', { doc: 'letter' }, [], 'letter'),
            exit('to_hall', 'hall'),
          ]),
          cellar: room(
            'cellar',
            [take('star', { item: 'medal_star' }, [], 'star'), take('diary', { doc: 'diary' }), exit('to_hall', 'hall')],
            [{ story: 'manor_cellar_voice' }],
          ),
        },
      },
    },
  });
}

/** Four props per room (object hotspots, so none is ever taken): the X13 room of bg + 4 × 1 MiB. */
const props = (r: string): Json[] => [1, 2, 3, 4].map((n) => object(`${r}_p${n}`, null, [], `${r}_p${n}`));

/** Four rooms in a line, every exit pair symmetric; b and c list their forward exit first; c holds a close-up puzzle. */
function chain(): WorldPublic {
  return world({
    puzzles: { box: code('box') },
    sections: {
      line: {
        start: 'a',
        rooms: {
          a: room('a', [...props('a'), exit('to_b', 'b')]),
          b: room('b', [...props('b'), exit('to_c', 'c'), exit('to_a', 'a')]),
          c: room('c', [...props('c'), object('box', lock([], 'box')), exit('to_d', 'd'), exit('to_b', 'b')]),
          d: room('d', [...props('d'), exit('to_c', 'c')]),
        },
      },
    },
  });
}

/** wb -> wv is free, but wv's way back needs a rune nobody holds. */
function wing(): WorldPublic {
  return world({
    items: { rune: 'star' },
    sections: {
      wing: {
        start: 'wa',
        rooms: {
          wa: room('wa', [exit('to_wb', 'wb')]),
          wb: room('wb', [exit('to_wa', 'wa'), exit('to_wv', 'wv')]),
          wv: room('wv', [exit('to_wb', 'wb', { lock: lock(['rune']) })]),
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The harness

const S390: Size = { w: 390, h: 844 };
const k = (s: string) => s as HotspotKey;
const sec = (s: string) => s as SectionId;
const tap = (hotspot: string): ExploreAction => ({ kind: 'tap', hotspot: k(hotspot) });
const enterAction = (section: string): ExploreAction => ({ kind: 'enter-section', section: sec(section) });
const MANIFEST: AssetManifest = { chapterId: 'ch1' as ChapterId, assets: {} };

/** The ResizeObserver the controller creates: records what it observes and fires on demand. */
class FakeRO {
  static last: FakeRO | null = null;
  readonly observed: unknown[] = [];
  disconnects = 0;
  readonly #cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.#cb = cb;
    FakeRO.last = this;
  }
  observe(target: unknown): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnects += 1;
  }
  fire(): void {
    this.#cb([], this as unknown as ResizeObserver); // the controller reads the host, never the entries
  }
}

beforeEach(() => {
  FakeRO.last = null;
  vi.stubGlobal('ResizeObserver', FakeRO);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function emptyView(): ExploreViewStore {
  return { layer: null, panel: null, hotspots: [], reveal: false, items: [], docs: [], lock: null };
}

type Harness = {
  c: ExploreController;
  host: { clientWidth: number; clientHeight: number };
  view: ExploreViewStore;
  /** Scene calls and effects, in the order they happened. */
  log: string[];
  effects: ExploreEffect[];
  froms: Array<AssetManifest | undefined>;
  ro: FakeRO;
  /** The UI language the `text` fake answers in: en lines are the ru text with an `en ` prefix. */
  lang: { en: boolean };
};

/** A controller over `w` on a 390×844 host; `o.scene` replaces the logging scene port (the real scheduler, C3). */
function harness(w: WorldPublic, o: { scene?: ExploreControllerDeps['scene']; manifest?: AssetManifest } = {}): Harness {
  const host = { clientWidth: S390.w, clientHeight: S390.h };
  const lang = { en: false };
  const view = emptyView();
  const log: string[] = [];
  const effects: ExploreEffect[] = [];
  const froms: Array<AssetManifest | undefined> = [];
  const logged: ExploreControllerDeps['scene'] = {
    preload(tag: string, ids: readonly AssetId[], from?: AssetManifest): void {
      log.push(`preload ${tag} ${ids.join(',')}`);
      froms.push(from);
    },
    releasePreload(tag: string): void {
      log.push(`release ${tag}`);
    },
  };
  const c = createExploreController({
    world: w,
    manifest: o.manifest ?? MANIFEST,
    scene: o.scene ?? logged,
    view,
    text: (t: WorldText) => (lang.en ? `en ${t.ru}` : t.ru),
    stageHost: host as unknown as HTMLElement, // the controller reads only the two sizes and observes the element
  });
  c.onEffect((e) => {
    effects.push(e);
    log.push(`effect ${e.kind}`);
  });
  const ro = FakeRO.last;
  if (ro === null) {
    throw new Error('expected the controller to create a ResizeObserver');
  }
  return { c, host, view, log, effects, froms, ro, lang };
}

function cssOf(h: Harness, key: string): { x: number; y: number; w: number; h: number } | undefined {
  return h.view.hotspots.find((v) => v.key === key)?.css;
}

// ---------------------------------------------------------------------------------------------------------------
// C1: hotspot views through the shared cover, the stage host, the admitted entry

test('controller: hotspot rect follows cover on resize', () => {
  const h = harness(frame());
  expect(h.ro.observed).toEqual([h.host]);
  h.c.enter(sec('frame'), EMPTY_WORLD_STATE);
  // 390×844: the cover.test.ts numbers.
  expect(cssOf(h, 'box.big')).toEqual({ x: 5.4296875, y: 65.9375, w: 379.140625, h: 659.375 });
  // The host turns landscape; the observer fires and the controller reads the host again.
  h.host.clientWidth = 844;
  h.host.clientHeight = 390;
  h.ro.fire();
  const wide = { w: 844, h: 390 };
  expect(cssOf(h, 'box.big')).toEqual(minTarget(toStage([80, 160, 920, 1600], cover(wide, ROOM_SOURCE)), MIN_TARGET_PX));
  // A direct resize does the same; a zero side shows no hotspot until a real size arrives.
  h.c.resize({ w: 600, h: 800 });
  expect(cssOf(h, 'box.big')).toEqual(minTarget(toStage([80, 160, 920, 1600], cover({ w: 600, h: 800 }, ROOM_SOURCE)), MIN_TARGET_PX));
  h.c.resize({ w: 0, h: 800 });
  expect(h.view.hotspots).toEqual([]);
  h.c.resize(S390);
  expect(h.view.hotspots.map((v) => [v.key, v.kind, v.label, v.done, v.locked])).toEqual([
    ['box.big', 'look', 'look big', false, false],
    ['box.small', 'look', 'look small', false, false],
  ]);
});

test('controller: small hotspot expanded to 44 px', () => {
  const h = harness(frame());
  h.c.enter(sec('frame'), EMPTY_WORLD_STATE);
  expect(MIN_TARGET_PX).toBe(44);
  // A 100 px source rect is 41.2 CSS px at 390×844: grown to 44 around its centre (cover.test.ts:44-45).
  expect(cssOf(h, 'box.small')).toEqual({ x: 177.12109375, y: 369.50390625, w: 44, h: 44 });
  // A large rect is unchanged by the minimum.
  expect(cssOf(h, 'box.big')).toEqual(toStage([80, 160, 920, 1600], cover(S390, ROOM_SOURCE)));
});

test('controller: enter admits an unproved section', () => {
  // Over v1: enter, pull the lever (the vault opens), leave through the garden story exit.
  const v1 = harness(house(1));
  v1.c.enter(sec('house'), EMPTY_WORLD_STATE);
  v1.c.dispatch(tap('hall.lever'));
  v1.c.dispatch(tap('hall.to_garden'));
  const s: WorldState = v1.c.state();
  expect(s.section).toBeNull();
  expect(s.open).toEqual(['hall.to_vault']);
  // A version change marked the section unproved; v2 cannot produce an open vault without the key.
  const h = harness(house(2));
  h.c.enter(sec('house'), { ...s, unproved: [sec('house')] });
  expect(h.effects[0]).toEqual({ kind: 'reset', section: 'house' });
  expect(h.effects[1]).toEqual({ kind: 'room', room: 'hall', sfx: null });
  expect(h.c.state().open).not.toContain('hall.to_vault');
  expect(h.c.state().unproved).toEqual([]);
  // The same yield arriving as an action takes the same route: the controller never reduces `enter-section` itself.
  const y = harness(house(2, true));
  y.c.enter(sec('yard'), { ...s, unproved: [sec('house')] });
  y.c.dispatch(tap('yard.out'));
  expect(y.c.state().section).toBeNull();
  const before = y.effects.length;
  y.c.dispatch(enterAction('house'));
  expect(y.effects.slice(before, before + 2)).toEqual([
    { kind: 'reset', section: 'house' },
    { kind: 'room', room: 'hall', sfx: null },
  ]);
  expect(y.c.state().open).not.toContain('hall.to_vault');
  expect(y.c.state().unproved).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// C2: the room path behind BackButton (X12)

/** The `room` effects after `from` in the effect list. */
const roomsAfter = (h: Harness, from: number): string[] => h.effects.slice(from).flatMap((e) => (e.kind === 'room' ? [e.room] : []));

test('controller: back walks the path, cycles truncate', () => {
  const h = harness(manor());
  h.c.enter(sec('manor'), EMPTY_WORLD_STATE);
  expect(h.c.back()).toBe(false);
  h.c.dispatch(tap('hall.to_study'));
  h.c.dispatch(tap('study.to_hall'));
  h.c.dispatch(tap('hall.to_cellar'));
  // The cellar's onEnter runs its event knot; the knot's last block yields back into the section.
  expect(h.effects.at(-2)).toEqual({ kind: 'story', knot: 'manor_cellar_voice' });
  // In the cellar of a current section with the knot pending, the rooms are suspended: a shown room requests nothing
  // (the addendum's phase B); once the knot returns, the same call requests the cellar's set.
  expect([h.c.state().section, h.c.state().room, h.c.state().pendingStory.length > 0]).toEqual(['manor', 'cellar', true]);
  const knot = h.log.length;
  h.c.roomShown();
  expect(h.log.slice(knot)).toEqual([]);
  h.c.enter(sec('manor'), h.c.state());
  expect(h.c.state().pendingStory).toEqual([]);
  const shown = h.log.length;
  h.c.roomShown();
  expect(h.log.slice(shown)).toEqual(['preload room:cellar bg/cellar', 'preload room:hall bg/hall']);
  // hall -> study -> hall truncated the cycle: the one way back from the cellar is the hall, and then nothing.
  const before = h.effects.length;
  expect(h.c.back()).toBe(true);
  expect(roomsAfter(h, before)).toEqual(['hall']);
  expect(h.c.state().room).toBe('hall');
  const after = h.effects.length;
  expect(h.c.back()).toBe(false);
  expect(h.effects.length).toBe(after);
});

test('controller: path state reported on change', () => {
  const h = harness(chain());
  h.c.enter(sec('line'), EMPTY_WORLD_STATE);
  const calls: boolean[] = [];
  const off = h.c.onPath((walkable) => calls.push(walkable));
  expect(calls).toEqual([false]);
  h.c.dispatch(tap('a.to_b'));
  expect(calls).toEqual([false, true]);
  // A second move keeps the path non-empty: no call; so does one step back.
  h.c.dispatch(tap('b.to_c'));
  expect(h.c.back()).toBe(true);
  expect(h.c.state().room).toBe('b');
  expect(calls).toEqual([false, true]);
  expect(h.c.back()).toBe(true);
  expect(h.c.state().room).toBe('a');
  expect(calls).toEqual([false, true, false]);
  off();
  h.c.dispatch(tap('a.to_b'));
  expect(calls).toEqual([false, true, false]);
});

test('controller: locked reverse exit clears the path', () => {
  const h = harness(wing());
  h.c.enter(sec('wing'), EMPTY_WORLD_STATE);
  const calls: boolean[] = [];
  h.c.onPath((walkable) => calls.push(walkable));
  h.c.dispatch(tap('wa.to_wb'));
  expect(calls).toEqual([false, true]);
  // wv's exit back to wb wants a rune that is not held: the way back is closed, so the path is cleared.
  h.c.dispatch(tap('wb.to_wv'));
  expect(h.c.state().room).toBe('wv');
  expect(calls).toEqual([false, true, false]);
  const before = h.effects.length;
  expect(h.c.back()).toBe(false);
  expect(h.effects.length).toBe(before);
});

// ---------------------------------------------------------------------------------------------------------------
// C3: the `room:<id>` holders (X13, the cut addendum): releases inside the call, requests once the room is shown

/** A deep copy of the empty state in `room` of `section`, with `extra` on top: a resume point. */
function at(roomId: string, section: string, extra: Partial<WorldState> = {}): WorldState {
  return {
    ...structuredClone(EMPTY_WORLD_STATE),
    section: sec(section),
    room: roomId as RoomId,
    lastRoom: { [section]: roomId as RoomId },
    visited: [roomId as RoomId],
    ...extra,
  };
}

const sceneCalls = (h: Harness, from = 0): string[] => h.log.slice(from).filter((l) => !l.startsWith('effect'));

test('controller: neighbours preloaded in exit order', () => {
  const h = harness(manor());
  h.c.enter(sec('manor'), EMPTY_WORLD_STATE);
  // The call requests nothing: the room batch is not applied yet, so the room's own bytes are not counted (W1).
  expect(sceneCalls(h)).toEqual([]);
  h.c.roomShown();
  // The room's own bg first (a join of the live entry), then the exits' rooms in hotspot order; no tag for the gate.
  expect(sceneCalls(h)).toEqual(['preload room:hall bg/hall', 'preload room:study bg/study', 'preload room:cellar bg/cellar']);
  expect(h.froms.every((f) => f === MANIFEST)).toBe(true);
  // The cellar is no neighbour of the study: released before the room effect goes out; nothing is requested yet.
  const move = h.log.length;
  h.c.dispatch(tap('hall.to_study'));
  expect(h.log.slice(move)).toEqual(['release room:cellar', 'effect room', 'effect dirty']);
  h.c.roomShown();
  expect(sceneCalls(h, move)).toEqual(['release room:cellar', 'preload room:study bg/study', 'preload room:hall bg/hall']);
  // Take the medal and walk back: every request is a background, never a prop (W2: X13 counts neighbours as bgs).
  h.c.dispatch(tap('study.medal'));
  h.c.dispatch(tap('study.to_hall'));
  h.c.roomShown();
  const preloads = h.log.filter((l) => l.startsWith('preload'));
  expect(preloads).toHaveLength(8);
  expect(preloads.filter((l) => !/^preload room:([a-z]+) bg\/\1$/.test(l))).toEqual([]);
  // The room walked into is never dropped (that would re-decode its 8.4 MiB bg).
  expect(h.log).not.toContain('release room:study');
  expect(h.log).not.toContain('release room:hall');
});

test('controller: puzzle open releases neighbour preloads', () => {
  const h = harness(manor());
  h.c.enter(sec('manor'), at('study', 'manor'));
  h.c.roomShown();
  // The drawer is a zero-slot lock whose puzzle has a close-up: every room:* goes before the puzzle effect.
  const open = h.log.length;
  h.c.dispatch(tap('study.drawer'));
  expect(h.log.slice(open)).toEqual(['release room:', 'effect puzzle']);
  // Once the close-up is cleared, GameSession reports the room shown again and the holders come back.
  h.c.roomShown();
  expect(sceneCalls(h, open)).toEqual(['release room:', 'preload room:study bg/study', 'preload room:hall bg/hall']);
  // The gate's puzzle has no close-up: its last insert opens it with no release.
  const g = harness(manor());
  g.c.enter(sec('manor'), at('hall', 'manor', { held: MEDALS.map((m) => m as ItemId) }));
  g.c.roomShown();
  const fill = g.log.length;
  for (const m of MEDALS) {
    g.c.dispatch({ kind: 'insert', hotspot: k('hall.gate'), item: m as ItemId });
  }
  expect(g.effects).toContainEqual({ kind: 'puzzle', puzzle: 'gate', hotspot: 'hall.gate' });
  expect(sceneCalls(g, fill)).toEqual([]);
});

test('controller: dispose releases room holders', () => {
  const h = harness(manor());
  h.c.enter(sec('manor'), EMPTY_WORLD_STATE);
  h.c.roomShown();
  const calls: boolean[] = [];
  h.c.onPath((walkable) => calls.push(walkable));
  const end = h.log.length;
  h.c.dispose();
  expect(h.log.slice(end)).toEqual(['release room:']);
  expect(h.ro.disconnects).toBe(1);
  expect(h.view.hotspots).toEqual([]);
  // Later calls touch nothing: no scene call, no effect, no path report; a second dispose adds nothing.
  h.c.dispatch(tap('hall.to_study'));
  h.c.enter(sec('manor'), EMPTY_WORLD_STATE);
  h.c.roomShown();
  expect(h.c.back()).toBe(false);
  h.c.dispose();
  expect(h.log.slice(end)).toEqual(['release room:']);
  expect(h.ro.disconnects).toBe(1);
  expect(calls).toEqual([false]);
  expect(h.view.hotspots).toEqual([]);
  expect(h.c.state().room).toBe('hall');
  // A listener that disposes ends the call: a listener after it never hears that effect, and no listener hears a
  // later one (with L15's listeners, a disposed chapter's room effect must not reach the scene).
  const d = harness(manor());
  d.c.enter(sec('manor'), EMPTY_WORLD_STATE);
  const late: string[] = [];
  d.c.onEffect((e) => {
    if (e.kind === 'room') {
      d.c.dispose();
    }
  });
  d.c.onEffect((e) => late.push(e.kind));
  const move = d.log.length;
  d.c.dispatch(tap('hall.to_study'));
  expect(late).toEqual([]);
  expect(d.log.slice(move)).toEqual(['effect room', 'release room:']);
  // Dispose empties every view the controller writes, not only the hotspots: a held medal, a read letter and an open
  // lock panel are all gone (the components read this store after the controller is gone).
  const p = harness(manor());
  p.c.enter(sec('manor'), at('study', 'manor'));
  p.c.dispatch(tap('study.medal'));
  p.c.dispatch(tap('study.letter'));
  p.c.dispatch(tap('study.to_hall'));
  p.c.dispatch(tap('hall.gate'));
  expect([p.view.items.map((i) => i.id), p.view.docs.map((d) => d.id), p.view.lock?.key]).toEqual([['medal_sun'], ['letter'], 'hall.gate']);
  p.c.dispose();
  expect([p.view.items, p.view.docs, p.view.lock]).toEqual([[], [], null]);
});

test('controller: leave releases room holders', () => {
  const h = harness(manor());
  h.c.enter(sec('manor'), at('study', 'manor', { open: [k('hall.gate')] }));
  const calls: boolean[] = [];
  h.c.onPath((walkable) => calls.push(walkable));
  h.c.dispatch(tap('study.to_hall'));
  h.c.roomShown();
  expect(calls).toEqual([false, true]);
  // The open gate is a story exit: the holders go before the leave, so none rides into the knot's working set.
  const out = h.log.length;
  h.c.dispatch(tap('hall.gate'));
  expect(h.log.slice(out)).toEqual(['release room:', 'effect leave', 'effect dirty']);
  expect(calls).toEqual([false, true, false]);
  // Outside the section a shown room requests nothing.
  h.c.roomShown();
  expect(h.log.slice(out + 3)).toEqual([]);
});

// The X13 room: a 1080×2048 bg (8.4375 MiB decoded) and four 512×512 props (1 MiB each).
const BG = { w: 1080, h: 2048 };
const PROP = { w: 512, h: 512 };
const BG_BYTES = BG.w * BG.h * 4;
const PROP_BYTES = PROP.w * PROP.h * 4;
const CHAIN_ROOMS = ['a', 'b', 'c', 'd'];

function image(id: string, size: { w: number; h: number }): ImageEntry {
  return {
    kind: 'image',
    w: size.w,
    h: size.h,
    decodedBytes: size.w * size.h * 4,
    avif: { url: `/assets/${id}.avif`, bytes: 1 },
    webp: { url: `/assets/${id}.webp`, bytes: 1 },
  };
}

function chainManifest(): AssetManifest {
  const assets: Record<string, AssetEntry> = { 'cg/box': image('cg/box', BG) };
  for (const r of CHAIN_ROOMS) {
    assets[`bg/${r}`] = image(`bg/${r}`, BG);
    for (const n of [1, 2, 3, 4]) {
      assets[`prop/${r}_p${n}`] = image(`prop/${r}_p${n}`, PROP);
    }
  }
  return { chapterId: 'ch1' as ChapterId, assets: assets as Record<AssetId, AssetEntry> }; // the ids above are AssetIds
}

/**
 * The scene's side of a room walk over the real scheduler and registry, with a loader that decodes at once. A room
 * batch is modelled as the scene runs it: `ensure` the room's assets, take its slot holders, drop the previous
 * room's, release `ensure` (scene/preload.ts ENSURE_HOLDER, scene/executor.ts slots).
 */
function realScene(m: AssetManifest) {
  const live = new Set<string>();
  const errors: AssetError[] = [];
  const entryOf = (id: string): ImageEntry => {
    const e = Object.hasOwn(m.assets, id) ? m.assets[id as AssetId] : undefined;
    if (e?.kind !== 'image') {
      throw new Error(`invariant: ${id} is an image of the fixture manifest`);
    }
    return e;
  };
  const load: LoadImage<string> = (ref) => {
    const id = ref.url.slice('/assets/'.length, -'.avif'.length);
    const e = entryOf(id);
    return Promise.resolve().then(() => {
      live.add(id);
      return { ok: true, value: { texture: id, w: e.w, h: e.h, release: () => live.delete(id) } };
    });
  };
  const registry = createAssetRegistry<string>({ load, variant: 'avif' });
  const scheduler = createAssetScheduler({ registry, onError: (e) => errors.push(e) });
  scheduler.setChapter(m);
  let slots = new Map<string, AssetId>();
  const take = async (next: Map<string, AssetId>): Promise<void> => {
    for (const [holder, id] of next) {
      await registry.acquire(id, holder, { entry: entryOf(id), priority: 'visible' });
    }
    for (const [holder, id] of slots) {
      if (next.get(holder) !== id) {
        registry.release(id, holder);
      }
    }
    slots = next;
  };
  return {
    scheduler,
    live,
    errors,
    bytes: () => registry.stats().bytes,
    /** The room batch of a chain room: its bg and its four props. */
    async show(room: string): Promise<void> {
      const next = new Map<string, AssetId>([['scene:bg', `bg/${room}` as AssetId]]);
      for (const n of [1, 2, 3, 4]) {
        next.set(`scene:prop:${room}_p${n}`, `prop/${room}_p${n}` as AssetId);
      }
      const r = await scheduler.ensure([...next.values()], new AbortController().signal);
      expect(r.ok).toBe(true);
      await take(next);
      registry.releaseHolder('ensure');
    },
    /** The puzzle's close-up in the cg slot, or the slot cleared. */
    async closeup(on: boolean): Promise<void> {
      const next = new Map(slots);
      if (on) {
        next.set('scene:cg', 'cg/box' as AssetId);
      } else {
        next.delete('scene:cg');
      }
      await take(next);
    },
  };
}

/** Lets every queued preload settle: the loader resolves on microtasks, so one macrotask drains them all. */
const drain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test('controller: neighbour preloads stay under the steady cap', async () => {
  const m = chainManifest();
  const sc = realScene(m);
  const h = harness(chain(), { scene: sc.scheduler, manifest: m });
  const steps: Array<{ step: string; live: string[]; bytes: number }> = [];
  const record = async (step: string): Promise<void> => {
    await drain();
    steps.push({ step, live: [...sc.live].filter((id) => !id.startsWith('prop/')).sort(), bytes: sc.bytes() });
  };
  /** GameSession's order (PZ F7 step 1): the room batch, then the controller hears the room is shown. */
  const shown = async (room: string): Promise<void> => {
    await sc.show(room);
    h.c.roomShown();
  };
  h.c.enter(sec('line'), EMPTY_WORLD_STATE);
  await shown('a');
  await record('enter a');
  h.c.dispatch(tap('a.to_b'));
  await shown('b');
  await record('a -> b');
  h.c.dispatch(tap('b.to_c'));
  await shown('c');
  await record('b -> c');
  // The box's close-up: every room:* is released before the puzzle effect, then the scene shows the close-up.
  h.c.dispatch(tap('c.box'));
  await sc.closeup(true);
  await record('close-up open');
  // Closed with no roomShown in between: b was not preloaded when the move starts (W1's case).
  await sc.closeup(false);
  h.c.dispatch(tap('c.to_b'));
  await shown('b');
  await record('c -> b');
  const room = BG_BYTES + 4 * PROP_BYTES;
  expect(steps).toEqual([
    { step: 'enter a', live: ['bg/a', 'bg/b'], bytes: room + BG_BYTES },
    { step: 'a -> b', live: ['bg/a', 'bg/b', 'bg/c'], bytes: room + 2 * BG_BYTES },
    { step: 'b -> c', live: ['bg/b', 'bg/c', 'bg/d'], bytes: room + 2 * BG_BYTES },
    { step: 'close-up open', live: ['bg/c', 'cg/box'], bytes: room + BG_BYTES },
    { step: 'c -> b', live: ['bg/a', 'bg/b', 'bg/c'], bytes: room + 2 * BG_BYTES },
  ]);
  // X13: 29.3 MiB with two neighbours, 20.9 MiB with a close-up open; never above the steady cap.
  expect(Math.max(...steps.map((s) => s.bytes))).toBeLessThanOrEqual(STEADY_CAP_BYTES);
  expect(sc.errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// C4: the "show spots" outline (X16, cut D12): one timer, owned here, never in a component

test('controller: reveal ends after 2 s', () => {
  vi.useFakeTimers();
  try {
    expect(REVEAL_MS).toBe(2000);
    const h = harness(frame());
    h.c.enter(sec('frame'), EMPTY_WORLD_STATE);
    h.c.reveal();
    expect(h.view.reveal).toBe(true);
    vi.advanceTimersByTime(1999);
    expect(h.view.reveal).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.view.reveal).toBe(false);
    // A second reveal restarts the 2 s instead of ending with the first.
    h.c.reveal();
    vi.advanceTimersByTime(1500);
    h.c.reveal();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1999);
    expect(h.view.reveal).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.view.reveal).toBe(false);
    // Disposed mid-reveal: no timer is left behind and the outline is off.
    h.c.reveal();
    h.c.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.view.reveal).toBe(false);
    h.c.reveal();
    expect([h.view.reveal, vi.getTimerCount()]).toEqual([false, 0]);
  } finally {
    vi.useRealTimers();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// C5: the inventory, document and lock views (X16, cut D11) and the language switch

test('controller: inventory and lock views follow the state', () => {
  const h = harness(manor());
  h.c.enter(sec('manor'), EMPTY_WORLD_STATE);
  expect([h.view.items, h.view.docs, h.view.lock]).toEqual([[], [], null]);
  h.c.dispatch(tap('hall.to_study'));
  h.c.dispatch(tap('study.medal'));
  // A taken take leaves the room's list in world order, as the reducer's actions do: no dead button over the prop.
  expect(h.view.hotspots.map((v) => v.key)).toEqual(['study.drawer', 'study.letter', 'study.to_hall']);
  h.c.dispatch(tap('study.letter'));
  expect(h.view.items).toEqual([{ id: 'medal_sun', name: 'name medal_sun', desc: 'desc medal_sun', glyph: 'sun' }]);
  expect(h.view.docs).toEqual([{ id: 'letter', title: 'title letter', body: ['p1 letter', 'p2 letter'] }]);
  // The gate: its slots are empty, so a tap opens the lock panel.
  h.c.dispatch(tap('study.to_hall'));
  h.c.dispatch(tap('hall.gate'));
  expect(h.effects.at(-1)).toEqual({ kind: 'lock', hotspot: 'hall.gate' });
  expect(h.view.lock).toEqual({ key: 'hall.gate', title: 'exit gate', locked: 'locked', slots: [null, null, null], refused: false });
  // An insert no slot takes (the moon medal is not held): "doesn't fit", the slots unchanged.
  h.c.dispatch({ kind: 'insert', hotspot: k('hall.gate'), item: 'medal_moon' as ItemId });
  expect(h.effects.at(-1)).toEqual({ kind: 'refused', reason: 'no-fit' });
  expect(h.view.lock?.refused).toBe(true);
  expect(h.view.lock?.slots).toEqual([null, null, null]);
  // The sun medal fills its slot and leaves the inventory; the refusal is over.
  h.c.dispatch({ kind: 'insert', hotspot: k('hall.gate'), item: 'medal_sun' as ItemId });
  expect(h.view.lock).toEqual({
    key: 'hall.gate',
    title: 'exit gate',
    locked: 'locked',
    slots: [{ id: 'medal_sun', name: 'name medal_sun', desc: 'desc medal_sun', glyph: 'sun' }, null, null],
    refused: false,
  });
  expect(h.view.items).toEqual([]);
  // A language switch recomputes every text the controller wrote, with no action.
  h.lang.en = true;
  const effects = h.effects.length;
  h.c.relabel();
  expect(h.effects.length).toBe(effects);
  expect(h.view.hotspots.map((v) => v.label)).toEqual(['en exit to_study', 'en exit to_cellar', 'en exit gate', 'en look inscription']);
  expect(h.view.docs).toEqual([{ id: 'letter', title: 'en title letter', body: ['en p1 letter', 'en p2 letter'] }]);
  expect([h.view.lock?.title, h.view.lock?.locked, h.view.lock?.slots[0]?.name]).toEqual(['en exit gate', 'en locked', 'en name medal_sun']);
  // A move leaves the lock behind: its panel closes.
  h.c.dispatch(tap('hall.to_study'));
  expect(h.view.lock).toBeNull();
});

