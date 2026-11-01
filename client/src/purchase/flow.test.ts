import { expect, test } from 'vitest';

import type { Endpoints } from '../api/endpoints.ts';
import type { CreateInvoiceResponse, EntitlementsResponse, ErrorCode, OrderResponse, OrderStatus } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { Result } from '../story/catalog.ts';
import type { OrderId, ProductId } from '../story/staging.ts';
import type { InvoiceStatus, TgError } from '../telegram/index.ts';
import { PAID_WINDOW_MS, PENDING_WINDOW_MS, chapterDelivered, createPurchaseFlow, packDelivered } from './flow.ts';
import type { IsDelivered, PurchaseFlow, PurchaseState } from './flow.ts';

/** Timers the test advances by hand; promise chains settle between timers, so chained timers fire in order. */
class FakeClock implements Clock {
  #now = 0;
  #next = 1;
  readonly #timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.#now;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.#next++;
    this.#timers.set(id, { at: this.#now + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }
  pending(): number {
    return this.#timers.size;
  }
  async advance(ms: number): Promise<void> {
    const end = this.#now + ms;
    await settle();
    for (;;) {
      const due = [...this.#timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (due === undefined) {
        break;
      }
      this.#timers.delete(due[0]);
      this.#now = due[1].at;
      due[1].fn();
      await settle();
    }
    this.#now = end;
  }
}

/** Lets every pending promise chain run: one real macrotask. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const CH2 = 'chapter:ch2' as ProductId;
const PACK = 'pack:hints3' as ProductId;
const ORDER = 'o_0123456789abcdef0123456789abcdef';
const offline: ApiError = { kind: 'network', detail: 'offline' };
const httpError = (status: number, code: ErrorCode): ApiError => ({ kind: 'http', status, code, body: { error: code }, retryAfter: null });

/** The server side of P2-P8: invoices, the order's status per poll, the entitlements. */
class FakeShop implements Pick<Endpoints, 'createInvoice' | 'getOrder' | 'getEntitlements'> {
  /** The poll times. */
  readonly polls: number[] = [];
  invoices = 0;
  entitlementReads = 0;
  /** The order's answer at the n-th poll (1-based). */
  status: (n: number) => OrderStatus | ApiError = () => 'checkout';
  owned: readonly ProductId[] = [];
  invoice: () => Promise<Result<CreateInvoiceResponse, ApiError>> = async () => ({
    ok: true,
    value: { orderId: ORDER, invoiceUrl: 'https://t.me/$sample-invoice' },
  });
  order: (() => Promise<Result<OrderResponse, ApiError>>) | null = null;
  readonly clock: FakeClock;

  constructor(clock: FakeClock) {
    this.clock = clock;
  }
  createInvoice = (): Promise<Result<CreateInvoiceResponse, ApiError>> => {
    this.invoices += 1;
    return this.invoice();
  };
  getOrder = async (id: OrderId): Promise<Result<OrderResponse, ApiError>> => {
    this.polls.push(this.clock.now());
    if (this.order !== null) {
      return this.order();
    }
    const s = this.status(this.polls.length);
    return typeof s === 'string' ? { ok: true, value: { orderId: id, productId: CH2, status: s } } : { ok: false, error: s };
  };
  getEntitlements = async (): Promise<Result<EntitlementsResponse, ApiError>> => {
    this.entitlementReads += 1;
    return {
      ok: true,
      value: { products: [{ productId: CH2, chapterId: 'ch2', priceStars: 50, owned: this.owned.includes(CH2) }] },
    };
  };
}

/** The facade's invoice sheet: answers `status`, or waits for `answer()` when `status` is null. */
class FakeTg {
  opened = 0;
  status: Result<InvoiceStatus, TgError> | null;
  #waiting: Array<(r: Result<InvoiceStatus, TgError>) => void> = [];

