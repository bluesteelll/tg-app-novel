import { expect, test } from 'vitest';

import samplesText from './fixtures/dto-samples.json?raw';
import { DTO_DECODERS, decodePuzzleStatus } from './decode.ts';
import type { DecodedDto } from './decode.ts';

// The DTOs this module decodes, listed here and never read from the file's keys: another lane's new samples (LS3's
// stats DTOs) neither break nor silently extend this test.
const NAMES: readonly DecodedDto[] = [
  'ApiErrorBody',
  'AttemptResponse',
  'AuthResponse',
  'ChapterPayload',
  'CreateInvoiceResponse',
  'EntitlementsResponse',
  'OrderResponse',
  'PutSaveResponse',
  'PuzzleStatus',
  'SaveFull',
  'SaveListResponse',
];

// Parsed here, so the decoders see `unknown`, as at the real edge.
const SAMPLES: unknown = JSON.parse(samplesText);

function samplesOf(name: DecodedDto): readonly unknown[] {
  const all = typeof SAMPLES === 'object' && SAMPLES !== null ? (SAMPLES as Record<string, unknown>) : {};
  const list = Object.hasOwn(all, name) ? all[name] : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`dto-samples.json has no samples of ${name}`);
  }
  return list;
}

const REMOVE = Symbol('remove');
type Step = string | number;

/** A deep copy of `sample` with the value at `path` replaced, or removed for `REMOVE`. */
function edited(sample: unknown, path: readonly Step[], value: unknown): unknown {
  const copy: unknown = structuredClone(sample);
  let node: unknown = copy;
  for (const step of path.slice(0, -1)) {
    node = (node as Record<Step, unknown>)[step];
  }
  const last = path[path.length - 1];
  if (last === undefined || typeof node !== 'object' || node === null) {
    throw new Error(`bad edit path ${path.join('.')}`);
  }
  const target = node as Record<Step, unknown>;
  if (value === REMOVE) {
    delete target[last];
  } else {
    target[last] = value;
  }
  return copy;
}

type Malformed = { dto: DecodedDto; sample: number; path: readonly Step[]; value: unknown; error: string };

