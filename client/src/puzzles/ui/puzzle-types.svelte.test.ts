// LP2 in happy-dom: the puzzle type UIs (PUZZLES-PLAN X17; engine plan §7.2 `path`, GM7p) and their lazy loader (X14).
// Each is presentational: the answer comes in as a prop and every change leaves as a fresh array through `onchange`.
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
import type { PuzzleType } from '../rules/index.ts';
import CodeLock from './CodeLock.svelte';
import codeLockSource from './CodeLock.svelte?raw';
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

/** Per type: params and an answer that render its parts, and how many parts they render (a type without one is a tsc
 *  error, so a new type UI is held to the marker rule from its first commit). */
const PART_FIXTURES: { readonly [T in PuzzleType]: { readonly params: unknown; readonly answer: readonly number[]; readonly parts: number } } = {
  code: { params: { dials: 4 }, answer: [0, 0, 0, 0], parts: 4 },
  order: { params: { pieces: PIECES }, answer: [0, 1, 2], parts: 3 },
  // A blocked cell is a part too: every cell, in row-major order.
  path: { params: { cols: 3, rows: 2, ends: [0, 3], blocked: [4] }, answer: [0, 1], parts: 6 },
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

test('registry: each type loads its own component', async () => {
  const code = await loadPuzzleUi('code');
  const order = await loadPuzzleUi('order');
  const path = await loadPuzzleUi('path');
  if (!code.ok || !order.ok || !path.ok) {
    throw new Error(`expected every chunk to load: ${JSON.stringify([code, order, path])}`);
  }
  expect(code.value).toBe(CodeLock);
  expect(order.value).toBe(OrderPuzzle);
  expect(path.value).toBe(PathPuzzle);
  const lock = render(code.value, props({ params: { dials: 3 }, answer: [0, 0, 0] }));
  expect(lock.getAllByRole('button', { name: t('en', 'puzzle.dial_up') })).toHaveLength(3);
  lock.unmount();
  const slots = render(order.value, props({ params: { pieces: PIECES }, answer: [0, 1, 2], item }));
  expect(slots.getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
  slots.unmount();
  const grid = render(path.value, props({ params: { cols: 3, rows: 2, ends: [0, 3], blocked: [] }, answer: [0] }));
  expect(grid.getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
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

/** A drawn PathPuzzle's surface with its box stubbed (300 x 200 by default: a 3 x 2 grid of 100 px cells). */
function rig(d: ReturnType<typeof drawn>, box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 300, h: 200 }) {
  const surface = d.view.container.querySelector<HTMLElement>('[data-cue-gesture="path-stroke"]');
  if (surface === null) {
    throw new Error('invariant: the stroke surface is rendered');
  }
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(box.x, box.y, box.w, box.h));
  /** Cell `c`'s centre in the stubbed box of the 3 x 2 grid. */
  const centre = (c: number): { clientX: number; clientY: number } => ({
    clientX: box.x + ((c % 3) + 0.5) * (box.w / 3),
    clientY: box.y + (Math.floor(c / 3) + 0.5) * (box.h / 2),
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
  // The box arithmetic assumes the surface's box is the grid's: no padding and no border on it.
  const box = declarationsFor(pathSource, 'surface');
  expect([box.get('padding'), box.get('border'), box.get('gap')]).toEqual(['0', '0', '0']);
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
