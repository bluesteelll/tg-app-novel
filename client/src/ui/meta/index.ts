// The meta overlays' chunk entry (META-PLAN M27): LMI's `app/meta.ts` imports this module dynamically, so the seven
// components and their table (i18n/meta.ts) ship in one lazy chunk. Props in, callbacks out: the data types mirror
// META-PLAN's views field for field, so LMI passes its views without an adapter. Everything that reaches outside the
// chunk is `import type` (erased: zero bytes, and no module of the entry joins the chunk's graph).
import type { Lang } from '../../i18n/index.ts';
import type { ConsentTextVersion } from '../../i18n/meta.ts';
import type { EndingName, StoryId } from '../../story/catalog.ts';
import type { ChapterId, ProductId } from '../../story/staging.ts';

/** A completion card (= META-PLAN `CardView`): own counts only; titles and names in the UI language. */
export type CardData = {
  storyId: StoryId;
  runs: number;
  chaptersCompleted: readonly ChapterId[];
  endings: ReadonlyArray<{ name: EndingName; title: string; firstReachedAt: number }>;
  achievements: ReadonlyArray<{ id: string; name: string; description: string; unlockedAt: number; isNew: boolean }>;
};

/** A friend's address (= META-PLAN `FriendHandle`): 96 random bits as hex, never a Telegram id (M10, W1). */
export type FriendHandle = string & { readonly __brand: 'FriendHandle' };

/** A friend or a requester (= `FriendView`). */
export type FriendData = { handle: FriendHandle; firstName: string };

/** The Friends screen's data (= `SocialView`); `requests` are incoming only. */
export type SocialData = {
  inviteCode: string;
  friends: readonly FriendData[];
  requests: ReadonlyArray<FriendData & { at: number }>;
  profileVisible: boolean;
};

/**
 * A friend's profile (the Rust `FriendProfile`, titles in the UI language, plus each story's public title): `visible`
 * false carries no stories (M13).
 */
export type ProfileData = {
  handle: FriendHandle;
  firstName: string;
  visible: boolean;
  stories: ReadonlyArray<{
    storyId: StoryId;
    storyTitle: string;
    endingsFound: number;
    achievementsUnlocked: number;
    sharedEndings: ReadonlyArray<{ name: EndingName; title: string }>;
    sharedAchievements: ReadonlyArray<{ id: string; name: string }>;
  }>;
};

/** The wallet (= `WalletView`): balances with debt (M20) and the packs with their server prices. */
export type WalletData = {
  balances: ReadonlyArray<{ kind: string; balance: number; debt: number }>;
  packs: ReadonlyArray<{ productId: ProductId; kind: string; amount: number; priceStars: number; title: string }>;
  hintTierCost: number;
};

/**
 * A server answer the gift dialog shows (= `MetaError`): the daily caps arrive as `limit` or as 429 `rate-limited`
 * with `retryAfter` in seconds (M22).
 */
export type ShownError = {
  kind: 'network' | 'auth' | 'insufficient' | 'unavailable' | 'limit' | 'rate-limited' | 'not-found';
  retryAfter?: number;
};

/** The completion card; `storyTitle` is the public catalog title in the UI language. */
export type CardProps = { card: CardData; storyTitle: string; lang: Lang; onshare: () => void };

/** Friends: `busy` disables Accept and Decline while one is answered; `onpolicy` opens the privacy policy (M26). */
export type FriendsProps = {
  social: SocialData;
  lang: Lang;
  busy?: boolean;
  onaccept: (h: FriendHandle) => void;
  ondecline: (h: FriendHandle) => void;
  onopen: (h: FriendHandle) => void;
  oninvite: () => void;
  onconsent: () => void;
  onpolicy: () => void;
};

/** A friend's profile; `onremove` fires on the confirming tap only. */
export type FriendProfileProps = {
  profile: ProfileData;
  lang: Lang;
  busy?: boolean;
  ongift: (h: FriendHandle) => void;
  onremove: (h: FriendHandle) => void;
};

/** The invite prompt: no name and no code, it names nobody (M10 revision 1, C1). */
export type InviteProps = { lang: Lang; busy?: boolean; onsend: () => void; onlater: () => void };

/**
 * The consent dialog: `granted` is the server's state (default off); `onchange` asks for the opposite, with the
 * version of the text shown.
 */
export type ConsentProps = {
  granted?: boolean;
  lang: Lang;
  busy?: boolean;
  onchange: (granted: boolean, textVersion: ConsentTextVersion) => void;
  onpolicy: () => void;
};

/** The wallet: `busy` disables Buy while a purchase is requested (P2); `onterms` opens the terms overlay (P1). */
export type WalletProps = {
  wallet: WalletData;
  lang: Lang;
  busy?: boolean;
  onbuy: (p: ProductId) => void;
  onterms: () => void;
};

/**
 * The gift dialog: the amount runs from 1 to `balance`, and to `maxAmount` when the per-gift maximum is known (null:
 * the server's 400 is the backstop, cut Q4). `onsend` fires once per submit; a new `error` re-enables Send, and on
 * success the controller closes the dialog. The request id is the controller's (cut Q9).
 */
export type GiftProps = {
  friend: FriendData;
  kind: string;
  balance: number;
  maxAmount: number | null;
  error: ShownError | null;
  lang: Lang;
  busy?: boolean;
  onsend: (amount: number) => void;
  oncancel: () => void;
};

export { default as CompletionCard } from './CompletionCard.svelte';
export { default as ConsentDialog } from './ConsentDialog.svelte';
export { default as FriendProfile } from './FriendProfile.svelte';
export { default as Friends } from './Friends.svelte';
export { default as GiftDialog } from './GiftDialog.svelte';
export { default as InvitePrompt } from './InvitePrompt.svelte';
export { default as Wallet } from './Wallet.svelte';
