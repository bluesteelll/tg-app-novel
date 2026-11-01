<script lang="ts">
  // The puzzle frame (PUZZLES-PLAN X8, X14, X17, F6, F7): the title, the prompt, the type UI from `frame.ui`, Try,
  // the status line, the attempts left, Hint, Give up with its confirmation (a linear puzzle that allows it), a load
  // failure with Retry, and the hint ladder while `ladder` is set. Presentational: GameSession writes the frame and
  // answers every callback; no timer lives here (the 429 countdown is GameSession's). There is no close button: an
  // exploration puzzle closes with BackButton, a linear one has none (`backScreen`). A new `frame.id` re-mounts the
  // type UI. Give up asks in place and keeps Yes out of Give up's place (RULINGS 60, I1): the question and No fill the
  // block that held Give up and Yes gets a block of its own below it, so a double tap on Give up never gives up; Yes
  // answers once per question.
  import { t } from '../../i18n/index.ts';
  import type { PuzzleHostProps } from '../puzzle-view.svelte.ts';
  import HintLadder from './HintLadder.svelte';

  let { lang, frame, ladder, item, onchange, ontry, ongiveup, onhint, onretry, onusehint, ongetmore }: PuzzleHostProps =
    $props();

  const uid = $props.id();
  /** The frame whose Give up is asking; a new frame never inherits the question. */
  let askingFor: number | null = $state(null);

  const ended = $derived(frame !== null && (frame.line === 'solved' || frame.line === 'failed'));
  const waiting = $derived(frame !== null && frame.retryAfter !== null && frame.retryAfter > 0);
  const canTry = $derived(frame !== null && frame.ui !== null && !frame.busy && !ended && !waiting);
  const canGiveUp = $derived(frame !== null && frame.mode === 'linear' && frame.giveUp && !ended);
  const asking = $derived(frame !== null && askingFor === frame.id);

  const status = $derived.by((): string => {
    if (frame === null) {
      return '';
    }
    switch (frame.line) {
      case 'idle':
        return '';
      case 'checking':
        return t(lang, 'puzzle.checking');
      case 'wrong':
        return t(lang, 'puzzle.wrong');
      case 'solved':
        return t(lang, 'puzzle.solved');
      case 'failed':
        return t(lang, 'puzzle.failed');
      case 'offline':
        return t(lang, 'puzzle.offline');
      case 'rate-limited':
        return t(lang, 'puzzle.rate_limited', { s: frame.retryAfter ?? 0 });
      default: {
        const never: never = frame.line;
        return never;
      }
    }
  });

  function ask(): void {
    askingFor = frame?.id ?? null;
  }

  function giveUp(): void {
    if (!asking) {
      return; // the second tap of a double tap on Yes
    }
    askingFor = null;
    ongiveup();
  }
</script>

{#if frame !== null}
  <section class="frame" aria-labelledby="{uid}-title">
    <h2 id="{uid}-title">{frame.title}</h2>
    <p class="prompt">{frame.prompt}</p>
    <div class="body">
      {#if frame.loadFailed}
        <p class="failed" role="alert">{t(lang, 'puzzle.load_failed')}</p>
        <button type="button" onclick={() => onretry()}>{t(lang, 'puzzle.retry')}</button>
      {:else if frame.ui !== null}
        {@const Ui = frame.ui}
        {#key frame.id}
          <Ui params={frame.params} answer={frame.answer} busy={frame.busy || ended} {lang} {onchange} {item} />
        {/key}
      {/if}
    </div>
    <p class="status" role="status">{status}</p>
    {#if frame.attemptsLeft !== null}
      <p class="attempts">{t(lang, 'puzzle.attempts_left', { n: frame.attemptsLeft })}</p>
    {/if}
    <div class="actions">
      <button type="button" class="primary" disabled={!canTry} onclick={() => ontry()}>{t(lang, 'puzzle.try')}</button>
      {#if frame.hintTiers > 0}
        <button type="button" onclick={() => onhint()}>{t(lang, 'puzzle.hint')}</button>
      {/if}
    </div>
    {#if canGiveUp}
      <div class="give-up">
        {#if asking}
          <div class="actions">
            <p class="ask">{t(lang, 'puzzle.give_up_confirm')}</p>
            <button type="button" onclick={() => (askingFor = null)}>{t(lang, 'saves.no')}</button>
          </div>
          <div class="actions">
            <button type="button" class="danger" onclick={giveUp}>{t(lang, 'puzzle.give_up_yes')}</button>
          </div>
        {:else}
          <div class="actions">
            <button type="button" onclick={ask}>{t(lang, 'puzzle.give_up')}</button>
          </div>
        {/if}
      </div>
    {/if}
    {#if ladder !== null}
      <HintLadder {lang} {ladder} onuse={(tier) => onusehint(tier)} ongetmore={() => ongetmore()} />
    {/if}
  </section>
{/if}

<style>
  .frame {
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
  }

  h2 {
    font-size: 20px;
  }

  .prompt,
  .ask {
    overflow-wrap: anywhere;
  }

  /* The controls sit in the lower half (X17): the body takes the free space above them. */
  .body {
    display: flex;
    flex: 1 0 auto;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
  }

  .status,
  .attempts {
    min-height: 1.25em;
    color: var(--tg-theme-hint-color, #9a9aa6);
    font-size: 14px;
    text-align: center;
  }

  .failed {
    color: var(--tg-theme-destructive-text-color, #ff6b6b);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .give-up {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  button {
    min-height: 48px;
    padding: 12px 16px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
    font-size: 16px;
    white-space: nowrap;
  }

  .primary {
    flex: 1;
    background: var(--tg-theme-button-color, #5aa0ff);
    color: var(--tg-theme-button-text-color, #fff);
  }

  .danger {
    color: var(--tg-theme-destructive-text-color, #ff6b6b);
  }

  button:disabled {
    opacity: 0.5;
  }
</style>
