// LU1 in happy-dom: the meta overlays (META-PLAN M9-M13, M22, M24, M27) and their table. Components render through
// @testing-library/svelte. Events are built by hand where `detail` matters: a pointer click has detail >= 1, a
// keyboard or assistive-technology activation has detail 0 (as in choices.svelte.test.ts).
import { cleanup, render, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';

import type { Lang } from '../../i18n/index.ts';
import { CONSENT_TEXT_VERSION, metaEn, metaRu, mt, type MetaKey } from '../../i18n/meta.ts';
import type { EndingName, StoryId } from '../../story/catalog.ts';
import type { ChapterId, ProductId } from '../../story/staging.ts';
import CompletionCard from './CompletionCard.svelte';
import ConsentDialog from './ConsentDialog.svelte';
import FriendProfile from './FriendProfile.svelte';
import Friends from './Friends.svelte';
import GiftDialog from './GiftDialog.svelte';
import * as ui from './index.ts';
import type {
  CardData,
  FriendData,
  FriendHandle,
  GiftProps,
  InviteProps,
  ProfileData,
  ShownError,
  SocialData,
  WalletData,
} from './index.ts';
import indexSource from './index.ts?raw';
import InvitePrompt from './InvitePrompt.svelte';
import Wallet from './Wallet.svelte';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here.
afterEach(() => cleanup());

const LANGS: readonly Lang[] = ['ru', 'en'];

/** The chunk's seven components, sorted (spec 3: the list is explicit, so a missing or renamed file fails). */
const META_COMPONENTS = [
  'CompletionCard.svelte',
  'ConsentDialog.svelte',
  'FriendProfile.svelte',
  'Friends.svelte',
  'GiftDialog.svelte',
  'InvitePrompt.svelte',
  'Wallet.svelte',
] as const;

/** Every component in this directory, as raw text: what the source pins read. */
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

// ---------------------------------------------------------------------------------------------------------------
// The consent dialog and the wallet (C4; M12, M20, M24, F21, F23, PP P1-P2)

/** A pointer-free activation: Enter or Space on a focused button, or assistive technology (detail 0). */
const keyClick = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  flushSync();
};

test('consent: off by default and one tap withdraws', () => {
  for (const lang of LANGS) {
    const onchange = vi.fn();
    const off = render(ConsentDialog, { lang, onchange, onpolicy: vi.fn() });
    const offSwitch = within(off.container).getByRole('switch', { name: mt(lang, 'meta.consent_switch') });
    expect(offSwitch.getAttribute('aria-checked'), lang).toBe('false');
    const controls = off.container.querySelectorAll('button').length;
    // Rule (b): the tap that opened the dialog, a click with no pointerdown on the switch, consents to nothing (W5).
    pointerClick(offSwitch);
    flushSync();
    expect(onchange, lang).not.toHaveBeenCalled();
    tap(offSwitch);
    expect(onchange.mock.calls, lang).toEqual([[true, 'friends_profile.v1']]);
    // The switch shows the server's state: it does not flip before the answer arrives as `granted`.
    expect(offSwitch.getAttribute('aria-checked'), lang).toBe('false');
    off.unmount();

    const withdraw = vi.fn();
    const on = render(ConsentDialog, { granted: true, lang, onchange: withdraw, onpolicy: vi.fn() });
    const onSwitch = within(on.container).getByRole('switch', { name: mt(lang, 'meta.consent_switch') });
    expect(onSwitch.getAttribute('aria-checked'), lang).toBe('true');
    tap(onSwitch);
    // One tap withdraws: no confirm step appears.
    expect(withdraw.mock.calls, lang).toEqual([[false, 'friends_profile.v1']]);
    expect(on.container.querySelectorAll('button'), lang).toHaveLength(controls);
    // A keyboard activation counts as well.
    keyClick(onSwitch);
    expect(withdraw, lang).toHaveBeenCalledTimes(2);
    on.unmount();
  }
});

/** The consent as the player reads it: title, body and the switch's label (MT5: the version names this text). */
const consentText = (lang: Lang): string =>
  (['meta.consent_title', 'meta.consent_body', 'meta.consent_switch'] as const).map((k) => mt(lang, k)).join('\n');

/**
 * sha256 of the ru and en consent texts per version: a wording edit without a new version (and its entry in the
 * server's closed list, LF1) fails here.
 */
const CONSENT_PINS: Readonly<Record<string, string>> = {
  'friends_profile.v1': 'd4c1970079a6fbf0f547ff4f79900d8f4cf166c079ee7943782bf7ad9b2d4d87',
};

