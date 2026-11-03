// The wallet and the hint port (META-PLAN M19-M21, "Module API"). Every number is a server answer: `GET /api/wallet`
// or a hint use's answer. Nothing is decremented, computed or stored on the client (principle 1), and a hint text is
// handed to the puzzle session, never kept here (PZ X7).
import type { WalletResponse } from '../api/generated/api.ts';
import { metaError } from '../api/meta.ts';
import type { MetaEndpoints, MetaError } from '../api/meta.ts';
import type { Lang } from '../i18n/index.ts';
import type { HintPort } from '../puzzles/session.ts';
import type { Result } from '../story/catalog.ts';
import type { ProductId } from '../story/staging.ts';

/** A resource kind of the server's economy catalog, e.g. `hint`. A local brand: staging.ts names none. */
export type ResourceKind = string & { readonly __brand: 'ResourceKind' };

/** META-PLAN `WalletView`: balances with debt (M20) and the packs with the server's prices, titles in one language. */
export type WalletView = {
  balances: ReadonlyArray<{ kind: ResourceKind; balance: number; debt: number }>;
  packs: ReadonlyArray<{ productId: ProductId; kind: ResourceKind; amount: number; priceStars: number; title: string }>;
  hintTierCost: number;
  /** The most units one gift moves (the gift dialog's bound); only a wallet answer carries it, a hint use keeps it. */
  maxPerGift: number;
};

export interface WalletService {
  /** The last applied server state; null before the first answer. */
  state(): WalletView | null;
  /** Pack titles follow `lang()` as of each answer. */
  refresh(): Promise<Result<WalletView, MetaError>>;
  /** The puzzle session's port: `getMore` calls `open` (the wallet overlay). */
  hintPort(open: () => void): HintPort;
}

const HINT = 'hint';

export function createWalletService(api: Pick<MetaEndpoints, 'getWallet' | 'useHint'>, o: { lang: () => Lang }): WalletService {
  // Calls are numbered at issue (cut D6). The packs and the cost come from the newest-issued wallet answer applied;
  // the hint balance from the newest-issued answer of either kind, so a wallet answer that was issued before a hint
  // use and arrives after it never puts back the balance before the use.
  let issued = 0;
  let base: WalletView | null = null;
  let baseSeq = 0;
  let hint: number | null = null;
  let hintSeq = 0;
  let view: WalletView | null = null;

  function publish(): void {
    view = base === null || hint === null ? base : withHint(base, hint);
  }

  return {
    state: () => view,
    async refresh() {
      const seq = ++issued;
      const r = await api.getWallet();
      if (!r.ok) {
        return { ok: false, error: metaError(r.error) };
      }
      const next = walletView(r.value, o.lang());
      // `hintSeq >= baseSeq` always, so an answer too old for the packs is too old for the balance as well.
      if (seq > baseSeq) {
        base = next;
        baseSeq = seq;
        if (seq > hintSeq) {
          // No `hint` entry: the balance is unknown, never an invented 0.
          hint = next.balances.find((b) => b.kind === HINT)?.balance ?? null;
          hintSeq = seq;
        }
        publish();
      }
      return { ok: true, value: next };
    },
    hintPort(open) {
      return {
        balance: () => hint,
        tierCost: () => view?.hintTierCost ?? null,
        async use(puzzle, tier, lang) {
          const seq = ++issued;
          const r = await api.useHint(puzzle, tier, lang);
          if (!r.ok) {
            return { ok: false, error: metaError(r.error) };
          }
          if (seq > hintSeq) {
            hint = r.value.balance;
            hintSeq = seq;
            publish();
          }
          return { ok: true, value: { text: r.value.text, balance: r.value.balance } };
        },
        getMore: () => open(),
      };
    },
  };
}

/** The server's kinds and pack order as sent (the catalog's, LE1 D5 / D6): no client sort. */
function walletView(w: WalletResponse, lang: Lang): WalletView {
  // The kinds and product ids are the server's own, sent back only as they came: the brands are asserted here.
  return {
    balances: w.balances.map((b) => ({ kind: b.kind as ResourceKind, balance: b.balance, debt: b.debt })),
    packs: w.packs.map((p) => ({
      productId: p.productId as ProductId,
      kind: p.kind as ResourceKind,
      amount: p.amount,
      priceStars: p.priceStars,
      title: p.title[lang],
    })),
    hintTierCost: w.hintTierCost,
    maxPerGift: w.maxPerGift,
  };
}

function withHint(v: WalletView, balance: number): WalletView {
  return { ...v, balances: v.balances.map((b) => (b.kind === HINT ? { ...b, balance } : b)) };
}
