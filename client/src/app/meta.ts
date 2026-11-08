// The meta controller (META-PLAN "Module API", M9-M14, M19-M24, M27; F16-F23, F28): one per page, created by boot's
// gate (app/boot.ts says when), with boot's own stats read (LFL B1). It owns the LMD services, what the meta overlays
// render (`vm.meta`), the wallet's one pack purchase flow and the overlays' lazy chunk (prefetched after the first
// line). An overlay renders a service's state, never a call's own answer (the services order the answers; principle
// 1), and nothing here unlocks anything: the card, the wallet and the friends are the server's. An epoch, bumped by
// `closeOverlays`, a root change and `dispose`, drops an answer that would push an overlay over a later screen.
import type { Endpoints } from '../api/endpoints.ts';
import type { Clock } from '../api/http.ts';
import { metaError } from '../api/meta.ts';
import type { FriendHandle, MetaEndpoints, MetaError } from '../api/meta.ts';
import { t } from '../i18n/index.ts';
import type { UiKey } from '../i18n/index.ts';
import type { ConsentTextVersion } from '../i18n/meta.ts';
import { createCardService } from '../meta/card.ts';
import { createSocialService } from '../meta/social.ts';
import type { SocialView } from '../meta/social.ts';
import { createWalletService } from '../meta/wallet.ts';
import type { ResourceKind } from '../meta/wallet.ts';
import type { PurchaseFlow, PurchaseState } from '../purchase/flow.ts';
import type { HintPort } from '../puzzles/session.ts';
import type { StatsReporter } from '../stats/reporter.ts';
import type { Result, StoryId } from '../story/catalog.ts';
import type { ProductId } from '../story/staging.ts';
import type { Lifecycle, TelegramClient } from '../telegram/index.ts';
import type { CardData, FriendData, ProfileData, ShownError, SocialData, WalletData } from '../ui/meta/index.ts';
import type { Screen, ScreenKind, Screens, ScreensView } from '../ui/screens.ts';
import type { ViewModel } from '../ui/state.svelte.ts';

// Boot builds `MetaDeps.meta` from this chunk's module, so the meta routes and their decoders never enter the entry
// (RULINGS 137).
export { createMetaEndpoints } from '../api/meta.ts';

/** The meta overlays' chunk (M27): imported only here, and only dynamically. */
export type MetaUi = typeof import('../ui/meta/index.ts');
type PurchaseModule = Pick<typeof import('../purchase/flow.ts'), 'createPurchaseFlow' | 'packDelivered'>;

/** What App.svelte renders the meta overlays from; the data are the services' views as they are. */
export type MetaView = {
  ui: MetaUi | null;
  card: { story: StoryId; data: CardData; storyTitle: string } | null;
  social: SocialData | null;
  profile: ProfileData | null;
  wallet: WalletData | null;
  purchase: PurchaseState;
  invite: { code: string } | null;
  /** The gift dialog: the kind's balance and the per-gift maximum follow the wallet's state; `busy` while one is sent. */
  gift: {
    friend: FriendData;
    kind: ResourceKind;
    balance: number;
    maxAmount: number | null;
    error: ShownError | null;
    busy: boolean;
  } | null;
  /** An answer is awaited: Accept / Decline / Remove, the consent switch, the invite's Send, Buy (requesting, confirming). */
  busy: { social: boolean; consent: boolean; invite: boolean; wallet: boolean };
};

