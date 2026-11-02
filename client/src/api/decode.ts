// The decoders of every server response DTO (PROTOTYPE-PLAN K22): the parsed JSON comes in as `unknown`, and the
// generated type or the first problem with its JSON path comes out (`<Type><path>: <problem>`). Shapes, integers and
// unions are checked; extra fields are ignored and never copied, so a newer server's additions pass through a deploy.
// The types are generated/api.ts's (ts-rs from the Rust DTOs); decode.test.ts runs these over the Rust-written samples.
import type { Result } from '../story/catalog.ts';
import type {
  ApiErrorBody,
  AttemptResponse,
  AuthResponse,
  BalanceDto,
  CardAchievement,
  CardEnding,
  CardResponse,
  ChapterPayload,
  CreateInvoiceResponse,
  EntitlementsResponse,
  ErrorCode,
  FriendDto,
  FriendProfile,
  FriendRequestDto,
  FriendStoryDto,
  HintUseResponse,
  HintView,
  InviteState,
  InviteView,
  Localized,
  OrderResponse,
  OrderStatus,
  GameStatsDto,
  PackDto,
  PostStatsResponse,
  ProductDto,
  PutSaveResponse,
  PuzzleStatus,
  RejectedEvent,
  SaveFull,
  SaveListResponse,
  SaveSlot,
  SaveSummary,
  ShareResponse,
  SharedAchievement,
  SharedEnding,
  SocialResponse,
  StatRejectReason,
  StatsResponse,
  StoryStatsDto,
  UserDto,
  WalletResponse,
} from './generated/api.ts';

/** A boundary parser: raw JSON in; a typed value, or the first problem as `<Type><path>: <problem>`, out. */
export type Decoder<T> = (raw: unknown) => Result<T, string>;

/** The response DTOs this module decodes: the keys of `DTO_DECODERS`. */
export type DecodedDto =
  | 'ApiErrorBody'
  | 'AttemptResponse'
  | 'AuthResponse'
  | 'CardResponse'
  | 'ChapterPayload'
  | 'CreateInvoiceResponse'
  | 'EntitlementsResponse'
  | 'FriendProfile'
  | 'HintUseResponse'
  | 'InviteView'
  | 'OrderResponse'
  | 'PostStatsResponse'
  | 'PutSaveResponse'
  | 'PuzzleStatus'
  | 'SaveFull'
  | 'SaveListResponse'
  | 'ShareResponse'
  | 'SocialResponse'
  | 'StatsResponse'
  | 'WalletResponse';

// Exhaustive by type: a code, status, slot or reason added to api.ts fails `check` here until it is listed.
const ERROR_CODES = {
  bad_request: true,
  initdata_invalid: true,
  initdata_expired: true,
  token_missing: true,
  token_invalid: true,
  token_expired: true,
  not_entitled: true,
  not_found: true,
  unknown_product: true,
  already_owned: true,
  save_conflict: true,
  payload_too_large: true,
  telegram_unavailable: true,
  rate_limited: true,
  hint_unavailable: true,
  insufficient_balance: true,
  limit_reached: true,
  internal: true,
} as const satisfies Record<ErrorCode, true>;
const ORDER_STATUSES = { created: true, checkout: true, paid: true, refunded: true } as const satisfies Record<OrderStatus, true>;
const SAVE_SLOTS = { auto: true, s1: true, s2: true, s3: true } as const satisfies Record<SaveSlot, true>;
const STAT_REJECT_REASONS = {
  unknown_chapter: true,
  not_entitled: true,
  unknown_ending: true,
  unknown_puzzle: true,
  unknown_choice: true,
  rate_limited: true,
} as const satisfies Record<StatRejectReason, true>;
const INVITE_STATES = { open: true, requested: true, friends: true, own: true } as const satisfies Record<InviteState, true>;
/** HintView.tier: a ladder has 1 to 3 tiers (PZ X18). */
const TIER_MAX = 3;
/** A friend's handle: 24 lower-case hex digits (the server's `is_handle`, META M10). */
const HANDLE = /^[0-9a-f]{24}$/;

type Raw = Readonly<Record<string, unknown>>;
/** One value's reader; `path` is its JSON path, prefixed with the DTO name. */
type Field<T> = (value: unknown, path: string) => Result<T, string>;
/** One reader per key of `T`, in the order the keys are checked. */
type Shape<T> = { readonly [K in keyof T]-?: Field<T[K]> };

const ok = <T>(value: T): Result<T, string> => ({ ok: true, value });
const problem = (path: string, what: string): Result<never, string> => ({ ok: false, error: `${path}: ${what}` });

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A short description of an unexpected value: its JSON type, and a string's first characters. */
function shown(v: unknown): string {
  if (typeof v === 'string') {
    return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  }
  return v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v;
}

