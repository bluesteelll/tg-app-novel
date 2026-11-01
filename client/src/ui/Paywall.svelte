<script lang="ts">
  // The paywall (PROTOTYPE-PLAN P1-P8). It shows the purchase state it is given and never grants, prices or buys:
  // `priceStars` is the server's price, shown verbatim; Buy asks the caller (`onbuy`), whose flow creates the invoice;
  // `unlocked` comes only from the flow's server reads. Buy needs the terms box (P1), which starts unchecked on every
  // mount, and is disabled while the invoice is being created (P2). `sheet` and `delayed` offer Check again (a lost
  // `invoice_closed`, P7). A failed price read replaces the form with Retry. The failed-payment toast is the caller's.
  import { t, type Lang, type UiKey } from '../i18n/index.ts';
  import type { PurchaseState } from '../purchase/flow.ts';

  type Props = {
    chapter: string;
    priceStars: number | null;
    state: PurchaseState;
    lang: Lang;
    onbuy: () => void;
    oncheckagain: () => void;
    onterms: () => void;
    onretry: () => void;
  };

  // `state` is bound as `purchase`: a local named `state` would make `$state` read as a store subscription.
  let { chapter, priceStars, state: purchase, lang, onbuy, oncheckagain, onterms, onretry }: Props = $props();

  /** What one state shows: the form (box, Terms, Buy) with an optional error, or a status line instead of it. */
  type View = { kind: 'form'; note: UiKey | null; busy: boolean } | { kind: 'status'; note: UiKey; checkAgain: boolean };
  type FailReason = Extract<PurchaseState, { kind: 'failed' }>['reason'];

  const uid = $props.id();
  let agreed = $state(false);
  const view = $derived(viewOf(purchase));

  function viewOf(s: PurchaseState): View {
    switch (s.kind) {
      case 'idle':
        return { kind: 'form', note: null, busy: false };
      case 'requesting':
        return { kind: 'form', note: null, busy: true };
      case 'sheet':
        return { kind: 'status', note: 'paywall.sheet', checkAgain: true };
      case 'confirming':
        return { kind: 'status', note: 'paywall.confirming', checkAgain: false };
      case 'delayed':
        return { kind: 'status', note: 'paywall.delayed', checkAgain: true };
      case 'unlocked':
        return { kind: 'status', note: 'paywall.unlocked', checkAgain: false };
      case 'failed':
        return failedView(s.reason);
      default: {
        const unhandled: never = s;
        throw new Error(`invariant: unhandled purchase state ${JSON.stringify(unhandled)}`);
      }
    }
  }

  function failedView(reason: FailReason): View {
    switch (reason) {
      case 'cancelled':
      case 'failed':
        return { kind: 'form', note: null, busy: false };
      case 'network':
        return { kind: 'form', note: 'paywall.error_network', busy: false };
      case 'telegram':
        return { kind: 'form', note: 'paywall.error_telegram', busy: false };
      case 'unknown-product':
        return { kind: 'status', note: 'paywall.unavailable', checkAgain: false };
      default: {
        const unhandled: never = reason;
        throw new Error(`invariant: unhandled purchase failure ${String(unhandled)}`);
      }
    }
  }

  function buy(): void {
    if (view.kind !== 'form' || view.busy || !agreed || priceStars === null) {
      return;
    }
    onbuy();
  }
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{chapter}</h2>
  <p>{t(lang, 'paywall.body')}</p>
  {#if view.kind === 'status'}
    <p class="note" role="status">{t(lang, view.note)}</p>
    {#if view.checkAgain}
      <button type="button" onclick={() => oncheckagain()}>{t(lang, 'paywall.check_again')}</button>
    {/if}
  {:else if priceStars === null}
    <p class="note error" role="alert">{t(lang, 'paywall.load_failed')}</p>
    <button type="button" onclick={() => onretry()}>{t(lang, 'paywall.retry')}</button>
  {:else}
    {#if view.note !== null}
      <p class="note error" role="alert">{t(lang, view.note)}</p>
    {/if}
    <label class="terms">
      <input type="checkbox" bind:checked={agreed} />
      <span>{t(lang, 'paywall.terms_agree')}</span>
    </label>
    <button type="button" class="link" onclick={() => onterms()}>{t(lang, 'paywall.terms_link')}</button>
    <button type="button" class="primary" disabled={!agreed || view.busy} onclick={buy}
      >{t(lang, 'paywall.buy', { n: priceStars })}</button
    >
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 20px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 20px);
    background: var(--tg-theme-bg-color, #17171c);
    color: var(--tg-theme-text-color, #fff);
  }

  h2,
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  h2 {
    font-size: 20px;
  }

  .note {
    color: var(--tg-theme-hint-color, #9a9aa6);
  }

  .error {
    color: var(--tg-theme-destructive-text-color, #ff8a80);
  }

  .terms {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }

  .terms input {
    width: 22px;
    height: 22px;
    margin: 0;
    accent-color: var(--tg-theme-button-color, #6c5ce7);
  }

  button {
    min-height: 44px;
    padding: 10px 16px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
  }

  button:disabled {
    opacity: 0.5;
  }

  .primary {
    background: var(--tg-theme-button-color, #6c5ce7);
    color: var(--tg-theme-button-text-color, #fff);
  }

  .link {
    align-self: flex-start;
    padding: 10px 0;
    background: none;
    color: var(--tg-theme-link-color, var(--tg-theme-button-color, #8ab4ff));
    text-decoration: underline;
  }
</style>
