// L14a in happy-dom: the UI string tables and t(), the screen stack that owns the BackButton, the view model's
// toasts, the tap screen and the stage host. Components render through @testing-library/svelte.
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet, flushSync, tick } from 'svelte';
import { parse } from 'svelte/compiler';
import type { AST } from 'svelte/compiler';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';

import { en } from '../i18n/en.ts';
import { t, type UiKey } from '../i18n/index.ts';
import { ru } from '../i18n/ru.ts';
import type { StoryId } from '../story/catalog.ts';
import type { Unsubscribe } from '../telegram/index.ts';
import appSource from './App.svelte?raw';
import { createScreens, type BackButtonPort, type RootView, type Screen, type ScreensView } from './screens.ts';
import Stage from './Stage.svelte';
import { createViewModel, TOAST_MAX, TOAST_MS, type Timers, type ToastEntry } from './state.svelte.ts';
import TapToStart from './TapToStart.svelte';
import Toast, { visibleToasts } from './Toast.svelte';
import toastSource from './Toast.svelte?raw';
import { TOAST_MOTIONS, type ToastMotion } from './toast-motion.ts';

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
  // Every Toast render records its motions (recordAnimate, below): happy-dom leaves a cancelled animation's
  // `finished` rejection unhandled, which browsers mark handled.
  recordAnimate();
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
    props: { toasts: entries, lang: 'ru', reduced: false, ondismiss: (key: string) => log.push(`dismiss:${key}`) },
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
  recordAnimate();
  const dev: ToastEntry = { kind: 'dev', key: 'dev', message: 'tag error: bg unknown' };
  const plain = note('resume');
  expect(visibleToasts([dev, plain], false)).toEqual([plain]);
  expect(visibleToasts([dev, plain], true)).toEqual([dev, plain]);

  // Under vitest the mode is not production, so __TG_MOCK__ is true and the banner renders.
  const { container } = render(Toast, { toasts: [dev, plain], lang: 'en', reduced: false, ondismiss: () => {} });
  expect([...container.querySelectorAll('[data-variant]')].map((el) => el.getAttribute('data-variant'))).toEqual([
    'dev',
    'note',
  ]);
  // The one call site passes the build's flag, so a production build (__TG_MOCK__ false) drops the banner.
  const calls = [...toastSource.matchAll(/(?<!function\s+)\bvisibleToasts\s*\(([^)]*)\)/g)].map((m) => m[1]);
  expect(calls).toEqual(['toasts, __TG_MOCK__']);
});

// ---------------------------------------------------------------------------------------------------------------
// Toast motion (per-player GM6t): every toast enters, leaves as an inert ghost and swaps its text through
// `Element.animate`, recorded here.

/** A recorded `Animation`: `finish()` ends it as a browser does (the state, then `onfinish`); `cancel()` is counted. */
class RecordedAnimation {
  onfinish: (() => void) | null = null;
  playState: 'running' | 'finished' | 'idle' = 'running';
  cancels = 0;
  readonly id: number;
  readonly #log: string[];
  constructor(id: number, log: string[]) {
    this.id = id;
    this.#log = log;
  }
  cancel(): void {
    this.cancels++;
    this.playState = 'idle';
    this.#log.push(`cancel ${this.id}`);
  }
  finish(): void {
    this.playState = 'finished';
    this.onfinish?.();
  }
}

type Played = {
  readonly el: Element;
  readonly keyframes: unknown;
  readonly options: KeyframeAnimationOptions;
  readonly anim: RecordedAnimation;
};

/** `Element.prototype.animate` as `value` for this test (happy-dom has a real one), restored after it. */
function stubAnimate(value: unknown): void {
  const own = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  Object.defineProperty(Element.prototype, 'animate', { value, configurable: true, writable: true });
  onTestFinished(() => {
    if (own === undefined) {
      Reflect.deleteProperty(Element.prototype, 'animate');
    } else {
      Object.defineProperty(Element.prototype, 'animate', own);
    }
  });
}

