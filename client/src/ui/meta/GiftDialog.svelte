<script lang="ts">
  // The gift dialog (META-PLAN M22, F25): an amount from 1 up to the balance and the per-gift maximum, both server
  // numbers; the daily caps are the server's and arrive only as an error. Send emits once per submit: a latch that
  // only a new error releases (on success the controller closes the dialog). Send also follows rule (b) of
  // Choices.svelte: a pointer click counts only after a pointerdown on it while the dialog is shown, so the tap that
  // opened the dialog gives nothing away; a keyboard click (detail 0) counts (critique W5).
  import { mt } from '../../i18n/meta.ts';
  import type { GiftProps, ShownError } from './index.ts';

  let { friend, balance, maxAmount, error, lang, busy = false, onsend, oncancel }: GiftProps = $props();

  const uid = $props.id();
  /** The amount the player stepped to; what is shown and sent is bounded by `max` below. */
  let chosen = $state(1);
  /** A pointer went down on Send while the dialog is shown. */
  let armed = false;
  /** This submit was sent; only a new error re-opens Send. */
  let sent = $state(false);

  const max = $derived(maxAmount === null ? balance : Math.min(balance, maxAmount));
  // Clamped on every read, so a balance that drops while the dialog is open bounds the amount again.
  const amount = $derived(Math.max(1, Math.min(chosen, max)));
  const notes = $derived(noteTexts(error, max));

  $effect(() => {
    // A new answer from the server (a new error object) ends the submit: the player may retry.
    if (error !== null) {
      sent = false;
    }
  });

  /** What the dialog says: no balance to give, then the server's answer; each text once. */
  function noteTexts(e: ShownError | null, limit: number): string[] {
    const out: string[] = [];
    if (limit < 1) {
      out.push(mt(lang, 'meta.gift_insufficient'));
    }
    if (e !== null) {
      out.push(...errorTexts(e));
    }
    return [...new Set(out)];
  }

  function errorTexts(e: ShownError): string[] {
    switch (e.kind) {
      case 'limit':
        return [mt(lang, 'meta.gift_capped')];
      case 'rate-limited':
        return e.retryAfter !== undefined && Number.isFinite(e.retryAfter) && e.retryAfter > 0
          ? [mt(lang, 'meta.gift_capped'), mt(lang, 'meta.gift_retry', { hours: Math.ceil(e.retryAfter / 3600) })]
          : [mt(lang, 'meta.gift_capped')];
      case 'insufficient':
        return [mt(lang, 'meta.gift_insufficient')];
      case 'not-found':
        return [mt(lang, 'meta.gift_not_friend')];
      case 'network':
      case 'auth':
      case 'unavailable':
        return [mt(lang, 'meta.error_retry')];
      default: {
        const unhandled: never = e.kind;
        throw new Error(`invariant: unhandled gift error ${String(unhandled)}`);
      }
    }
  }

  function send(e: MouseEvent): void {
    if (sent || busy || max < 1) {
      return;
    }
    if (e.detail > 0 && !armed) {
      return;
    }
    armed = false;
    sent = true;
    onsend(amount);
  }
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{mt(lang, 'meta.gift_title', { name: friend.firstName })}</h2>
  <div class="stepper">
    <button type="button" aria-label={mt(lang, 'meta.gift_less')} disabled={amount <= 1} onclick={() => (chosen = amount - 1)}
      >−</button
    >
    <output>{mt(lang, 'meta.gift_amount', { n: amount })}</output>
    <button
      type="button"
      aria-label={mt(lang, 'meta.gift_more')}
      disabled={amount >= max}
      onclick={() => (chosen = Math.min(amount + 1, max))}>+</button
    >
  </div>
  {#if notes.length > 0}
    <div class="notes" role="alert">
      {#each notes as note (note)}
        <p>{note}</p>
      {/each}
    </div>
  {/if}
  <div class="actions">
    <button type="button" onclick={() => oncancel()}>{mt(lang, 'meta.cancel')}</button>
    <button
      type="button"
      class="primary"
      disabled={sent || busy || max < 1}
      onpointerdown={() => (armed = true)}
      onclick={send}>{mt(lang, 'meta.gift_send')}</button
    >
  </div>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
  p {
    margin: 0;
  }

  h2 {
    font-size: 20px;
    overflow-wrap: anywhere;
  }

  .stepper {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .stepper button {
    min-width: 44px;
    font-size: 22px;
    line-height: 1;
  }

  output {
    min-width: 8ch;
    text-align: center;
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: #ff8a80;
    font-size: 14px;
  }

  .actions {
    display: flex;
    gap: 8px;
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
</style>