  constructor(status: InvoiceStatus | null) {
    this.status = status === null ? null : { ok: true, value: status };
  }
  openInvoice = (_url: string): Promise<Result<InvoiceStatus, TgError>> => {
    this.opened += 1;
    const s = this.status;
    return s !== null ? Promise.resolve(s) : new Promise((resolve) => this.#waiting.push(resolve));
  };
  answer(r: Result<InvoiceStatus, TgError>): void {
    for (const resolve of this.#waiting.splice(0)) {
      resolve(r);
    }
  }
}

function flowOf(
  shop: FakeShop,
  tg: FakeTg,
  clock: FakeClock,
  isDelivered: IsDelivered = chapterDelivered(shop),
): { flow: PurchaseFlow; states: PurchaseState[] } {
  const states: PurchaseState[] = [];
  const flow = createPurchaseFlow({ api: shop, tg, clock, isDelivered, onState: (s) => states.push(s) });
  return { flow, states };
}

const orderId = ORDER as OrderId;
const kinds = (states: readonly PurchaseState[]) => states.map((s) => s.kind);

test('flow: paid polls with backoff then unlocks', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  shop.status = (n) => (n < 6 ? 'checkout' : 'paid');
  shop.owned = [CH2];
  const { flow, states } = flowOf(shop, new FakeTg('paid'), clock);
  flow.buy(CH2);
  await clock.advance(8000);
  expect(shop.polls).toEqual([0, 500, 1500, 3000, 5000, 8000]);
  expect(flow.state()).toEqual({ kind: 'unlocked', product: CH2 });
  expect(states).toEqual([
    { kind: 'requesting' },
    { kind: 'sheet', orderId },
    { kind: 'confirming', orderId, since: 0 },
    { kind: 'unlocked', product: CH2 },
  ]);
  expect(clock.pending()).toBe(0);
});

test('flow: cancelled returns to paywall', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  const { flow, states } = flowOf(shop, new FakeTg('cancelled'), clock);
  flow.buy(CH2);
  await clock.advance(60_000);
  expect(flow.state()).toEqual({ kind: 'failed', reason: 'cancelled' });
  expect(kinds(states)).toEqual(['requesting', 'sheet', 'failed']);
  expect(shop.polls).toEqual([]);
  expect(clock.pending()).toBe(0);
});

test('flow: failed invoice ends failed', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  const { flow } = flowOf(shop, new FakeTg('failed'), clock);
  flow.buy(CH2);
  await clock.advance(60_000);
  expect(flow.state()).toEqual({ kind: 'failed', reason: 'failed' });
  expect(shop.polls).toEqual([]);

  // TWA refusing the sheet (a second open of the same slug, an unsupported client) is a Telegram failure.
  const tg = new FakeTg(null);
  tg.status = { ok: false, error: { kind: 'invalid', method: 'openInvoice', detail: 'WebAppInvoiceOpened' } };
  const second = flowOf(shop, tg, clock);
  second.flow.buy(CH2);
  await settle();
  expect(second.flow.state()).toEqual({ kind: 'failed', reason: 'telegram' });

  // The invoice creation's errors, by code.
  for (const [error, reason] of [
    [httpError(404, 'unknown_product'), 'unknown-product'],
    [httpError(502, 'telegram_unavailable'), 'telegram'],
    [offline, 'network'],
    [httpError(500, 'internal'), 'network'],
  ] as const) {
    shop.invoice = async () => ({ ok: false, error });
    const f = flowOf(shop, new FakeTg('paid'), clock);
    f.flow.buy(CH2);
    await settle();
    expect(f.flow.state(), reason).toEqual({ kind: 'failed', reason });
  }
  expect(shop.polls).toEqual([]);
});

test('flow: window exceeded → delayed', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  shop.owned = [CH2];
  const { flow } = flowOf(shop, new FakeTg('paid'), clock);
  flow.buy(CH2);
  await clock.advance(PAID_WINDOW_MS - 1);
  expect(flow.state()).toMatchObject({ kind: 'confirming' });
  await clock.advance(1);
  expect(flow.state()).toEqual({ kind: 'delayed', orderId });
  expect(clock.pending()).toBe(0);
  const polled = shop.polls.length;
  await clock.advance(60_000);
  expect(shop.polls).toHaveLength(polled);

  shop.status = () => 'paid';
  flow.checkAgain();
  await settle();
  expect(flow.state()).toEqual({ kind: 'unlocked', product: CH2 });
  expect(shop.polls).toHaveLength(polled + 1);
});

