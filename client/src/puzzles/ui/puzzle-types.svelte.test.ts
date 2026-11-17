// LP2 in happy-dom: the puzzle type UIs (PUZZLES-PLAN X17; engine plan §7.2 `path`, GM7p; the devices, GM8a) and their
// lazy loader (X14). Each is presentational: the answer comes in as a prop and every change leaves as a fresh array,
// through `onchange` (an overlay type) or `onwork` (a device).
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

import type { GestureCue } from '../../cues/types.ts';
import { t } from '../../i18n/index.ts';
import type { Lang } from '../../i18n/index.ts';
import { mechT } from '../../i18n/mechanics.ts';
import { GLYPH_PATHS } from '../../ui/glyphs.ts';
import type { Glyph, ItemId } from '../../world/types.ts';
import { loadPuzzleUi, PUZZLE_UI } from '../registry.ts';
import type { PuzzleUiProps } from '../registry.ts';
import { PUZZLE_RULES, PUZZLE_TYPES, puzzleInstance } from '../rules/index.ts';
import type { PuzzleType, PuzzleTypeData, PuzzleTypes } from '../rules/index.ts';
import CodeLock from './CodeLock.svelte';
import codeLockSource from './CodeLock.svelte?raw';
import GridPuzzle from './GridPuzzle.svelte';
import gridSource from './GridPuzzle.svelte?raw';
import LeverDevice from './LeverDevice.svelte';
import leverSource from './LeverDevice.svelte?raw';
import OrderPuzzle from './OrderPuzzle.svelte';
import PathPuzzle from './PathPuzzle.svelte';
import pathSource from './PathPuzzle.svelte?raw';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here.
afterEach(() => cleanup());

const LANGS: readonly Lang[] = ['ru', 'en'];

function props(over: Partial<PuzzleUiProps> = {}): PuzzleUiProps {
  return { params: { dials: 4 }, answer: [0, 0, 0, 0], busy: false, lang: 'en', onchange: () => {}, item: () => null, ...over };
}

/** The rendered text with runs of whitespace as one space. */
const shown = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) {
    throw new Error(`invariant: element ${i} exists`);
  }
  return v;
}

test('code: dials wrap and emit answer', async () => {
  for (const lang of LANGS) {
    const onchange = vi.fn<(a: readonly number[]) => void>();
    const answer = Object.freeze([9, 0, 0, 0]);
    const { container, getAllByRole, rerender, unmount } = render(CodeLock, props({ answer, onchange, lang }));
    const up = getAllByRole('button', { name: t(lang, 'puzzle.dial_up') });
    const down = getAllByRole('button', { name: t(lang, 'puzzle.dial_down') });
    expect([up.length, down.length], lang).toEqual([4, 4]);
    expect([...container.querySelectorAll('.digit')].map(shown), lang).toEqual(['9', '0', '0', '0']);
    // ▲ on 9 wraps to 0.
    await fireEvent.click(at(up, 0));
    expect(onchange.mock.lastCall?.[0], lang).toEqual([0, 0, 0, 0]);
    // ▼ on 0 wraps to 9; the answer prop was not mutated, so the first dial is still 9.
    await fireEvent.click(at(down, 1));
    expect(onchange.mock.lastCall?.[0], lang).toEqual([9, 9, 0, 0]);
    expect(answer).toEqual([9, 0, 0, 0]);
    expect(onchange.mock.calls.every(([a]) => a !== answer), lang).toBe(true);
    // The digits are the prop's: the caller's next answer is what shows.
    await rerender({ answer: [0, 9, 0, 0] });
    expect([...container.querySelectorAll('.digit')].map(shown), lang).toEqual(['0', '9', '0', '0']);
    // Busy (an attempt in flight): the dials are disabled and emit nothing.
    await rerender({ busy: true });
    expect([...up, ...down].every((b) => (b as HTMLButtonElement).disabled), lang).toBe(true);
    await fireEvent.click(at(up, 2));
    expect(onchange, lang).toHaveBeenCalledTimes(2);
    unmount();
  }
  // Params the type does not decode render nothing actionable.
  const { queryAllByRole } = render(CodeLock, props({ params: { dials: 1 } }));
  expect(queryAllByRole('button')).toEqual([]);
});

/** The declarations of every rule of a component's <style> whose selector list names the class `cls`. */
function declarationsFor(source: string, cls: string): Map<string, string> {
  const style = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1] ?? '').join('\n');
  const out = new Map<string, string>();
  for (const m of style.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.some((s) => new RegExp(`\\.${cls}(?![\\w-])`).test(s) && !s.includes(':'))) {
      continue;
    }
    for (const decl of (m[2] ?? '').split(';')) {
      const [prop, ...value] = decl.split(':');
      if (prop !== undefined && value.length > 0) {
        out.set(prop.trim(), value.join(':').trim());
      }
    }
  }
  return out;
}

const px = (value: string | undefined): number => Number(/^(\d+(?:\.\d+)?)px$/.exec(value ?? '')?.[1] ?? Number.NaN);

test("code: each dial button's cue index is its dial", () => {
  // GM8h2 D17: a dial's up and down presses emit `ui` cues whose index is the button's `data-cue-index` (cues/root.ts):
  // its dial, the part its digit marks.
  const { container } = render(CodeLock, props());
  const marks = [...container.querySelectorAll('button[data-cue]')].map((b) => [b.getAttribute('data-cue'), b.getAttribute('data-cue-index')]);
  expect(marks).toEqual(
    [0, 1, 2, 3].flatMap((i) => [
      ['dial-up', String(i)],
      ['dial-down', String(i)],
    ]),
  );
});

test('code: dial buttons at least 48 px', () => {
  // happy-dom computes no layout: the rule is read from the source, and the rendered buttons carry its class.
  const { getAllByRole } = render(CodeLock, props());
  const buttons = getAllByRole('button');
  expect(buttons).toHaveLength(8);
  expect(buttons.every((b) => b.classList.contains('step'))).toBe(true);
  const step = declarationsFor(codeLockSource, 'step');
  expect(px(step.get('min-width'))).toBeGreaterThanOrEqual(48);
  expect(px(step.get('min-height'))).toBeGreaterThanOrEqual(48);
  // The reader: a 44 px rule reads as 44, a pseudo-class rule does not count.
  expect(px(declarationsFor('<style>.a, .step { min-width: 44px } .step:disabled { min-width: 99px }</style>', 'step').get('min-width'))).toBe(44);
});

const PIECES = ['medal_sun', 'medal_moon', 'medal_star'];
const NAMES: Readonly<Record<string, string>> = { medal_sun: 'Sun', medal_moon: 'Moon', medal_star: 'Star' };
const GLYPHS: Readonly<Record<string, Glyph>> = { medal_sun: 'sun', medal_moon: 'moon', medal_star: 'star' };
const item = (id: ItemId): { name: string; glyph: Glyph } | null =>
  Object.hasOwn(NAMES, id) ? { name: NAMES[id] ?? '', glyph: GLYPHS[id] ?? 'sun' } : null;

test('order: tap two slots swaps', async () => {
  for (const lang of LANGS) {
    const onchange = vi.fn<(a: readonly number[]) => void>();
    const answer = Object.freeze([0, 1, 2]);
    const { container, getAllByRole, rerender, unmount } = render(OrderPuzzle, props({ params: { pieces: PIECES }, answer, onchange, item, lang }));
    expect(shown(container), lang).toContain(t(lang, 'puzzle.swap'));
    const slots = getAllByRole('button');
    expect(slots.map(shown), lang).toEqual(['Sun', 'Moon', 'Star']);
    const pressed = (): string[] => slots.map((s) => s.getAttribute('aria-pressed') ?? '');
    expect(pressed(), lang).toEqual(['false', 'false', 'false']);
    // The first tap selects: a thicker border (the class), a check glyph and aria-pressed, not colour alone.
    await fireEvent.click(at(slots, 0));
    expect(onchange, lang).not.toHaveBeenCalled();
    expect(at(slots, 0).querySelector('.check')?.textContent, lang).toBe('✓');
    expect(at(slots, 0).classList.contains('selected'), lang).toBe(true);
    expect(pressed(), lang).toEqual(['true', 'false', 'false']);
    // The second tap swaps the two slots' pieces, and the selection ends.
    await fireEvent.click(at(slots, 1));
    expect(onchange.mock.calls, lang).toEqual([[[1, 0, 2]]]);
    expect(answer).toEqual([0, 1, 2]);
    expect(pressed(), lang).toEqual(['false', 'false', 'false']);
    expect(container.querySelector('.check'), lang).toBeNull();
    // A tap on the selected slot deselects it and swaps nothing.
    await fireEvent.click(at(slots, 2));
    await fireEvent.click(at(slots, 2));
    expect(pressed(), lang).toEqual(['false', 'false', 'false']);
    expect(onchange, lang).toHaveBeenCalledTimes(1);
    // The arrangement shown is the prop's.
    await rerender({ answer: [2, 0, 1] });
    expect(getAllByRole('button').map(shown), lang).toEqual(['Star', 'Sun', 'Moon']);
    // Busy: disabled, no selection.
    await rerender({ busy: true });
    await fireEvent.click(at(getAllByRole('button'), 0));
    expect(getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled && b.getAttribute('aria-pressed') === 'false'), lang).toBe(true);
    unmount();
  }
  const { queryAllByRole } = render(OrderPuzzle, props({ params: { pieces: ['only'] }, answer: [0] }));
  expect(queryAllByRole('button')).toEqual([]);
});

