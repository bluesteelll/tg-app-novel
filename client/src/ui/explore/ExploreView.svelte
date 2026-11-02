<script lang="ts">
  // The explore-ui chunk's root (PUZZLES-PLAN X10, X16; the LX cut D14): one button per hotspot over the stage host,
  // placed in stage-host px by the controller's cover-mapped boxes, so the buttons and the canvas agree by
  // construction; and the bar. Presentational: views in through props, taps out through callbacks. GameSession (L15)
  // mounts it as a child of the Stage host, which is its containing block.
  import { t } from '../../i18n/index.ts';
  import type { ExploreLayerProps } from '../explore-view.svelte.ts';
  import { EXIT_PATH, GLYPH_VIEWBOX } from '../glyphs.ts';

  let { lang, hotspots, reveal, ontap, oninventory, onreveal }: ExploreLayerProps = $props();
</script>

<div class="layer">
  {#each hotspots as h (h.key)}
    <button
      type="button"
      class="hotspot"
      class:revealed={reveal}
      class:done={h.done}
      class:locked={h.locked}
      aria-label={h.label}
      style:left="{h.css.x}px"
      style:top="{h.css.y}px"
      style:width="{h.css.w}px"
      style:height="{h.css.h}px"
      onclick={() => ontap(h.key)}
    >
      {#if h.kind === 'exit'}
        <svg class="exit-glyph" viewBox={GLYPH_VIEWBOX} aria-hidden="true"><path d={EXIT_PATH} /></svg>
      {/if}
    </button>
  {/each}
  <div class="bar">
    <button type="button" class="bar-button" onclick={oninventory}>{t(lang, 'explore.bar_inventory')}</button>
    <button type="button" class="bar-button" onclick={onreveal}>{t(lang, 'explore.bar_reveal')}</button>
  </div>
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
  }

  /* Invisible until revealed: the art shows the place; the button only makes it a 44 px target. */
  .hotspot {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    margin: 0;
    border: 0;
    padding: 0;
    background: transparent;
    color: #fff;
    -webkit-user-select: none;
    user-select: none;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  /* An outline takes no layout space, so revealing moves nothing. */
  .hotspot.revealed {
    outline: 2px dashed rgba(255, 255, 255, 0.9);
    outline-offset: -2px;
  }

  .hotspot.revealed.done {
    outline-style: dotted;
  }

  .hotspot.revealed.locked {
    outline-color: var(--tg-theme-hint-color, #9a9aa6);
  }

  .exit-glyph {
    width: 28px;
    height: 28px;
    fill: currentColor;
    fill-rule: evenodd;
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8));
  }

  .bar {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    justify-content: center;
    gap: 8px;
    padding: 8px calc(var(--app-inset-right, 0px) + 12px) calc(var(--app-inset-bottom, 0px) + 8px)
      calc(var(--app-inset-left, 0px) + 12px);
  }

  .bar-button {
    min-height: 44px;
    padding: 8px 16px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, rgba(42, 42, 50, 0.85));
    color: var(--tg-theme-text-color, #fff);
    font: inherit;
    font-size: 15px;
    touch-action: manipulation;
  }
</style>