/** Every `animate` call of this test in order, and a log of each play (`play <id>`) and cancel (`cancel <id>`). */
function recordAnimate(): { played: Played[]; log: string[] } {
  const played: Played[] = [];
  const log: string[] = [];
  stubAnimate(function (this: Element, keyframes: unknown, options: KeyframeAnimationOptions): RecordedAnimation {
    const anim = new RecordedAnimation(played.length, log);
    played.push({ el: this, keyframes, options, anim });
    log.push(`play ${anim.id}`);
    return anim;
  });
  return { played, log };
}

const MOTION_KINDS: readonly ToastMotion[] = ['in', 'out', 'swap'];

/** The motion a call played, read from its keyframes against the full table. */
function kindOf(p: Played): ToastMotion | undefined {
  const kf = JSON.stringify(p.keyframes);
  return MOTION_KINDS.find((k) => JSON.stringify(TOAST_MOTIONS[k].full.keyframes) === kf);
}

/** The stack's root element. */
function stackRoot(container: HTMLElement): Element {
  const root = container.querySelector('.toasts');
  if (root === null) {
    throw new Error('no toast stack');
  }
  return root;
}

/** The toast element (a child of the stack) whose text holds `text`. */
function toastEl(container: HTMLElement, text: string): Element {
  const el = [...stackRoot(container).children].find((c) => c.textContent?.includes(text));
  if (el === undefined) {
    throw new Error(`no toast reads "${text}"`);
  }
  return el;
}

const noDismiss = (): void => {};

/** Toast's props for a motion test: English, full motion, no dismiss handler. */
const motionProps = (
  toasts: readonly ToastEntry[],
): { toasts: readonly ToastEntry[]; lang: 'en'; reduced: boolean; ondismiss: () => void } => ({
  toasts,
  lang: 'en',
  reduced: false,
  ondismiss: noDismiss,
});

test('toast: a new toast animates in, a dismissed one out', async () => {
  const { played, log } = recordAnimate();
  const [a, b] = [note('a'), note('b')];
  const { container, rerender } = render(Toast, motionProps([a]));
  expect(played.map(kindOf)).toEqual(['in']);
  const elA = toastEl(container, 'note a');
  expect(played[0]?.el).toBe(elA);
  expect(elA.isConnected).toBe(true);

  await rerender({ toasts: [a, b] });
  expect(played.map(kindOf)).toEqual(['in', 'in']);
  expect(played[1]?.el).toBe(toastEl(container, 'note b'));
  // Another toast arriving cancels nothing: A's entrance runs on.
  expect(played[0]?.anim.playState).toBe('running');

  await rerender({ toasts: [b] });
  expect(played.map(kindOf)).toEqual(['in', 'in', 'out']);
  // One Animation per element: A's running entrance is cancelled before its leave plays, from rest.
  expect(log).toEqual(['play 0', 'play 1', 'cancel 0', 'play 2']);
  expect(played[2]?.el).toBe(elA);
  expect(played[2]?.options.fill).toBe('both');
});

test('toast: a dismissed toast stays as a leaving ghost until its out motion finishes', async () => {
  const { played } = recordAnimate();
  const prompt: ToastEntry = {
    kind: 'prompt',
    key: 'p',
    message: 'prompt p',
    actions: [{ label: 'act', run: () => {} }],
  };
  const stay = note('stay', true);
  const { container, rerender } = render(Toast, motionProps([prompt, stay]));

  await rerender({ toasts: [stay] });
  const ghost = container.querySelector('[data-variant="prompt"]');
  expect(ghost).not.toBeNull();
  expect([ghost?.hasAttribute('inert'), ghost?.getAttribute('aria-hidden')]).toEqual([true, 'true']);
  // Its action is inside the inert element: no tap reaches a leaving prompt's buttons.
  expect(ghost?.querySelector('button')?.closest('[inert]')).toBe(ghost);
  // A live toast is neither inert nor hidden.
  const live = toastEl(container, 'note stay');
  expect([live.hasAttribute('inert'), live.hasAttribute('aria-hidden')]).toEqual([false, false]);

  const out = played.find((p) => p.el === ghost && kindOf(p) === 'out');
  expect(out).toBeDefined();
  await tick();
  expect(ghost?.isConnected).toBe(true);
  out?.anim.finish();
  await tick();
  expect(ghost?.isConnected).toBe(false);
  expect(container.querySelector('[data-variant="prompt"]')).toBeNull();
});

