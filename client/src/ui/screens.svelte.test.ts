// L14a in happy-dom: the UI string tables and t(), the screen stack that owns the BackButton, the view model's
// toasts, the tap screen and the stage host. Components render through @testing-library/svelte (auto-cleanup by
// svelteTesting() in vite.config.ts).
import { expect, test } from 'vitest';

import { en } from '../i18n/en.ts';
import { t, type UiKey } from '../i18n/index.ts';
import { ru } from '../i18n/ru.ts';

/** The `{name}` placeholders of a template, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '').sort();
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
