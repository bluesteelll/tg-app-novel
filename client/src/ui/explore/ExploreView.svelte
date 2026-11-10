<script lang="ts">
  // The explore-ui chunk's root (PUZZLES-PLAN X10, X16; the LX cut D14): one button per hotspot over the stage host,
  // placed in stage-host px by the controller's cover-mapped boxes, so the buttons and the canvas agree by
  // construction; the bar; and the panel GameSession opens over them (`panel`, in step with the screens stack). The
  // inventory stays mounted under the document reader, so Back returns to the tab it was on. Presentational: views
  // in through the view store, read where they are used (never copied, so each write shows), taps out through
  // callbacks. GameSession (L15) mounts it as a child of the Stage host, which is its containing block. Its root is the
  // explore family's cue root (engine plan §8.3), attached in an effect (RULINGS 201 E1: a `use:` action would bring
  // Svelte's action runtime into the entry): its controls emit to the session's bus, and the cue stage plays its
  // entrance and exit; the sheets carry their panel markers (§8.5 "Cue targets"). GM3u (§6.1 UI, §8.3): every control
  // declares the cue it emits (`cues/controls.test.ts`), a hotspot that paints nothing is a hit area, and the item
  // ribbon sits over the rooms while no panel covers them; a hotspot tapped while an item is selected uses that item.
  // Under the hotspots, the bare-art catcher (§8.3 "The catcher") answers a tap on the art itself: its cue ripples at the
  // finger, and it puts a selected item back.
  import { cueRoot, SHEET_PANELS } from '../../cues/root.ts';
  import { t } from '../../i18n/index.ts';
  import type { ExploreLayerProps } from '../explore-view.svelte.ts';
  import { EXIT_PATH, GLYPH_VIEWBOX } from '../glyphs.ts';
  import DocumentReader from './DocumentReader.svelte';
  import Inventory from './Inventory.svelte';
  import LockPanel from './LockPanel.svelte';
  import Ribbon from './Ribbon.svelte';

  let { lang, view, actions }: ExploreLayerProps = $props();

  /** The document the reader shows; null when the panel names no document the inventory holds. */
  const reading = $derived.by(() => {
    const p = view.panel;
    return p?.kind === 'doc' ? (view.docs.find((d) => d.id === p.doc) ?? null) : null;
  });
  const inventoryOpen = $derived(view.panel?.kind === 'inventory' || view.panel?.kind === 'doc');
  /** A panel covers the rooms: their buttons leave the tab order and the accessibility tree. */
  const covered = $derived(inventoryOpen || (view.panel?.kind === 'lock' && view.lock !== null));

  /** A tap on the bare art puts a selected item back (§6.1 UI); with none selected it is only its cue. */
  const onbare = (): void => {
    if (view.selected != null) {
      actions.ondeselect();
    }
  };

  let root: HTMLDivElement | undefined = $state();
  let cues: ReturnType<typeof cueRoot> | undefined;
  // Attached once per root element: a new emit must not re-attach it (that would re-stamp the root's birth).
  $effect(() => {
    const el = root;
    if (el === undefined) {
      return;
    }
    const r = cueRoot(el, undefined);
    cues = r;
    return () => {
      cues = undefined;
      r.destroy();
    };
  });
  // The emit: the session's bus, which yields writes into the view. Reads the root too, so it runs after a re-attach.
  $effect(() => {
    if (root !== undefined) {
      cues?.update(view.oncue);
    }
  });
</script>

<div class="layer" bind:this={root} data-cue-root>
  <div class="room" inert={covered}>
    <!-- First in the room and with no z-index, so every hotspot paints and takes taps above it, to its edge. -->
    <div class="bare" role="presentation" data-cue="bare-art" data-cue-hit onclick={onbare}></div>
    {#each view.hotspots as h (h.key)}
      <button
        type="button"
        class="hotspot"
        class:revealed={view.reveal}
        class:done={h.done}
        class:locked={h.locked}
        aria-label={h.label}
        data-cue="hotspot"
        data-cue-hit={h.kind !== 'exit' && !view.reveal ? '' : undefined}
        style:left="{h.css.x}px"
        style:top="{h.css.y}px"
        style:width="{h.css.w}px"
        style:height="{h.css.h}px"
        onclick={() => (view.selected != null ? actions.onuse(view.selected, h.key) : actions.ontap(h.key))}
      >
        {#if h.kind === 'exit'}
          <svg class="exit-glyph" viewBox={GLYPH_VIEWBOX} aria-hidden="true"><path d={EXIT_PATH} /></svg>
        {/if}
      </button>
    {/each}
    {#if !covered}
      <Ribbon {lang} items={view.items} selected={view.selected ?? null} onselect={actions.onselect} ondeselect={actions.ondeselect} />
    {/if}
    <div class="bar">
      <button type="button" class="bar-button" data-cue="bar-inventory" onclick={actions.oninventory}>{t(lang, 'explore.bar_inventory')}</button>
      <button type="button" class="bar-button" data-cue="bar-reveal" onclick={actions.onreveal}>{t(lang, 'explore.bar_reveal')}</button>
    </div>
  </div>
  {#if inventoryOpen}
    <div class="sheet" data-cue-panel={SHEET_PANELS.inventory} inert={reading !== null}>
      <Inventory {lang} items={view.items} docs={view.docs} onread={actions.onread} />
    </div>
  {/if}
  {#if reading !== null}
    <div class="sheet" data-cue-panel={SHEET_PANELS.reader}>
      <DocumentReader {lang} doc={reading} onclose={actions.onclose} />
    </div>
  {/if}
  {#if view.panel?.kind === 'lock' && view.lock !== null}
    <div class="sheet" data-cue-panel={SHEET_PANELS.lock}>
      <LockPanel {lang} lock={view.lock} items={view.items} oninsert={actions.oninsert} />
    </div>
  {/if}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
  }

  /* A panel covers the rooms; the panels pad themselves past the safe area. Its backdrop holds the rooms dimmed while it
     stays open: the panel-open cue's stage dim ends with the cue (§8.5). */
  .sheet {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
  }

  /* The bare-art catcher: the whole room, painting nothing; the hotspots and the ribbon lie above it. */
  .bare {
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