test('toast: a same-key replace swaps its text with motion', async () => {
  const { played, log } = recordAnimate();
  const say = (message: string): ToastEntry => ({ kind: 'note', key: 'a', message, sticky: false });
  const { container, rerender } = render(Toast, motionProps([say('one')]));
  const el = toastEl(container, 'one');

  await rerender({ toasts: [say('two')] });
  // The same element stays: no new entrance, its text swaps.
  expect(played.map(kindOf)).toEqual(['in', 'swap']);
  const text = el.querySelector('[data-toast-text]');
  expect(text?.textContent).toBe('two');
  expect(played[1]?.el).toBe(text);

  // A second replace cancels the first swap on the same span.
  await rerender({ toasts: [say('three')] });
  expect(played.map(kindOf)).toEqual(['in', 'swap', 'swap']);
  expect(log.slice(-2)).toEqual(['cancel 1', 'play 2']);
  expect(played[2]?.el).toBe(text);
  // The same message again is no motion (the view model restarts the timer only).
  await rerender({ toasts: [say('three')] });
  expect(played.length).toBe(3);
});

test('toast: a key that left, returned and leaves again plays out again', () => {
  const { played } = recordAnimate();
  const look = note('look');
  let list: readonly ToastEntry[] = $state.raw([look]);
  const { container } = render(Toast, {
    get toasts() {
      return list;
    },
    lang: 'en',
    reduced: false,
    ondismiss: noDismiss,
  });
  const el = toastEl(container, 'note look');
  const set = (next: readonly ToastEntry[]): void => {
    list = next;
    flushSync();
  };

  // Shown again while its out runs: that out is cancelled and the same element enters again.
  set([]);
  set([look]);
  expect(played.map(kindOf)).toEqual(['in', 'out', 'in']);
  expect(played[1]?.anim.playState).toBe('idle');
  expect(played[2]?.el).toBe(el);
  expect([el.isConnected, el.hasAttribute('inert')]).toEqual([true, false]);

  // Shown again in the flush its finished out ends in: the end of that leave must not end the next one.
  set([]);
  flushSync(() => {
    played[3]?.anim.finish();
    list = [look];
  });
  set([]);
  expect(played.map(kindOf)).toEqual(['in', 'out', 'in', 'out', 'in', 'out']);
  expect(played[5]?.el).toBe(el);
  // The element stays a ghost until its own out ends.
  expect([el.isConnected, el.hasAttribute('inert')]).toEqual([true, true]);
  played[5]?.anim.finish();
  flushSync();
  expect(el.isConnected).toBe(false);
});

test('toast: a toast without animate leaves at once', async () => {
  stubAnimate(undefined);
  const { container, rerender } = render(Toast, motionProps([note('a')]));
  const el = toastEl(container, 'note a');
  await rerender({ toasts: [] });
  expect(el.isConnected).toBe(false);
  expect(stackRoot(container).children.length).toBe(0);
});

test('toast: an unmounted stack leaves no running animation', async () => {
  const { played } = recordAnimate();
  const { rerender, unmount } = render(Toast, motionProps([note('a'), note('b')]));
  // A's out and B's in are running.
  await rerender({ toasts: [note('b')] });
  expect(played.length).toBeGreaterThanOrEqual(2);
  unmount();
  // None of them finished, so every one is cancelled.
  expect(played.map((p) => p.anim.playState)).toEqual(played.map(() => 'idle'));
});

test('toast: the stack is built from the dev-filtered entries', () => {
  // `shown` is `visibleToasts(toasts, __TG_MOCK__)` (pinned above), so a ghost is never a dev entry in production.
  const args = [...toastSource.matchAll(/\bstackOf\s*\(([^)]*)\)/g)].map((m) => (m[1] ?? '').split(',')[1]?.trim());
  expect(args).toEqual(['shown']);
});