const str: Field<string> = (v, p) => (typeof v === 'string' ? ok(v) : problem(p, `expected a string, got ${shown(v)}`));
const bool: Field<boolean> = (v, p) => (typeof v === 'boolean' ? ok(v) : problem(p, `expected a boolean, got ${shown(v)}`));
const int: Field<number> = (v, p) =>
  typeof v === 'number' && Number.isSafeInteger(v) ? ok(v) : problem(p, `expected a safe integer, got ${shown(v)}`);
/** Present and not `null`: an opaque document whose inner decode belongs to its consumer. */
const document: Field<unknown> = (v, p) => (v !== null ? ok(v) : problem(p, 'expected a JSON document, got null'));
/** Present, any value (`null` included). */
const anyValue: Field<unknown> = (v) => ok(v);

function nullable<T>(f: Field<T>): Field<T | null> {
  return (v, p) => (v === null ? ok(null) : f(v, p));
}

function oneOf<T extends string>(set: Readonly<Record<T, true>>): Field<T> {
  return (v, p) =>
    // The own-key test proves membership, which is what the cast states.
    typeof v === 'string' && Object.hasOwn(set, v) ? ok(v as T) : problem(p, `unknown value ${shown(v)}`);
}

function arrayOf<T>(f: Field<T>): Field<T[]> {
  return (v, p) => {
    if (!Array.isArray(v)) {
      return problem(p, `expected an array, got ${shown(v)}`);
    }
    const out: T[] = [];
    for (const [i, item] of v.entries()) {
      const r = f(item, `${p}[${i}]`);
      if (!r.ok) {
        return r;
      }
      out.push(r.value);
    }
    return ok(out);
  };
}

function object<T>(shape: Shape<T>): Field<T> {
  return (v, p) => {
    if (!isRecord(v)) {
      return problem(p, `expected an object, got ${shown(v)}`);
    }
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries<Field<unknown>>(shape)) {
      if (!Object.hasOwn(v, key)) {
        return problem(`${p}.${key}`, 'missing');
      }
      const r = field(v[key], `${p}.${key}`);
      if (!r.ok) {
        return r;
      }
      out[key] = r.value;
    }
    // Every key of the shape, and so of T, was read into `out` by its own reader.
    return ok(out as T);
  };
}

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

/** Adds the DTO name as the root of every path. */
function root<T>(name: DecodedDto, f: Field<T>): Decoder<T> {
  return (raw) => f(raw, name);
}

const saveSummary = object<SaveSummary>({
  storyId: str,
  slot: oneOf(SAVE_SLOTS),
  rev: int,
  chapterId: str,
  storyVersion: str,
  lineId: nullable(str),
  savedAt: int,
  writeId: str,
});
const userDto = object<UserDto>({ id: int, firstName: str, languageCode: nullable(str) });
const productDto = object<ProductDto>({ productId: str, chapterId: str, priceStars: int, owned: bool });
const tier: Field<number> = (v, p) => {
  const r = int(v, p);
  return !r.ok || (r.value >= 1 && r.value <= TIER_MAX) ? r : problem(p, `expected a tier 1..${TIER_MAX}, got ${r.value}`);
};
const hintFields = object<HintView>({ tier, unlocked: bool, text: nullable(str) });
const rejectedEvent = object<RejectedEvent>({ eventId: str, reason: oneOf(STAT_REJECT_REASONS) });
const storyStats = object<StoryStatsDto>({
  storyId: str,
  started: bool,
  chaptersCompleted: arrayOf(str),
  chaptersTotal: int,
  endingsReached: arrayOf(str),
});
const gameStats = object<GameStatsDto>({ storiesStarted: int, storiesTotal: int, endingsReached: int });
/** META M21: `text` only when unlocked, so a locked tier that carries text is an error, never shown. */
const hintView: Field<HintView> = (v, p) => {
  const r = hintFields(v, p);
  return !r.ok || r.value.unlocked || r.value.text === null ? r : problem(`${p}.text`, 'text on a locked tier');
};
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

/** Every error response's body; `current` only on `save_conflict`, omitted (not `null`) otherwise. */
export function decodeApiErrorBody(raw: unknown): Result<ApiErrorBody, string> {
  const head = object<Pick<ApiErrorBody, 'error'>>({ error: oneOf(ERROR_CODES) })(raw, 'ApiErrorBody');
  if (!head.ok || !isRecord(raw) || !Object.hasOwn(raw, 'current')) {
    return head;
  }
  const current = saveSummary(raw['current'], 'ApiErrorBody.current');
  return current.ok ? ok({ error: head.value.error, current: current.value }) : current;
}

