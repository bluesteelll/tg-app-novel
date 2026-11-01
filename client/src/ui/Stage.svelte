<script lang="ts">
  // The stage box (PUZZLES-PLAN X10): the one host element the scene mounts its canvas into (`resizeTo: host`), with
  // the exploration layer as children in the same box, so hotspots and the canvas share one coordinate space.
  // `onhost(el)` on mount and `onhost(null)` on unmount are the caller's create and destroy signals for the scene.
  import { untrack, type Snippet } from 'svelte';

  type Props = { children?: Snippet; onhost?: (el: HTMLElement | null) => void };

  let { children, onhost }: Props = $props();

  let host: HTMLElement | undefined = $state();

  $effect(() => {
    const el = host;
    if (el === undefined) {
      return;
    }
    // Read once, untracked: a parent passing a new callback must not re-run this, which would destroy and remount
    // the scene (a WebGL context and every decoded texture).
    const report = untrack(() => onhost);
    report?.(el);
    return () => report?.(null);
  });
</script>

<div class="frame">
  <div class="host" bind:this={host}>
    {@render children?.()}
  </div>
</div>

<style>
  .frame {
    display: flex;
    justify-content: center;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
  }

  /* Full-bleed on a tall screen; pillar-boxed in black once the screen is wider than 9:16. */
  .host {
    position: relative;
    height: 100%;
    max-width: 100%;
    aspect-ratio: 9 / 16;
    overflow: hidden;
  }
</style>
