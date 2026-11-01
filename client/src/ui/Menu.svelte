<script lang="ts">
  // The in-play menu (K26): saves, settings and back to stories; the meta entries Friends and Wallet render iff the
  // caller gives them (META M27: LMI passes them, L15 none). Every tap calls back at once, inside the click. There is
  // no close button: the BackButton closes every overlay. The panel fills its layer, so no tap reaches the dialogue.
  import { t, type Lang } from '../i18n/index.ts';

  type Props = {
    lang: Lang;
    onsaves: () => void;
    onsettings: () => void;
    onstories: () => void;
    onfriends?: () => void;
    onwallet?: () => void;
  };

  let { lang, onsaves, onsettings, onstories, onfriends, onwallet }: Props = $props();

  const uid = $props.id();
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{t(lang, 'menu.title')}</h2>
  <button type="button" onclick={() => onsaves()}>{t(lang, 'menu.saves')}</button>
  <button type="button" onclick={() => onsettings()}>{t(lang, 'menu.settings')}</button>
  {#if onfriends !== undefined}
    <button type="button" onclick={() => onfriends?.()}>{t(lang, 'menu.friends')}</button>
  {/if}
  {#if onwallet !== undefined}
    <button type="button" onclick={() => onwallet?.()}>{t(lang, 'menu.wallet')}</button>
  {/if}
  <button type="button" onclick={() => onstories()}>{t(lang, 'menu.back_to_stories')}</button>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 20px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 20px);
    background: var(--tg-theme-bg-color, #17171c);
    color: var(--tg-theme-text-color, #fff);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 20px;
  }

  button {
    min-height: 44px;
    padding: 12px 16px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
    font-size: 16px;
    text-align: left;
  }
</style>
