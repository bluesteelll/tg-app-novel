// The `levers` and `setting` devices' build halves (engine plan §7.1 "BUILD", §7.4; GM8a D1-D5, D11, D13): the bounded
// breadth-first search for the throw order, the solution checks, the hint ladder's `[moves]` invariant and its
// rendering, the part rects the frame check reads, and the reach and clue passes on worlds that hold the real types.
import { expect, test } from 'vitest';

import { throwPart } from '../../../src/puzzles/play/levers.ts';
import { LEVERS_RULES } from '../../../src/puzzles/rules/levers.ts';
import type { LeversParams } from '../../../src/puzzles/rules/levers.ts';
import type { SettingParams } from '../../../src/puzzles/rules/setting.ts';
import type { AssetCatalog } from '../../../src/story/catalog.ts';
import type { ChapterId, Rect } from '../../../src/story/staging.ts';
import { decodeWorldSource } from '../../../src/world/decode.ts';
import { clueFindings, reachFindings } from '../mechanics/clues.ts';
import { devicesFindings } from '../mechanics/devices.ts';
import type { WorldLintInput } from '../mechanics/index.ts';
import { lintWorld } from '../world.ts';
import { PUZZLE_LINTS } from './index.ts';
import { LEVERS_LINT, LEVERS_SEARCH_STEPS, leversLint, searchLevers } from './levers.ts';
import { SETTING_LINT } from './setting.ts';

/** `n` rects in a 4-column grid of 150 px squares inside HOTSPOT_SAFE_FRAME and the device band (A6). */
const rectsOf = (n: number): Rect[] => Array.from({ length: n }, (_, i): Rect => [80 + (i % 4) * 230, 800 + Math.floor(i / 4) * 400, 150, 150]);
/** `parts` levers of `positions` positions with `couples` and `target`. */
const levers = (positions: number, couples: readonly (readonly number[])[], target: readonly number[]): LeversParams => ({
  parts: couples.length,
  positions,
  couples,
  target,
  rects: rectsOf(couples.length),
});
/** 2 free levers, both to 1: two shortest orders tie (0 then 1, 1 then 0). */
const TIE = levers(2, [[], []], [1, 1]);
/** Lever 0 moves lever 1 too (3 positions): to 2 1 takes two throws of each, four in all. */
const L23 = levers(3, [[1], []], [2, 1]);
/** 3 levers of 4: 0 moves 1 and 2, 2 moves 1, 1 moves alone; to 2 3 1 takes seven throws. */
const L34 = levers(4, [[1, 2], [], [1]], [2, 3, 1]);
/** Each throw moves both levers: 1 0 is beyond every throw (the couple parity). */
const PARITY = levers(2, [[1], [0]], [1, 0]);
/** 2 free levers of 3 positions, the target two throws deep. */
const DEPTH2 = levers(3, [[], []], [1, 1]);
/** The worst decode-legal instance: 8 free levers of 4, all to 3, the one configuration 24 throws deep. */
const WORST = levers(4, [[], [], [], [], [], [], [], []], [3, 3, 3, 3, 3, 3, 3, 3]);

/** The configuration a throw order reaches from the start. */
function play(p: LeversParams, order: readonly number[]): readonly number[] {
  return order.reduce<readonly number[]>((a, part) => throwPart(p, a, part) ?? a, LEVERS_RULES.initial(p));
}

test('levers: the witness is the shortest throw order', () => {
  // A tie is broken by ascending lever index, breadth first, so server content is byte-stable: 0 then 1, never 1 then 0.
  expect(LEVERS_LINT.witness(TIE)).toEqual([0, 1]);
  // A coupled instance: two throws of lever 0 (both levers to 2), then two of lever 1 (lever 1 round to 1).
  expect(LEVERS_LINT.witness(L23)).toEqual([0, 0, 1, 1]);
  expect(play(L23, [0, 0, 1, 1])).toEqual(L23.target);
  // Every witness plays to its target from the start; a target beyond every throw has none.
  for (const p of [TIE, L23, DEPTH2, L34]) {
    const order = LEVERS_LINT.witness(p);
    expect(order, JSON.stringify(p.target)).not.toBeNull();
    expect(play(p, order ?? []), JSON.stringify(p.target)).toEqual(p.target);
  }
  // L34: lever 0 stands at a, lever 2 at a + c, lever 1 at a + b + c (a, b, c each lever's throws): 2, 2 and 3.
  expect(LEVERS_LINT.witness(L34)).toHaveLength(7);
  expect(LEVERS_LINT.witness(PARITY)).toBeNull();
});

