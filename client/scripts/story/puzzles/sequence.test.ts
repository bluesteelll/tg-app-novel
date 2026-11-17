// The push devices' build halves (engine plan §7.1 "BUILD", §7.4; GM8b D1, D7, D11, D14): the `sequence` hint refusal
// and solution check, the `ritual` solution check and per-player domain size, the part rects the frame check reads, and
// the reach and clue passes on worlds that hold the real types.
import { expect, test } from 'vitest';

import { RITUAL_RULES } from '../../../src/puzzles/rules/ritual.ts';
import type { RitualParams } from '../../../src/puzzles/rules/ritual.ts';
import { SEQUENCE_RULES } from '../../../src/puzzles/rules/sequence.ts';
import type { SequenceParams } from '../../../src/puzzles/rules/sequence.ts';
import type { AssetCatalog } from '../../../src/story/catalog.ts';
import type { ChapterId, Rect } from '../../../src/story/staging.ts';
import { decodeWorldSource } from '../../../src/world/decode.ts';
import { clueFindings, reachFindings } from '../mechanics/clues.ts';
import type { WorldLintInput } from '../mechanics/index.ts';
import { lintWorld } from '../world.ts';
import { RITUAL_LINT, ritualDomainSize } from './ritual.ts';
import { SEQUENCE_LINT } from './sequence.ts';

/** Slot `i` of a 5-column grid of 150 px squares inside HOTSPOT_SAFE_FRAME and the device band, none overlapping (B4). */
const slot = (i: number): Rect => [80 + (i % 5) * 190, 760 + Math.floor(i / 5) * 200, 150, 150];
/** `n` part rects, slots 0..`n - 1`; slot `n` is the replay's. */
const rowRects = (n: number): Rect[] => Array.from({ length: n }, (_, i) => slot(i));
/** 3 parts, the order 0 2 1, the replay in slot 3. */
const SQ3: SequenceParams = { parts: 3, order: [0, 2, 1], rects: rowRects(3), replay: slot(3) };
/** 3 parts, 5 presses. */
const RT35: RitualParams = { parts: 3, length: 5, rects: rowRects(3) };

const ladder = (...tiers: ReadonlyArray<readonly [string, string]>): { ru: string; en: string }[] => tiers.map(([ru, en]) => ({ ru, en }));
const T1: readonly [string, string] = ['Колокола звонят по порядку.', 'The bells ring in turn.'];
const T2: readonly [string, string] = ['Первый — левый.', 'The left one is first.'];
const T3: readonly [string, string] = ['Слева, справа, середина.', 'Left, right, middle.'];

