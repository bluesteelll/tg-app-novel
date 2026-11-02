<script lang="ts">
  // The inventory panel (PUZZLES-PLAN X16; the LX cut D14): the held items with their glyphs, and the documents
  // found, each one re-readable. Presentational: only the open tab is held here, as OrderPuzzle holds its selection.
  import { t } from '../../i18n/index.ts';
  import type { Lang } from '../../i18n/index.ts';
  import type { DocId } from '../../world/types.ts';
  import type { DocView, ItemView } from '../explore-view.svelte.ts';
  import { GLYPH_PATHS, GLYPH_VIEWBOX } from '../glyphs.ts';

  type Props = { lang: Lang; items: readonly ItemView[]; docs: readonly DocView[]; onread: (doc: DocId) => void };

  let { lang, items, docs, onread }: Props = $props();

  let tab: 'items' | 'files' = $state('items');
</script>

<section class="inventory">
  <div class="tabs" role="tablist">
    <button type="button" role="tab" class="tab" aria-selected={tab === 'items'} onclick={() => (tab = 'items')}>
      {t(lang, 'inv.items')}
    </button>
    <button type="button" role="tab" class="tab" aria-selected={tab === 'files'} onclick={() => (tab = 'files')}>
      {t(lang, 'inv.files')}
    </button>
  </div>
  <div class="contents" role="tabpanel">
    {#if tab === 'items'}
      {#if items.length === 0}
        <p class="empty">{t(lang, 'inv.empty')}</p>
      {:else}
        <ul class="rows">
          {#each items as item (item.id)}
            <li class="item">
              <svg class="glyph" viewBox={GLYPH_VIEWBOX} aria-hidden="true"><path d={GLYPH_PATHS[item.glyph]} /></svg>
              <span class="text">
                <span class="name">{item.name}</span>
                <span class="desc">{item.desc}</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if docs.length === 0}
      <p class="empty">{t(lang, 'inv.empty')}</p>
    {:else}
      <ul class="rows">
        {#each docs as doc (doc.id)}
          <li><button type="button" class="doc" onclick={() => onread(doc.id)}>{doc.title}</button></li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  /* Pads itself past the safe area, as every overlay does (Menu.svelte). */
  .inventory {
    box-sizing: border-box;
    height: 100%;
    overflow-y: auto;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 16px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 16px);
    background: var(--tg-theme-bg-color, rgba(16, 16, 20, 0.94));
    color: var(--tg-theme-text-color, #fff);
  }

  .tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .tab {
    flex: 1;
    min-height: 44px;
    border: 1px solid var(--tg-theme-hint-color, #9a9aa6);
    border-radius: 12px;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  /* The open tab: a filled background and a heavier weight, not colour alone. */
  .tab[aria-selected='true'] {
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    font-weight: 600;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .glyph {
    flex: none;
    width: 32px;
    height: 32px;
    fill: currentColor;
    fill-rule: evenodd;
  }

  .text {
    display: flex;
    flex-direction: column;
  }

  .desc {
    color: var(--tg-theme-hint-color, #9a9aa6);
    font-size: 14px;
  }

  .doc {
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
    text-align: start;
  }

  .empty {
    margin: 24px 0;
    color: var(--tg-theme-hint-color, #9a9aa6);
    text-align: center;
  }
</style>
