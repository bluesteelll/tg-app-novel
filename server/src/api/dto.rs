//! Request and response bodies of `/api`: JSON in camelCase.
//!
//! No `Debug` on the auth bodies, nor on the bodies that carry a save body: they hold raw initData, session tokens
//! and up to 256 KiB of player data, which are never logged.
//!
//! Every body derives `TS`: [`ts_bindings`] turns them into the client's `client/src/api/generated/api.ts`. Every
//! `i64` is `#[ts(type = "number")]`: ids and timestamps stay below 2^53, and ts-rs would otherwise say `bigint`.
//!
//! Social bodies name another user by handle only, never by Telegram id (META-PLAN M10, W1).

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use ts_rs::TS;

use crate::db::orders::OrderStatus;
use crate::db::social::InviteState;
use crate::db::stats::{StatKind, StatOutcome};
use crate::error::{ApiErrorBody, ErrorCode};
use crate::ids::{SaveSlot, StoryId};

/// `POST /api/auth` request. Unknown fields (a client-sent `userId`, say) are ignored, never trusted.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest {
    /// The raw `Telegram.WebApp.initData` query string.
    pub init_data: String,
}

/// `POST /api/auth` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    /// The session token for `Authorization: Bearer`.
    pub token: String,
    /// When the token expires, in unix seconds.
    #[ts(type = "number")]
    pub expires_at: i64,
    /// The verified user.
    pub user: UserDto,
}

/// A user as the client sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    /// The Telegram user id.
    #[ts(type = "number")]
    pub id: i64,
    /// The first name Telegram sent.
    pub first_name: String,
    /// Telegram's language tag as sent, or `null` (serialized, not omitted).
    pub language_code: Option<String>,
}

/// A stored save without its body: an entry of `GET /api/saves`, the head of `GET /api/saves/{storyId}/{slot}`, and
/// the `current` of a 409.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SaveSummary {
    /// The story the save belongs to.
    pub story_id: StoryId,
    /// The slot.
    pub slot: SaveSlot,
    /// The revision: 1 when the slot is created, one more per accepted write.
    #[ts(type = "number")]
    pub rev: i64,
    /// The chapter the save is in.
    pub chapter_id: String,
    /// The story version the body was written against.
    pub story_version: String,
    /// The line the save resumes at, or `null`.
    pub line_id: Option<String>,
    /// When the server stored this revision, in unix seconds.
    #[ts(type = "number")]
    pub saved_at: i64,
    /// The `writeId` of the write that stored this revision.
    pub write_id: String,
}

/// `GET /api/saves` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SaveListResponse {
    /// Every story's saves without their bodies; an empty slot is absent. The order (story id, then slot) is the
    /// database collation's: the client must not rely on it.
    pub slots: Vec<SaveSummary>,
}

/// `GET /api/saves/{storyId}/{slot}` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SaveFull {
    /// The envelope.
    pub summary: SaveSummary,
    /// The save body as the client wrote it: a JSON document in a string, opaque to the server.
    pub body: String,
}

/// `PUT /api/saves/{storyId}/{slot}` request. Unknown fields are ignored.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PutSaveRequest {
    /// The `rev` this write replaces, or `null` to create the slot.
    #[ts(type = "number | null")]
    pub expected_rev: Option<i64>,
    /// The client's idempotency key of this write.
    pub write_id: String,
    /// The chapter the save is in.
    pub chapter_id: String,
    /// The story version the body was written against.
    pub story_version: String,
    /// The line the save resumes at, or `null`.
    pub line_id: Option<String>,
    /// The save body: a JSON document in a string, opaque to the server.
    pub body: String,
}

/// `PUT /api/saves/{storyId}/{slot}` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PutSaveResponse {
    /// The stored revision.
    #[ts(type = "number")]
    pub rev: i64,
    /// When the server stored it, in unix seconds.
    #[ts(type = "number")]
    pub saved_at: i64,
}

