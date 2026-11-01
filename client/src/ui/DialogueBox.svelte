<script lang="ts">
  // The dialogue box (F2 "Tap"): one typewriter per mounted box. A tap during the reveal completes the line and
  // nothing else; any other tap is `onadvance`, which the caller routes to the scene or the story. The line's end
  // reaches `ondone` in a microtask, never inside this component's effects, and never after a newer line or unmount.
  import { untrack } from 'svelte';

  import { t, type Lang } from '../i18n/index.ts';
  import type { LineView } from './state.svelte.ts';
  import { browserFrameClock, createTypewriter, type FrameClock, type TextSpeed, type Typewriter } from './typewriter.ts';

  type Props = {
    line: LineView | null;
    speed: TextSpeed;
    reducedMotion: boolean;
    paused: boolean;
    lang: Lang;
    onadvance: () => void;
    ondone?: () => void;
    clock?: FrameClock;
  };

  let { line, speed, reducedMotion, paused, lang, onadvance, ondone, clock }: Props = $props();

  let shownEl: HTMLSpanElement | undefined = $state();
  let restEl: HTMLSpanElement | undefined = $state();
  let typewriter: Typewriter | null = null;
  /** The line the typewriter was last started with; `undefined` before the first start. */
  let started: LineView | null | undefined = undefined;
  /** The reveal in progress; a reported end counts only while it is still this one. */
  let current: object | null = null;

  function finished(): void {
    const ended = current;
    if (ended === null) {
      return;
    }
    queueMicrotask(() => {
      if (ended === current) {
        ondone?.();
      }
    });
  }

  // Mount: the typewriter lives as long as the box. Its clock is read once: a new identity is no new box.
  $effect(() => {
    if (shownEl === undefined || restEl === undefined) {
      return;
    }
    const tw = createTypewriter(
      { shown: shownEl, rest: restEl },
      { clock: untrack(() => clock) ?? browserFrameClock(), onDone: finished },
    );
    typewriter = tw;
    return () => {
      current = null;
      typewriter = null;
      tw.destroy();
    };
  });

  // Each new line restarts the reveal; the speed and motion settings apply from the next line on. The effect can
  // re-run for the same line (a parent re-rendering its props), which must not restart it.
  $effect(() => {
    const next = line;
    untrack(() => {
      if (typewriter === null || next === started) {
        return;
      }
      started = next;
      current = next === null ? null : {};
      typewriter.start(next?.text ?? '', { speed, reducedMotion });
      if (paused) {
        typewriter.pause();
      }
    });
  });

  // The panel left the foreground (`deactivated`) or came back.
  $effect(() => {
    const hold = paused;
    untrack(() => (hold ? typewriter?.pause() : typewriter?.resume()));
  });

  function tap(): void {
    if (typewriter !== null && typewriter.running()) {
      typewriter.complete();
    } else {
      onadvance();
    }
  }
</script>

<div class="dialogue" data-line-id={line?.lineId} hidden={line === null}>
  <button type="button" class="tap" aria-label={t(lang, 'quick.advance')} onclick={tap}>
    {#if line !== null && line.speaker !== null}
      <span class="speaker">{line.speaker}</span>
    {/if}
    <span class="text"><span data-reveal="shown" bind:this={shownEl}></span><span
        class="rest"
        data-reveal="rest"
        bind:this={restEl}
      ></span></span
    >
  </button>
  <p class="live" aria-live="polite">
    {#if line !== null}
      {#if line.speaker !== null}<span>{line.speaker}</span>{/if}
      <span>{line.text}</span>
    {/if}
  </p>
</div>

<style>
  .dialogue {
    position: absolute;
    inset: auto 0 0 0;
    padding: 0 calc(var(--app-inset-right, 0px) + 12px) calc(var(--app-inset-bottom, 0px) + 12px)
      calc(var(--app-inset-left, 0px) + 12px);
  }

  .dialogue[hidden] {
    display: none;
  }

  .tap {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    min-height: 120px;
    box-sizing: border-box;
    padding: 14px 16px;
    border: 0;
    border-radius: 14px;
    background: rgb(12 12 16 / 86%);
    color: #fff;
    font: inherit;
    font-size: 17px;
    line-height: 1.45;
    text-align: left;
    white-space: pre-wrap;
    user-select: none;
  }

  .speaker {
    font-weight: 600;
    opacity: 0.85;
  }

  .rest {
    visibility: hidden;
  }

  /* Read by assistive technology only: the full line at once, not every revealed grapheme. */
  .live {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
