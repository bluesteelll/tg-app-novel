// LX: the explore controller (PUZZLES-PLAN X10, X12, X13, X16; the LX cut D2-D13 and its addendum) in node, over
// fixture worlds the decoder accepts. The stage host is two sizes and a fake ResizeObserver; the scene port is a log
// shared with the effects, so the order of holder calls against the effects is visible.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ROOM_SOURCE, cover, minTarget, toStage } from '../geom/cover.ts';
import type { Size } from '../geom/cover.ts';
import type { AssetManifest } from '../story/catalog.ts';
import type { AssetId, ChapterId, SectionId } from '../story/staging.ts';
import type { ExploreViewStore } from '../ui/explore-view.svelte.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, WorldPublic, WorldText } from '../world/types.ts';
import { MIN_TARGET_PX, createExploreController } from './controller.ts';
import type { ExploreController } from './controller.ts';
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
const take = (id: string, gives: { item: string } | { doc: string }, then: Json[] = []): Json => ({
  id,
  kind: 'take',
  rect: RECT,
  label: txt(`take ${id}`),
  gives,
  prop: null,
  then,
});
const look = (id: string, rect: number[] = RECT): Json => ({ id, kind: 'look', rect, label: txt(`look ${id}`), look: txt(`seen ${id}`), then: [] });
const object = (id: string, lock: Json | null, then: Json[] = []): Json => ({
  id,
  kind: 'object',
  rect: RECT,
  label: txt(`object ${id}`),
  lock,
  then,
  look: null,
  prop: null,
});
const lock = (accepts: string[], puzzle: string | null = null): Json => ({
  slots: accepts.map((a) => ({ accepts: a })),
  puzzle,
  locked: txt('locked'),
  onOpen: [],
  onFail: [],
});
const room = (bg: string, hotspots: Json[], onEnter: Json[] = []): Json => ({ bg, title: txt(`room ${bg}`), onEnter, hotspots });

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
};

function harness(w: WorldPublic, size: Size = S390): Harness {
  const host = { clientWidth: size.w, clientHeight: size.h };
  const view = emptyView();
  const log: string[] = [];
  const effects: ExploreEffect[] = [];
  const froms: Array<AssetManifest | undefined> = [];
  const scene = {
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
    manifest: MANIFEST,
    scene,
    view,
    text: (t: WorldText) => t.ru,
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
  return { c, host, view, log, effects, froms, ro };
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

