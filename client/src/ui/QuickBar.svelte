<script lang="ts">
  // The quick bar: auto and skip as toggles (pressing the active one returns to normal), the backlog and the menu.
  // Its taps stop here, so none of them also advances the dialogue.
  import { t, type Lang } from '../i18n/index.ts';
  import type { PlayMode } from './state.svelte.ts';

  type Props = {
    mode: PlayMode;
    lang: Lang;
    onmode: (m: PlayMode) => void;
    onbacklog: () => void;
    onmenu: () => void;
  };

  let { mode, lang, onmode, onbacklog, onmenu }: Props = $props();

  function toggle(e: MouseEvent, m: Exclude<PlayMode, 'normal'>): void {
    e.stopPropagation();
    onmode(mode === m ? 'normal' : m);
  }

  function run(e: MouseEvent, fn: () => void): void {
    e.stopPropagation();
    fn();
  }

  const stop = (e: Event): void => e.stopPropagation();
</script>

<nav class="quick">
  <button type="button" aria-pressed={mode === 'auto'} onpointerdown={stop} onclick={(e) => toggle(e, 'auto')}
    >{t(lang, 'quick.auto')}</button
  >
  <button type="button" aria-pressed={mode === 'skip'} onpointerdown={stop} onclick={(e) => toggle(e, 'skip')}
    >{t(lang, 'quick.skip')}</button
  >
  <button type="button" onpointerdown={stop} onclick={(e) => run(e, onbacklog)}>{t(lang, 'quick.backlog')}</button>
  <button type="button" onpointerdown={stop} onclick={(e) => run(e, onmenu)}>{t(lang, 'quick.menu')}</button>
</nav>

<style>
  .quick {
    position: absolute;
    inset: 0 0 auto 0;
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: calc(var(--app-inset-top, 0px) + 8px) calc(var(--app-inset-right, 0px) + 8px) 0
      calc(var(--app-inset-left, 0px) + 8px);
    pointer-events: none;
  }

  button {
    padding: 6px 10px;
    border: 0;
    border-radius: 10px;
    background: rgb(12 12 16 / 64%);
    color: #fff;
    font: inherit;
    font-size: 13px;
    pointer-events: auto;
  }

  button[aria-pressed='true'] {
    background: #fff;
    color: #000;
  }
</style>
