// The meta routes' edge (META-PLAN "HTTP API", M9-M14, M19-M22): their decoders, the meta error mapping and the typed
// calls. Only the meta controller's lazy chunk imports this module (app/meta.ts and the meta/ services; RULINGS 105, 137),
// so none of it is in the entry: boot builds the meta endpoints from the chunk's own module. The decoders are built from
// decode.ts's combinators over the generated types, as decode.ts's own are; decode.test.ts runs them over the samples.
import type { Lang } from '../i18n/index.ts';
import type { Result, StoryId } from '../story/catalog.ts';
import {
  arrayOf,
  bool,
  decodeApiErrorBody,
  decodeAttemptResponse,
  decodeAuthResponse,
  decodeChapterPayload,
  decodeCreateInvoiceResponse,
  decodeEntitlementsResponse,
  decodeOrderResponse,
  decodePlayerValue,
  decodePostStatsResponse,
  decodePutSaveResponse,
  decodePuzzleStatus,
  decodeSaveFull,
  decodeSaveListResponse,
  decodeStatsResponse,
  decodeValuesResponse,
  int,
  nullable,
  object,
  oneOf,
  problem,
  root,
  shown,
  str,
} from './decode.ts';
import type { DecodedDto, Decoder, Field } from './decode.ts';
import { seg } from './endpoints.ts';
import type { PuzzleId } from './endpoints.ts';
import type {
  BalanceDto,
  CardAchievement,
  CardEnding,
  CardResponse,
  ConsentRequest,
  ErrorCode,
  FriendDto,
  FriendProfile,
  FriendRequestDto,
  FriendStoryDto,
  GiftRequest,
  GiftResponse,
  HintUseResponse,
  InviteState,
  InviteView,
  Localized,
  PackDto,
  ShareRequest,
  ShareResponse,
  SharedAchievement,
  SharedEnding,
  SocialResponse,
  WalletResponse,
} from './generated/api.ts';
import type { ApiError, Http } from './http.ts';

const INVITE_STATES = { open: true, requested: true, friends: true, own: true } as const satisfies Record<InviteState, true>;
/** A friend's handle: 24 lower-case hex digits (the server's `is_handle`, META M10). */
const HANDLE = /^[0-9a-f]{24}$/;

/**
 * A list a keyed `{#each}` renders by `key`: a repeated key would throw in the overlay, so it is an error value here
 * (`<path>[i].<key>: duplicate <value>`).
 */
function uniqueBy<T>(key: keyof T & string, list: Field<T[]>): Field<T[]> {
  return (v, p) => {
    const r = list(v, p);
    if (!r.ok) {
      return r;
    }
    const seen = new Set<unknown>();
    for (const [i, item] of r.value.entries()) {
      if (seen.has(item[key])) {
        return problem(`${p}[${i}].${key}`, `duplicate ${shown(item[key])}`);
      }
      seen.add(item[key]);
    }
    return r;
  };
}

/** The grammar earns the client's `FriendHandle` brand: a numeric user id can never pass for a handle (M10, W1). */
const handle: Field<string> = (v, p) => {
  const r = str(v, p);
  return !r.ok || HANDLE.test(r.value) ? r : problem(p, `expected a handle, got ${shown(r.value)}`);
};
const localized = object<Localized>({ ru: str, en: str });
const cardEnding = object<CardEnding>({ name: str, title: localized, firstReachedAt: int });
const cardAchievement = object<CardAchievement>({
  id: str,
  name: localized,
  description: localized,
  unlockedAt: int,
  new: bool,
});
const balanceDto = object<BalanceDto>({ kind: str, balance: int, debt: int });
const packDto = object<PackDto>({ productId: str, kind: str, amount: int, priceStars: int, title: localized });
const friendDto = object<FriendDto>({ handle, firstName: str });
const friendRequestDto = object<FriendRequestDto>({ handle, firstName: str, at: int });
const friendStory = object<FriendStoryDto>({
  storyId: str,
  endingsFound: int,
  achievementsUnlocked: int,
  sharedEndings: uniqueBy('name', arrayOf(object<SharedEnding>({ name: str, title: localized }))),
  sharedAchievements: uniqueBy('id', arrayOf(object<SharedAchievement>({ id: str, name: localized }))),
});
const friendProfileFields = object<FriendProfile>({ handle, visible: bool, stories: uniqueBy('storyId', arrayOf(friendStory)) });
/** META M13: a hidden profile shows nothing, so stories on one are an error, never shown. */
const friendProfile: Field<FriendProfile> = (v, p) => {
  const r = friendProfileFields(v, p);
  return !r.ok || r.value.visible || r.value.stories.length === 0 ? r : problem(`${p}.stories`, 'stories on a hidden profile');
};

