import { expect, test } from 'vitest';

import { RESUME_STATE_CAP } from '../../src/explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../../src/explore/state.ts';
import type { KernelWorld } from '../../src/mechanics/contract.ts';
import { reduce } from '../../src/mechanics/rules/core.ts';
import { admitEvent, admitSection, inSectionReach, ownScope, resetSection, searchSection, sectionEntry, sectionKey, successors } from '../../src/mechanics/rules/search.ts';
import type { ChapterId, SectionId } from '../../src/story/staging.ts';
import { decodeWorldSource, toPublic } from '../../src/world/decode.ts';
import type { ItemId, RoomId, WorldPublicBody } from '../../src/world/types.ts';
import type { PlayInput } from './playthrough.ts';
import { checkSection, checkWorld } from './softlock.ts';
import type { SectionCheck } from './softlock.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture worlds, written in the source format and decoded (the same builder shape as src/explore/explore.test.ts).

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (owner = 'w'): Json => ({ id: `ch1.${owner}.${(lineCounter++).toString(36).padStart(4, '0')}`, ru: owner });
const RECT = [100, 200, 200, 200];
const exit = (id: string, to: string | { story: string }, lock: Json | null = null): Json => ({
  id,
  kind: 'exit',
  rect: RECT,
  label: txt(),
  to: typeof to === 'string' ? { room: to } : to,
  lock,
  sfx: null,
});
const take = (id: string, gives: { item: string } | { doc: string }): Json => ({ id, kind: 'take', rect: RECT, label: txt(), gives, prop: null });
const lock = (accepts: string[], puzzle: string | null = null, onFail: Json[] = []): Json => ({
  slots: accepts.map((a) => ({ accepts: a })),
  puzzle,
  locked: txt(),
  onFail,
});
const room = (hotspots: Json[], onEnter: Json[] = []): Json => ({ bg: 'room', title: txt(), onEnter, hotspots });
const order = (pieces: string[], maxAttempts: number | null): Json => ({
  type: 'order',
  title: txt(),
  prompt: txt(),
  closeup: null,
  params: { pieces },
  maxAttempts,
  giveUp: false,
  solution: pieces.map((_, i) => (i + 1) % pieces.length),
  hints: [],
});
const code = (dials: number, maxAttempts: number | null): Json => ({
  type: 'code',
  title: txt(),
  prompt: txt(),
  closeup: null,
  params: { dials },
  maxAttempts,
  giveUp: false,
  solution: new Array<number>(dials).fill(1),
  hints: [txt()],
});

/** A fixture world; `marks`: items marked `carry: true`; `inherits`: the world's `inherits` entries, if any (§6.6). */
function world(spec: {
  items?: string[];
  marks?: string[];
  inherits?: Json[];
  docs?: string[];
  puzzles?: Record<string, Json>;
  sections: Record<string, { start: string; rooms: Record<string, Json> }>;
}): KernelWorld {
  const named = (ids: string[], body: (id: string) => Json) => Object.fromEntries(ids.map((id) => [id, body(id)]));
  const r = decodeWorldSource({
    format: 1,
    items: named(spec.items ?? [], (id) => ({ name: txt(), desc: txt(), glyph: 'key', ...(spec.marks?.includes(id) === true ? { carry: true } : {}) })),
    docs: named(spec.docs ?? [], () => ({ title: txt(), body: [txt()] })),
    puzzles: spec.puzzles ?? {},
    sections: Object.fromEntries(Object.entries(spec.sections).map(([id, s]) => [id, { start: s.start, bgm: null, rooms: s.rooms }])),
    ...(spec.inherits === undefined ? {} : { inherits: spec.inherits }),
  });
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods };
}

const sec = (s: string) => s as SectionId; // fixture section ids, as decoded
const FILE = 'story/ch1/world.json';
const S = sec('s');
const codes = (c: SectionCheck): string[] => c.findings.map((f) => f.code);

/**
 * The round-2 triage's hub: a hall with an exit to each of `rooms` rooms, `items` take items spread over them and
 * `docs` take documents; one puzzle-less gate with a slot per item is the only `leave`. Its section states are the
 * product of the room and every gift's state: (rooms + 1) × 3^items × 2^docs. `inherits`: the world's inherited items
 * (§6.6), declared beside its own and read by nothing.
 */
