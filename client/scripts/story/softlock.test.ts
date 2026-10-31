import { expect, test } from 'vitest';

import { inSectionReach, searchSection, sectionEntry } from '../../src/explore/reconcile.ts';
import { RESUME_STATE_CAP } from '../../src/explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../../src/explore/state.ts';
import type { SectionId } from '../../src/story/staging.ts';
import { decodeWorldSource, toPublic } from '../../src/world/decode.ts';
import type { RoomId, WorldPublicBody } from '../../src/world/types.ts';
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

function world(spec: { items?: string[]; docs?: string[]; puzzles?: Record<string, Json>; sections: Record<string, { start: string; rooms: Record<string, Json> }> }): WorldPublicBody {
  const named = (ids: string[], body: () => Json) => Object.fromEntries(ids.map((id) => [id, body()]));
  const r = decodeWorldSource({
    format: 1,
    items: named(spec.items ?? [], () => ({ name: txt(), desc: txt(), glyph: 'key' })),
    docs: named(spec.docs ?? [], () => ({ title: txt(), body: [txt()] })),
    puzzles: spec.puzzles ?? {},
    sections: Object.fromEntries(Object.entries(spec.sections).map(([id, s]) => [id, { start: s.start, bgm: null, rooms: s.rooms }])),
  });
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return toPublic(r.value);
}

const sec = (s: string) => s as SectionId; // fixture section ids, as decoded
const FILE = 'story/ch1/world.json';
const S = sec('s');
const codes = (c: SectionCheck): string[] => c.findings.map((f) => f.code);

/**
 * The round-2 triage's hub: a hall with an exit to each of `rooms` rooms, `items` take items spread over them and
 * `docs` take documents; one puzzle-less gate with a slot per item is the only `leave`. Its section states are the
 * product of the room and every gift's state: (rooms + 1) × 3^items × 2^docs.
 */
function hub(rooms: number, items: number, docs: number): WorldPublicBody {
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
  return world({ items: itemIds, docs: docIds, sections: { s: { start: 'hall', rooms: spec } } });
}

const MEDALS = ['medal_sun', 'medal_moon', 'medal_star'];

/** The demo section of PUZZLES-PLAN "Demo content outline". */
function manor(): WorldPublicBody {
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
function failBranch(unlockOnFail: boolean): WorldPublicBody {
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
