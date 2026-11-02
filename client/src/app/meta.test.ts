// The meta controller (META-PLAN "Module API", M9-M14, M19-M24, M27; F16-F25, F28) over the real LMD services, the
// real endpoints and decoders, the real view model, screens stack and purchase flow: only the http layer, the facade,
// the reporter's settle and the lazy chunk are fakes. The http fake answers each route with its dto sample unless a
// test parks or replaces the answer, so every answer goes through its decoder as at the real edge.
import { expect, test } from 'vitest';

import type { Decoder } from '../api/decode.ts';
import { createEndpoints, createMetaEndpoints, puzzleId } from '../api/endpoints.ts';
import type { FriendHandle } from '../api/endpoints.ts';
import samplesText from '../api/fixtures/dto-samples.json?raw';
import type { ErrorCode } from '../api/generated/api.ts';
import type { ApiError, ApiRequest, Clock, Http } from '../api/http.ts';
import { t } from '../i18n/index.ts';
import type { ResourceKind } from '../meta/wallet.ts';
import { createPurchaseFlow, packDelivered } from '../purchase/flow.ts';
import type { PurchaseFlow } from '../purchase/flow.ts';
import type { Result, StoryId } from '../story/catalog.ts';
import type { ChapterId, ProductId, PuzzleLocalId } from '../story/staging.ts';
import type { InvoiceStatus, ShareError, TgError } from '../telegram/index.ts';
import { createScreens } from '../ui/screens.ts';
import type { ScreenKind, Screens, ScreensView } from '../ui/screens.ts';
import { createViewModel } from '../ui/state.svelte.ts';
import type { ViewModel } from '../ui/state.svelte.ts';
import { createMetaController, policyUrl } from './meta.ts';
import type { MetaController, MetaUi } from './meta.ts';

const SAMPLES: unknown = JSON.parse(samplesText);

/** The raw dto sample `name[i]`, as the server sends it. */
function sample(name: string, i = 0): unknown {
  const all = typeof SAMPLES === 'object' && SAMPLES !== null ? (SAMPLES as Record<string, unknown>) : {};
  const list = Object.hasOwn(all, name) ? all[name] : undefined;
  const s = Array.isArray(list) ? (list[i] as unknown) : undefined;
  if (s === undefined) {
    throw new Error(`dto-samples.json has no ${name}[${i}]`);
  }
  return s;
}

const TIDE = 'tide' as StoryId;
const MANOR = 'manor' as StoryId;
/** SocialResponse[0]: Аня is a friend, Ben asks. */
const ANYA = '0123456789abcdef01234567' as FriendHandle;
const BEN = 'fedcba9876543210fedcba98' as FriendHandle;
const CODE = '0123456789abcdef0123456789abcdef';
const PACK = 'pack:hint_s' as ProductId;
const ORDER = 'o_0123456789abcdef0123456789abcdef';
const POLICY = 'https://example.test/api/privacy';

/** SocialResponse[0] after Ben's request was accepted: both are friends, no request is left. */
const ACCEPTED = {
  friends: [
    { firstName: 'Аня', handle: ANYA },
    { firstName: 'Ben', handle: BEN },
  ],
  inviteCode: CODE,
  profileVisible: true,
  requests: [],
};

type Wire = { ok: true; body: unknown } | { ok: false; error: ApiError };
const okWire = (body: unknown): Wire => ({ ok: true, body });
const httpError = (status: number, code: ErrorCode | null, retryAfter: number | null = null): Wire => ({
  ok: false,
  error: { kind: 'http', status, code, body: null, retryAfter },
});
const EXPIRED: Wire = { ok: false, error: { kind: 'session-expired' } };

/** The route answers by default: each route's first sample. */
const DEFAULTS: ReadonlyArray<readonly [RegExp, () => Wire]> = [
  [/^GET \/api\/social$/, () => okWire(sample('SocialResponse'))],
  [/^GET \/api\/wallet$/, () => okWire(sample('WalletResponse'))],
  [/^GET \/api\/stats$/, () => okWire(sample('StatsResponse'))],
  [/^POST \/api\/stories\/[^/]+\/card$/, () => okWire(sample('CardResponse'))],
  [/^GET \/api\/invites\/[^/]+$/, () => okWire({ state: 'open' })],
  [/^POST \/api\/invites\/[^/]+\/request$/, () => okWire({ state: 'requested' })],
  [/^POST \/api\/friends\/requests\/[^/]+\/accept$/, () => okWire(ACCEPTED)],
  [/^DELETE \/api\/friends\/[^/]+$/, () => okWire(sample('SocialResponse', 1))],
  [/^PUT \/api\/consents\/friends_profile$/, () => okWire(sample('SocialResponse'))],
  [/^GET \/api\/friends\/[^/]+\/profile$/, () => okWire(sample('FriendProfile'))],
  [/^POST \/api\/share$/, () => okWire(sample('ShareResponse'))],
  [/^POST \/api\/puzzles\/[^/]+\/hints\/\d+/, () => okWire(sample('HintUseResponse'))],
  [/^POST \/api\/invoices$/, () => okWire(sample('CreateInvoiceResponse'))],
  [/^GET \/api\/orders\/[^/]+$/, () => okWire({ orderId: ORDER, productId: PACK, status: 'created' })],
  [/^POST \/api\/gifts$/, () => okWire(sample('GiftResponse'))],
];

