// The typed calls per route (PROTOTYPE-PLAN "HTTP API"; STORIES-PLAN Y7: saves per story, Y13: statistics; PUZZLES-PLAN
// and META-PLAN M21: puzzles): the path from branded ids, the request body and the answer's decoder. Every call goes through
// api/http.ts, so each carries the bearer, the single-flight re-auth and the request timeout.
import type { Lang } from '../i18n/index.ts';
import type { Result, StoryId } from '../story/catalog.ts';
import type { ChapterId, OrderId, ProductId, PuzzleLocalId } from '../story/staging.ts';
import {
  decodeAttemptResponse,
  decodeCardResponse,
  decodeChapterPayload,
  decodeCreateInvoiceResponse,
  decodeEntitlementsResponse,
  decodeFriendProfile,
  decodeHintUseResponse,
  decodeInviteView,
  decodeOrderResponse,
  decodePostStatsResponse,
  decodePutSaveResponse,
  decodePuzzleStatus,
  decodeSaveFull,
  decodeSaveListResponse,
  decodeShareResponse,
  decodeSocialResponse,
  decodeStatsResponse,
  decodeWalletResponse,
} from './decode.ts';
import type {
  AttemptResponse,
  CardResponse,
  ChapterPayload,
  ConsentRequest,
  CreateInvoiceResponse,
  EntitlementsResponse,
  ErrorCode,
  FriendProfile,
  HintUseResponse,
  InviteView,
  OrderResponse,
  PostStatsResponse,
  PutSaveRequest,
  PutSaveResponse,
  PuzzleStatus,
  SaveFull,
  SaveListResponse,
  SaveSlot,
  ShareRequest,
  ShareResponse,
  SocialResponse,
  StatEventDto,
  StatsResponse,
  WalletResponse,
} from './generated/api.ts';
import type { ApiError, Http } from './http.ts';

/** `<chapter>.<local>` (PUZZLES-PLAN "PuzzleId"): the server's puzzle id. A local brand: staging.ts names none. */
export type PuzzleId = string & { readonly __brand: 'PuzzleId' };

export function puzzleId(chapter: ChapterId, local: PuzzleLocalId): PuzzleId {
  // The one constructor of the brand: the grammar is the join itself.
  return `${chapter}.${local}` as PuzzleId;
}

export interface Endpoints {
  getEntitlements(): Promise<Result<EntitlementsResponse, ApiError>>;
  /** Every story's saves; the order means nothing (summaries are looked up by story and slot). */
  listSaves(): Promise<Result<SaveListResponse, ApiError>>;
  getSave(story: StoryId, slot: SaveSlot): Promise<Result<SaveFull, ApiError>>;
  /** `keepalive` for the `pagehide` best effort; the caller keeps the body under the shared keepalive quota. */
  putSave(story: StoryId, slot: SaveSlot, req: PutSaveRequest, o?: { keepalive?: boolean }): Promise<Result<PutSaveResponse, ApiError>>;
  createInvoice(product: ProductId): Promise<Result<CreateInvoiceResponse, ApiError>>;
  getOrder(order: OrderId): Promise<Result<OrderResponse, ApiError>>;
  getChapter(chapter: ChapterId, o?: { signal?: AbortSignal }): Promise<Result<ChapterPayload, ApiError>>;
  getPuzzle(id: PuzzleId, lang: Lang, o?: { signal?: AbortSignal }): Promise<Result<PuzzleStatus, ApiError>>;
  /** A 429 is `ApiError` http with `retryAfter`. */
  postAttempt(id: PuzzleId, answer: readonly number[], o?: { signal?: AbortSignal }): Promise<Result<AttemptResponse, ApiError>>;
  /**
   * 1 to 32 events, the body at most 16 KiB (the stats reporter bounds both); `keepalive` for the `pagehide` best
   * effort. A 429 is `ApiError` http with `retryAfter`.
   */
  postStatEvents(events: readonly StatEventDto[], o?: { keepalive?: boolean }): Promise<Result<PostStatsResponse, ApiError>>;
  getStats(): Promise<Result<StatsResponse, ApiError>>;
}

/** One path segment: ids are validated by the server, and a '/' or '?' in one can never change the route. */
const seg = (id: string): string => encodeURIComponent(id);

export function createEndpoints(http: Pick<Http, 'request'>): Endpoints {
  return {
    getEntitlements: () => http.request({ method: 'GET', path: '/api/entitlements' }, decodeEntitlementsResponse),
    listSaves: () => http.request({ method: 'GET', path: '/api/saves' }, decodeSaveListResponse),
    getSave: (story, slot) => http.request({ method: 'GET', path: `/api/saves/${seg(story)}/${seg(slot)}` }, decodeSaveFull),
    putSave: (story, slot, req, o) =>
      http.request(
        { method: 'PUT', path: `/api/saves/${seg(story)}/${seg(slot)}`, body: req, keepalive: o?.keepalive === true },
        decodePutSaveResponse,
      ),
    createInvoice: (product) => http.request({ method: 'POST', path: '/api/invoices', body: { productId: product } }, decodeCreateInvoiceResponse),
    getOrder: (order) => http.request({ method: 'GET', path: `/api/orders/${seg(order)}` }, decodeOrderResponse),
    getChapter: (chapter, o) =>
      http.request({ method: 'GET', path: `/api/chapters/${seg(chapter)}`, signal: o?.signal }, decodeChapterPayload),
    getPuzzle: (id, lang, o) =>
      http.request({ method: 'GET', path: `/api/puzzles/${seg(id)}?lang=${lang}`, signal: o?.signal }, decodePuzzleStatus),
    postAttempt: (id, answer, o) =>
      http.request(
        { method: 'POST', path: `/api/puzzles/${seg(id)}/attempts`, body: { answer: [...answer] }, signal: o?.signal },
        decodeAttemptResponse,
      ),
    postStatEvents: (events, o) =>
      // The body is the whole PostStatsRequest: the reporter's byte bound is measured on exactly this object.
      http.request(
        { method: 'POST', path: '/api/stats/events', body: { events: [...events] }, keepalive: o?.keepalive === true },
        decodePostStatsResponse,
      ),
    getStats: () => http.request({ method: 'GET', path: '/api/stats' }, decodeStatsResponse),
  };
}

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
 * The meta routes (META-PLAN "HTTP API"), apart from `Endpoints`: the game engine takes that whole object, so these
 * routes and their decoders reach the entry only through the meta controller's import (M27).
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
  };
}
