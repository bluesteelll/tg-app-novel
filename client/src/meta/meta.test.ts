import { expect, test, vi } from 'vitest';

import { decodeCardResponse, decodeFriendProfile, decodeInviteView, decodeSocialResponse } from '../api/decode.ts';
import type { Decoder } from '../api/decode.ts';
import type { MetaEndpoints, MetaError } from '../api/endpoints.ts';
import samplesText from '../api/fixtures/dto-samples.json?raw';
import type { SocialResponse } from '../api/generated/api.ts';
import type { ApiError } from '../api/http.ts';
import type { Lang } from '../i18n/index.ts';
import type { HintPortError } from '../puzzles/session.ts';
import type { Result, StoryId } from '../story/catalog.ts';
// Types only: the module value-exports the overlay components, which the node project cannot load.
import type { CardData, FriendHandle as OverlayHandle, ProfileData, ShownError, SocialData } from '../ui/meta/index.ts';
import { createCardService } from './card.ts';
import { createSocialService } from './social.ts';
import type { FriendHandle, FriendView } from './social.ts';

const SAMPLES: unknown = JSON.parse(samplesText);

/**
 * The decoded samples of `name`. Every fake answers one, edited by spreads and never written as a DTO literal, so a
 * field the server adds reaches these tests through the samples and their decoder only.
 */
function samples<T>(name: string, decode: Decoder<T>): T[] {
  const all = typeof SAMPLES === 'object' && SAMPLES !== null ? (SAMPLES as Record<string, unknown>) : {};
  const list = Object.hasOwn(all, name) ? all[name] : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`dto-samples.json has no samples of ${name}`);
  }
  return list.map((raw, i) => {
    const r = decode(raw);
    if (!r.ok) {
      throw new Error(`dto-samples.json ${name}[${i}]: ${r.error}`);
    }
    return r.value;
  });
}

function sample<T>(name: string, i: number, decode: Decoder<T>): T {
  const s = samples(name, decode)[i];
  if (s === undefined) {
    throw new Error(`dto-samples.json has no ${name}[${i}]`);
  }
  return s;
}

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

