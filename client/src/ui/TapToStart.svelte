<script lang="ts">
  // Home's frame (STORIES-PLAN Y14): Continue for the newest autosave, and the story cards as children. The click
  // handler calls back first and synchronously, so the caller's unlockAudio() runs inside the tap (principle 5);
  // making the handler single-shot is the caller's (F1 step 5).
  import type { Snippet } from 'svelte';

  import { t, type Lang } from '../i18n/index.ts';

  type Props = { lang: Lang; continueLabel: string | null; oncontinue: () => void; children?: Snippet };

  let { lang, continueLabel, oncontinue, children }: Props = $props();
</script>

<section class="home">
  {#if continueLabel !== null}
    <button type="button" class="continue" onclick={() => oncontinue()}
      >{t(lang, 'tap.continue_story', { story: continueLabel })}</button
    >
  {/if}
  {@render children?.()}
</section>

<style>
  .home {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-end;
    gap: 16px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 16px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 16px);
    overflow-y: auto;
    background: #000;
    color: #fff;
    user-select: none;
  }

  .continue {
    padding: 16px;
    border: 0;
    border-radius: 14px;
    background: #fff;
    color: #000;
    font: inherit;
    font-size: 18px;
  }
</style>