/** `POST /api/auth`. */
export const decodeAuthResponse: Decoder<AuthResponse> = root(
  'AuthResponse',
  object<AuthResponse>({ token: str, expiresAt: int, user: userDto }),
);
/** `GET /api/entitlements`. */
export const decodeEntitlementsResponse: Decoder<EntitlementsResponse> = root(
  'EntitlementsResponse',
  object<EntitlementsResponse>({ products: arrayOf(productDto) }),
);
/** `GET /api/saves`: every story's slots, in an order the client must not rely on. */
export const decodeSaveListResponse: Decoder<SaveListResponse> = root(
  'SaveListResponse',
  object<SaveListResponse>({ slots: arrayOf(saveSummary) }),
);
/** `GET /api/saves/{storyId}/{slot}`. */
export const decodeSaveFull: Decoder<SaveFull> = root('SaveFull', object<SaveFull>({ summary: saveSummary, body: str }));
/** `PUT /api/saves/{storyId}/{slot}`. */
export const decodePutSaveResponse: Decoder<PutSaveResponse> = root(
  'PutSaveResponse',
  object<PutSaveResponse>({ rev: int, savedAt: int }),
);
/** `POST /api/invoices`. */
export const decodeCreateInvoiceResponse: Decoder<CreateInvoiceResponse> = root(
  'CreateInvoiceResponse',
  object<CreateInvoiceResponse>({ orderId: str, invoiceUrl: str }),
);
/** `GET /api/orders/{orderId}`. */
export const decodeOrderResponse: Decoder<OrderResponse> = root(
  'OrderResponse',
  object<OrderResponse>({ orderId: str, productId: str, status: oneOf(ORDER_STATUSES) }),
);
/**
 * `GET /api/chapters/{chapterId}`: the envelope only. The four documents must be present and not `null`, `world` present
 * (`null` when the chapter has none); their inner decode is the chapter loader's (decodeChapterMeta, decodeAssetManifest,
 * decodeWorldPublic).
 */
export const decodeChapterPayload: Decoder<ChapterPayload> = root(
  'ChapterPayload',
  object<ChapterPayload>({
    chapterId: str,
    storyVersion: str,
    story: document,
    meta: document,
    assets: document,
    en: document,
    world: anyValue,
  }),
);
/** `GET /api/puzzles/{puzzleId}?lang`. */
export const decodePuzzleStatus: Decoder<PuzzleStatus> = root(
  'PuzzleStatus',
  object<PuzzleStatus>({ puzzleId: str, solved: bool, hints: arrayOf(hintView) }),
);
/** `POST /api/puzzles/{puzzleId}/attempts`. */
export const decodeAttemptResponse: Decoder<AttemptResponse> = root(
  'AttemptResponse',
  object<AttemptResponse>({ correct: bool, solved: bool }),
);

/** `POST /api/stats/events`: every event of the batch is counted as recorded or a duplicate, or listed as rejected. */
export const decodePostStatsResponse: Decoder<PostStatsResponse> = root(
  'PostStatsResponse',
  object<PostStatsResponse>({ recorded: int, duplicates: int, rejected: arrayOf(rejectedEvent) }),
);
/** `GET /api/stats`: per story of the index and for the game. META M8: no `endingsTotal` exists to read. */
export const decodeStatsResponse: Decoder<StatsResponse> = root(
  'StatsResponse',
  object<StatsResponse>({ stories: arrayOf(storyStats), game: gameStats }),
);

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

/** Every decoder by its DTO name: the sample test's index. */
export const DTO_DECODERS: Readonly<Record<DecodedDto, Decoder<unknown>>> = {
  ApiErrorBody: decodeApiErrorBody,
  AttemptResponse: decodeAttemptResponse,
  AuthResponse: decodeAuthResponse,
  CardResponse: decodeCardResponse,
  ChapterPayload: decodeChapterPayload,
  CreateInvoiceResponse: decodeCreateInvoiceResponse,
  EntitlementsResponse: decodeEntitlementsResponse,
  FriendProfile: decodeFriendProfile,
  HintUseResponse: decodeHintUseResponse,
  InviteView: decodeInviteView,
  OrderResponse: decodeOrderResponse,
  PostStatsResponse: decodePostStatsResponse,
  PutSaveResponse: decodePutSaveResponse,
  PuzzleStatus: decodePuzzleStatus,
  SaveFull: decodeSaveFull,
  SaveListResponse: decodeSaveListResponse,
  ShareResponse: decodeShareResponse,
  SocialResponse: decodeSocialResponse,
  StatsResponse: decodeStatsResponse,
  WalletResponse: decodeWalletResponse,
};
