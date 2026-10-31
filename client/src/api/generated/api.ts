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
 * Every story's saves, by story id then slot (`auto`, `s1`, `s2`, `s3`); an empty slot is absent.
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
