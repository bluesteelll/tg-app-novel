// L14b in happy-dom: the overlay menus (PROTOTYPE-PLAN L14b), the story picker (STORIES-PLAN Y14, Y15), the meta entry
// points (META-PLAN M9, M27) and the keys this lane declares for the puzzle, explore and hint UIs. Components render
// through @testing-library/svelte. Events are built by hand where `detail` matters: a pointer click has detail >= 1, a
// keyboard or assistive-technology activation has detail 0 (as in choices.svelte.test.ts).
import { cleanup } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';

import { en } from '../i18n/en.ts';
import { ru } from '../i18n/ru.ts';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here.
afterEach(() => cleanup());

const RU: Readonly<Record<string, string>> = ru;
const EN: Readonly<Record<string, string>> = en;

/** The `{name}` placeholders of a template, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '').sort();
}

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