test('flow: pending uses the long window', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  const { flow } = flowOf(shop, new FakeTg('pending'), clock);
  flow.buy(CH2);
  await clock.advance(60_000);
  expect(flow.state()).toEqual({ kind: 'confirming', orderId, since: 0 });
  await clock.advance(PENDING_WINDOW_MS - 60_000 - 1);
  expect(flow.state()).toMatchObject({ kind: 'confirming' });
  await clock.advance(1);
  expect(flow.state()).toEqual({ kind: 'delayed', orderId });
  expect(clock.pending()).toBe(0);
});

test('flow: activated re-polls', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  shop.owned = [CH2];
  const { flow } = flowOf(shop, new FakeTg('paid'), clock);
  flow.buy(CH2);
  await settle();
  expect(shop.polls).toEqual([0]);
  // Deactivated: no poll and no timer while away.
  flow.onDeactivated();
  expect(clock.pending()).toBe(0);
  await clock.advance(20_000);
  expect(shop.polls).toEqual([0]);
  // Activated: one poll at once, then the schedule resumes.
  flow.onActivated();
  await settle();
  expect(shop.polls).toEqual([0, 20_000]);
  await clock.advance(500);
  expect(shop.polls).toEqual([0, 20_000, 20_500]);

  // The window still ends 30 s after confirming began; in delayed, activated re-checks once.
  await clock.advance(PAID_WINDOW_MS);
  expect(flow.state()).toEqual({ kind: 'delayed', orderId });
  const polled = shop.polls.length;
  flow.onActivated();
  await settle();
  expect(shop.polls).toHaveLength(polled + 1);
  expect(flow.state()).toEqual({ kind: 'delayed', orderId });
  shop.status = () => 'paid';
  flow.onActivated();
  await settle();
  expect(flow.state()).toEqual({ kind: 'unlocked', product: CH2 });

  // invoice_closed lost: the sheet's promise never settles; activated polls once, and paid confirms.
  const c2 = new FakeClock();
  const shop2 = new FakeShop(c2);
  shop2.status = () => 'paid';
  shop2.owned = [CH2];
  const lost = flowOf(shop2, new FakeTg(null), c2);
  lost.flow.buy(CH2);
  await settle();
  expect(lost.flow.state()).toEqual({ kind: 'sheet', orderId });
  lost.flow.onActivated();
  await settle();
  expect(shop2.polls).toEqual([0]);
  expect(lost.flow.state()).toEqual({ kind: 'unlocked', product: CH2 });
  expect(c2.pending()).toBe(0);
});

test('purchase_unlocks_only_from_server', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  // The order never turns paid and the entitlement says not owned; every client store says otherwise.
  let storageReads = 0;
  const forged = (value: string) => ({
    get: async (_k: string): Promise<Result<string | null, TgError>> => {
      storageReads += 1;
      return { ok: true, value };
    },
    set: async (): Promise<Result<void, TgError>> => ({ ok: true, value: undefined }),
  });
  // A whole facade's worth of storage beside the sheet; the flow's type gives it `openInvoice` only.
  const tg = { openInvoice: new FakeTg('paid').openInvoice, cloud: forged('owned'), device: forged('true') };
  const states: PurchaseState[] = [];
  const flow = createPurchaseFlow({ api: shop, tg, clock, isDelivered: chapterDelivered(shop), onState: (s) => states.push(s) });
  flow.buy(CH2);
  await clock.advance(PAID_WINDOW_MS);
  flow.checkAgain();
  flow.onActivated();
  await clock.advance(PENDING_WINDOW_MS);
  expect(kinds(states)).not.toContain('unlocked');
  expect(flow.state()).toEqual({ kind: 'delayed', orderId });
  expect(storageReads).toBe(0);

  // Even a paid order unlocks only when the entitlement read says owned.
  shop.status = () => 'paid';
  flow.checkAgain();
  await settle();
  expect(shop.entitlementReads).toBe(1);
  expect(flow.state()).toEqual({ kind: 'delayed', orderId });
});