test('levers: countSolutions counts the target once when its throws reach it', () => {
  // D4: the canonical answer that reaches is the target itself, so a reachable target counts 1, an unreachable one 0.
  expect(LEVERS_LINT.countSolutions(L23, 2)).toBe(1);
  expect(LEVERS_LINT.countSolutions(TIE, 2)).toBe(1);
  expect(LEVERS_LINT.countSolutions(PARITY, 2)).toBe(0);
  expect(LEVERS_LINT.solve(L23)).toEqual([2, 1]);
  expect(LEVERS_LINT.solve(PARITY)).toBeNull();
  expect(searchLevers(PARITY)).toEqual({ found: false, witness: null, steps: 4, stopped: false });
});

test('levers: a search past its bound stops, never hangs', () => {
  // D5: the bound from the search itself, one throw below what the unbounded search tried before it took the target.
  const full = searchLevers(DEPTH2, Number.POSITIVE_INFINITY);
  expect(full).toEqual({ found: true, witness: [0, 1], steps: 8, stopped: false });
  const short = leversLint(full.steps - 1);
  expect(searchLevers(DEPTH2, full.steps - 1)).toEqual({ found: false, witness: null, steps: 7, stopped: true });
  expect([short.solve(DEPTH2), short.countSolutions(DEPTH2, 2), short.witness(DEPTH2)]).toEqual([null, null, null]);
  // The same instance under the shipped bound solves, and the bounded half kept its own answers (no shared memo).
  expect(LEVERS_LINT.solve(DEPTH2)).toEqual([1, 1]);
  expect(short.solve(DEPTH2)).toBeNull();
  expect(leversLint(full.steps).countSolutions(DEPTH2, 2)).toBe(1);
});

test('levers: the shipped search bound proves the largest instance', () => {
  // B4 (critique O2): on the worst decode-legal instance the search takes every other configuration first (65,535 x 8
  // throws) and still answers well inside the shipped bound.
  expect(LEVERS_SEARCH_STEPS).toBe(1_000_000);
  expect(LEVERS_LINT.countSolutions(WORST, 2)).toBe(1);
  expect(LEVERS_LINT.solve(WORST)).toEqual(WORST.target);
  expect(LEVERS_LINT.witness(WORST)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7]);
  expect(searchLevers(WORST)).toMatchObject({ found: true, steps: 524_280, stopped: false });
});

test('levers: the solution check refuses any answer but the target', () => {
  const v = (p: LeversParams, s: readonly number[]): string | null => LEVERS_LINT.validateSolution(p, s);
  // The server compares the posted configuration with the source solution: only the target ever posts.
  expect(v(L23, [2, 1])).toBeNull();
  expect(v(L23, [1, 2])).toBe('the solution [1, 2] is not the target [2, 1]');
  expect(v(L23, [2, 1, 0])).toBe('the solution [2, 1, 0] is not the target [2, 1]');
  expect(v(L23, [0, 0])).toBe('the solution [0, 0] is not the target [2, 1]');
  // A target beyond every throw is the reach pass's finding: this check adds none (one root cause, one finding).
  expect(v(PARITY, [0, 0])).toBeNull();
});

/** A three-tier ladder, each tier `{ ru, en }`. */
const ladder = (...tiers: ReadonlyArray<readonly [string, string]>): { ru: string; en: string }[] => tiers.map(([ru, en]) => ({ ru, en }));
const T1: readonly [string, string] = ['Рычаги двигают соседей.', 'The levers move their neighbours.'];
const T2: readonly [string, string] = ['Начните с первого.', 'Start with the first.'];
const T3: readonly [string, string] = ['Порядок рычагов: [moves].', 'Lever order: [moves].'];

