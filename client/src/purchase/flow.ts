// The purchase state machine (PROTOTYPE-PLAN "Payment flow end to end" P2-P8; META-PLAN M19 for packs). Buy creates the
// invoice on the server, the facade opens it, and the order is polled. The client never grants (principles 1-2):
// `openInvoice`'s 'paid' only starts the poll, and `unlocked` comes only from server reads - the polled order `paid`,
// then `isDelivered`. `tg` is typed to `openInvoice` alone, so no CloudStorage or DeviceStorage value can reach this
// decision. One invoice creation in flight per flow: a double tap opens one sheet. States only, no player-facing text.
import type { Endpoints } from '../api/endpoints.ts';
import type { CreateInvoiceResponse, OrderResponse } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { Result } from '../story/catalog.ts';
import type { OrderId, ProductId } from '../story/staging.ts';
import type { InvoiceStatus, TelegramClient, TgError } from '../telegram/index.ts';

/** PROTOTYPE-PLAN "Module API", verbatim. */
export type PurchaseState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'sheet'; orderId: OrderId }
  | { kind: 'confirming'; orderId: OrderId; since: number }
  | { kind: 'delayed'; orderId: OrderId }
  | { kind: 'failed'; reason: 'cancelled' | 'failed' | 'network' | 'telegram' | 'unknown-product' }
  | { kind: 'unlocked'; product: ProductId };

/** Whether the server delivered `p`; asked only after a server read said so (the order `paid`, or `already_owned`). */
export type IsDelivered = (p: ProductId) => Promise<Result<boolean, ApiError>>;

export interface PurchaseFlow {
  /** From idle, failed or unlocked; ignored while an invoice is being created, open or confirmed. */
  buy(p: ProductId): void;
  /** "Check again": one order poll from `delayed`, or from `sheet` when `invoice_closed` never came. */
  checkAgain(): void;
  /** Lifecycle `activated`: polls now (confirming, delayed, sheet). */
  onActivated(): void;
  /** Lifecycle `deactivated`: the poll and window timers stop until `onActivated`. */
  onDeactivated(): void;
  state(): PurchaseState;
  /** Timers cleared; late answers dropped; no further `onState`. */
  dispose(): void;
}

/** P7: the waits between order polls, the first one at once; the last repeats. */
export const POLL_DELAYS_MS: readonly number[] = [0, 500, 1000, 1500, 2000, 3000];
/** P7: how long `confirming` polls after 'paid' before `delayed`. */
export const PAID_WINDOW_MS = 30_000;
/** P7: the same after 'pending' (and after a `checkout` order found from a lost sheet). */
export const PENDING_WINDOW_MS = 120_000;

/** A chapter is delivered when `GET /api/entitlements` lists it owned. */
export function chapterDelivered(api: Pick<Endpoints, 'getEntitlements'>): IsDelivered {
  return async (p) => {
    const r = await api.getEntitlements();
    return r.ok ? { ok: true, value: r.value.products.some((x) => x.productId === p && x.owned) } : r;
  };
}

/**
 * A pack (META M19) is never an entitlement: its order turns `paid` in the transaction that credits the balance, so
 * the polled order is the server's confirmation. The wallet is read after `unlocked`, by its owner (LMI).
 */
export const packDelivered: IsDelivered = async () => ({ ok: true, value: true });

/** Why a poll runs: from `sheet`, only the player's tap shows the native sheet is closed. */
type Reason = 'schedule' | 'activated' | 'check';

const asNetwork = (e: unknown): { ok: false; error: ApiError } => ({ ok: false, error: { kind: 'network', detail: String(e) } });