/** The message `renderHints` throws for `hints`, or null when it renders them. */
function refusal(hints: readonly { ru: string; en: string }[]): string | null {
  try {
    SEQUENCE_LINT.renderHints(SQ3, hints);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

test('story: sequence hints are refused', () => {
  // c6 (D1): the device shows its order (a demonstration), so it sells no hint: any ladder is a build error that quotes
  // its first tier, a one-tier ladder and a longer one alike.
  expect(refusal(ladder(T1))).toBe(`sequence hints: tier 1 of 1 (ru) is sold, but a sequence device shows its order and sells no hints: "${T1[0]}"`);
  expect(refusal(ladder(T1, T2, T3))).toBe(`sequence hints: tier 1 of 3 (ru) is sold, but a sequence device shows its order and sells no hints: "${T1[0]}"`);
  // The control: no tier sold, nothing mis-sold; the empty ladder is returned as it is.
  const none: { ru: string; en: string }[] = [];
  expect(SEQUENCE_LINT.renderHints(SQ3, none)).toBe(none);
  expect(refusal([])).toBeNull();
});

test('sequence: the solution check refuses any answer but the order', () => {
  const v = (s: readonly number[]): string | null => SEQUENCE_LINT.validateSolution(SQ3, s);
  expect(v([0, 2, 1])).toBeNull();
  expect(v([0, 1, 2])).toBe('the solution [0, 1, 2] is not the order [0, 2, 1]');
  expect(v([0, 2])).toBe('the solution [0, 2] is not the order [0, 2, 1]');
  expect(v([0, 2, 1, 0])).toBe('the solution [0, 2, 1, 0] is not the order [0, 2, 1]');
  // One canonical answer, the order: the reach pass's solution.
  expect(SEQUENCE_LINT.solve(SQ3)).toEqual([0, 2, 1]);
  expect(SEQUENCE_LINT.countSolutions()).toBe(1);
});

test('ritual: the solution check refuses a misshapen answer', () => {
  const v = (s: readonly number[]): string | null => RITUAL_LINT.validateSolution(RT35, s);
  expect(v([2, 0, 1, 1, 2])).toBeNull();
  // No start clause: the device shows nothing before input, so a list of zeros is a secret like any other.
  expect(v([0, 0, 0, 0, 0])).toBeNull();
  expect(v([2, 0, 1, 1])).toBe('length 4, expected 5');
  expect(v([2, 0, 1, 1, 3])).toBe('3 at index 4 is out of range: an integer in 0..2');
  expect(v([2, 0, 1, 1, 0.5])).toBe('0.5 at index 4 is out of range: an integer in 0..2');
  // A commit type's goal is its one source solution.
  expect(RITUAL_LINT.countSolutions()).toBe(1);
});

test("sequence, ritual: partRects gives each part's own rect, the replay last", () => {
  // D7 (GM8b-B3): the frame check (GM8a2) reads every tap target's rect through the lint half and locates each among the
  // decoded params by identity, so each entry is the decoder's own rect object, the replay's last.
  const decodedSequence = SEQUENCE_RULES.decodeParams(SQ3);
  const decodedRitual = RITUAL_RULES.decodeParams(RT35);
  if (!decodedSequence.ok || !decodedRitual.ok) {
    throw new Error(`invariant: the fixtures decode: ${JSON.stringify([decodedSequence, decodedRitual])}`);
  }
  const s = decodedSequence.value;
  const sr = SEQUENCE_LINT.partRects(s);
  expect(sr).toHaveLength(s.parts + 1);
  s.rects.forEach((r, i) => expect(sr[i], `part ${i}`).toBe(r));
  expect(sr.at(-1)).toBe(s.replay);
  expect(sr).toEqual([...rowRects(3), slot(3)]);
  const r = decodedRitual.value;
  const rr = RITUAL_LINT.partRects(r);
  expect(rr).toHaveLength(r.parts);
  r.rects.forEach((x, i) => expect(rr[i], `part ${i}`).toBe(x));
  expect(rr).toEqual(rowRects(3));
});

test('ritual: the per-player domain counts every press sequence of its length', () => {
  // D11 (c8): a per-player `ritual` draws its secret from every list of `length` presses of `parts` parts: parts ^ length.
  // Exact values, not a comparison with the server's floor of 1,000 (729 and 1,024 lie either side of it).
  const presses = (parts: number, length: number): RitualParams => ({ parts, length, rects: rowRects(parts) });
  expect(ritualDomainSize(presses(3, 6))).toBe(729);
  expect(ritualDomainSize(presses(4, 5))).toBe(1024);
  expect(ritualDomainSize(presses(6, 4))).toBe(1296);
  expect(ritualDomainSize(presses(2, 3))).toBe(8);
  expect(ritualDomainSize(presses(6, 12))).toBe(2_176_782_336);
});

// ---------------------------------------------------------------------------------------------------------------
// The world lints on worlds that hold the real `sequence` and `ritual` (engine plan §7.3-§7.5; D14), each world written in
// the source format and decoded with the real registries. Each world declares no item, and a device room holds only
// its device's hotspot (GM8b-B4); every row reads the reach pass, the clue pass or a code-filtered lintWorld.

/** No pass below reads the asset catalog. */
const CATALOG: AssetCatalog = { bg: {}, chars: {}, cg: {}, bgm: {}, sfx: {}, prop: {}, cover: {} };

/** The per-world lint input of a source world; its line lookup numbers each path in the order it is first asked for. */
function inputOf(raw: unknown): WorldLintInput {
  const text = `${JSON.stringify(raw, null, 2)}\n`;
  const r = decodeWorldSource(JSON.parse(text));
  if (!r.ok) {
    throw new Error(`invariant: the fixture decodes: ${JSON.stringify(r.error)}`);
  }
  const asked: string[] = [];
  const line = (path: string): number => {
    const i = asked.indexOf(path);
    return i >= 0 ? i + 1 : asked.push(path);
  };
  const chapter = { id: 'ch1' as ChapterId, paid: false, entry: 'ch1/main.ink' }; // a fixture chapter id
  return { chapter, file: 'story/ch1/world.json', text, world: r.value, catalog: CATALOG, knots: null, yielded: null, declared: new Map(), line, moduleLines: new Map() };
}

/** A world whose one puzzle `fuse` is a sequence puzzle on no lock (a linear yield's place, levers.test.ts's form). */
function fuseWorld(params: SequenceParams, o: { readonly maxAttempts?: number; readonly solution?: readonly number[] } = {}): unknown {
  const fuse = {
    type: 'sequence',
    title: { id: 'ch1.fuse.0001', ru: 'Колокола' },
    prompt: { id: 'ch1.fuse.0002', ru: 'Порядок' },
    closeup: null,
    params,
    maxAttempts: o.maxAttempts ?? null,
    giveUp: false,
    solution: o.solution ?? [...params.order],
    hints: [],
  };
  return { format: 1, items: {}, docs: {}, sections: {}, puzzles: { fuse } };
}

let lineCounter = 0;
const txt = (ru: string): { id: string; ru: string } => ({ id: `ch1.sq.${(lineCounter++).toString(36).padStart(4, '0')}`, ru });
/** A hotspot rect in the safe frame and the band, in column `i`. */
const spot = (i: number): Rect => [80 + i * 300, 800, 200, 200];

/**
 * A world of one section: the hall (a look `note`, the way to the view `panel`, the way out) and the panel, a view of the
 * hall whose one hotspot is the device `dial`, a zero-slot lock with the puzzle `dial`.
 */
function deviceWorld(dial: Readonly<Record<string, unknown>>): unknown {
  const exit = (id: string, to: unknown, i: number): unknown => ({ id, kind: 'exit', rect: spot(i), label: txt(id), to, lock: null, sfx: null });
  const lock = { slots: [], puzzle: 'dial', locked: txt('заперто'), onOpen: [], onFail: [] };
  const hall = [{ id: 'note', kind: 'look', rect: spot(0), label: txt('записка'), look: txt('Знаки на обороте.'), then: [] }, exit('to_panel', { room: 'panel' }, 1), exit('out', { story: 'end' }, 2)];
  const device = { id: 'dial', kind: 'object', rect: spot(1), label: txt('механизм'), lock, then: [], look: null, prop: null };
  return {
    format: 1,
    items: {},
    docs: {},
    puzzles: { dial: { title: txt('Механизм'), prompt: txt('Кнопки'), closeup: null, maxAttempts: null, giveUp: false, hints: [], ...dial } },
    sections: {
      s: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: { bg: 'room', title: txt('Зал'), onEnter: [], hotspots: hall },
          panel: { bg: 'room', title: txt('Панель'), onEnter: [], hotspots: [device], view: { of: 'hall' }, device: 'dial' },
        },
      },
    },
  };
}

