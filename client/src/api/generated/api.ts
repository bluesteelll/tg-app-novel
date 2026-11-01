// Built from server/src/api/dto.rs and error.rs by ts-rs; do not edit. Regenerate: cargo test -p server --test it bindings::write_bindings -- --ignored --exact

/**
 * A save slot. The wire and database form is `auto`, `s1`, `s2` or `s3` (the `saves.slot` CHECK constraint).
 */
export type SaveSlot = "auto" | "s1" | "s2" | "s3";

/**
 * A story id (STORIES-PLAN Y2): `^[a-z][a-z0-9_]{0,23}$`.
 */
export type StoryId = string;

/**
 * The stable wire codes of every error, consumed by the client's decoders.
 */
export type ErrorCode = "bad_request" | "initdata_invalid" | "initdata_expired" | "token_missing" | "token_invalid" | "token_expired" | "not_entitled" | "not_found" | "unknown_product" | "already_owned" | "save_conflict" | "payload_too_large" | "telegram_unavailable" | "rate_limited" | "hint_unavailable" | "insufficient_balance" | "limit_reached" | "internal";

/**
 * The JSON body of every error response.
 */
export type ApiErrorBody = { 
/**
 * The error code.
 */
error: ErrorCode, 
/**
 * `save_conflict` only: the stored row the write conflicted with. Omitted, not `null`, when absent, so every
 * other error stays `{"error": "<code>"}`.
 */
current?: SaveSummary, };

/**
 * `POST /api/auth` request. Unknown fields (a client-sent `userId`, say) are ignored, never trusted.
 */
export type AuthRequest = { 
/**
 * The raw `Telegram.WebApp.initData` query string.
 */
initData: string, };

/**
 * `POST /api/auth` response.
 */
export type AuthResponse = { 
/**
 * The session token for `Authorization: Bearer`.
 */
token: string, 
/**
 * When the token expires, in unix seconds.
 */
expiresAt: number, 
/**
 * The verified user.
 */
user: UserDto, };

/**
 * A user as the client sees it.
 */
export type UserDto = { 
/**
 * The Telegram user id.
 */
id: number, 
/**
 * The first name Telegram sent.
 */
firstName: string, 
/**
 * Telegram's language tag as sent, or `null` (serialized, not omitted).
 */
languageCode: string | null, };

/**
 * A stored save without its body: an entry of `GET /api/saves`, the head of `GET /api/saves/{storyId}/{slot}`, and
 * the `current` of a 409.
 */
export type SaveSummary = { 
/**
 * The story the save belongs to.
 */
storyId: StoryId, 
/**
 * The slot.
 */
slot: SaveSlot, 
/**
 * The revision: 1 when the slot is created, one more per accepted write.
 */
rev: number, 
/**
 * The chapter the save is in.
 */
chapterId: string, 
/**
 * The story version the body was written against.
 */
storyVersion: string, 
/**
 * The line the save resumes at, or `null`.
 */
lineId: string | null, 
/**
 * When the server stored this revision, in unix seconds.
 */
savedAt: number, 
/**
 * The `writeId` of the write that stored this revision.
 */
writeId: string, };

/**
 * `GET /api/saves` response.
 */
export type SaveListResponse = { 
/**
 * Every story's saves without their bodies; an empty slot is absent. The order (story id, then slot) is the
 * database collation's: the client must not rely on it.
 */
slots: Array<SaveSummary>, };

/**
 * `GET /api/saves/{storyId}/{slot}` response.
 */
export type SaveFull = { 
/**
 * The envelope.
 */
summary: SaveSummary, 
/**
 * The save body as the client wrote it: a JSON document in a string, opaque to the server.
 */
body: string, };

/**
 * `PUT /api/saves/{storyId}/{slot}` request. Unknown fields are ignored.
 */
export type PutSaveRequest = { 
/**
 * The `rev` this write replaces, or `null` to create the slot.
 */
expectedRev: number | null, 
/**
 * The client's idempotency key of this write.
 */
writeId: string, 
/**
 * The chapter the save is in.
 */
chapterId: string, 
/**
 * The story version the body was written against.
 */
storyVersion: string, 
/**
 * The line the save resumes at, or `null`.
 */
lineId: string | null, 
/**
 * The save body: a JSON document in a string, opaque to the server.
 */
body: string, };

/**
 * `PUT /api/saves/{storyId}/{slot}` response.
 */
export type PutSaveResponse = { 
/**
 * The stored revision.
 */
rev: number, 
/**
 * When the server stored it, in unix seconds.
 */
savedAt: number, };

/**
 * A chapter product as `GET /api/entitlements` lists it.
 */