test('flow: pack product confirms through order status', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  shop.status = (n) => (n < 3 ? 'checkout' : 'paid');
  // A pack is never an entitlement: the list stays without it.
  const { flow } = flowOf(shop, new FakeTg('paid'), clock, packDelivered);
  flow.buy(PACK);
  await clock.advance(PAID_WINDOW_MS);
  expect(flow.state()).toEqual({ kind: 'unlocked', product: PACK });
  expect(shop.polls).toEqual([0, 500, 1500]);
  expect(clock.pending()).toBe(0);
});

test('flow: double tap opens one invoice', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  const created = deferred<Result<CreateInvoiceResponse, ApiError>>();
  shop.invoice = () => created.promise;
  const tg = new FakeTg(null);
  const { flow } = flowOf(shop, tg, clock);
  flow.buy(CH2);
  flow.buy(CH2);
  expect(shop.invoices).toBe(1);
  created.resolve({ ok: true, value: { orderId: ORDER, invoiceUrl: 'https://t.me/$sample-invoice' } });
  await settle();
  expect(flow.state()).toEqual({ kind: 'sheet', orderId });
  flow.buy(CH2);
  await settle();
  expect([shop.invoices, tg.opened]).toEqual([1, 1]);
  // Nor a second order while Telegram is still confirming.
  tg.answer({ ok: true, value: 'paid' });
  await clock.advance(PAID_WINDOW_MS);
  expect(flow.state()).toEqual({ kind: 'delayed', orderId });
  flow.buy(CH2);
  await settle();
  expect([shop.invoices, tg.opened]).toEqual([1, 1]);
});

test('flow: already owned asks the server', async () => {
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  shop.invoice = async () => ({ ok: false, error: httpError(409, 'already_owned') });
  shop.owned = [CH2];
  const tg = new FakeTg('paid');
  const owned = flowOf(shop, tg, clock);
  owned.flow.buy(CH2);
  await settle();
  expect(owned.flow.state()).toEqual({ kind: 'unlocked', product: CH2 });

  shop.owned = [];
  const notOwned = flowOf(shop, tg, clock);
  notOwned.flow.buy(CH2);
  await settle();
  expect(notOwned.flow.state()).toEqual({ kind: 'failed', reason: 'failed' });
  expect([tg.opened, shop.polls.length, shop.entitlementReads]).toEqual([0, 0, 2]);
});

test('flow_clears_timers', async () => {
  // After unlocked and after delayed.
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  shop.status = (n) => (n < 2 ? 'checkout' : 'paid');
  shop.owned = [CH2];
  const unlocked = flowOf(shop, new FakeTg('paid'), clock);
  unlocked.flow.buy(CH2);
  await clock.advance(500);
  expect(unlocked.flow.state()).toEqual({ kind: 'unlocked', product: CH2 });
  expect(clock.pending()).toBe(0);
  shop.status = () => 'checkout';
  const delayed = flowOf(shop, new FakeTg('paid'), clock);
  delayed.flow.buy(CH2);
  await clock.advance(PAID_WINDOW_MS);
  expect(delayed.flow.state()).toEqual({ kind: 'delayed', orderId });
  expect(clock.pending()).toBe(0);

  // dispose() mid-confirming, with a poll in flight: no timer, and its late answer changes nothing.
  const c2 = new FakeClock();
  const shop2 = new FakeShop(c2);
  const answer = deferred<Result<OrderResponse, ApiError>>();
  const mid = flowOf(shop2, new FakeTg('paid'), c2);
  mid.flow.buy(CH2);
  await c2.advance(500);
  shop2.order = () => answer.promise;
  await c2.advance(1000);
  expect(shop2.polls).toEqual([0, 500, 1500]);
  mid.flow.dispose();
  expect(c2.pending()).toBe(0);
  const seen = mid.states.length;
  answer.resolve({ ok: true, value: { orderId: ORDER, productId: CH2, status: 'paid' } });
  await c2.advance(60_000);
  expect(mid.states).toHaveLength(seen);
  expect(shop2.polls).toHaveLength(3);

  // A sheet that closes after dispose(): no state, no poll.
  const tg = new FakeTg(null);
  const sheet = flowOf(shop2, tg, c2);
  sheet.flow.buy(CH2);
  await settle();
  sheet.flow.dispose();
  tg.answer({ ok: true, value: 'paid' });
  await c2.advance(60_000);
  expect(kinds(sheet.states)).toEqual(['requesting', 'sheet']);
  expect(shop2.polls).toHaveLength(3);

  // An invoice created after dispose() (Buy, then Back): no Stars sheet opens over the next screen.
  const created = deferred<Result<CreateInvoiceResponse, ApiError>>();
  shop2.invoice = () => created.promise;
  const tg2 = new FakeTg('paid');
  const gone = flowOf(shop2, tg2, c2);
  gone.flow.buy(CH2);
  gone.flow.dispose();
  created.resolve({ ok: true, value: { orderId: ORDER, invoiceUrl: 'https://t.me/$sample-invoice' } });
  await c2.advance(60_000);
  expect(tg2.opened).toBe(0);
  expect(kinds(gone.states)).toEqual(['requesting']);
  expect(c2.pending()).toBe(0);
});

