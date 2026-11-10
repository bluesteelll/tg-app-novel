<script lang="ts">
  // The item ribbon (engine plan §6.1 UI, §8.1 point 9; GM3u): one slot per held item, above the bar, while the rooms
  // are shown. A tap on a slot selects its item, a tap on the selected slot deselects it; a hotspot tapped while an
  // item is selected uses it there (ExploreView routes it). Presentational: the selection is GameSession's (yields
  // writes it). Its root is the live ribbon the cue stage looks for (`data-cue-ribbon`), each slot its item's target
  // (`data-cue-item`, §8.5 "Cue targets"), keyed by item id, so a slot that leaves is never reused for a neighbour.
  import type { Lang } from '../../i18n/index.ts';
  import { mechT } from '../../i18n/mechanics.ts';
  import type { ItemId } from '../../world/types.ts';
  import type { ItemView } from '../explore-view.svelte.ts';
  import { GLYPH_PATHS, GLYPH_VIEWBOX } from '../glyphs.ts';

  type Props = {
    lang: Lang;
    items: readonly ItemView[];
    selected: ItemId | null;
    onselect: (item: ItemId) => void;
    ondeselect: () => void;
  };

  let { lang, items, selected, onselect, ondeselect }: Props = $props();
</script>

<div class="ribbon" role="group" aria-label={mechT(lang, 'mech.ribbon')} data-cue-ribbon>
  {#each items as item (item.id)}
    <button
      type="button"
      class="ribbon-item"
      aria-label={item.name}
      aria-pressed={selected === item.id}
      data-cue="ribbon-item"
      data-cue-item={item.id}
      onclick={() => (selected === item.id ? ondeselect() : onselect(item.id))}
    >
      <svg class="glyph" viewBox={GLYPH_VIEWBOX} aria-hidden="true"><path d={GLYPH_PATHS[item.glyph]} /></svg>
    </button>
  {/each}
</div>

<style>
  /* Above the bar (its 44 px buttons and 8 px padding on each side), past the safe area; only the slots take taps, so the
     room's hotspots beside them stay reachable. */
  .ribbon {
    position: absolute;
    right: 0;
    bottom: calc(var(--app-inset-bottom, 0px) + 60px);
    left: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    padding: 0 calc(var(--app-inset-right, 0px) + 12px) 8px calc(var(--app-inset-left, 0px) + 12px);
    pointer-events: none;
  }

  .ribbon-item {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 56px;
    height: 56px;
    margin: 0;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, rgba(42, 42, 50, 0.85));
    color: var(--tg-theme-text-color, #fff);
    pointer-events: auto;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  /* The selected item: a solid ring, not colour alone. */
  .ribbon-item[aria-pressed='true'] {
    border-color: var(--tg-theme-button-color, #5aa0ff);
  }

  .glyph {
    width: 32px;
    height: 32px;
    fill: currentColor;
    fill-rule: evenodd;
  }
</style>