function value<T, E>(r: Result<T, E>): T {
  if (!r.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** A promise the test settles by hand: an answer that arrives late. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const MANOR = 'manor' as StoryId;
const TIDE = 'tide' as StoryId;
// The samples' friend (SocialResponse[0].friends) and requester (.requests), and an invite code of the grammar.
const ANYA = '0123456789abcdef01234567' as FriendHandle;
const BEN = 'fedcba9876543210fedcba98' as FriendHandle;
const CODE = '0123456789abcdef0123456789abcdef';

/** Every social route as a mock that fails the test unless it was given an answer. */
function socialApi() {
  const unexpected = (route: string) => () => Promise.reject(new Error(`unexpected ${route}`));
  return {
    getSocial: vi.fn<MetaEndpoints['getSocial']>(unexpected('getSocial')),
    getInvite: vi.fn<MetaEndpoints['getInvite']>(unexpected('getInvite')),
    askInvite: vi.fn<MetaEndpoints['askInvite']>(unexpected('askInvite')),
    acceptFriend: vi.fn<MetaEndpoints['acceptFriend']>(unexpected('acceptFriend')),
    removeFriend: vi.fn<MetaEndpoints['removeFriend']>(unexpected('removeFriend')),
    rotateInvite: vi.fn<MetaEndpoints['rotateInvite']>(unexpected('rotateInvite')),
    putConsent: vi.fn<MetaEndpoints['putConsent']>(unexpected('putConsent')),
    getFriendProfile: vi.fn<MetaEndpoints['getFriendProfile']>(unexpected('getFriendProfile')),
    postShare: vi.fn<MetaEndpoints['postShare']>(unexpected('postShare')),
  };
}

/** `SocialResponse[0]` (Аня a friend, Ben requesting) and the answer after Ben is accepted. */
function socialBodies(): { before: SocialResponse; accepted: SocialResponse } {
  const before = sample('SocialResponse', 0, decodeSocialResponse);
  return { before, accepted: { ...before, friends: [...before.friends, ...before.requests], requests: [] } };
}

/** Tide is the only story the client catalog titles here. */
const titles = (story: StoryId, lang: Lang): string | null => (story === TIDE ? (lang === 'ru' ? 'Прилив' : 'The tide') : null);

test('card: loads once per open and keeps no copy', async () => {
  const full = sample('CardResponse', 0, decodeCardResponse);
  const empty = sample('CardResponse', 1, decodeCardResponse);
  const postCard = vi.fn<MetaEndpoints['postCard']>().mockResolvedValueOnce(ok(full)).mockResolvedValueOnce(ok(empty));
  const cards = createCardService({ postCard });

  const first = value(await cards.load(MANOR, 'ru'));
  const second = value(await cards.load(MANOR, 'ru'));
  // M9: one request per open; the second open shows the second answer, not a kept copy of the first.
  expect(postCard).toHaveBeenCalledTimes(2);
  expect(postCard.mock.calls).toEqual([[MANOR], [MANOR]]);
  expect(first).toEqual({
    storyId: MANOR,
    runs: 3,
    chaptersCompleted: ['ch1', 'ch2'],
    endings: [
      { name: 'ashes', title: 'Образец: пепел', firstReachedAt: 1799999400 },
      { name: 'truth', title: 'Образец: правда', firstReachedAt: 1799999940 },
    ],
    achievements: [
      { id: 'first_steps', name: 'Образец: первые шаги', description: 'Образец: дойти до концовки', unlockedAt: 1799999400, isNew: false },
      { id: 'both_roads', name: 'Образец: обе дороги', description: 'Образец: найти обе концовки', unlockedAt: 1800000000, isNew: true },
    ],
  });
  // The view's story is the one asked for.
  expect(second).toEqual({ storyId: MANOR, runs: 0, chaptersCompleted: [], endings: [], achievements: [] });
  expect(second).not.toBe(first);

  postCard.mockResolvedValueOnce(ok(full));
  const en = value(await cards.load(MANOR, 'en'));
  expect(en.endings.map((e) => e.title)).toEqual(['Sample: ashes', 'Sample: the truth']);
  expect(en.achievements.map((a) => [a.id, a.name, a.description, a.isNew])).toEqual([
    ['first_steps', 'Sample: first steps', 'Sample: reach an ending', false],
    ['both_roads', 'Sample: both roads', 'Sample: find both endings', true],
  ]);

  postCard.mockResolvedValueOnce({ ok: false, error: { kind: 'http', status: 404, code: 'not_found', body: null, retryAfter: null } });
  expect(await cards.load(MANOR, 'en')).toStrictEqual({ ok: false, error: { kind: 'not-found' } });
  expect(postCard).toHaveBeenCalledTimes(4);
});

test('social: accept refreshes friends', async () => {
  const { before, accepted } = socialBodies();
  const api = socialApi();
  api.getSocial.mockResolvedValueOnce(ok(before));
  api.acceptFriend.mockResolvedValueOnce(ok(accepted));
  const social = createSocialService(api, { storyTitle: titles });

  expect(social.state()).toBe(null);
  value(await social.refresh());
  expect(social.state()?.requests).toEqual([{ handle: BEN, firstName: 'Ben', at: 1800000000 }]);

  const answer = value(await social.accept(BEN));
  expect(api.acceptFriend.mock.calls).toEqual([[BEN]]);
  // The state is the accept's answer: Ben is a friend, and no request is left.
  expect(social.state()?.friends).toEqual([
    { handle: ANYA, firstName: 'Аня' },
    { handle: BEN, firstName: 'Ben' },
  ]);
  expect(social.state()?.requests).toEqual([]);
  expect(answer).toEqual(social.state());

  // A failed action leaves the state as it was.
  api.removeFriend.mockResolvedValueOnce({ ok: false, error: { kind: 'http', status: 404, code: 'not_found', body: null, retryAfter: null } });
  expect(await social.remove(BEN)).toStrictEqual({ ok: false, error: { kind: 'not-found' } });
  expect(social.state()).toEqual(answer);
});

test('social: ask returns the invite state', async () => {
  const views = samples('InviteView', decodeInviteView);
  expect(views.map((v) => v.state)).toEqual(['open', 'requested', 'friends', 'own']);
  const api = socialApi();
  const social = createSocialService(api, { storyTitle: titles });
  for (const view of views) {
    api.getInvite.mockResolvedValueOnce(ok(view));
    api.askInvite.mockResolvedValueOnce(ok(view));
    expect(await social.invite(CODE), view.state).toEqual({ ok: true, value: view });
    expect(await social.ask(CODE), view.state).toEqual({ ok: true, value: view });
  }
  expect(api.getInvite.mock.calls).toEqual([[CODE], [CODE], [CODE], [CODE]]);
  expect(api.askInvite.mock.calls).toEqual([[CODE], [CODE], [CODE], [CODE]]);

  // M11: a start parameter is input; outside the grammar nothing is sent.
  const outside = [`F${CODE.slice(1)}`, CODE.slice(1), `f${CODE}`, CODE.toUpperCase(), '../social', ''];
  for (const code of outside) {
    expect(await social.invite(code), code).toStrictEqual({ ok: false, error: { kind: 'not-found' } });
    expect(await social.ask(code), code).toStrictEqual({ ok: false, error: { kind: 'not-found' } });
  }
  expect(api.getInvite).toHaveBeenCalledTimes(4);
  expect(api.askInvite).toHaveBeenCalledTimes(4);

  api.askInvite.mockResolvedValueOnce({ ok: false, error: { kind: 'http', status: 404, code: 'not_found', body: null, retryAfter: null } });
  expect(await social.ask(CODE)).toStrictEqual({ ok: false, error: { kind: 'not-found' } });

  api.getSocial.mockResolvedValueOnce(ok(socialBodies().before));
  value(await social.refresh());
  // Typed by the brand: a plain string here would fail `check`.
  const handle: FriendHandle | undefined = social.state()?.friends[0]?.handle;
  expect(handle).toBe(ANYA);
});

test('social: profile takes the name from the friend list', async () => {
  const { before, accepted } = socialBodies();
  const shown = sample('FriendProfile', 0, decodeFriendProfile);
  const hidden = sample('FriendProfile', 1, decodeFriendProfile);
  const api = socialApi();
  const social = createSocialService(api, { storyTitle: titles });

  // No state yet: nobody is a friend, and nothing is asked.
  expect(await social.profile(ANYA, 'ru')).toStrictEqual({ ok: false, error: { kind: 'not-found' } });

  api.getSocial.mockResolvedValueOnce(ok(before));
  value(await social.refresh());
  api.getFriendProfile.mockResolvedValueOnce(ok(shown)).mockResolvedValueOnce(ok(shown));
  expect(value(await social.profile(ANYA, 'ru'))).toEqual({
    handle: ANYA,
    firstName: 'Аня',
    visible: true,
    stories: [
      {
        storyId: TIDE,
        storyTitle: 'Прилив',
        endingsFound: 2,
        achievementsUnlocked: 1,
        sharedEndings: [{ name: 'drowned', title: 'Образец: утонувший' }],
        sharedAchievements: [{ id: 'first_steps', name: 'Образец: первые шаги' }],
      },
    ],
  });
  const en = value(await social.profile(ANYA, 'en'));
  expect(en.stories.map((s) => [s.storyTitle, s.sharedEndings[0]?.title, s.sharedAchievements[0]?.name])).toEqual([
    ['The tide', 'Sample: drowned', 'Sample: first steps'],
  ]);
  expect(api.getFriendProfile.mock.calls).toEqual([[ANYA], [ANYA]]);

  // Ben only requested: not a friend, so no request.
  expect(await social.profile(BEN, 'ru')).toStrictEqual({ ok: false, error: { kind: 'not-found' } });
  expect(api.getFriendProfile).toHaveBeenCalledTimes(2);

  // A hidden profile shows nothing; the name still comes from the list.
  api.acceptFriend.mockResolvedValueOnce(ok(accepted));
  value(await social.accept(BEN));
  api.getFriendProfile.mockResolvedValueOnce(ok(hidden));
  expect(value(await social.profile(BEN, 'ru'))).toEqual({ handle: BEN, firstName: 'Ben', visible: false, stories: [] });

  // The server's 404 (no longer a friend) is `not-found`; the list refresh is the controller's step.
  api.getFriendProfile.mockResolvedValueOnce({ ok: false, error: { kind: 'http', status: 404, code: 'not_found', body: null, retryAfter: null } });
  expect(await social.profile(BEN, 'ru')).toStrictEqual({ ok: false, error: { kind: 'not-found' } });

  // A story the client catalog cannot title is left out (cut Q5).
  const untitled = createSocialService(api, { storyTitle: () => null });
  api.getSocial.mockResolvedValueOnce(ok(before));
  value(await untitled.refresh());
  api.getFriendProfile.mockResolvedValueOnce(ok(shown));
  expect(value(await untitled.profile(ANYA, 'ru')).stories).toEqual([]);
  expect(api.getFriendProfile).toHaveBeenCalledTimes(5);
});

test('social: an older response never replaces a newer state', async () => {
  const { before, accepted } = socialBodies();
  const api = socialApi();
  const late = deferred<Result<SocialResponse, ApiError>>();
  api.getSocial.mockReturnValueOnce(late.promise);
  api.acceptFriend.mockResolvedValueOnce(ok(accepted));
  const social = createSocialService(api, { storyTitle: titles });

  // The boot refresh is issued first and answers last, after the accept.
  const refreshing = social.refresh();
  value(await social.accept(BEN));
  expect(social.state()?.friends.map((f) => f.handle)).toEqual([ANYA, BEN]);
  late.resolve(ok(before));
  const own = value(await refreshing);

  expect(social.state()?.friends.map((f) => f.handle)).toEqual([ANYA, BEN]);
  expect(social.state()?.requests).toEqual([]);
  // The caller still gets its own answer.
  expect(own.requests.map((r) => r.handle)).toEqual([BEN]);

  // A newer refresh replaces it as usual.
  api.getSocial.mockResolvedValueOnce(ok(before));
  value(await social.refresh());
  expect(social.state()?.requests.map((r) => r.handle)).toEqual([BEN]);
});

test('meta: views are assignable to the overlay and port types', async () => {
  // Typed values, never literals: a view that drifts from the overlay's data type fails `check` here (carry a, c).
  const card = value(await createCardService({ postCard: () => Promise.resolve(ok(sample('CardResponse', 0, decodeCardResponse))) }).load(MANOR, 'en'));
  void (card satisfies CardData);
  expect(card.storyId).toBe(MANOR);

  const failed: MetaError = { kind: 'rate-limited', retryAfter: 30 };
  void (failed satisfies ShownError);
  void (failed satisfies HintPortError);
  // @ts-expect-error: a kind outside the union is no MetaError.
  const unknownKind: MetaError = { kind: 'teapot' };
  void unknownKind;

  const api = socialApi();
  api.getSocial.mockResolvedValueOnce(ok(socialBodies().before));
  api.getFriendProfile.mockResolvedValueOnce(ok(sample('FriendProfile', 0, decodeFriendProfile)));
  const social = createSocialService(api, { storyTitle: titles });
  const state = value(await social.refresh());
  const profile = value(await social.profile(ANYA, 'ru'));
  void (state satisfies SocialData);
  void (profile satisfies ProfileData);
  // LU1's brand and this one are the same type, both ways.
  const overlay: OverlayHandle = profile.handle;
  const back: FriendHandle = overlay;
  expect(back).toBe(ANYA);
  // @ts-expect-error: a friend is addressed by handle only, never by a user id (M10).
  const byId: FriendView = { handle: ANYA, firstName: 'Аня', userId: 1 };
  void byId;
});
