<script lang="ts">
  // The push devices `sequence` and `ritual` (engine plan §7.2, §7.5; GM8b D4, D5, D7, D8, D10): one component for both,
  // which tells them apart by the decoder that accepts its params (their key sets are disjoint). It fills its room's view
  // (a full-bleed root over the host's parts layer, which takes no tap) and lays each part on its rect: room source px
  // through the room's cover (geom/cover.ts, the hotspots' own transform) at the root's measured size, each side grown to
  // PART_MIN_PX around its centre. A part is a button and a part (`data-cue-part`, its index), named by its number, which
  // it shows as a numeral; a line read by a screen reader counts the presses. A part presses at touch (`pointerdown`,
  // its declared trigger: the button sinks at touch), once per activation (A4): the pointer's press arms the part, so the
  // tap's own click presses nothing, while a click with no press before it (Enter, Space, an assistive activation)
  // presses; a key on the part drops a stale arm. Only a primary pointer presses: a mouse's other buttons fire
  // `pointerdown` and no click (B3). Presentational: the presses are the `answer` prop; a press computes
  // the next list from it and leaves as one fresh array through `onwork`, never `onchange`: a right `sequence` press
  // appends, a wrong one resets to `[]` with `wrong` (the device's own wrong, which counts one attempt); a `ritual` press
  // appends and is never wrong (the host posts the full list, `commit: 'full'`; its reply says). A `sequence`
  // report is the reach edge's (`puzzles/play/reach.ts`) over the `answer` prop, never a handler's: once per turn to
  // reached, at mount too. The rule order of a press (D5): busy, nothing; a full answer, `onblocked`; else the type's
  // press. Busy disables every part, and every handler is delegated to the mount root, so none outlives the component.
  // Params neither type decodes render nothing actionable.
  import { cover, minTarget, ROOM_SOURCE, toStage } from '../../geom/cover.ts';
  import type { Box } from '../../geom/cover.ts';
  import { mechT } from '../../i18n/mechanics.ts';
  import type { MechanicsKey } from '../../i18n/mechanics.ts';
  import type { Rect } from '../../story/staging.ts';
  import { reachEdge } from '../play/reach.ts';
  import { pressRitual } from '../play/ritual.ts';
  import { PART_MIN_PX, pressSequence, SEQUENCE_PLAY } from '../play/sequence.ts';
  import type { PuzzleUiProps } from '../registry.ts';
  import { PUZZLE_RULES } from '../rules/index.ts';

  let { params, answer, busy, lang, onwork, onreach, onblocked }: PuzzleUiProps = $props();

  const uid = $props.id();
  /** The root's size in CSS px, from its bindings: 0 x 0 until it is laid out. */
  let width = $state(0);
  let height = $state(0);

  const sequence = $derived.by(() => {
    const p = PUZZLE_RULES.sequence.decodeParams(params);
    return p.ok ? p.value : null;
  });
  const ritual = $derived.by(() => {
    const p = PUZZLE_RULES.ritual.decodeParams(params);
    return p.ok ? p.value : null;
  });
  /** What both types draw alike: the parts' rects, the full answer's length and the rule line; null for neither type. */
  const device = $derived.by((): { readonly rects: readonly Rect[]; readonly len: number; readonly rule: MechanicsKey } | null => {
    if (sequence !== null) {
      return { rects: sequence.rects, len: PUZZLE_RULES.sequence.answerShape(sequence).len, rule: 'mech.sequence_rule' };
    }
    if (ritual !== null) {
      return { rects: ritual.rects, len: PUZZLE_RULES.ritual.answerShape(ritual).len, rule: 'mech.ritual_rule' };
    }
    return null;
  });
  const fit = $derived(cover({ w: width, h: height }, ROOM_SOURCE));

  /** A part's box: its rect over the room's cover, grown to the least tap target. */
  function boxOf(r: Rect): Box {
    return minTarget(toStage(r, fit), PART_MIN_PX);
  }

  const edge = reachEdge();
  $effect(() => {
    const p = sequence;
    const a = answer;
    if (p !== null && edge.step(SEQUENCE_PLAY.reached(p, a))) {
      onreach?.(SEQUENCE_PLAY.canonical(p, a));
    }
  });

  /**
   * A press of part `part`, by D5's order, the one busy decision of every input: busy takes nothing and answers false; a
   * full answer refuses it (`onblocked`); else the type's press.
   */
  function press(part: number): boolean {
    if (busy || device === null) {
      return false;
    }
    if (answer.length >= device.len) {
      onblocked?.(part);
      return true;
    }
    if (sequence !== null) {
      const next = pressSequence(sequence, answer, part);
      if (next !== null) {
        onwork?.(next.work, next.wrong);
      }
    } else if (ritual !== null) {
      const next = pressRitual(ritual, answer, part);
      if (next !== null) {
        onwork?.(next, false);
      }
    }
    return true;
  }

  /** The part a pointer pressed whose own click is still to come: that click is the tap's, no press. Never rendered. */
  let armed: number | null = null;

  /** A pointer down on part `part`: a primary pointer presses, and arms the part unless busy took nothing. */
  function down(part: number, e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    if (press(part)) {
      armed = part;
    }
  }

  /** A click on part `part`: the armed part's own (a tap's) presses nothing; any other presses, whatever its `detail`. */
  function click(part: number): void {
    const own = armed === part;
    armed = null;
    if (!own) {
      press(part);
    }
  }

  /** A key on a part: a stale arm (a pointer that left the part) never swallows the keyboard's click. */
  function disarm(): void {
    armed = null;
  }
</script>

{#if device !== null}
  <div class="device-parts" role="group" aria-labelledby="{uid}-how" bind:clientWidth={width} bind:clientHeight={height}>
    <p class="how" id="{uid}-how">{mechT(lang, device.rule)}</p>
    <p class="how" role="status">{mechT(lang, 'mech.button_progress', { k: answer.length, n: device.len })}</p>
    {#each device.rects as rect, i (i)}
      {@const box = boxOf(rect)}
      <button
        type="button"
        class="part"
        data-cue="push"
        data-cue-on="pointerdown"
        data-cue-index={i}
        data-cue-part={i}
        style:left="{box.x}px"
        style:top="{box.y}px"
        style:width="{box.w}px"
        style:height="{box.h}px"
        aria-label={mechT(lang, 'mech.button_part', { n: i + 1 })}
        disabled={busy}
        onpointerdown={(e) => down(i, e)}
        onclick={() => click(i)}
        onkeydown={disarm}
      >
        <span aria-hidden="true">{i + 1}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  /* The device fills the host's parts layer, which takes no tap (T34): only the parts do. A double tap or a drag over the
     device selects no text. */
  .device-parts {
    position: absolute;
    inset: 0;
    pointer-events: none;
    -webkit-user-select: none;
    user-select: none;
  }

  /* The rule and progress lines are read, not shown: the device's art shows how it works (GM8d). */
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
     framed tile with its number. */
  .part {
    position: absolute;
    pointer-events: auto;
    -webkit-touch-callout: none;
    box-sizing: border-box;
    display: flex;
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

  .part:disabled {
    opacity: 0.5;
  }
</style>