test('order: each slot shows its piece glyph beside the name', async () => {
  for (const lang of LANGS) {
    const { getAllByRole, rerender, unmount } = render(OrderPuzzle, props({ params: { pieces: PIECES }, answer: [0, 1, 2], item, lang }));
    /** Each slot's glyph path, or null without one; every glyph is hidden from assistive technology. */
    const glyphs = (): Array<string | null> =>
      getAllByRole('button').map((b) => b.querySelector('svg.glyph[aria-hidden="true"] path')?.getAttribute('d') ?? null);
    // K46: the piece's world glyph is drawn beside its name; the button's name stays the item name.
    expect(glyphs(), lang).toEqual([GLYPH_PATHS.sun, GLYPH_PATHS.moon, GLYPH_PATHS.star]);
    expect(getAllByRole('button').map(shown), lang).toEqual(['Sun', 'Moon', 'Star']);
    expect(getAllByRole('button', { name: 'Moon' }), lang).toHaveLength(1);
    // The glyphs follow the arrangement (the answer prop), not the piece list.
    await rerender({ answer: [2, 0, 1] });
    expect(glyphs(), lang).toEqual([GLYPH_PATHS.star, GLYPH_PATHS.sun, GLYPH_PATHS.moon]);
    unmount();
  }
  // A piece the world does not name: its id, and no glyph.
  const { getAllByRole } = render(OrderPuzzle, props({ params: { pieces: ['medal_sun', 'stray'] }, answer: [0, 1], item }));
  expect(getAllByRole('button').map((b) => [shown(b), b.querySelector('svg') !== null])).toEqual([
    ['Sun', true],
    ['stray', false],
  ]);
});

/**
 * A raw params literal through its type's own `decodeParams`: what the world decoder hands the frame (B3; world/decode.ts
 * `typedParams`), so a device is rendered from the decoder's output, never only from a source literal.
 */
function decoded(type: PuzzleType, raw: unknown): unknown {
  const data: PuzzleTypeData<string, unknown> = PUZZLE_RULES[type];
  const r = data.decodeParams(raw);
  if (!r.ok) {
    throw new Error(`invariant: the ${type} fixture decodes: ${r.error}`);
  }
  return r.value;
}

/** Two levers of 3 positions, lever 0 moving lever 1 too; rects inside the safe frame and the device band (A6). */
const LEVERS_RAW = { parts: 2, positions: 3, couples: [[1], []], target: [2, 1], rects: [[100, 800, 200, 300], [600, 800, 150, 150]] };
/** Three knobs of 10 positions and the pull. */
const SETTING_RAW = { parts: 3, positions: 10, rects: [[80, 800, 150, 150], [310, 800, 150, 150], [540, 800, 150, 150]], pull: [400, 1500, 300, 150] };

/** Per type: params and an answer that render its parts, and how many parts they render (a type without one is a tsc
 *  error, so a new type UI is held to the marker rule from its first commit). */
const PART_FIXTURES: { readonly [T in PuzzleType]: { readonly params: unknown; readonly answer: readonly number[]; readonly parts: number } } = {
  code: { params: { dials: 4 }, answer: [0, 0, 0, 0], parts: 4 },
  order: { params: { pieces: PIECES }, answer: [0, 1, 2], parts: 3 },
  // A blocked cell is a part too: every cell, in row-major order.
  path: { params: { cols: 3, rows: 2, ends: [0, 3], blocked: [4] }, answer: [0, 1], parts: 6 },
  // Every cell is a part, a given one too, cell-major; no palette button is.
  grid: { params: { rows: 2, cols: 3, symbols: 3, given: [1, 2, 0, 0, 0, 1] }, answer: [1, 2, 0, 0, 0, 1], parts: 6 },
  // Each lever is a part; each knob is, and the pull is none (D3: no position of the answer).
  levers: { params: decoded('levers', LEVERS_RAW), answer: [0, 0], parts: 2 },
  setting: { params: decoded('setting', SETTING_RAW), answer: [0, 0, 0], parts: 3 },
};

test('puzzles: every type UI marks its parts', async () => {
  // Engine plan §8.5 "Cue targets" (`part`): `puzzle:input` with index i lands on `[data-cue-part="i"]`, one per part.
  const types = Object.keys(PUZZLE_UI) as PuzzleType[];
  expect(types.sort()).toEqual(Object.keys(PART_FIXTURES).sort());
  for (const type of types) {
    const ui = await PUZZLE_UI[type]();
    if (!ui.ok) {
      throw new Error(`expected the ${type} chunk to load: ${ui.error.detail}`);
    }
    const f = PART_FIXTURES[type];
    const { container, unmount } = render(ui.value, props({ params: f.params, answer: f.answer, item }));
    const marks = [...container.querySelectorAll('[data-cue-part]')].map((el) => el.getAttribute('data-cue-part'));
    expect(marks, type).toEqual(Array.from({ length: f.parts }, (_, i) => String(i)));
    unmount();
  }
});

/**
 * Per registered type, the part a `puzzle:input` index names (RULINGS 384 D4; GM8h2 D9): `'position'` for a
 * configuration that starts full-length (a dial, a slot, a cell), `'value'` for an answer that starts empty (a press
 * list, a path: the index is the part pressed or drawn). yields reads the kind from the start (`initial()` empty: by
 * value), so a type declares its kind here (a missing entry is a tsc error) and a start that disagrees fails below.
 */
const INDEX_KINDS: { readonly [T in PuzzleType]: 'position' | 'value' } = {
  code: 'position',
  order: 'position',
  path: 'value',
  grid: 'position',
  levers: 'position',
  setting: 'position',
};

test('puzzles: every registered type declares its index kind and its start gives that kind', () => {
  const registered: PuzzleTypes = PUZZLE_TYPES;
  const kinds: Readonly<Record<string, 'position' | 'value'>> = INDEX_KINDS;
  const fixtures: Readonly<Record<string, { readonly params: unknown }>> = PART_FIXTURES;
  // Every registered type has an entry, and the table names no other.
  expect(registered.map((r) => r.type).sort()).toEqual(Object.keys(kinds).sort());
  // yields' derivation on the instance it reads, built from the params that render the type's parts.
  const derived = registered.map((r) => {
    const p = r.decodeParams(fixtures[r.type]?.params);
    const instance = p.ok ? puzzleInstance({ type: r.type, params: p.value }) : null;
    return [r.type, instance === null ? 'no instance' : instance.initial().length === 0 ? 'value' : 'position'];
  });
  expect(derived).toEqual(registered.map((r) => [r.type, kinds[r.type]]));
});

