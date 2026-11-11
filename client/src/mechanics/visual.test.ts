// Module `visual` (engine plan §6.4): a prop's picture follows its state. The state is the first `is` whose `when`
// holds, else `default`; a patch keeps the default image as its base; decor draws in `z` order after the hotspots at 0;
// a visual condition reads any section; the data round-trips; the story gate refuses a picture the catalog lacks; and
// `roomImages` lists every image a room can show (an oracle written out by hand, independent of `emit.ts`). Fixture
// worlds are written in the source format and decoded with the real registries; a proof world carries the decoded
// `mods`, as the explore controller's and the story gate's do.
import { expect, test } from 'vitest';

import { VISUAL_LINT } from '../../scripts/story/mechanics/visual.ts';
import type { WorldLintInput } from '../../scripts/story/mechanics/index.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { AssetCatalog } from '../story/catalog.ts';
import type { ChapterId, PropId, SectionId } from '../story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toPublic } from '../world/decode.ts';
import type { WorldIssue } from '../world/decode.ts';
import type { HotspotKey, ItemId, RoomId, WorldSource } from '../world/types.ts';
import type { KernelWorld, PropView } from './contract.ts';
import { MECHANIC_DATA } from './data/index.ts';
import { roomImages, visualsOf } from './rules/visual.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture worlds, in the source format

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (owner = 'w'): Json => ({ id: `ch1.${owner}.${(lineCounter++).toString(36).padStart(4, '0')}`, ru: owner });
const RECT = [100, 200, 200, 200];
const PATCH_RECT = [140, 240, 60, 60];
const exit = (id: string, to: string | { story: string }): Json => ({
  id,
  kind: 'exit',
  rect: RECT,
  label: txt(),
  to: typeof to === 'string' ? { room: to } : to,
  lock: null,
  sfx: null,
});
const take = (id: string, prop: string | null, extra: Json = {}): Json => ({ id, kind: 'take', rect: RECT, label: txt(), gives: { item: id }, prop, ...extra });
const object = (id: string, prop: string | null, extra: Json = {}): Json => ({ id, kind: 'object', rect: RECT, label: txt(), lock: null, then: [], look: null, prop, ...extra });
const look = (id: string, extra: Json = {}): Json => ({ id, kind: 'look', rect: RECT, label: txt(), look: txt(id), then: [], ...extra });
const room = (hotspots: readonly Json[], extra: Json = {}): Json => ({ bg: 'room', title: txt(), onEnter: [], hotspots, ...extra });

/** The source world of `sections` (each `[start, rooms]`), with an item per id of `items`. */
function rawWorld(sections: Readonly<Record<string, readonly [string, Readonly<Record<string, Json>>]>>, items: readonly string[] = []): Json {
  return {
    format: 1,
    items: Object.fromEntries(items.map((id) => [id, { name: txt(id), desc: txt(id), glyph: 'key' }])),
    docs: {},
    puzzles: {},
    sections: Object.fromEntries(Object.entries(sections).map(([id, [start, rooms]]) => [id, { start, bgm: null, rooms }])),
  };
}

