<script lang="ts">
  // The `path` puzzle (engine plan §7.2, §8.3; GM7p D8-D10): one line from end to end through every open cell. The
  // grid is one surface of square cells in row-major order, each a part (`data-cue-part`); an open cell is a button
  // named by its row and column (an end says so), pressed while the line holds it, a blocked cell is no button. The ends
  // carry a knob and the drawn cells a tint, with the line drawn through their centres, so nothing relies on colour
  // alone. Presentational: the line is the `answer` prop, and every step leaves as a fresh array through `onchange`; the
  // line's end is always the prop's last cell, never the stroke's. The report is the reach edge's
  // (`puzzles/play/reach.ts`) over the `answer` prop, never a handler's: once per turn to reached, the canonical form.
  // Params that do not decode as a path puzzle render nothing actionable.
  //
  // The stroke (D9): the surface takes the pointer's capture at a down and reads every pointer event by its
  // coordinates over its own box in visual px (so the column's `transform: scale` cancels out), never by the event's
  // target. A down touches the cell under it; each move enters every cell its segment crosses, each through `advance`,
  // with one `path-stroke` cue per accepted step and at most one `onchange` per event, only when its steps leave a line
  // that differs from the prop by content (V2 per event: its steps can cancel out). The cells take no pointer events, so
  // a tap is one step on every engine and its click lands on the surface, which handles none; a cell's own click is a
  // keyboard or an assistive press. A stroke is live while the surface holds its pointer's capture: an up releases it,
  // and the user agent releases it right after a cancel (Pointer Events 3 §4.1.3.3), which ends the stroke with no
  // listener of its own (D9a: a cancel attribute is no delegated event, and its runtime would join the entry chunk).
  // Every handler is delegated to the mount root, so none outlives the component.
  import { mechT } from '../../i18n/mechanics.ts';
  import { PATH_PLAY, advance, cellAt, cellsAlong, touch } from '../play/path.ts';
  import type { GridPoint } from '../play/path.ts';
  import { reachEdge } from '../play/reach.ts';
  import type { PuzzleUiProps } from '../registry.ts';
  import { PUZZLE_RULES } from '../rules/index.ts';

  let { params, answer, busy, lang, onchange, onreach, oncue }: PuzzleUiProps = $props();

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

  /** The surface (bound inside the decoded block, so it comes and goes with it); read by the pointer handlers only. */
  let surface: HTMLElement | undefined = $state();
  /** The stroke: its pointer and its last point in grid units; null between strokes. No render reads it. */
  let stroke: { readonly id: number; last: GridPoint } | null = null;

  /** The live stroke: one whose pointer the surface still captures (an up or the user agent's release ends it). */
  function live(): boolean {
    return stroke !== null && surface !== undefined && surface.hasPointerCapture(stroke.id);
  }

  /** The event's point in grid units over the surface's box, or null without a usable box. */
  function pointOf(e: PointerEvent): GridPoint | null {
    if (grid === null || surface === undefined) {
      return null;
    }
    const r = surface.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0 && Number.isFinite(r.width) && Number.isFinite(r.height))) {
      return null;
    }
    return { x: ((e.clientX - r.left) / r.width) * grid.cols, y: ((e.clientY - r.top) / r.height) * grid.rows };
  }

  function down(e: PointerEvent): void {
    // A pointer cannot go down twice without an up or a cancel: its earlier stroke ended unseen (a recycled id).
    if (stroke !== null && stroke.id === e.pointerId) {
      stroke = null;
    }
    // Busy, a mouse's other buttons, or a second pointer while a stroke is live: no stroke.
    if (grid === null || surface === undefined || busy || (e.pointerType === 'mouse' && e.button !== 0) || live()) {
      return;
    }
    const at = pointOf(e);
    const cell = at === null ? null : cellAt(grid, at.x, at.y);
    if (at === null || cell === null) {
      return;
    }
    const next = touch(grid, answer, cell);
    // A stroke starts where it can draw: on a cell it steps to, or on the line's end.
    if (next === null && cell !== answer.at(-1)) {
      return;
    }
    stroke = { id: e.pointerId, last: at };
    surface.setPointerCapture(e.pointerId);
    if (next !== null) {
      oncue?.('path-stroke', cell);
      onchange(next);
    }
  }

  function move(e: PointerEvent): void {
    if (grid === null || stroke === null || e.pointerId !== stroke.id || busy || !live()) {
      return;
    }
    const at = pointOf(e);
    if (at === null) {
      return;
    }
    // The steps run on a local copy: the prop updates between events, never within one.
    let a = answer;
    for (const cell of cellsAlong(grid, stroke.last, at)) {
      const next = advance(grid, a, cell);
      if (next !== null) {
        a = next;
        oncue?.('path-stroke', cell);
      }
    }
    stroke.last = at;
    // By content, not by reference: `advance` returns a fresh array per step, so a back onto the previous cell and the
    // way in again leave a new array equal to the prop, which is no change (V2).
    if (a.length !== answer.length || a.some((c, i) => c !== answer[i])) {
      onchange(a);
    }
  }

  function up(e: PointerEvent): void {
    if (stroke === null || e.pointerId !== stroke.id) {
      return;
    }
    stroke = null;
    if (surface?.hasPointerCapture(e.pointerId) === true) {
      surface.releasePointerCapture(e.pointerId);
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
    bind:this={surface}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
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

  /* No pointer event targets a cell: every hit, a tap's click included, is the surface's on every engine (CQ-c). */
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
    pointer-events: none;
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
