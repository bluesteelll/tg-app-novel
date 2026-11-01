// L14b in happy-dom: the overlay menus (PROTOTYPE-PLAN L14b), the story picker (STORIES-PLAN Y14, Y15), the meta entry
// points (META-PLAN M9, M27) and the keys this lane declares for the puzzle, explore and hint UIs. Components render
// through @testing-library/svelte. Events are built by hand where `detail` matters: a pointer click has detail >= 1, a
// keyboard or assistive-technology activation has detail 0 (as in choices.svelte.test.ts).
import { cleanup, render, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';

import type { SaveSlot } from '../api/generated/api.ts';
import { en } from '../i18n/en.ts';
import { t, type Lang, type UiKey } from '../i18n/index.ts';
import { ru } from '../i18n/ru.ts';
import type { PurchaseState } from '../purchase/flow.ts';
import type { ManualSlot } from '../saves/service.ts';
import type { Settings } from '../settings/store.ts';
import type { StoryId } from '../story/catalog.ts';
import type { ChapterId, LineId, OrderId, ProductId } from '../story/staging.ts';
import Backlog from './Backlog.svelte';
import type { BacklogLine } from './Backlog.svelte';
import ChapterSelect from './ChapterSelect.svelte';
import type { ChapterRow } from './ChapterSelect.svelte';
import Menu from './Menu.svelte';
import Notice from './Notice.svelte';
import type { NoticeView } from './Notice.svelte';
import Paywall from './Paywall.svelte';
import SaveLoad from './SaveLoad.svelte';
import type { SlotView } from './SaveLoad.svelte';
// Imported under another name: `Settings` is the store's type.
import SettingsScreen from './Settings.svelte';
import StoryPicker from './StoryPicker.svelte';
import type { StoryCardView } from './StoryPicker.svelte';
import Terms from './Terms.svelte';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here.
afterEach(() => cleanup());

const RU: Readonly<Record<string, string>> = ru;
const EN: Readonly<Record<string, string>> = en;
const LANGS: readonly Lang[] = ['ru', 'en'];

/** The `{name}` placeholders of a template, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '').sort();
}

const down = (el: Element): void => {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
};
/** A pointer click with no pointerdown before it: the release of a press that began before the screen showed. */
const pointerClick = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
};
/** A keyboard or assistive-technology activation. */
const keyClick = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
};
/** A full pointer tap: pointerdown, then the click it produces; the DOM is not updated yet (a double tap). */
const rawTap = (el: Element): void => {
  down(el);
  pointerClick(el);
};
/** A full pointer tap, then Svelte's batched DOM update. */
const tap = (el: Element): void => {
  rawTap(el);
  flushSync();
};

/** The rendered text with runs of whitespace as one space. */
const shown = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const names = (els: readonly Element[]): string[] => els.map(shown);

// ---------------------------------------------------------------------------------------------------------------
// The keys declared for LX and LP2 (C2)

/**
 * The puzzle and explore keys (PROTOTYPE-PLAN "Changed by PUZZLES-PLAN"), with the hint group as META-PLAN M21 rewrote
 * it: no `buy`, `owned`, `terms` or `confirming` (no hint purchase), and no `locked` (LP2's ladder shows only the next
 * usable tier).
 */
const PREDECLARED = {
  explore: ['bar_inventory', 'bar_reveal', 'room_back', 'area_reset'],
  inv: ['items', 'files', 'empty', 'got_item', 'got_doc'],
  doc: ['close'],
  lock: ['slot_empty', 'no_fit', 'examine', 'locked'],
  puzzle: [
    'try',
    'checking',
    'wrong',
    'solved',
    'failed',
    'attempts_left',
    'give_up',
    'give_up_confirm',
    'give_up_yes',
    'hint',
    'offline',
    'rate_limited',
    'load_failed',
    'retry',
    'dial_up',
    'dial_down',
    'swap',
  ],
  hint: ['title', 'tier', 'use', 'unlocked', 'balance', 'get_more', 'unavailable', 'failed'],
} as const;

/** The plan's placeholders per key; every other declared key has none. */
const PREDECLARED_PLACEHOLDERS: Readonly<Record<string, readonly string[]>> = {
  'inv.got_item': ['name'],
  'inv.got_doc': ['title'],
  'puzzle.attempts_left': ['n'],
  'puzzle.rate_limited': ['s'],
  'hint.tier': ['n'],
  'hint.use': ['n'],
  'hint.balance': ['n'],
};

