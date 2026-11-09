<script lang="ts">
  // The cue stage's layer (engine plan §8.1; GM3s): App mounts it above the frame layer for a session that loaded the
  // chunk. It plays every cue on its ghosts and passes every tap (`pointer-events: none`, `inert`); the stage itself
  // (the bus subscription, the player, the roots' entrance and exit, the debug attributes) is `mountStage`'s.
  import { untrack } from 'svelte';

  import type { CueStageProps } from '../../ui/state.svelte.ts';
  import { mountStage } from './index.ts';

  // Destructured, not a rest object: Svelte's rest-props proxy would join the entry chunk for this one component.
  const { subscribe, orphans, dropped, reduced, host, haptic }: CueStageProps = $props();
  let layer: HTMLDivElement;

  // Mounted once: `reduced` is read where it is used, so a change of it never re-subscribes.
  $effect(() =>
    untrack(() =>
      mountStage(layer, {
        subscribe,
        orphans,
        dropped,
        host,
        haptic,
        get reduced() {
          return reduced;
        },
      }),
    ),
  );
</script>

<div class="cue-stage" data-cue-stage inert bind:this={layer}></div>

<style>
  .cue-stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .cue-stage :global(.cue-ghost) {
    box-sizing: border-box;
  }

  /* A hit area's painted ghost: the reveal outline's stroke and a soft glow (§8.5 "Hit areas", CLAIM defaults). */
  .cue-stage :global(.cue-ghost.cue-hit) {
    outline: 2px solid rgba(255, 255, 255, 0.9);
    outline-offset: -2px;
    box-shadow: 0 0 12px rgba(255, 255, 255, 0.45);
  }
</style>