/** The hex sha256 of a text's UTF-8 bytes (Web Crypto: the client's tsconfig types no `node:` module). */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('consent: text names the friend circle', async () => {
  const fragments: Readonly<Record<Lang, readonly RegExp[]>> = {
    en: [/whose friend request you accepted/, /who accepted your request/, /No one else/],
    ru: [/чей запрос в друзья вы приняли/, /которые приняли ваш запрос/, /Больше никто/],
  };
  for (const lang of LANGS) {
    const onpolicy = vi.fn();
    const view = render(ConsentDialog, { lang, onchange: vi.fn(), onpolicy });
    const q = within(view.container);
    expect(q.getByRole('heading', { level: 2 }).textContent, lang).toBe(mt(lang, 'meta.consent_title'));
    expect(shown(q.getByText(mt(lang, 'meta.consent_body'))), lang).toBe(mt(lang, 'meta.consent_body'));
    for (const re of fragments[lang]) {
      expect(mt(lang, 'meta.consent_body'), lang).toMatch(re);
    }
    tap(q.getByRole('button', { name: mt(lang, 'meta.consent_policy') }));
    expect(onpolicy, lang).toHaveBeenCalledTimes(1);
    view.unmount();
  }
  expect(await sha256(`${consentText('ru')}\n${consentText('en')}`)).toBe(CONSENT_PINS[CONSENT_TEXT_VERSION]);
});

// Every derived number (a per-hint price floor / ceil / round, a total, a sum) falls outside these server numbers,
// so a client-side price cannot hide among them (critique W4).
const WALLET: WalletData = {
  balances: [{ kind: 'hint', balance: 0, debt: 3 }],
  packs: [
    { productId: 'pack:hint_s' as ProductId, kind: 'hint', amount: 5, priceStars: 40, title: '5 hints' },
    { productId: 'pack:hint_m' as ProductId, kind: 'hint', amount: 20, priceStars: 130, title: '20 hints' },
  ],
  hintTierCost: 1,
};
const WALLET_NUMBERS = new Set([0, 3, 5, 20, 40, 130]);

test('wallet: packs show server prices and debt', () => {
  // The fixture's property, checked: none of the usual derivations lands on an allowed number.
  for (const p of WALLET.packs) {
    const each = p.priceStars / p.amount;
    for (const derived of [Math.floor(each), Math.ceil(each), Math.round(each), p.priceStars * p.amount]) {
      expect(WALLET_NUMBERS.has(derived), `${p.productId} ${derived}`).toBe(false);
    }
  }
  for (const lang of LANGS) {
    const view = render(Wallet, { wallet: WALLET, lang, onbuy: vi.fn(), onterms: vi.fn() });
    const text = shown(view.container);
    for (const present of [
      '5 hints',
      '20 hints',
      mt(lang, 'meta.wallet_buy', { stars: 40 }),
      mt(lang, 'meta.wallet_buy', { stars: 130 }),
      mt(lang, 'meta.wallet_balance', { kind: mt(lang, 'meta.kind_hint'), n: 0 }),
      mt(lang, 'meta.wallet_debt', { n: 3 }),
    ]) {
      expect(text, lang).toContain(present);
    }
    // Every number on screen is a server number, verbatim.
    const numbers = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
    expect(numbers.filter((n) => !WALLET_NUMBERS.has(n)), lang).toEqual([]);
    view.unmount();
  }
  // A kind without a label shows its id; no debt line without debt.
  const other = render(Wallet, {
    wallet: { ...WALLET, balances: [{ kind: 'gem', balance: 2, debt: 0 }] },
    lang: 'en',
    onbuy: vi.fn(),
    onterms: vi.fn(),
  });
  expect(shown(other.container)).toContain(mt('en', 'meta.wallet_balance', { kind: 'gem', n: 2 }));
  expect(shown(other.container)).not.toContain(mt('en', 'meta.wallet_debt', { n: 0 }));
});