function hub(rooms: number, items: number, docs: number, inherits: readonly Json[] = []): KernelWorld {
  const itemIds = Array.from({ length: items }, (_, i) => `i${i}`);
  const docIds = Array.from({ length: docs }, (_, i) => `d${i}`);
  const spec: Record<string, Json> = {};
  const hall: Json[] = [exit('gate', { story: 'out' }, lock(itemIds))];
  for (let r = 0; r < rooms; r++) {
    hall.push(exit(`to_r${r}`, `r${r}`));
    const spots: Json[] = [exit('back', 'hall')];
    itemIds.forEach((id, i) => {
      if (i % rooms === r) {
        spots.push(take(`t_${id}`, { item: id }));
      }
    });
    docIds.forEach((id, i) => {
      if (i % rooms === r) {
        spots.push(take(`t_${id}`, { doc: id }));
      }
    });
    spec[`r${r}`] = room(spots);
  }
  spec['hall'] = room(hall);
  const carried = inherits.length === 0 ? {} : { inherits: [...inherits] };
  return world({ items: [...itemIds, ...inherits.map((e) => String(e['id']))], docs: docIds, sections: { s: { start: 'hall', rooms: spec } }, ...carried });
}

const MEDALS = ['medal_sun', 'medal_moon', 'medal_star'];

/** The demo section of PUZZLES-PLAN "Demo content outline". */
function manor(): KernelWorld {
  return world({
    items: MEDALS,
    docs: ['letter', 'diary'],
    puzzles: { drawer: code(4, null), gate: order(MEDALS, 3) },
    sections: {
      manor: {
        start: 'hall',
        rooms: {
          hall: room([
            exit('to_study', 'study'),
            exit('to_cellar', 'cellar'),
            exit('gate', { story: 'manor_out' }, lock(MEDALS, 'gate', [{ story: 'manor_gate_forced' }, { unlock: 'hall.gate' }])),
          ]),
          study: room([
            take('medal', { item: 'medal_sun' }),
            { id: 'drawer', kind: 'object', rect: RECT, label: txt(), lock: lock([], 'drawer'), then: [{ give: 'medal_moon' }], look: null, prop: null },
            take('letter', { doc: 'letter' }),
            exit('to_hall', 'hall'),
          ]),
          cellar: room([take('star', { item: 'medal_star' }), take('diary', { doc: 'diary' }), exit('to_hall', 'hall')], [{ story: 'manor_cellar_voice' }]),
        },
      },
    },
  });
}

/** A foyer and a hall whose only way out is a one-try puzzle gate; failing it runs a story and unlocks nothing. */
function failBranch(unlockOnFail: boolean): KernelWorld {
  const onFail = unlockOnFail ? [{ story: 'forced' }, { unlock: 'hall.gate' }] : [{ story: 'forced' }];
  return world({
    puzzles: { gate: code(3, 1) },
    sections: {
      s: {
        start: 'foyer',
        rooms: {
          foyer: room([exit('to_hall', 'hall')]),
          hall: room([exit('gate', { story: 'out' }, lock([], 'gate', onFail)), exit('to_foyer', 'foyer')]),
        },
      },
    },
  });
}

test('softlock: lock needing an unreachable item fails', () => {
  const w = world({
    items: ['gem', 'coin'],
    sections: { s: { start: 'hall', rooms: { hall: room([exit('gate', { story: 'out' }, lock(['gem'])), take('coin', { item: 'coin' })]) } } },
  });
  const c = checkSection(w, S, FILE);
  expect(codes(c)).toContain('world/softlock');
  expect(c.findings[0]).toMatchObject({ code: 'world/softlock', severity: 'E', file: FILE, line: 0 });
  // The control: the same gate with the gem in the room.
  const fixed = world({
    items: ['gem'],
    sections: { s: { start: 'hall', rooms: { hall: room([exit('gate', { story: 'out' }, lock(['gem'])), take('gem', { item: 'gem' })]) } } },
  });
  expect(checkSection(fixed, S, FILE).findings).toEqual([]);
});

test('softlock: fail branch without unlock fails', () => {
  expect(codes(checkSection(failBranch(false), S, FILE))).toEqual(['world/softlock']);
  // The control: the fail branch that also unlocks the gate (the demo's onFail shape).
  expect(checkSection(failBranch(true), S, FILE).findings).toEqual([]);
});

