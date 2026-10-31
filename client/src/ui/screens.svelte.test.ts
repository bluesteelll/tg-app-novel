// L14a in happy-dom: the UI string tables and t(), the screen stack that owns the BackButton, the view model's
// toasts, the tap screen and the stage host. Components render through @testing-library/svelte.
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';

import { en } from '../i18n/en.ts';
import { t, type UiKey } from '../i18n/index.ts';
import { ru } from '../i18n/ru.ts';
import type { StoryId } from '../story/catalog.ts';
import type { Unsubscribe } from '../telegram/index.ts';
import { createScreens, type BackButtonPort, type RootView, type Screen, type ScreensView } from './screens.ts';
import Stage from './Stage.svelte';
import { createViewModel, TOAST_MAX, TOAST_MS, type Timers, type ToastEntry } from './state.svelte.ts';
import TapToStart from './TapToStart.svelte';
import Toast, { visibleToasts } from './Toast.svelte';
import toastSource from './Toast.svelte?raw';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (a component of one test stayed mounted into the
// next), so each test unmounts what it rendered here.
afterEach(() => cleanup());

/** The `{name}` placeholders of a template, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '').sort();
}

/** The facade's `backButton` as the screen stack sees it: every `setVisible` recorded, press handlers counted. */
class FakeBack implements BackButtonPort {
  readonly visible: boolean[] = [];
  readonly #handlers = new Set<() => void>();

  get live(): number {
    return this.#handlers.size;
  }
  setVisible(v: boolean): void {
    this.visible.push(v);
  }
  onPress(fn: () => void): Unsubscribe {
    const handler = (): void => fn();
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }
  press(): void {
    for (const handler of [...this.#handlers]) {
      handler();
    }
  }
}

function screensWith(root?: RootView): { back: FakeBack; views: ScreensView[]; screens: ReturnType<typeof createScreens> } {
  const back = new FakeBack();
  const views: ScreensView[] = [];
  const screens = createScreens({ back, onView: (v) => views.push(v), ...(root === undefined ? {} : { root }) });
  return { back, views, screens };
}

const kinds = (v: ScreensView): string[] => v.overlays.map((s) => s.kind);
const TIDE = 'tide' as StoryId;
const MANOR = 'manor' as StoryId;

/** Timers the test advances by hand. */
class FakeTimers implements Timers {
  #now = 0;
  #next = 1;
  readonly #timers = new Map<number, { at: number; fn: () => void }>();

  get pending(): number {
    return this.#timers.size;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.#next++;
    this.#timers.set(id, { at: this.#now + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }
  advance(ms: number): void {
    this.#now += ms;
    for (const [id, timer] of [...this.#timers]) {
      if (timer.at <= this.#now && this.#timers.delete(id)) {
        timer.fn();
      }
    }
  }
}

const note = (key: string, sticky = false): ToastEntry => ({ kind: 'note', key, message: `note ${key}`, sticky });
const keysOf = (entries: readonly ToastEntry[]): string[] => entries.map((e) => e.key);

/** An ancestor of the mount target: a native listener here sees whatever click escapes the component. */
function outerTarget(): { target: HTMLElement; escaped: () => number } {
  const outer = document.createElement('div');
  const target = document.createElement('div');
  outer.append(target);
  document.body.append(outer);
  onTestFinished(() => outer.remove());
  let escaped = 0;
  outer.addEventListener('click', () => {
    escaped++;
  });
  return { target, escaped: () => escaped };
}

// ---------------------------------------------------------------------------------------------------------------
// i18n (C2)

test('i18n: ru and en hold the same keys and placeholders', () => {
  const keys = Object.keys(ru) as UiKey[];
  expect(keys.length).toBeGreaterThan(0);
  expect(Object.keys(en).sort()).toEqual([...keys].sort());
  for (const key of keys) {
    expect(en[key], key).not.toBe('');
    expect(placeholders(en[key]), key).toEqual(placeholders(ru[key]));
  }
});

test('i18n: t fills placeholders and keeps unknown ones', () => {
  expect(t('ru', 'tap.continue_story', { story: 'Прилив' })).toBe('Продолжить: Прилив');
  expect(t('en', 'tap.continue_story', { story: 'The Tide' })).toBe('Continue: The Tide');
  // A missing or misnamed parameter stays visible, so the bug shows instead of an empty title.
  expect(t('en', 'tap.continue_story')).toBe('Continue: {story}');
  expect(t('en', 'tap.continue_story', { title: 'The Tide' })).toBe('Continue: {story}');
  // One pass: a value is never read as a template; it is plain text that Svelte escapes when rendered.
  expect(t('en', 'tap.continue_story', { story: '{story} <b>x</b>' })).toBe('Continue: {story} <b>x</b>');
  expect(t('en', 'tap.continue_story', {})).toBe('Continue: {story}');
  expect(t('ru', 'quick.menu')).toBe(ru['quick.menu']);
});

// ---------------------------------------------------------------------------------------------------------------
// The screen stack (C3)

test('screens: back button visible iff overlay', () => {
  const { back, views, screens } = screensWith();
  // Home is the default root and has no BackButton.
  expect(screens.view()).toEqual({ root: { kind: 'home' }, overlays: [], backVisible: false });
  expect(back.visible).toEqual([false]);
  expect(back.live).toBe(1);
  back.press();
  expect([back.visible, views.length]).toEqual([[false], 0]);

  screens.push({ kind: 'menu' });
  screens.push({ kind: 'settings' });
  expect(kinds(screens.view())).toEqual(['menu', 'settings']);
  // Edges only: the second overlay changes nothing on the button.
  expect(back.visible).toEqual([false, true]);
  back.press();
  expect([kinds(screens.view()), back.visible]).toEqual([['menu'], [false, true]]);
  back.press();
  expect([kinds(screens.view()), back.visible]).toEqual([[], [false, true, false]]);

  // close() removes that kind and everything above it; an absent kind is a no-op.
  screens.push({ kind: 'menu' });
  screens.push({ kind: 'saves' });
  const seen = views.length;
  screens.close('backlog');
  expect(views.length).toBe(seen);
  screens.close('menu');
  expect([kinds(screens.view()), back.visible]).toEqual([[], [false, true, false, true, false]]);

  // Every change hands out a fresh frozen snapshot, the same one view() returns.
  expect(views.at(-1)).toBe(screens.view());
  expect(new Set(views).size).toBe(views.length);
  for (const v of views) {
    expect([Object.isFrozen(v), Object.isFrozen(v.overlays), Object.isFrozen(v.root)]).toEqual([true, true, true]);
    expect(v.backVisible).toBe(v.overlays.length > 0);
  }
});

test('screens: back walks the room path when no overlay', () => {
  const { back, screens } = screensWith({ kind: 'game' });
  let walked = 0;
  const walk = (): void => {
    walked++;
  };
  expect(back.visible).toEqual([false]);
  screens.setRootBack(walk);
  expect(back.visible).toEqual([false, true]);
  expect(screens.view().backVisible).toBe(true);
  back.press();
  expect(walked).toBe(1);

  // Overlays pop first; the root-back runs only with none open.
  screens.push({ kind: 'inventory' });
  screens.push({ kind: 'document' });
  back.press();
  back.press();
  expect([walked, kinds(screens.view())]).toEqual([1, []]);
  back.press();
  expect(walked).toBe(2);

  // Cleared at the path's empty edge: hidden, and a press does nothing.
  screens.setRootBack(null);
  expect(back.visible).toEqual([false, true, false]);
  back.press();
  expect(walked).toBe(2);

  // Honoured only at the game root: Home and a Notice show no button for it.
  for (const root of [{ kind: 'home' }, { kind: 'notice' }] as const) {
    screens.setRoot(root);
    screens.setRootBack(walk);
    expect(screens.view().backVisible).toBe(false);
    back.press();
    expect(walked).toBe(2);
  }
  expect(back.visible).toEqual([false, true, false]);
});

test('screens: meta overlays close with back', () => {
  const meta: readonly Screen[] = [
    { kind: 'card', story: MANOR },
    { kind: 'friends' },
    { kind: 'friend', handle: 'ally_07' },
    { kind: 'wallet' },
    { kind: 'gift', to: 'ally_07' },
    { kind: 'consent' },
    { kind: 'invite', code: 'K7Q2M' },
  ];
  // Over the_end (a Notice root) and over Home: one press returns to the root and hides the button.
  for (const root of [{ kind: 'notice' }, { kind: 'home' }] as const) {
    for (const overlay of meta) {
      const { back, screens } = screensWith(root);
      screens.push(overlay);
      expect([screens.view().overlays, screens.view().backVisible]).toEqual([[overlay], true]);
      back.press();
      expect(screens.view()).toEqual({ root, overlays: [], backVisible: false });
      expect(back.visible, overlay.kind).toEqual([false, true, false]);
    }
  }
});

test('screens: root change closes overlays and clears the root-back', () => {
  const { back, screens } = screensWith({ kind: 'game' });
  let walked = 0;
  screens.setRootBack(() => {
    walked++;
  });
  screens.push({ kind: 'menu' });
  screens.push({ kind: 'saves' });
  // "Back to stories" with the menu open: Home has no button and nothing left to close.
  screens.setRoot({ kind: 'home' });
  expect(screens.view()).toEqual({ root: { kind: 'home' }, overlays: [], backVisible: false });
  expect(back.visible).toEqual([false, true, false]);
  // Back in a game, the old root-back is gone until the room path sets a new one.
  screens.setRoot({ kind: 'game' });
  expect(screens.view().backVisible).toBe(false);
  back.press();
  expect([walked, back.visible]).toEqual([0, [false, true, false]]);
});

test('screens: push of an open kind truncates to it', () => {
  const { back, screens } = screensWith();
  // A double tap on Menu needs one Back, not two.
  screens.push({ kind: 'menu' });
  screens.push({ kind: 'menu' });
  expect(kinds(screens.view())).toEqual(['menu']);

  // The kind's new payload replaces the old, and what stood above it closes.
  screens.push({ kind: 'chapters', story: TIDE });
  screens.push({ kind: 'paywall' });
  screens.push({ kind: 'terms' });
  screens.push({ kind: 'chapters', story: MANOR });
  expect(screens.view().overlays).toEqual([{ kind: 'menu' }, { kind: 'chapters', story: MANOR }]);
  back.press();
  back.press();
  expect(screens.view()).toEqual({ root: { kind: 'home' }, overlays: [], backVisible: false });
  expect(back.visible).toEqual([false, true, false]);
});

test('screens: dispose unsubscribes and hides the button', () => {
  const { back, views, screens } = screensWith({ kind: 'game' });
  let walked = 0;
  screens.setRootBack(() => {
    walked++;
  });
  screens.push({ kind: 'menu' });
  expect([back.live, back.visible]).toEqual([1, [false, true]]);
  screens.dispose();
  expect([back.live, back.visible]).toEqual([0, [false, true, false]]);

  // Every later call is a no-op: no button call, no view, no root-back.
  const seen = views.length;
  const last = screens.view();
  screens.dispose();
  screens.push({ kind: 'settings' });
  screens.setRoot({ kind: 'home' });
  screens.setRootBack(() => {});
  screens.close('menu');
  screens.back();
  back.press();
  expect([back.visible, views.length, walked]).toEqual([[false, true, false], seen, 0]);
  expect(screens.view()).toBe(last);
});

// ---------------------------------------------------------------------------------------------------------------
// The view model's toasts and Toast (C4)

test('toast: transient expires, sticky stays until dismissed', () => {
  const timers = new FakeTimers();
  const vm = createViewModel({ timers, lang: 'ru' });
  vm.showToast(note('resume'));
  expect(keysOf(vm.toasts)).toEqual(['resume']);
  timers.advance(TOAST_MS - 1);
  expect(vm.toasts.length).toBe(1);
  timers.advance(1);
  expect(vm.toasts.length).toBe(0);
  expect(timers.pending).toBe(0);

  // Prompts, chips, dev banners and sticky notes have no timer.
  vm.showToast(note('refunded', true));
  vm.showToast({ kind: 'chip', key: 'sound', message: 'sound', tap: () => {} });
  vm.showToast({ kind: 'dev', key: 'dev', message: 'tag error' });
  timers.advance(10 * TOAST_MS);
  expect([keysOf(vm.toasts), timers.pending]).toEqual([['refunded', 'sound', 'dev'], 0]);
  vm.dismissToast('sound');
  vm.dismissToast('unknown');
  expect(keysOf(vm.toasts)).toEqual(['refunded', 'dev']);

  // Dismissing a transient clears its timer; destroy() clears every timer, and later toasts are dropped.
  vm.dismissToast('dev');
  vm.showToast(note('failed'));
  vm.dismissToast('failed');
  expect([keysOf(vm.toasts), timers.pending]).toEqual([['refunded'], 0]);
  vm.showToast(note('resume'));
  expect(timers.pending).toBe(1);
  vm.destroy();
  vm.destroy();
  expect(timers.pending).toBe(0);
  vm.showToast(note('late'));
  expect([keysOf(vm.toasts).includes('late'), timers.pending]).toEqual([false, 0]);
});

test('toast: same key replaces in place', () => {
  const timers = new FakeTimers();
  const vm = createViewModel({ timers, lang: 'en' });
  vm.showToast(note('a'));
  vm.showToast({ kind: 'prompt', key: 'save-conflict', message: 'saved elsewhere', actions: [{ label: 'Load', run: () => {} }] });
  timers.advance(TOAST_MS / 2);
  // The same key keeps its place, takes the new entry and restarts its timer.
  const again: ToastEntry = { kind: 'note', key: 'a', message: 'again', sticky: false };
  vm.showToast(again);
  expect(keysOf(vm.toasts)).toEqual(['a', 'save-conflict']);
  expect(vm.toasts[0]).toBe(again);
  expect(timers.pending).toBe(1);
  timers.advance(TOAST_MS - 1);
  expect(keysOf(vm.toasts)).toEqual(['a', 'save-conflict']);
  timers.advance(1);
  expect(keysOf(vm.toasts)).toEqual(['save-conflict']);

  // Over TOAST_MAX the oldest transient goes, with its timer; a sticky entry is never dropped.
  vm.showToast(note('b'));
  vm.showToast(note('c'));
  expect(vm.toasts.length).toBe(TOAST_MAX);
  vm.showToast(note('d'));
  expect([keysOf(vm.toasts), timers.pending]).toEqual([['save-conflict', 'c', 'd'], 2]);
  vm.showToast({ kind: 'chip', key: 'sound', message: 'sound', tap: () => {} });
  vm.showToast({ kind: 'dev', key: 'dev', message: 'tag error' });
  expect([keysOf(vm.toasts), timers.pending]).toEqual([['save-conflict', 'sound', 'dev'], 0]);
  vm.showToast(note('e'));
  expect([keysOf(vm.toasts), timers.pending]).toEqual([['save-conflict', 'sound', 'dev'], 0]);
});

test('toast: actions and the chip run inside the click', () => {
  const { target, escaped } = outerTarget();
  const log: string[] = [];
  const entries: ToastEntry[] = [
    {
      kind: 'prompt',
      key: 'save-conflict',
      message: t('ru', 'toast.save_conflict'),
      actions: [
        { label: t('ru', 'toast.save_conflict_load'), run: () => log.push('load') },
        { label: t('ru', 'toast.save_conflict_keep'), run: () => log.push('keep') },
      ],
    },
    { kind: 'chip', key: 'sound', message: t('ru', 'toast.sound_resume'), tap: () => log.push('sound') },
    note('refunded', true),
    note('failed'),
  ];
  const { getByRole, getByText } = render(Toast, {
    target,
    props: { toasts: entries, lang: 'ru', ondismiss: (key: string) => log.push(`dismiss:${key}`) },
  });

  // Each spy is read right after click(), with no await between: the handler ran inside the gesture.
  getByRole('button', { name: t('ru', 'toast.save_conflict_load') }).click();
  expect(log).toEqual(['load', 'dismiss:save-conflict']);
  getByRole('button', { name: t('ru', 'toast.save_conflict_keep') }).click();
  expect(log.slice(2)).toEqual(['keep', 'dismiss:save-conflict']);
  // The chip is the audio gesture; it stays until the caller learns sound runs again.
  getByRole('button', { name: t('ru', 'toast.sound_resume') }).click();
  expect(log.slice(4)).toEqual(['sound']);
  // A sticky note closes by its button, a transient one by a tap on it.
  getByRole('button', { name: t('ru', 'toast.close') }).click();
  getByText('note failed').click();
  expect(log.slice(5)).toEqual(['dismiss:refunded', 'dismiss:failed']);
  expect(escaped()).toBe(0);
});

test('toast: dev variant renders only with the mock', () => {
  const dev: ToastEntry = { kind: 'dev', key: 'dev', message: 'tag error: bg unknown' };
  const plain = note('resume');
  expect(visibleToasts([dev, plain], false)).toEqual([plain]);
  expect(visibleToasts([dev, plain], true)).toEqual([dev, plain]);

  // Under vitest the mode is not production, so __TG_MOCK__ is true and the banner renders.
  const { container } = render(Toast, { toasts: [dev, plain], lang: 'en', ondismiss: () => {} });
  expect([...container.querySelectorAll('[data-variant]')].map((el) => el.getAttribute('data-variant'))).toEqual([
    'dev',
    'note',
  ]);
  // The one call site passes the build's flag, so a production build (__TG_MOCK__ false) drops the banner.
  const calls = [...toastSource.matchAll(/(?<!function\s+)\bvisibleToasts\s*\(([^)]*)\)/g)].map((m) => m[1]);
  expect(calls).toEqual(['toasts, __TG_MOCK__']);
});

// ---------------------------------------------------------------------------------------------------------------
// Home's frame and the stage host (C5)

/** A child the way L14b's cards or the exploration layer arrive: a snippet the component renders in place. */
const child = (testId: string) =>
  createRawSnippet(() => ({ render: () => `<div data-testid="${testId}"></div>` }));

test('tap: continue names the story', () => {
  const ruHome = render(TapToStart, { lang: 'ru', continueLabel: 'Прилив', oncontinue: () => {} });
  const ruLabel = ruHome.getByRole('button').textContent ?? '';
  expect(ruLabel).toContain('Прилив');
  expect(ruLabel.trim()).toBe('Продолжить: Прилив');
  ruHome.unmount();

  const enHome = render(TapToStart, { lang: 'en', continueLabel: 'The Tide', oncontinue: () => {} });
  expect(enHome.getByRole('button').textContent?.trim()).toBe('Continue: The Tide');
  enHome.unmount();

  // No autosave: no Continue at all.
  const fresh = render(TapToStart, { lang: 'ru', continueLabel: null, oncontinue: () => {} });
  expect(fresh.queryByRole('button')).toBeNull();
});

test('tap: continue calls back inside the click', () => {
  const { target, escaped } = outerTarget();
  const oncontinue = vi.fn();
  const { getByRole } = render(TapToStart, { target, props: { lang: 'en', continueLabel: 'The Tide', oncontinue } });
  getByRole('button').click();
  // Read before any await: the caller's unlockAudio() runs inside this same gesture (principle 5).
  expect(oncontinue).toHaveBeenCalledTimes(1);
  // Home is a root: its tap is not swallowed for anything above it.
  expect(escaped()).toBe(1);
});

test('tap: home frame renders its children', () => {
  const { getByTestId, getByRole, container } = render(TapToStart, {
    lang: 'ru',
    continueLabel: 'Прилив',
    oncontinue: () => {},
    children: child('cards'),
  });
  const frame = container.firstElementChild;
  expect(frame?.contains(getByTestId('cards'))).toBe(true);
  expect(frame?.contains(getByRole('button'))).toBe(true);
  render(TapToStart, { lang: 'en', continueLabel: null, oncontinue: () => {}, children: child('cards-only') });
  expect(getByTestId('cards-only')).toBeTruthy();
});

test('stage: children render inside the host element', async () => {
  const hosts: (HTMLElement | null)[] = [];
  const onhost = (el: HTMLElement | null): void => {
    hosts.push(el);
  };
  const { getByTestId, rerender, unmount } = render(Stage, { onhost, children: child('hotspots') });
  expect(hosts).toHaveLength(1);
  const host = hosts[0];
  expect(host).toBeInstanceOf(HTMLElement);
  expect(host?.contains(getByTestId('hotspots'))).toBe(true);
  // A parent passing a new callback must not tear the scene down and mount it again.
  const other = vi.fn();
  await rerender({ onhost: other });
  expect([hosts.length, other.mock.calls.length]).toEqual([1, 0]);
  unmount();
  expect(hosts).toEqual([host, null]);
  expect(other).not.toHaveBeenCalled();
});
