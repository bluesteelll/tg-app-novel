<script lang="ts">
  // The `code` lock (PUZZLES-PLAN X17): one column per dial, each 0-9; ▲ and ▼ step a dial and wrap (9 -> 0, 0 -> 9).
  // Presentational: the digits are the `answer` prop, and every step leaves as a fresh array through `onchange`, so
  // nothing is held here. The step buttons are at least 48 × 48 CSS px (principle 5). Params that do not decode as a
  // code lock render nothing actionable.
  import { t } from '../../i18n/index.ts';
  import type { PuzzleUiProps } from '../registry.ts';
  import { PUZZLE_RULES } from '../rules/index.ts';

  let { params, answer, busy, lang, onchange }: PuzzleUiProps = $props();

  const DIGITS = 10;

  const dials = $derived.by(() => {
    const p = PUZZLE_RULES.code.decodeParams(params);
    return p.ok ? Array.from({ length: p.value.dials }, (_, i) => i) : [];
  });

  function step(dial: number, by: 1 | -1): void {
    if (busy) {
      return;
    }
    const next = dials.map((i) => answer[i] ?? 0);
    next[dial] = ((next[dial] ?? 0) + by + DIGITS) % DIGITS;
    onchange(next);
  }
</script>

{#if dials.length > 0}
  <div class="lock">
    {#each dials as dial (dial)}
      <div class="dial">
        <button type="button" class="step" aria-label={t(lang, 'puzzle.dial_up')} disabled={busy} onclick={() => step(dial, 1)}
          >▲</button
        >
        <span class="digit">{answer[dial] ?? 0}</span>
        <button type="button" class="step" aria-label={t(lang, 'puzzle.dial_down')} disabled={busy} onclick={() => step(dial, -1)}
          >▼</button
        >
      </div>
    {/each}
  </div>
{/if}

<style>
  .lock {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .dial {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .step {
    min-width: 48px;
    min-height: 48px;
    padding: 0;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
    font-size: 20px;
  }

  .step:disabled {
    opacity: 0.5;
  }

  .digit {
    min-width: 48px;
    font-size: 32px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
</style>