test('wallet: buy needs the terms checkbox', async () => {
  for (const lang of LANGS) {
    const onbuy = vi.fn();
    const onterms = vi.fn();
    const view = render(Wallet, { wallet: WALLET, lang, onbuy, onterms });
    const q = within(view.container);
    const box = q.getByRole('checkbox', { name: mt(lang, 'meta.wallet_terms_agree') }) as HTMLInputElement;
    const buys = WALLET.packs.map(
      (p) => q.getByRole('button', { name: mt(lang, 'meta.wallet_buy', { stars: p.priceStars }) }) as HTMLButtonElement,
    );
    const [small, medium] = buys;
    if (small === undefined || medium === undefined) {
      throw new Error('two Buy buttons expected');
    }
    // Unchecked on every open, and Buy is disabled until it is ticked (P1).
    expect(box.checked, lang).toBe(false);
    expect(buys.map((b) => b.disabled), lang).toEqual([true, true]);
    tap(medium);
    expect(onbuy, lang).not.toHaveBeenCalled();
    tap(q.getByRole('button', { name: mt(lang, 'meta.wallet_terms_link') }));
    expect(onterms, lang).toHaveBeenCalledTimes(1);

    box.click();
    flushSync();
    expect(buys.map((b) => b.disabled), lang).toEqual([false, false]);
    tap(medium);
    expect(onbuy.mock.calls, lang).toEqual([['pack:hint_m']]);

    // While a purchase is requested, Buy is disabled (P2).
    await view.rerender({ busy: true });
    expect(buys.map((b) => b.disabled), lang).toEqual([true, true]);
    view.unmount();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The gift dialog (C5; M22, F25)

const KIM: FriendData = { handle: H4, firstName: '<b>Kim</b>' };

/** The dialog's props for `lang`, with `over` on top. */
const gift = (lang: Lang, over: Partial<GiftProps> = {}): GiftProps => ({
  friend: KIM,
  kind: 'hint',
  balance: 2,
  maxAmount: null,
  error: null,
  lang,
  onsend: vi.fn(),
  oncancel: vi.fn(),
  ...over,
});

/** The dialog's controls and its shown amount. */
function giftControls(container: HTMLElement, lang: Lang) {
  const q = within(container);
  const button = (key: MetaKey): HTMLButtonElement => q.getByRole('button', { name: mt(lang, key) }) as HTMLButtonElement;
  return {
    less: button('meta.gift_less'),
    more: button('meta.gift_more'),
    send: button('meta.gift_send'),
    cancel: button('meta.cancel'),
    amount: (): string => shown(q.getByRole('status')),
    notes: (): string[] => [...(q.queryByRole('alert')?.querySelectorAll('p') ?? [])].map(shown),
  };
}

test('gift: amount bounded by balance and caps', async () => {
  for (const lang of LANGS) {
    // Bounded by the balance when the per-gift maximum is unknown; never below 1.
    const onsend = vi.fn();
    const oncancel = vi.fn();
    const two = render(GiftDialog, gift(lang, { balance: 2, onsend, oncancel }));
    const c = giftControls(two.container, lang);
    expect(shown(within(two.container).getByRole('heading', { level: 2 })), lang).toBe(
      mt(lang, 'meta.gift_title', { name: '<b>Kim</b>' }),
    );
    expect(two.container.querySelector('b'), lang).toBeNull();
    expect(c.amount(), lang).toBe(mt(lang, 'meta.gift_amount', { n: 1 }));
    expect(c.less.disabled, lang).toBe(true);
    tap(c.less);
    expect(c.amount(), lang).toBe(mt(lang, 'meta.gift_amount', { n: 1 }));
    for (let i = 0; i < 5; i++) {
      tap(c.more);
    }
    expect(c.amount(), lang).toBe(mt(lang, 'meta.gift_amount', { n: 2 }));
    expect(c.more.disabled, lang).toBe(true);
    tap(c.send);
    tap(c.cancel);
    expect([onsend.mock.calls, oncancel.mock.calls.length], lang).toEqual([[[2]], 1]);
    two.unmount();

    // Bounded by the per-gift maximum below the balance; a balance that drops while open bounds it again.
    const capped = render(GiftDialog, gift(lang, { balance: 10, maxAmount: 3 }));
    const d = giftControls(capped.container, lang);
    for (let i = 0; i < 5; i++) {
      tap(d.more);
    }
    expect(d.amount(), lang).toBe(mt(lang, 'meta.gift_amount', { n: 3 }));
    expect(d.more.disabled, lang).toBe(true);
    await capped.rerender({ balance: 2 });
    expect(d.amount(), lang).toBe(mt(lang, 'meta.gift_amount', { n: 2 }));
    capped.unmount();

    // Nothing to give: Send is disabled and the dialog says why.
    const empty = render(GiftDialog, gift(lang, { balance: 0 }));
    const e = giftControls(empty.container, lang);
    expect(e.send.disabled, lang).toBe(true);
    expect(e.notes(), lang).toEqual([mt(lang, 'meta.gift_insufficient')]);
    empty.unmount();

    // The server's answers: the daily caps arrive as `limit` or as 429 `rate-limited` (cut Q3), the rest as below.
    const rows: ReadonlyArray<readonly [ShownError, readonly string[]]> = [
      [{ kind: 'limit' }, [mt(lang, 'meta.gift_capped')]],
      [{ kind: 'rate-limited' }, [mt(lang, 'meta.gift_capped')]],
      [
        { kind: 'rate-limited', retryAfter: 5400 },
        [mt(lang, 'meta.gift_capped'), mt(lang, 'meta.gift_retry', { hours: 2 })],
      ],
      [{ kind: 'insufficient' }, [mt(lang, 'meta.gift_insufficient')]],
      [{ kind: 'not-found' }, [mt(lang, 'meta.gift_not_friend')]],
      [{ kind: 'network' }, [mt(lang, 'meta.error_retry')]],
      [{ kind: 'auth' }, [mt(lang, 'meta.error_retry')]],
      [{ kind: 'unavailable' }, [mt(lang, 'meta.error_retry')]],
    ];
    for (const [error, notes] of rows) {
      const view = render(GiftDialog, gift(lang, { balance: 5, error }));
      expect(giftControls(view.container, lang).notes(), `${lang} ${JSON.stringify(error)}`).toEqual(notes);
      view.unmount();
    }
  }
});

test('gift: one send per submit', async () => {
  for (const lang of LANGS) {
    const onsend = vi.fn();
    const view = render(GiftDialog, gift(lang, { balance: 5, onsend }));
    const c = giftControls(view.container, lang);
    // Rule (b): the tap that opened the dialog, a click with no pointerdown on Send, sends nothing (W5).
    pointerClick(c.send);
    flushSync();
    expect(onsend, lang).not.toHaveBeenCalled();
    tap(c.more);
    // A double tap: both taps land before the DOM updates; one gift goes out.
    rawTap(c.send);
    rawTap(c.send);
    flushSync();
    expect(onsend.mock.calls, lang).toEqual([[2]]);
    expect(c.send.disabled, lang).toBe(true);

    // A new error releases the latch: the retry sends the same amount, once.
    await view.rerender({ error: { kind: 'network' } });
    expect(c.send.disabled, lang).toBe(false);
    tap(c.send);
    tap(c.send);
    expect(onsend.mock.calls, lang).toEqual([[2], [2]]);

    // While the controller works, Send stays disabled.
    await view.rerender({ error: { kind: 'network' }, busy: true });
    expect(c.send.disabled, lang).toBe(true);
    view.unmount();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The sources: no literal text, one entry without I/O, the table inside the chunk (C5; spec 2-4, principle 8)

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

/**
 * Where a component shows a literal string: text nodes and the text attributes, outside scripts and styles (a copy
 * of L14a's reader in ui/screens.svelte.test.ts; that file is outside this lane, carry C1 shares one reader).
 */
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

test('i18n: meta components hold no literal text', () => {
  // Non-vacuous and exact: every component of the chunk is read, and no other component sits beside them.
  const names = Object.keys(COMPONENT_SOURCES)
    .map((key) => key.replace(/^\.\//, ''))
    .sort();
  expect(names).toEqual([...META_COMPONENTS]);
  const offenders: string[] = [];
  for (const name of META_COMPONENTS) {
    const source = COMPONENT_SOURCES[`./${name}`] ?? '';
    expect(source, name).toContain('</');
    for (const literal of literalText(source)) {
      offenders.push(`${name}: ${literal}`);
    }
    // Russian belongs in i18n/meta.ts only: no Cyrillic in a component, in its script or inside `{…}` either.
    if (/\p{Script=Cyrillic}/u.test(source)) {
      offenders.push(`${name}: Cyrillic in the source`);
    }
  }
  if (/\p{Script=Cyrillic}/u.test(indexSource)) {
    offenders.push('index.ts: Cyrillic in the source');
  }
  expect(offenders).toEqual([]);

  // The reader itself: a text node and a text attribute are found, an expression and a glyph are not.
  expect(literalText('<p>Меню</p><b aria-label="Close">×</b><i title={mt(lang, "k")}>{label}</i>')).toEqual([
    'aria-label="Close"',
    'text "Меню"',
  ]);
});

/** One module reference: `type` when erased (`import type`, `export type … from`, `import('x').T`). */
type ModuleRef = { spec: string; typeOnly: boolean; dynamic: boolean };

/** Every module reference of a .ts file or of a component's scripts, read with the TypeScript parser. */
function moduleRefs(file: string, text: string): ModuleRef[] {
  const scripts = file.endsWith('.svelte')
    ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1] ?? '')
    : [text];
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

/** Every source of src/ but the tests, keyed by its path under src/ (`main.ts`, `ui/meta/index.ts`, …). */
const SRC_SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../../**/*.ts', '../../**/*.svelte', '!../../**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([key, text]) => [new URL(key, 'file:///src/ui/meta/').pathname.slice('/src/'.length), text]),
);

/** The I/O a presentational overlay never does (spec 4); storage, dialogs and window.open are arch's rules. */
const IO_NAMES =
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator|window|globalThis|document|indexedDB|postMessage|setTimeout|setInterval)\b/g;

/** A source without its comments (HTML, block and line comments). */
const withoutComments = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

test('meta: one entry, no I/O, the meta table stays in the chunk', () => {
  // (1) The entry's runtime exports are exactly the seven components: no store, no service, no data.
  expect(Object.keys(ui).sort()).toEqual(META_COMPONENTS.map((n) => n.replace(/\.svelte$/, '')).sort());

  // (2) Every module reference inside the chunk is on its allowlist.
  const componentAllowed = new Set(['value ../../i18n/meta.ts', 'type ./index.ts', 'type ../../i18n/index.ts']);
  const indexAllowed = new Set([
    ...META_COMPONENTS.map((n) => `value ./${n}`),
    'type ../../story/catalog.ts',
    'type ../../story/staging.ts',
    'type ../../i18n/index.ts',
    'type ../../i18n/meta.ts',
  ]);
  const form = (r: ModuleRef): string => `${r.dynamic ? 'dynamic' : r.typeOnly ? 'type' : 'value'} ${r.spec}`;
  const outsideAllowlist: string[] = [];
  const chunkFiles: ReadonlyArray<readonly [string, string, ReadonlySet<string>]> = [
    ...META_COMPONENTS.map((n) => [n, COMPONENT_SOURCES[`./${n}`] ?? '', componentAllowed] as const),
    ['index.ts', indexSource, indexAllowed],
  ];
  for (const [name, source, allowed] of chunkFiles) {
    const refs = moduleRefs(name, source).map(form);
    // Non-vacuous: a component reads the table, the entry re-exports the seven.
    expect(refs.length, name).toBeGreaterThan(0);
    outsideAllowlist.push(...refs.filter((r) => !allowed.has(r)).map((r) => `${name}: ${r}`));

    // (3) No I/O identifier, outside comments.
    for (const m of withoutComments(source).matchAll(IO_NAMES)) {
      outsideAllowlist.push(`${name}: ${m[0]}`);
    }
  }
  expect(moduleRefs('index.ts', indexSource).map(form)).toEqual(
    expect.arrayContaining(META_COMPONENTS.map((n) => `value ./${n}`)),
  );
  expect(outsideAllowlist).toEqual([]);

  // (4) Outside the chunk, nothing loads the table, and the chunk is reached only by a type or by LMI's dynamic
  // import in app/meta.ts (M27), so neither the meta strings nor the overlays join the entry.
  const outside = Object.keys(SRC_SOURCES).filter((f) => !f.startsWith('ui/meta/'));
  expect(outside).toContain('main.ts');
  expect(outside).toContain('i18n/index.ts');
  const intoChunk: string[] = [];
  for (const file of outside) {
    for (const ref of moduleRefs(file, SRC_SOURCES[file] ?? '')) {
      if (ref.spec === '<computed>') {
        intoChunk.push(`${file}: a computed module reference`);
        continue;
      }
      if (!ref.spec.startsWith('.') && !ref.spec.startsWith('/')) {
        continue;
      }
      const target = new URL(ref.spec, `file:///src/${file}`).pathname.slice('/src/'.length);
      const loader = ref.dynamic && file === 'app/meta.ts' && target === 'ui/meta/index.ts';
      if ((target === 'i18n/meta.ts' || target.startsWith('ui/meta/')) && !ref.typeOnly && !loader) {
        intoChunk.push(`${file}: ${form(ref)}`);
      }
    }
  }
  expect(intoChunk).toEqual([]);
});

test('i18n: every meta key is used by a meta component', () => {
  const sources = META_COMPONENTS.map((n) => COMPONENT_SOURCES[`./${n}`] ?? '');
  const quoted = (key: string): boolean => sources.some((s) => s.includes(`'${key}'`) || s.includes(`"${key}"`));
  expect(META_KEYS.filter((key) => !quoted(key))).toEqual([]);
});