function source(raw: Json): WorldSource {
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** The proof world: the public body with the decoded `mods`. */
const kernel = (src: WorldSource): KernelWorld => ({ ...toPublic(src), mods: src.mods });

const S = 's' as SectionId;
const k = (s: string) => s as HotspotKey;
const it = (s: string) => s as ItemId;
const rm = (s: string) => s as RoomId;

/** A state in `roomId` of section `s`. */
function at(roomId: string, extra: Partial<WorldState> = {}): WorldState {
  return { ...structuredClone(EMPTY_WORLD_STATE), section: S, room: rm(roomId), lastRoom: { [S]: rm(roomId) }, visited: [rm(roomId)], ...extra };
}

/** A view's anchor, state and pictures, in draw order. */
const shown = (views: readonly PropView[]): Array<[string, string, string | null, string | null, number]> =>
  views.map((v) => [v.at, v.state, v.prop, v.patch?.prop ?? null, v.z]);

/** The hall: a take, a box with three states over its `prop` (two picked by held items, one a patch), two decor. */
function hallWorld(): KernelWorld {
  return kernel(
    source(
      rawWorld(
        {
          s: [
            'hall',
            {
              hall: room(
                [
                  take('coin', 'coin'),
                  object('box', 'box', {
                    states: { open: { prop: 'box_open' }, lit: { prop: 'box_lit' }, cracked: { patch: 'crack', rect: PATCH_RECT }, gone: { prop: null } },
                    is: [
                      { when: { held: 'key' }, state: 'open' },
                      { when: { held: 'lamp' }, state: 'lit' },
                      { when: { held: 'hammer' }, state: 'cracked' },
                      { when: { used: 'key' }, state: 'gone' },
                    ],
                  }),
                  exit('out', { story: 'end' }),
                ],
                {
                  decor: [
                    { id: 'vase', prop: 'vase', rect: RECT, z: 2 },
                    { id: 'rug', prop: 'rug', rect: RECT, z: 1, states: { worn: { prop: 'rug_worn' } }, is: [{ when: { held: 'lamp' }, state: 'worn' }] },
                  ],
                },
              ),
            },
          ],
        },
        ['coin', 'key', 'lamp', 'hammer'],
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// §6.4: the state and the picture

test("visual: a prop's state follows its first matching is", () => {
  const w = hallWorld();
  // No `is` holds: every anchor shows its default, the hotspots at z 0 in hotspot order, then the decor by z.
  expect(shown(visualsOf(w, at('hall'), rm('hall')))).toEqual([
    ['hall.coin', 'default', 'coin', null, 0],
    ['hall.box', 'default', 'box', null, 0],
    ['hall~rug', 'default', 'rug', null, 1],
    ['hall~vase', 'default', 'vase', null, 2],
  ]);
  // Two `is` hold (key, lamp): the first wins; the rug's own `is` picks its state.
  expect(shown(visualsOf(w, at('hall', { held: [it('lamp'), it('key')] }), rm('hall')))).toEqual([
    ['hall.coin', 'default', 'coin', null, 0],
    ['hall.box', 'open', 'box_open', null, 0],
    ['hall~rug', 'worn', 'rug_worn', null, 1],
    ['hall~vase', 'default', 'vase', null, 2],
  ]);
  // A patch state keeps the default image as its base and draws the patch over it at its own rect.
  const cracked = visualsOf(w, at('hall', { held: [it('hammer')] }), rm('hall')).find((v) => v.at === 'hall.box');
  expect(cracked).toEqual({ at: 'hall.box', state: 'cracked', prop: 'box', patch: { prop: 'crack', rect: PATCH_RECT }, rect: RECT, z: 0 });
  // A state with no image draws nothing, but its anchor stays in the picture (a diff reads it).
  const gone = visualsOf(w, at('hall', { used: [it('key')] }), rm('hall')).find((v) => v.at === 'hall.box');
  expect([gone?.state, gone?.prop, gone?.patch]).toEqual(['gone', null, null]);
  // A taken take is absent (B-001 by construction).
  expect(shown(visualsOf(w, at('hall', { taken: [k('hall.coin')] }), rm('hall'))).map(([a]) => a)).toEqual(['hall.box', 'hall~rug', 'hall~vase']);
  // A room the world lacks has no picture.
  expect(visualsOf(w, at('hall'), rm('attic'))).toEqual([]);
});

test('visual: a visual condition may read another section', () => {
  // The hall's box opens with the yard's gate (section t): a visual condition reads any id of the chapter (§4 "Two
  // scopes"), so the story gate reports no cross-section fault, and the hook evaluates it.
  const raw = rawWorld({
    s: ['hall', { hall: room([object('box', 'box', { states: { open: { prop: 'box_open' } }, is: [{ when: { open: 'yard.gate' }, state: 'open' }] }), exit('out', { story: 'end' })]) }],
    t: ['yard', { yard: room([object('gate', null, { lock: { slots: [], puzzle: null, locked: txt(), onOpen: [], onFail: [] } }), exit('away', { story: 'end' })]) }],
  });
  const src = source(raw);
  const { findings } = lint(src, ['box', 'box_open']);
  expect(findings).toEqual([]);
  const w = kernel(src);
  expect(visualsOf(w, at('hall'), rm('hall'))[0]?.state).toBe('default');
  expect(visualsOf(w, at('hall', { open: [k('yard.gate')] }), rm('hall'))[0]?.state).toBe('open');
});

// ---------------------------------------------------------------------------------------------------------------
// The data half

test('visual: decode and encode round-trip', () => {
  const raw = rawWorld(
    {
      s: [
        'hall',
        {
          hall: room(
            [
              object('box', 'box', {
                states: { open: { prop: 'box_open' }, gone: { prop: null }, cracked: { patch: 'crack', rect: PATCH_RECT } },
                is: [
                  { when: { all: [{ held: 'key' }, { not: { open: 'hall.box' } }] }, state: 'open' },
                  { when: { held: 'hammer' }, state: 'cracked' },
                  { when: { used: 'key' }, state: 'default' },
                ],
              }),
              take('coin', null, { states: { shine: { prop: 'coin' } }, is: [{ when: { held: 'key' }, state: 'shine' }] }),
              exit('out', { story: 'end' }),
            ],
            {
              decor: [
                { id: 'vase', prop: 'vase', rect: RECT, z: 2 },
                { id: 'rug', prop: 'rug', rect: RECT, z: -1, states: { worn: { patch: 'tear', rect: PATCH_RECT } }, is: [{ when: { held: 'key' }, state: 'worn' }] },
              ],
            },
          ),
          cellar: room([exit('up', 'hall')], { decor: [] }),
        },
      ],
    },
    ['coin', 'key', 'hammer'],
  );
  const src = source(raw);
  const d = src.mods.visual;
  expect(Object.keys(d.hotspots)).toEqual(['hall.box', 'hall.coin']);
  expect(d.hotspots[k('hall.box')]?.states).toEqual({ open: { prop: 'box_open' }, gone: { prop: null }, cracked: { patch: 'crack', rect: PATCH_RECT } });
  expect(d.hotspots[k('hall.box')]?.is[2]).toEqual({ when: { used: 'key' }, state: 'default' });
  // A decor's `states` and `is` default to none; an empty `decor` is the default, so the cellar is absent.
  expect(d.decor[rm('hall')]).toEqual([
    { id: 'vase', prop: 'vase', rect: RECT, z: 2, states: {}, is: [] },
    { id: 'rug', prop: 'rug', rect: RECT, z: -1, states: { worn: { patch: 'tear', rect: PATCH_RECT } }, is: [{ when: { held: 'key' }, state: 'worn' }] },
  ]);
  expect(Object.keys(d.decor)).toEqual(['hall']);
  // The decoded data is plain JSON.
  expect(JSON.parse(JSON.stringify(d))).toStrictEqual(d);
  // Through the public body and back: the same data, the keys back in their places, the defaults left out.
  const pub = toPublic(src);
  const back = decodeWorldPublic({ ...pub, version: '0123456789abcdef' });
  expect(back.ok ? back.value.mods.visual : back.error).toEqual(d);
  const hall = JSON.parse(JSON.stringify(pub.sections[S]?.rooms[rm('hall')])) as Json; // the body's JSON, owned keys untyped there
  expect((hall['decor'] as Json[])[0]).toEqual({ id: 'vase', prop: 'vase', rect: RECT, z: 2 });
  expect(Object.hasOwn(JSON.parse(JSON.stringify(pub.sections[S]?.rooms[rm('cellar')])) as Json, 'decor')).toBe(false);
  // A world without `visual` keys encodes nothing, so its emitted body is the kernel's.
  const plain = source(rawWorld({ s: ['hall', { hall: room([exit('out', { story: 'end' })]) }] }));
  expect(MECHANIC_DATA[2].encode(plain.mods.visual)).toEqual([]);
  // Strict keys, each issue at its source path, in the decoder's walk order (a room's own keys before its hotspots'): a
  // decor without its `z`, a repeated decor id, an unknown key, a declared `default`, a state that is no picture, an
  // undeclared `is.state`.
  const bad = rawWorld({
    s: [
      'hall',
      {
        hall: room(
          [
            object('box', 'box', {
              states: { open: { prop: 'box_open', glow: 1 }, default: { prop: 'x' }, half: { rect: PATCH_RECT } },
              is: [{ when: { held: 'key' }, state: 'shut' }],
            }),
            exit('out', { story: 'end' }),
          ],
          { decor: [{ id: 'vase', prop: 'vase', rect: RECT }, { id: 'vase', prop: 'urn', rect: RECT, z: 1 }] },
        ),
      },
    ],
  });
  const issues = decodeWorldSource(bad);
  const box = 'sections.s.rooms.hall.hotspots.0';
  const decor = 'sections.s.rooms.hall.decor';
  expect(issues.ok ? [] : issues.error.map((e: WorldIssue) => [e.path, e.reason])).toEqual([
    [`${decor}.0.z`, 'shape'],
    [`${decor}.1.id`, 'id'],
    [`${box}.states.open.glow`, 'shape'],
    [`${box}.states.default`, 'id'],
    [`${box}.states.half`, 'shape'],
    [`${box}.is.0.state`, 'id'],
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// The story gate

/** The catalog of the story gate's input: the given props, nothing else. */
const catalogOf = (props: readonly string[]): AssetCatalog => ({
  bg: {},
  chars: {},
  cg: {},
  bgm: {},
  sfx: {},
  prop: Object.fromEntries(props.map((p) => [p, { placeholder: { hue: 0 } }])),
  cover: {},
});

/** `VISUAL_LINT` over `src`; each finding's line is the index of its path in `paths`, plus 1. */
function lint(src: WorldSource, props: readonly string[]): { findings: Array<[string, string]>; raw: readonly unknown[] } {
  const paths: string[] = [];
  const input: WorldLintInput = {
    chapter: { id: 'ch1' as ChapterId, paid: false, entry: 'ch1/main.ink' },
    file: 'story/ch1/world.json',
    text: '',
    world: src,
    catalog: catalogOf(props),
    knots: null,
    yielded: null,
    declared: new Map(),
    line: (path) => (paths.includes(path) ? paths.indexOf(path) : paths.push(path) - 1) + 1,
    moduleLines: new Map(),
  };
  if (!('lint' in VISUAL_LINT)) {
    throw new Error('invariant: VISUAL_LINT is a per-world pass');
  }
  const out = VISUAL_LINT.lint(input);
  return { findings: out.map((f) => [f.code, paths[f.line - 1] ?? '']), raw: out };
}

test('visual: the story gate refuses a state image the catalog lacks and an undeclared state', () => {
  const deep = { not: { not: { not: { not: { held: 'key' } } } } }; // five deep: over COND_MAX_DEPTH
  const src = source(
    rawWorld(
      {
        s: [
          'hall',
          {
            hall: room(
              [
                object('box', 'box', {
                  states: { open: { prop: 'box_open' }, ajar: { prop: 'nowhere' }, cracked: { patch: 'no_crack', rect: PATCH_RECT } },
                  is: [
                    { when: { held: 'key' }, state: 'open' },
                    { when: deep, state: 'ajar' },
                  ],
                }),
                look('sign', { states: { lit: { prop: 'box' } } }),
                exit('out', { story: 'end' }),
              ],
              { decor: [{ id: 'vase', prop: 'no_vase', rect: RECT, z: 1, states: { chipped: { patch: 'no_chip', rect: PATCH_RECT } } }] },
            ),
          },
        ],
      },
      ['key'],
    ),
  );
  const box = 'sections.s.rooms.hall.hotspots.0';
  const { findings, raw } = lint(src, ['box', 'box_open']);
  expect(findings).toEqual([
    ['world/unknown-asset', `${box}.states.ajar.prop`],
    ['world/unknown-asset', `${box}.states.cracked.patch`],
    ['world/schema', 'sections.s.rooms.hall.hotspots.1.states'],
    ['world/unknown-asset', 'sections.s.rooms.hall.decor.0.prop'],
    ['world/unknown-asset', 'sections.s.rooms.hall.decor.0.states.chipped.patch'],
    ['world/cond-size', `${box}.is.1.when`],
  ]);
  expect(raw.every((f) => (f as { severity: string }).severity === 'E')).toBe(true);
  // An `is` naming a state its hotspot does not declare is the decoder's refusal (`world/schema`, the story gate's code
  // for a decode issue of reason `id`), at the entry's `state`.
  const undeclared = decodeWorldSource(
    rawWorld({ s: ['hall', { hall: room([object('box', 'box', { states: { open: { prop: 'box_open' } }, is: [{ when: { held: 'key' }, state: 'shut' }] }), exit('out', { story: 'end' })]) }] }, ['key']),
  );
  expect(undeclared.ok ? [] : undeclared.error.map((e) => [e.path, e.reason])).toEqual([[`${box}.is.0.state`, 'id']]);
});

// ---------------------------------------------------------------------------------------------------------------
// The room's images (W2, RULINGS 246: an oracle independent of emit.ts)

test('visual: roomImages lists every image a room can show', () => {
  const src = source(
    rawWorld(
      {
        s: [
          'hall',
          {
            hall: room(
              [
                take('pick', 'p_take'),
                object('box', 'p_base', { states: { open: { prop: 'p_open' }, cracked: { patch: 'p_crack', rect: PATCH_RECT } }, is: [{ when: { held: 'key' }, state: 'open' }] }),
                object('lamp', null, { states: { lit: { prop: 'p_lit' } }, is: [{ when: { held: 'key' }, state: 'lit' }] }),
                object('twin', 'p_base'),
                exit('east', 'study'),
              ],
              {
                decor: [{ id: 'clock', prop: 'd_base', rect: RECT, z: 1, states: { on: { prop: 'd_on' }, chip: { patch: 'd_chip', rect: PATCH_RECT } }, is: [{ when: { held: 'key' }, state: 'on' }] }],
              },
            ),
            study: room([object('desk', 'q_other'), exit('west', 'hall')]),
          },
        ],
      },
      ['pick', 'key'],
    ),
  );
  const w = kernel(src);
  const expected = ['d_base', 'd_chip', 'd_on', 'p_base', 'p_crack', 'p_lit', 'p_open', 'p_take'] as PropId[];
  expect(roomImages(w, rm('hall'))).toEqual(expected);
  // Static over the world: the taken take's image stays listed (the set is the room's usage props, not its picture).
  expect(visualsOf(w, at('hall', { taken: [k('hall.pick')] }), rm('hall')).some((v) => v.prop === 'p_take')).toBe(false);
  expect(roomImages(w, rm('hall'))).toEqual(expected);
  expect(roomImages(w, rm('study'))).toEqual(['q_other']);
  expect(roomImages(w, rm('attic'))).toEqual([]);
});
