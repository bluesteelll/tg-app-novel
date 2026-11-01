// LU1 in happy-dom: the meta overlays' table and its lookup (META-PLAN M27). Components render through
// @testing-library/svelte.
import { cleanup } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';

import { CONSENT_TEXT_VERSION, metaEn, metaRu, mt, type MetaKey } from '../../i18n/meta.ts';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here.
afterEach(() => cleanup());

/** The `{name}` placeholders of a template, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '').sort();
}

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
