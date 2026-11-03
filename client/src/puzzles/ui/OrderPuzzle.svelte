<script lang="ts">
  // The `order` puzzle (PUZZLES-PLAN X17): one slot per piece; a tap selects a slot, a tap on another swaps their
  // pieces, a tap on the selected slot deselects it. Selection shows as a thicker border, a ✓ glyph and
  // `aria-pressed`, never colour alone. Each piece shows its item's world glyph beside its name (K46), drawn as the
  // explore UI draws it (data from ui/glyphs.ts, hidden from assistive technology: the name is the button's name).
  // Presentational: the arrangement is the `answer` prop (the piece index per slot) and every swap leaves as a fresh
  // array through `onchange`; only the selection is held here. Params that do not decode as an order puzzle render
  // nothing actionable.
  import { t } from '../../i18n/index.ts';
  import { GLYPH_PATHS, GLYPH_VIEWBOX } from '../../ui/glyphs.ts';
  import type { Glyph } from '../../world/types.ts';
  import type { PuzzleUiProps } from '../registry.ts';
  import { PUZZLE_RULES } from '../rules/index.ts';

  let { params, answer, busy, lang, onchange, item }: PuzzleUiProps = $props();

  const pieces = $derived.by(() => {
    const p = PUZZLE_RULES.order.decodeParams(params);
    return p.ok ? p.value.pieces : null;
  });
  let selected: number | null = $state(null);

  /**
   * The piece's item name in the UI language and its glyph; its id and no glyph if the world has no such item (the
   * story gate refuses that).
   */
  function pieceOf(piece: number): { name: string; glyph: Glyph | null } {
    const id = pieces?.[piece];
    if (id === undefined) {
      return { name: '', glyph: null };
    }
    return item(id) ?? { name: id, glyph: null };
  }

  function tap(slot: number): void {
    if (busy) {
      return;
    }
    const from = selected;
    if (from === null) {
      selected = slot;
      return;
    }
    selected = null;
    const a = answer[from];
    const b = answer[slot];
    if (from === slot || a === undefined || b === undefined) {
      return;
    }
    const next = [...answer];
    next[from] = b;
    next[slot] = a;
    onchange(next);
  }
</script>

{#if pieces !== null}
  <p class="how">{t(lang, 'puzzle.swap')}</p>
  <ol class="slots">
    {#each answer as piece, slot (slot)}
      {@const shown = pieceOf(piece)}
      <li>
        <button
          type="button"
          class="slot"
          class:selected={selected === slot}
          aria-pressed={selected === slot}
          disabled={busy}
          onclick={() => tap(slot)}
        >
          {#if shown.glyph !== null}
            <svg class="glyph" viewBox={GLYPH_VIEWBOX} aria-hidden="true"><path d={GLYPH_PATHS[shown.glyph]} /></svg>
          {/if}
          <span class="name">{shown.name}</span>
          {#if selected === slot}
            <span class="check" aria-hidden="true">✓</span>
          {/if}
        </button>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .how {
    margin: 0 0 8px;
    color: var(--tg-theme-hint-color, #9a9aa6);
    font-size: 14px;
    text-align: center;
  }

  .slots {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .slot {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 72px;
    min-height: 72px;
    padding: 8px;
    border: 1px solid var(--tg-theme-hint-color, #9a9aa6);
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
    font-size: 14px;
    overflow-wrap: anywhere;
  }

  .slot.selected {
    border-width: 4px;
    border-color: var(--tg-theme-button-color, #5aa0ff);
    padding: 5px;
  }

  .slot:disabled {
    opacity: 0.5;
  }

  .glyph {
    flex: none;
    width: 28px;
    height: 28px;
    fill: currentColor;
    fill-rule: evenodd;
  }

  .check {
    position: absolute;
    top: 2px;
    right: 6px;
    font-size: 16px;
  }
</style>
