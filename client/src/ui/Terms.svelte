<script lang="ts">
  // The in-app terms (PROTOTYPE-PLAN P1: the paywall's Terms link opens this overlay): the terms text and the support
  // note, from the UI tables (placeholder copy until the owner's text, Q4). No link leaves the app from here: the
  // privacy policy goes out only through `onpolicy` (the caller's tg.openLink), and its button shows iff given.
  import { t, type Lang } from '../i18n/index.ts';

  type Props = { lang: Lang; onpolicy?: () => void };

  let { lang, onpolicy }: Props = $props();

  const uid = $props.id();
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{t(lang, 'terms.title')}</h2>
  <p>{t(lang, 'terms.body')}</p>
  <p>{t(lang, 'terms.support')}</p>
  {#if onpolicy !== undefined}
    <button type="button" class="link" onclick={() => onpolicy?.()}>{t(lang, 'terms.policy')}</button>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  h2,
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  h2 {
    font-size: 20px;
  }

  .link {
    align-self: flex-start;
    min-height: 44px;
    padding: 10px 0;
    border: 0;
    background: none;
    color: var(--tg-theme-link-color, var(--tg-theme-button-color, #8ab4ff));
    font: inherit;
    text-decoration: underline;
  }
</style>