/** A request the http fake saw: `METHOD path` and its body. */
type Sent = { label: string; body: unknown };

/** The http layer the endpoints run on: routes the test replaced, parked answers, then the defaults. */
class FakeServer {
  readonly sent: Sent[] = [];
  readonly #routes: Array<readonly [RegExp, (r: ApiRequest) => Wire]> = [];
  readonly #parked: Array<{ match: RegExp; left: number; queue: Array<(w?: Wire) => void> }> = [];

  /** `match`'s answers from now on. */
  on(match: RegExp, answer: (r: ApiRequest) => Wire): void {
    this.#routes.unshift([match, answer]);
  }

  /** Holds the next request matching `match` until `release` answers it (its route's answer by default). */
  park(match: RegExp): { release(w?: Wire): void; waiting(): number } {
    const p = { match, left: 1, queue: [] as Array<(w?: Wire) => void> };
    this.#parked.push(p);
    return {
      release: (w) => {
        const next = p.queue.shift();
        if (next === undefined) {
          throw new Error(`nothing parked on ${String(match)}`);
        }
        next(w);
      },
      waiting: () => p.queue.length,
    };
  }

  /** The labels sent so far that match. */
  count(match: RegExp): number {
    return this.sent.filter((s) => match.test(s.label)).length;
  }

  readonly http: Pick<Http, 'request'> = {
    request: async <T>(r: ApiRequest, decode: Decoder<T>): Promise<Result<T, ApiError>> => {
      const label = `${r.method} ${r.path}`;
      this.sent.push({ label, body: r.body });
      const answer = (): Wire => {
        const own = this.#routes.find(([m]) => m.test(label));
        if (own !== undefined) {
          return own[1](r);
        }
        const fallback = DEFAULTS.find(([m]) => m.test(label));
        if (fallback === undefined) {
          throw new Error(`no answer for ${label}`);
        }
        return fallback[1]();
      };
      const parked = this.#parked.find((p) => p.left > 0 && p.match.test(label));
      if (parked !== undefined) {
        parked.left -= 1;
      }
      const wire =
        parked === undefined
          ? answer()
          : await new Promise<Wire>((resolve) => {
              parked.queue.push((w) => resolve(w ?? answer()));
            });
      if (!wire.ok) {
        return { ok: false, error: wire.error };
      }
      const d = decode(wire.body);
      return d.ok ? d : { ok: false, error: { kind: 'decode', detail: d.error } };
    },
  };
}

class FakeClock implements Clock {
  #now = 1_000_000;
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
  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      const due = [...this.#timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) {
        break;
      }
      this.#timers.delete(due[0]);
      this.#now = due[1].at;
      due[1].fn();
    }
    this.#now = end;
  }
}

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets every answer queued so far land: the fakes answer in microtasks, so one macrotask drains them. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// The overlays are never rendered here: the controller only hands the module to App.svelte.
const UI = {} as MetaUi;

type RigOptions = {
  startParam?: string | null;
  native?: boolean;
  settle?: (o: { timeoutMs: number }) => Promise<'drained' | 'timeout'>;
  loadUi?: () => Promise<MetaUi>;
  shareMessage?: (id: string) => Promise<Result<void, ShareError>>;
  openLink?: (url: string) => Result<void, TgError>;
  openInvoice?: (url: string) => Promise<Result<InvoiceStatus, TgError>>;
  loadPurchase?: () => Promise<{ createPurchaseFlow: typeof createPurchaseFlow; packDelivered: typeof packDelivered }>;
};

type Rig = {
  ctl: MetaController;
  vm: ViewModel;
  screens: Screens;
  server: FakeServer;
  clock: FakeClock;
  /** The facade calls in order: `share:<id>`, `tgLink:<url>`, `link:<url>`, `invoice:<url>`. */
  tg: string[];
  /** Every settle's options, in order. */
  settles: Array<{ timeoutMs: number }>;
  /** Every screens view the stack handed out, in order. */
  views: ScreensView[];
  onCards(): number;
  uiLoads(): number;
};

function rig(o: RigOptions = {}): Rig {
  const server = new FakeServer();
  const clock = new FakeClock();
  const vm = createViewModel({ timers: clock, lang: 'ru' });
  const views: ScreensView[] = [];
  const tg: string[] = [];
  const settles: Array<{ timeoutMs: number }> = [];
  let ctl: MetaController | null = null;
  let cards = 0;
  let loads = 0;
  let ids = 0;
  const screens = createScreens({
    back: { setVisible() {}, onPress: () => () => {} },
    onView: (v) => {
      vm.screens = v;
      views.push(v);
      ctl?.screensChanged(v);
    },
  });
  vm.screens = screens.view();
  ctl = createMetaController({
    meta: createMetaEndpoints(server.http),
    api: createEndpoints(server.http),
    tg: {
      supportsShareMessage: () => o.native ?? true,
      shareMessage: (id) => {
        tg.push(`share:${id}`);
        return o.shareMessage?.(id) ?? Promise.resolve({ ok: true, value: undefined });
      },
      openTelegramLink: (url) => {
        tg.push(`tgLink:${url}`);
        return { ok: true, value: undefined };
      },
      openLink: (url) => {
        tg.push(`link:${url}`);
        return o.openLink?.(url) ?? { ok: true, value: undefined };
      },
      startParam: () => o.startParam ?? null,
      openInvoice: (url) => {
        tg.push(`invoice:${url}`);
        return o.openInvoice?.(url) ?? Promise.resolve({ ok: true, value: 'cancelled' });
      },
    },
    screens,
    vm,
    reporter: {
      settle: (s) => {
        settles.push(s);
        return o.settle?.(s) ?? Promise.resolve('drained');
      },
    },
    storyTitle: (story, lang) => (story === TIDE ? (lang === 'ru' ? 'Прилив' : 'The Tide') : null),
    clock,
    newId: () => `id-${++ids}`,
    host: 'example.test',
    onCards: () => {
      cards += 1;
    },
    loadUi: () => {
      loads += 1;
      return o.loadUi?.() ?? Promise.resolve(UI);
    },
    loadPurchase: o.loadPurchase,
  });
  return { ctl, vm, screens, server, clock, tg, settles, views, onCards: () => cards, uiLoads: () => loads };
}