export interface MetaController {
  /** The boot reads at once (social, wallet, boot's stats read, and the launch link's invite); never awaited (F17, F19). */
  boot(): void;
  /** An ending of `story` in the stats, or reached in this session (F17). */
  hasCard(story: StoryId): boolean;
  /** `POST /api/stories/{story}/card`, then the `card` overlay; a failure shows `meta.card_later`. */
  openCard(story: StoryId): Promise<Result<void, MetaError>>;
  /** F16: the stats settle (3 s), then the card, or the toast; never rejects. */
  onEnding(story: StoryId): Promise<void>;
  /**
   * This session reached an ending of `story` and left it before the card could be asked for (LMI critique O3):
   * Home's card button shows (F17); no card POST.
   */
  endingReached(story: StoryId): void;
  openFriends(): void;
  openProfile(h: FriendHandle): void;
  openConsent(): void;
  openWallet(): void;
  /** A friend's Gift (F25): the dialog for the wallet's hint kind, once the wallet has answered. */
  openGift(h: FriendHandle): void;
  /**
   * The dialog's Send (F25): one gift at a time. The request id is kept per (to, kind, amount) until a definitive
   * answer, so a retry after a lost answer moves nothing twice; success closes the dialog, and the wallet is read again.
   */
  gift(to: FriendHandle, kind: ResourceKind, amount: number): Promise<Result<void, MetaError>>;
  /** The dialog's Cancel; a kept request id stays for the retry. */
  cancelGift(): void;
  accept(h: FriendHandle): void;
  /** Declines a request or removes a friend (F20). */
  remove(h: FriendHandle): void;
  setVisible(on: boolean, textVersion: ConsentTextVersion): void;
  /** The invite prompt's Send (F19 step 4). */
  sendInvite(): void;
  /** The invite prompt's Not now. */
  dismissInvite(): void;
  /** Friends' new invite link (M10): one at a time, since each rotation revokes the link before it. */
  rotate(): void;
  /** M14 / F18: a prepared message, or the share link; one share at a time. */
  share(story: StoryId | null): Promise<void>;
  /** The wallet's Buy (F23): the controller's one pack flow. */
  buyPack(p: ProductId): void;
  /** F28: the privacy policy through `openLink`, inside the tap. */
  openPolicy(): void;
  /** The wallet's terms link (PP P1); the Terms overlay is the engine's, so it opens once the engine is in. */
  openTerms(): void;
  /** The puzzle session's hint port (M21): the wallet's, its `getMore` opening the wallet. */
  hintPort(): HintPort;
  /** A line was revealed: the overlays' chunk is fetched once, ahead of the first card. */
  lineShown(): void;
  /** Home is the root again: a held invite prompt shows. */
  homeShown(): void;
  screensChanged(v: ScreensView): void;
  /** The session leaves (exit to the stories): no answer of before pushes an overlay. */
  closeOverlays(): void;
  onLifecycle(e: Lifecycle): void;
  dispose(): void;
}

export type MetaDeps = {
  meta: MetaEndpoints;
  api: Pick<Endpoints, 'createInvoice' | 'getOrder'>;
  /** Boot's stats read after auth (LFL B1): the answer Home's card buttons came from, so one stats GET per page. */
  stats: () => ReturnType<Endpoints['getStats']>;
  tg: Pick<TelegramClient, 'supportsShareMessage' | 'shareMessage' | 'openTelegramLink' | 'openLink' | 'startParam' | 'openInvoice'>;
  screens: Pick<Screens, 'push' | 'close' | 'view'>;
  vm: ViewModel;
  reporter: Pick<StatsReporter, 'settle'>;
  /** A story's public title in `lang`; null for a story the catalog lacks. */
  storyTitle: (story: StoryId, lang: ViewModel['lang']) => string | null;
  clock: Clock;
  /** A lower-case UUID v4 (`crypto.randomUUID()`). */
  newId: () => string;
  /** `location.host`; the policy URL is built from it inside the chunk (`policyUrl`), so boot imports no value from here. */
  host: string;
  /** Home's card buttons follow `hasCard` again (the stats arrived). */
  onCards: () => void;
  loadUi?: () => Promise<MetaUi>;
  loadPurchase?: () => Promise<PurchaseModule>;
};

/**
 * The privacy policy's address on this host (F28). https always: Telegram serves a production Mini App over https only
 * and the facade's `openLink` refuses any other scheme, so an http host (the dev origin, the test environment) gets a
 * link no listener answers there.
 */
export function policyUrl(host: string): string {
  return `https://${host}/api/privacy`;
}

/** F16: how long the ending's events may take to reach the server before the card is asked for. */
export const CARD_SETTLE_MS = 3000;
const SHARE_PROMPT = 'meta.share_prompt';
/** The one gift kind of the catalog today (carry: a second kind is shown with `meta.kind_hint`). */
const GIFT_KIND = 'hint';
const OK: Result<void, never> = { ok: true, value: undefined };

