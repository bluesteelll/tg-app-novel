<script lang="ts">
  // The lock panel (PUZZLES-PLAN X16, F7 step 5; the LX cut D14): the lock's slots, each filled with its item or
  // empty, and the held items to try in it. A refused insert says "doesn't fit" in an alert and changes nothing.
  // Presentational: the controller decides what fits.
  import { t } from '../../i18n/index.ts';
  import type { Lang } from '../../i18n/index.ts';
  import type { HotspotKey, ItemId } from '../../world/types.ts';
  import type { ItemView, LockView } from '../explore-view.svelte.ts';
  import { GLYPH_PATHS, GLYPH_VIEWBOX } from '../glyphs.ts';

  type Props = {
    lang: Lang;
    lock: LockView;
    items: readonly ItemView[];
    oninsert: (key: HotspotKey, item: ItemId) => void;
  };

  let { lang, lock, items, oninsert }: Props = $props();
</script>

<section class="lock">
  <h2 class="title">{lock.title}</h2>
  <p class="locked">{lock.locked}</p>
  <ol class="slots">
    {#each lock.slots as slot, i (i)}
      <li class="slot" class:filled={slot !== null}>
        {#if slot === null}
          <span class="empty">{t(lang, 'lock.slot_empty')}</span>
        {:else}
          <svg class="glyph" viewBox={GLYPH_VIEWBOX} aria-hidden="true"><path d={GLYPH_PATHS[slot.glyph]} /></svg>
          <span class="name">{slot.name}</span>
        {/if}
      </li>
    {/each}
  </ol>
  {#if lock.refused}
    <p class="no-fit" role="alert">{t(lang, 'lock.no_fit')}</p>
  {/if}
  <ul class="held">
    {#each items as item (item.id)}
      <li>
        <button type="button" class="held-item" onclick={() => oninsert(lock.key, item.id)}>
          <svg class="glyph" viewBox={GLYPH_VIEWBOX} aria-hidden="true"><path d={GLYPH_PATHS[item.glyph]} /></svg>
          <span class="name">{item.name}</span>
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  /* Pads itself past the safe area: the held items sit low, above the home indicator (critique O5). */
  .lock {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 16px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 16px);
    background: var(--tg-theme-bg-color, rgba(16, 16, 20, 0.94));
    color: var(--tg-theme-text-color, #fff);
  }

  .title {
    margin: 0 0 4px;
    font-size: 20px;
  }

  .locked {
    margin: 0 0 16px;
    color: var(--tg-theme-hint-color, #9a9aa6);
  }

  .slots,
  .held {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* An empty slot is dashed, a filled one solid: the state is not told by colour alone. */
  .slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    box-sizing: border-box;
    min-width: 72px;
    min-height: 72px;
    padding: 8px;
    border: 2px dashed var(--tg-theme-hint-color, #9a9aa6);
    border-radius: 12px;
    font-size: 14px;
  }

  .slot.filled {
    border-style: solid;
  }

  .empty {
    color: var(--tg-theme-hint-color, #9a9aa6);
  }

  .no-fit {
    margin: 12px 0 0;
    text-align: center;
  }

  .held {
    margin-top: auto;
    padding-top: 16px;
  }

  .held-item {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 8px 12px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
    touch-action: manipulation;
  }

  .glyph {
    flex: none;
    width: 28px;
    height: 28px;
    fill: currentColor;
    fill-rule: evenodd;
  }
</style>