test('registry: each type loads its own component', async () => {
  const code = await loadPuzzleUi('code');
  const order = await loadPuzzleUi('order');
  const path = await loadPuzzleUi('path');
  const grid = await loadPuzzleUi('grid');
  const levers = await loadPuzzleUi('levers');
  const setting = await loadPuzzleUi('setting');
  if (!code.ok || !order.ok || !path.ok || !grid.ok || !levers.ok || !setting.ok) {
    throw new Error(`expected every chunk to load: ${JSON.stringify([code, order, path, grid, levers, setting])}`);
  }
  expect(code.value).toBe(CodeLock);
  expect(order.value).toBe(OrderPuzzle);
  expect(path.value).toBe(PathPuzzle);
  expect(grid.value).toBe(GridPuzzle);
  // The two devices share one component, so one chunk.
  expect(levers.value).toBe(LeverDevice);
  expect(setting.value).toBe(LeverDevice);
  const lock = render(code.value, props({ params: { dials: 3 }, answer: [0, 0, 0] }));
  expect(lock.getAllByRole('button', { name: t('en', 'puzzle.dial_up') })).toHaveLength(3);
  lock.unmount();
  const slots = render(order.value, props({ params: { pieces: PIECES }, answer: [0, 1, 2], item }));
  expect(slots.getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
  slots.unmount();
  const line = render(path.value, props({ params: { cols: 3, rows: 2, ends: [0, 3], blocked: [] }, answer: [0] }));
  expect(line.getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
  line.unmount();
  // A grid's cells, the given one disabled, and its palette disabled until a cell is selected.
  const board = render(grid.value, props({ params: { rows: 2, cols: 2, symbols: 2, given: [1, 0, 0, 0] }, answer: [1, 0, 0, 0] }));
  const disabled = (cls: string): boolean[] => [...board.container.querySelectorAll<HTMLButtonElement>(`button.${cls}`)].map((b) => b.disabled);
  expect(disabled('cell')).toEqual([true, false, false, false]);
  expect(disabled('symbol')).toEqual([true, true, true]);
});

test('registry: chunk failure is an error value', async () => {
  // A chunk that fails to load (offline, a deploy replaced it): the dynamic import rejects.
  vi.resetModules();
  vi.doMock('./OrderPuzzle.svelte', () => {
    throw new TypeError('Failed to fetch dynamically imported module');
  });
  try {
    const fresh = await import('../registry.ts');
    const r = await fresh.loadPuzzleUi('order');
    expect(r).toMatchObject({ ok: false, error: { kind: 'chunk' } });
    expect(!r.ok && r.error.detail.length > 0).toBe(true);
    // The other type's chunk is unaffected.
    expect((await fresh.loadPuzzleUi('code')).ok).toBe(true);
  } finally {
    vi.doUnmock('./OrderPuzzle.svelte');
    vi.resetModules();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The `path` type UI (engine plan §7.2, §8.3; GM7p D8-D10): the line is the `answer` prop, which follows `onchange` here
// as the session's does; the report is the reach edge's over that prop.

/** 3 x 2, ends 0 and 3: `0 1 2 / 3 4 5`; its one path is 0 1 2 5 4 3. */
const P32 = { cols: 3, rows: 2, ends: [0, 3], blocked: [] };
const P32_SOLVE = [0, 1, 2, 5, 4, 3];

/** PathPuzzle with its `answer` following `onchange` (a `$state` props object, as the frame's); every call recorded. */
// The return type is inferred: it carries the render result's own query types.
function drawn(over: Partial<PuzzleUiProps> = {}) {
  const changes: (readonly number[])[] = [];
  const reports: (readonly number[])[] = [];
  const cues: string[] = [];
  const p: PuzzleUiProps = $state({
    ...props({ params: P32, answer: [] }),
    onchange: (a: readonly number[]) => {
      changes.push([...a]);
      p.answer = a;
    },
    onreach: (c: readonly number[]) => {
      reports.push([...c]);
    },
    oncue: (name: GestureCue, index: number) => {
      cues.push(`${name}@${index}`);
    },
    ...over,
  });
  const view = render(PathPuzzle, p);
  const cell = (i: number): HTMLElement => {
    const el = view.container.querySelector<HTMLElement>(`[data-cue-part="${i}"]`);
    if (el === null) {
      throw new Error(`invariant: cell ${i} is rendered`);
    }
    return el;
  };
  return { p, view, changes, reports, cues, cell };
}

test('path: a reversed path posts its canonical form', async () => {
  // N1: drawn from the higher-index end, the reached line reports its canonical form, once.
  const d = drawn();
  for (const i of [3, 4, 5, 2, 1, 0]) {
    await fireEvent.click(d.cell(i));
  }
  expect(d.changes.at(-1)).toEqual([3, 4, 5, 2, 1, 0]);
  expect(d.reports).toEqual([P32_SOLVE]);
  // Not reported before it reached, and a click that changes nothing adds no report.
  await fireEvent.click(d.cell(0));
  expect(d.reports).toEqual([P32_SOLVE]);
  // Taken back and reached again: one report per turn to reached.
  await fireEvent.click(d.cell(1));
  await fireEvent.click(d.cell(0));
  expect(d.reports).toEqual([P32_SOLVE, P32_SOLVE]);
});

test("path: a cell's keyboard activation steps like a tap", async () => {
  const blocked = { cols: 3, rows: 2, ends: [0, 3], blocked: [4] };
  for (const lang of LANGS) {
    const d = drawn({ params: blocked, answer: [0, 1], lang });
    const buttons = d.view.getAllByRole('button');
    // Every open cell is a button named by its row and column, an end as an end; a blocked cell is none.
    expect(buttons.map((b) => b.getAttribute('aria-label')), lang).toEqual([
      mechT(lang, 'mech.path_end', { r: 1, c: 1 }),
      mechT(lang, 'mech.path_cell', { r: 1, c: 2 }),
      mechT(lang, 'mech.path_cell', { r: 1, c: 3 }),
      mechT(lang, 'mech.path_end', { r: 2, c: 1 }),
      mechT(lang, 'mech.path_cell', { r: 2, c: 3 }),
    ]);
    expect(d.cell(4).tagName, lang).toBe('SPAN');
    expect(d.cell(4).getAttribute('aria-hidden'), lang).toBe('true');
    expect(d.view.getByText(mechT(lang, 'mech.path_rule')), lang).toBeDefined();
    // aria-pressed follows the line.
    const pressed = (): string[] => d.view.getAllByRole('button').map((b) => b.getAttribute('aria-pressed') ?? '');
    expect(pressed(), lang).toEqual(['true', 'true', 'false', 'false', 'false']);
    // A cell's activation is a touch: it extends onto a neighbour of the end, restarts on the other end, takes back
    // the previous cell, and changes nothing elsewhere (past the far end, on a blocked cell).
    await fireEvent.click(d.cell(2));
    expect(d.changes, lang).toEqual([[0, 1, 2]]);
    expect(pressed(), lang).toEqual(['true', 'true', 'true', 'false', 'false']);
    await fireEvent.click(d.cell(3));
    await fireEvent.click(d.cell(0));
    expect(d.changes, lang).toEqual([[0, 1, 2], [3], [3, 0]]);
    await fireEvent.click(d.cell(1));
    await fireEvent.click(d.cell(4));
    expect(d.changes, lang).toHaveLength(3);
    await fireEvent.click(d.cell(3));
    expect(d.changes.at(-1), lang).toEqual([3]);
    // Busy: every cell is disabled and steps nothing.
    d.p.busy = true;
    flushSync();
    expect(d.view.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled), lang).toBe(true);
    await fireEvent.click(d.cell(1));
    expect(d.changes, lang).toHaveLength(4);
    d.view.unmount();
  }
  // Params that do not decode render nothing actionable.
  const { queryAllByRole } = render(PathPuzzle, props({ params: { cols: 1, rows: 2, ends: [0, 1], blocked: [] }, answer: [] }));
  expect(queryAllByRole('button')).toEqual([]);
});

// The stroke (D9, D9a): happy-dom lays nothing out and does no hit testing, so the surface's box is stubbed and the
// pointer events are dispatched on the surface (or a cell, to show the target is never read), bubbling to the mount
// root that Svelte's delegated handlers listen on; happy-dom keeps each element's captured pointer ids.

type PointerKind = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

/**
 * A drawn PathPuzzle's surface with its box stubbed (300 x 200 by default: a 3 x 2 grid of 100 px cells); `rows` sets
 * the row count of the 3-column grid the box holds.
 */
function rig(d: ReturnType<typeof drawn>, box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 300, h: 200 }, rows = 2) {
  const surface = d.view.container.querySelector<HTMLElement>('[data-cue-gesture="path-stroke"]');
  if (surface === null) {
    throw new Error('invariant: the stroke surface is rendered');
  }
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(box.x, box.y, box.w, box.h));
  /** Cell `c`'s centre in the stubbed box of the 3-column grid. */
  const centre = (c: number): { clientX: number; clientY: number } => ({
    clientX: box.x + ((c % 3) + 0.5) * (box.w / 3),
    clientY: box.y + (Math.floor(c / 3) + 0.5) * (box.h / rows),
  });
  /** One pointer event at cell `c`'s centre (or where `init` says), from pointer `id`, then Svelte's flush. */
  const at = (type: PointerKind, c: number, id = 1, init: PointerEventInit = {}, on: Element = surface): void => {
    on.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, ...centre(c), ...init }));
    flushSync();
  };
  /** The cancel as the user agent delivers it: `pointercancel`, then the capture's implicit release (§4.1.3.3). */
  const cancel = (c: number, id = 1): void => {
    at('pointercancel', c, id);
    surface.releasePointerCapture(id);
  };
  return { surface, at, cancel };
}

test('path: a stroke that reaches the end reports once', () => {
  // N2: one stroke over every cell reports the canonical form once; moves inside the end cell add nothing.
  const d = drawn();
  const s = rig(d);
  s.at('pointerdown', 0);
  for (const c of [1, 2, 5, 4, 3]) {
    s.at('pointermove', c);
  }
  expect(d.changes.at(-1)).toEqual(P32_SOLVE);
  expect(d.reports).toEqual([P32_SOLVE]);
  s.at('pointermove', 3, 1, { clientX: 20, clientY: 180 });
  s.at('pointermove', 3, 1, { clientX: 80, clientY: 120 });
  expect(d.reports).toEqual([P32_SOLVE]);
  // Back to 4 and in again to 3: a new turn to reached, reported again.
  s.at('pointermove', 4);
  s.at('pointermove', 3);
  s.at('pointerup', 3);
  expect(d.changes.slice(-2)).toEqual([[0, 1, 2, 5, 4], P32_SOLVE]);
  expect(d.reports).toEqual([P32_SOLVE, P32_SOLVE]);
  // A reached line re-delivered reports nothing again: the report is the edge's, not the effect's re-run. An equal copy
  // of the answer (a frame replaced around it, as yields' setFrame does), then params that decode to a new grid.
  d.p.answer = [...P32_SOLVE];
  flushSync();
  expect(d.reports).toEqual([P32_SOLVE, P32_SOLVE]);
  d.p.params = { ...P32 };
  flushSync();
  expect(d.reports).toEqual([P32_SOLVE, P32_SOLVE]);
});

test("path: a stroke starts only on the path's end or an end cell", () => {
  const d = drawn();
  const s = rig(d);
  // An empty path: a down on a cell that is no end starts nothing, and its moves draw nothing.
  s.at('pointerdown', 1);
  s.at('pointermove', 2);
  s.at('pointerup', 2);
  expect([d.changes, d.cues, s.surface.hasPointerCapture(1)]).toEqual([[], [], false]);
  // A mouse's other buttons start nothing either; its primary button does.
  s.at('pointerdown', 0, 1, { pointerType: 'mouse', button: 2 });
  expect([d.changes, s.surface.hasPointerCapture(1)]).toEqual([[], false]);
  s.at('pointerdown', 0, 1, { pointerType: 'mouse', button: 0 });
  s.at('pointermove', 1, 1, { pointerType: 'mouse', button: 0 });
  s.at('pointerup', 1, 1, { pointerType: 'mouse', button: 0 });
  expect(d.changes).toEqual([[0], [0, 1]]);
  // A down on the line's end starts a stroke that steps nothing until it moves; on the other end it restarts there.
  s.at('pointerdown', 1);
  expect([d.changes.length, s.surface.hasPointerCapture(1)]).toEqual([2, true]);
  s.at('pointerup', 1);
  s.at('pointerdown', 3);
  s.at('pointermove', 4);
  s.at('pointerup', 4);
  expect(d.changes.slice(-2)).toEqual([[3], [3, 4]]);
  // A mismatch resets the prop mid-stroke (yields' reset to the start answer): the stroke draws nothing more.
  s.at('pointerdown', 4);
  d.p.answer = [];
  flushSync();
  s.at('pointermove', 5);
  s.at('pointermove', 2);
  s.at('pointerup', 2);
  expect(d.changes).toHaveLength(4);
});