test('softlock: solvable section passes', () => {
  const [manorCheck] = checkWorld(manor(), FILE);
  expect(manorCheck?.findings).toEqual([]);
  expect(manorCheck?.section).toBe('manor');
  expect(manorCheck?.states).toBeGreaterThan(100);
  expect(checkWorld(hub(2, 2, 1), FILE)).toEqual([{ section: 's', states: 3 * 9 * 2, findings: [] }]);
});

test('softlock: state cap is an error', () => {
  // 13 documents in one room: 2^13 = 8,192 states, every one of them with an open way out.
  const docs = Array.from({ length: 13 }, (_, i) => `d${i}`);
  const w = world({ docs, sections: { s: { start: 'hall', rooms: { hall: room([exit('out', { story: 'out' }), ...docs.map((d) => take(d, { doc: d }))]) } } } });
  const c = checkSection(w, S, FILE);
  expect(codes(c)).toEqual(['world/state-cap']);
  expect(c.findings[0]).toMatchObject({ severity: 'E', file: FILE, line: 0 });
  expect(c.findings[0]?.message).toContain(String(RESUME_STATE_CAP));
  expect(c.states).toBeNull();
});

test('softlock: counterexample path printed', () => {
  const [f] = checkSection(failBranch(false), S, FILE).findings;
  expect(f?.message).toContain('tap hall.gate');
  expect(f?.message).toBe('section s: a reachable state cannot reach a leave (stuck in hall): tap foyer.to_hall → tap hall.gate → gate failed');
  const [entry] = checkSection(world({ items: ['gem'], sections: { s: { start: 'hall', rooms: { hall: room([exit('gate', { story: 'out' }, lock(['gem']))]) } } } }), S, FILE).findings;
  expect(entry?.message).toContain('(the section entry itself)');
});

test('softlock: section above RESUME_STATE_CAP fails the build', () => {
  // The triage hub: 6 × 3^8 = 39,366 states, above RESUME_STATE_CAP and below the old 200,000 cap, and solvable.
  const c = checkSection(hub(5, 8, 0), S, FILE);
  expect(codes(c)).toEqual(['world/state-cap']);
});

test('softlock: section just under RESUME_STATE_CAP passes', () => {
  // 5 × 3^5 × 2^2 = 4,860 states, the exact count the kernel's cap compare is pinned against.
  const w = hub(4, 5, 2);
  const N = 4_860;
  const c = checkSection(w, S, FILE);
  expect(c).toEqual({ section: 's', states: N, findings: [] });
  const start = sectionEntry(w, EMPTY_WORLD_STATE, S);
  expect(searchSection(w, start, S, N)).toEqual({ result: 'exhausted', states: N });
  expect(searchSection(w, start, S, N - 1)).toEqual({ result: 'cap', states: N - 1 });

  // Seen working (X9 cost): one full resume search of this section, which never meets its target.
  const nowhere = { ...EMPTY_WORLD_STATE, section: S, room: 'nowhere' as RoomId }; // a room no state has
  expect(inSectionReach(w, nowhere, S, RESUME_STATE_CAP)).toBe('no');
  const ms: number[] = [];
  let heap = 0;
  for (let i = 0; i < 5; i++) {
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    inSectionReach(w, nowhere, S, RESUME_STATE_CAP);
    ms.push(performance.now() - t0);
    heap = Math.max(heap, process.memoryUsage().heapUsed - before);
  }
  const median = [...ms].sort((a, b) => a - b)[2] ?? Number.NaN;
  console.log(
    `[timing] inSectionReach full enumeration: ${N} states, ${median.toFixed(1)} ms median of 5 after 1 warm-up, heap +${(heap / 2 ** 20).toFixed(1)} MiB`,
  );
}, 60_000);