test('flow: check again leaves a lost sheet', async () => {
  // invoice_closed lost (the facade's promise never settles): Check again polls the order once.
  const clock = new FakeClock();
  const shop = new FakeShop(clock);
  shop.owned = [CH2];
  const tg = new FakeTg(null);
  const paid = flowOf(shop, tg, clock);
  shop.status = () => 'created';
  paid.flow.buy(CH2);
  await settle();
  // Activated with the order still `created`: the sheet may still be open, so the flow waits in it.
  paid.flow.onActivated();
  await settle();
  expect(paid.flow.state()).toEqual({ kind: 'sheet', orderId });
  // A failed poll changes nothing either.
  shop.status = () => offline;
  paid.flow.checkAgain();
  await settle();
  expect(paid.flow.state()).toEqual({ kind: 'sheet', orderId });
  // Paid: the confirm path, with no second order read.
  shop.status = () => 'paid';
  paid.flow.checkAgain();
  await settle();
  expect(paid.flow.state()).toEqual({ kind: 'unlocked', product: CH2 });
  expect(shop.polls).toEqual([0, 0, 0]);

  // `checkout` (pre-checkout passed): confirming, on the long window.
  const c2 = new FakeClock();
  const shop2 = new FakeShop(c2);
  shop2.status = () => 'checkout';
  const paying = flowOf(shop2, new FakeTg(null), c2);
  paying.flow.buy(CH2);
  await settle();
  paying.flow.checkAgain();
  await settle();
  expect(paying.flow.state()).toEqual({ kind: 'confirming', orderId, since: 0 });
  await c2.advance(PENDING_WINDOW_MS);
  expect(paying.flow.state()).toEqual({ kind: 'delayed', orderId });

  // `created`: a tap reached the page, so the sheet is closed and nothing was paid: back to the paywall, Buy again.
  const c3 = new FakeClock();
  const shop3 = new FakeShop(c3);
  shop3.status = () => 'created';
  const tg3 = new FakeTg(null);
  const unpaid = flowOf(shop3, tg3, c3);
  unpaid.flow.buy(CH2);
  await settle();
  unpaid.flow.checkAgain();
  await settle();
  expect(unpaid.flow.state()).toEqual({ kind: 'failed', reason: 'cancelled' });
  // Should the lost close still arrive as paid, it is confirmed from the server like any other.
  shop3.status = () => 'paid';
  shop3.owned = [CH2];
  tg3.answer({ ok: true, value: 'paid' });
  await settle();
  expect(unpaid.flow.state()).toEqual({ kind: 'unlocked', product: CH2 });
  unpaid.flow.buy(CH2);
  expect(shop3.invoices).toBe(2);

  // A refunded or unknown order ends the flow.
  const c4 = new FakeClock();
  const shop4 = new FakeShop(c4);
  shop4.status = () => httpError(404, 'not_found');
  const unknown = flowOf(shop4, new FakeTg(null), c4);
  unknown.flow.buy(CH2);
  await settle();
  unknown.flow.checkAgain();
  await settle();
  expect(unknown.flow.state()).toEqual({ kind: 'failed', reason: 'failed' });
  expect(c4.pending()).toBe(0);
});
