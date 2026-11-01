// Story line text by language (PROTOTYPE-PLAN "Localization", principle 8): ru is the ink text, en comes from the
// chapter's table, and a missing en entry falls back to ru and is counted.
import { expect, test } from 'vitest';

import type { LineId } from '../story/staging.ts';
import { createLineText } from './lines.ts';

const HELLO = 'ch1.start.a001' as LineId; // the fixture ids match LINE_ID_RE
const QUIET = 'ch1.start.a002' as LineId;

test('lines: en missing falls back to ru and counts', () => {
  const missed: LineId[] = [];
  const lines = createLineText({ [HELLO]: 'Hello.' }, (id) => missed.push(id));
  expect(lines.text(HELLO, 'Привет.', 'ru')).toBe('Привет.');
  expect(lines.text(HELLO, 'Привет.', 'en')).toBe('Hello.');
  expect(lines.missing()).toBe(0);
  expect(lines.text(QUIET, 'Тихо.', 'en')).toBe('Тихо.');
  expect(lines.missing()).toBe(1);
  expect(missed).toEqual([QUIET]);
  // Own entries only: an inherited name is no table entry.
  expect(lines.text('toString' as LineId, 'Строка.', 'en')).toBe('Строка.');
  expect(lines.missing()).toBe(2);

  // A table not loaded yet (a ru player's free chapter, before a switch) misses every line.
  const none = createLineText(null);
  expect(none.text(HELLO, 'Привет.', 'en')).toBe('Привет.');
  expect(none.text(HELLO, 'Привет.', 'ru')).toBe('Привет.');
  expect(none.missing()).toBe(1);
});
