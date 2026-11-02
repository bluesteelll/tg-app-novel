// Friends, invites, consent, the friend profile and the share text (META-PLAN M10-M14, "Module API"). The server is
// the truth: the state is the last applied `SocialResponse` and nothing else, persisted nowhere (principle 1). Friends
// are addressed by handle only; a friend's first name comes from the friend list, never from the profile (M13).
import { metaError } from '../api/endpoints.ts';
import type { FriendHandle, MetaEndpoints, MetaError } from '../api/endpoints.ts';
import type { FriendProfile, InviteView, ShareResponse, SocialResponse } from '../api/generated/api.ts';
import type { ApiError } from '../api/http.ts';
import type { Lang } from '../i18n/index.ts';
import type { ConsentTextVersion } from '../i18n/meta.ts';
import type { EndingName, Result, StoryId } from '../story/catalog.ts';
import type { AchievementId } from './card.ts';

export type { FriendHandle } from '../api/endpoints.ts';
export type { InviteView } from '../api/generated/api.ts';

/** META-PLAN `FriendView`: a friend or a requester. */
export type FriendView = { handle: FriendHandle; firstName: string };
/** META-PLAN `SocialView`; `requests` are incoming only. */
export type SocialView = {
  inviteCode: string;
  friends: readonly FriendView[];
  requests: ReadonlyArray<FriendView & { at: number }>;
  profileVisible: boolean;
};
/** A friend's profile (M13): `visible` false carries no stories; texts in one language. */
export type FriendProfileView = {
  handle: FriendHandle;
  firstName: string;
  visible: boolean;
  stories: ReadonlyArray<{
    storyId: StoryId;
    storyTitle: string;
    endingsFound: number;
    achievementsUnlocked: number;
    sharedEndings: ReadonlyArray<{ name: EndingName; title: string }>;
    sharedAchievements: ReadonlyArray<{ id: AchievementId; name: string }>;
  }>;
};

export interface SocialService {
  /** The last applied server state; null before the first answer. */
  state(): SocialView | null;
  refresh(): Promise<Result<SocialView, MetaError>>;
  accept(from: FriendHandle): Promise<Result<SocialView, MetaError>>;
  /** Removes a friend or declines a request (F20). */
  remove(user: FriendHandle): Promise<Result<SocialView, MetaError>>;
  rotate(): Promise<Result<SocialView, MetaError>>;
  setVisible(on: boolean, textVersion: ConsentTextVersion): Promise<Result<SocialView, MetaError>>;
  /** `not-found` without a request when `user` is not among the friends of the current state. */
  profile(user: FriendHandle, lang: Lang): Promise<Result<FriendProfileView, MetaError>>;
  /** `not-found` without a request for a code outside the grammar. */
  invite(code: string): Promise<Result<InviteView, MetaError>>;
  ask(code: string): Promise<Result<InviteView, MetaError>>;
  prepareShare(story: StoryId | null, lang: Lang, native: boolean): Promise<Result<ShareResponse, MetaError>>;
}

/** An invite code: 32 lower-case hex (the server's `is_invite_code`). A start parameter is input, never trusted (M11). */
const INVITE_CODE = /^[0-9a-f]{32}$/;
const NOT_FOUND: Result<never, MetaError> = { ok: false, error: { kind: 'not-found' } };

export function createSocialService(
  api: Pick<
    MetaEndpoints,
    'getSocial' | 'getInvite' | 'askInvite' | 'acceptFriend' | 'removeFriend' | 'rotateInvite' | 'putConsent' | 'getFriendProfile' | 'postShare'
  >,
  o: { storyTitle: (story: StoryId, lang: Lang) => string | null },
): SocialService {
  let view: SocialView | null = null;
  // Calls are numbered at issue; an answer replaces the state only if issued after the one that last did, so a slow
  // refresh never puts back what a later accept changed (cut D6). The caller always gets its own answer.
  let issued = 0;
  let applied = 0;

  async function replacing(call: () => Promise<Result<SocialResponse, ApiError>>): Promise<Result<SocialView, MetaError>> {
    const seq = ++issued;
    const r = await call();
    if (!r.ok) {
      return { ok: false, error: metaError(r.error) };
    }
    const next = socialView(r.value);
    if (seq > applied) {
      view = next;
      applied = seq;
    }
    return { ok: true, value: next };
  }

  async function mapped<T>(call: Promise<Result<T, ApiError>>): Promise<Result<T, MetaError>> {
    const r = await call;
    return r.ok ? r : { ok: false, error: metaError(r.error) };
  }

  return {
    state: () => view,
    refresh: () => replacing(() => api.getSocial()),
    accept: (from) => replacing(() => api.acceptFriend(from)),
    remove: (user) => replacing(() => api.removeFriend(user)),
    rotate: () => replacing(() => api.rotateInvite()),
    setVisible: (on, textVersion) => replacing(() => api.putConsent({ granted: on, textVersion })),
    async profile(user, lang) {
      const friend = view?.friends.find((f) => f.handle === user);
      if (friend === undefined) {
        return NOT_FOUND;
      }
      const r = await api.getFriendProfile(user);
      return r.ok ? { ok: true, value: profileView(friend, r.value, lang, o.storyTitle) } : { ok: false, error: metaError(r.error) };
    },
    invite: (code) => (INVITE_CODE.test(code) ? mapped(api.getInvite(code)) : Promise.resolve(NOT_FOUND)),
    ask: (code) => (INVITE_CODE.test(code) ? mapped(api.askInvite(code)) : Promise.resolve(NOT_FOUND)),
    prepareShare: (story, lang, native) => mapped(api.postShare({ storyId: story, lang, native })),
  };
}

function socialView(s: SocialResponse): SocialView {
  // The decoder checked every handle against the server's grammar, so the brand is earned there.
  return {
    inviteCode: s.inviteCode,
    friends: s.friends.map((f) => ({ handle: f.handle as FriendHandle, firstName: f.firstName })),
    requests: s.requests.map((r) => ({ handle: r.handle as FriendHandle, firstName: r.firstName, at: r.at })),
    profileVisible: s.profileVisible,
  };
}

function profileView(
  friend: FriendView,
  p: FriendProfile,
  lang: Lang,
  storyTitle: (story: StoryId, lang: Lang) => string | null,
): FriendProfileView {
  // A story the client catalog cannot title (a server index ahead of the bundle) is left out: display only (cut Q5).
  const stories = p.visible
    ? p.stories.flatMap((s) => {
        const storyId = s.storyId as StoryId;
        const title = storyTitle(storyId, lang);
        return title === null
          ? []
          : [
              {
                storyId,
                storyTitle: title,
                endingsFound: s.endingsFound,
                achievementsUnlocked: s.achievementsUnlocked,
                sharedEndings: s.sharedEndings.map((e) => ({ name: e.name as EndingName, title: e.title[lang] })),
                sharedAchievements: s.sharedAchievements.map((a) => ({ id: a.id as AchievementId, name: a.name[lang] })),
              },
            ];
      })
    : [];
  return { handle: friend.handle, firstName: friend.firstName, visible: p.visible, stories };
}