export function createPurchaseFlow(deps: {
  api: Pick<Endpoints, 'createInvoice' | 'getOrder'>;
  tg: Pick<TelegramClient, 'openInvoice'>;
  clock: Clock;
  isDelivered: IsDelivered;
  onState: (s: PurchaseState) => void;
}): PurchaseFlow {
  const { api, tg, clock, isDelivered, onState } = deps;
  let state: PurchaseState = { kind: 'idle' };
  let alive = true;
  /** One per buy: every answer carries the epoch it was asked in, and an older one is dropped. */
  let epoch = 0;
  let product: ProductId | null = null;
  let order: OrderId | null = null;
  let deadline = 0;
  let step = 0;
  let pollTimer: number | null = null;
  let windowTimer: number | null = null;
  /** A poll (the order read and its delivered check) is in flight: at most one. */
  let polling = false;
  let away = false;
  /** Check again found the sheet closed with nothing paid; a late `invoice_closed` is still honoured. */
  let sheetLost = false;

  const set = (s: PurchaseState): void => {
    if (alive) {
      state = s;
      onState(s);
    }
  };
  const cancelPoll = (): void => {
    if (pollTimer !== null) {
      clock.clearTimeout(pollTimer);
      pollTimer = null;
    }
  };
  const clearTimers = (): void => {
    cancelPoll();
    if (windowTimer !== null) {
      clock.clearTimeout(windowTimer);
      windowTimer = null;
    }
  };
  const finish = (s: PurchaseState): void => {
    clearTimers();
    set(s);
  };

  function armWindow(): void {
    if (windowTimer !== null) {
      clock.clearTimeout(windowTimer);
    }
    windowTimer = clock.setTimeout(
      () => {
        windowTimer = null;
        if (state.kind === 'confirming') {
          finish({ kind: 'delayed', orderId: state.orderId });
        }
      },
      Math.max(0, deadline - clock.now()),
    );
  }

  /** P7: `confirming` for `windowMs`; `paid` = the order was already read paid, so the delivered check runs now. */
  function startConfirming(id: OrderId, windowMs: number, paid: boolean): void {
    clearTimers();
    const since = clock.now();
    deadline = since + windowMs;
    step = 0;
    set({ kind: 'confirming', orderId: id, since });
    if (away) {
      return;
    }
    armWindow();
    if (paid) {
      deliver(epoch);
    } else {
      poll('schedule');
    }
  }

  function next(): void {
    if (state.kind !== 'confirming' || away) {
      return;
    }
    if (clock.now() >= deadline) {
      finish({ kind: 'delayed', orderId: state.orderId });
      return;
    }
    step = Math.min(step + 1, POLL_DELAYS_MS.length - 1);
    cancelPoll();
    pollTimer = clock.setTimeout(() => {
      pollTimer = null;
      poll('schedule');
    }, POLL_DELAYS_MS[step] ?? 3000);
  }

  function poll(reason: Reason): void {
    if (polling || order === null) {
      return;
    }
    polling = true;
    const mine = epoch;
    void api.getOrder(order).then(
      (r) => polled(mine, reason, r),
      (e: unknown) => polled(mine, reason, asNetwork(e)),
    );
  }

  function polled(mine: number, reason: Reason, r: Result<OrderResponse, ApiError>): void {
    if (mine !== epoch) {
      return;
    }
    polling = false;
    const status = r.ok ? r.value.status : null;
    if (status === 'refunded' || (!r.ok && r.error.kind === 'http' && r.error.status === 404)) {
      // The order was refunded, or is not this user's: nothing to wait for.
      if (state.kind === 'confirming' || state.kind === 'delayed' || state.kind === 'sheet') {
        finish({ kind: 'failed', reason: 'failed' });
      }
      return;
    }
    switch (state.kind) {
      case 'confirming':
        if (status === 'paid') {
          deliver(mine);
        } else {
          next();
        }
        return;
      case 'delayed':
        if (status === 'paid') {
          deliver(mine);
        }
        return;
      case 'sheet':
        if (status === 'paid') {
          startConfirming(state.orderId, PAID_WINDOW_MS, true);
        } else if (reason === 'check' && status === 'checkout') {
          // Pre-checkout passed and the close was lost: Telegram is still charging.
          startConfirming(state.orderId, PENDING_WINDOW_MS, false);
        } else if (reason === 'check' && status === 'created') {
          // The tap reached the page, so the native sheet is closed, and no payment was attempted.
          sheetLost = true;
          set({ kind: 'failed', reason: 'cancelled' });
        }
        return;
      case 'idle':
      case 'requesting':
      case 'failed':
      case 'unlocked':
        return;
      default: {
        const _never: never = state;
        return _never;
      }
    }
  }

  /** P8: the order is paid; the product is unlocked only when the server says it was delivered. */
  function deliver(mine: number): void {
    const p = product;
    if (p === null) {
      return;
    }
    polling = true;
    void isDelivered(p).then(
      (d) => delivered(mine, p, d),
      (e: unknown) => delivered(mine, p, asNetwork(e)),
    );
  }

  function delivered(mine: number, p: ProductId, d: Result<boolean, ApiError>): void {
    if (mine !== epoch) {
      return;
    }
    polling = false;
    if (d.ok && d.value) {
      finish({ kind: 'unlocked', product: p });
    } else {
      // Not yet visible (or the read failed): confirming polls on; delayed waits for the next check.
      next();
    }
  }

  function created(mine: number, p: ProductId, r: Result<CreateInvoiceResponse, ApiError>): void {
    if (mine !== epoch || state.kind !== 'requesting') {
      return;
    }
    if (r.ok) {
      // The server's order id, branded at this edge.
      const id = r.value.orderId as OrderId;
      order = id;
      set({ kind: 'sheet', orderId: id });
      void tg.openInvoice(r.value.invoiceUrl).then(
        (s) => closed(mine, id, s),
        (e: unknown) => closed(mine, id, { ok: false, error: { kind: 'invalid', method: 'openInvoice', detail: String(e) } }),
      );
      return;
    }
    const e = r.error;
    if (e.kind === 'http' && e.code === 'already_owned') {
      // P3 refused: the server says owned. Unlock only when its delivered read agrees.
      void isDelivered(p).then(
        (d) => owned(mine, p, d),
        (x: unknown) => owned(mine, p, asNetwork(x)),
      );
      return;
    }
    const code = e.kind === 'http' ? e.code : null;
    set({ kind: 'failed', reason: code === 'unknown_product' ? 'unknown-product' : code === 'telegram_unavailable' ? 'telegram' : 'network' });
  }

  function owned(mine: number, p: ProductId, d: Result<boolean, ApiError>): void {
    if (mine === epoch) {
      finish(d.ok && d.value ? { kind: 'unlocked', product: p } : { kind: 'failed', reason: 'failed' });
    }
  }

  /** P7: how Telegram closed the sheet. A close that arrives after the flow moved on is dropped. */
  function closed(mine: number, id: OrderId, r: Result<InvoiceStatus, TgError>): void {
    if (mine !== epoch) {
      return;
    }
    if (state.kind !== 'sheet') {
      if (sheetLost && state.kind === 'failed' && r.ok && (r.value === 'paid' || r.value === 'pending')) {
        // Check again judged the sheet closed unpaid, yet Telegram reports a payment: confirm it from the server.
        sheetLost = false;
        startConfirming(id, r.value === 'paid' ? PAID_WINDOW_MS : PENDING_WINDOW_MS, false);
      }
      return;
    }
    if (!r.ok) {
      set({ kind: 'failed', reason: 'telegram' });
      return;
    }
    switch (r.value) {
      case 'paid':
        startConfirming(id, PAID_WINDOW_MS, false);
        return;
      case 'pending':
        startConfirming(id, PENDING_WINDOW_MS, false);
        return;
      case 'cancelled':
        set({ kind: 'failed', reason: 'cancelled' });
        return;
      case 'failed':
        set({ kind: 'failed', reason: 'failed' });
        return;
      default: {
        const _never: never = r.value;
        return _never;
      }
    }
  }

  return {
    buy(p) {
      if (!alive || (state.kind !== 'idle' && state.kind !== 'failed' && state.kind !== 'unlocked')) {
        return;
      }
      clearTimers();
      epoch += 1;
      const mine = epoch;
      product = p;
      order = null;
      polling = false;
      sheetLost = false;
      set({ kind: 'requesting' });
      void api.createInvoice(p).then(
        (r) => created(mine, p, r),
        (e: unknown) => created(mine, p, asNetwork(e)),
      );
    },
    checkAgain() {
      if (alive && (state.kind === 'delayed' || state.kind === 'sheet')) {
        poll('check');
      }
    },
    onActivated() {
      away = false;
      if (!alive) {
        return;
      }
      if (state.kind === 'confirming') {
        if (clock.now() >= deadline) {
          finish({ kind: 'delayed', orderId: state.orderId });
        } else {
          // Back from the background: the poll below replaces a scheduled one, the backoff starts over, and the
          // window keeps its deadline.
          cancelPoll();
          step = 0;
          armWindow();
        }
      }
      if (state.kind === 'confirming' || state.kind === 'delayed' || state.kind === 'sheet') {
        poll('activated');
      }
    },
    onDeactivated() {
      away = true;
      clearTimers();
    },
    state: () => state,
    dispose() {
      alive = false;
      epoch += 1;
      clearTimers();
    },
  };
}
