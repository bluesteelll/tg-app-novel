// L14a in happy-dom: the UI string tables and t(), the screen stack that owns the BackButton, the view model's
// toasts, the tap screen and the stage host. Components render through @testing-library/svelte (auto-cleanup by
// svelteTesting() in vite.config.ts).
import { expect, test } from 'vitest';

import { en } from '../i18n/en.ts';
import { t, type UiKey } from '../i18n/index.ts';
import { ru } from '../i18n/ru.ts';
import type { StoryId } from '../story/catalog.ts';
import type { Unsubscribe } from '../telegram/index.ts';
import { createScreens, type BackButtonPort, type RootView, type Screen, type ScreensView } from './screens.ts';

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