// Per DTO: one required field removed, one wrong type, one out-of-union value where the DTO has a union.
const MALFORMED: readonly Malformed[] = [
  { dto: 'ApiErrorBody', sample: 0, path: ['error'], value: REMOVE, error: 'ApiErrorBody.error: missing' },
  { dto: 'ApiErrorBody', sample: 0, path: ['error'], value: 7, error: 'ApiErrorBody.error: ' },
  { dto: 'ApiErrorBody', sample: 0, path: ['error'], value: 'teapot', error: 'ApiErrorBody.error: ' },
  { dto: 'ApiErrorBody', sample: 18, path: ['current', 'rev'], value: '2', error: 'ApiErrorBody.current.rev: ' },
  { dto: 'AttemptResponse', sample: 0, path: ['correct'], value: REMOVE, error: 'AttemptResponse.correct: missing' },
  { dto: 'AttemptResponse', sample: 0, path: ['solved'], value: 'yes', error: 'AttemptResponse.solved: ' },
  { dto: 'AuthResponse', sample: 0, path: ['token'], value: REMOVE, error: 'AuthResponse.token: missing' },
  { dto: 'AuthResponse', sample: 0, path: ['expiresAt'], value: '1800001800', error: 'AuthResponse.expiresAt: ' },
  { dto: 'AuthResponse', sample: 0, path: ['user', 'languageCode'], value: 5, error: 'AuthResponse.user.languageCode: ' },
  { dto: 'ChapterPayload', sample: 1, path: ['world'], value: REMOVE, error: 'ChapterPayload.world: missing' },
  { dto: 'ChapterPayload', sample: 0, path: ['chapterId'], value: 2, error: 'ChapterPayload.chapterId: ' },
  { dto: 'ChapterPayload', sample: 0, path: ['story'], value: null, error: 'ChapterPayload.story: ' },
  { dto: 'CreateInvoiceResponse', sample: 0, path: ['invoiceUrl'], value: REMOVE, error: 'CreateInvoiceResponse.invoiceUrl: missing' },
  { dto: 'CreateInvoiceResponse', sample: 0, path: ['orderId'], value: null, error: 'CreateInvoiceResponse.orderId: ' },
  { dto: 'EntitlementsResponse', sample: 0, path: ['products', 0, 'owned'], value: REMOVE, error: 'EntitlementsResponse.products[0].owned: missing' },
  { dto: 'EntitlementsResponse', sample: 0, path: ['products', 1, 'priceStars'], value: 1.5, error: 'EntitlementsResponse.products[1].priceStars: ' },
  { dto: 'OrderResponse', sample: 0, path: ['status'], value: REMOVE, error: 'OrderResponse.status: missing' },
  { dto: 'OrderResponse', sample: 0, path: ['productId'], value: 3, error: 'OrderResponse.productId: ' },
  { dto: 'OrderResponse', sample: 0, path: ['status'], value: 'shipped', error: 'OrderResponse.status: ' },
  { dto: 'PutSaveResponse', sample: 0, path: ['rev'], value: REMOVE, error: 'PutSaveResponse.rev: missing' },
  { dto: 'PutSaveResponse', sample: 0, path: ['savedAt'], value: 'now', error: 'PutSaveResponse.savedAt: ' },
  { dto: 'PuzzleStatus', sample: 0, path: ['hints', 0, 'unlocked'], value: REMOVE, error: 'PuzzleStatus.hints[0].unlocked: missing' },
  { dto: 'PuzzleStatus', sample: 0, path: ['solved'], value: 'no', error: 'PuzzleStatus.solved: ' },
  { dto: 'PuzzleStatus', sample: 0, path: ['hints', 0, 'tier'], value: 4, error: 'PuzzleStatus.hints[0].tier: ' },
  // M21: `text` only when unlocked; a locked tier that carries text is an error value, never shown.
  { dto: 'PuzzleStatus', sample: 0, path: ['hints', 1, 'text'], value: 'The key is in the clock.', error: 'PuzzleStatus.hints[1].text: ' },
  { dto: 'SaveFull', sample: 0, path: ['body'], value: REMOVE, error: 'SaveFull.body: missing' },
  { dto: 'SaveFull', sample: 0, path: ['summary', 'rev'], value: '3', error: 'SaveFull.summary.rev: ' },
  { dto: 'SaveFull', sample: 0, path: ['summary', 'slot'], value: 's9', error: 'SaveFull.summary.slot: ' },
  { dto: 'SaveListResponse', sample: 0, path: ['slots', 0, 'writeId'], value: REMOVE, error: 'SaveListResponse.slots[0].writeId: missing' },
  { dto: 'SaveListResponse', sample: 0, path: ['slots', 1, 'lineId'], value: 4, error: 'SaveListResponse.slots[1].lineId: ' },
  { dto: 'SaveListResponse', sample: 0, path: ['slots', 2, 'slot'], value: 'manual', error: 'SaveListResponse.slots[2].slot: ' },
];

test('decode: rust dto samples decode', () => {
  expect(Object.keys(DTO_DECODERS).sort()).toEqual([...NAMES].sort());
  for (const name of NAMES) {
    for (const sample of samplesOf(name)) {
      // Equal, not only ok: a decoder that drops or renames a field fails here too.
      expect(DTO_DECODERS[name](sample), name).toEqual({ ok: true, value: sample });
    }
  }
});

test('decode: malformed bodies are error values', () => {
  expect(new Set(MALFORMED.map((m) => m.dto))).toEqual(new Set(NAMES));
  for (const m of MALFORMED) {
    const label = `${m.dto}[${m.sample}] ${m.path.join('.')}`;
    const r = DTO_DECODERS[m.dto](edited(samplesOf(m.dto)[m.sample], m.path, m.value));
    expect(r, label).toMatchObject({ ok: false });
    expect(r.ok ? null : r.error.slice(0, m.error.length), label).toBe(m.error);
  }
});

test('decode: puzzle status with unlocked hints', () => {
  const r = decodePuzzleStatus(samplesOf('PuzzleStatus')[0]);
  expect(r).toEqual({
    ok: true,
    value: {
      puzzleId: 'ch1.drawer',
      solved: false,
      hints: [
        { tier: 1, unlocked: true, text: 'Look under the rug.' },
        { tier: 2, unlocked: false, text: null },
      ],
    },
  });
  expect(r.ok && r.value.hints[1]?.text).toBe(null);
});
