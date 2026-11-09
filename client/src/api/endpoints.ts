// The typed calls per route (PROTOTYPE-PLAN "HTTP API"; STORIES-PLAN Y7: saves per story, Y13: statistics; PUZZLES-PLAN
// and META-PLAN M21: puzzles): the path from branded ids, the request body and the answer's decoder. Every call goes through
// api/http.ts, so each carries the bearer, the single-flight re-auth and the request timeout.
// The meta routes are api/meta.ts's: only the meta controller's lazy chunk calls them (RULINGS 105, 137).
import type { Lang } from '../i18n/index.ts';
import type { Result, StoryId } from '../story/catalog.ts';
import type { ChapterId, OrderId, ProductId, PuzzleLocalId } from '../story/staging.ts';
import {
  decodeAttemptResponse,
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
} from './decode.ts';
import type {
  AttemptResponse,
  ChapterPayload,
  CreateInvoiceResponse,
  EntitlementsResponse,
  OrderResponse,
  PlayerValue,
  PostStatsResponse,
  PutSaveRequest,
  PutSaveResponse,
  PuzzleStatus,
  SaveFull,
  SaveListResponse,
  SaveSlot,
  StatEventDto,
  StatsResponse,
  ValuesResponse,
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
  /** The player's value of each per-player puzzle of the chapter, by local id; the first call issues them. */
  getValues(chapter: ChapterId, o?: { signal?: AbortSignal }): Promise<Result<ValuesResponse, ApiError>>;
  /** The current run after a restart of the spent run `from`; a repeat, a stale or a live run changes nothing. */
  restartPuzzle(id: PuzzleId, from: number): Promise<Result<PlayerValue, ApiError>>;
  /**
   * A 429 is `ApiError` http with `retryAfter`. `run`, a per-player puzzle's newest run the client knows, is sent only
   * when given; a 409 `value_changed` carries the current run in its body.
   */
  postAttempt(
    id: PuzzleId,
    answer: readonly number[],
    o?: { signal?: AbortSignal; run?: number },
  ): Promise<Result<AttemptResponse, ApiError>>;
  /**
   * 1 to 32 events, the body at most 16 KiB (the stats reporter bounds both); `keepalive` for the `pagehide` best
   * effort. A 429 is `ApiError` http with `retryAfter`.
   */
  postStatEvents(events: readonly StatEventDto[], o?: { keepalive?: boolean }): Promise<Result<PostStatsResponse, ApiError>>;
  getStats(): Promise<Result<StatsResponse, ApiError>>;
}

/** One path segment: ids are validated by the server, and a '/' or '?' in one can never change the route. */
export const seg = (id: string): string => encodeURIComponent(id);

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
    getValues: (chapter, o) =>
      http.request({ method: 'GET', path: `/api/chapters/${seg(chapter)}/values`, signal: o?.signal }, decodeValuesResponse),
    restartPuzzle: (id, from) => http.request({ method: 'POST', path: `/api/puzzles/${seg(id)}/restart`, body: { from } }, decodePlayerValue),
    postAttempt: (id, answer, o) =>
      http.request(
        {
          method: 'POST',
          path: `/api/puzzles/${seg(id)}/attempts`,
          body: o?.run === undefined ? { answer: [...answer] } : { answer: [...answer], run: o.run },
          signal: o?.signal,
        },
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