test("toast: a dropped ghost's finished out is released, not cancelled at unmount", async () => {
  const { played } = recordAnimate();
  const [a, b] = [note('a'), note('b')];
  const { container, rerender, unmount } = render(Toast, motionProps([a, b]));
  const [elA, elB] = [toastEl(container, 'note a'), toastEl(container, 'note b')];
  await rerender({ toasts: [b] });
  const out = played.find((p) => p.el === elA && kindOf(p) === 'out');
  const enter = played.find((p) => p.el === elB && kindOf(p) === 'in');
  expect([out?.anim.playState, enter?.anim.playState]).toEqual(['running', 'running']);

  out?.anim.finish();
  await tick();
  expect(elA.isConnected).toBe(false);
  unmount();
  // The teardown ran (B's entrance is cancelled) and left the released out alone.
  expect([enter?.anim.playState, out?.anim.playState, out?.anim.cancels]).toEqual(['idle', 'finished', 0]);
});

test('toast: a key returning after its out finished cancels that out before its in', () => {
  const { played, log } = recordAnimate();
  const a = note('a');
  let list: readonly ToastEntry[] = $state.raw([a]);
  const { container } = render(Toast, {
    get toasts() {
      return list;
    },
    lang: 'en',
    reduced: false,
    ondismiss: noDismiss,
  });
  const el = toastEl(container, 'note a');
  list = [];
  flushSync();
  expect(played.map(kindOf)).toEqual(['in', 'out']);
  expect(played[1]?.el).toBe(el);

  // The out ends and the key returns in one flush: the ghost is still on the stack, live again on its element.
  flushSync(() => {
    played[1]?.anim.finish();
    list = [a];
  });
  expect(played.map(kindOf)).toEqual(['in', 'out', 'in']);
  expect(played[2]?.el).toBe(el);
  expect([el.isConnected, el.hasAttribute('inert'), el.hasAttribute('aria-hidden')]).toEqual([true, false, false]);
  // The finished out holds opacity 0 (`fill: 'both'`): it is cancelled right before the in.
  expect(log.slice(-2)).toEqual(['cancel 1', 'play 2']);
  played[2]?.anim.finish();
  // The toast ends visible: nothing recorded on it still holds a last frame.
  const held = played.filter((p) => p.el === el && p.options.fill === 'both' && p.anim.playState !== 'idle');
  expect(held.map((p) => p.anim.id)).toEqual([]);
});

test('toast: every slot renders exactly one root element', async () => {
  recordAnimate();
  const entries: ToastEntry[] = [
    { kind: 'prompt', key: 'p', message: 'prompt p', actions: [{ label: 'act', run: () => {} }] },
    { kind: 'chip', key: 'sound', message: 'chip', tap: () => {} },
    note('sticky', true),
    note('transient'),
    { kind: 'dev', key: 'dev', message: 'dev banner' },
  ];
  const { container, rerender } = render(Toast, motionProps(entries));
  const root = stackRoot(container);
  const variants = (): (string | null)[] => [...root.children].map((c) => c.getAttribute('data-variant'));
  expect(variants()).toEqual(['prompt', 'chip', 'note', 'note', 'dev']);

  // The transient note leaves: its ghost keeps its index, so the walk's zip of the children with the stack holds.
  await rerender({ toasts: entries.filter((e) => e.key !== 'transient') });
  expect(root.children.length).toBe(5);
  expect(variants()).toEqual(['prompt', 'chip', 'note', 'note', 'dev']);
  expect([...root.children].map((c) => c.hasAttribute('inert'))).toEqual([false, false, false, true, false]);
});