test('i18n: puzzle and explore keys declared', () => {
  for (const [group, names] of Object.entries(PREDECLARED)) {
    const want = names.map((n) => `${group}.${n}`).sort();
    const inGroup = (table: Readonly<Record<string, string>>): string[] =>
      Object.keys(table)
        .filter((k) => k.startsWith(`${group}.`))
        .sort();
    expect(inGroup(RU), `ru ${group}`).toEqual(want);
    expect(inGroup(EN), `en ${group}`).toEqual(want);
    for (const key of want) {
      expect(placeholders(RU[key] ?? ''), key).toEqual(PREDECLARED_PLACEHOLDERS[key] ?? []);
    }
  }
  // M9's toast rides the entry tables, so it shows before the meta chunk has loaded.
  expect(Object.keys(RU)).toContain('meta.card_later');
  expect(Object.keys(EN)).toContain('meta.card_later');
  expect(placeholders(RU['meta.card_later'] ?? '')).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// The full-screen notices (C3)

/** Each kind's title, body and actions (cut §1c). */
const NOTICE_COPY: ReadonlyArray<readonly [NoticeView['kind'], UiKey, UiKey | null, readonly UiKey[]]> = [
  ['open_in_telegram', 'notice.open_in_telegram_title', 'notice.open_in_telegram_body', []],
  ['reopen', 'notice.reopen_title', 'notice.reopen_body', []],
  ['error', 'notice.error_title', 'notice.error_body', ['notice.error_action']],
  ['story_error', 'notice.story_error_title', 'notice.story_error_body', ['notice.story_error_action']],
  ['to_be_continued', 'notice.to_be_continued_title', null, ['notice.to_be_continued_action']],
  ['the_end', 'notice.the_end_title', null, ['notice.the_end_action']],
];

/** A new notice object of `kind`: each one is a presentation of its own. */
function noticeOf(kind: NoticeView['kind'], onaction: () => void): NoticeView {
  switch (kind) {
    case 'open_in_telegram':
    case 'reopen':
      return { kind };
    case 'error':
    case 'story_error':
    case 'to_be_continued':
    case 'the_end':
      return { kind, onaction };
  }
}

test('menus: notice kinds show their actions', async () => {
  for (const lang of LANGS) {
    for (const [kind, title, body, actions] of NOTICE_COPY) {
      const where = `${lang} ${kind}`;
      const onaction = vi.fn();
      const { container, getByRole, queryAllByRole, rerender } = render(Notice, { notice: noticeOf(kind, onaction), lang });
      expect(shown(getByRole('heading')), where).toBe(t(lang, title));
      expect(names([...container.querySelectorAll('p')]), where).toEqual(body === null ? [] : [t(lang, body)]);
      expect(names(queryAllByRole('button')), where).toEqual(actions.map((key) => t(lang, key)));
      if (actions.length > 0) {
        tap(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(1);
        // One action per presentation: a second tap (Retry, Return to last save) does not run it again.
        tap(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(1);
        // A new notice object is a new presentation. Rule (b): the release of a press that began before it showed
        // does not count, a keyboard activation does.
        await rerender({ notice: noticeOf(kind, onaction) });
        pointerClick(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(1);
        keyClick(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(2);
        tap(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(2);
      }
      cleanup();
    }
  }
});

test('menus: the end offers the card when it exists', () => {
  for (const lang of LANGS) {
    const onaction = vi.fn();
    const oncard = vi.fn();
    const { getAllByRole, getByRole } = render(Notice, { notice: { kind: 'the_end', onaction, oncard }, lang });
    expect(names(getAllByRole('button'))).toEqual([t(lang, 'notice.the_end_action'), t(lang, 'notice.the_end_card')]);
    const card = getByRole('button', { name: t(lang, 'notice.the_end_card') });
    tap(card);
    expect(oncard).toHaveBeenCalledTimes(1);
    // The card action is a retry (M9: a flush or a card request that failed), so it is never latched.
    tap(card);
    expect(oncard).toHaveBeenCalledTimes(2);
    pointerClick(card);
    expect(oncard).toHaveBeenCalledTimes(2);
    expect(onaction).not.toHaveBeenCalled();
    cleanup();

    const without = render(Notice, { notice: { kind: 'the_end', onaction }, lang });
    expect(names(without.getAllByRole('button'))).toEqual([t(lang, 'notice.the_end_action')]);
    cleanup();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The menu, the backlog and the terms (C4)

test('menus: menu has back to stories', () => {
  for (const lang of LANGS) {
    const calls: string[] = [];
    const { getByRole, getAllByRole } = render(Menu, {
      lang,
      onsaves: () => calls.push('saves'),
      onsettings: () => calls.push('settings'),
      onstories: () => calls.push('stories'),
    });
    expect(shown(getByRole('heading')), lang).toBe(t(lang, 'menu.title'));
    const items = getAllByRole('button');
    expect(names(items), lang).toEqual([t(lang, 'menu.saves'), t(lang, 'menu.settings'), t(lang, 'menu.back_to_stories')]);
    // Each tap calls back at once, inside the click (no await, no DOM update in between).
    rawTap(getByRole('button', { name: t(lang, 'menu.back_to_stories') }));
    expect(calls, lang).toEqual(['stories']);
    rawTap(getByRole('button', { name: t(lang, 'menu.saves') }));
    expect(calls, lang).toEqual(['stories', 'saves']);
    rawTap(getByRole('button', { name: t(lang, 'menu.settings') }));
    expect(calls, lang).toEqual(['stories', 'saves', 'settings']);
    cleanup();
  }
});

test('menus: backlog lists lines in order as text', () => {
  const lines: readonly BacklogLine[] = [
    { lineId: 'ch1.hall.0001' as LineId, speaker: '<i>Ally</i>', text: 'The door creaks.', chosen: null },
    { lineId: 'ch1.hall.0002' as LineId, speaker: null, text: '<b>x</b>', chosen: '<u>y</u>' },
    // A loop shows the same line again: its ID repeats in the backlog.
    { lineId: 'ch1.hall.0001' as LineId, speaker: '<i>Ally</i>', text: 'The door creaks.', chosen: null },
    { lineId: 'ch1.hall.0003' as LineId, speaker: null, text: 'Night falls.', chosen: null },
  ];
  for (const lang of LANGS) {
    const { container, getByRole } = render(Backlog, { lines, lang });
    expect(shown(getByRole('heading')), lang).toBe(t(lang, 'backlog.title'));
    const rows = [...container.querySelectorAll('[data-line-id]')];
    expect(
      rows.map((r) => r.getAttribute('data-line-id')),
      lang,
    ).toEqual(['ch1.hall.0001', 'ch1.hall.0002', 'ch1.hall.0001', 'ch1.hall.0003']);
    // Story text is text, never markup (principle 8, spec 5): the tags show as characters.
    expect(container.querySelector('b, i, u'), lang).toBeNull();
    expect(shown(rows[0] ?? container), lang).toBe('<i>Ally</i> The door creaks.');
    expect(shown(rows[1] ?? container), lang).toBe(`<b>x</b> ${t(lang, 'backlog.chosen', { choice: '<u>y</u>' })}`);
    expect(shown(container), lang).not.toContain(t(lang, 'backlog.empty'));
    cleanup();

    const empty = render(Backlog, { lines: [], lang });
    expect(empty.container.querySelector('[data-line-id]'), lang).toBeNull();
    expect(shown(empty.container), lang).toContain(t(lang, 'backlog.empty'));
    cleanup();
  }
});

test('menus: terms render in the app, links only by callback', () => {
  for (const lang of LANGS) {
    const { container, getByRole, queryAllByRole } = render(Terms, { lang });
    expect(shown(getByRole('heading')), lang).toBe(t(lang, 'terms.title'));
    expect(names([...container.querySelectorAll('p')]), lang).toEqual([t(lang, 'terms.body'), t(lang, 'terms.support')]);
    expect(queryAllByRole('button'), lang).toEqual([]);
    expect(container.querySelector('a'), lang).toBeNull();
    cleanup();

    const onpolicy = vi.fn();
    const linked = render(Terms, { lang, onpolicy });
    expect(names(linked.getAllByRole('button')), lang).toEqual([t(lang, 'terms.policy')]);
    tap(linked.getByRole('button'));
    expect(onpolicy, lang).toHaveBeenCalledTimes(1);
    expect(linked.container.querySelector('a'), lang).toBeNull();
    cleanup();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The story picker and the chapter select (C5)

const storyId = (id: string): StoryId => id as StoryId;

/** A story card with no cover, no save and no ending yet; the title carries markup, which must show as text. */
function cardOf(id: string, over: Partial<StoryCardView> = {}): StoryCardView {
  return {
    id: storyId(id),
    title: `<b>${id}</b>`,
    teaser: `A ${id} teaser.`,
    cover: null,
    continue: false,
    eager: false,
    card: false,
    ...over,
  };
}

/** The picker's callbacks, each recording `<name> <story>` at the moment it is called. */
function pickerProps(cards: readonly StoryCardView[], lang: Lang, calls: string[]) {
  return {
    cards,
    lang,
    onstart: (id: StoryId) => calls.push(`start ${id}`),
    oncontinue: (id: StoryId) => calls.push(`continue ${id}`),
    onchapters: (id: StoryId) => calls.push(`chapters ${id}`),
    oncard: (id: StoryId) => calls.push(`card ${id}`),
  };
}

/** The card element of story `id`. */
function cardEl(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-story="${id}"]`);
  expect(el, id).not.toBeNull();
  return el ?? container;
}

test('menus: story picker shows start or continue per story', () => {
  for (const lang of LANGS) {
    const calls: string[] = [];
    const cards = [cardOf('manor'), cardOf('tide', { continue: true })];
    const { container } = render(StoryPicker, pickerProps(cards, lang, calls));
    expect([...container.querySelectorAll('[data-story]')].map((el) => el.getAttribute('data-story')), lang).toEqual([
      'manor',
      'tide',
    ]);
    const manor = within(cardEl(container, 'manor'));
    const tide = within(cardEl(container, 'tide'));
    // `continue` is the caller's (a save of that story exists): Start xor Continue, and Chapters on both.
    expect(names(manor.getAllByRole('button')), lang).toEqual([t(lang, 'stories.start'), t(lang, 'stories.chapters')]);
    expect(names(tide.getAllByRole('button')), lang).toEqual([t(lang, 'stories.continue'), t(lang, 'stories.chapters')]);
    // Each callback runs inside the tap, so the caller's unlockAudio() is in the gesture (SP Y14, F1).
    rawTap(manor.getByRole('button', { name: t(lang, 'stories.start') }));
    expect(calls, lang).toEqual(['start manor']);
    rawTap(tide.getByRole('button', { name: t(lang, 'stories.continue') }));
    expect(calls, lang).toEqual(['start manor', 'continue tide']);
    rawTap(manor.getByRole('button', { name: t(lang, 'stories.chapters') }));
    rawTap(tide.getByRole('button', { name: t(lang, 'stories.chapters') }));
    expect(calls, lang).toEqual(['start manor', 'continue tide', 'chapters manor', 'chapters tide']);
    // Titles and teasers are text.
    expect(container.querySelector('b'), lang).toBeNull();
    expect(shown(cardEl(container, 'manor')), lang).toContain('<b>manor</b> A manor teaser.');
    cleanup();
  }
});

test('menus: story picker shows the card button only after an ending', () => {
  for (const lang of LANGS) {
    const calls: string[] = [];
    const cards = [cardOf('manor', { card: true }), cardOf('tide', { continue: true })];
    const { container } = render(StoryPicker, pickerProps(cards, lang, calls));
    const manor = within(cardEl(container, 'manor'));
    const tide = within(cardEl(container, 'tide'));
    expect(names(manor.getAllByRole('button')), lang).toEqual([
      t(lang, 'stories.start'),
      t(lang, 'stories.chapters'),
      t(lang, 'stories.card'),
    ]);
    expect(tide.queryByRole('button', { name: t(lang, 'stories.card') }), lang).toBeNull();
    tap(manor.getByRole('button', { name: t(lang, 'stories.card') }));
    expect(calls, lang).toEqual(['card manor']);
    cleanup();
  }
});

test('menus: story covers load lazily unless eager', () => {
  const cover = (id: string) => ({ avif: `/assets/cover/${id}.a1.avif`, webp: `/assets/cover/${id}.w1.webp` });
  const cards = [
    cardOf('manor', { cover: cover('manor'), eager: true }),
    cardOf('tide', { cover: cover('tide') }),
    cardOf('ash'),
  ];
  const { container } = render(StoryPicker, pickerProps(cards, 'ru', []));
  for (const [id, eager] of [
    ['manor', true],
    ['tide', false],
  ] as const) {
    const card = cardEl(container, id);
    const source = card.querySelector('picture > source');
    const img = card.querySelector('picture > img');
    expect(source?.getAttribute('type'), id).toBe('image/avif');
    expect(source?.getAttribute('srcset'), id).toBe(cover(id).avif);
    expect(img?.getAttribute('src'), id).toBe(cover(id).webp);
    // The budget's exact cover size (PP "Budgets"), decoded off the main thread, and decorative (the title follows).
    expect(img?.getAttribute('width'), id).toBe('360');
    expect(img?.getAttribute('height'), id).toBe('640');
    expect(img?.getAttribute('decoding'), id).toBe('async');
    expect(img?.getAttribute('alt'), id).toBe('');
    expect(img?.getAttribute('loading'), id).toBe(eager ? null : 'lazy');
  }
  const ash = cardEl(container, 'ash');
  expect(ash.querySelector('picture'), 'ash').toBeNull();
  expect(ash.querySelector('img'), 'ash').toBeNull();
});

test('menus: chapter select lists only its story', () => {
  const chapters: readonly ChapterRow[] = [
    { id: 'ch1' as ChapterId, title: '<b>Arrival</b>', locked: false },
    { id: 'ch3' as ChapterId, title: 'The cellar', locked: true },
    { id: 'ch2' as ChapterId, title: 'The garden', locked: false },
  ];
  for (const lang of LANGS) {
    const picked: ChapterId[] = [];
    const { container, getByRole, getAllByRole } = render(ChapterSelect, {
      story: '<i>The Manor</i>',
      chapters,
      lang,
      onchapter: (id: ChapterId) => picked.push(id),
    });
    expect(shown(getByRole('heading')), lang).toBe(t(lang, 'chapters.title', { story: '<i>The Manor</i>' }));
    // Exactly the given rows, in the given order; the paid-and-not-owned one says so.
    expect(names(getAllByRole('button')), lang).toEqual([
      '<b>Arrival</b>',
      `The cellar ${t(lang, 'chapters.locked')}`,
      'The garden',
    ]);
    expect(container.querySelector('b, i'), lang).toBeNull();
    rawTap(getByRole('button', { name: /^The cellar/ }));
    expect(picked, lang).toEqual(['ch3']);
    cleanup();
  }
  // The select gets one story's chapters from its caller, never the catalog to filter.
  // @ts-expect-error: ChapterSelect takes no catalog
  render(ChapterSelect, { story: 'x', chapters, lang: 'en', onchapter: () => {}, catalog: [] });
});

test('menus: friends and wallet entries only when given', () => {
  for (const lang of LANGS) {
    const menuBase = { lang, onsaves: () => {}, onsettings: () => {}, onstories: () => {} };
    const bare = render(Menu, menuBase);
    for (const key of ['menu.friends', 'menu.wallet'] as const) {
      expect(bare.queryByRole('button', { name: t(lang, key) }), `${lang} ${key}`).toBeNull();
    }
    cleanup();

    const onfriends = vi.fn();
    const onwallet = vi.fn();
    const menu = render(Menu, { ...menuBase, onfriends, onwallet });
    expect(names(menu.getAllByRole('button')), lang).toEqual([
      t(lang, 'menu.saves'),
      t(lang, 'menu.settings'),
      t(lang, 'menu.friends'),
      t(lang, 'menu.wallet'),
      t(lang, 'menu.back_to_stories'),
    ]);
    tap(menu.getByRole('button', { name: t(lang, 'menu.friends') }));
    tap(menu.getByRole('button', { name: t(lang, 'menu.wallet') }));
    expect([onfriends.mock.calls.length, onwallet.mock.calls.length], lang).toEqual([1, 1]);
    cleanup();

    const picker = render(StoryPicker, pickerProps([cardOf('manor')], lang, []));
    for (const key of ['stories.friends', 'stories.wallet'] as const) {
      expect(picker.queryByRole('button', { name: t(lang, key) }), `${lang} ${key}`).toBeNull();
    }
    cleanup();

    const homeFriends = vi.fn();
    const homeWallet = vi.fn();
    const home = render(StoryPicker, {
      ...pickerProps([cardOf('manor')], lang, []),
      onfriends: homeFriends,
      onwallet: homeWallet,
    });
    tap(home.getByRole('button', { name: t(lang, 'stories.friends') }));
    tap(home.getByRole('button', { name: t(lang, 'stories.wallet') }));
    expect([homeFriends.mock.calls.length, homeWallet.mock.calls.length], lang).toEqual([1, 1]);
    cleanup();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The settings screen (C6)

/** The element as an input, or a failed test. */
function inputOf(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`invariant: <${el.tagName.toLowerCase()}> is not an input`);
  }
  return el;
}

test('menus: settings emit speed, volume, language and skip', async () => {
  for (const lang of LANGS) {
    // Frozen, so a component that wrote into its props would throw.
    const fixture: Settings = Object.freeze({
      lang: null,
      speed: 'normal',
      volume: Object.freeze({ master: 80, bgm: 60, sfx: 100 }),
      skipUnread: false,
    });
    const emitted: Settings[] = [];
    const { getByRole, rerender } = render(SettingsScreen, {
      settings: fixture,
      lang,
      onchange: (next: Settings) => emitted.push(next),
    });
    const radio = (name: string): HTMLInputElement => inputOf(getByRole('radio', { name }));
    expect(shown(getByRole('heading')), lang).toBe(t(lang, 'settings.title'));

    // Every control shows the props.
    expect(radio(t(lang, 'settings.speed_normal')).checked, lang).toBe(true);
    const bgm = inputOf(getByRole('slider', { name: t(lang, 'settings.volume_bgm') }));
    expect(
      [t(lang, 'settings.volume_master'), t(lang, 'settings.volume_bgm'), t(lang, 'settings.volume_sfx')].map(
        (name) => inputOf(getByRole('slider', { name })).value,
      ),
      lang,
    ).toEqual(['80', '60', '100']);
    // `lang` null follows the account's language, so the UI language is the one checked.
    expect([radio('Русский').checked, radio('English').checked], lang).toEqual([lang === 'ru', lang === 'en']);
    expect(inputOf(getByRole('checkbox', { name: t(lang, 'settings.skip_unread') })).checked, lang).toBe(false);

    // Each change emits the whole next Settings, a new object.
    radio(t(lang, 'settings.speed_fast')).click();
    expect(emitted.at(-1), lang).toStrictEqual({ ...fixture, speed: 'fast' });
    bgm.value = '40';
    bgm.dispatchEvent(new Event('input', { bubbles: true }));
    expect(emitted.at(-1)?.volume.bgm, lang).toBe(40);
    expect(emitted.at(-1), lang).toStrictEqual({ ...fixture, volume: { master: 80, bgm: 40, sfx: 100 } });
    // Each language is labelled in itself, whatever the UI language. The UI language is checked already (`lang`
    // null), so the other one is tapped first.
    const [other, own] = lang === 'ru' ? (['en', 'ru'] as const) : (['ru', 'en'] as const);
    const endonym = { ru: 'Русский', en: 'English' } as const;
    radio(endonym[other]).click();
    expect(emitted.at(-1), lang).toStrictEqual({ ...fixture, lang: other });
    radio(endonym[own]).click();
    expect(emitted.at(-1), lang).toStrictEqual({ ...fixture, lang: own });
    inputOf(getByRole('checkbox', { name: t(lang, 'settings.skip_unread') })).click();
    expect(emitted.at(-1), lang).toStrictEqual({ ...fixture, skipUnread: true });
    expect(emitted.every((s) => s !== fixture), lang).toBe(true);

    await rerender({ settings: { ...fixture, speed: 'slow', lang: 'en' } });
    expect(radio(t(lang, 'settings.speed_slow')).checked, lang).toBe(true);
    expect(radio(t(lang, 'settings.speed_fast')).checked, lang).toBe(false);
    expect([radio('Русский').checked, radio('English').checked], lang).toEqual([false, true]);
    cleanup();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Save and load (C7)

/** The row element of `slot`. */
function slotEl(container: HTMLElement, slot: SaveSlot): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  expect(el, slot).not.toBeNull();
  return el ?? container;
}

/** The blocks of a save row under its label, top to bottom (the row is a flex column): the text and buttons of each. */
function blocksUnderLabel(row: HTMLElement): Array<{ text: string; buttons: string[] }> {
  const [label, ...blocks] = [...row.children];
  expect(label?.classList.contains('label'), 'the label comes first').toBe(true);
  return blocks.map((b) => ({ text: shown(b), buttons: names([...b.querySelectorAll('button')]) }));
}

test('menus: save asks before overwriting, one save per tap', async () => {
  const savedAt = 1_790_000_000;
  // Out of order on purpose: a row is found by its slot, never by its position in the list (LS2 D4).
  const slots: readonly SlotView[] = [
    { slot: 's2', savedAt, chapter: '<b>Два</b>' },
    { slot: 'auto', savedAt: savedAt + 60, chapter: 'Пролог' },
  ];
  for (const lang of LANGS) {
    const onsave = vi.fn<(slot: ManualSlot) => void>();
    const onoverwrite = vi.fn<(slot: ManualSlot) => void>();
    const oncancel = vi.fn<() => void>();
    const onload = vi.fn<(slot: SaveSlot) => void>();
    const base = { slots, lang, saving: null, conflict: null, failed: null, onsave, onoverwrite, oncancel, onload };
    const { container, getByRole, getAllByRole, rerender } = render(SaveLoad, base);
    const row = (slot: SaveSlot) => within(slotEl(container, slot));
    const [save, load, yes, no] = [t(lang, 'saves.save'), t(lang, 'saves.load'), t(lang, 'saves.yes'), t(lang, 'saves.no')];
    const time = (s: number): string =>
      new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s * 1000));
    const saveDisabled = (): boolean[] => getAllByRole('button', { name: save }).map((b) => b.hasAttribute('disabled'));

    expect(shown(getByRole('heading')), lang).toBe(t(lang, 'saves.title'));
    expect([...container.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')), lang).toEqual([
      'auto',
      's1',
      's2',
      's3',
    ]);
    expect(shown(slotEl(container, 'auto')), lang).toBe(
      `${t(lang, 'saves.auto')} ${t(lang, 'saves.info', { chapter: 'Пролог', time: time(savedAt + 60) })} ${load}`,
    );
    expect(shown(slotEl(container, 's2')), lang).toBe(
      `${t(lang, 'saves.slot', { n: 2 })} ${t(lang, 'saves.info', { chapter: '<b>Два</b>', time: time(savedAt) })} ${load} ${save}`,
    );
    expect(shown(slotEl(container, 's1')), lang).toBe(`${t(lang, 'saves.slot', { n: 1 })} ${t(lang, 'saves.empty')} ${save}`);
    expect(container.querySelector('b'), lang).toBeNull();
    // `auto` is loaded only; an empty row has no Load.
    expect(names(row('auto').getAllByRole('button')), lang).toEqual([load]);
    expect(names(row('s3').getAllByRole('button')), lang).toEqual([save]);

    // An empty row saves at once.
    tap(row('s1').getByRole('button', { name: save }));
    expect(onsave.mock.calls, lang).toEqual([['s1']]);
    expect(shown(container), lang).not.toContain(t(lang, 'saves.overwrite_ask'));
    // In flight: the row says so, and every Save is disabled.
    await rerender({ saving: 's1' });
    expect(shown(slotEl(container, 's1')), lang).toContain(t(lang, 'saves.saving'));
    expect(saveDisabled(), lang).toEqual([true, true, true]);
    tap(row('s3').getByRole('button', { name: save }));
    expect(onsave.mock.calls, lang).toEqual([['s1']]);
    // A failed save says so on its row (critique W2), and Save is open again.
    await rerender({ saving: null, failed: 's1' });
    expect(shown(slotEl(container, 's1')), lang).toContain(t(lang, 'saves.failed'));
    expect(row('s1').getByRole('alert').textContent, lang).toBe(t(lang, 'saves.failed'));
    expect(saveDisabled(), lang).toEqual([false, false, false]);

    // An occupied row asks first: No drops the ask, Yes saves once, however often it is tapped (critique W1).
    // The ask fills the block that held Save with the question and No, and gives Yes a block of its own below it: the
    // second tap of a double tap on Save meets the question or No, never Yes (triage I1).
    expect(blocksUnderLabel(slotEl(container, 's2')), lang).toEqual([{ text: `${load} ${save}`, buttons: [load, save] }]);
    tap(row('s2').getByRole('button', { name: save }));
    expect(shown(slotEl(container, 's2')), lang).toContain(t(lang, 'saves.overwrite_ask'));
    expect(onsave.mock.calls, lang).toEqual([['s1']]);
    expect(blocksUnderLabel(slotEl(container, 's2')), lang).toEqual([
      { text: `${t(lang, 'saves.overwrite_ask')} ${no}`, buttons: [no] },
      { text: yes, buttons: [yes] },
    ]);
    tap(row('s2').getByRole('button', { name: no }));
    expect(shown(container), lang).not.toContain(t(lang, 'saves.overwrite_ask'));
    expect(onsave.mock.calls, lang).toEqual([['s1']]);
    tap(row('s2').getByRole('button', { name: save }));
    const overwriteYes = row('s2').getByRole('button', { name: yes });
    rawTap(overwriteYes);
    rawTap(overwriteYes);
    flushSync();
    expect(onsave.mock.calls, lang).toEqual([['s1'], ['s2']]);
    expect(shown(container), lang).not.toContain(t(lang, 'saves.overwrite_ask'));

    // One action per tap (L10 review M3): a double tap lands before `saving` arrives and still saves once.
    await rerender({ failed: null, slots: [...slots] });
    const s3 = row('s3').getByRole('button', { name: save });
    rawTap(s3);
    rawTap(s3);
    flushSync();
    expect(onsave.mock.calls, lang).toEqual([['s1'], ['s2'], ['s3']]);
    await rerender({ saving: 's3' });
    expect(saveDisabled(), lang).toEqual([true, true, true]);
    await rerender({ saving: null });
    expect(saveDisabled(), lang).toEqual([false, false, false]);
    tap(row('s3').getByRole('button', { name: save }));
    expect(onsave.mock.calls, lang).toEqual([['s1'], ['s2'], ['s3'], ['s3']]);

    // Load by slot.
    tap(row('s2').getByRole('button', { name: load }));
    tap(row('auto').getByRole('button', { name: load }));
    expect(onload.mock.calls, lang).toEqual([['s2'], ['auto']]);
    cleanup();

    // The server's 409 on a manual slot (F3): Yes overwrites once however often it is tapped, and is disabled while
    // the overwrite is in flight (critique W1).
    const conflicted = render(SaveLoad, { ...base, conflict: 's1' });
    const s1 = within(slotEl(conflicted.container, 's1'));
    expect(shown(slotEl(conflicted.container, 's1')), lang).toContain(t(lang, 'saves.conflict_ask'));
    expect(names(s1.getAllByRole('button')), lang).toEqual([yes, no]);
    const conflictYes = s1.getByRole('button', { name: yes });
    rawTap(conflictYes);
    rawTap(conflictYes);
    flushSync();
    expect(onoverwrite.mock.calls, lang).toEqual([['s1']]);
    expect(oncancel, lang).not.toHaveBeenCalled();
    await conflicted.rerender({ saving: 's1' });
    expect(
      s1.getAllByRole('button').map((b) => b.hasAttribute('disabled')),
      lang,
    ).toEqual([true, true]);
    cleanup();

    const declined = render(SaveLoad, { ...base, conflict: 's1' });
    tap(within(slotEl(declined.container, 's1')).getByRole('button', { name: no }));
    expect(oncancel, lang).toHaveBeenCalledTimes(1);
    expect(onoverwrite.mock.calls, lang).toEqual([['s1']]);
    expect(onsave.mock.calls.length, lang).toBe(4);
    cleanup();

    // The latch ends at the next change of any answer, `saving` alone included. rerender() replaces the whole props
    // object at once, so here `saving` is a signal of its own.
    let liveSaving = $state<ManualSlot | null>(null);
    const live = render(SaveLoad, {
      ...base,
      get saving() {
        return liveSaving;
      },
    });
    const liveSave = (): HTMLElement => within(slotEl(live.container, 's3')).getByRole('button', { name: save });
    tap(liveSave());
    expect(onsave.mock.calls.length, lang).toBe(5);
    liveSaving = 's3';
    flushSync();
    liveSaving = null;
    flushSync();
    expect(liveSave().hasAttribute('disabled'), lang).toBe(false);
    tap(liveSave());
    expect(onsave.mock.calls.length, lang).toBe(6);
    cleanup();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The paywall (C8)

const PRICE = 37;

/** The paywall's props with spies; the price is the server's `ProductDto.priceStars`. */
function paywallProps(state: PurchaseState, lang: Lang, priceStars: number | null = PRICE) {
  return {
    chapter: 'The Cellar',
    priceStars,
    state,
    lang,
    onbuy: vi.fn<() => void>(),
    oncheckagain: vi.fn<() => void>(),
    onterms: vi.fn<() => void>(),
    onretry: vi.fn<() => void>(),
  };
}

/** Every number on screen: the price is shown verbatim, never computed. */
const numbersIn = (el: Element): string[] => [...(el.textContent ?? '').matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);

test('menus: paywall needs terms checkbox', async () => {
  for (const lang of LANGS) {
    const p = paywallProps({ kind: 'idle' }, lang);
    const { getByRole, rerender } = render(Paywall, p);
    const box = inputOf(getByRole('checkbox', { name: t(lang, 'paywall.terms_agree') }));
    const buy = (): HTMLElement => getByRole('button', { name: t(lang, 'paywall.buy', { n: PRICE }) });
    // P1: the box starts unchecked, and Buy waits for it.
    expect(box.checked, lang).toBe(false);
    expect(buy().hasAttribute('disabled'), lang).toBe(true);
    tap(buy());
    expect(p.onbuy, lang).not.toHaveBeenCalled();
    // The Terms link opens the in-app terms (the caller's overlay).
    tap(getByRole('button', { name: t(lang, 'paywall.terms_link') }));
    expect(p.onterms, lang).toHaveBeenCalledTimes(1);
    box.click();
    flushSync();
    expect(buy().hasAttribute('disabled'), lang).toBe(false);
    // Buy asks the caller, inside the tap; the paywall never starts a purchase itself.
    rawTap(buy());
    expect(p.onbuy, lang).toHaveBeenCalledTimes(1);
    // P2: disabled while the invoice is being created.
    await rerender({ state: { kind: 'requesting' } });
    expect(buy().hasAttribute('disabled'), lang).toBe(true);
    tap(buy());
    expect(p.onbuy, lang).toHaveBeenCalledTimes(1);
    cleanup();

    // Every open starts unchecked again.
    const again = render(Paywall, paywallProps({ kind: 'idle' }, lang));
    expect(inputOf(again.getByRole('checkbox')).checked, lang).toBe(false);
    expect(again.getByRole('button', { name: t(lang, 'paywall.buy', { n: PRICE }) }).hasAttribute('disabled'), lang).toBe(
      true,
    );
    cleanup();
  }
});

test('menus: paywall shows the purchase states', () => {
  const orderId = 'order-1' as OrderId;
  const product = 'chapter:ch2' as ProductId;
  /** Each P1-P8 state: the note it shows, whether the form (box, Terms, Buy) shows, Buy busy, and Check again. */
  const rows: ReadonlyArray<{ state: PurchaseState; note: UiKey | null; form: boolean; busy?: boolean; check?: boolean }> = [
    { state: { kind: 'idle' }, note: null, form: true },
    { state: { kind: 'failed', reason: 'cancelled' }, note: null, form: true },
    { state: { kind: 'failed', reason: 'failed' }, note: null, form: true },
    { state: { kind: 'requesting' }, note: null, form: true, busy: true },
    { state: { kind: 'sheet', orderId }, note: 'paywall.sheet', form: false, check: true },
    { state: { kind: 'confirming', orderId, since: 0 }, note: 'paywall.confirming', form: false },
    { state: { kind: 'delayed', orderId }, note: 'paywall.delayed', form: false, check: true },
    { state: { kind: 'failed', reason: 'network' }, note: 'paywall.error_network', form: true },
    { state: { kind: 'failed', reason: 'telegram' }, note: 'paywall.error_telegram', form: true },
    { state: { kind: 'failed', reason: 'unknown-product' }, note: 'paywall.unavailable', form: false },
    { state: { kind: 'unlocked', product }, note: 'paywall.unlocked', form: false },
  ];
  const NOTES: readonly UiKey[] = [
    'paywall.sheet',
    'paywall.confirming',
    'paywall.delayed',
    'paywall.error_network',
    'paywall.error_telegram',
    'paywall.unavailable',
    'paywall.unlocked',
    'paywall.load_failed',
  ];
  for (const lang of LANGS) {
    for (const row of rows) {
      const where = `${lang} ${row.state.kind}${row.state.kind === 'failed' ? `:${row.state.reason}` : ''}`;
      const p = paywallProps(row.state, lang);
      const { container, getByRole, queryByRole } = render(Paywall, p);
      expect(shown(getByRole('heading')), where).toBe('The Cellar');
      expect(shown(container), where).toContain(t(lang, 'paywall.body'));
      expect(
        NOTES.filter((key) => shown(container).includes(t(lang, key))),
        where,
      ).toEqual(row.note === null ? [] : [row.note]);
      const buy = queryByRole('button', { name: t(lang, 'paywall.buy', { n: PRICE }) });
      expect([queryByRole('checkbox') !== null, buy !== null], where).toEqual([row.form, row.form]);
      expect(numbersIn(container), where).toEqual(row.form ? [String(PRICE)] : []);
      if (buy !== null) {
        inputOf(getByRole('checkbox')).click();
        flushSync();
        expect(buy.hasAttribute('disabled'), where).toBe(row.busy === true);
      }
      const check = queryByRole('button', { name: t(lang, 'paywall.check_again') });
      expect(check !== null, where).toBe(row.check === true);
      if (check !== null) {
        tap(check);
        expect(p.oncheckagain, where).toHaveBeenCalledTimes(1);
      }
      expect(queryByRole('button', { name: t(lang, 'paywall.retry') }), where).toBeNull();
      cleanup();

      // The price read failed (P1): Retry instead of the form; the states past the form show as they are.
      const unpriced = paywallProps(row.state, lang, null);
      const failed = render(Paywall, unpriced);
      const retry = failed.queryByRole('button', { name: t(lang, 'paywall.retry') });
      expect(retry !== null, where).toBe(row.form);
      expect(failed.queryByRole('checkbox'), where).toBeNull();
      expect(failed.queryByRole('button', { name: /⭐/ }), where).toBeNull();
      expect(shown(failed.container).includes(t(lang, 'paywall.load_failed')), where).toBe(row.form);
      if (retry !== null) {
        tap(retry);
        expect(unpriced.onretry, where).toHaveBeenCalledTimes(1);
      }
      cleanup();
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// No literal text and no I/O in this lane's components (C3-C8; principle 8, spec 2 and 4)

/** This lane's nine components; L14a's six and App.svelte (L15) are not among them. */
const MENU_COMPONENTS = [
  'Backlog.svelte',
  'ChapterSelect.svelte',
  'Menu.svelte',
  'Notice.svelte',
  'Paywall.svelte',
  'SaveLoad.svelte',
  'Settings.svelte',
  'StoryPicker.svelte',
  'Terms.svelte',
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

/** A component without its comments, scripts and styles. */
const markupOf = (source: string): string =>
  source.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');

/** Where a component shows a literal string: text nodes and the text attributes, outside scripts and styles. */
function literalText(source: string): string[] {
  const markup = withoutMustaches(markupOf(source));
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

test('i18n: menu components hold no literal text', () => {
  const files = Object.keys(COMPONENT_SOURCES).map((key) => key.replace(/^\.\//, ''));
  // Non-vacuous: every listed component is read, so a renamed or missing file cannot pass.
  expect(files.filter((n) => (MENU_COMPONENTS as readonly string[]).includes(n)).sort()).toEqual([...MENU_COMPONENTS].sort());
  const offenders: string[] = [];
  for (const name of MENU_COMPONENTS) {
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

/** One module reference: `type` when erased (`import type`, `export type … from`, `import('x').T`). */
type ModuleRef = { spec: string; typeOnly: boolean; dynamic: boolean };

/** Every module reference of a component's scripts, read with the TypeScript parser (LU1's reader). */
function moduleRefs(file: string, text: string): ModuleRef[] {
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1] ?? '');
  const out: ModuleRef[] = [];
  for (const script of scripts) {
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        // `import { type X }` keeps the declaration (verbatimModuleSyntax): only `import type` is type-only.
        const typeOnly = node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
        out.push({ spec: node.moduleSpecifier.text, typeOnly, dynamic: false });
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
        const spec = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '<computed>';
        out.push({ spec, typeOnly: node.isTypeOnly, dynamic: false });
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        const spec = arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : '<computed>';
        out.push({ spec, typeOnly: false, dynamic: true });
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        const literal = node.argument.literal;
        out.push({ spec: ts.isStringLiteral(literal) ? literal.text : '<computed>', typeOnly: true, dynamic: false });
      }
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(`${file}.ts`, script, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS));
  }
  return out;
}

/**
 * The I/O a presentational overlay never does (spec 2): network, storage, globals, timers, frame callbacks (critique
 * O6) and listeners outside Svelte's own `on…` attributes. Dialogs and window.open are arch's rules.
 */
const IO_NAMES =
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator|window|globalThis|document|location|indexedDB|postMessage|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|addEventListener)\b/g;

/** A source without its comments (HTML, block and line comments). */
const withoutComments = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

test('menus: components do no I/O', () => {
  const offenders: string[] = [];
  for (const name of MENU_COMPONENTS) {
    const source = COMPONENT_SOURCES[`./${name}`] ?? '';
    const refs = moduleRefs(name, source);
    // Non-vacuous: every component reads the UI tables through t().
    expect(
      refs.filter((r) => !r.typeOnly).map((r) => r.spec),
      name,
    ).toContain('../i18n/index.ts');
    for (const r of refs) {
      if (r.dynamic || (!r.typeOnly && r.spec !== '../i18n/index.ts')) {
        offenders.push(`${name}: ${r.dynamic ? 'dynamic' : 'value'} ${r.spec}`);
      }
    }
    const code = withoutComments(source);
    for (const m of code.matchAll(IO_NAMES)) {
      offenders.push(`${name}: ${m[0]}`);
    }
    // A link leaves the app only through a callback (the facade's openLink is the caller's).
    const markup = markupOf(code);
    if (/<a\b/i.test(markup)) {
      offenders.push(`${name}: <a>`);
    }
    if (/\bhref\b/i.test(markup)) {
      offenders.push(`${name}: href`);
    }
  }
  expect(offenders).toEqual([]);
});
