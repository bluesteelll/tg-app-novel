import { expect, test } from 'vitest';

import type { Result, StoryId } from '../story/catalog.ts';
import type { ChapterId, PuzzleLocalId } from '../story/staging.ts';
import { DTO_DECODERS, decodeApiErrorBody, decodePostStatsResponse, decodePuzzleStatus, decodeStatsResponse } from './decode.ts';
import type { DecodedDto, Decoder } from './decode.ts';
import { createEndpoints, createMetaEndpoints, metaError, puzzleId } from './endpoints.ts';
import type { FriendHandle, MetaEndpoints, MetaError } from './endpoints.ts';
import samplesText from './fixtures/dto-samples.json?raw';
import type { ErrorCode, StatEventDto, StatRejectReason } from './generated/api.ts';
import { createHttp } from './http.ts';
import type { ApiError, ApiRequest, Clock, FetchFn, Http } from './http.ts';

// The DTOs this module decodes, listed here and never read from the file's keys: another lane's new samples (LF1's
// social DTOs, say) neither break nor silently extend this test.
const NAMES: readonly DecodedDto[] = [
  'ApiErrorBody',
  'AttemptResponse',
  'AuthResponse',
  'CardResponse',
  'ChapterPayload',
  'CreateInvoiceResponse',
  'EntitlementsResponse',
  'FriendProfile',
  'GiftResponse',
  'HintUseResponse',
  'InviteView',
  'OrderResponse',
  'PostStatsResponse',
  'PutSaveResponse',
  'PuzzleStatus',
  'SaveFull',
  'SaveListResponse',
  'ShareResponse',
  'SocialResponse',
  'StatsResponse',
  'WalletResponse',
];

