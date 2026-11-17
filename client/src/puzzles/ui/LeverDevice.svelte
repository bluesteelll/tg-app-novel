<script lang="ts">
  // The devices `levers` and `setting` (engine plan §7.2, §7.5; GM8a D3, D7, D9, D10): one component for both, which
  // tells them apart by the decoder that accepts its params (their key sets are disjoint). It fills its room's view (a
  // full-bleed root over the host's parts layer, which takes no tap) and lays each part on its rect: room source px
  // through the room's cover (geom/cover.ts, the hotspots' own transform) at the root's measured size, each side grown
  // to PART_MIN_PX around its centre; at a 0 x 0 root, before layout, every part still renders. A lever or a knob is a
  // button and a part (`data-cue-part`, its index), named by its number and its position, a lever by its mark too; the
  // position and the mark are drawn as numerals, never as colour alone. The pull is a button and no part: it is no
  // position of the answer. Presentational: the configuration is the `answer` prop; a throw or a turn computes the next
  // configuration from it and leaves as one fresh array through `onwork` (a coupled throw moves its levers in one call),
  // never `onchange`, and the pull calls `oncommit` once. A levers report is the reach edge's (`puzzles/play/reach.ts`)
  // over the `answer` prop, never a handler's: once per turn to reached, at mount too. Busy disables every part and the
  // pull, and every handler returns first while busy. Every handler is delegated to the mount root, so none outlives the
  // component. Params neither type decodes render nothing actionable.
  import { cover, minTarget, ROOM_SOURCE, toStage } from '../../geom/cover.ts';
  import type { Box } from '../../geom/cover.ts';
  import { mechT } from '../../i18n/mechanics.ts';
  import type { Rect } from '../../story/staging.ts';
  import { LEVERS_PLAY, PART_MIN_PX, throwPart } from '../play/levers.ts';
  import { reachEdge } from '../play/reach.ts';
  import { SETTING_PLAY, turnKnob } from '../play/setting.ts';
  import type { PuzzleUiProps } from '../registry.ts';
  import { PUZZLE_RULES } from '../rules/index.ts';

  let { params, answer, busy, lang, onwork, oncommit, onreach }: PuzzleUiProps = $props();

  const uid = $props.id();
  /** The root's size in CSS px, from its bindings: 0 x 0 until it is laid out. */
  let width = $state(0);
  let height = $state(0);

  const levers = $derived.by(() => {
    const p = PUZZLE_RULES.levers.decodeParams(params);
    return p.ok ? p.value : null;
  });
  const setting = $derived.by(() => {
    const p = PUZZLE_RULES.setting.decodeParams(params);
    return p.ok ? p.value : null;
  });
  const fit = $derived(cover({ w: width, h: height }, ROOM_SOURCE));
  /** Whether the knobs' configuration may be pulled (its shape); whether it opens is the server's. */
  const valid = $derived(setting !== null && SETTING_PLAY.validAnswer(setting, answer));

  /** A part's box: its rect over the room's cover, grown to the least tap target. */
  function boxOf(r: Rect): Box {
    return minTarget(toStage(r, fit), PART_MIN_PX);
  }

  const edge = reachEdge();
  $effect(() => {
    const p = levers;
    const a = answer;
    if (p !== null && edge.step(LEVERS_PLAY.reached(p, a))) {
      onreach?.(LEVERS_PLAY.canonical(p, a));
    }
  });

  function throwLever(part: number): void {
    if (busy || levers === null) {
      return;
    }
    const next = throwPart(levers, answer, part);
    if (next !== null) {
      onwork?.(next, false);
    }
  }

  function turn(part: number): void {
    if (busy || setting === null) {
      return;
    }
    const next = turnKnob(setting, answer, part);
    if (next !== null) {
      onwork?.(next, false);
    }
  }

  function pull(): void {
    if (busy || !valid) {
      return;
    }
    oncommit?.();
  }
</script>

{#if levers !== null || setting !== null}
  <div class="device-parts" role="group" aria-labelledby="{uid}-how" bind:clientWidth={width} bind:clientHeight={height}>
    {#if levers !== null}
      <p class="how" id="{uid}-how">{mechT(lang, 'mech.levers_rule')}</p>
      {#each levers.rects as rect, i (i)}
        {@const box = boxOf(rect)}
        <button
          type="button"
          class="part"
          data-cue="lever"
          data-cue-index={i}
          data-cue-part={i}
          style:left="{box.x}px"
          style:top="{box.y}px"
          style:width="{box.w}px"
          style:height="{box.h}px"
          aria-label={mechT(lang, 'mech.levers_part', { n: i + 1, p: (answer[i] ?? 0) + 1, m: levers.positions, t: (levers.target[i] ?? 0) + 1 })}
          disabled={busy}
          onclick={() => throwLever(i)}
        >
          <span aria-hidden="true">{(answer[i] ?? 0) + 1}</span>
          <span class="mark" aria-hidden="true">{(levers.target[i] ?? 0) + 1}</span>
        </button>
      {/each}
    {:else if setting !== null}
      <p class="how" id="{uid}-how">{mechT(lang, 'mech.setting_rule')}</p>
      {#each setting.rects as rect, i (i)}
        {@const box = boxOf(rect)}
        <button
          type="button"
          class="part"
          data-cue="setting-part"
          data-cue-index={i}
          data-cue-part={i}
          style:left="{box.x}px"
          style:top="{box.y}px"
          style:width="{box.w}px"
          style:height="{box.h}px"
          aria-label={mechT(lang, 'mech.setting_part', { n: i + 1, p: (answer[i] ?? 0) + 1, m: setting.positions })}
          disabled={busy}
          onclick={() => turn(i)}
        >
          <span aria-hidden="true">{(answer[i] ?? 0) + 1}</span>
        </button>
      {/each}
      {@const pullBox = boxOf(setting.pull)}
      <button
        type="button"
        class="pull"
        data-cue="setting-pull"
        style:left="{pullBox.x}px"
        style:top="{pullBox.y}px"
        style:width="{pullBox.w}px"
        style:height="{pullBox.h}px"
        aria-label={mechT(lang, 'mech.setting_pull')}
        disabled={busy || !valid}
        onclick={pull}
      >
        <span aria-hidden="true">↓</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  /* The device fills the host's parts layer, which takes no tap (T34): only the parts and the pull do. A double tap or a
     drag over the device selects no text. */
  .device-parts {
    position: absolute;
    inset: 0;
    pointer-events: none;
    -webkit-user-select: none;
    user-select: none;
  }

  /* The rule line is read, not shown: the device's art shows how it works (GM8d). */
  .how {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* Each on its rect (inline left, top, width, height); a long-press on one opens no iOS callout. Until GM8d's art, a
     framed tile with its position, a lever's mark below it. */
  .part,
  .pull {
    position: absolute;
    pointer-events: auto;
    -webkit-touch-callout: none;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    border: 2px solid var(--tg-theme-hint-color, #9a9aa6);
    border-radius: 8px;
    background: rgb(0 0 0 / 35%);
    color: #fff;
    font: inherit;
    font-size: 18px;
  }

  /* The mark: a smaller numeral in a frame of its own, so the goal is told by more than colour. */
  .mark {
    padding: 0 4px;
    border: 1px solid currentcolor;
    border-radius: 4px;
    font-size: 12px;
  }

  .part:disabled,
  .pull:disabled {
    opacity: 0.5;
  }
</style>