test("softlock: a search, reset or proof call without the modules' data fails check", () => {
  const w: KernelWorld = hub(1, 1, 0);
  const body: WorldPublicBody = w; // the public body alone, as `toPublic` returns it (a widening, no cast)
  const s = sectionEntry(w, EMPTY_WORLD_STATE, S);
  const asInput = (_world: PlayInput['world']): void => undefined;
  // Type pins, never run (registry.test.ts's form): each call without the modules' data fails check beside its
  // positive control, so an unused directive is itself a red (TS2578).
  const pins = (): void => {
    // @ts-expect-error -- successors needs the kernel world
    successors(body, s);
    successors(w, s);
    // @ts-expect-error -- sectionKey needs the kernel world
    sectionKey(body, s, S);
    sectionKey(w, s, S);
    // @ts-expect-error -- ownScope needs the kernel world
    ownScope(body, S);
    ownScope(w, S);
    // @ts-expect-error -- resetSection needs the kernel world
    resetSection(body, s, S);
    resetSection(w, s, S);
    // @ts-expect-error -- sectionEntry needs the kernel world
    sectionEntry(body, s, S);
    sectionEntry(w, s, S);
    // @ts-expect-error -- searchSection needs the kernel world
    searchSection(body, s, S, RESUME_STATE_CAP);
    searchSection(w, s, S, RESUME_STATE_CAP);
    // @ts-expect-error -- inSectionReach needs the kernel world
    inSectionReach(body, s, S, RESUME_STATE_CAP);
    inSectionReach(w, s, S, RESUME_STATE_CAP);
    // @ts-expect-error -- admitSection needs the kernel world
    admitSection(body, s, S);
    admitSection(w, s, S);
    // @ts-expect-error -- admitEvent needs the kernel world
    admitEvent(body, s, S);
    admitEvent(w, s, S);
    // @ts-expect-error -- reduce needs the kernel world
    reduce(body, s, { kind: 'enter-section', section: S });
    reduce(w, s, { kind: 'enter-section', section: S });
    // @ts-expect-error -- a section's soft-lock proof needs the proof world
    checkSection(body, S, FILE);
    checkSection(w, S, FILE);
    // @ts-expect-error -- a world's soft-lock proof needs the proof world
    checkWorld(body, FILE);
    checkWorld(w, FILE);
    // @ts-expect-error -- a playthrough's world is the proof world
    asInput(body);
    asInput(w);
  };
  expect(pins).toBeTypeOf('function'); // a type check only: never run
  // The live control: the kernel world's proof runs, the hub's (1 + 1) x 3^1 states.
  expect(checkWorld(w, FILE)).toEqual([{ section: 's', states: 6, findings: [] }]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM9p: the carry proof's section checks (engine plan §6.6).

const LAMP_TO_CH2: ReadonlyMap<ItemId, ChapterId> = new Map([['lamp' as ItemId, 'ch2' as ChapterId]]); // fixture ids

test('carry: a section leave without the item is refused', () => {
  const keep: Json = { slots: [{ accepts: 'lamp', keep: true }], puzzle: null, locked: txt(), onFail: [] };
  /** The hall gives the lamp and its way out keeps it in `slot`; `back`: the cellar has a second, open way out. */
  const giver = (back: boolean, slot: Json = keep): KernelWorld =>
    world({
      items: ['lamp'],
      marks: ['lamp'],
      sections: {
        s: {
          start: 'hall',
          rooms: {
            hall: room([take('t_lamp', { item: 'lamp' }), exit('out', { story: 'out' }, slot), exit('to_cellar', 'cellar')]),
            cellar: room([exit('to_hall', 'hall'), ...(back ? [exit('back', { story: 'back' })] : [])]),
          },
        },
      },
    });
  // The control: every leave holds the lamp.
  expect(checkSection(giver(false), S, FILE, LAMP_TO_CH2)).toEqual({ section: 's', states: expect.any(Number) as number, findings: [] });
  // The cellar's open way out: one finding, its path ending in the leave.
  expect(checkSection(giver(true), S, FILE, LAMP_TO_CH2).findings).toEqual([
    {
      code: 'world/carry-leave',
      severity: 'E',
      file: FILE,
      line: 0,
      message: "section s: a leave without 'lamp', which ch2 inherits as required (§6.6): tap hall.to_cellar → tap cellar.back",
    },
  ]);
  // Without the required items (the per-world run) no leave is checked.
  expect(checkSection(giver(true), S, FILE).findings).toEqual([]);
  // A way out whose slot consumes the lamp: the leave holds it no more (it is `used`, not `held`).
  const spent = checkSection(giver(false, lock(['lamp'])), S, FILE, LAMP_TO_CH2).findings;
  expect(spent.map((f) => f.code)).toEqual(['world/carry-leave']);
  expect(spent[0]?.message).toMatch(/: tap hall\.t_lamp → insert hall\.out lamp → tap hall\.out$/);
});

/** `id` inherited, required or optional (§6.6). */
const inherit = (id: string, required: boolean): Json => ({ id, required });

test('softlock: optional carried items prove 2^k starts', () => {
  /** A hall whose `spots` are all there is; `items` declared, `inherits` inherited. */
  const hall = (spots: Json[], inherits: Json[], items = ['a', 'b']): KernelWorld => world({ items, inherits, sections: { s: { start: 'hall', rooms: { hall: room(spots) } } } });
  const outOn = (id: string, item: string): Json => exit(id, { story: 'out' }, lock([item]));
  // A required inherited item the only leave needs: held in the one start (two states: held, then in the slot), so
  // clean.
  expect(checkSection(hall([outOn('out', 'a')], [inherit('a', true)]), S, FILE)).toEqual({ section: 's', states: 2, findings: [] });
  // k = 1, the same leave: the start without it is stuck at the entry.
  expect(checkSection(hall([outOn('out', 'a')], [inherit('a', false)]), S, FILE).findings.map((f) => f.message)).toEqual([
    'section s (start: no a): a reachable state cannot reach a leave (stuck in hall): (the section entry itself)',
  ]);
  // k = 1, consumed in this chapter by a slot without `keep`: its start without it is a start like any other. Clean.
  const box: Json = { id: 'box', kind: 'object', rect: RECT, label: txt(), lock: lock(['a']), then: [], look: null, prop: null };
  expect(checkSection(hall([exit('out', { story: 'out' }), box], [inherit('a', false)]), S, FILE).findings).toEqual([]);
  // k = 2, a leave needing a and one needing b: stuck only when both are absent, the first start.
  const two = [inherit('a', false), inherit('b', false)];
  expect(checkSection(hall([outOn('out_a', 'a'), outOn('out_b', 'b')], two), S, FILE).findings.map((f) => f.message)).toEqual([
    'section s (start: no a, no b): a reachable state cannot reach a leave (stuck in hall): (the section entry itself)',
  ]);
  // k = 2, stuck only in a mixed start: b opens a one-way door to a cell whose only leave needs a.
  const mixed = world({
    items: ['a', 'b'],
    inherits: two,
    sections: { s: { start: 'hall', rooms: { hall: room([exit('out', { story: 'out' }), exit('door', 'cell', lock(['b']))]), cell: room([outOn('cell_out', 'a')]) } } },
  });
  expect(checkSection(mixed, S, FILE).findings.map((f) => f.message)).toEqual([
    'section s (start: no a, b): a reachable state cannot reach a leave (stuck in cell): insert hall.door b → tap hall.door',
  ]);
  // A required item beside an optional one: the required one is held in both starts, the one with b too. The only
  // leave needs a: clean.
  const both = [inherit('a', true), inherit('b', false)];
  expect(checkSection(hall([outOn('out', 'a')], both), S, FILE).findings).toEqual([]);
  // The same two, stuck only where both are held: b opens a one-way door to a passage whose door a opens into a cell
  // whose only leave needs the b the first door took. In the start without b that door never opens.
  const deep = world({
    items: ['a', 'b'],
    inherits: both,
    sections: {
      s: {
        start: 'hall',
        rooms: {
          hall: room([exit('out', { story: 'out' }), exit('door1', 'mid', lock(['b']))]),
          mid: room([exit('back', 'hall'), exit('door2', 'cell', lock(['a']))]),
          cell: room([outOn('cell_out', 'b')]),
        },
      },
    },
  });
  expect(checkSection(deep, S, FILE).findings.map((f) => f.message)).toEqual([
    'section s (start: b): a reachable state cannot reach a leave (stuck in cell): insert hall.door1 b → tap hall.door1 → insert mid.door2 a → tap mid.door2',
  ]);
});

/** A hall with an open way out and, per item of `ids`, a door it unlocks into a room holding a document; `inherits`
 *  inherited. Each held item opens more of the section, so the starts' counts differ. */
function doors(ids: readonly string[], inherits: Json[]): KernelWorld {
  const rooms: Record<string, Json> = { hall: room([exit('out', { story: 'out' }), ...ids.map((id) => exit(`to_${id}`, `room_${id}`, lock([id])))]) };
  for (const id of ids) {
    rooms[`room_${id}`] = room([exit('back', 'hall'), take(`t_d${id}`, { doc: `d${id}` })]);
  }
  return world({ items: [...ids], docs: ids.map((id) => `d${id}`), inherits, sections: { s: { start: 'hall', rooms } } });
}

test('softlock: the state count sums the starts', () => {
  /** The count of the start holding `held`: the same world with those inherited as required and the rest not inherited. */
  const startCount = (ids: readonly string[], held: readonly string[]): number | null => checkSection(doors(ids, held.map((id) => inherit(id, true))), S, FILE).states;
  // k = 1: two starts of different counts, summed.
  const absent = startCount(['a'], []);
  const present = startCount(['a'], ['a']);
  expect(absent).not.toBe(present);
  expect(checkSection(doors(['a'], [inherit('a', false)]), S, FILE)).toEqual({ section: 's', states: (absent ?? 0) + (present ?? 0), findings: [] });
  // k = 3: the sum over the 8 starts.
  const ids = ['a', 'b', 'c'];
  const counts = Array.from({ length: 8 }, (_, mask) => startCount(ids, ids.filter((_, b) => ((mask >> b) & 1) === 1)) ?? 0);
  expect(new Set(counts).size).toBeGreaterThan(1);
  const all = checkSection(doors(ids, ids.map((id) => inherit(id, false))), S, FILE);
  expect(all).toEqual({ section: 's', states: counts.reduce((n, c) => n + c, 0), findings: [] });
});

test('softlock: a capped start caps the section', () => {
  // The hub's rooms behind a porch whose door the key opens: without the key one state, with it 6 × 3^5 × 2^2 = 5,832.
  const hubRooms: Record<string, Json> = {};
  const items = ['i0', 'i1', 'i2', 'i3', 'i4'];
  const hallSpots: Json[] = [exit('to_porch', 'porch'), exit('gate', { story: 'out' }, lock(items))];
  for (let r = 0; r < 4; r++) {
    hallSpots.push(exit(`to_r${r}`, `r${r}`));
    const gifts = items.filter((_, i) => i % 4 === r).map((id) => take(`t_${id}`, { item: id }));
    const docs = r < 2 ? [take(`t_d${r}`, { doc: `d${r}` })] : [];
    hubRooms[`r${r}`] = room([exit('back', 'hall'), ...gifts, ...docs]);
  }
  const w = world({
    items: [...items, 'key'],
    docs: ['d0', 'd1'],
    inherits: [inherit('key', false)],
    sections: { s: { start: 'porch', rooms: { porch: room([exit('out', { story: 'out' }), exit('door', 'hall', lock(['key']))]), hall: room(hallSpots), ...hubRooms } } },
  });
  expect(checkSection(w, S, FILE)).toEqual({
    section: 's',
    states: null,
    findings: [
      {
        code: 'world/state-cap',
        severity: 'E',
        file: FILE,
        line: 0,
        message: `section s (start: key): more than ${RESUME_STATE_CAP} states (RESUME_STATE_CAP), too large to prove at resume (X9); split it into sections`,
      },
    ],
  });
});

test('softlock: each start keeps its own cap', () => {
  // RULINGS 403 B1: hub(4, 5, 2) with one optional inherited item nothing reads: two starts of 4,860 states each.
  const N = 4_860;
  const held = checkSection(hub(4, 5, 2, [inherit('x', true)]), S, FILE).states;
  const absent = checkSection(hub(4, 5, 2), S, FILE).states;
  expect([held, absent]).toEqual([N, N]);
  expect(N).toBeLessThan(RESUME_STATE_CAP);
  expect(2 * N).toBeGreaterThan(RESUME_STATE_CAP);
  // Each start under the cap, the sum above it: clean, counted, no `world/state-cap`.
  expect(checkSection(hub(4, 5, 2, [inherit('x', false)]), S, FILE)).toEqual({ section: 's', states: 2 * N, findings: [] });
}, 60_000);