// The meta DTOs (META-PLAN M9-M14, M19-M21): a subset of NAMES, each with its own samples test below.
const META_NAMES: readonly DecodedDto[] = [
  'CardResponse',
  'FriendProfile',
  'GiftResponse',
  'HintUseResponse',
  'InviteView',
  'ShareResponse',
  'SocialResponse',
  'WalletResponse',
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

/** A deep copy of the value at `path` in a sample: the repeated item of a duplicate-key row. */
function copyOf(name: DecodedDto, sample: number, path: readonly Step[]): unknown {
  let node: unknown = samplesOf(name)[sample];
  for (const step of path) {
    node = (node as Record<Step, unknown>)[step];
  }
  return structuredClone(node);
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
  // A keyed `{#each}` of the meta overlays throws on a repeated key: every keyed list refuses one (carry a).
  { dto: 'CardResponse', sample: 0, path: ['endings', 1, 'name'], value: 'ashes', error: 'CardResponse.endings[1].name: duplicate' },
  { dto: 'CardResponse', sample: 0, path: ['achievements', 1, 'id'], value: 'first_steps', error: 'CardResponse.achievements[1].id: duplicate' },
  { dto: 'CardResponse', sample: 0, path: ['achievements', 0, 'new'], value: REMOVE, error: 'CardResponse.achievements[0].new: missing' },
  { dto: 'ChapterPayload', sample: 1, path: ['world'], value: REMOVE, error: 'ChapterPayload.world: missing' },
  { dto: 'ChapterPayload', sample: 0, path: ['chapterId'], value: 2, error: 'ChapterPayload.chapterId: ' },
  { dto: 'ChapterPayload', sample: 0, path: ['story'], value: null, error: 'ChapterPayload.story: ' },
  { dto: 'CreateInvoiceResponse', sample: 0, path: ['invoiceUrl'], value: REMOVE, error: 'CreateInvoiceResponse.invoiceUrl: missing' },
  { dto: 'CreateInvoiceResponse', sample: 0, path: ['orderId'], value: null, error: 'CreateInvoiceResponse.orderId: ' },
  { dto: 'EntitlementsResponse', sample: 0, path: ['products', 0, 'owned'], value: REMOVE, error: 'EntitlementsResponse.products[0].owned: missing' },
  { dto: 'EntitlementsResponse', sample: 0, path: ['products', 1, 'priceStars'], value: 1.5, error: 'EntitlementsResponse.products[1].priceStars: ' },
  { dto: 'FriendProfile', sample: 0, path: ['stories', 1], value: copyOf('FriendProfile', 0, ['stories', 0]), error: 'FriendProfile.stories[1].storyId: duplicate' },
  {
    dto: 'FriendProfile',
    sample: 0,
    path: ['stories', 0, 'sharedEndings', 1],
    value: copyOf('FriendProfile', 0, ['stories', 0, 'sharedEndings', 0]),
    error: 'FriendProfile.stories[0].sharedEndings[1].name: duplicate',
  },
  {
    dto: 'FriendProfile',
    sample: 0,
    path: ['stories', 0, 'sharedAchievements', 1],
    value: copyOf('FriendProfile', 0, ['stories', 0, 'sharedAchievements', 0]),
    error: 'FriendProfile.stories[0].sharedAchievements[1].id: duplicate',
  },
  // A handle is 24 lower-case hex (the server's is_handle): a numeric user id never passes for one (M10).
  { dto: 'FriendProfile', sample: 0, path: ['handle'], value: '0123456789ABCDEF01234567', error: 'FriendProfile.handle: expected a handle' },
  // M13: a hidden profile shows nothing, so stories on one are an error value, never shown.
  {
    dto: 'FriendProfile',
    sample: 1,
    path: ['stories'],
    value: [copyOf('FriendProfile', 0, ['stories', 0])],
    error: 'FriendProfile.stories: stories on a hidden profile',
  },
  { dto: 'GiftResponse', sample: 0, path: ['balance'], value: REMOVE, error: 'GiftResponse.balance: missing' },
  { dto: 'GiftResponse', sample: 0, path: ['balance'], value: '1', error: 'GiftResponse.balance: ' },
  // The seeded field rename of PROTOTYPE-PLAN LMD commit 1, kept as an in-memory row: the fixture is never edited.
  { dto: 'HintUseResponse', sample: 0, path: ['text'], value: REMOVE, error: 'HintUseResponse.text: missing' },
  { dto: 'HintUseResponse', sample: 0, path: ['balance'], value: '2', error: 'HintUseResponse.balance: ' },
  { dto: 'InviteView', sample: 0, path: ['state'], value: 'blocked', error: 'InviteView.state: ' },
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
  { dto: 'ShareResponse', sample: 1, path: ['preparedMessageId'], value: 7, error: 'ShareResponse.preparedMessageId: ' },
  { dto: 'ShareResponse', sample: 0, path: ['link'], value: REMOVE, error: 'ShareResponse.link: missing' },
  { dto: 'SocialResponse', sample: 0, path: ['friends', 1], value: copyOf('SocialResponse', 0, ['friends', 0]), error: 'SocialResponse.friends[1].handle: duplicate' },
  { dto: 'SocialResponse', sample: 0, path: ['requests', 1], value: copyOf('SocialResponse', 0, ['requests', 0]), error: 'SocialResponse.requests[1].handle: duplicate' },
  { dto: 'SocialResponse', sample: 0, path: ['friends', 0, 'handle'], value: '1001', error: 'SocialResponse.friends[0].handle: expected a handle' },
  { dto: 'SocialResponse', sample: 0, path: ['inviteCode'], value: REMOVE, error: 'SocialResponse.inviteCode: missing' },
  { dto: 'StatsResponse', sample: 0, path: ['game', 'storiesTotal'], value: REMOVE, error: 'StatsResponse.game.storiesTotal: missing' },
  { dto: 'StatsResponse', sample: 0, path: ['stories', 0, 'started'], value: 'yes', error: 'StatsResponse.stories[0].started: ' },
  { dto: 'StatsResponse', sample: 0, path: ['stories', 0, 'chaptersCompleted', 0], value: 1, error: 'StatsResponse.stories[0].chaptersCompleted[0]: ' },
  { dto: 'StatsResponse', sample: 0, path: ['stories', 1, 'endingsReached'], value: null, error: 'StatsResponse.stories[1].endingsReached: ' },
  { dto: 'WalletResponse', sample: 0, path: ['balances', 1], value: { kind: 'hint', balance: 0, debt: 0 }, error: 'WalletResponse.balances[1].kind: duplicate' },
  { dto: 'WalletResponse', sample: 0, path: ['packs', 1, 'productId'], value: 'pack:hint_s', error: 'WalletResponse.packs[1].productId: duplicate' },
  { dto: 'WalletResponse', sample: 0, path: ['hintTierCost'], value: REMOVE, error: 'WalletResponse.hintTierCost: missing' },
  { dto: 'WalletResponse', sample: 0, path: ['maxPerGift'], value: REMOVE, error: 'WalletResponse.maxPerGift: missing' },
  { dto: 'WalletResponse', sample: 0, path: ['maxPerGift'], value: 1.5, error: 'WalletResponse.maxPerGift: ' },
  { dto: 'WalletResponse', sample: 0, path: ['packs', 0, 'title', 'ru'], value: 3, error: 'WalletResponse.packs[0].title.ru: ' },
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

test('decode: meta samples decode', () => {
  const decoders = Object.keys(DTO_DECODERS);
  for (const name of META_NAMES) {
    expect(NAMES, name).toContain(name);
    expect(decoders, name).toContain(name);
    for (const sample of samplesOf(name)) {
      expect(DTO_DECODERS[name](sample), name).toEqual({ ok: true, value: sample });
    }
  }

  // RULINGS 79 Q3, M10: a profile carries no first name and no user id, and an invite names nobody; one a server sent
  // is ignored, never copied. An achievement's `id` is legitimate deeper in a profile, so `id` is scanned at the top.
  for (const plain of samplesOf('FriendProfile')) {
    const read = DTO_DECODERS.FriendProfile(edited(edited(plain, ['firstName'], 'Аня'), ['id'], 1001));
    expect(read).toEqual({ ok: true, value: plain });
    const value = read.ok ? read.value : null;
    expect(Object.keys(value ?? {})).not.toContain('id');
    expect(keysDeep(value)).not.toContain('firstName');
  }
  for (const plain of samplesOf('InviteView')) {
    const read = DTO_DECODERS.InviteView(edited(plain, ['ownerName'], 'Аня'));
    expect(read).toEqual({ ok: true, value: plain });
    expect(keysDeep(read.ok ? read.value : null)).not.toContain('ownerName');
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

/** Timers that never fire: no call here reaches the request timeout. */
const INERT_CLOCK: Clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} };

type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** The meta routes over the real http client: the fake fetch answers the auth exchange, and `answer` every other call. */
function metaApi(answer: (s: Sent) => Response): { api: MetaEndpoints; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch: FetchFn = (input, init) => {
    if (input === '/api/auth') {
      return Promise.resolve(json(200, { token: 'tok-1', expiresAt: 1800001800, user: { id: 1001, firstName: 'Аня', languageCode: 'ru' } }));
    }
    const s: Sent = {
      url: input,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    };
    sent.push(s);
    return Promise.resolve(answer(s));
  };
  return { api: createMetaEndpoints(createHttp({ initData: 'query_id=AAH1&hash=0123abcd', clock: INERT_CLOCK, fetch })), sent };
}

test('endpoints: meta routes', async () => {
  const friend = '0123456789abcdef01234567' as FriendHandle;
  const code = '0123456789abcdef0123456789abcdef';
  const requestId = '6f1c2b0e-3d4a-4b5c-8d9e-0a1b2c3d4e5f';
  const gift = { to: friend, kind: 'hint', amount: 2, requestId, from: 1001 };
  type Route = {
    call: (api: MetaEndpoints) => Promise<Result<unknown, ApiError>>;
    method: string;
    url: string;
    body: unknown;
    answer: DecodedDto;
  };
  // What reaches fetch, so the method is observed past http.ts's types; `body` null is a request without one.
  const routes: readonly Route[] = [
    { call: (api) => api.getWallet(), method: 'GET', url: '/api/wallet', body: null, answer: 'WalletResponse' },
    {
      call: (api) => api.useHint(puzzleId('ch1' as ChapterId, 'drawer' as PuzzleLocalId), 2, 'en'),
      method: 'POST',
      url: '/api/puzzles/ch1.drawer/hints/2?lang=en',
      body: null,
      answer: 'HintUseResponse',
    },
    { call: (api) => api.postCard('manor' as StoryId), method: 'POST', url: '/api/stories/manor/card', body: null, answer: 'CardResponse' },
    { call: (api) => api.getSocial(), method: 'GET', url: '/api/social', body: null, answer: 'SocialResponse' },
    // A '/' or '?' stays inside its segment: no code can change the route (the service sends none outside the grammar).
    { call: (api) => api.getInvite('a/b?c'), method: 'GET', url: '/api/invites/a%2Fb%3Fc', body: null, answer: 'InviteView' },
    { call: (api) => api.askInvite(code), method: 'POST', url: `/api/invites/${code}/request`, body: null, answer: 'InviteView' },
    {
      call: (api) => api.acceptFriend(friend),
      method: 'POST',
      url: `/api/friends/requests/${friend}/accept`,
      body: null,
      answer: 'SocialResponse',
    },
    { call: (api) => api.removeFriend(friend), method: 'DELETE', url: `/api/friends/${friend}`, body: null, answer: 'SocialResponse' },
    { call: (api) => api.rotateInvite(), method: 'POST', url: '/api/invite/rotate', body: null, answer: 'SocialResponse' },
    {
      call: (api) => api.putConsent({ granted: true, textVersion: 'friends_profile.v1' }),
      method: 'PUT',
      url: '/api/consents/friends_profile',
      body: { granted: true, textVersion: 'friends_profile.v1' },
      answer: 'SocialResponse',
    },
    // No `?lang`: the profile's titles come in both languages.
    { call: (api) => api.getFriendProfile(friend), method: 'GET', url: `/api/friends/${friend}/profile`, body: null, answer: 'FriendProfile' },
    {
      call: (api) => api.postShare({ storyId: null, lang: 'ru', native: false }),
      method: 'POST',
      url: '/api/share',
      body: { storyId: null, lang: 'ru', native: false },
      answer: 'ShareResponse',
    },
    // A field the caller's object holds beyond GiftRequest (a `from`, say) is a 400 on the server: it is never sent.
    {
      call: (api) => api.postGift(gift),
      method: 'POST',
      url: '/api/gifts',
      body: { to: friend, kind: 'hint', amount: 2, requestId },
      answer: 'GiftResponse',
    },
  ];
  for (const route of routes) {
    for (const [i, sample] of samplesOf(route.answer).entries()) {
      const label = `${route.method} ${route.url} <- ${route.answer}[${i}]`;
      const { api, sent } = metaApi(() => json(200, sample));
      expect(await route.call(api), label).toEqual({ ok: true, value: sample });
      expect(
        sent.map((s) => ({ url: s.url, method: s.method, body: s.body })),
        label,
      ).toEqual([{ url: route.url, method: route.method, body: route.body }]);
      expect(sent[0]?.headers['authorization'], label).toBe('Bearer tok-1');
      expect(sent[0]?.headers['content-type'], label).toBe(route.body === null ? undefined : 'application/json');
    }
  }

  // The bodies are the whole requests, in order: `storyId` is sent as null for a plain invite, never left out (LF2 M1).
  const answers: Readonly<Record<string, unknown>> = {
    '/api/share': samplesOf('ShareResponse')[1],
    '/api/gifts': samplesOf('GiftResponse')[0],
  };
  const { api, sent } = metaApi((s) => json(200, Object.hasOwn(answers, s.url) ? answers[s.url] : samplesOf('SocialResponse')[0]));
  await api.postShare({ storyId: null, lang: 'ru', native: false });
  await api.putConsent({ granted: false, textVersion: 'friends_profile.v1' });
  await api.postGift(gift);
  expect(sent.map((s) => (typeof s.body === 'object' && s.body !== null ? Object.keys(s.body) : null))).toEqual([
    ['storyId', 'lang', 'native'],
    ['granted', 'textVersion'],
    ['to', 'kind', 'amount', 'requestId'],
  ]);
});

test('endpoints: api errors map to meta errors', async () => {
  const http = (status: number, code: ErrorCode | null, retryAfter: number | null = null): ApiError => ({
    kind: 'http',
    status,
    code,
    body: code === null ? null : { error: code },
    retryAfter,
  });
  // The hint port's row first (PROTOTYPE-PLAN LMD mutation): 409 insufficient_balance opens get-more, never a retry.
  expect(metaError(http(409, 'insufficient_balance'))).toStrictEqual({ kind: 'insufficient' });

  // Exhaustive by type: a code added to api.ts fails `check` here until its row exists. Statuses as server/src/error.rs.
  const STATUS: Readonly<Record<ErrorCode, number>> = {
    bad_request: 400,
    initdata_invalid: 401,
    initdata_expired: 401,
    token_missing: 401,
    token_invalid: 401,
    token_expired: 401,
    not_entitled: 403,
    not_found: 404,
    unknown_product: 404,
    already_owned: 409,
    save_conflict: 409,
    payload_too_large: 413,
    telegram_unavailable: 502,
    rate_limited: 429,
    hint_unavailable: 409,
    insufficient_balance: 409,
    limit_reached: 409,
    internal: 500,
  };
  const EXPECTED: Readonly<Record<ErrorCode, MetaError>> = {
    bad_request: { kind: 'unavailable' },
    initdata_invalid: { kind: 'auth' },
    initdata_expired: { kind: 'auth' },
    token_missing: { kind: 'auth' },
    token_invalid: { kind: 'auth' },
    token_expired: { kind: 'auth' },
    not_entitled: { kind: 'unavailable' },
    not_found: { kind: 'not-found' },
    unknown_product: { kind: 'not-found' },
    already_owned: { kind: 'unavailable' },
    save_conflict: { kind: 'unavailable' },
    payload_too_large: { kind: 'unavailable' },
    telegram_unavailable: { kind: 'unavailable' },
    rate_limited: { kind: 'rate-limited', retryAfter: 30 },
    hint_unavailable: { kind: 'unavailable' },
    insufficient_balance: { kind: 'insufficient' },
    limit_reached: { kind: 'limit' },
    internal: { kind: 'network' },
  };
  const seen = new Set<ErrorCode>();
  for (const raw of samplesOf('ApiErrorBody')) {
    const body = decodeApiErrorBody(raw);
    if (!body.ok) {
      throw new Error(body.error);
    }
    const code = body.value.error;
    seen.add(code);
    const e: ApiError = { kind: 'http', status: STATUS[code], code, body: body.value, retryAfter: code === 'rate_limited' ? 30 : null };
    expect(metaError(e), code).toStrictEqual(EXPECTED[code]);
  }
  expect([...seen].sort()).toEqual(Object.keys(EXPECTED).sort());

  // `retryAfter` only when the server sent seconds: the key is omitted, never `undefined`.
  expect(metaError(http(429, 'rate_limited'))).toStrictEqual({ kind: 'rate-limited' });
  // No server verdict: a retry is the remedy. A refused exchange ends the session.
  expect(metaError({ kind: 'network', detail: 'timeout' })).toStrictEqual({ kind: 'network' });
  expect(metaError({ kind: 'aborted' })).toStrictEqual({ kind: 'network' });
  expect(metaError({ kind: 'decode', detail: 'WalletResponse.packs: missing' })).toStrictEqual({ kind: 'network' });
  expect(metaError({ kind: 'session-expired' })).toStrictEqual({ kind: 'auth' });
  // A proxy's non-JSON error: no code, so the status decides.
  expect(metaError(http(401, null))).toStrictEqual({ kind: 'auth' });
  expect(metaError(http(404, null))).toStrictEqual({ kind: 'not-found' });
  expect(metaError(http(429, null, 7))).toStrictEqual({ kind: 'rate-limited', retryAfter: 7 });
  expect(metaError(http(429, null))).toStrictEqual({ kind: 'rate-limited' });
  expect(metaError(http(502, null))).toStrictEqual({ kind: 'network' });

  // Through the real client: delta-seconds become `retryAfter`, an HTTP-date does not, and a token the re-auth cannot
  // cure is `auth`.
  const replies: ReadonlyArray<readonly [Response, MetaError]> = [
    [json(429, { error: 'rate_limited' }, { 'retry-after': '30' }), { kind: 'rate-limited', retryAfter: 30 }],
    [json(429, { error: 'rate_limited' }, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }), { kind: 'rate-limited' }],
    [new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }), { kind: 'network' }],
    [json(401, { error: 'token_expired' }), { kind: 'auth' }],
  ];
  for (const [i, [reply, expected]] of replies.entries()) {
    const { api } = metaApi(() => reply.clone());
    const r = await api.getWallet();
    expect(r.ok ? null : metaError(r.error), `reply ${i}: ${reply.status}`).toStrictEqual(expected);
  }
});