export type ProductDto = { 
/**
 * The product id, `chapter:<chapterId>`.
 */
productId: string, 
/**
 * The chapter it unlocks.
 */
chapterId: string, 
/**
 * The price in Telegram Stars, from the server's catalog.
 */
priceStars: number, 
/**
 * Whether the user owns it, from the server's entitlement rows.
 */
owned: boolean, };

/**
 * `GET /api/entitlements` response.
 */
export type EntitlementsResponse = { 
/**
 * Every chapter product: story order, then chain order.
 */
products: Array<ProductDto>, };

/**
 * `GET /api/chapters/{chapterId}` response: a paid chapter's files as the build wrote them, composed raw (no
 * re-encoding).
 */
export type ChapterPayload = { 
/**
 * The chapter id.
 */
chapterId: string, 
/**
 * The story version the chapter was built at (`meta.json`'s `storyVersion`).
 */
storyVersion: string, 
/**
 * The compiled ink (`story.json`).
 */
story: unknown, 
/**
 * The chapter meta (`meta.json`).
 */
meta: unknown, 
/**
 * The chapter's asset manifest (`assets.json`).
 */
assets: unknown, 
/**
 * The English line table (`en.json`).
 */
en: unknown, 
/**
 * The chapter's public world, or `null` (serialized, not omitted) when it has none.
 */
world: unknown, };

/**
 * `POST /api/puzzles/{puzzleId}/attempts` request. Unknown fields are ignored.
 */
export type AttemptRequest = { 
/**
 * The answer: the puzzle's `answerLen` values, each at most its `answerMax` (at most 16, each at most 65535).
 */
answer: Array<number>, };

/**
 * `POST /api/puzzles/{puzzleId}/attempts` response.
 */
export type AttemptResponse = { 
/**
 * Whether this answer is the solution.
 */
correct: boolean, 
/**
 * Whether the puzzle is solved, by this answer or an earlier one.
 */
solved: boolean, };

/**
 * A hint tier as the user sees it.
 */
export type HintView = { 
/**
 * The tier, 1 to 3.
 */
tier: number, 
/**
 * Whether the user unlocked this tier.
 */
unlocked: boolean, 
/**
 * The hint in the requested language when `unlocked`, else `null` (serialized, not omitted).
 */
text: string | null, };

/**
 * `GET /api/puzzles/{puzzleId}?lang=ru|en` response: whether the user solved the puzzle, and its hint ladder.
 */
export type PuzzleStatus = { 
/**
 * The puzzle id, `<chapter>.<local>`.
 */
puzzleId: string, 
/**
 * Whether the user solved the puzzle: a server row, never client state.
 */
solved: boolean, 
/**
 * Every tier of the puzzle's hint ladder, tier 1 first; empty for a puzzle without hints.
 */
hints: Array<HintView>, };

/**
 * An order's status: the `orders.status` values (`orders_status_known`), and their wire form in `OrderResponse`.
 */
export type OrderStatus = "created" | "checkout" | "paid" | "refunded";

/**
 * `POST /api/invoices` request. Unknown fields (a client-sent price, amount or currency) are ignored, never trusted.
 */
export type CreateInvoiceRequest = { 
/**
 * The catalog product to buy, e.g. `chapter:ch2`.
 */
productId: string, };

/**
 * `POST /api/invoices` response.
 */
export type CreateInvoiceResponse = { 
/**
 * The order the invoice pays for: `GET /api/orders/{orderId}` reports its status after `openInvoice`.
 */
orderId: string, 
/**
 * The invoice link for `Telegram.WebApp.openInvoice`.
 */
invoiceUrl: string, };

/**
 * `GET /api/orders/{orderId}` response: the order's row, never client state.
 */
export type OrderResponse = { 
/**
 * The order id.
 */
orderId: string, 
/**
 * The product the order is for.
 */
productId: string, 
/**
 * The order's status.
 */
status: OrderStatus, };

/**
 * What an event reports: the `stat_events.kind` values (`stat_events_kind_known`), and their wire form.
 */
export type StatKind = "chapter_started" | "chapter_completed" | "ending_reached" | "puzzle_ended" | "choice_made";

/**
 * How a puzzle ended: the `stat_events.outcome` values of a `puzzle_ended` (`stat_events_subject_by_kind`).
 */
export type StatOutcome = "solved" | "failed" | "abandoned";

/**
 * One statistics event as the client reports it: a claim the server judges against the story index, the puzzle
 * index and the user's entitlements. An unknown field is a 400.
 */