/** The message `renderHints` throws for `hints`, or null when it renders them. */
function refusal(hints: readonly { ru: string; en: string }[]): string | null {
  try {
    LEVERS_LINT.renderHints(L23, hints);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

test('story: a levers tier 3 without [moves] is refused', () => {
  // D2: the sold last tier carries the throw order in both languages; each language checked with the other clean.
  expect(refusal(ladder(T1, T2, [T3[0], 'Lever order.']))).toBe('levers hints: tier 3 of 3 (en) holds no [moves]: "Lever order."');
  expect(refusal(ladder(T1, T2, ['Порядок рычагов.', T3[1]]))).toBe('levers hints: tier 3 of 3 (ru) holds no [moves]: "Порядок рычагов."');
  // A one-tier ladder's only tier is its last.
  expect(refusal(ladder([T3[0], 'Pull them all.']))).toBe('levers hints: tier 1 of 1 (en) holds no [moves]: "Pull them all."');
});

test('story: a levers last tier holding [moves] twice is refused', () => {
  expect(refusal(ladder(T1, T2, [T3[0], 'Order: [moves], then [moves].']))).toBe(
    'levers hints: tier 3 of 3 (en) holds [moves] 2 times, not once: "Order: [moves], then [moves]."',
  );
  expect(refusal(ladder(T1, T2, ['Порядок: [moves], [moves], [moves].', T3[1]]))).toBe(
    'levers hints: tier 3 of 3 (ru) holds [moves] 3 times, not once: "Порядок: [moves], [moves], [moves]."',
  );
});

test('story: [moves] in an earlier levers tier is refused', () => {
  // The throw order sold at a cheaper tier, or a literal `[moves]` shipped: each earlier tier, each language.
  expect(refusal(ladder([T1[0], 'First: [moves].'], T2, T3))).toBe('levers hints: tier 1 of 3 (en) holds [moves], which only the last tier may: "First: [moves]."');
  expect(refusal(ladder(T1, ['Сначала [moves].', T2[1]], T3))).toBe('levers hints: tier 2 of 3 (ru) holds [moves], which only the last tier may: "Сначала [moves]."');
  expect(refusal(ladder(['Сначала [moves].', T1[1]], T2, T3))).toBe('levers hints: tier 1 of 3 (ru) holds [moves], which only the last tier may: "Сначала [moves]."');
  expect(refusal(ladder(T1, [T2[0], 'Then [moves].'], T3))).toBe('levers hints: tier 2 of 3 (en) holds [moves], which only the last tier may: "Then [moves]."');
});

test('levers: a clean ladder renders and an empty one passes', () => {
  // The controls of the three refusals above: the same ladders clean in both languages render with no throw.
  const clean = ladder(T1, T2, T3);
  const rendered = LEVERS_LINT.renderHints(L23, clean);
  expect(rendered).toHaveLength(3);
  expect(rendered.slice(0, 2)).toEqual(clean.slice(0, 2));
  expect(refusal(ladder(T3))).toBeNull();
  // No tier sold, nothing mis-sold: a levers puzzle with no hints renders none.
  expect(LEVERS_LINT.renderHints(L23, [])).toEqual([]);
});

/** 3 knobs of 10 positions, the pull below them. */
const S3: SettingParams = { parts: 3, positions: 10, rects: rectsOf(3), pull: [380, 1300, 300, 150] };

test("levers, setting: partRects gives one rect per part, the pull's last", () => {
  // D3: the frame check (GM8a2) reads every part's rect through the lint half; `setting`'s pull is a part too, last.
  expect(LEVERS_LINT.partRects(L23)).toEqual(rectsOf(2));
  expect(LEVERS_LINT.partRects(WORST)).toHaveLength(8);
  expect(SETTING_LINT.partRects(S3)).toEqual([...rectsOf(3), [380, 1300, 300, 150]]);
  expect(SETTING_LINT.partRects(S3)).toHaveLength(S3.parts + 1);
});

test('setting: the solution check refuses a misshapen answer and the start', () => {
  const v = (s: readonly number[]): string | null => SETTING_LINT.validateSolution(S3, s);
  expect(v([1, 9, 0])).toBeNull();
  expect(v([1, 9])).toBe('length 2, expected 3');
  expect(v([1, 10, 0])).toBe('10 at index 1 is out of range: an integer in 0..9');
  expect(v([1, 0.5, 0])).toBe('0.5 at index 1 is out of range: an integer in 0..9');
  // The start shown is no secret: a solution at all zeros would open before any input.
  expect(v([0, 0, 0])).toBe('the solution equals the initial state (all zeros)');
  // A commit type's goal is its one source solution.
  expect(SETTING_LINT.countSolutions()).toBe(1);
});

// ---------------------------------------------------------------------------------------------------------------
// The world lints on worlds that hold the real `levers` and `setting` (engine plan §7.3-§7.5; D4, D5, D11, D15), each
// world written in the source format and decoded with the real registries.

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

/** A world whose one puzzle `fuse` is a levers puzzle on no lock (a linear yield's place, path.test.ts's `fuse` form). */
function fuseWorld(params: LeversParams, o: { readonly maxAttempts?: number; readonly solution?: readonly number[] } = {}): unknown {
  const fuse = {
    type: 'levers',
    title: { id: 'ch1.fuse.0001', ru: 'Щиток' },
    prompt: { id: 'ch1.fuse.0002', ru: 'Рычаги' },
    closeup: null,
    params,
    maxAttempts: o.maxAttempts ?? null,
    giveUp: false,
    solution: o.solution ?? [...params.target],
    hints: [],
  };
  return { format: 1, items: {}, docs: {}, sections: {}, puzzles: { fuse } };
}

let lineCounter = 0;
const txt = (ru: string): { id: string; ru: string } => ({ id: `ch1.lv.${(lineCounter++).toString(36).padStart(4, '0')}`, ru });
/** A hotspot rect in the safe frame and the band, in column `i`. */
const spot = (i: number): Rect => [80 + i * 300, 800, 200, 200];

/**
 * A world of one section: the hall (a look `note`, the way to the view `panel`, the way out) and the panel, a view of the
 * hall whose device `dial` carries a zero-slot lock with the puzzle `dial`.
 */
function deviceWorld(dial: Readonly<Record<string, unknown>>): unknown {
  const exit = (id: string, to: unknown, i: number): unknown => ({ id, kind: 'exit', rect: spot(i), label: txt(id), to, lock: null, sfx: null });
  const lock = { slots: [], puzzle: 'dial', locked: txt('заперто'), onOpen: [], onFail: [] };
  const hall = [{ id: 'note', kind: 'look', rect: spot(0), label: txt('записка'), look: txt('Цифры на обороте.'), then: [] }, exit('to_panel', { room: 'panel' }, 1), exit('out', { story: 'end' }, 2)];
  const device = { id: 'dial', kind: 'object', rect: spot(1), label: txt('механизм'), lock, then: [], look: null, prop: null };
  return {
    format: 1,
    items: {},
    docs: {},
    puzzles: { dial: { title: txt('Механизм'), prompt: txt('Ручки'), closeup: null, maxAttempts: null, giveUp: false, hints: [], ...dial } },
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

test('story: a levers target its throws cannot reach is refused', () => {
  // c2: the reach pass runs the real search through the real registry; a couple parity leaves the target unreachable.
  expect(said(reachFindings(inputOf(fuseWorld(PARITY))))).toEqual(["world/reach-solution: puzzle 'fuse' (levers) has no solution: no answer reaches its goal (§7.4)"]);
  // The control: a reachable target is clean.
  expect(reachFindings(inputOf(fuseWorld(L23)))).toEqual([]);
});

test('story: maxAttempts on levers is refused', () => {
  // c7: a levers device has no wrong state, so an attempt count would never move.
  const capped = reachFindings(inputOf(fuseWorld(L23, { maxAttempts: 3 }))).filter((f) => f.code === 'world/attempts-without-wrong');
  expect(said(capped)).toEqual(["world/attempts-without-wrong: puzzle 'fuse' (levers) has maxAttempts 3, but its type has no wrong answer: the count never moves"]);
  expect(reachFindings(inputOf(fuseWorld(L23))).filter((f) => f.code === 'world/attempts-without-wrong')).toEqual([]);
});

test('story: a linear levers yield is refused', () => {
  // c10 (D15): the devices lint reads the registered types by default, so the first real view type is held to its device
  // with no `types` passed: on no lock, a levers puzzle is refused.
  expect(said(devicesFindings(inputOf(fuseWorld(L23))))).toEqual([
    "world/view-type-site: puzzles.fuse: view-type puzzle 'fuse' is on no lock: a view type is played only by its device, never as a linear yield (§7.5)",
  ]);
  // The control: the same puzzle as a view room's device is clean.
  const { parts, positions, couples, target, rects } = L23;
  expect(devicesFindings(inputOf(deviceWorld({ type: 'levers', params: { parts, positions, couples, target, rects }, solution: [...target] })))).toEqual([]);
});

test('story: a levers target equal to its start is refused', () => {
  // c13: a target at the start would post before any input; written as the solution, it is the initial state too.
  const atStart = levers(3, [[1], []], [0, 0]);
  const input = inputOf(fuseWorld(atStart, { solution: [0, 0] }));
  expect(said(reachFindings(input).filter((f) => f.code === 'world/reach-solution'))).toEqual([
    "world/reach-solution: puzzle 'fuse' (levers) is reached at its start: it would post before any input (§7.4)",
  ]);
  expect(said(lintWorld(input).findings.filter((f) => f.code === 'world/solution-initial'))).toEqual([
    "world/solution-initial: puzzle 'fuse': the solution [0, 0] is the initial state (X17)",
  ]);
  // The control: a target off the start, written as the solution, is neither.
  const off = inputOf(fuseWorld(L23));
  expect([reachFindings(off).filter((f) => f.code === 'world/reach-solution'), lintWorld(off).findings.filter((f) => f.code === 'world/solution-initial')]).toEqual([[], []]);
});

test('story: a levers search stopped at its bound is refused as unproven', () => {
  // D5 through the reach pass: a lint half built under a bound one throw below what the search needs is unproven, one
  // finding; never "has no solution" (one root cause, one finding).
  const steps = searchLevers(DEPTH2, Number.POSITIVE_INFINITY).steps;
  const input = inputOf(fuseWorld(DEPTH2));
  expect(said(reachFindings(input, { ...PUZZLE_LINTS, levers: leversLint(steps - 1) }))).toEqual([
    "world/unique-solution: puzzle 'fuse' (levers): the solution search stopped at its bound before it proved one solution (§7.4)",
  ]);
  // The control: at the bound the search needs, and under the shipped one, it is clean.
  expect(reachFindings(input, { ...PUZZLE_LINTS, levers: leversLint(steps) })).toEqual([]);
  expect(reachFindings(input)).toEqual([]);
});

test('story: a secret setting device declares a clue its section reaches', () => {
  // D11 (RULINGS 360): the clue lints run on a secret device's section. `setting` keeps its goal secret, so it declares a
  // clue; the clue search walks the device's section with the puzzle's own end removed.
  const setting = (clues: readonly unknown[]): unknown =>
    deviceWorld({ type: 'setting', params: { parts: 3, positions: 10, rects: [spot(0), spot(1), spot(2)], pull: [380, 1300, 300, 150] }, solution: [1, 2, 3], clues });
  const codes = (raw: unknown, code: string): string[] => said(clueFindings(inputOf(raw)).filter((f) => f.code === code));
  expect(codes(setting([]), 'world/clue-declared')).toEqual([
    "world/clue-declared: puzzle 'dial' (setting, a secret goal) declares no clue: clues names the fact that shows its answer (§7.3, I4)",
  ]);
  // A clue the section reaches before the device opens (the hall's note, examined): clean.
  expect([codes(setting([{ examined: 'hall.note' }]), 'world/clue-declared'), codes(setting([{ examined: 'hall.note' }]), 'world/clue-reachable')]).toEqual([[], []]);
  // A clue only the device's own end sets: its search never meets it.
  expect(codes(setting([{ solved: 'dial' }]), 'world/clue-reachable')).toEqual([
    'world/clue-reachable: puzzle \'dial\': clue {"solved":"dial"} holds in no state of section s reached before \'dial\' is solved or failed (§7.3)',
  ]);
});