test('path: a stroke back onto the previous cell takes the last cell back', () => {
  const d = drawn();
  const s = rig(d);
  s.at('pointerdown', 0);
  s.at('pointermove', 1);
  s.at('pointermove', 2);
  s.at('pointermove', 1);
  expect(d.changes).toEqual([[0], [0, 1], [0, 1, 2], [0, 1]]);
  // The step's cue lands at the cell entered.
  expect(d.cues).toEqual(['path-stroke@0', 'path-stroke@1', 'path-stroke@2', 'path-stroke@1']);
});

test('path: a move across cells enters each cell it crosses', () => {
  const d = drawn();
  const s = rig(d);
  s.at('pointerdown', 0);
  // One fast move from cell 0's centre to cell 2's: both cells entered, one cue each, one onchange.
  s.at('pointermove', 2);
  expect(d.changes).toEqual([[0], [0, 1, 2]]);
  expect(d.cues).toEqual(['path-stroke@0', 'path-stroke@1', 'path-stroke@2']);
  // Back the same way: each cell crossed is a step through advance, here two steps back, still one onchange.
  s.at('pointermove', 0);
  expect(d.changes).toEqual([[0], [0, 1, 2], [0]]);
  expect(d.cues.slice(3)).toEqual(['path-stroke@1', 'path-stroke@0']);
});

test('path: a stroke that leaves the grid continues when it returns', () => {
  const d = drawn();
  const s = rig(d);
  s.at('pointerdown', 0);
  s.at('pointermove', 0, 1, { clientX: -50, clientY: 50 });
  s.at('pointermove', 0, 1, { clientX: -80, clientY: 260 });
  expect([d.changes, s.surface.hasPointerCapture(1)]).toEqual([[[0]], true]);
  s.at('pointermove', 1);
  expect(d.changes).toEqual([[0], [0, 1]]);
});

test('path: a cancelled stroke keeps its cells and the next starts from the end', () => {
  // Script B (08b:172-173), ids 1 then 2: down 0, move 1, cancel, down 1, move 2, up gives [0, 1, 2].
  const d = drawn();
  const s = rig(d);
  s.at('pointerdown', 0, 1);
  expect(s.surface.hasPointerCapture(1)).toBe(true);
  s.at('pointermove', 1, 1);
  // A second pointer while the stroke is live: refused, no capture.
  s.at('pointerdown', 4, 2);
  expect([d.changes, s.surface.hasPointerCapture(2)]).toEqual([[[0], [0, 1]], false]);
  // The cancel: the stroke ends by the release, the drawn cells stay and nothing posts.
  s.cancel(1, 1);
  expect([s.surface.hasPointerCapture(1), d.changes.length, d.reports]).toEqual([false, 2, []]);
  // The cancelled pointer moves on (a mouse or a pen in range keeps its id): without the capture it steps nothing.
  s.at('pointermove', 2, 1);
  expect([d.changes.length, d.cues.length]).toEqual([2, 2]);
  s.at('pointerdown', 1, 2);
  s.at('pointermove', 2, 2);
  s.at('pointerup', 2, 2);
  expect(d.changes.at(-1)).toEqual([0, 1, 2]);
  expect(d.cues).toEqual(['path-stroke@0', 'path-stroke@1', 'path-stroke@2']);
  expect(s.surface.hasPointerCapture(2)).toBe(false);
  // O1: an id recycled after a cancel, its new down under implicit capture (§9.4), restarts the stroke: the down steps.
  s.at('pointerdown', 2, 3);
  s.cancel(2, 3);
  s.surface.setPointerCapture(3);
  s.at('pointerdown', 1, 3);
  expect(d.changes.at(-1)).toEqual([0, 1]);
  expect(d.cues.at(-1)).toBe('path-stroke@1');
  // D9a: no listener for an event Svelte does not delegate (its runtime would join the entry chunk).
  expect(pathSource).not.toMatch(/\bon(?:pointercancel|lostpointercapture|gotpointercapture|pointerleave|pointerenter|pointerout|pointerover)\s*=/);
});

test('path: a second pointer is ignored while a stroke is live', () => {
  const d = drawn();
  const s = rig(d);
  s.at('pointerdown', 0, 1);
  s.at('pointermove', 1, 1);
  // The control: the first pointer's stroke draws.
  expect(d.changes).toEqual([[0], [0, 1]]);
  // A second finger: no capture, and neither its down nor its moves step.
  s.at('pointerdown', 4, 2);
  s.at('pointermove', 2, 2);
  s.at('pointermove', 5, 2);
  s.at('pointerup', 5, 2);
  expect([d.changes, s.surface.hasPointerCapture(2), s.surface.hasPointerCapture(1)]).toEqual([[[0], [0, 1]], false, true]);
  // The first stroke goes on.
  s.at('pointermove', 2, 1);
  expect(d.changes.at(-1)).toEqual([0, 1, 2]);
});

test('path: input while busy changes nothing', () => {
  const d = drawn({ busy: true });
  const s = rig(d);
  s.at('pointerdown', 0);
  s.at('pointermove', 1);
  s.at('pointerup', 1);
  expect([d.changes, d.cues, s.surface.hasPointerCapture(1)]).toEqual([[], [], false]);
  // The control: the same input, not busy, steps and captures.
  d.p.busy = false;
  flushSync();
  s.at('pointerdown', 0);
  expect([d.changes, d.cues, s.surface.hasPointerCapture(1)]).toEqual([[[0]], ['path-stroke@0'], true]);
  // Busy mid-stroke: moves step nothing, and an up still ends the stroke.
  d.p.busy = true;
  flushSync();
  s.at('pointermove', 1);
  s.at('pointerup', 1);
  expect([d.changes, s.surface.hasPointerCapture(1)]).toEqual([[[0]], false]);
});

test('path: a tap steps once and its click adds nothing', () => {
  const d = drawn({ answer: [0] });
  const s = rig(d);
  // A tap next to the end: down and up with no move, one step through the down's touch.
  s.at('pointerdown', 1);
  s.at('pointerup', 1);
  expect([d.changes, d.cues]).toEqual([[[0, 1]], ['path-stroke@1']]);
  // Its click lands on the surface (the cells take no pointer events): nothing more.
  s.surface.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 150, clientY: 50 }));
  flushSync();
  expect([d.changes, d.cues]).toEqual([[[0, 1]], ['path-stroke@1']]);
  // CQ-c, read from the source (happy-dom does no hit testing): no pointer event targets a cell.
  expect(declarationsFor(pathSource, 'cell').get('pointer-events')).toBe('none');
});

test("path: the cell under the pointer comes from the surface's box", () => {
  // The column below 360 px is `transform: scale` (RULINGS 242): the box at half scale, offset, maps the same cells.
  const d = drawn();
  const s = rig(d, { x: 10, y: 20, w: 150, h: 100 });
  s.at('pointerdown', 0);
  expect(d.changes).toEqual([[0]]);
  // A move whose target is cell 4 but whose point is in cell 1: the point decides.
  s.at('pointermove', 1, 1, {}, d.cell(4));
  expect(d.changes).toEqual([[0], [0, 1]]);
  // A collapsed box gives no point: a move then steps nothing, and the stroke goes on from its last point.
  vi.spyOn(s.surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 0, 0));
  s.at('pointermove', 0);
  expect([d.changes.length, d.cues.length]).toEqual([2, 2]);
  vi.spyOn(s.surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 150, 100));
  s.at('pointermove', 2);
  expect(d.changes.at(-1)).toEqual([0, 1, 2]);
  // The box arithmetic assumes the surface's box is the grid's: no padding and no border on it.
  const box = declarationsFor(pathSource, 'surface');
  expect([box.get('padding'), box.get('border'), box.get('gap')]).toEqual(['0', '0', '0']);
});

test('path: the stroke surface selects no text', () => {
  // F-1 (RULINGS 350): a mouse stroke would leave a text selection, and Chromium turns the next stroke that goes down
  // inside it into a native drag of that selection, which cancels the pointer (`pointercancel`): about every second
  // stroke of a line drawn in several would do nothing on Telegram Desktop and Web. happy-dom has neither selection nor
  // drag-and-drop, so the pin reads the source; the pre-merge lens reproduced the cancel, and its absence with these two
  // declarations, in a real browser.
  const surface = declarationsFor(pathSource, 'surface');
  expect([surface.get('-webkit-user-select'), surface.get('user-select')]).toEqual(['none', 'none']);
});