/// A chapter product as `GET /api/entitlements` lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProductDto {
    /// The product id, `chapter:<chapterId>`.
    pub product_id: String,
    /// The chapter it unlocks.
    pub chapter_id: String,
    /// The price in Telegram Stars, from the server's catalog.
    pub price_stars: u32,
    /// Whether the user owns it, from the server's entitlement rows.
    pub owned: bool,
}

/// `GET /api/entitlements` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementsResponse {
    /// Every chapter product: story order, then chain order.
    pub products: Vec<ProductDto>,
}

/// `GET /api/chapters/{chapterId}` response: a paid chapter's files as the build wrote them, composed raw (no
/// re-encoding).
// No `Debug`: it is the sold content, never logged.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPayload<'a> {
    /// The chapter id.
    pub chapter_id: &'a str,
    /// The story version the chapter was built at (`meta.json`'s `storyVersion`).
    pub story_version: &'a str,
    /// The compiled ink (`story.json`).
    #[ts(type = "unknown")]
    pub story: &'a RawValue,
    /// The chapter meta (`meta.json`).
    #[ts(type = "unknown")]
    pub meta: &'a RawValue,
    /// The chapter's asset manifest (`assets.json`).
    #[ts(type = "unknown")]
    pub assets: &'a RawValue,
    /// The English line table (`en.json`).
    #[ts(type = "unknown")]
    pub en: &'a RawValue,
    /// The chapter's public world, or `null` (serialized, not omitted) when it has none.
    #[ts(type = "unknown")]
    pub world: Option<&'a RawValue>,
}

/// `POST /api/puzzles/{puzzleId}/attempts` request. Unknown fields are ignored.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AttemptRequest {
    /// The answer: the puzzle's `answerLen` values, each at most its `answerMax` (at most 16, each at most 65535).
    pub answer: Vec<u16>,
}

/// `POST /api/puzzles/{puzzleId}/attempts` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AttemptResponse {
    /// Whether this answer is the solution.
    pub correct: bool,
    /// Whether the puzzle is solved, by this answer or an earlier one.
    pub solved: bool,
}

/// `GET /api/puzzles/{puzzleId}?lang=ru|en` response: whether the user solved the puzzle, and its hint ladder.
// No `Debug`: an unlocked hint's text is sold content, never logged.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleStatus {
    /// The puzzle id, `<chapter>.<local>`.
    pub puzzle_id: String,
    /// Whether the user solved the puzzle: a server row, never client state.
    pub solved: bool,
    /// Every tier of the puzzle's hint ladder, tier 1 first; empty for a puzzle without hints.
    pub hints: Vec<HintView>,
}

/// A hint tier as the user sees it.
// No `Debug`: `text` is sold content.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HintView {
    /// The tier, 1 to 3.
    pub tier: u8,
    /// Whether the user unlocked this tier.
    pub unlocked: bool,
    /// The hint in the requested language when `unlocked`, else `null` (serialized, not omitted).
    pub text: Option<String>,
}

/// `POST /api/invoices` request. Unknown fields (a client-sent price, amount or currency) are ignored, never trusted.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvoiceRequest {
    /// The catalog product to buy, e.g. `chapter:ch2`.
    pub product_id: String,
}

/// `POST /api/invoices` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvoiceResponse {
    /// The order the invoice pays for: `GET /api/orders/{orderId}` reports its status after `openInvoice`.
    pub order_id: String,
    /// The invoice link for `Telegram.WebApp.openInvoice`.
    pub invoice_url: String,
}

/// `GET /api/orders/{orderId}` response: the order's row, never client state.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OrderResponse {
    /// The order id.
    pub order_id: String,
    /// The product the order is for.
    pub product_id: String,
    /// The order's status.
    pub status: OrderStatus,
}

/// `POST /api/stats/events` request. An unknown field (a `storyId`, say) is a 400: the server derives the story.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PostStatsRequest {
    /// The batch: 1 to 32 events, oldest first.
    pub events: Vec<StatEventDto>,
}

