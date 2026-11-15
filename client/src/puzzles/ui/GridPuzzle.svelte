<script lang="ts">
  // The `grid` puzzle (engine plan §7.2; GM7g D5-D7): fill every cell with a symbol so that no symbol is twice in a row
  // or a column, the given cells kept. A tap selects a free cell (a tap on it again deselects it); a tap on a palette
  // symbol puts that symbol on the selected cell, Clear (symbol 0) empties it, and the cell stays selected so it can be
  // corrected. Each cell is a button and a part (`data-cue-part`, cell-major), named by its row, its column and what it
  // holds; a given cell is a disabled button named as given, so a tap on it is refused silently. The selection shows as
  // `aria-pressed` and a thicker border, never colour alone; it is held here only, kept across a reset of the answer
  // while it names a free cell of the decoded grid. Presentational: the fill is the `answer` prop, and every change
  // leaves as a fresh array through `onchange`, only when it changes a cell (V2: `place` refuses a no-change). The
  // report is the reach edge's (`puzzles/play/reach.ts`) over the `answer` prop, never a handler's: once per turn to
  // reached. Busy (an attempt in flight) disables every button. Every handler is delegated to the mount root, so none
  // outlives the component. Params that do not decode as a grid puzzle render nothing actionable.
  import { mechT } from '../../i18n/mechanics.ts';
  import { GRID_PLAY, place } from '../play/grid.ts';
  import { reachEdge } from '../play/reach.ts';
  import type { PuzzleUiProps } from '../registry.ts';
  import { PUZZLE_RULES } from '../rules/index.ts';

  let { params, answer, busy, lang, onchange, onreach }: PuzzleUiProps = $props();

  const uid = $props.id();
  const grid = $derived.by(() => {
    const p = PUZZLE_RULES.grid.decodeParams(params);
    return p.ok ? p.value : null;
  });
  const cells = $derived(grid === null ? [] : Array.from({ length: grid.rows * grid.cols }, (_, i) => i));
  /** Clear (0), then each symbol. */
  const symbols = $derived(grid === null ? [] : Array.from({ length: grid.symbols + 1 }, (_, v) => v));

  /** The cell the player picked; it selects only while it is a free cell of the decoded grid. */
  let picked: number | null = $state(null);
  const selected = $derived(grid !== null && picked !== null && grid.given[picked] === 0 ? picked : null);

  const edge = reachEdge();
  $effect(() => {
    const g = grid;
    const a = answer;
    if (g !== null && edge.step(GRID_PLAY.reached(g, a))) {
      onreach?.(GRID_PLAY.canonical(g, a));
    }
  });

  function isGiven(cell: number): boolean {
    return grid !== null && grid.given[cell] !== 0;
  }

  function nameOf(cell: number): string {
    if (grid === null) {
      return '';
    }
    const at = { r: Math.floor(cell / grid.cols) + 1, c: (cell % grid.cols) + 1, n: answer[cell] ?? 0 };
    return mechT(lang, isGiven(cell) ? 'mech.grid_given' : at.n === 0 ? 'mech.grid_empty' : 'mech.grid_cell', at);
  }

  function pick(cell: number): void {
    if (busy || grid === null || isGiven(cell)) {
      return;
    }
    picked = selected === cell ? null : cell;
  }

  function put(v: number): void {
    if (busy || grid === null || selected === null) {
      return;
    }
    const next = place(grid, answer, selected, v);
    if (next !== null) {
      onchange(next);
    }
  }
</script>

{#if grid !== null}
  <p class="how" id="{uid}-rule">{mechT(lang, 'mech.grid_rule')}</p>
  <div class="board" role="group" aria-labelledby="{uid}-rule">
    <div class="cells" style:grid-template-columns="repeat({grid.cols}, minmax(48px, 1fr))">
      {#each cells as cell (cell)}
        <button
          type="button"
          class="cell"
          class:given={isGiven(cell)}
          class:selected={selected === cell}
          data-cue="grid-cell"
          data-cue-index={cell}
          data-cue-part={cell}
          aria-label={nameOf(cell)}
          aria-pressed={selected === cell}
          disabled={busy || isGiven(cell)}
          onclick={() => pick(cell)}
        >
          {answer[cell] || ''}
        </button>
      {/each}
    </div>
    <div class="palette">
      {#each symbols as v (v)}
        <button
          type="button"
          class="symbol"
          data-cue="grid-symbol"
          data-cue-index={v}
          aria-label={v === 0 ? mechT(lang, 'mech.grid_clear') : null}
          disabled={busy || selected === null}
          onclick={() => put(v)}
        >
          <!-- Each branch an element: a branch of bare text would compile to a runtime helper no lazy chunk imports yet,
               one more export of the entry chunk. -->
          {#if v === 0}
            <span aria-hidden="true">×</span>
          {:else}
            <span>{v}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .how {
    margin: 0 0 8px;
    color: var(--tg-theme-hint-color, #9a9aa6);
    font-size: 14px;
    text-align: center;
  }

  /* The cells and the palette: a mouse's double click or drag over them leaves no text selection. */
  .board {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    -webkit-user-select: none;
    user-select: none;
  }

  /* Six 48 px columns and five 4 px gaps are 308 px, inside the 320 px content box of the 360 px design column. */
  .cells {
    display: grid;
    gap: 4px;
    max-width: 336px;
  }

  .palette {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px;
  }

  .cell,
  .symbol {
    min-width: 48px;
    min-height: 48px;
    margin: 0;
    padding: 0;
    border: 1px solid var(--tg-theme-hint-color, #9a9aa6);
    border-radius: 8px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
    font-size: 20px;
  }

  /* A given cell: its symbol bold on a muted tile. */
  .cell.given {
    font-weight: 700;
    background: transparent;
  }

  .cell.selected {
    border-width: 3px;
    border-color: var(--tg-theme-button-color, #5aa0ff);
  }

  .cell:disabled:not(.given),
  .symbol:disabled {
    opacity: 0.5;
  }
</style>