test('path: a step that changes nothing calls no onchange', () => {
  const d = drawn({ answer: [0, 1] });
  const s = rig(d);
  // V2: a down on the end, a move inside its cell, and a click on the end change nothing and call nothing.
  s.at('pointerdown', 1);
  s.at('pointermove', 1, 1, { clientX: 120, clientY: 30 });
  s.at('pointermove', 1, 1, { clientX: 180, clientY: 70 });
  d.cell(1).click();
  flushSync();
  expect([d.changes, d.cues]).toEqual([[], []]);
  // The control: a step that changes the line calls onchange once.
  s.at('pointermove', 2);
  expect(d.changes).toEqual([[0, 1, 2]]);
  d.view.unmount();

  // V2 holds per event, not only per step: a move whose steps cancel out (back onto the previous cell, then in again)
  // leaves a line equal to the prop and calls nothing. B: one stroke over a 3 x 3 grid (ends 0 and 8) from an empty
  // path reaches the far end early; the moves to 7 and 4 are refused by the far-end stop, and the move from 4's centre
  // to 8's crosses 5 (back) and 8 (in again).
  const b = drawn({ params: { cols: 3, rows: 3, ends: [0, 8], blocked: [] }, answer: [] });
  const sb = rig(b, { x: 0, y: 0, w: 300, h: 300 }, 3);
  sb.at('pointerdown', 0);
  for (const c of [3, 4, 5, 8]) {
    sb.at('pointermove', c);
  }
  expect(b.changes.at(-1)).toEqual([0, 3, 4, 5, 8]);
  const drawnB = b.changes.length;
  for (const c of [7, 4, 8]) {
    sb.at('pointermove', c);
  }
  sb.at('pointerup', 8);
  expect(b.changes.slice(drawnB)).toEqual([]);
  b.view.unmount();
  // A: the same from a reached line (D3's reached -> reached): from the end 3, the moves to 0, 2 and 5 are refused, and
  // the move back to 3 crosses 4 (back) and 3 (in again).
  const a = drawn({ answer: P32_SOLVE });
  const sa = rig(a);
  sa.at('pointerdown', 3);
  for (const c of [0, 2, 5, 3]) {
    sa.at('pointermove', c);
  }
  expect(a.changes).toEqual([]);
  // The control: the stroke is still live, and a move back to 4 changes the line.
  sa.at('pointermove', 4);
  expect(a.changes).toEqual([[0, 1, 2, 5, 4]]);
  a.view.unmount();
  // An equal length is no equal line: from [3, 4, 1, 2] one move from 2's centre to 0's takes 2 back and enters 0.
  const e = drawn({ answer: [3, 4, 1, 2] });
  const se = rig(e);
  se.at('pointerdown', 2);
  se.at('pointermove', 0);
  expect(e.changes).toEqual([[3, 4, 1, 0]]);
});

test('path: a pointer event after unmount reports nothing', () => {
  const d = drawn();
  const s = rig(d);
  s.at('pointerdown', 0);
  // The control: a move before unmount draws.
  s.at('pointermove', 1);
  expect(d.changes).toEqual([[0], [0, 1]]);
  d.view.unmount();
  // O-a: every handler is delegated to the mount root, which a detached surface's events never reach.
  s.at('pointermove', 2);
  s.at('pointermove', 5);
  s.at('pointerup', 5);
  s.at('pointercancel', 5);
  expect([d.changes, d.cues, d.reports]).toEqual([[[0], [0, 1]], ['path-stroke@0', 'path-stroke@1'], []]);
});

test("path: each cell's cue index is its cell", () => {
  // GM8h2 D17 (the twin of grid's Gates F3 row): a cell's activation emits a `ui` cue whose index is the element's
  // `data-cue-index`, so each open cell's index is its cell, its part, as rendered; a blocked cell is no button.
  const d = drawn({ params: { cols: 3, rows: 2, ends: [0, 3], blocked: [4] } });
  const marks = [...d.view.container.querySelectorAll('button.cell')].map((b) => [b.getAttribute('data-cue'), b.getAttribute('data-cue-part'), b.getAttribute('data-cue-index')]);
  expect(marks).toEqual([0, 1, 2, 3, 5].map((i) => ['path-cell', String(i), String(i)]));
});

test('path: a long-press on the stroke surface opens no callout', () => {
  // GM8h2 D14 (M7): iOS opens its callout on a long-press, and a stroke that starts with a hold would lose its pointer
  // to it. Every pointer lands on the surface (the cells take none); happy-dom has no callout, so the pin reads the source.
  expect(declarationsFor(pathSource, 'surface').get('-webkit-touch-callout')).toBe('none');
});

test("path: the drawn line, its tint and the surface's label", () => {
  // D8 as built, on a grid that is not square so a mix-up of rows and columns shows: the line runs through the drawn
  // cells' centres in grid units (column, then row), each drawn cell carries the tint, and the surface is named by the
  // rule line its aria-labelledby points at.
  const d = drawn({ answer: [0, 1, 4] });
  expect(d.view.container.querySelector('polyline')?.getAttribute('points')).toBe('0.5,0.5 1.5,0.5 1.5,1.5');
  expect([0, 1, 2, 3, 4, 5].map((i) => d.cell(i).classList.contains('drawn'))).toEqual([true, true, false, false, true, false]);
  const surface = d.view.container.querySelector('[data-cue-gesture="path-stroke"]');
  const label = surface?.getAttribute('aria-labelledby') ?? '';
  expect(d.view.container.querySelector(`[id="${label}"]`)?.textContent).toBe(mechT(d.p.lang, 'mech.path_rule'));
});

// The refusals (GM8h2 D7): a cell a step cannot take goes to `onblocked` (yields plays `puzzle:blocked` on it). On P32's
// reached line (end 3), every cell but 4 (the back-step) and 3 (the end) is refused.

/** A drawn PathPuzzle whose `onblocked` records the refused parts. */
function refusing(over: Partial<PuzzleUiProps> = {}) {
  const blocked: number[] = [];
  const d = drawn({ onblocked: (part: number) => blocked.push(part), ...over });
  return { ...d, blocked };
}

test('path: a drag across refused cells reports once', () => {
  // A live stroke from the reached line's end through three refused cells: one report, its first refused cell.
  const d = refusing({ answer: P32_SOLVE });
  const s = rig(d);
  s.at('pointerdown', 3);
  for (const c of [0, 1, 2]) {
    s.at('pointermove', c);
  }
  s.at('pointerup', 2);
  expect([d.blocked, d.changes]).toEqual([[0], []]);
});

test('path: a refusal after a step reports again', () => {
  // Refused (0), the line's end entered again (3: no refusal), a back-step (4), refused again (1, already held).
  const d = refusing({ answer: P32_SOLVE });
  const s = rig(d);
  s.at('pointerdown', 3);
  for (const c of [0, 3, 4, 1]) {
    s.at('pointermove', c);
  }
  expect([d.blocked, d.changes]).toEqual([[0, 1], [[0, 1, 2, 5, 4]]]);
});

test('path: each stroke reports its own refusal', () => {
  // RULINGS 380 B6: the flag is the pointer's, reset at its down: two live strokes, each crossing a refused cell, two
  // reports.
  const d = refusing({ answer: P32_SOLVE });
  const s = rig(d);
  for (const stroke of [1, 2]) {
    s.at('pointerdown', 3, stroke);
    s.at('pointermove', 0, stroke);
    s.at('pointerup', 0, stroke);
  }
  expect([d.blocked, d.changes]).toEqual([[0, 0], []]);
});

test('path: each refused tap reports', () => {
  // A refused down starts no stroke and reports once, as a tap on a refused cell; the next tap reports its own.
  const d = refusing({ answer: [0] });
  const s = rig(d);
  for (const c of [5, 4]) {
    s.at('pointerdown', c);
    s.at('pointerup', c);
  }
  expect([d.blocked, d.changes, s.surface.hasPointerCapture(1)]).toEqual([[5, 4], [], false]);
});

test('path: each refused press reports', async () => {
  // A cell's own activation (a keyboard or an assistive press) is one input each: two presses, two reports.
  const d = refusing({ answer: [0] });
  await fireEvent.click(d.cell(5));
  await fireEvent.click(d.cell(5));
  expect([d.blocked, d.changes]).toEqual([[5, 5], []]);
});

test('path: a busy input reports no refusal', async () => {
  // A live stroke, then busy: its move into a refused cell, a down on a refused cell and a press report nothing.
  const d = refusing({ answer: P32_SOLVE });
  const s = rig(d);
  s.at('pointerdown', 3);
  d.p.busy = true;
  flushSync();
  s.at('pointermove', 0);
  s.at('pointerup', 0);
  s.at('pointerdown', 1);
  s.at('pointerup', 1);
  await fireEvent.click(d.cell(1));
  expect([d.blocked, d.changes]).toEqual([[], []]);
});

test("path: the line's end is no refusal", async () => {
  // RULINGS 377 A10 (Notes 8): the finger on the line's end is no refusal: a down on it starts a stroke, a press on it
  // changes nothing; neither reports.
  const d = refusing({ answer: [0, 1] });
  const s = rig(d);
  s.at('pointerdown', 1);
  expect(s.surface.hasPointerCapture(1)).toBe(true);
  s.at('pointerup', 1);
  await fireEvent.click(d.cell(1));
  expect([d.blocked, d.changes]).toEqual([[], []]);
});

// ---------------------------------------------------------------------------------------------------------------
// The `grid` type UI (engine plan §7.2; GM7g D5-D7): a tap selects a free cell, a palette tap places a symbol on it
// (Clear is 0); the fill is the `answer` prop, which follows `onchange` here as the session's does; the report is the
// reach edge's over that prop.

/** 2 x 2 over 2 symbols, cell 0 given 1: its one fill is 1 2 / 2 1. */
const G22 = { rows: 2, cols: 2, symbols: 2, given: [1, 0, 0, 0] };
const G22_FILL = [1, 2, 2, 1];

/** 2 rows x 3 columns over 3 symbols, cells 0, 1 and 5 given: not square, so a swap of rows and columns shows. */
const G23 = { rows: 2, cols: 3, symbols: 3, given: [1, 2, 0, 0, 0, 1] };

/**
 * GridPuzzle with its `answer` following `onchange` (a `$state` props object, as the frame's); every call recorded
 * with the prop it was made against.
 */