test('toast: reduced motion plays the opacity-only motions', async () => {
  const { played } = recordAnimate();
  const say = (message: string): ToastEntry => ({ kind: 'note', key: 'a', message, sticky: false });
  const { rerender } = render(Toast, { ...motionProps([say('one')]), reduced: true });
  await rerender({ toasts: [say('two')] });
  await rerender({ toasts: [] });
  expect(played.map((p) => p.keyframes)).toEqual([
    TOAST_MOTIONS.in.reduced.keyframes,
    TOAST_MOTIONS.swap.reduced.keyframes,
    TOAST_MOTIONS.out.reduced.keyframes,
  ]);

  // One flush that changes the setting and adds a toast: the toast enters, with the new setting.
  const other = render(Toast, { ...motionProps([]), reduced: true });
  await other.rerender({ toasts: [note('b')], reduced: false });
  const enter = played[3];
  expect(played.length).toBe(4);
  expect(enter?.keyframes).toEqual(TOAST_MOTIONS.in.full.keyframes);
  expect(enter?.el).toBe(toastEl(other.container, 'note b'));
  expect(enter?.el.isConnected).toBe(true);
});

test("toast: App passes the view model's reduced motion to the stack", () => {
  const ast = parse(appSource, { modern: true });
  const toasts: AST.Component[] = [];
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) {
      return;
    }
    if ((n as { type?: unknown }).type === 'Component' && (n as AST.Component).name === 'Toast') {
      toasts.push(n as AST.Component);
    }
    for (const v of Object.values(n)) {
      walk(v);
    }
  };
  walk(ast.fragment);
  expect(toasts).toHaveLength(1);
  const attrs = (toasts[0]?.attributes ?? []).map((a) => appSource.slice(a.start, a.end));
  expect(attrs).toEqual(expect.arrayContaining(['toasts={vm.toasts}', 'reduced={vm.reducedMotion}']));
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

// ---------------------------------------------------------------------------------------------------------------
// No literal player-facing text in this lane's components (C8, principle 8)

/** The six components of this lane; App.svelte (L1/L15) is not one of them. */
const LANE_COMPONENTS = [
  'Choices.svelte',
  'DialogueBox.svelte',
  'QuickBar.svelte',
  'Stage.svelte',
  'TapToStart.svelte',
  'Toast.svelte',
] as const;

const COMPONENT_SOURCES = import.meta.glob<string>('./*.svelte', { query: '?raw', import: 'default', eager: true });

/** The markup with every `{…}` (expressions, blocks, tags) blanked; braces nest, as in an inline handler body. */
function withoutMustaches(text: string): string {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') {
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
    } else if (depth === 0) {
      out += ch;
      continue;
    }
    out += ' ';
  }
  return out;
}

/** Where a component shows a literal string: text nodes and the text attributes, outside scripts and styles. */
function literalText(source: string): string[] {
  const markup = withoutMustaches(
    source.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' '),
  );
  const found: string[] = [];
  for (const m of markup.matchAll(/\b(aria-label|title|alt|placeholder)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = m[2] ?? m[3] ?? '';
    if (/\p{L}/u.test(value)) {
      found.push(`${m[1]}="${value}"`);
    }
  }
  for (const m of markup.replace(/<[^>]*>/g, ' ').matchAll(/\S*\p{L}\S*/gu)) {
    found.push(`text "${m[0]}"`);
  }
  return found;
}

test('i18n: lane components hold no literal text', () => {
  const names = Object.keys(COMPONENT_SOURCES).map((key) => key.replace(/^\.\//, ''));
  // Non-vacuous: every lane component is read, so a renamed or missing file cannot pass.
  expect(names.filter((n) => (LANE_COMPONENTS as readonly string[]).includes(n)).sort()).toEqual([...LANE_COMPONENTS]);
  const offenders: string[] = [];
  for (const name of LANE_COMPONENTS) {
    const source = COMPONENT_SOURCES[`./${name}`] ?? '';
    expect(source, name).toContain('</');
    for (const literal of literalText(source)) {
      offenders.push(`${name}: ${literal}`);
    }
    // Russian belongs in ru.ts only: no Cyrillic in a component, in its script or inside `{…}` either.
    if (/\p{Script=Cyrillic}/u.test(source)) {
      offenders.push(`${name}: Cyrillic in the source`);
    }
  }
  expect(offenders).toEqual([]);

  // The reader itself: a text node and a text attribute are found, an expression and a glyph are not.
  expect(literalText('<p>Меню</p><b aria-label="Close">×</b><i title={t(lang, "k")}>{label}</i>')).toEqual([
    'aria-label="Close"',
    'text "Меню"',
  ]);
});