export function createMetaController(d: MetaDeps): MetaController {
  const { vm, screens, tg } = d;
  const card = createCardService(d.meta);
  const social = createSocialService(d.meta, { storyTitle: d.storyTitle });
  const wallet = createWalletService(d.meta, { lang: () => vm.lang });
  const loadUi = d.loadUi ?? (() => import('../ui/meta/index.ts'));
  const loadPurchase = d.loadPurchase ?? (() => import('../purchase/flow.ts'));
  const idle: MetaView = {
    ui: null,
    card: null,
    social: null,
    profile: null,
    wallet: null,
    purchase: { kind: 'idle' },
    invite: null,
    gift: null,
    busy: { social: false, consent: false, invite: false, wallet: false },
  };
  let alive = true;
  let epoch = 0;
  let root = screens.view().root.kind;
  let open: ReadonlySet<ScreenKind> = new Set();
  /** The stories with a card: an ending in the stats or reached here (F17). */
  const ended = new Set<string>();
  let ui: Promise<MetaUi | null> | null = null;
  let prefetched = false;
  let cardFlight: { epoch: number; run: Promise<Result<void, MetaError>> } | null = null;
  /** An open invite's code: held until Home shows it, then asked for until answered or dismissed. */
  let held: string | null = null;
  let asking: string | null = null;
  let sharing = false;
  let flow: PurchaseFlow | null = null;
  let flowLoad: Promise<PurchaseFlow | null> | null = null;
  /** The pack flow's last state kind: the 429 wait is noted once, on entering it (D-429). */
  let purchaseKind: PurchaseState['kind'] = 'idle';
  /** A gift's request id per (to, kind, amount), until a definitive answer (META-PLAN's resource lifetime). */
  const giftIds = new Map<string, string>();
  let giftFlight: Promise<Result<void, MetaError>> | null = null;

  vm.meta = idle;
  const set = (p: Partial<MetaView>): void => {
    if (alive) {
      vm.meta = { ...(vm.meta ?? idle), ...p };
    }
  };
  const flag = (k: keyof MetaView['busy'], on: boolean): void => set({ busy: { ...(vm.meta ?? idle).busy, [k]: on } });
  const busy = (k: keyof MetaView['busy']): boolean => (vm.meta ?? idle).busy[k];
  const publish = (): void => {
    const w = wallet.state();
    const g = (vm.meta ?? idle).gift;
    const balance = g === null ? undefined : w?.balances.find((b) => b.kind === g.kind)?.balance;
    set({
      social: social.state(),
      wallet: w,
      gift: g === null ? null : { ...g, balance: balance ?? g.balance, maxAmount: w?.maxPerGift ?? g.maxAmount },
    });
  };
  const current = (e: number): boolean => alive && e === epoch;
  const note = (key: UiKey, params?: Readonly<Record<string, number>>): void => {
    if (alive) {
      vm.showToast({ kind: 'note', key, message: t(vm.lang, key, params), sticky: false });
    }
  };
  /** http.ts has re-authorized once already, and an expired session shows the reopen notice: no toast for `auth`. */
  const failed = (e: MetaError): void => {
    if (e.kind !== 'auth') {
      note('meta.action_failed');
    }
  };

  /**
   * One refresh of a service in flight, and none while one of its mutations is (the mutation's answer is the state).
   * `soft` is an open's read; `hard` must start after now (a payment landed), so it waits for the call in flight.
   */
  function syncOf(refresh: () => Promise<unknown>) {
    let mutations = 0;
    let inflight: Promise<void> | null = null;
    let again = false;
    const run = (): Promise<void> => {
      again = false;
      const p = refresh().then(() => {
        inflight = null;
        publish();
        if (again) {
          void start(true);
        }
      });
      inflight = p;
      return p;
    };
    const start = (after: boolean): Promise<void> => {
      if (!alive) {
        return Promise.resolve();
      }
      if (inflight !== null || mutations > 0) {
        again ||= after;
        return inflight ?? Promise.resolve();
      }
      return run();
    };
    return {
      soft: () => start(false),
      hard: () => start(true),
      async mutate<T>(m: () => Promise<T>): Promise<T> {
        mutations += 1;
        try {
          return await m();
        } finally {
          mutations -= 1;
          publish();
          if (mutations === 0 && again && inflight === null) {
            void start(true);
          }
        }
      },
    };
  }
  const socialSync = syncOf(() => social.refresh());
  const walletSync = syncOf(() => wallet.refresh());

  /** The overlays' chunk, one load in flight; a failed load is tried again by the next open. */
  const ensureUi = (): Promise<MetaUi | null> => {
    ui ??= loadUi().then(
      (m) => {
        set({ ui: m });
        return m;
      },
      (e: unknown) => {
        console.error('meta: the overlays chunk did not load', e);
        ui = null;
        return null;
      },
    );
    return ui;
  };

  /** Pushes `s` once the chunk is in and, on a first open, the service has answered; a later screen drops it. */
  const show = async (s: Screen, ready: () => boolean, read: Promise<void>): Promise<void> => {
    const e = epoch;
    const m = await ensureUi();
    if (!ready()) {
      await read;
    }
    if (!current(e)) {
      return;
    }
    if (m === null || !ready()) {
      note('meta.action_failed');
      return;
    }
    screens.push(s);
  };

  /** A gift's answer reaches the open dialog; its error only when the dialog is still for that friend. */
  const giftLanded = (to: FriendHandle, error: ShownError | null): void => {
    const g = (vm.meta ?? idle).gift;
    if (g !== null) {
      set({ gift: { ...g, busy: false, error: g.friend.handle === to && error !== null ? error : g.error } });
    }
  };

  /** F19 step 3: the prompt over Home only; a held one waits for Home. */
  const offerInvite = (): void => {
    const code = held;
    if (code === null || screens.view().root.kind !== 'home') {
      return;
    }
    held = null;
    asking = code;
    set({ invite: { code } });
    void show({ kind: 'invite', code }, () => true, Promise.resolve());
  };

  /** Accept / Decline / Remove: one at a time (F20's double tap); a 404 means the list moved, so it is read again. */
  const friendCall = (call: () => Promise<Result<SocialView, MetaError>>, removed: FriendHandle | null): void => {
    if (busy('social')) {
      return;
    }
    flag('social', true);
    void socialSync.mutate(call).then((r) => {
      flag('social', false);
      if (r.ok) {
        if (removed !== null && vm.meta?.profile?.handle === removed) {
          screens.close('friend');
        }
      } else if (r.error.kind === 'not-found') {
        void socialSync.hard();
      } else if (r.error.kind === 'limit') {
        note('meta.friend_limit');
      } else {
        failed(r.error);
      }
    });
  };

  const shareLink = (link: string, text: string): void => {
    const r = tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    if (!r.ok) {
      note('meta.action_failed');
    }
  };

  /** A 429 with its Retry-After shows the wait in whole minutes, at least one; true when it did. */
  const waitNoted = (e: MetaError): boolean => {
    if (e.kind !== 'rate-limited' || e.retryAfter === undefined) {
      return false;
    }
    note('meta.share_wait', { minutes: Math.max(1, Math.ceil(e.retryAfter / 60)) });
    return true;
  };

  const shareFailed = (e: MetaError): void => {
    if (waitNoted(e)) {
      return;
    }
    if (e.kind === 'unavailable') {
      note('meta.telegram_unavailable'); // 502: the bot's username is unknown, so no link can be made
    } else {
      failed(e);
    }
  };

  /** M14 steps 1-3; `again` is the one re-prepare of an expired message. */
  const shareOnce = async (story: StoryId | null, again: boolean): Promise<void> => {
    const native = tg.supportsShareMessage();
    const r = await social.prepareShare(story, vm.lang, native);
    if (!alive) {
      return;
    }
    if (!r.ok) {
      shareFailed(r.error);
      return;
    }
    const { link, text, preparedMessageId } = r.value;
    if (!native || preparedMessageId === null) {
      shareLink(link, text);
      return;
    }
    const sent = await tg.shareMessage(preparedMessageId);
    if (!alive || sent.ok) {
      return;
    }
    switch (sent.error.kind) {
      case 'expired':
        if (again) {
          await shareOnce(story, false);
        } else {
          shareLink(link, text);
        }
        return;
      case 'unsupported':
        shareLink(link, text);
        return;
      case 'declined':
        return;
      case 'send-failed':
      case 'unknown':
        // The link is opened by the prompt's own tap, never after this await.
        vm.showToast({
          kind: 'prompt',
          key: SHARE_PROMPT,
          message: t(vm.lang, 'meta.share_failed'),
          actions: [
            {
              label: t(vm.lang, 'meta.share_as_link'),
              run: () => {
                vm.dismissToast(SHARE_PROMPT);
                shareLink(link, text);
              },
            },
          ],
        });
        return;
      default: {
        const _never: never = sent.error.kind;
        return _never;
      }
    }
  };

  const purchased = (s: PurchaseState): void => {
    const was = purchaseKind;
    purchaseKind = s.kind;
    const busy = s.kind === 'requesting' || s.kind === 'confirming' || s.kind === 'limited';
    set({ purchase: s, busy: { ...(vm.meta ?? idle).busy, wallet: busy } });
    if (s.kind === 'unlocked') {
      void walletSync.hard(); // M19: the order turned paid with the credit; the wallet shows the server's balance
    } else if (s.kind === 'failed' && s.reason !== 'cancelled') {
      note('toast.purchase_failed');
    } else if (s.kind === 'limited' && was !== 'limited') {
      // LPH Q5 (D-429): the server's bound, once on entering the wait; its minute ticks show nothing more.
      note('meta.share_wait', { minutes: Math.max(1, Math.ceil(s.retryAfterSecs / 60)) });
    }
  };

  /** The controller's one pack flow (carry: the double-tap guard is per flow), its module loaded at the first Buy. */
  const purchaseFlow = (): Promise<PurchaseFlow | null> => {
    flowLoad ??= loadPurchase().then(
      (m) => {
        if (!alive) {
          return null;
        }
        flow = m.createPurchaseFlow({ api: d.api, tg, clock: d.clock, isDelivered: m.packDelivered, onState: purchased });
        return flow;
      },
      (e: unknown) => {
        console.error('meta: the purchase module did not load', e);
        flowLoad = null;
        note('toast.purchase_failed');
        return null;
      },
    );
    return flowLoad;
  };

  /** A flow stuck in `delayed` or in a `sheet` whose close never came is polled again (P7's Check again; critique W2). */
  const stuck = (f: PurchaseFlow | null): boolean => {
    const k = f?.state().kind;
    return k === 'delayed' || k === 'sheet';
  };

  const meta: MetaController = {
    boot() {
      void socialSync.soft();
      void walletSync.soft();
      void d.stats().then((r) => {
        if (!alive || !r.ok) {
          return; // F17: no card button until an ending of this session
        }
        for (const s of r.value.stories) {
          if (s.endingsReached.length > 0) {
            ended.add(s.storyId);
          }
        }
        d.onCards();
      });
      const p = tg.startParam();
      if (p?.startsWith('f') === true) {
        const code = p.slice(1);
        void social.invite(code).then((r) => {
          // Any other state, or a 404: no prompt (F19 step 3).
          if (alive && r.ok && r.value.state === 'open') {
            held = code;
            offerInvite();
          }
        });
      }
    },
    hasCard: (story) => ended.has(story),
    openCard(story) {
      const f = cardFlight;
      if (f !== null && f.epoch === epoch) {
        return f.run;
      }
      const e = epoch;
      const run = (async (): Promise<Result<void, MetaError>> => {
        const [m, r] = await Promise.all([ensureUi(), card.load(story, vm.lang)]);
        if (!current(e)) {
          return r.ok ? OK : r;
        }
        if (!r.ok || m === null) {
          if (r.ok || r.error.kind !== 'auth') {
            note('meta.card_later');
          }
          return r.ok ? { ok: false, error: { kind: 'network' } } : r;
        }
        set({ card: { story, data: r.value, storyTitle: d.storyTitle(story, vm.lang) ?? story } });
        screens.push({ kind: 'card', story });
        return OK;
      })();
      const flight = { epoch: e, run };
      cardFlight = flight;
      void run.then(() => {
        if (cardFlight === flight) {
          cardFlight = null;
        }
      });
      return run;
    },
    endingReached(story) {
      ended.add(story);
      d.onCards();
    },
    async onEnding(story) {
      ended.add(story);
      const e = epoch;
      const settled = await d.reporter.settle({ timeoutMs: CARD_SETTLE_MS });
      if (!current(e)) {
        return; // the end was left during the settle: no card POST (it would use up the new marks unseen)
      }
      if (settled === 'timeout') {
        note('meta.card_later');
        return;
      }
      await meta.openCard(story);
    },
    openFriends() {
      void show({ kind: 'friends' }, () => social.state() !== null, socialSync.soft());
    },
    openProfile(h) {
      const e = epoch;
      void Promise.all([ensureUi(), social.profile(h, vm.lang)]).then(([m, r]) => {
        if (!current(e)) {
          return;
        }
        if (!r.ok) {
          if (r.error.kind === 'not-found') {
            void socialSync.hard(); // unfriended meanwhile (F22)
          } else {
            failed(r.error);
          }
        } else if (m === null) {
          note('meta.action_failed');
        } else {
          set({ profile: r.value });
          screens.push({ kind: 'friend', handle: h });
        }
      });
    },
    openConsent() {
      void show({ kind: 'consent' }, () => social.state() !== null, socialSync.soft());
    },
    openWallet() {
      if (stuck(flow)) {
        flow?.checkAgain();
      }
      void show({ kind: 'wallet' }, () => wallet.state() !== null, walletSync.soft());
    },
    openGift(h) {
      const friend = social.state()?.friends.find((f) => f.handle === h);
      if (friend === undefined) {
        void socialSync.hard(); // unfriended meanwhile (F22)
        return;
      }
      const e = epoch;
      const read = walletSync.soft();
      void Promise.all([ensureUi(), wallet.state() === null ? read : Promise.resolve()]).then(([m]) => {
        if (!current(e)) {
          return;
        }
        const w = wallet.state();
        const entry = w?.balances.find((b) => b.kind === GIFT_KIND);
        if (m === null || w === null || entry === undefined) {
          note('meta.action_failed');
          return;
        }
        const gift = { friend, kind: entry.kind, balance: entry.balance, maxAmount: w.maxPerGift, error: null, busy: giftFlight !== null };
        set({ gift });
        screens.push({ kind: 'gift', to: h });
      });
    },
    gift(to, kind, amount) {
      if (giftFlight !== null) {
        return giftFlight;
      }
      const key = JSON.stringify([to, kind, amount]);
      const requestId = giftIds.get(key) ?? d.newId();
      giftIds.set(key, requestId);
      const g = (vm.meta ?? idle).gift;
      if (g !== null) {
        set({ gift: { ...g, busy: true } });
      }
      const run = walletSync
        .mutate(() => d.meta.postGift({ to, kind, amount, requestId }))
        .then((r): Result<void, MetaError> => {
          giftFlight = null;
          const error = r.ok ? null : metaError(r.error);
          if (error?.kind !== 'network') {
            giftIds.delete(key); // a definitive answer: the next Send is a new gift
          }
          if (!alive) {
            return error === null ? OK : { ok: false, error };
          }
          if (error === null) {
            giftLanded(to, null);
            // Only the dialog opened for this friend closes (LMI review r1 M1): another friend's stays open.
            if (screens.view().overlays.some((s) => s.kind === 'gift' && s.to === to)) {
              screens.close('gift');
            }
            void walletSync.hard(); // the debit; the balance shown is the wallet's, never this answer's
            return OK;
          }
          giftLanded(to, { ...error }); // a new object per answer: the dialog's Send opens again
          if (error.kind === 'not-found') {
            void socialSync.hard(); // unfriended, or a retry after the friendship ended (M22 as merged)
          }
          if (error.kind === 'not-found' || error.kind === 'network') {
            void walletSync.hard(); // the gift may have moved: its debit shows before the player changes the amount
          }
          return { ok: false, error };
        });
      giftFlight = run;
      return run;
    },
    cancelGift() {
      screens.close('gift');
    },
    accept: (h) => friendCall(() => social.accept(h), null),
    remove: (h) => friendCall(() => social.remove(h), h),
    setVisible(on, textVersion) {
      if (busy('consent')) {
        return;
      }
      flag('consent', true);
      void socialSync.mutate(() => social.setVisible(on, textVersion)).then((r) => {
        flag('consent', false);
        if (!r.ok) {
          failed(r.error);
        }
      });
    },
    sendInvite() {
      const code = asking;
      if (code === null || busy('invite')) {
        return;
      }
      flag('invite', true);
      void social.ask(code).then((r) => {
        flag('invite', false);
        if (!alive) {
          return;
        }
        if (!r.ok && r.error.kind !== 'not-found') {
          failed(r.error); // the prompt stays for a retry
          return;
        }
        asking = null;
        screens.close('invite');
        if (r.ok && r.value.state === 'requested') {
          note('meta.invite_sent');
        }
      });
    },
    dismissInvite() {
      asking = null;
      screens.close('invite');
    },
    rotate() {
      if (busy('social')) {
        return;
      }
      flag('social', true);
      void socialSync.mutate(() => social.rotate()).then((r) => {
        flag('social', false);
        if (!r.ok && !waitNoted(r.error)) {
          failed(r.error);
        }
      });
    },
    async share(story) {
      if (sharing) {
        return;
      }
      sharing = true;
      try {
        await shareOnce(story, true);
      } finally {
        sharing = false;
      }
    },
    buyPack(p) {
      void purchaseFlow().then((f) => {
        if (f === null || !alive) {
          return;
        }
        if (stuck(f)) {
          f.checkAgain(); // the tap reached the page, so no sheet is open: the poll frees the flow for the next Buy
        } else {
          f.buy(p); // ignored while an invoice is created, open or confirmed
        }
      });
    },
    openPolicy() {
      if (!tg.openLink(policyUrl(d.host)).ok) {
        note('meta.action_failed');
      }
    },
    openTerms() {
      if (vm.ui !== null) {
        screens.push({ kind: 'terms' });
      }
    },
    hintPort() {
      const port = wallet.hintPort(() => meta.openWallet());
      if (wallet.state() === null) {
        void walletSync.soft(); // the boot read failed: the ladder's cost and balance stay unknown until one answers
      }
      return {
        balance: port.balance,
        tierCost: port.tierCost,
        use: (puzzle, tier, lang) => walletSync.mutate(() => port.use(puzzle, tier, lang)),
        getMore: port.getMore,
      };
    },
    lineShown() {
      if (!prefetched) {
        prefetched = true;
        void ensureUi();
      }
    },
    homeShown: offerInvite,
    screensChanged(v) {
      if (v.root.kind !== root) {
        root = v.root.kind;
        epoch += 1;
      }
      const was = open;
      const now = new Set(v.overlays.map((s) => s.kind));
      const closed = (k: ScreenKind): boolean => was.has(k) && !now.has(k);
      open = now;
      if (closed('card')) {
        set({ card: null });
      }
      if (closed('friend')) {
        set({ profile: null });
      }
      if (closed('gift')) {
        set({ gift: null }); // the request ids stay: a reopened dialog retries with its own
      }
      if (closed('invite')) {
        asking = null;
        set({ invite: null });
      }
    },
    closeOverlays() {
      epoch += 1;
    },
    onLifecycle(e) {
      if (e === 'activated') {
        flow?.onActivated();
      } else {
        flow?.onDeactivated();
      }
    },
    dispose() {
      if (!alive) {
        return;
      }
      alive = false;
      epoch += 1;
      giftIds.clear();
      flow?.dispose();
      flow = null;
    },
  };
  return meta;
}
