// L14a in happy-dom: the choice list's "no tap-through" (propagation, arming, one pick per presentation) and the quick
// bar's toggles. Events are built by hand where `detail` matters: a pointer click has detail >= 1, a keyboard or
// assistive-technology activation has detail 0.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';

import { t } from '../i18n/index.ts';
import type { LineId } from '../story/staging.ts';
import Choices from './Choices.svelte';
import QuickBar from './QuickBar.svelte';
import type { ChoiceSet } from './state.svelte.ts';

// svelteTesting()'s auto-cleanup does not reach the `dom` project, so each test unmounts what it rendered here.
afterEach(() => cleanup());

/** An ancestor of the mount target with native listeners: whatever escapes the component reaches them. */
function outerTarget(): { target: HTMLElement; escaped: ReturnType<typeof vi.fn> } {
  const outer = document.createElement('div');
  const target = document.createElement('div');
  outer.append(target);
  document.body.append(outer);
  onTestFinished(() => outer.remove());
  const escaped = vi.fn();
  outer.addEventListener('click', escaped);
  outer.addEventListener('pointerdown', escaped);
  return { target, escaped };
}

const setOf = (id: number, ...texts: string[]): ChoiceSet => ({
  id,
  options: texts.map((text, i) => ({ index: i, lineId: `ch1.c${id}.${i}` as LineId, text })),
});

const down = (el: Element): void => {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
};
const pointerClick = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
};
const keyClick = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
};

/** A full pointer tap: pointerdown, then the click it produces. */
const tap = (el: Element): void => {
  down(el);
  pointerClick(el);
};

test('choices: no tap-through', () => {
  const { target, escaped } = outerTarget();
  const onchoose = vi.fn();
  const { getAllByRole } = render(Choices, { target, props: { set: setOf(1, 'Stay', 'Leave'), lang: 'en', onchoose } });
  const [stay, leave] = getAllByRole('button');
  if (stay === undefined || leave === undefined) {
    throw new Error('two choice buttons expected');
  }
  // (a) A choice tap never reaches the dialogue's tap beneath it.
  tap(leave);
  expect(onchoose).toHaveBeenCalledWith(1);
  expect(escaped).not.toHaveBeenCalled();

  // (b) The tap that revealed the choices lands as a click with no pointerdown on the button: ignored.
  const ghost = vi.fn();
  const next = render(Choices, { set: setOf(2, 'Stay', 'Leave'), lang: 'en', onchoose: ghost });
  const [first, second] = next.container.querySelectorAll('button');
  if (first === undefined || second === undefined) {
    throw new Error('two choice buttons expected');
  }
  pointerClick(first);
  // A pointerdown on another button does not arm this one.
  down(second);
  pointerClick(first);
  expect(ghost).not.toHaveBeenCalled();
  // An armed click picks.
  tap(first);
  expect(ghost).toHaveBeenCalledWith(0);
});

test('choices: one pick per presentation', async () => {
  const onchoose = vi.fn();
  const { getAllByRole, queryAllByRole, rerender } = render(Choices, {
    set: setOf(1, 'Stay', 'Leave'),
    lang: 'en',
    onchoose,
  });
  const [stay, leave] = getAllByRole('button');
  if (stay === undefined || leave === undefined) {
    throw new Error('two choice buttons expected');
  }
  // A double tap, or a second option tapped before the next set arrives, cannot reach the next set.
  tap(stay);
  tap(stay);
  tap(leave);
  keyClick(leave);
  expect(onchoose.mock.calls).toEqual([[0]]);

  // A new presentation re-arms, and a pointerdown from the old one does not carry over.
  down(leave);
  await rerender({ set: setOf(2, 'Run', 'Hide') });
  const [run, hide] = getAllByRole('button');
  if (run === undefined || hide === undefined) {
    throw new Error('two choice buttons expected');
  }
  pointerClick(hide);
  tap(run);
  expect(onchoose.mock.calls).toEqual([[0], [0]]);

  // No set, no buttons.
  await rerender({ set: null });
  expect(queryAllByRole('button')).toHaveLength(0);
});

test('choices: keyboard activation picks', () => {
  const onchoose = vi.fn();
  const set = setOf(3, 'Stay', 'Leave', 'Wait');
  const { getByRole, getAllByRole } = render(Choices, { set, lang: 'ru', onchoose });
  expect(getByRole('group', { name: t('ru', 'quick.choose') })).toBeTruthy();
  const buttons = getAllByRole('button');
  expect(buttons.map((b) => b.getAttribute('data-line-id'))).toEqual(set.options.map((o) => o.lineId));
  expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Stay', 'Leave', 'Wait']);
  // Enter or Space on a focused button, or an assistive-technology activation: a click with detail 0.
  const wait = buttons[2];
  if (wait === undefined) {
    throw new Error('three choice buttons expected');
  }
  keyClick(wait);
  expect(onchoose.mock.calls).toEqual([[2]]);
});

test('quick: auto and skip toggle back to normal', async () => {
  const onmode = vi.fn();
  const onbacklog = vi.fn();
  const onmenu = vi.fn();
  const { getByRole, rerender } = render(QuickBar, { mode: 'normal', lang: 'en', onmode, onbacklog, onmenu });
  const auto = getByRole('button', { name: t('en', 'quick.auto') });
  const skip = getByRole('button', { name: t('en', 'quick.skip') });
  expect([auto.getAttribute('aria-pressed'), skip.getAttribute('aria-pressed')]).toEqual(['false', 'false']);
  auto.click();
  skip.click();
  expect(onmode.mock.calls).toEqual([['auto'], ['skip']]);

  await rerender({ mode: 'auto' });
  expect([auto.getAttribute('aria-pressed'), skip.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
  auto.click();
  skip.click();
  expect(onmode.mock.calls.slice(2)).toEqual([['normal'], ['skip']]);

  await rerender({ mode: 'skip' });
  expect([auto.getAttribute('aria-pressed'), skip.getAttribute('aria-pressed')]).toEqual(['false', 'true']);
  skip.click();
  expect(onmode.mock.calls.slice(4)).toEqual([['normal']]);

  getByRole('button', { name: t('en', 'quick.backlog') }).click();
  getByRole('button', { name: t('en', 'quick.menu') }).click();
  expect([onbacklog.mock.calls.length, onmenu.mock.calls.length, onmode.mock.calls.length]).toEqual([1, 1, 5]);
});

test('quick: taps stay in the bar', () => {
  const { target, escaped } = outerTarget();
  const { getAllByRole } = render(QuickBar, {
    target,
    props: { mode: 'normal', lang: 'ru', onmode: () => {}, onbacklog: () => {}, onmenu: () => {} },
  });
  const buttons = getAllByRole('button');
  expect(buttons).toHaveLength(4);
  for (const button of buttons) {
    tap(button);
    keyClick(button);
  }
  expect(escaped).not.toHaveBeenCalled();
});