// The return type is inferred: it carries the render result's own query types.
function filled(over: Partial<PuzzleUiProps> = {}) {
  const changes: (readonly number[])[] = [];
  const priors: (readonly number[])[] = [];
  const reports: (readonly number[])[] = [];
  const p: PuzzleUiProps = $state({
    ...props({ params: G22, answer: [1, 0, 0, 0] }),
    onchange: (a: readonly number[]) => {
      priors.push([...p.answer]);
      changes.push([...a]);
      p.answer = a;
    },
    onreach: (c: readonly number[]) => {
      reports.push([...c]);
    },
    ...over,
  });
  const view = render(GridPuzzle, p);
  const button = (selector: string): HTMLButtonElement => {
    const el = view.container.querySelector<HTMLButtonElement>(selector);
    if (el === null) {
      throw new Error(`invariant: ${selector} is rendered`);
    }
    return el;
  };
  const cell = (i: number): HTMLButtonElement => button(`button.cell[data-cue-part="${i}"]`);
  const symbol = (v: number): HTMLButtonElement => button(`button.symbol[data-cue-index="${v}"]`);
  return { p, view, changes, priors, reports, cell, symbol };
}

test('grid: a fill that reaches reports once', async () => {
  const d = filled();
  for (const [c, v] of [
    [1, 2],
    [2, 2],
    [3, 1],
  ] as const) {
    await fireEvent.click(d.cell(c));
    await fireEvent.click(d.symbol(v));
  }
  expect(d.changes).toEqual([[1, 2, 0, 0], [1, 2, 2, 0], G22_FILL]);
  expect(d.reports).toEqual([G22_FILL]);
  // A reached fill re-delivered reports nothing again: the report is the edge's, not the effect's re-run (an equal copy
  // of the answer, as a frame replaced around it gives).
  d.p.answer = [...G22_FILL];
  flushSync();
  expect(d.reports).toEqual([G22_FILL]);
  // Cleared and filled again (cell 3 stays selected): one report per turn to reached.
  await fireEvent.click(d.symbol(0));
  await fireEvent.click(d.symbol(1));
  expect(d.changes.slice(-2)).toEqual([[1, 2, 2, 0], G22_FILL]);
  expect(d.reports).toEqual([G22_FILL, G22_FILL]);
  // O-a: every handler is delegated to the mount root, so a kept element's click after unmount calls nothing.
  const kept = [d.cell(1), d.symbol(2)];
  d.view.unmount();
  for (const el of kept) {
    el.click();
  }
  flushSync();
  expect([d.changes.length, d.reports.length]).toEqual([5, 2]);
});

test("grid: a cell's keyboard activation selects like a tap", () => {
  for (const lang of LANGS) {
    const d = filled({ answer: [1, 2, 0, 0], lang });
    // Every cell is a button named by its row, its column and what it holds; a given one says so.
    expect([0, 1, 2, 3].map((i) => d.cell(i).getAttribute('aria-label')), lang).toEqual([
      mechT(lang, 'mech.grid_given', { r: 1, c: 1, n: 1 }),
      mechT(lang, 'mech.grid_cell', { r: 1, c: 2, n: 2 }),
      mechT(lang, 'mech.grid_empty', { r: 2, c: 1 }),
      mechT(lang, 'mech.grid_empty', { r: 2, c: 2 }),
    ]);
    expect([0, 1, 2, 3].map((i) => shown(d.cell(i))), lang).toEqual(['1', '2', '', '']);
    // The palette: Clear (its mark hidden), then each symbol by its numeral.
    expect(d.view.getByRole('button', { name: mechT(lang, 'mech.grid_clear') }), lang).toBe(d.symbol(0));
    expect(d.symbol(0).querySelector('[aria-hidden="true"]'), lang).not.toBeNull();
    expect([1, 2].map((v) => d.view.getByRole('button', { name: String(v) })), lang).toEqual([d.symbol(1), d.symbol(2)]);
    // The board is named by the rule line its aria-labelledby points at.
    const board = d.view.container.querySelector('.board');
    const label = board?.getAttribute('aria-labelledby') ?? '';
    expect(d.view.container.querySelector(`[id="${label}"]`)?.textContent, lang).toBe(mechT(lang, 'mech.grid_rule'));
    // A cell's own activation (a keyboard or an assistive press: a click with no pointer) selects; aria-pressed follows.
    const pressed = (): string[] => [0, 1, 2, 3].map((i) => d.cell(i).getAttribute('aria-pressed') ?? '');
    expect(pressed(), lang).toEqual(['false', 'false', 'false', 'false']);
    d.cell(2).click();
    flushSync();
    expect(pressed(), lang).toEqual(['false', 'false', 'true', 'false']);
    expect([0, 1, 2].map((v) => d.symbol(v).disabled), lang).toEqual([false, false, false]);
    // A symbol's activation places it and the cell stays selected; a second activation of the cell deselects it.
    d.symbol(1).click();
    flushSync();
    expect(d.changes, lang).toEqual([[1, 2, 1, 0]]);
    expect(pressed(), lang).toEqual(['false', 'false', 'true', 'false']);
    d.cell(2).click();
    flushSync();
    expect(pressed(), lang).toEqual(['false', 'false', 'false', 'false']);
    expect([0, 1, 2].map((v) => d.symbol(v).disabled), lang).toEqual([true, true, true]);
    // Another cell takes the selection over.
    d.cell(3).click();
    d.cell(1).click();
    flushSync();
    expect(pressed(), lang).toEqual(['false', 'true', 'false', 'false']);
    d.view.unmount();
  }
  // Params that do not decode render nothing actionable (fewer symbols than a line holds).
  const { queryAllByRole } = render(GridPuzzle, props({ params: { rows: 2, cols: 2, symbols: 1, given: [0, 0, 0, 0] }, answer: [] }));
  expect(queryAllByRole('button')).toEqual([]);
});

test('grid: a tap that changes nothing calls no onchange', async () => {
  const d = filled({ answer: [1, 2, 0, 0] });
  // V2: a select, a deselect, a select again, the symbol the cell holds, and Clear on an empty cell call nothing.
  await fireEvent.click(d.cell(1));
  await fireEvent.click(d.cell(1));
  await fireEvent.click(d.cell(1));
  await fireEvent.click(d.symbol(2));
  await fireEvent.click(d.cell(2));
  await fireEvent.click(d.symbol(0));
  expect(d.changes).toEqual([]);
  // The control: a symbol that changes the cell calls onchange once.
  await fireEvent.click(d.symbol(1));
  expect(d.changes).toEqual([[1, 2, 1, 0]]);
  // Every call left a fresh answer that differs from the prop it was made against.
  expect(d.changes.every((a, i) => JSON.stringify(a) !== JSON.stringify(d.priors[i]))).toBe(true);
});

test('grid: input while busy changes nothing', async () => {
  const d = filled({ answer: [1, 2, 0, 0] });
  await fireEvent.click(d.cell(2));
  // Busy (an attempt in flight): every cell and symbol is disabled and does nothing; the selection is kept.
  d.p.busy = true;
  flushSync();
  const buttons = d.view.getAllByRole('button') as HTMLButtonElement[];
  expect(buttons).toHaveLength(7);
  expect(buttons.every((b) => b.disabled)).toBe(true);
  for (const b of buttons) {
    await fireEvent.click(b);
  }
  expect(d.changes).toEqual([]);
  expect(d.cell(2).getAttribute('aria-pressed')).toBe('true');
  // The control: no longer busy, the same symbol places.
  d.p.busy = false;
  flushSync();
  await fireEvent.click(d.symbol(1));
  expect(d.changes).toEqual([[1, 2, 1, 0]]);
});

test('grid: a given cell takes no input', async () => {
  for (const lang of LANGS) {
    const d = filled({ lang });
    const given = d.cell(0);
    // A disabled button named as given: a tap on it is refused silently and selects nothing.
    expect(given.disabled, lang).toBe(true);
    expect(given.getAttribute('aria-label'), lang).toBe(mechT(lang, 'mech.grid_given', { r: 1, c: 1, n: 1 }));
    await fireEvent.click(given);
    given.click();
    flushSync();
    expect(given.getAttribute('aria-pressed'), lang).toBe('false');
    expect([0, 1, 2].map((v) => d.symbol(v).disabled), lang).toEqual([true, true, true]);
    await fireEvent.click(d.symbol(2));
    expect(d.changes, lang).toEqual([]);
    // The control: a free cell selects, and the palette opens.
    await fireEvent.click(d.cell(1));
    expect([d.cell(1).getAttribute('aria-pressed'), d.symbol(2).disabled], lang).toEqual(['true', false]);
    d.view.unmount();
  }
});

test('grid: the board selects no text', () => {
  // Stack F-1 by class (RULINGS 350, GM7p's stroke surface): a mouse's double click or drag over the cells or the
  // palette would leave a text selection. happy-dom has no selection, so the pin reads the source; the one wrapper of
  // the cells and the palette carries the class.
  const board = declarationsFor(gridSource, 'board');
  expect([board.get('-webkit-user-select'), board.get('user-select')]).toEqual(['none', 'none']);
  const d = filled();
  const wrappers = d.view.container.querySelectorAll('.board');
  expect(wrappers).toHaveLength(1);
  expect([wrappers[0]?.querySelectorAll('button.cell').length, wrappers[0]?.querySelectorAll('button.symbol').length]).toEqual([4, 3]);
});

test('grid: a long-press on a cell or a symbol opens no callout', () => {
  // GM8h2 D14 (M7): on the buttons themselves, the long-press's targets, not by inheritance from the board.
  expect(['cell', 'symbol'].map((cls) => declarationsFor(gridSource, cls).get('-webkit-touch-callout'))).toEqual(['none', 'none']);
});