/// One statistics event as the client reports it: a claim the server judges against the story index, the puzzle
/// index and the user's entitlements. An unknown field is a 400.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatEventDto {
    /// The client's id of the event, a lower-case UUID v4: a resent event is a duplicate, never a second row.
    pub event_id: String,
    /// What the event reports.
    pub kind: StatKind,
    /// The chapter the event happened in.
    pub chapter_id: String,
    /// The story version the client ran: 16 lower-case hex characters.
    pub story_version: String,
    /// `ending_reached`: the ending name; `puzzle_ended`: the puzzle id; `choice_made`: the picked option's line ID;
    /// `null` for the chapter kinds.
    pub subject: Option<String>,
    /// `puzzle_ended` only: how the puzzle ended; `null` for every other kind.
    pub outcome: Option<StatOutcome>,
    /// The event's age when the batch was sent, in ms: 0 to 30 days.
    #[ts(type = "number")]
    pub age_ms: i64,
}

/// Why an event of a stats batch was not recorded. The client drops a rejected event: it is never retried.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum StatRejectReason {
    /// The chapter is not in the story index.
    UnknownChapter,
    /// A paid chapter whose product the user does not own: judged before the subject.
    NotEntitled,
    /// Not an ending of the chapter's story reached in that chapter.
    UnknownEnding,
    /// Not a puzzle of the chapter.
    UnknownPuzzle,
    /// Not an option of the chapter.
    UnknownChoice,
    /// A repeat pick past the hour's choice budget.
    RateLimited,
}

/// An event of the batch that was not recorded, and why.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RejectedEvent {
    /// The event's id.
    pub event_id: String,
    /// Why it was not recorded.
    pub reason: StatRejectReason,
}

/// `POST /api/stats/events` response: every event of the batch is recorded, a duplicate, or rejected.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PostStatsResponse {
    /// Events recorded by this request.
    pub recorded: u32,
    /// Events already recorded: sent before, or repeated in this batch.
    pub duplicates: u32,
    /// Events not recorded, in batch order.
    pub rejected: Vec<RejectedEvent>,
}

/// `GET /api/stats` response: the user's statistics per story of the current index, and for the game. Only facts the
/// index still holds count; an ending is named only once the user reached it.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StatsResponse {
    /// Every story of the index, in index order.
    pub stories: Vec<StoryStatsDto>,
    /// The sums over the stories.
    pub game: GameStatsDto,
}

/// One story's statistics.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StoryStatsDto {
    /// The story.
    pub story_id: StoryId,
    /// Whether the user started any chapter of it.
    pub started: bool,
    /// The chapters the user completed (a chapter's end, or one of its endings), in chain order.
    pub chapters_completed: Vec<String>,
    /// The story's chapters.
    pub chapters_total: u32,
    /// The names of the story's endings the user reached, in name order.
    pub endings_reached: Vec<String>,
}

/// The game's statistics: sums over the stories of the index.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GameStatsDto {
    /// The stories the user started.
    pub stories_started: u32,
    /// The stories of the index.
    pub stories_total: u32,
    /// The endings the user reached, over all stories.
    pub endings_reached: u32,
}

/// A player-facing text in both languages, as the client receives it: the wire form of the catalog's texts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Localized {
    /// Russian, the primary language.
    pub ru: String,
    /// English.
    pub en: String,
}

/// A found ending as the completion card lists it.
// No `Debug`: the title is paid-gated content (META-PLAN M7), never logged.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CardEnding {
    /// The ending name.
    pub name: String,
    /// Its title.
    pub title: Localized,
    /// When the user first reached it, in unix seconds (server clock).
    #[ts(type = "number")]
    pub first_reached_at: i64,
}

/// An unlocked achievement as the completion card lists it.
// No `Debug`: the texts are paid-gated content (META-PLAN M7), never logged.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CardAchievement {
    /// The achievement id, unique in its story.
    pub id: String,
    /// The name.
    pub name: Localized,
    /// The description.
    pub description: Localized,
    /// When it was first unlocked, in unix seconds (server clock).
    #[ts(type = "number")]
    pub unlocked_at: i64,
    /// Whether this request unlocked it.
    pub new: bool,
}