/** Each finding as `<code>: <message>`. */
const said = (findings: ReadonlyArray<{ readonly code: string; readonly message: string }>): string[] => findings.map((f) => `${f.code}: ${f.message}`);

test('story: a sequence with a clue is refused', () => {
  // D14 (07:181): a sequence draws its goal (it shows its order), so it declares no clue.
  const sequence = (clues: readonly unknown[]): unknown => deviceWorld({ type: 'sequence', params: SQ3, solution: [...SQ3.order], clues });
  const codes = (raw: unknown): string[] => said(clueFindings(inputOf(raw)).filter((f) => f.code === 'world/reach-has-clue'));
  expect(codes(sequence([{ examined: 'hall.note' }]))).toEqual(["world/reach-has-clue: puzzle 'dial' (sequence) draws its goal: it declares no clue (§7.3)"]);
  // The control: the same device with no clue.
  expect(codes(sequence([]))).toEqual([]);
});

test("story: a sequence may set maxAttempts, and its order reaches by the device's own rule", () => {
  // D14: a sequence's wrong press is the device's own (`wrong: 'local'`), so an attempt count moves; its one solution, the
  // order, reaches by the play half's rule, is its own canonical form and is not reached at the start: no reach finding.
  expect(reachFindings(inputOf(fuseWorld(SQ3, { maxAttempts: 3 })))).toEqual([]);
  expect(reachFindings(inputOf(fuseWorld({ parts: 4, order: [3, 3, 0], rects: rowRects(4), replay: slot(4) })))).toEqual([]);
});

test('story: a sequence solution other than its order is refused', () => {
  // D14: the source solution is checked by the lint half (`world/solution`): only the order is the device's answer.
  const solutions = (solution: readonly number[]): string[] => said(lintWorld(inputOf(fuseWorld(SQ3, { solution }))).findings.filter((f) => f.code === 'world/solution'));
  expect(solutions([0, 1, 2])).toEqual(["world/solution: puzzle 'fuse': the solution [0, 1, 2] is not the order [0, 2, 1]"]);
  // The control: the order is clean.
  expect(solutions([0, 2, 1])).toEqual([]);
});

test('story: a secret ritual device declares a clue its section reaches', () => {
  // D14 (RULINGS 360): `ritual` keeps its goal secret, so its device declares a clue; the clue search walks the device's
  // section with the puzzle's own end removed.
  const ritual = (clues: readonly unknown[]): unknown => deviceWorld({ type: 'ritual', params: RT35, solution: [2, 0, 1, 1, 2], clues });
  const codes = (raw: unknown, code: string): string[] => said(clueFindings(inputOf(raw)).filter((f) => f.code === code));
  expect(codes(ritual([]), 'world/clue-declared')).toEqual([
    "world/clue-declared: puzzle 'dial' (ritual, a secret goal) declares no clue: clues names the fact that shows its answer (§7.3, I4)",
  ]);
  // A clue the section reaches before the device opens (the hall's note, examined): clean.
  expect([codes(ritual([{ examined: 'hall.note' }]), 'world/clue-declared'), codes(ritual([{ examined: 'hall.note' }]), 'world/clue-reachable')]).toEqual([[], []]);
});
