// LP2 in happy-dom: the two puzzle type UIs (PUZZLES-PLAN X17) and their lazy loader (X14). Both components are
// presentational: the answer comes in as a prop and every change leaves as a fresh array through `onchange`.
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';

import { t } from '../../i18n/index.ts';
import type { Lang } from '../../i18n/index.ts';
import type { ItemId } from '../../world/types.ts';
import { loadPuzzleUi } from '../registry.ts';
import type { PuzzleUiProps } from '../registry.ts';
import CodeLock from './CodeLock.svelte';
import codeLockSource from './CodeLock.svelte?raw';
import OrderPuzzle from './OrderPuzzle.svelte';

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
const item = (id: ItemId): { name: string } | null => (Object.hasOwn(NAMES, id) ? { name: NAMES[id] ?? '' } : null);

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

test('registry: each type loads its own component', async () => {
  const code = await loadPuzzleUi('code');
  const order = await loadPuzzleUi('order');
  if (!code.ok || !order.ok) {
    throw new Error(`expected both chunks to load: ${JSON.stringify([code, order])}`);
  }
  expect(code.value).toBe(CodeLock);
  expect(order.value).toBe(OrderPuzzle);
  const lock = render(code.value, props({ params: { dials: 3 }, answer: [0, 0, 0] }));
  expect(lock.getAllByRole('button', { name: t('en', 'puzzle.dial_up') })).toHaveLength(3);
  lock.unmount();
  const slots = render(order.value, props({ params: { pieces: PIECES }, answer: [0, 1, 2], item }));
  expect(slots.getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
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