/// `POST /api/stories/{storyId}/card` response (META-PLAN M9): the user's own completion card of one story. Only what
/// the user found and may see now: no total, and no item listed as locked, hidden or missing (M7, M8).
// No `Debug`: it carries paid-gated texts.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CardResponse {
    /// The story.
    pub story_id: StoryId,
    /// The endings reached, counting every reach.
    pub runs: u32,
    /// The chapters completed (a chapter's end, or one of its endings), in chain order.
    pub chapters_completed: Vec<String>,
    /// The endings found that the user may see now, in name order.
    pub endings: Vec<CardEnding>,
    /// The unlocked achievements the user may see now, in the story's display order.
    pub achievements: Vec<CardAchievement>,
}

/// One resource balance as `GET /api/wallet` lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BalanceDto {
    /// The resource kind, e.g. `hint`.
    pub kind: String,
    /// What the user can spend, at least 0.
    #[ts(type = "number")]
    pub balance: i64,
    /// What a refund left owing, at least 0: the next credits pay it first, and it is non-zero only with a balance
    /// of 0.
    #[ts(type = "number")]
    pub debt: i64,
}

/// A pack for sale as `GET /api/wallet` lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PackDto {
    /// The product id for `POST /api/invoices`, `pack:<packId>`.
    pub product_id: String,
    /// The resource kind it credits.
    pub kind: String,
    /// The units it credits.
    pub amount: u32,
    /// The price in Telegram Stars, from the server's catalog.
    pub price_stars: u32,
    /// The pack's title, as its invoice shows it.
    pub title: Localized,
}

/// `GET /api/wallet` response: the user's balances and what can be bought.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WalletResponse {
    /// Every resource kind of the catalog, in its order, `0` / `0` without a row.
    pub balances: Vec<BalanceDto>,
    /// Every pack for sale: by kind, then amount.
    pub packs: Vec<PackDto>,
    /// The hints one hint tier costs.
    pub hint_tier_cost: u32,
}

/// `POST /api/puzzles/{puzzleId}/hints/{tier}?lang=ru|en` response: the balance after the use, and the tier's text.
// No `Debug`: `text` is sold content, never logged.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HintUseResponse {
    /// The `hint` balance after the use (unchanged when the tier was unlocked before).
    #[ts(type = "number")]
    pub balance: i64,
    /// The tier's hint in the requested language.
    pub text: String,
}

/// `GET /api/invites/{code}` and `POST /api/invites/{code}/request` response: what the code means to the caller, and
/// nothing about its owner (META-PLAN M10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct InviteView {
    /// The caller's state toward the code's owner.
    pub state: InviteState,
}

/// A friend as `GET /api/social` lists them: by handle, never by Telegram id (W1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FriendDto {
    /// The friend's handle: 24 lower-case hex, the id of `DELETE /api/friends/{handle}`.
    pub handle: String,
    /// The friend's first name.
    pub first_name: String,
}

/// An incoming friend request as `GET /api/social` lists it: the requester by handle (W1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequestDto {
    /// The requester's handle: the id of `POST /api/friends/requests/{handle}/accept`.
    pub handle: String,
    /// The requester's first name.
    pub first_name: String,
    /// When the request was sent, in unix seconds.
    #[ts(type = "number")]
    pub at: i64,
}

/// `GET /api/social` response, also the answer of every social action: the user's own invite code, friends, incoming
/// requests and profile visibility.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SocialResponse {
    /// The user's active invite code (the link is `startapp=f<code>`).
    pub invite_code: String,
    /// The friends, oldest friendship first.
    pub friends: Vec<FriendDto>,
    /// The incoming requests, oldest first.
    pub requests: Vec<FriendRequestDto>,
    /// The user's latest profile-visibility consent is a grant (`false` until consented).
    pub profile_visible: bool,
}

/// `PUT /api/consents/friends_profile` request (M12): show my progress to my friends, or stop. Unknown fields are
/// ignored; the policy version is the server's own, never the client's.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRequest {
    /// On or off.
    pub granted: bool,
    /// The consent text the user saw, one of a closed list (`friends_profile.v1`).
    pub text_version: String,
}

