<script lang="ts">
  // The choice list, with "no tap-through" as three rules:
  // (a) pointerdown and click stop here, so a choice tap never reaches the dialogue's tap beneath;
  // (b) a pointer click (detail > 0) counts only after a pointerdown on that same button during this presentation,
  //     which rejects the tap that revealed the choices; a keyboard or assistive-technology click (detail 0) counts;
  // (c) one pick per presentation (`set.id`), so a double tap cannot reach the next set.
  // No timers; haptics on a pick are the caller's.
  import { t, type Lang } from '../i18n/index.ts';
  import type { ChoiceSet } from './state.svelte.ts';

  type Props = { set: ChoiceSet | null; lang: Lang; onchoose: (index: number) => void };

  let { set, lang, onchoose }: Props = $props();

  /** The button a pointer went down on, and in which presentation. */
  let armed: { setId: number; index: number } | null = null;
  /** The presentation already picked from. */
  let pickedSet: number | null = null;

  function pointerDown(e: PointerEvent, index: number): void {
    e.stopPropagation();
    if (set !== null) {
      armed = { setId: set.id, index };
    }
  }

  function pick(e: MouseEvent, index: number): void {
    e.stopPropagation();
    if (set === null || pickedSet === set.id) {
      return;
    }
    const pointerArmed = armed !== null && armed.setId === set.id && armed.index === index;
    if (e.detail > 0 && !pointerArmed) {
      return;
    }
    pickedSet = set.id;
    onchoose(index);
  }
</script>

{#if set !== null}
  <div class="choices" role="group" aria-label={t(lang, 'quick.choose')}>
    {#each set.options as option (option.index)}
      <button
        type="button"
        data-line-id={option.lineId}
        onpointerdown={(e) => pointerDown(e, option.index)}
        onclick={(e) => pick(e, option.index)}>{option.text}</button
      >
    {/each}
  </div>
{/if}

<style>
  .choices {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
    box-sizing: border-box;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 24px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 24px);
  }

  button {
    padding: 14px 16px;
    border: 0;
    border-radius: 14px;
    background: rgb(250 248 255 / 94%);
    color: #111;
    font: inherit;
    font-size: 16px;
    text-align: center;
    user-select: none;
  }
</style>