// The meta DTOs (META-PLAN M9-M14, M19-M21). The decoders rely on no catalog order: they cannot know the catalog.
/** `POST /api/stories/{storyId}/card` (M9): the user's own found items only. */
export const decodeCardResponse: Decoder<CardResponse> = root(
  'CardResponse',
  object<CardResponse>({
    storyId: str,
    runs: int,
    chaptersCompleted: arrayOf(str),
    endings: uniqueBy('name', arrayOf(cardEnding)),
    achievements: uniqueBy('id', arrayOf(cardAchievement)),
  }),
);
/** `GET /api/friends/{handle}/profile` (M13): no first name and no user id. */
export const decodeFriendProfile: Decoder<FriendProfile> = root('FriendProfile', friendProfile);
/** `POST /api/gifts` (M22): the sender's balance of the kind after the gift, or the current one on a replay. */
export const decodeGiftResponse: Decoder<GiftResponse> = root('GiftResponse', object<GiftResponse>({ balance: int }));
/** `POST /api/puzzles/{puzzleId}/hints/{tier}?lang` (M21). */
export const decodeHintUseResponse: Decoder<HintUseResponse> = root(
  'HintUseResponse',
  object<HintUseResponse>({ balance: int, text: str }),
);
/** `GET /api/invites/{code}` and `POST /api/invites/{code}/request` (M10): nothing about the code's owner. */
export const decodeInviteView: Decoder<InviteView> = root('InviteView', object<InviteView>({ state: oneOf(INVITE_STATES) }));
/** `POST /api/share` (M14). */
export const decodeShareResponse: Decoder<ShareResponse> = root(
  'ShareResponse',
  object<ShareResponse>({ link: str, text: str, preparedMessageId: nullable(str) }),
);
/** `GET /api/social` and the answer of every social action (M10-M12). */
export const decodeSocialResponse: Decoder<SocialResponse> = root(
  'SocialResponse',
  object<SocialResponse>({
    inviteCode: str,
    friends: uniqueBy('handle', arrayOf(friendDto)),
    requests: uniqueBy('handle', arrayOf(friendRequestDto)),
    profileVisible: bool,
  }),
);
/** `GET /api/wallet` (M19, M20). */
export const decodeWalletResponse: Decoder<WalletResponse> = root(
  'WalletResponse',
  object<WalletResponse>({
    balances: uniqueBy('kind', arrayOf(balanceDto)),
    packs: uniqueBy('productId', arrayOf(packDto)),
    hintTierCost: int,
    // No range check: the bound is the server catalog's startup check, and the gift dialog clamps by the balance.
    maxPerGift: int,
  }),
);

/**
 * Every decoder by its DTO name: the sample test's index. It lives here, the one module that sees every decoder:
 * decode.ts importing this module would pull it back into the entry. Production reads none of it, so the bundler drops it.
 */