test('grid: cells and symbols at least 48 px', () => {
  // happy-dom computes no layout: the rules are read from the source, and every rendered button carries one of them.
  const d = filled();
  const kinds = d.view.getAllByRole('button').map((b) => (b.classList.contains('cell') ? 'cell' : b.classList.contains('symbol') ? 'symbol' : ''));
  expect(kinds).toEqual(['cell', 'cell', 'cell', 'cell', 'symbol', 'symbol', 'symbol']);
  for (const cls of ['cell', 'symbol']) {
    const rule = declarationsFor(gridSource, cls);
    expect(px(rule.get('min-width')), cls).toBeGreaterThanOrEqual(48);
    expect(px(rule.get('min-height')), cls).toBeGreaterThanOrEqual(48);
  }
});

test('grid: a mismatch reset keeps the selected cell', async () => {
  const d = filled();
  for (const [c, v] of [
    [1, 2],
    [2, 2],
    [3, 1],
  ] as const) {
    await fireEvent.click(d.cell(c));
    await fireEvent.click(d.symbol(v));
  }
  expect(d.reports).toEqual([G22_FILL]);
  // The session's reset to the start answer after a mismatch (session.ts): the givens again, and cell 3 still selected.
  d.p.answer = [1, 0, 0, 0];
  flushSync();
  expect(d.cell(3).getAttribute('aria-pressed')).toBe('true');
  await fireEvent.click(d.symbol(1));
  expect(d.changes.at(-1)).toEqual([1, 0, 0, 1]);
});

test('grid: a grid that is not square names and lays out its cells by row and column', () => {
  // Gates F1 (fix1): every other grid test renders the square G22, where a swap of rows and columns cannot show. On
  // 2 x 3 each cell is named by its own row and column (cell-major, `row * cols + col`), and the cells' track repeats
  // the column count. One filled cell, two empty and three given, so each name key occurs.
  for (const lang of LANGS) {
    const d = filled({ params: G23, answer: [1, 2, 3, 0, 0, 1], lang });
    expect([0, 1, 2, 3, 4, 5].map((i) => d.cell(i).getAttribute('aria-label')), lang).toEqual([
      mechT(lang, 'mech.grid_given', { r: 1, c: 1, n: 1 }),
      mechT(lang, 'mech.grid_given', { r: 1, c: 2, n: 2 }),
      mechT(lang, 'mech.grid_cell', { r: 1, c: 3, n: 3 }),
      mechT(lang, 'mech.grid_empty', { r: 2, c: 1 }),
      mechT(lang, 'mech.grid_empty', { r: 2, c: 2 }),
      mechT(lang, 'mech.grid_given', { r: 2, c: 3, n: 1 }),
    ]);
    const tracks = d.view.container.querySelectorAll<HTMLElement>('.cells');
    expect(tracks, lang).toHaveLength(1);
    expect(tracks[0]?.style.getPropertyValue('grid-template-columns'), lang).toBe('repeat(3, minmax(48px, 1fr))');
    d.view.unmount();
  }
  // The control: the square G22's track repeats its own side, so a count written into the template fails one of the two.
  const square = filled().view.container.querySelector<HTMLElement>('.cells');
  expect(square?.style.getPropertyValue('grid-template-columns')).toBe('repeat(2, minmax(48px, 1fr))');
});

test('grid: the column track and the cell names follow the columns, not the symbols', () => {
  // GM8h2 D17 (grid M1): every other grid fixture has as many symbols as columns, so a swap of the two cannot show. On
  // 2 x 2 with three symbols, the track repeats the column count and cell 2 is row 2, column 1.
  const d = filled({ params: { rows: 2, cols: 2, symbols: 3, given: [0, 0, 0, 0] }, answer: [0, 0, 0, 0] });
  const track = d.view.container.querySelector<HTMLElement>('.cells')?.style.getPropertyValue('grid-template-columns');
  expect([track, d.cell(2).getAttribute('aria-label')]).toEqual(['repeat(2, minmax(48px, 1fr))', mechT(d.p.lang, 'mech.grid_empty', { r: 2, c: 1 })]);
});

test("grid: each cell's cue index is its board index", () => {
  // Gates F3 (fix1): a tap on a cell emits a `ui` cue whose index is the element's `data-cue-index` (cues/root.ts),
  // so each cell's index is its board index, its part (cell-major), as rendered. The given cells count too: the stage
  // keys a cue target by the element, whatever its state.
  const d = filled({ params: G23, answer: [1, 2, 0, 0, 0, 1] });
  const marks = [...d.view.container.querySelectorAll('button.cell')].map((b) => [b.getAttribute('data-cue'), b.getAttribute('data-cue-part'), b.getAttribute('data-cue-index')]);
  expect(marks).toEqual([0, 1, 2, 3, 4, 5].map((i) => ['grid-cell', String(i), String(i)]));
});

// ---------------------------------------------------------------------------------------------------------------
// The devices (engine plan §7.2, §7.5; GM8a D3, D7, D10): `levers` and `setting` share LeverDevice, which tells the
// two apart by the decoder that accepts its params, lays each part on its rect over the room's cover, and reports a
// part's move through `onwork` and the pull through `oncommit`.

const LEVERS = decoded('levers', LEVERS_RAW);
const SETTING = decoded('setting', SETTING_RAW);

/** `el`, or a throw: the element is rendered. */
function must<T>(el: T | null | undefined): T {
  if (el === null || el === undefined) {
    throw new Error('invariant: the element is rendered');
  }
  return el;
}