export type StatEventDto = { 
/**
 * The client's id of the event, a lower-case UUID v4: a resent event is a duplicate, never a second row.
 */
eventId: string, 
/**
 * What the event reports.
 */
kind: StatKind, 
/**
 * The chapter the event happened in.
 */
chapterId: string, 
/**
 * The story version the client ran: 16 lower-case hex characters.
 */
storyVersion: string, 
/**
 * `ending_reached`: the ending name; `puzzle_ended`: the puzzle id; `choice_made`: the picked option's line ID;
 * `null` for the chapter kinds.
 */
subject: string | null, 
/**
 * `puzzle_ended` only: how the puzzle ended; `null` for every other kind.
 */
outcome: StatOutcome | null, 
/**
 * The event's age when the batch was sent, in ms: 0 to 30 days.
 */
ageMs: number, };

/**
 * `POST /api/stats/events` request. An unknown field (a `storyId`, say) is a 400: the server derives the story.
 */
export type PostStatsRequest = { 
/**
 * The batch: 1 to 32 events, oldest first.
 */
events: Array<StatEventDto>, };

/**
 * Why an event of a stats batch was not recorded. The client drops a rejected event: it is never retried.
 */
export type StatRejectReason = "unknown_chapter" | "not_entitled" | "unknown_ending" | "unknown_puzzle" | "unknown_choice" | "rate_limited";

/**
 * An event of the batch that was not recorded, and why.
 */
export type RejectedEvent = { 
/**
 * The event's id.
 */
eventId: string, 
/**
 * Why it was not recorded.
 */
reason: StatRejectReason, };

/**
 * `POST /api/stats/events` response: every event of the batch is recorded, a duplicate, or rejected.
 */
export type PostStatsResponse = { 
/**
 * Events recorded by this request.
 */
recorded: number, 
/**
 * Events already recorded: sent before, or repeated in this batch.
 */
duplicates: number, 
/**
 * Events not recorded, in batch order.
 */
rejected: Array<RejectedEvent>, };

/**
 * One story's statistics.
 */
export type StoryStatsDto = { 
/**
 * The story.
 */
storyId: StoryId, 
/**
 * Whether the user started any chapter of it.
 */
started: boolean, 
/**
 * The chapters the user completed (a chapter's end, or one of its endings), in chain order.
 */
chaptersCompleted: Array<string>, 
/**
 * The story's chapters.
 */
chaptersTotal: number, 
/**
 * The names of the story's endings the user reached, in name order.
 */
endingsReached: Array<string>, };

/**
 * The game's statistics: sums over the stories of the index.
 */
export type GameStatsDto = { 
/**
 * The stories the user started.
 */
storiesStarted: number, 
/**
 * The stories of the index.
 */
storiesTotal: number, 
/**
 * The endings the user reached, over all stories.
 */
endingsReached: number, };

/**
 * `GET /api/stats` response: the user's statistics per story of the current index, and for the game. Only facts the
 * index still holds count; an ending is named only once the user reached it.
 */
export type StatsResponse = { 
/**
 * Every story of the index, in index order.
 */
stories: Array<StoryStatsDto>, 
/**
 * The sums over the stories.
 */
game: GameStatsDto, };

/**
 * A player-facing text in both languages, as the client receives it: the wire form of the catalog's texts.
 */
export type Localized = { 
/**
 * Russian, the primary language.
 */
ru: string, 
/**
 * English.
 */
en: string, };

/**
 * One resource balance as `GET /api/wallet` lists it.
 */
export type BalanceDto = { 
/**
 * The resource kind, e.g. `hint`.
 */
kind: string, 
/**
 * What the user can spend, at least 0.
 */
balance: number, 
/**
 * What a refund left owing, at least 0: the next credits pay it first, and it is non-zero only with a balance
 * of 0.
 */
debt: number, };

/**
 * A pack for sale as `GET /api/wallet` lists it.
 */
export type PackDto = { 
/**
 * The product id for `POST /api/invoices`, `pack:<packId>`.
 */
productId: string, 
/**
 * The resource kind it credits.
 */
kind: string, 
/**
 * The units it credits.
 */
amount: number, 
/**
 * The price in Telegram Stars, from the server's catalog.
 */
priceStars: number, 
/**
 * The pack's title, as its invoice shows it.
 */
title: Localized, };

/**
 * `GET /api/wallet` response: the user's balances and what can be bought.
 */
export type WalletResponse = { 
/**
 * Every resource kind of the catalog, in its order, `0` / `0` without a row.
 */
balances: Array<BalanceDto>, 
/**
 * Every pack for sale: by kind, then amount.
 */
packs: Array<PackDto>, 
/**
 * The hints one hint tier costs.
 */
hintTierCost: number, };

/**
 * `POST /api/puzzles/{puzzleId}/hints/{tier}?lang=ru|en` response: the balance after the use, and the tier's text.
 */
export type HintUseResponse = { 
/**
 * The `hint` balance after the use (unchanged when the tier was unlocked before).
 */
balance: number, 
/**
 * The tier's hint in the requested language.
 */
text: string, };