export const DTO_DECODERS: Readonly<Record<DecodedDto, Decoder<unknown>>> = {
  ApiErrorBody: decodeApiErrorBody,
  AttemptResponse: decodeAttemptResponse,
  AuthResponse: decodeAuthResponse,
  CardResponse: decodeCardResponse,
  ChapterPayload: decodeChapterPayload,
  CreateInvoiceResponse: decodeCreateInvoiceResponse,
  EntitlementsResponse: decodeEntitlementsResponse,
  FriendProfile: decodeFriendProfile,
  GiftResponse: decodeGiftResponse,
  HintUseResponse: decodeHintUseResponse,
  InviteView: decodeInviteView,
  OrderResponse: decodeOrderResponse,
  PlayerValue: decodePlayerValue,
  PostStatsResponse: decodePostStatsResponse,
  PutSaveResponse: decodePutSaveResponse,
  PuzzleStatus: decodePuzzleStatus,
  SaveFull: decodeSaveFull,
  SaveListResponse: decodeSaveListResponse,
  ShareResponse: decodeShareResponse,
  SocialResponse: decodeSocialResponse,
  StatsResponse: decodeStatsResponse,
  ValuesResponse: decodeValuesResponse,
  WalletResponse: decodeWalletResponse,
};

/** A friend's address (META-PLAN `FriendHandle`, M10): 24 lower-case hex, never a user id; LU1's brand, shape for shape. */
export type FriendHandle = string & { readonly __brand: 'FriendHandle' };

/** Why a meta call failed (META-PLAN `MetaError`): `retryAfter` in seconds, present only when the server sent it. */
export type MetaError = {
  kind: 'network' | 'auth' | 'insufficient' | 'unavailable' | 'limit' | 'rate-limited' | 'not-found';
  retryAfter?: number;
};

// Exhaustive by type, as decode.ts's ERROR_CODES: a code added to api.ts fails `check` here until it is mapped. The
// `unavailable` codes cannot reach a meta route today; to the hint port the kind means "refresh the ladder".
const META_KINDS = {
  bad_request: 'unavailable',
  initdata_invalid: 'auth',
  initdata_expired: 'auth',
  token_missing: 'auth',
  token_invalid: 'auth',
  token_expired: 'auth',
  not_entitled: 'unavailable',
  not_found: 'not-found',
  unknown_product: 'not-found',
  already_owned: 'unavailable',
  save_conflict: 'unavailable',
  payload_too_large: 'unavailable',
  telegram_unavailable: 'unavailable',
  rate_limited: 'rate-limited',
  hint_unavailable: 'unavailable',
  insufficient_balance: 'insufficient',
  limit_reached: 'limit',
  internal: 'network',
  value_changed: 'unavailable',
} as const satisfies Record<ErrorCode, MetaError['kind']>;

/** A proxy's error without the server's JSON body: only the status speaks. */
function kindOfStatus(status: number): MetaError['kind'] {
  switch (status) {
    case 401:
      return 'auth';
    case 404:
      return 'not-found';
    case 429:
      return 'rate-limited';
    default:
      return 'network';
  }
}

/** The meta services' edge: an `ApiError` as the meta screens and the hint port read it. */
export function metaError(e: ApiError): MetaError {
  switch (e.kind) {
    case 'network':
    case 'aborted':
    case 'decode':
      // No server verdict: a retry is the remedy.
      return { kind: 'network' };
    case 'session-expired':
      return { kind: 'auth' };
    case 'http': {
      // http.ts has already run the one re-auth, so a token code here is final.
      const kind = e.code === null ? kindOfStatus(e.status) : META_KINDS[e.code];
      return kind === 'rate-limited' && e.retryAfter !== null ? { kind, retryAfter: e.retryAfter } : { kind };
    }
    default: {
      const _never: never = e;
      return _never;
    }
  }
}

/**
 * The meta routes (META-PLAN "HTTP API"), apart from `Endpoints`, which the game engine takes whole. Only the meta
 * controller's lazy chunk imports this module, so these routes and their decoders stay out of the entry (RULINGS 105,
 * 137); arch.test.ts's "arch: the entry closure holds no meta module" keeps it so.
 */
