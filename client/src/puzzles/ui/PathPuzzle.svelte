<script lang="ts">
  // The `path` puzzle (engine plan §7.2, §8.3; GM7p D8): one line from end to end through every open cell. The grid is
  // one surface of square cells in row-major order, each a part (`data-cue-part`); an open cell is a button named by its
  // row and column (an end says so), pressed while the line holds it, a blocked cell is no button. The ends carry a
  // knob and the drawn cells a tint, with the line drawn through their centres, so nothing relies on colour alone.
  // Presentational: the line is the `answer` prop, and every step leaves as a fresh array through `onchange`; the line's
  // end is always the prop's last cell. A cell's activation steps as `touch` does. The report is the reach edge's
  // (`puzzles/play/reach.ts`) over the `answer` prop, never a handler's: once per turn to reached, the canonical form.
  // Params that do not decode as a path puzzle render nothing actionable.
  import { mechT } from '../../i18n/mechanics.ts';
  import { PATH_PLAY, touch } from '../play/path.ts';
  import { reachEdge } from '../play/reach.ts';
  import type { PuzzleUiProps } from '../registry.ts';
  import { PUZZLE_RULES } from '../rules/index.ts';

  let { params, answer, busy, lang, onchange, onreach }: PuzzleUiProps = $props();

  const uid = $props.id();
  const grid = $derived.by(() => {
    const p = PUZZLE_RULES.path.decodeParams(params);
    return p.ok ? p.value : null;
  });
  const cells = $derived(grid === null ? [] : Array.from({ length: grid.cols * grid.rows }, (_, i) => i));
  /** The drawn line through the cells' centres, in grid units (the SVG's viewBox). */
  const points = $derived(grid === null ? '' : answer.map((c) => `${(c % grid.cols) + 0.5},${Math.floor(c / grid.cols) + 0.5}`).join(' '));

  const edge = reachEdge();
  $effect(() => {
    const g = grid;
    const a = answer;
    if (g !== null && edge.step(PATH_PLAY.reached(g, a))) {
      onreach?.(PATH_PLAY.canonical(g, a));
    }
  });

  function nameOf(cell: number): string {
    if (grid === null) {
      return '';
    }
    const at = { r: Math.floor(cell / grid.cols) + 1, c: (cell % grid.cols) + 1 };
    return mechT(lang, grid.ends.includes(cell) ? 'mech.path_end' : 'mech.path_cell', at);
  }

  /** A cell's own activation (a keyboard or an assistive press): one step as a touch on that cell. */
  function press(cell: number): void {
    if (grid === null || busy) {
      return;
    }
    const next = touch(grid, answer, cell);
    if (next !== null) {
      onchange(next);
    }
  }
</script>

{#if grid !== null}
  <p class="how" id="{uid}-rule">{mechT(lang, 'mech.path_rule')}</p>
  <div
    class="surface"
    role="group"
    aria-labelledby="{uid}-rule"
    data-cue-gesture="path-stroke"
    style:touch-action="none"
    style:aspect-ratio="{grid.cols} / {grid.rows}"
    style:grid-template-columns="repeat({grid.cols}, 1fr)"
    style:grid-template-rows="repeat({grid.rows}, 1fr)"
  >
    {#each cells as cell (cell)}
      {#if grid.blocked.includes(cell)}
        <span class="cell blocked" aria-hidden="true" data-cue-part={cell}></span>
      {:else}
        <button
          type="button"
          class="cell"
          class:end={grid.ends.includes(cell)}
          class:drawn={answer.includes(cell)}
          data-cue="path-cell"
          data-cue-index={cell}
          data-cue-part={cell}
          aria-label={nameOf(cell)}
          aria-pressed={answer.includes(cell)}
          disabled={busy}
          onclick={() => press(cell)}
        >
          {#if grid.ends.includes(cell)}
            <span class="knob" aria-hidden="true"></span>
          {/if}
        </button>
      {/if}
    {/each}
    <svg class="line" viewBox="0 0 {grid.cols} {grid.rows}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  </div>
{/if}

<style>
  .how {
    margin: 0 0 8px;
    color: var(--tg-theme-hint-color, #9a9aa6);
    font-size: 14px;
    text-align: center;
  }

  /* The surface box is the grid box: no padding, no border and no gap, so a point's share of the box is its cell. */
  .surface {
    position: relative;
    display: grid;
    width: 100%;
    max-width: 336px;
    margin: 0 auto;
    padding: 0;
    border: 0;
    gap: 0;
  }

  .cell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  /* The gutter is drawn inside each cell: the tile is inset, the cell box itself has no gap. */
  .cell::before {
    content: '';
    position: absolute;
    inset: 3px;
    border: 1px solid var(--tg-theme-hint-color, #9a9aa6);
    border-radius: 8px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
  }

  .cell.drawn::before {
    border-width: 2px;
    border-color: var(--tg-theme-button-color, #5aa0ff);
  }

  /* The drawn tint: the button colour at 30 % over the tile. */
  .cell.drawn::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 8px;
    background: var(--tg-theme-button-color, #5aa0ff);
    opacity: 0.3;
  }

  .cell.blocked::before {
    border-style: dashed;
    background: transparent;
    opacity: 0.4;
  }

  .cell:disabled {
    opacity: 0.5;
  }

  .knob {
    position: relative;
    width: 40%;
    height: 40%;
    border: 2px solid currentColor;
    border-radius: 50%;
    background: var(--tg-theme-button-color, #5aa0ff);
  }

  .line {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .line polyline {
    fill: none;
    stroke: var(--tg-theme-button-color, #5aa0ff);
    stroke-width: 0.12;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