/// `POST /api/share` request (META-PLAN M14): what to share, in which language, and whether the client can send a
/// prepared message (`shareMessage`, Bot API 8.0). Unknown fields are refused.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShareRequest {
    /// The story whose progress to share; `null` is a plain invite.
    pub story_id: Option<StoryId>,
    /// The language of the text: `ru` or `en`, checked by the route.
    pub lang: String,
    /// Whether the client can send a prepared message.
    pub native: bool,
}

/// `POST /api/share` response: the sharer's invite link, the share text (the story title and the sharer's counts,
/// never an ending or achievement title) and, for a native share, the prepared message's id.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareResponse {
    /// `https://t.me/<bot>?startapp=f<invite code>`.
    pub link: String,
    /// The text, in the request's language.
    pub text: String,
    /// The id for `shareMessage`; `null` without `native` or when the prepare failed (then send the link).
    pub prepared_message_id: Option<String>,
}

/// The first line of the generated file: what it is and how to rewrite it.
const BINDINGS_HEADER: &str = "// Built from server/src/api/dto.rs and error.rs by ts-rs; do not edit. Regenerate: \
                               cargo test -p server --test it bindings::write_bindings -- --ignored --exact";

/// Every HTTP body's TypeScript declaration, as the one module `client/src/api/generated/api.ts`: the header line,
/// then each type's docs and `export type ...;`, blank-line separated, LF, with a final newline. Every type a
/// declaration names is declared here too, so a type left out is a client `check` error.
pub fn ts_bindings() -> String {
    let cfg = ts_rs::Config::new();
    let decls = [
        export::<SaveSlot>(&cfg),
        export::<StoryId>(&cfg),
        export::<ErrorCode>(&cfg),
        export::<ApiErrorBody>(&cfg),
        export::<AuthRequest>(&cfg),
        export::<AuthResponse>(&cfg),
        export::<UserDto>(&cfg),
        export::<SaveSummary>(&cfg),
        export::<SaveListResponse>(&cfg),
        export::<SaveFull>(&cfg),
        export::<PutSaveRequest>(&cfg),
        export::<PutSaveResponse>(&cfg),
        export::<ProductDto>(&cfg),
        export::<EntitlementsResponse>(&cfg),
        export::<ChapterPayload<'static>>(&cfg),
        export::<AttemptRequest>(&cfg),
        export::<AttemptResponse>(&cfg),
        export::<HintView>(&cfg),
        export::<PuzzleStatus>(&cfg),
        export::<OrderStatus>(&cfg),
        export::<CreateInvoiceRequest>(&cfg),
        export::<CreateInvoiceResponse>(&cfg),
        export::<OrderResponse>(&cfg),
        export::<StatKind>(&cfg),
        export::<StatOutcome>(&cfg),
        export::<StatEventDto>(&cfg),
        export::<PostStatsRequest>(&cfg),
        export::<StatRejectReason>(&cfg),
        export::<RejectedEvent>(&cfg),
        export::<PostStatsResponse>(&cfg),
        export::<StoryStatsDto>(&cfg),
        export::<GameStatsDto>(&cfg),
        export::<StatsResponse>(&cfg),
        export::<Localized>(&cfg),
        export::<BalanceDto>(&cfg),
        export::<PackDto>(&cfg),
        export::<WalletResponse>(&cfg),
        export::<HintUseResponse>(&cfg),
        export::<InviteState>(&cfg),
        export::<InviteView>(&cfg),
        export::<FriendDto>(&cfg),
        export::<FriendRequestDto>(&cfg),
        export::<SocialResponse>(&cfg),
        export::<ConsentRequest>(&cfg),
        export::<CardEnding>(&cfg),
        export::<CardAchievement>(&cfg),
        export::<CardResponse>(&cfg),
    ];
    format!("{BINDINGS_HEADER}\n\n{}", decls.join("\n"))
}

/// One exported declaration, as ts-rs's own exporter writes it (`export.rs`: docs, `export `, `decl()`).
fn export<T: TS>(cfg: &ts_rs::Config) -> String {
    format!("{}export {}\n", T::docs().unwrap_or_default(), T::decl(cfg))
}
