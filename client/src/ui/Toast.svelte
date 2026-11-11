<script module lang="ts">
  import type { ToastEntry } from './state.svelte.ts';

  /** The entries to render: a `dev` banner only where the dev mock is compiled in, every other entry always. */
  export function visibleToasts(entries: readonly ToastEntry[], devEnabled: boolean): readonly ToastEntry[] {
    return devEnabled ? entries : entries.filter((e) => e.kind !== 'dev');
  }
</script>

<script lang="ts">
  // The toast stack. Every handler is synchronous and stops the click, so a toast tap never reaches the dialogue
  // under it, and the sound chip's tap is the gesture that resumes audio. A leaving toast is an inert, aria-hidden
  // ghost until its `out` ends, so a tap there reaches the layer below, as on the empty place it leaves.
  import { t, type Lang } from '../i18n/index.ts';
  import { playToast, stackOf, type ToastMotion, type ToastSlot } from './toast-motion.ts';

  // `reduced` is the view model's `reducedMotion` (required, so App cannot drop the one source silently).
  type Props = { toasts: readonly ToastEntry[]; lang: Lang; reduced: boolean; ondismiss: (key: string) => void };

  let { toasts, lang, reduced, ondismiss }: Props = $props();

  // The one dev gate: false in production, where a tag error is dropped and logged instead (F2).
  const shown = $derived(visibleToasts(toasts, __TG_MOCK__));

  // Motion (per-player GM6t). No effect reads what it writes: the recompute reads `shown` and `endedTick` and writes
  // `slots`; the walk reads `root` and `slots` and bumps `endedTick` from a plain counter.
  let root: HTMLElement | undefined = $state();
  let slots: readonly ToastSlot[] = $state.raw([]);
  let endedTick = $state(0);
  let prev: readonly ToastSlot[] = [];
  let token = 0;
  let bumps = 0;
  // Leave tokens whose `out` ended, and those whose `out` started; both keep only the tokens still on the stack.
  const ended = new Set<number>();
  const played = new Set<number>();
  // One motion per target (a toast element, its text span). An entry leaves when its target leaves the stack, never
  // at its finish: a key back while its ghost is still here must cancel the ghost's finished `out`, whose held last
  // frame would hide the toast again once the `in` ends.
  const running = new Map<Element, Animation>();
  // The last walk's live toasts by key.
  let live = new Map<string, { el: Element; message: string }>();

  function play(target: Element | null, kind: ToastMotion): Animation | null {
    if (!target) {
      return null;
    }
    running.get(target)?.cancel();
    const anim = playToast(target, kind, reduced);
    if (anim) {
      running.set(target, anim);
    }
    return anim;
  }

  function end(leave: number): void {
    ended.add(leave);
    endedTick = ++bumps;
  }

  // A pre effect: a plain one would be dirtied by this write in the same flush as the walk below and run it before
  // the template applies `slots`, against the old DOM, so no new toast would ever enter.
  $effect.pre(() => {
    void endedTick;
    ({ slots: prev, token } = stackOf(prev, shown, ended, token));
    const held = new Set(prev.map((s) => s.leave));
    for (const tokens of [ended, played]) {
      for (const n of tokens) {
        if (!held.has(n)) {
          tokens.delete(n);
        }
      }
    }
    slots = prev;
  });

  // The walk: `root.children[i]` is `slots[i]`'s element (one root element per slot). Idempotent: a run with nothing
  // new plays nothing.
  $effect(() => {
    const host = root;
    if (!host) {
      return;
    }
    const now = new Map<string, { el: Element; message: string }>();
    slots.forEach(({ entry, leave }, i) => {
      const el = host.children[i];
      if (!el) {
        return;
      }
      if (leave === null) {
        const was = live.get(entry.key);
        if (was?.el !== el) {
          play(el, 'in');
        } else if (was.message !== entry.message) {
          play(el.querySelector('[data-toast-text]'), 'swap');
        }
        now.set(entry.key, { el, message: entry.message });
      } else if (!played.has(leave)) {
        played.add(leave);
        const anim = play(el, 'out');
        if (anim) {
          anim.onfinish = () => end(leave);
        } else {
          end(leave);
        }
      }
    });
    live = now;
    for (const target of running.keys()) {
      if (!host.contains(target)) {
        running.delete(target);
      }
    }
  });

  // The unmount cancels every motion still held (a cancelled animation fires no `onfinish`).
  $effect(() => () => {
    for (const anim of running.values()) {
      anim.cancel();
    }
  });

  function dismiss(e: MouseEvent, key: string): void {
    e.stopPropagation();
    ondismiss(key);
  }
</script>

<div class="toasts" aria-live="polite" bind:this={root}>
  <!-- One root element per slot: the walk zips root.children with slots (test 'toast: every slot renders exactly one
       root element'). -->
  {#each slots as slot (slot.entry.key)}
    {@const entry = slot.entry}
    {#if entry.kind === 'prompt'}
      <div
        class="toast"
        data-variant="prompt"
        inert={slot.leave !== null}
        aria-hidden={slot.leave === null ? undefined : 'true'}
      >
        <span data-toast-text>{entry.message}</span>
        <span class="actions">
          {#each entry.actions as action, i (i)}
            <button
              type="button"
              onclick={(e) => {
                e.stopPropagation();
                action.run();
                ondismiss(entry.key);
              }}>{action.label}</button
            >
          {/each}
        </span>
      </div>
    {:else if entry.kind === 'chip'}
      <button
        type="button"
        class="toast"
        data-variant="chip"
        inert={slot.leave !== null}
        aria-hidden={slot.leave === null ? undefined : 'true'}
        onclick={(e) => {
          e.stopPropagation();
          entry.tap();
        }}><span data-toast-text>{entry.message}</span></button
      >
    {:else if entry.kind === 'note' && entry.sticky}
      <div
        class="toast"
        data-variant="note"
        inert={slot.leave !== null}
        aria-hidden={slot.leave === null ? undefined : 'true'}
      >
        <span data-toast-text>{entry.message}</span>
        <button type="button" class="close" aria-label={t(lang, 'toast.close')} onclick={(e) => dismiss(e, entry.key)}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    {:else}
      <button
        type="button"
        class="toast"
        data-variant={entry.kind}
        inert={slot.leave !== null}
        aria-hidden={slot.leave === null ? undefined : 'true'}
        onclick={(e) => dismiss(e, entry.key)}><span data-toast-text>{entry.message}</span></button
      >
    {/if}
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    inset: 0 0 auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: calc(var(--app-inset-top, 0px) + 8px) calc(var(--app-inset-right, 0px) + 8px) 0
      calc(var(--app-inset-left, 0px) + 8px);
    pointer-events: none;
    z-index: 10;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    border: 0;
    border-radius: 12px;
    background: rgb(20 20 24 / 92%);
    color: #fff;
    font: inherit;
    font-size: 14px;
    text-align: left;
    pointer-events: auto;
  }

  .toast[data-variant='dev'] {
    background: #8a1c1c;
    font-family: monospace;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .actions button,
  .close {
    padding: 6px 10px;
    border: 0;
    border-radius: 8px;
    background: rgb(255 255 255 / 16%);
    color: inherit;
    font: inherit;
  }
</style>
