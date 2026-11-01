<script lang="ts">
  // The hint ladder (PUZZLES-PLAN X18, F8; META-PLAN M21, M27, F24): the unlocked tiers with their texts, the
  // unavailable ones, and - only with a hint port, whose wallet is `ladder.wallet` - the usable tier's "use" button
  // with its cost, the balance, and "get more" while the balance is below the cost. Locked tiers are not shown: the
  // ladder offers only the next usable tier. Without a port (L15) no use button, balance or get more renders; with a
  // cost or balance still unknown (the wallet has not answered) neither the button nor get more does. The texts are
  // the server's, rendered as text. Presentational: every tap calls back at once.
  import { t, type Lang } from '../../i18n/index.ts';
  import type { HintLadderUiView } from '../puzzle-view.svelte.ts';

  type Props = {
    lang: Lang;
    ladder: HintLadderUiView;
    onuse: (tier: number) => void;
    ongetmore: () => void;
  };

  let { lang, ladder, onuse, ongetmore }: Props = $props();

  const uid = $props.id();
  /** The wallet once both its values are known. */
  const wallet = $derived(
    ladder.wallet !== null && ladder.wallet.cost !== null && ladder.wallet.balance !== null
      ? { cost: ladder.wallet.cost, balance: ladder.wallet.balance }
      : null,
  );
  const affordable = $derived(wallet !== null && wallet.balance >= wallet.cost);
  const shownTiers = $derived(ladder.tiers.filter((tier) => tier.state !== 'locked'));
  const getMore = $derived(wallet !== null && !affordable && ladder.tiers.some((tier) => tier.state === 'usable'));
</script>

<section class="ladder" aria-labelledby="{uid}-title">
  <h3 id="{uid}-title">{t(lang, 'hint.title')}</h3>
  {#if ladder.wallet !== null && ladder.wallet.balance !== null}
    <p class="balance">{t(lang, 'hint.balance', { n: ladder.wallet.balance })}</p>
  {/if}
  <ol>
    {#each shownTiers as tier (tier.tier)}
      <li data-state={tier.state}>
        <span class="name">{t(lang, 'hint.tier', { n: tier.tier })}</span>
        {#if tier.state === 'unlocked'}
          <span class="note">{t(lang, 'hint.unlocked')}</span>
          {#if tier.text !== null}
            <p class="text">{tier.text}</p>
          {/if}
        {:else if tier.state === 'unavailable'}
          <span class="note">{t(lang, 'hint.unavailable')}</span>
        {:else if wallet !== null && affordable}
          <button type="button" class="use" disabled={ladder.busy} onclick={() => onuse(tier.tier)}
            >{t(lang, 'hint.use', { n: wallet.cost })}</button
          >
        {/if}
      </li>
    {/each}
  </ol>
  {#if getMore}
    <button type="button" class="more" onclick={() => ongetmore()}>{t(lang, 'hint.get_more')}</button>
  {/if}
  {#if ladder.failed}
    <p class="failed" role="alert">{t(lang, 'hint.failed')}</p>
  {/if}
</section>

<style>
  .ladder {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
  }

  h3,
  ol,
  p {
    margin: 0;
  }

  h3 {
    font-size: 17px;
  }

  ol {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }

  .name {
    font-weight: 600;
  }

  .balance,
  .note {
    color: var(--tg-theme-hint-color, #9a9aa6);
    font-size: 14px;
  }

  .text {
    flex-basis: 100%;
    overflow-wrap: anywhere;
  }

  .failed {
    color: var(--tg-theme-destructive-text-color, #ff6b6b);
  }

  button {
    min-height: 44px;
    padding: 10px 14px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-button-color, #5aa0ff);
    color: var(--tg-theme-button-text-color, #fff);
    font: inherit;
  }

  button:disabled {
    opacity: 0.5;
  }
</style>