/** Every button of a rendered device, by its cue name. */
const cuesOf = (root: Element): string[] => [...root.querySelectorAll('button')].map((b) => b.getAttribute('data-cue') ?? '');
/** Every button's accessible name. */
const labelsOf = (root: Element): Array<string | null> => [...root.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

test('levers: the shared device renders the type its params decode as', () => {
  for (const lang of LANGS) {
    // Levers: one lever per part, each named by its number, its position, the positions and its mark; no pull.
    const l = render(LeverDevice, props({ params: LEVERS, answer: [1, 0], lang }));
    expect(cuesOf(l.container), lang).toEqual(['lever', 'lever']);
    expect(labelsOf(l.container), lang).toEqual([
      mechT(lang, 'mech.levers_part', { n: 1, p: 2, m: 3, t: 3 }),
      mechT(lang, 'mech.levers_part', { n: 2, p: 1, m: 3, t: 2 }),
    ]);
    expect(shown(must(l.container.querySelector('.how'))), lang).toBe(mechT(lang, 'mech.levers_rule'));
    l.unmount();
    // Setting: one knob per part, then the pull.
    const s = render(LeverDevice, props({ params: SETTING, answer: [0, 4, 9], lang }));
    expect(cuesOf(s.container), lang).toEqual(['setting-part', 'setting-part', 'setting-part', 'setting-pull']);
    expect(labelsOf(s.container), lang).toEqual([
      mechT(lang, 'mech.setting_part', { n: 1, p: 1, m: 10 }),
      mechT(lang, 'mech.setting_part', { n: 2, p: 5, m: 10 }),
      mechT(lang, 'mech.setting_part', { n: 3, p: 10, m: 10 }),
      mechT(lang, 'mech.setting_pull'),
    ]);
    expect(shown(must(s.container.querySelector('.how'))), lang).toBe(mechT(lang, 'mech.setting_rule'));
    s.unmount();
  }
  // Params neither decoder accepts render nothing actionable: another type's, a mix of the two key sets, none.
  for (const params of [{ dials: 4 }, { ...LEVERS_RAW, pull: SETTING_RAW.pull }, null]) {
    const view = render(LeverDevice, props({ params, answer: [0, 0] }));
    expect(view.container.querySelectorAll('button'), JSON.stringify(params)).toHaveLength(0);
    view.unmount();
  }
});

/**
 * The device rendered with its root measured at `w` x `h` CSS px: happy-dom lays nothing out, and `bind:clientWidth`
 * reads the root's getters once at mount, so stubbing them until the mount has flushed sets the size it reads.
 */
function measured(w: number, h: number, over: Partial<PuzzleUiProps>) {
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(w);
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(h);
  try {
    const view = render(LeverDevice, props(over));
    flushSync();
    return view;
  } finally {
    width.mockRestore();
    height.mockRestore();
  }
}

/** Each button's placement as `[left, top, width, height]`. */
const boxes = (root: Element): string[][] =>
  [...root.querySelectorAll<HTMLElement>('button')].map((b) => [b.style.left, b.style.top, b.style.width, b.style.height]);

test("levers: each part sits on its rect over the room's cover", () => {
  // D3: the room's cover (geom/cover.ts, the hotspots' own transform). A 540 x 1024 root covers the 1080 x 2048 room at
  // 0.5: lever 0 [100, 800, 200, 300] is 50, 400, 100 x 150; lever 1 [600, 800, 150, 150] is 300, 400, 75 x 75.
  const half = measured(540, 1024, { params: LEVERS, answer: [0, 0] });
  expect(boxes(half.container)).toEqual([
    ['50px', '400px', '100px', '150px'],
    ['300px', '400px', '75px', '75px'],
  ]);
  half.unmount();
  // At 0.25 lever 1's 150 px sides are 37.5 and grow to 44 around its centre (PART_MIN_PX); lever 0's do not.
  const quarter = measured(270, 512, { params: LEVERS, answer: [0, 0] });
  expect(boxes(quarter.container)).toEqual([
    ['25px', '200px', '50px', '75px'],
    ['146.75px', '196.75px', '44px', '44px'],
  ]);
  quarter.unmount();
  // The pull is placed the same way, on its own rect [400, 1500, 300, 150]; at 0.25 only its height grows.
  const knobs = measured(540, 1024, { params: SETTING, answer: [0, 0, 0] });
  expect(boxes(knobs.container)).toEqual([
    ['40px', '400px', '75px', '75px'],
    ['155px', '400px', '75px', '75px'],
    ['270px', '400px', '75px', '75px'],
    ['200px', '750px', '150px', '75px'],
  ]);
  knobs.unmount();
  const small = measured(270, 512, { params: SETTING, answer: [0, 0, 0] });
  expect(boxes(small.container).at(-1)).toEqual(['100px', '371.75px', '75px', '44px']);
  small.unmount();
});

test('levers: a throw or a pull after unmount reports nothing', async () => {
  // D10 M2 (A18): every handler is delegated to the mount root, which a detached part's events never reach. The control
  // first: before the unmount a lever's tap reaches `onwork` and the pull's reaches `oncommit`, each once.
  const calls: string[] = [];
  const record: Partial<PuzzleUiProps> = {
    onchange: (a) => calls.push(`change ${a.join(' ')}`),
    onwork: (w, wrong) => calls.push(`work ${w.join(' ')} ${String(wrong)}`),
    oncommit: () => calls.push('commit'),
    onreach: (a) => calls.push(`reach ${a.join(' ')}`),
  };
  const l = render(LeverDevice, props({ params: LEVERS, answer: [0, 0], ...record }));
  const lever = must(l.container.querySelector<HTMLButtonElement>('button[data-cue="lever"]'));
  lever.click();
  expect(calls).toEqual(['work 1 1 false']);
  l.unmount();
  const s = render(LeverDevice, props({ params: SETTING, answer: [0, 0, 0], ...record }));
  const knob = must(s.container.querySelector<HTMLButtonElement>('button[data-cue="setting-part"]'));
  const pull = must(s.container.querySelector<HTMLButtonElement>('button[data-cue="setting-pull"]'));
  knob.click();
  pull.click();
  expect(calls).toEqual(['work 1 1 false', 'work 1 0 0 false', 'commit']);
  s.unmount();
  // After the unmount: taps on the detached lever, knob and pull, then a microtask, add nothing.
  lever.click();
  knob.click();
  pull.click();
  await Promise.resolve();
  expect(calls).toEqual(['work 1 1 false', 'work 1 0 0 false', 'commit']);
});

test('levers: the parts and the pull take their own taps and open no callout', () => {
  // D10: the host's device and parts layers take no tap (T34), so each part and the pull declare their own; a long-press
  // on one opens no iOS callout, and the device selects no text. happy-dom computes no style: read from the source.
  for (const cls of ['part', 'pull']) {
    const rule = declarationsFor(leverSource, cls);
    expect([rule.get('pointer-events'), rule.get('-webkit-touch-callout'), rule.get('position')], cls).toEqual(['auto', 'none', 'absolute']);
  }
  const root = declarationsFor(leverSource, 'device-parts');
  expect([root.get('pointer-events'), root.get('user-select'), root.get('-webkit-user-select')]).toEqual(['none', 'none', 'none']);
  // The rendered elements carry the classes the rules name.
  const s = render(LeverDevice, props({ params: SETTING, answer: [0, 0, 0] }));
  const classes = [...s.container.querySelectorAll('button')].map((b) => [...b.classList].filter((c) => c === 'part' || c === 'pull'));
  expect(classes).toEqual([['part'], ['part'], ['part'], ['pull']]);
  expect(s.container.querySelectorAll('.device-parts')).toHaveLength(1);
});

test('levers: a throw continues from the answer prop', async () => {
  // c9: a lever computes from the `answer` prop and keeps no copy: the session's answer is the one configuration.
  const onwork = vi.fn<(w: readonly number[], wrong: boolean) => void>();
  const onchange = vi.fn<(a: readonly number[]) => void>();
  const answer = Object.freeze([0, 0]);
  const { container, rerender } = render(LeverDevice, props({ params: LEVERS, answer, onwork, onchange }));
  const lever = (i: number): HTMLButtonElement => must(container.querySelectorAll<HTMLButtonElement>('button[data-cue="lever"]')[i]);
  lever(1).click();
  // Until the caller's answer changes, a second throw computes from the same answer: [0, 1] again, never [0, 2].
  lever(1).click();
  expect(answer).toEqual([0, 0]);
  await rerender({ answer: [2, 2] });
  // From the new prop: lever 0 moves itself and lever 1, each from 2 round to 0.
  lever(0).click();
  expect(onwork.mock.calls).toEqual([
    [[0, 1], false],
    [[0, 1], false],
    [[0, 0], false],
  ]);
  // A device writes through `onwork` alone.
  expect(onchange).not.toHaveBeenCalled();
  // What shows is the prop's: each lever's position numeral.
  expect([...container.querySelectorAll('button[data-cue="lever"] > span:first-child')].map(shown)).toEqual(['3', '3']);
});

test('levers: a configuration seeded at the target reports reached once at mount', async () => {
  // c11: the report is the reach edge's over the `answer` prop, so a device seeded at its target (a saved work at the
  // goal) reports at mount, once; a re-render with the same configuration adds none.
  const onreach = vi.fn<(a: readonly number[]) => void>();
  const onwork = vi.fn<(w: readonly number[], wrong: boolean) => void>();
  const { rerender } = render(LeverDevice, props({ params: LEVERS, answer: [2, 1], onreach, onwork }));
  expect(onreach.mock.calls).toEqual([[[2, 1]]]);
  await rerender({ answer: [2, 1] });
  expect(onreach).toHaveBeenCalledTimes(1);
  // Off the target and back: a second turn to reached, a second report; no throw reported it.
  await rerender({ answer: [0, 1] });
  await rerender({ answer: [2, 1] });
  expect(onreach.mock.calls).toEqual([[[2, 1]], [[2, 1]]]);
  expect(onwork).not.toHaveBeenCalled();
});

test('levers: a coupled throw is one onwork carrying the whole configuration', () => {
  // D3's write path: lever 0 moves levers 1 and 2 too; the three positions leave in one call, which yields diffs into one
  // `puzzle:input` per moved lever (one write of the saved work, one queue drain).
  const onwork = vi.fn<(w: readonly number[], wrong: boolean) => void>();
  const three = decoded('levers', { parts: 3, positions: 4, couples: [[1, 2], [], []], target: [1, 1, 2], rects: [[80, 800, 150, 150], [310, 800, 150, 150], [540, 800, 150, 150]] });
  const { container } = render(LeverDevice, props({ params: three, answer: [0, 3, 1], onwork }));
  must(container.querySelector<HTMLButtonElement>('button[data-cue="lever"]')).click();
  expect(onwork.mock.calls).toEqual([[[1, 0, 2], false]]);
});

test('levers, setting: a busy device takes no throw and no turn', async () => {
  // D10: while the host holds the type UI busy (an attempt in flight, a 429 countdown), every lever and knob is
  // disabled and a tap writes no work; the `disabled` attribute is asserted itself, since a click on a disabled button
  // never reaches its handler. The control: once free, one tap is one `onwork`.
  for (const [params, cue, answer] of [
    [LEVERS, 'lever', [1, 0]],
    [SETTING, 'setting-part', [3, 0, 7]],
  ] as const) {
    const onwork = vi.fn<(w: readonly number[], wrong: boolean) => void>();
    const { container, rerender } = render(LeverDevice, props({ params, answer: [...answer], onwork, busy: true }));
    const parts = [...container.querySelectorAll<HTMLButtonElement>(`button[data-cue="${cue}"]`)];
    expect(parts.length, cue).toBeGreaterThan(0);
    for (const b of parts) {
      expect(b.disabled, cue).toBe(true);
      b.click();
    }
    expect(onwork, cue).not.toHaveBeenCalled();
    await rerender({ busy: false });
    must(parts[0]).click();
    expect(onwork, cue).toHaveBeenCalledTimes(1);
  }
});

test('setting: a misshapen answer leaves the pull disabled and commits nothing', () => {
  // D7: whether an answer may be tried is the type UI's (`validAnswer`): a configuration of the wrong shape (length,
  // range, integer) cannot be pulled, so the pull is disabled and a tap posts nothing. One row per clause of
  // `shapeProblem`: short, long, above the last position, below 0, not an integer. The app never hands the device such
  // an answer (the start and the session check the shape first); this pins the device's own gate.
  const oncommit = vi.fn<() => void>();
  for (const answer of [[1], [0, 0, 0, 0], [0, 10, 0], [0, -1, 0], [0, 0.5, 0]]) {
    const { container, unmount } = render(LeverDevice, props({ params: SETTING, answer, oncommit }));
    const pull = must(container.querySelector<HTMLButtonElement>('button[data-cue="setting-pull"]'));
    expect(pull.disabled, JSON.stringify(answer)).toBe(true);
    pull.click();
    unmount();
  }
  expect(oncommit).not.toHaveBeenCalled();
});

test('setting: a pull commits once and calls nothing else', async () => {
  // D7 (A17): the pull is the device's commit part: one tap, one `oncommit` (which posts the working configuration, as
  // Try does), and no other callback; while an attempt is in flight it is disabled and calls nothing.
  const calls: string[] = [];
  const record: Partial<PuzzleUiProps> = {
    onchange: () => calls.push('change'),
    onwork: () => calls.push('work'),
    oncommit: () => calls.push('commit'),
    onreach: () => calls.push('reach'),
  };
  const { container, rerender } = render(LeverDevice, props({ params: SETTING, answer: [3, 0, 7], ...record }));
  const pull = must(container.querySelector<HTMLButtonElement>('button[data-cue="setting-pull"]'));
  pull.click();
  expect(calls).toEqual(['commit']);
  // Busy: the pull is disabled, and a tap that reaches it anyway (a stale event) calls nothing.
  await rerender({ busy: true });
  expect(pull.disabled).toBe(true);
  pull.click();
  pull.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(calls).toEqual(['commit']);
  // Free again: the next pull commits once more.
  await rerender({ busy: false });
  pull.click();
  expect(calls).toEqual(['commit', 'commit']);
});
