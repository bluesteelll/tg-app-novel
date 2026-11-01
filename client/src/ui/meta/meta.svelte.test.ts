// LU1 in happy-dom: the meta overlays (META-PLAN M9-M13, M22, M24, M27) and their table. Components render through
// @testing-library/svelte. Events are built by hand where `detail` matters: a pointer click has detail >= 1, a
// keyboard or assistive-technology activation has detail 0 (as in choices.svelte.test.ts).
import { cleanup, render, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

import type { Lang } from '../../i18n/index.ts';
import { CONSENT_TEXT_VERSION, metaEn, metaRu, mt, type MetaKey } from '../../i18n/meta.ts';
import type { EndingName, StoryId } from '../../story/catalog.ts';
import type { ChapterId } from '../../story/staging.ts';
import CompletionCard from './CompletionCard.svelte';
import FriendProfile from './FriendProfile.svelte';
import Friends from './Friends.svelte';
import type { CardData, FriendData, FriendHandle, InviteProps, ProfileData, SocialData } from './index.ts';
import InvitePrompt from './InvitePrompt.svelte';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here.
afterEach(() => cleanup());

const LANGS: readonly Lang[] = ['ru', 'en'];

/** The seven components; their raw sources are what the source pins read. */
const COMPONENT_SOURCES = import.meta.glob<string>('./*.svelte', { query: '?raw', import: 'default', eager: true });

/** The `{name}` placeholders of a template, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '').sort();
}

const down = (el: Element): void => {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
};
/** A pointer click with no pointerdown before it; the DOM is not updated yet. */
const pointerClick = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
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

/**
 * "of" / "из" as a whole word, for a Latin or a Cyrillic text: `\b` is an ASCII boundary, so `/\bиз\b/` never matches
 * "1 из 2" (critique W3); a letter or a digit on either side makes it part of another word.
 */
const OF_WORD = /(?<![\p{L}\p{N}])(?:of|из)(?![\p{L}\p{N}])/iu;

/** The key contract of the meta table, per overlay (cut §1c; `meta.friends_policy` is critique W1's, M26). */
const META_KEYS = [
  // card
  'meta.card_title',
  'meta.card_runs',
  'meta.card_chapters',
  'meta.card_endings',
  'meta.card_achievements',
  'meta.card_new',
  'meta.card_share',
  // friends
  'meta.friends_title',
  'meta.friends_invite',
  'meta.friends_visibility',
  'meta.friends_visibility_on',
  'meta.friends_visibility_off',
  'meta.friends_requests',
  'meta.friends_accept',
  'meta.friends_decline',
  'meta.friends_decline_note',
  'meta.friends_empty',
  'meta.friends_policy',
  // friend
  'meta.friend_hidden',
  'meta.friend_endings',
  'meta.friend_achievements',
  'meta.friend_shared',
  'meta.friend_gift',
  'meta.friend_remove',
  'meta.friend_remove_note',
  'meta.friend_remove_confirm',
  // invite
  'meta.invite_title',
  'meta.invite_body',
  'meta.invite_send',
  'meta.invite_later',
  // consent
  'meta.consent_title',
  'meta.consent_body',
  'meta.consent_switch',
  'meta.consent_policy',
  // wallet
  'meta.wallet_title',
  'meta.wallet_balance',
  'meta.wallet_debt',
  'meta.kind_hint',
  'meta.wallet_packs',
  'meta.wallet_buy',
  'meta.wallet_terms_agree',
  'meta.wallet_terms_link',
  // gift
  'meta.gift_title',
  'meta.gift_amount',
  'meta.gift_less',
  'meta.gift_more',
  'meta.gift_send',
  'meta.gift_capped',
  'meta.gift_retry',
  'meta.gift_insufficient',
  'meta.gift_not_friend',
  'meta.error_retry',
  // shared
  'meta.cancel',
] as const satisfies readonly MetaKey[];

// ---------------------------------------------------------------------------------------------------------------
// The table (C1)

test('i18n: meta keys complete in ru and en', () => {
  const expected = [...META_KEYS].sort();
  expect(new Set(META_KEYS).size).toBe(META_KEYS.length);
  // Against the contract, not ru against en: a key missing from both tables fails here too.
  expect(Object.keys(metaRu).sort()).toEqual(expected);
  expect(Object.keys(metaEn).sort()).toEqual(expected);
  for (const key of META_KEYS) {
    expect(metaRu[key].trim(), key).not.toBe('');
    expect(metaEn[key].trim(), key).not.toBe('');
    expect(placeholders(metaEn[key]), key).toEqual(placeholders(metaRu[key]));
  }
  // MT5: the text version follows `<purpose>.v<n>` and names this text.
  expect(CONSENT_TEXT_VERSION).toBe('friends_profile.v1');
  expect(CONSENT_TEXT_VERSION).toMatch(/^[a-z_]+[.]v[1-9][0-9]*$/);
});

test('i18n: meta lookup fills placeholders and keeps unknown ones', () => {
  expect(mt('en', 'meta.wallet_buy', { stars: 7 })).toBe('Buy for 7 ⭐');
  expect(mt('ru', 'meta.wallet_buy', { stars: 7 })).toBe('Купить за 7 ⭐');
  expect(mt('en', 'meta.gift_title', { name: 'Kim' })).toBe('A gift for Kim');
  // A missing or misnamed parameter stays visible, so the bug shows instead of an empty price.
  expect(mt('en', 'meta.wallet_buy')).toBe('Buy for {stars} ⭐');
  expect(mt('en', 'meta.wallet_buy', { price: 7 })).toBe('Buy for {stars} ⭐');
  expect(mt('en', 'meta.wallet_buy', {})).toBe('Buy for {stars} ⭐');
  // One pass: a value is never read as a template; it is plain text that Svelte escapes when rendered.
  expect(mt('en', 'meta.gift_title', { name: '{name} <b>x</b>' })).toBe('A gift for {name} <b>x</b>');
  expect(mt('ru', 'meta.cancel')).toBe(metaRu['meta.cancel']);
  expect(mt('en', 'meta.cancel')).toBe(metaEn['meta.cancel']);
});

// ---------------------------------------------------------------------------------------------------------------
// The completion card (C2; M9, MT2)

// The branded ids are plain strings at runtime; the casts only build fixtures.
const CARD: CardData = {
  storyId: 'tide' as StoryId,
  runs: 3,
  chaptersCompleted: ['ch1' as ChapterId, 'ch2' as ChapterId],
  endings: [{ name: 'truth' as EndingName, title: '<i>Truth</i>', firstReachedAt: 1_790_000_000 }],
  achievements: [
    { id: 'a1', name: 'First steps', description: 'Finish the first chapter', unlockedAt: 1_790_000_100, isNew: true },
    { id: 'a2', name: 'Night owl', description: 'Play after midnight', unlockedAt: 1_780_000_000, isNew: false },
  ],
};

test('card: lists endings and achievements, new ones marked', () => {
  for (const lang of LANGS) {
    const onshare = vi.fn();
    const view = render(CompletionCard, { card: CARD, storyTitle: 'The Tide', lang, onshare });
    const card = within(view.container);
    expect(shown(card.getByRole('heading', { level: 2 })), lang).toBe(mt(lang, 'meta.card_title', { story: 'The Tide' }));
    expect(shown(view.container), lang).toContain(mt(lang, 'meta.card_runs', { n: 3 }));
    expect(shown(view.container), lang).toContain(mt(lang, 'meta.card_chapters', { n: 2 }));

    // Server text renders as text: the title's markup is characters, not an element.
    const endings = within(card.getByRole('list', { name: mt(lang, 'meta.card_endings') })).getAllByRole('listitem');
    expect(endings.map(shown), lang).toEqual(['<i>Truth</i>']);
    expect(view.container.querySelector('i'), lang).toBeNull();

    const achievements = within(card.getByRole('list', { name: mt(lang, 'meta.card_achievements') })).getAllByRole(
      'listitem',
    );
    expect(achievements, lang).toHaveLength(2);
    for (const [item, a] of achievements.map((el, i) => [el, CARD.achievements[i]] as const)) {
      expect(shown(item), lang).toContain(a?.name ?? '?');
      expect(shown(item), lang).toContain(a?.description ?? '?');
    }
    // Exactly one mark, and on the new achievement (isNew), not on a position.
    const marks = card.queryAllByText(mt(lang, 'meta.card_new'));
    expect(marks, lang).toHaveLength(1);
    expect(shown(marks[0]?.closest('li') ?? document.createElement('li')), lang).toContain('First steps');

    tap(card.getByRole('button', { name: mt(lang, 'meta.card_share') }));
    expect(onshare, lang).toHaveBeenCalledTimes(1);
    view.unmount();
  }
});

test('card: no total or empty slots', () => {
  // The matcher itself, in both languages: a template copying "X of Y" is caught in Russian too (critique W3).
  expect('Концовки: 1 из 2').toMatch(OF_WORD);
  expect('Endings: 1 of 2').toMatch(OF_WORD);
  expect('Изучить: offer, profile, Ниизма').not.toMatch(OF_WORD);

  for (const lang of LANGS) {
    const view = render(CompletionCard, { card: CARD, storyTitle: 'The Tide', lang, onshare: vi.fn() });
    const text = shown(view.container);
    expect(text, lang).not.toMatch(OF_WORD);
    expect(text, lang).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(text, lang).not.toMatch(/\?{2,}/);
    // Only the found endings: no locked slot beside them.
    const list = within(view.container).getByRole('list', { name: mt(lang, 'meta.card_endings') });
    expect(within(list).getAllByRole('listitem'), lang).toHaveLength(CARD.endings.length);
    view.unmount();
  }
  // No prop can carry a total (MT2, Q25).
  // @ts-expect-error -- the card has no endings total
  void ({ ...CARD, endingsTotal: 2 } satisfies CardData);
});

test('card: data dropped on close', () => {
  const view = render(CompletionCard, { card: CARD, storyTitle: 'The Tide', lang: 'en', onshare: vi.fn() });
  expect(shown(document.body)).toContain('The Tide');
  view.unmount();
  expect(view.container.childNodes).toHaveLength(0);
  expect(shown(document.body)).not.toContain('The Tide');
  expect(shown(document.body)).not.toContain('Truth');

  // No module-level copy: a `<script module>` is the one place a component could keep data past its instance.
  const names = Object.keys(COMPONENT_SOURCES);
  expect(names).toContain('./CompletionCard.svelte');
  const withModule = names.filter((n) => /<script\b[^>]*\bmodule\b/.test(COMPONENT_SOURCES[n] ?? ''));
  expect(withModule.map((n) => n.replace(/^\.\//, ''))).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// Friends, a friend's profile and the invite prompt (C3; M10, M13, F19-F22)

// Handles are 24 hex characters (M10 W1); the brand is compile-time only, so the cast only builds fixtures.
const handle = (c: string): FriendHandle => c.repeat(24) as FriendHandle;
const [H1, H2, H3, H4] = [handle('1'), handle('2'), handle('3'), handle('4')];

const SOCIAL: SocialData = {
  inviteCode: 'c'.repeat(32),
  friends: [{ handle: H3, firstName: 'Bo' }],
  // Two people may share a first name: rows are keyed by handle (W1).
  requests: [
    { handle: H1, firstName: 'Alex', at: 1_790_000_000 },
    { handle: H2, firstName: 'Alex', at: 1_790_000_001 },
    { handle: H4, firstName: '<b>Kim</b>', at: 1_790_000_002 },
  ],
  profileVisible: false,
};

/** A text as a pattern that matches it literally (the table's punctuation is not regex syntax). */
const literally = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test('friends: requests show accept and decline', async () => {
  for (const lang of LANGS) {
    const calls = {
      onaccept: vi.fn(),
      ondecline: vi.fn(),
      onopen: vi.fn(),
      oninvite: vi.fn(),
      onconsent: vi.fn(),
      onpolicy: vi.fn(),
    };
    const view = render(Friends, { social: SOCIAL, lang, ...calls });
    const q = within(view.container);
    const accepts = q.getAllByRole('button', { name: mt(lang, 'meta.friends_accept') });
    const declines = q.getAllByRole('button', { name: mt(lang, 'meta.friends_decline') });
    expect([accepts.length, declines.length], lang).toEqual([3, 3]);
    tap(accepts[1] ?? document.body);
    tap(declines[0] ?? document.body);
    expect(calls.onaccept.mock.calls, lang).toEqual([[H2]]);
    expect(calls.ondecline.mock.calls, lang).toEqual([[H1]]);
    // The decline note is said once, under the heading.
    expect(q.getAllByText(mt(lang, 'meta.friends_decline_note')), lang).toHaveLength(1);
    // A first name is user text: characters, never markup; a handle is an address, never shown.
    expect(view.container.querySelector('b'), lang).toBeNull();
    expect(shown(view.container), lang).toContain('<b>Kim</b>');
    for (const h of [H1, H2, H3, H4]) {
      expect(view.container.outerHTML, lang).not.toContain(h);
    }

    tap(q.getByRole('button', { name: 'Bo' }));
    expect(calls.onopen.mock.calls, lang).toEqual([[H3]]);
    const visibility = q.getByRole('button', { name: literally(mt(lang, 'meta.friends_visibility')) });
    expect(shown(visibility), lang).toContain(mt(lang, 'meta.friends_visibility_off'));
    expect(shown(visibility), lang).not.toContain(mt(lang, 'meta.friends_visibility_on'));
    tap(visibility);
    tap(q.getByRole('button', { name: mt(lang, 'meta.friends_invite') }));
    // M26: the policy is linked from Friends too (critique W1).
    tap(q.getByRole('button', { name: mt(lang, 'meta.friends_policy') }));
    expect([calls.onconsent, calls.oninvite, calls.onpolicy].map((f) => f.mock.calls.length), lang).toEqual([1, 1, 1]);

    await view.rerender({ busy: true });
    for (const b of [...accepts, ...declines]) {
      expect((b as HTMLButtonElement).disabled, lang).toBe(true);
    }
    view.unmount();
  }
  // A friend carries a handle and a first name, never a Telegram id (W1).
  // @ts-expect-error -- no numeric user id in the props
  void ({ handle: H1, firstName: 'Bo', userId: 1 } satisfies FriendData);
});

const STORY: ProfileData['stories'][number] = {
  storyId: 'tide' as StoryId,
  storyTitle: 'The Tide',
  endingsFound: 2,
  achievementsUnlocked: 1,
  sharedEndings: [{ name: 'truth' as EndingName, title: 'Truth' }],
  sharedAchievements: [{ id: 'a1', name: 'First steps' }],
};
const PROFILE: ProfileData = { handle: H3, firstName: 'Bo', visible: true, stories: [STORY] };

test('friend: progress hidden without consent, shared titles with it', () => {
  for (const lang of LANGS) {
    // Hidden: the name and the note, nothing of the stories, even when some arrive (defence in depth, M13).
    const ongift = vi.fn();
    const hidden = render(FriendProfile, { profile: { ...PROFILE, visible: false }, lang, ongift, onremove: vi.fn() });
    const h = within(hidden.container);
    const text = shown(hidden.container);
    expect(text, lang).toContain('Bo');
    expect(text, lang).toContain(mt(lang, 'meta.friend_hidden'));
    for (const absent of ['The Tide', 'Truth', 'First steps', mt(lang, 'meta.friend_shared')]) {
      expect(text, lang).not.toContain(absent);
    }
    expect(text, lang).not.toMatch(/\d/);
    // Gift and Remove need the friendship, not the consent: a hidden profile keeps both (critique W2).
    tap(h.getByRole('button', { name: mt(lang, 'meta.friend_gift') }));
    expect(ongift.mock.calls, lang).toEqual([[H3]]);
    tap(h.getByRole('button', { name: mt(lang, 'meta.friend_remove') }));
    expect(shown(hidden.container), lang).toContain(mt(lang, 'meta.friend_remove_note'));
    hidden.unmount();

    // Visible: per story the friend's own counts and the titles both found; never "of".
    const ongift2 = vi.fn();
    const open = render(FriendProfile, { profile: PROFILE, lang, ongift: ongift2, onremove: vi.fn() });
    const o = within(open.container);
    const seen = shown(open.container);
    for (const present of [
      'The Tide',
      mt(lang, 'meta.friend_endings', { n: 2 }),
      mt(lang, 'meta.friend_achievements', { n: 1 }),
      mt(lang, 'meta.friend_shared'),
      'Truth',
      'First steps',
    ]) {
      expect(seen, lang).toContain(present);
    }
    expect(seen, lang).not.toContain(mt(lang, 'meta.friend_hidden'));
    expect(seen, lang).not.toMatch(OF_WORD);
    tap(o.getByRole('button', { name: mt(lang, 'meta.friend_gift') }));
    expect(ongift2.mock.calls, lang).toEqual([[H3]]);
    open.unmount();
  }
});

test('friend: remove asks once more and says it is final', () => {
  for (const lang of LANGS) {
    const onremove = vi.fn();
    const view = render(FriendProfile, { profile: PROFILE, lang, ongift: vi.fn(), onremove });
    const q = within(view.container);
    const note = mt(lang, 'meta.friend_remove_note');
    tap(q.getByRole('button', { name: mt(lang, 'meta.friend_remove') }));
    expect(shown(view.container), lang).toContain(note);
    expect(onremove, lang).not.toHaveBeenCalled();

    tap(q.getByRole('button', { name: mt(lang, 'meta.cancel') }));
    expect(shown(view.container), lang).not.toContain(note);
    expect(q.queryByRole('button', { name: mt(lang, 'meta.friend_remove_confirm') }), lang).toBeNull();
    expect(onremove, lang).not.toHaveBeenCalled();

    tap(q.getByRole('button', { name: mt(lang, 'meta.friend_remove') }));
    const confirmButton = q.getByRole('button', { name: mt(lang, 'meta.friend_remove_confirm') });
    // Rule (b): a pointer click with no pointerdown on the confirm (the tap that revealed it) removes nobody (W5).
    pointerClick(confirmButton);
    expect(onremove, lang).not.toHaveBeenCalled();
    tap(confirmButton);
    expect(onremove.mock.calls, lang).toEqual([[H3]]);
    view.unmount();
  }
});

test('invite: prompt names nobody and says who sees the name', () => {
  const fragments: Readonly<Record<Lang, readonly RegExp[]>> = {
    en: [/shared this link will see your Telegram first name/, /only if they accept/],
    ru: [/поделился этой ссылкой, увидит ваше имя/, /только если он примет/],
  };
  const keys = ['meta.invite_title', 'meta.invite_body', 'meta.invite_send', 'meta.invite_later'] as const;
  for (const lang of LANGS) {
    const onsend = vi.fn();
    const onlater = vi.fn();
    const view = render(InvitePrompt, { lang, onsend, onlater });
    // Exactly the table's words: no name, no code, nothing else.
    expect(shown(view.container), lang).toBe(keys.map((k) => mt(lang, k)).join(' '));
    for (const k of keys) {
      expect(placeholders(mt(lang, k)), `${lang} ${k}`).toEqual([]);
    }
    for (const re of fragments[lang]) {
      expect(mt(lang, 'meta.invite_body'), lang).toMatch(re);
    }
    const q = within(view.container);
    const send = q.getByRole('button', { name: mt(lang, 'meta.invite_send') });
    // Rule (b): the prompt arrives at boot, possibly under a tap in progress; that tap sends nothing (W5).
    pointerClick(send);
    expect(onsend, lang).not.toHaveBeenCalled();
    tap(send);
    tap(q.getByRole('button', { name: mt(lang, 'meta.invite_later') }));
    expect([onsend.mock.calls.length, onlater.mock.calls.length], lang).toEqual([1, 1]);
    view.unmount();
  }
  // The prompt has no name prop (C1).
  // @ts-expect-error -- the inviter is never named
  void ({ lang: 'en', onsend: () => {}, onlater: () => {}, inviterName: 'Kim' } satisfies InviteProps);
});