/** The overlay kinds on top of the root now. */
const kinds = (r: Rig): ScreenKind[] => r.screens.view().overlays.map((s) => s.kind);
/** Whether `kind` was open in any view so far. */
const everOpen = (r: Rig, kind: ScreenKind): boolean => r.views.some((v) => v.overlays.some((s) => s.kind === kind));
/** The toasts shown now, as key and message. */
const toasts = (r: Rig): Array<{ key: string; message: string }> => r.vm.toasts.map((e) => ({ key: e.key, message: e.message }));

const SOCIAL_LABEL = /^GET \/api\/social$/;
const WALLET_LABEL = /^GET \/api\/wallet$/;
const ACCEPT_LABEL = /^POST \/api\/friends\/requests\/[^/]+\/accept$/;
const CARD_LABEL = /^POST \/api\/stories\/[^/]+\/card$/;
const SHARE_LABEL = /^POST \/api\/share$/;
const INVOICE_LABEL = /^POST \/api\/invoices$/;
const ORDER_LABEL = /^GET \/api\/orders\//;

/** A booted rig: the boot reads answered. */
async function booted(o: RigOptions = {}): Promise<Rig> {
  const r = rig(o);
  r.ctl.boot();
  await flush();
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// The boot, the invite and the card (F16, F17, F19)

test('meta: boot fetches never block the first line', async () => {
  const r = rig();
  const parked = [SOCIAL_LABEL, WALLET_LABEL, /^GET \/api\/stats$/].map((m) => r.server.park(m));
  const out: unknown = r.ctl.boot();
  // Synchronous, and all three reads are in flight at once: none waits for another.
  expect(out).toBeUndefined();
  expect(r.server.sent.map((s) => s.label).sort()).toEqual(['GET /api/social', 'GET /api/stats', 'GET /api/wallet']);
  expect(r.vm.meta?.social).toBeNull();
  for (const p of parked) {
    p.release();
  }
  await flush();
  expect(r.vm.meta?.social).toEqual({
    inviteCode: CODE,
    friends: [{ handle: ANYA, firstName: 'Аня' }],
    requests: [{ handle: BEN, firstName: 'Ben', at: 1_800_000_000 }],
    profileVisible: true,
  });
  expect(r.vm.meta?.wallet?.balances).toEqual([{ kind: 'hint', balance: 0, debt: 2 }]);
  expect(r.ctl.hasCard(MANOR)).toBe(true);
  // No launch parameter, so no invite read.
  expect(r.server.count(/invites/)).toBe(0);
  r.ctl.dispose();
});

test('meta: invite prompt only for an open invite', async () => {
  const answers: ReadonlyArray<readonly [string, Wire]> = [
    ['requested', okWire({ state: 'requested' })],
    ['friends', okWire({ state: 'friends' })],
    ['own', okWire({ state: 'own' })],
    ['404', httpError(404, 'not_found')],
  ];
  for (const [label, wire] of answers) {
    const r = rig({ startParam: `f${CODE}` });
    r.server.on(/^GET \/api\/invites\//, () => wire);
    r.ctl.boot();
    await flush();
    r.ctl.homeShown();
    await flush();
    expect(r.server.count(/^GET \/api\/invites\//), label).toBe(1);
    expect(everOpen(r, 'invite'), label).toBe(false);
    r.ctl.sendInvite();
    expect(r.server.count(/^POST \/api\/invites\//), label).toBe(0);
    r.ctl.dispose();
  }
  // A start parameter outside the grammar is never sent.
  const odd = await booted({ startParam: 'fXYZ' });
  expect(odd.server.count(/invites/)).toBe(0);
  odd.ctl.dispose();

  const r = await booted({ startParam: `f${CODE}` });
  expect(r.server.sent.map((s) => s.label)).toContain(`GET /api/invites/${CODE}`);
  expect(kinds(r)).toEqual(['invite']);
  const ask = r.server.park(/^POST \/api\/invites\//);
  r.ctl.sendInvite();
  r.ctl.sendInvite(); // a double tap
  expect(r.vm.meta?.busy.invite).toBe(true);
  ask.release();
  await flush();
  expect(r.server.count(/^POST \/api\/invites\//)).toBe(1);
  expect(kinds(r)).toEqual([]);
  expect(toasts(r)).toEqual([{ key: 'meta.invite_sent', message: t('ru', 'meta.invite_sent') }]);
  r.ctl.dispose();
});

test('meta: ending settles stats for 3 s before the card', async () => {
  const held = deferred<'drained' | 'timeout'>();
  const r = await booted({ settle: () => held.promise });
  const ending = r.ctl.onEnding(TIDE);
  await flush();
  expect(r.settles).toEqual([{ timeoutMs: 3000 }]);
  // Nothing asks for the card before the ending's event is recorded.
  expect(r.server.count(CARD_LABEL)).toBe(0);
  held.resolve('drained');
  await ending;
  await flush();
  expect(r.server.sent.map((s) => s.label)).toContain('POST /api/stories/tide/card');
  expect(kinds(r)).toEqual(['card']);
  expect(r.vm.meta?.card?.story).toBe(TIDE);
  expect(r.vm.meta?.card?.storyTitle).toBe('Прилив');
  expect(r.vm.meta?.card?.data.achievements.map((a) => [a.id, a.isNew])).toEqual([
    ['first_steps', false],
    ['both_roads', true],
  ]);
  r.ctl.dispose();

  // A settle that times out shows the toast and asks for no card; the end's own action retries.
  const late = await booted({ settle: () => Promise.resolve('timeout') });
  await late.ctl.onEnding(TIDE);
  await flush();
  expect(late.server.count(CARD_LABEL)).toBe(0);
  expect(kinds(late)).toEqual([]);
  expect(toasts(late)).toEqual([{ key: 'meta.card_later', message: t('ru', 'meta.card_later') }]);
  late.ctl.dispose();
});

test("meta: home card from stats or this session's ending", async () => {
  const r = await booted({ settle: () => Promise.resolve('timeout') });
  // StatsResponse[0]: manor has two endings, tide none.
  expect([r.ctl.hasCard(MANOR), r.ctl.hasCard(TIDE)]).toEqual([true, false]);
  expect(r.onCards()).toBe(1);
  await r.ctl.onEnding(TIDE);
  expect(r.ctl.hasCard(TIDE)).toBe(true);
  // From Home nothing of the story is in play: no settle (F17.2).
  const settled = r.settles.length;
  expect((await r.ctl.openCard(MANOR)).ok).toBe(true);
  expect(r.settles.length).toBe(settled);
  expect(r.server.sent.map((s) => s.label)).toContain('POST /api/stories/manor/card');
  expect(kinds(r)).toEqual(['card']);
  r.ctl.dispose();

  // A failed stats read: no card until an ending of this session.
  const offline = rig();
  offline.server.on(/^GET \/api\/stats$/, () => httpError(500, 'internal'));
  offline.ctl.boot();
  await flush();
  expect([offline.ctl.hasCard(MANOR), offline.onCards()]).toEqual([false, 0]);
  offline.ctl.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// The overlays and the services' state (F20-F22; LMD carry)

test("meta: overlays show the service state, never a call's own answer", async () => {
  const r = await booted();
  const refresh = r.server.park(SOCIAL_LABEL);
  r.ctl.openFriends(); // a refresh issued before the accept
  await flush();
  expect(kinds(r)).toEqual(['friends']);
  r.ctl.accept(BEN);
  await flush();
  expect(r.vm.meta?.social?.friends.map((f) => f.handle)).toEqual([ANYA, BEN]);
  // The older-issued refresh lands last with the list before the accept: the service keeps the accept's state.
  refresh.release();
  await flush();
  expect(r.vm.meta?.social?.friends.map((f) => f.handle)).toEqual([ANYA, BEN]);
  expect(r.vm.meta?.social?.requests).toEqual([]);
  r.ctl.dispose();
});

test('meta: no refresh while a mutation is in flight', async () => {
  const r = await booted();
  const accept = r.server.park(ACCEPT_LABEL);
  r.ctl.accept(BEN);
  r.ctl.openFriends();
  r.ctl.openConsent();
  await flush();
  // The boot read only: the accept's answer is the state.
  expect(r.server.count(SOCIAL_LABEL)).toBe(1);
  accept.release();
  await flush();
  r.ctl.openFriends();
  await flush();
  expect(r.server.count(SOCIAL_LABEL)).toBe(2);

  // A hint use is the wallet's mutation: opening the wallet meanwhile reads nothing.
  const use = r.server.park(/hints/);
  const port = r.ctl.hintPort();
  const used = port.use(puzzleId('ch1' as ChapterId, 'drawer' as PuzzleLocalId), 1, 'ru');
  r.ctl.openWallet();
  await flush();
  expect(r.server.count(WALLET_LABEL)).toBe(1);
  use.release();
  expect((await used).ok).toBe(true);
  expect(port.balance()).toBe(2);
  expect(r.vm.meta?.wallet?.balances.find((b) => b.kind === 'hint')?.balance).toBe(2);
  r.ctl.dispose();
});

test('meta: accept and remove are single-flight and a 404 refreshes', async () => {
  const r = await booted();
  const accept = r.server.park(ACCEPT_LABEL);
  r.ctl.accept(BEN);
  r.ctl.accept(BEN); // a double tap
  r.ctl.remove(BEN); // Decline while Accept is answered
  expect(r.vm.meta?.busy.social).toBe(true);
  expect([r.server.count(ACCEPT_LABEL), r.server.count(/^DELETE /)]).toEqual([1, 0]);
  accept.release();
  await flush();
  expect(r.vm.meta?.busy.social).toBe(false);

  // Already accepted elsewhere: 404, and the list is read again (F20).
  const reads = r.server.count(SOCIAL_LABEL);
  r.server.on(ACCEPT_LABEL, () => httpError(404, 'not_found'));
  r.ctl.accept(BEN);
  await flush();
  expect(r.server.count(SOCIAL_LABEL)).toBe(reads + 1);
  expect(toasts(r)).toEqual([]);

  // 409 at 200 friends; a network failure; an expired session shows nothing (the reopen notice does).
  r.server.on(ACCEPT_LABEL, () => httpError(409, 'limit_reached'));
  r.ctl.accept(BEN);
  await flush();
  expect(toasts(r).map((x) => x.key)).toEqual(['meta.friend_limit']);
  r.vm.dismissToast('meta.friend_limit');
  r.server.on(/^DELETE /, () => httpError(500, 'internal'));
  r.ctl.remove(ANYA);
  await flush();
  expect(toasts(r)).toEqual([{ key: 'meta.action_failed', message: t('ru', 'meta.action_failed') }]);
  r.vm.dismissToast('meta.action_failed');
  r.server.on(/^DELETE /, () => EXPIRED);
  r.ctl.remove(ANYA);
  await flush();
  expect(toasts(r)).toEqual([]);
  r.ctl.dispose();
});

const ROTATE_LABEL = /^POST \/api\/invite\/rotate$/;
const NEW_CODE = 'fedcba9876543210fedcba9876543210';

test('meta: rotate renders the new code', async () => {
  const r = await booted();
  expect(r.vm.meta?.social?.inviteCode).toBe(CODE);
  r.server.on(ROTATE_LABEL, () => okWire({ ...ACCEPTED, inviteCode: NEW_CODE }));
  const rotation = r.server.park(ROTATE_LABEL);
  r.ctl.rotate();
  r.ctl.rotate(); // a double tap: one rotation, since each one revokes the link before it
  expect(r.vm.meta?.busy.social).toBe(true);
  expect(r.server.count(ROTATE_LABEL)).toBe(1);
  rotation.release();
  await flush();
  expect([r.vm.meta?.busy.social, r.vm.meta?.social?.inviteCode]).toEqual([false, NEW_CODE]);
  expect(toasts(r)).toEqual([]);

  // 429: the wait, in minutes; any other failure: the generic toast. The code stays the server's last one.
  r.server.on(ROTATE_LABEL, () => httpError(429, 'rate_limited', 120));
  r.ctl.rotate();
  await flush();
  expect(toasts(r)).toEqual([{ key: 'meta.share_wait', message: t('ru', 'meta.share_wait', { minutes: 2 }) }]);
  r.vm.dismissToast('meta.share_wait');
  r.server.on(ROTATE_LABEL, () => httpError(500, 'internal'));
  r.ctl.rotate();
  await flush();
  expect(toasts(r)).toEqual([{ key: 'meta.action_failed', message: t('ru', 'meta.action_failed') }]);
  expect([r.server.count(ROTATE_LABEL), r.vm.meta?.social?.inviteCode]).toEqual([3, NEW_CODE]);
  r.ctl.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// The pack purchase (F23; PP P2-P8)

type FlowModule = { createPurchaseFlow: typeof createPurchaseFlow; packDelivered: typeof packDelivered };

/** The real flow module behind a counter; each flow's lifecycle forwards and dispose are recorded. */
function spiedFlows(): { load: () => Promise<FlowModule>; made: () => number; calls: string[] } {
  let made = 0;
  const calls: string[] = [];
  const module: FlowModule = {
    packDelivered,
    createPurchaseFlow: (deps) => {
      made += 1;
      const f = createPurchaseFlow(deps);
      const spied: PurchaseFlow = {
        ...f,
        onActivated: () => {
          calls.push('activated');
          f.onActivated();
        },
        onDeactivated: () => {
          calls.push('deactivated');
          f.onDeactivated();
        },
        dispose: () => {
          calls.push('dispose');
          f.dispose();
        },
      };
      return spied;
    },
  };
  return { load: () => Promise.resolve(module), made: () => made, calls };
}

test('meta: one pack flow per wallet surface', async () => {
  const flows = spiedFlows();
  const gate = deferred<FlowModule>();
  const r = await booted({ loadPurchase: () => gate.promise });
  // A double tap on Buy while the flow module is still loading: one flow, one order.
  r.ctl.buyPack(PACK);
  r.ctl.buyPack(PACK);
  gate.resolve(await flows.load());
  await flush();
  expect(flows.made()).toBe(1);
  expect(r.server.count(INVOICE_LABEL)).toBe(1);
  expect(r.server.sent.find((s) => INVOICE_LABEL.test(s.label))?.body).toEqual({ productId: PACK });
  // The sheet was cancelled: idle again, no toast; the next Buy runs on the same flow.
  expect(r.vm.meta?.purchase).toEqual({ kind: 'failed', reason: 'cancelled' });
  expect(toasts(r)).toEqual([]);
  r.ctl.buyPack(PACK);
  await flush();
  expect([flows.made(), r.server.count(INVOICE_LABEL)]).toEqual([1, 2]);
  // The page's lifecycle reaches the flow, and the controller's end disposes it.
  r.ctl.onLifecycle('deactivated');
  r.ctl.onLifecycle('activated');
  r.ctl.dispose();
  expect(flows.calls).toEqual(['deactivated', 'activated', 'dispose']);
});

test('meta: a stuck pack purchase is checked again from the wallet', async () => {
  // A sheet whose close never arrives (P7): a Buy tap shows the page is back, the order poll frees the flow.
  const flows = spiedFlows();
  const r = await booted({ loadPurchase: flows.load, openInvoice: () => new Promise(() => {}) });
  r.ctl.buyPack(PACK);
  await flush();
  expect(r.vm.meta?.purchase.kind).toBe('sheet');
  expect(r.vm.meta?.busy.wallet).toBe(false);
  r.ctl.buyPack(PACK);
  await flush();
  expect([r.server.count(ORDER_LABEL), r.server.count(INVOICE_LABEL)]).toEqual([1, 1]);
  expect(r.vm.meta?.purchase).toEqual({ kind: 'failed', reason: 'cancelled' });
  r.ctl.buyPack(PACK);
  await flush();
  expect(r.server.count(INVOICE_LABEL)).toBe(2);
  r.ctl.dispose();

  // Paid, but the order is not yet paid when the 30 s window ends (`delayed`): opening the wallet checks again.
  const paid = await booted({ loadPurchase: spiedFlows().load, openInvoice: () => Promise.resolve({ ok: true, value: 'paid' }) });
  paid.server.on(ORDER_LABEL, () => okWire({ orderId: ORDER, productId: PACK, status: 'checkout' }));
  paid.ctl.buyPack(PACK);
  await flush();
  expect(paid.vm.meta?.purchase.kind).toBe('confirming');
  expect(paid.vm.meta?.busy.wallet).toBe(true);
  paid.clock.advance(30_000);
  await flush();
  expect(paid.vm.meta?.purchase.kind).toBe('delayed');
  const wallets = paid.server.count(WALLET_LABEL);
  paid.server.on(ORDER_LABEL, () => okWire({ orderId: ORDER, productId: PACK, status: 'paid' }));
  paid.ctl.openWallet();
  await flush();
  expect(paid.vm.meta?.purchase).toEqual({ kind: 'unlocked', product: PACK });
  // The open's own read, then the credit read after the order turned paid (W2: `unlocked` refreshes the wallet).
  expect(paid.server.count(WALLET_LABEL)).toBe(wallets + 2);
  paid.ctl.buyPack(PACK);
  await flush();
  expect(paid.server.count(INVOICE_LABEL)).toBe(2);
  paid.ctl.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// Links, the share and the lazy chunk (F18, F28, M27)

test('meta: policy opens through openLink from the tap', () => {
  expect(policyUrl('example.test')).toBe(POLICY);
  const r = rig();
  r.ctl.openPolicy();
  // In the same task as the tap: nothing awaited before the facade call.
  expect(r.tg).toEqual([`link:${POLICY}`]);
  r.ctl.dispose();

  const refused = rig({ openLink: () => ({ ok: false, error: { kind: 'unsupported', method: 'openLink' } }) });
  refused.ctl.openPolicy();
  expect(toasts(refused)).toEqual([{ key: 'meta.action_failed', message: t('ru', 'meta.action_failed') }]);
  refused.ctl.dispose();
});

test('meta: share falls back when unsupported', async () => {
  const r = await booted({ native: false });
  r.server.on(SHARE_LABEL, () => okWire(sample('ShareResponse', 1)));
  await r.ctl.share(null);
  expect(r.server.sent.filter((s) => SHARE_LABEL.test(s.label)).map((s) => s.body)).toEqual([
    { storyId: null, lang: 'ru', native: false },
  ]);
  const link = 'https://t.me/novel_dev_bot?startapp=f0123456789abcdef0123456789abcdef';
  expect(r.tg).toEqual([`tgLink:https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Sample: join me')}`]);
  r.ctl.dispose();

  // Native, but the server could not prepare a message: the link as well.
  const unprepared = await booted();
  unprepared.server.on(SHARE_LABEL, () => okWire(sample('ShareResponse', 1)));
  await unprepared.ctl.share(TIDE);
  expect(unprepared.server.sent.find((s) => SHARE_LABEL.test(s.label))?.body).toEqual({ storyId: TIDE, lang: 'ru', native: true });
  expect(unprepared.tg.map((x) => x.split(':')[0])).toEqual(['tgLink']);
  unprepared.ctl.dispose();
});

test('meta: expired prepared message re-prepared once', async () => {
  const r = await booted({ shareMessage: () => Promise.resolve({ ok: false, error: { kind: 'expired' } }) });
  await r.ctl.share(TIDE);
  expect(r.server.count(SHARE_LABEL)).toBe(2);
  expect(r.tg.map((x) => x.split(':')[0])).toEqual(['share', 'share', 'tgLink']);
  r.ctl.dispose();

  // Expired, then sent: no link.
  const answers: Array<Result<void, ShareError>> = [{ ok: false, error: { kind: 'expired' } }, { ok: true, value: undefined }];
  const again = await booted({ shareMessage: () => Promise.resolve(answers.shift() ?? { ok: true, value: undefined }) });
  await again.ctl.share(TIDE);
  expect([again.server.count(SHARE_LABEL), again.tg]).toEqual([2, ['share:dev-prepared-1', 'share:dev-prepared-1']]);
  again.ctl.dispose();
});

test('meta: share errors show their toasts', async () => {
  const cases: ReadonlyArray<readonly [string, Wire, Array<{ key: string; message: string }>]> = [
    ['429', httpError(429, 'rate_limited', 120), [{ key: 'meta.share_wait', message: t('ru', 'meta.share_wait', { minutes: 2 }) }]],
    ['502', httpError(502, 'telegram_unavailable'), [{ key: 'meta.telegram_unavailable', message: t('ru', 'meta.telegram_unavailable') }]],
    ['500', httpError(500, 'internal'), [{ key: 'meta.action_failed', message: t('ru', 'meta.action_failed') }]],
    ['auth', EXPIRED, []],
  ];
  for (const [label, wire, want] of cases) {
    const r = await booted();
    r.server.on(SHARE_LABEL, () => wire);
    await r.ctl.share(null);
    expect(toasts(r), label).toEqual(want);
    expect(r.tg, label).toEqual([]);
    r.ctl.dispose();
  }
  // A send that failed or never reported: the prompt offers the link, which its action opens in its own tap.
  for (const kind of ['send-failed', 'unknown'] as const) {
    const r = await booted({ shareMessage: () => Promise.resolve({ ok: false, error: { kind } }) });
    await r.ctl.share(TIDE);
    const prompt = r.vm.toasts[0];
    expect(prompt?.kind, kind).toBe('prompt');
    expect(prompt?.message, kind).toBe(t('ru', 'meta.share_failed'));
    if (prompt?.kind !== 'prompt') {
      throw new Error('invariant: checked above');
    }
    expect(prompt.actions.map((a) => a.label), kind).toEqual([t('ru', 'meta.share_as_link')]);
    prompt.actions[0].run();
    expect(r.tg.map((x) => x.split(':')[0]), kind).toEqual(['share', 'tgLink']);
    expect(r.vm.toasts, kind).toEqual([]);
    r.ctl.dispose();
  }
  // Declined by the player: nothing.
  const declined = await booted({ shareMessage: () => Promise.resolve({ ok: false, error: { kind: 'declined' } }) });
  await declined.ctl.share(TIDE);
  expect([toasts(declined), declined.tg.length]).toEqual([[], 1]);
  declined.ctl.dispose();
});

test('meta: ui chunk prefetched once after the first line', async () => {
  // Made at the call: a rejection created ahead would be reported unhandled while the test waits.
  const outcomes: Array<() => Promise<MetaUi>> = [() => Promise.reject(new Error('offline'))];
  const r = await booted({ loadUi: () => (outcomes.shift() ?? (() => Promise.resolve(UI)))() });
  r.ctl.lineShown();
  r.ctl.lineShown();
  await flush();
  expect(r.uiLoads()).toBe(1);
  expect(r.vm.meta?.ui).toBeNull();
  // A failed prefetch is not retried per line; the next card tries again, and shows.
  r.ctl.lineShown();
  await flush();
  expect(r.uiLoads()).toBe(1);
  expect((await r.ctl.openCard(MANOR)).ok).toBe(true);
  expect(r.uiLoads()).toBe(2);
  expect(r.vm.meta?.ui).toBe(UI);
  expect(kinds(r)).toEqual(['card']);
  r.ctl.lineShown();
  await flush();
  expect(r.uiLoads()).toBe(2);
  r.ctl.dispose();
});

test('meta: dispose drops late answers', async () => {
  const r = await booted();
  const card = r.server.park(CARD_LABEL);
  const social = r.server.park(SOCIAL_LABEL);
  const opened = r.ctl.openCard(TIDE);
  r.ctl.openFriends();
  await flush();
  const before = r.vm.meta;
  const views = r.views.length;
  r.ctl.dispose();
  card.release();
  social.release(okWire(ACCEPTED));
  await opened;
  await flush();
  expect(r.vm.meta).toBe(before);
  expect(r.views.length).toBe(views);
  expect(everOpen(r, 'card')).toBe(false);

  // A settle pending at the end of the page asks for no card.
  const held = deferred<'drained' | 'timeout'>();
  const ending = await booted({ settle: () => held.promise });
  const done = ending.ctl.onEnding(TIDE);
  ending.ctl.dispose();
  held.resolve('drained');
  await done;
  await flush();
  expect(ending.server.count(CARD_LABEL)).toBe(0);
  // Neither does a flow module that loads after it.
  const flows = spiedFlows();
  const gate = deferred<FlowModule>();
  const late = await booted({ loadPurchase: () => gate.promise });
  late.ctl.buyPack(PACK);
  late.ctl.dispose();
  gate.resolve(await flows.load());
  await flush();
  expect([flows.made(), late.server.count(INVOICE_LABEL)]).toEqual([0, 0]);
});

// ---------------------------------------------------------------------------------------------------------------
// The gift (F25, M22; META-PLAN's resource lifetime: the request id)

const GIFT_LABEL = /^POST \/api\/gifts$/;
const HINT = 'hint' as ResourceKind;
/** A response lost on the way: no server verdict, so the gift may have moved. */
const LOST: Wire = { ok: false, error: { kind: 'network', detail: 'offline' } };

/** A wallet answer holding `balance` hints, no debt. */
const walletWire = (balance: number): Wire =>
  okWire({ balances: [{ kind: 'hint', balance, debt: 0 }], packs: [], hintTierCost: 1, maxPerGift: 3 });

/** The request ids of the gifts sent so far, in order. */
const requestIds = (r: Rig): unknown[] =>
  r.server.sent
    .filter((s) => GIFT_LABEL.test(s.label))
    .map((s) => (typeof s.body === 'object' && s.body !== null ? (s.body as Record<string, unknown>)['requestId'] : null));

test('wallet: gift retry keeps its request id', async () => {
  const r = await booted();
  r.server.on(GIFT_LABEL, () => LOST);
  // A lost answer: the retry resends the id, so the gift moves once (F25); closing the dialog keeps it.
  expect(await r.ctl.gift(ANYA, HINT, 1)).toEqual({ ok: false, error: { kind: 'network' } });
  r.ctl.cancelGift();
  await r.ctl.gift(ANYA, HINT, 1);
  expect(requestIds(r)).toEqual(['id-1', 'id-1']);
  expect(r.server.sent.find((s) => GIFT_LABEL.test(s.label))?.body).toEqual({ to: ANYA, kind: 'hint', amount: 1, requestId: 'id-1' });
  // A definitive answer ends the id: the retry lands, and the next gift of the same body is a new gift.
  r.server.on(GIFT_LABEL, () => okWire(sample('GiftResponse')));
  expect((await r.ctl.gift(ANYA, HINT, 1)).ok).toBe(true);
  await r.ctl.gift(ANYA, HINT, 1);
  expect(requestIds(r)).toEqual(['id-1', 'id-1', 'id-1', 'id-2']);
  // A refusal is definitive as well.
  r.server.on(GIFT_LABEL, () => httpError(429, 'rate_limited', 3600));
  await r.ctl.gift(ANYA, HINT, 1);
  await r.ctl.gift(ANYA, HINT, 1);
  expect(requestIds(r).slice(4)).toEqual(['id-3', 'id-4']);
  // One gift at a time: a second Send while one is answered joins it.
  const held = r.server.park(GIFT_LABEL);
  const first = r.ctl.gift(ANYA, HINT, 2);
  const second = r.ctl.gift(ANYA, HINT, 2);
  await flush();
  expect(second).toBe(first);
  held.release();
  await first;
  expect(requestIds(r).slice(6)).toEqual(['id-5']);
  r.ctl.dispose();
});

test('meta: gift outcome closes the dialog or shows a new error', async () => {
  const r = rig();
  r.server.on(WALLET_LABEL, () => walletWire(3));
  r.ctl.boot();
  await flush();
  r.ctl.openGift(ANYA);
  await flush();
  expect(kinds(r)).toEqual(['gift']);
  // The friend from the list, the kind and the bounds from the wallet: the dialog decides nothing of its own.
  expect(r.vm.meta?.gift).toEqual({ friend: { handle: ANYA, firstName: 'Аня' }, kind: 'hint', balance: 3, maxAmount: 3, error: null, busy: false });

  // Every answer is a new error object, so the dialog's Send opens again even for an equal one.
  r.server.on(GIFT_LABEL, () => httpError(409, 'limit_reached'));
  const held = r.server.park(GIFT_LABEL);
  const sent = r.ctl.gift(ANYA, HINT, 1);
  expect(r.vm.meta?.gift?.busy).toBe(true);
  await flush();
  held.release();
  await sent;
  const first = r.vm.meta?.gift?.error;
  expect([first, r.vm.meta?.gift?.busy]).toEqual([{ kind: 'limit' }, false]);
  await r.ctl.gift(ANYA, HINT, 1);
  expect(r.vm.meta?.gift?.error).toEqual({ kind: 'limit' });
  expect(r.vm.meta?.gift?.error).not.toBe(first);
  expect(kinds(r)).toEqual(['gift']);

  // A lost answer: the gift may have moved, so the wallet is read again once it is done (critique r1 O5), and the
  // dialog's balance is the wallet's state. A changed amount is another gift with its own request id.
  r.server.on(GIFT_LABEL, () => LOST);
  r.server.on(WALLET_LABEL, () => walletWire(2));
  const wallets = r.server.count(WALLET_LABEL);
  await r.ctl.gift(ANYA, HINT, 1);
  await flush();
  expect(r.server.count(WALLET_LABEL)).toBe(wallets + 1);
  expect(r.vm.meta?.gift).toMatchObject({ error: { kind: 'network' }, balance: 2, busy: false });
  await r.ctl.gift(ANYA, HINT, 2);
  await flush();
  expect(requestIds(r).slice(2)).toEqual(['id-3', 'id-4']);

  // 404: unfriended meanwhile, or a retry after the friendship ended (M22 as merged): the wallet and the list again.
  r.server.on(GIFT_LABEL, () => httpError(404, 'not_found'));
  const [w404, s404] = [r.server.count(WALLET_LABEL), r.server.count(SOCIAL_LABEL)];
  await r.ctl.gift(ANYA, HINT, 1);
  await flush();
  expect([r.server.count(WALLET_LABEL), r.server.count(SOCIAL_LABEL)]).toEqual([w404 + 1, s404 + 1]);
  expect(r.vm.meta?.gift?.error).toEqual({ kind: 'not-found' });

  // Sent: the dialog closes and the wallet is read; the balance shown is that read's, not the gift's own answer (1).
  r.server.on(GIFT_LABEL, () => okWire(sample('GiftResponse')));
  r.server.on(WALLET_LABEL, () => walletWire(0));
  const before = r.server.count(WALLET_LABEL);
  expect((await r.ctl.gift(ANYA, HINT, 2)).ok).toBe(true);
  await flush();
  expect(kinds(r)).toEqual([]);
  expect(r.vm.meta?.gift).toBeNull();
  expect(r.server.count(WALLET_LABEL)).toBe(before + 1);
  expect(r.vm.meta?.wallet?.balances).toEqual([{ kind: 'hint', balance: 0, debt: 0 }]);
  r.ctl.dispose();
});