export interface MetaEndpoints {
  getWallet(): Promise<Result<WalletResponse, ApiError>>;
  /** A repeat of an unlocked tier is free on the server and answers its text again. */
  useHint(id: PuzzleId, tier: number, lang: Lang): Promise<Result<HintUseResponse, ApiError>>;
  postCard(story: StoryId): Promise<Result<CardResponse, ApiError>>;
  /** Creates the user's invite code on the first call. */
  getSocial(): Promise<Result<SocialResponse, ApiError>>;
  getInvite(code: string): Promise<Result<InviteView, ApiError>>;
  askInvite(code: string): Promise<Result<InviteView, ApiError>>;
  acceptFriend(h: FriendHandle): Promise<Result<SocialResponse, ApiError>>;
  /** Removes a friend or declines a request (F20); the server keeps the block durable. */
  removeFriend(h: FriendHandle): Promise<Result<SocialResponse, ApiError>>;
  /** A 429 is `ApiError` http with `retryAfter`. */
  rotateInvite(): Promise<Result<SocialResponse, ApiError>>;
  putConsent(req: ConsentRequest): Promise<Result<SocialResponse, ApiError>>;
  /** No `?lang`: the titles come in both languages. */
  getFriendProfile(h: FriendHandle): Promise<Result<FriendProfile, ApiError>>;
  /** The body always carries `storyId` (`null` for a plain invite). A 429 is `ApiError` http with `retryAfter`. */
  postShare(req: ShareRequest): Promise<Result<ShareResponse, ApiError>>;
  /** M22: a resent `requestId` is a replay (nothing moves twice); a daily cap is 429 with `retryAfter`. */
  postGift(req: GiftRequest): Promise<Result<GiftResponse, ApiError>>;
}

export function createMetaEndpoints(http: Pick<Http, 'request'>): MetaEndpoints {
  return {
    getWallet: () => http.request({ method: 'GET', path: '/api/wallet' }, decodeWalletResponse),
    useHint: (id, tier, lang) =>
      http.request({ method: 'POST', path: `/api/puzzles/${seg(id)}/hints/${tier}?lang=${lang}` }, decodeHintUseResponse),
    postCard: (story) => http.request({ method: 'POST', path: `/api/stories/${seg(story)}/card` }, decodeCardResponse),
    getSocial: () => http.request({ method: 'GET', path: '/api/social' }, decodeSocialResponse),
    getInvite: (code) => http.request({ method: 'GET', path: `/api/invites/${seg(code)}` }, decodeInviteView),
    askInvite: (code) => http.request({ method: 'POST', path: `/api/invites/${seg(code)}/request` }, decodeInviteView),
    acceptFriend: (h) => http.request({ method: 'POST', path: `/api/friends/requests/${seg(h)}/accept` }, decodeSocialResponse),
    removeFriend: (h) => http.request({ method: 'DELETE', path: `/api/friends/${seg(h)}` }, decodeSocialResponse),
    rotateInvite: () => http.request({ method: 'POST', path: '/api/invite/rotate' }, decodeSocialResponse),
    // The bodies are built key by key: whatever else a caller's object holds never reaches the server.
    putConsent: (req) =>
      http.request(
        { method: 'PUT', path: '/api/consents/friends_profile', body: { granted: req.granted, textVersion: req.textVersion } },
        decodeSocialResponse,
      ),
    getFriendProfile: (h) => http.request({ method: 'GET', path: `/api/friends/${seg(h)}/profile` }, decodeFriendProfile),
    postShare: (req) =>
      http.request(
        { method: 'POST', path: '/api/share', body: { storyId: req.storyId, lang: req.lang, native: req.native } },
        decodeShareResponse,
      ),
    postGift: (req) =>
      http.request(
        { method: 'POST', path: '/api/gifts', body: { to: req.to, kind: req.kind, amount: req.amount, requestId: req.requestId } },
        decodeGiftResponse,
      ),
  };
}
