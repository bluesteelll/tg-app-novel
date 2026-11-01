<script lang="ts">
  // The wallet (META-PLAN M20, M24, F23; PP P1, P2): each balance with its debt, each pack with its server title and
  // its server price verbatim; nothing is computed from prices or amounts (principle 2). Buy needs the terms box,
  // which starts unchecked on every open, and is disabled while a purchase is requested.
  import { mt, type MetaKey } from '../../i18n/meta.ts';
  import type { WalletProps } from './index.ts';

  let { wallet, lang, busy = false, onbuy, onterms }: WalletProps = $props();

  /** The resource kinds with a label in the table; any other kind shows its id. */
  const KIND_LABELS: Readonly<Record<string, MetaKey>> = { hint: 'meta.kind_hint' };

  const uid = $props.id();
  let agreed = $state(false);

  function kindLabel(kind: string): string {
    const key = Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind] : undefined;
    return key === undefined ? kind : mt(lang, key);
  }
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{mt(lang, 'meta.wallet_title')}</h2>
  <ul aria-labelledby="{uid}-title">
    {#each wallet.balances as entry (entry.kind)}
      <li>
        <span>{mt(lang, 'meta.wallet_balance', { kind: kindLabel(entry.kind), n: entry.balance })}</span>
        {#if entry.debt > 0}
          <span class="debt">{mt(lang, 'meta.wallet_debt', { n: entry.debt })}</span>
        {/if}
      </li>
    {/each}
  </ul>
  <h3 id="{uid}-packs">{mt(lang, 'meta.wallet_packs')}</h3>
  <ul aria-labelledby="{uid}-packs">
    {#each wallet.packs as pack (pack.productId)}
      <li>
        <span class="title">{pack.title}</span>
        <button type="button" class="primary" disabled={!agreed || busy} onclick={() => onbuy(pack.productId)}>
          {mt(lang, 'meta.wallet_buy', { stars: pack.priceStars })}
        </button>
      </li>
    {/each}
  </ul>
  <label class="terms">
    <input type="checkbox" bind:checked={agreed} />
    <span>{mt(lang, 'meta.wallet_terms_agree')}</span>
  </label>
  <button type="button" class="link" onclick={() => onterms()}>{mt(lang, 'meta.wallet_terms_link')}</button>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 20px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 20px);
    background: rgb(20 20 24 / 96%);
    color: #fff;
  }

  h2,
  h3,
  ul {
    margin: 0;
  }

  h2 {
    font-size: 20px;
  }

  h3 {
    margin-top: 8px;
    font-size: 16px;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .debt {
    color: #ff8a80;
  }

  .title {
    flex: 1;
    overflow-wrap: anywhere;
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
  }

  button {
    min-height: 44px;
    padding: 10px 16px;
    border: 0;
    border-radius: 12px;
    background: rgb(255 255 255 / 16%);
    color: inherit;
    font: inherit;
  }

  button:disabled {
    opacity: 0.5;
  }

  .primary {
    background: rgb(250 248 255 / 94%);
    color: #111;
  }

  .link {
    align-self: flex-start;
    background: none;
    text-decoration: underline;
  }
</style>
