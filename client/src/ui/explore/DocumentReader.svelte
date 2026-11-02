<script lang="ts">
  // The document reader (PUZZLES-PLAN X16; the LX cut D14): a found document's title and paragraphs. Close, or
  // BackButton through the screens stack, returns to the inventory. Presentational.
  import { t } from '../../i18n/index.ts';
  import type { Lang } from '../../i18n/index.ts';
  import type { DocView } from '../explore-view.svelte.ts';

  type Props = { lang: Lang; doc: DocView; onclose: () => void };

  let { lang, doc, onclose }: Props = $props();
</script>

<article class="reader">
  <h2 class="title">{doc.title}</h2>
  {#each doc.body as paragraph, i (i)}
    <p>{paragraph}</p>
  {/each}
  <button type="button" class="close" onclick={onclose}>{t(lang, 'doc.close')}</button>
</article>

<style>
  /* Pads itself past the safe area, as every overlay does (Menu.svelte). */
  .reader {
    box-sizing: border-box;
    height: 100%;
    overflow-y: auto;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 20px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 20px);
    background: var(--tg-theme-bg-color, rgba(16, 16, 20, 0.96));
    color: var(--tg-theme-text-color, #fff);
    line-height: 1.5;
  }

  .title {
    margin: 0 0 12px;
    font-size: 20px;
  }

  p {
    margin: 0 0 12px;
  }

  .close {
    min-height: 44px;
    margin-top: 8px;
    padding: 8px 20px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-button-color, #5aa0ff);
    color: var(--tg-theme-button-text-color, #fff);
    font: inherit;
  }
</style>
