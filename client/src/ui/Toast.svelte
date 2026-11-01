<script module lang="ts">
  import type { ToastEntry } from './state.svelte.ts';

  /** The entries to render: a `dev` banner only where the dev mock is compiled in, every other entry always. */
  export function visibleToasts(entries: readonly ToastEntry[], devEnabled: boolean): readonly ToastEntry[] {
    return devEnabled ? entries : entries.filter((e) => e.kind !== 'dev');
  }
</script>

<script lang="ts">
  // The toast stack. Every handler is synchronous and stops the click, so a toast tap never reaches the dialogue
  // under it, and the sound chip's tap is the gesture that resumes audio.
  import { t, type Lang } from '../i18n/index.ts';

  type Props = { toasts: readonly ToastEntry[]; lang: Lang; ondismiss: (key: string) => void };

  let { toasts, lang, ondismiss }: Props = $props();

  // The one dev gate: false in production, where a tag error is dropped and logged instead (F2).
  const shown = $derived(visibleToasts(toasts, __TG_MOCK__));

  function dismiss(e: MouseEvent, key: string): void {
    e.stopPropagation();
    ondismiss(key);
  }
</script>

<div class="toasts" aria-live="polite">
  {#each shown as entry (entry.key)}
    {#if entry.kind === 'prompt'}
      <div class="toast" data-variant="prompt">
        <span>{entry.message}</span>
        <span class="actions">
          {#each entry.actions as action, i (i)}
            <button
              type="button"
              onclick={(e) => {
                e.stopPropagation();
                action.run();
                ondismiss(entry.key);
              }}>{action.label}</button
            >
          {/each}
        </span>
      </div>
    {:else if entry.kind === 'chip'}
      <button
        type="button"
        class="toast"
        data-variant="chip"
        onclick={(e) => {
          e.stopPropagation();
          entry.tap();
        }}>{entry.message}</button
      >
    {:else if entry.kind === 'note' && entry.sticky}
      <div class="toast" data-variant="note">
        <span>{entry.message}</span>
        <button type="button" class="close" aria-label={t(lang, 'toast.close')} onclick={(e) => dismiss(e, entry.key)}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    {:else}
      <button type="button" class="toast" data-variant={entry.kind} onclick={(e) => dismiss(e, entry.key)}
        >{entry.message}</button
      >
    {/if}
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    inset: 0 0 auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: calc(var(--app-inset-top, 0px) + 8px) calc(var(--app-inset-right, 0px) + 8px) 0
      calc(var(--app-inset-left, 0px) + 8px);
    pointer-events: none;
    z-index: 10;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    border: 0;
    border-radius: 12px;
    background: rgb(20 20 24 / 92%);
    color: #fff;
    font: inherit;
    font-size: 14px;
    text-align: left;
    pointer-events: auto;
  }

  .toast[data-variant='dev'] {
    background: #8a1c1c;
    font-family: monospace;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .actions button,
  .close {
    padding: 6px 10px;
    border: 0;
    border-radius: 8px;
    background: rgb(255 255 255 / 16%);
    color: inherit;
    font: inherit;
  }
</style>
