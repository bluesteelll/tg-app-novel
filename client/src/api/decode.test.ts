import { expect, test } from 'vitest';

import { DTO_DECODERS, decodePostStatsResponse, decodePuzzleStatus, decodeStatsResponse } from './decode.ts';
import type { DecodedDto, Decoder } from './decode.ts';
import { createEndpoints } from './endpoints.ts';
import samplesText from './fixtures/dto-samples.json?raw';
import type { StatEventDto, StatRejectReason } from './generated/api.ts';
import type { ApiRequest, Http } from './http.ts';

// The DTOs this module decodes, listed here and never read from the file's keys: another lane's new samples (LF1's
// social DTOs, say) neither break nor silently extend this test.
const NAMES: readonly DecodedDto[] = [
  'ApiErrorBody',
  'AttemptResponse',
  'AuthResponse',
  'ChapterPayload',
  'CreateInvoiceResponse',
  'EntitlementsResponse',
  'OrderResponse',
  'PostStatsResponse',
  'PutSaveResponse',
  'PuzzleStatus',
  'SaveFull',
  'SaveListResponse',
  'StatsResponse',
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
  { dto: 'PostStatsResponse', sample: 0, path: ['recorded'], value: REMOVE, error: 'PostStatsResponse.recorded: missing' },
  { dto: 'PostStatsResponse', sample: 0, path: ['duplicates'], value: '1', error: 'PostStatsResponse.duplicates: ' },
  { dto: 'PostStatsResponse', sample: 0, path: ['rejected', 5, 'reason'], value: 'too_old', error: 'PostStatsResponse.rejected[5].reason: ' },
  { dto: 'PostStatsResponse', sample: 0, path: ['rejected', 0, 'eventId'], value: REMOVE, error: 'PostStatsResponse.rejected[0].eventId: missing' },
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
  { dto: 'StatsResponse', sample: 0, path: ['game', 'storiesTotal'], value: REMOVE, error: 'StatsResponse.game.storiesTotal: missing' },
  { dto: 'StatsResponse', sample: 0, path: ['stories', 0, 'started'], value: 'yes', error: 'StatsResponse.stories[0].started: ' },
  { dto: 'StatsResponse', sample: 0, path: ['stories', 0, 'chaptersCompleted', 0], value: 1, error: 'StatsResponse.stories[0].chaptersCompleted[0]: ' },
  { dto: 'StatsResponse', sample: 0, path: ['stories', 1, 'endingsReached'], value: null, error: 'StatsResponse.stories[1].endingsReached: ' },
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

// Exhaustive by type, as in decode.ts: a reason added to api.ts fails `check` here until it is listed.
const REASONS = {
  unknown_chapter: true,
  not_entitled: true,
  unknown_ending: true,
  unknown_puzzle: true,
  unknown_choice: true,
  rate_limited: true,
} as const satisfies Record<StatRejectReason, true>;

/** Every key of `v` at any depth: a decoder that copied an extra field shows it here. */
function keysDeep(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.flatMap(keysDeep);
  }
  if (typeof v === 'object' && v !== null) {
    return Object.entries(v).flatMap(([k, inner]) => [k, ...keysDeep(inner)]);
  }
  return [];
}

test('decode: stats samples decode', () => {
  for (const sample of samplesOf('PostStatsResponse')) {
    expect(decodePostStatsResponse(sample)).toEqual({ ok: true, value: sample });
  }
  for (const sample of samplesOf('StatsResponse')) {
    expect(decodeStatsResponse(sample)).toEqual({ ok: true, value: sample });
  }

  const all = decodePostStatsResponse(samplesOf('PostStatsResponse')[0]);
  expect(all.ok ? all.value.rejected.map((r) => r.reason).sort() : null).toEqual(Object.keys(REASONS).sort());

  // META M8 / MT2: the client has no `endingsTotal`; one sent by a server is ignored, never copied.
  const plain = samplesOf('StatsResponse')[0];
  const seeded = edited(edited(plain, ['stories', 0, 'endingsTotal'], 3), ['game', 'endingsTotal'], 3);
  const read = decodeStatsResponse(seeded);
  expect(read).toEqual({ ok: true, value: plain });
  expect(keysDeep(read.ok ? read.value : null)).not.toContain('endingsTotal');

  const tooOld = edited(samplesOf('PostStatsResponse')[0], ['rejected', 0, 'reason'], 'too_old');
  expect(decodePostStatsResponse(tooOld)).toEqual({ ok: false, error: 'PostStatsResponse.rejected[0].reason: unknown value "too_old"' });
});

test('endpoints: stats routes', () => {
  const calls: { r: ApiRequest; decode: Decoder<unknown> }[] = [];
  const http: Pick<Http, 'request'> = {
    request: (r, decode) => {
      calls.push({ r, decode });
      return Promise.resolve({ ok: false, error: { kind: 'aborted' } });
    },
  };
  const api = createEndpoints(http);
  const evs: readonly StatEventDto[] = [
    {
      eventId: '00000000-0000-4000-8000-000000000001',
      kind: 'choice_made',
      chapterId: 'ch1',
      storyVersion: '0123456789abcdef',
      subject: 'ch1.intro.a1b2',
      outcome: null,
      ageMs: 1200,
    },
    {
      eventId: '00000000-0000-4000-8000-000000000002',
      kind: 'puzzle_ended',
      chapterId: 'ch1',
      storyVersion: '0123456789abcdef',
      subject: 'ch1.drawer',
      outcome: 'solved',
      ageMs: 0,
    },
  ];

  // The fake answers at once; only the requests matter here.
  void api.postStatEvents(evs, { keepalive: true });
  void api.postStatEvents(evs);
  void api.getStats();

  expect(calls.map((c) => c.r)).toEqual([
    { method: 'POST', path: '/api/stats/events', body: { events: evs }, keepalive: true },
    { method: 'POST', path: '/api/stats/events', body: { events: evs }, keepalive: false },
    { method: 'GET', path: '/api/stats' },
  ]);
  // The body is the whole PostStatsRequest: the server answers an unknown field with a 400 for the batch.
  for (const { r } of calls.slice(0, 2)) {
    expect(typeof r.body === 'object' && r.body !== null ? Object.keys(r.body) : null).toEqual(['events']);
  }
  const post = samplesOf('PostStatsResponse')[0];
  const stats = samplesOf('StatsResponse')[0];
  expect(calls[0]?.decode(post)).toEqual({ ok: true, value: post });
  expect(calls[1]?.decode(post)).toEqual({ ok: true, value: post });
  expect(calls[2]?.decode(stats)).toEqual({ ok: true, value: stats });
});
