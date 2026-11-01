<script lang="ts">
  // The profile-visibility consent (META-PLAN M12, F21; MT5): its own text naming the friend circle and a policy
  // link, off by default, one tap either way. The switch shows the server's state (`granted`) and only asks for the
  // opposite, so it never flips before the server answers; the text version travels with the answer. The switch
  // follows rule (b) of Choices.svelte: a pointer click counts only after a pointerdown on it while the dialog is
  // shown, so the tap that opened the dialog gives no consent; a keyboard click (detail 0) counts (critique W5).
  import { CONSENT_TEXT_VERSION, mt } from '../../i18n/meta.ts';
  import type { ConsentProps } from './index.ts';

  let { granted = false, lang, busy = false, onchange, onpolicy }: ConsentProps = $props();

  const uid = $props.id();
  /** A pointer went down on the switch while the dialog is shown. */
  let armed = false;

  function toggle(e: MouseEvent): void {
    if (e.detail > 0 && !armed) {
      return;
    }
    armed = false;
    onchange(!granted, CONSENT_TEXT_VERSION);
  }
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{mt(lang, 'meta.consent_title')}</h2>
  <p>{mt(lang, 'meta.consent_body')}</p>
  <button
    type="button"
    class="switch"
    role="switch"
    aria-checked={granted ? 'true' : 'false'}
    disabled={busy}
    onpointerdown={() => (armed = true)}
    onclick={toggle}
  >
    <span>{mt(lang, 'meta.consent_switch')}</span>
    <span class="track" aria-hidden="true"><span class="thumb"></span></span>
  </button>
  <button type="button" class="link" onclick={() => onpolicy()}>{mt(lang, 'meta.consent_policy')}</button>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 20px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 20px);
    background: rgb(20 20 24 / 96%);
    color: #fff;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 20px;
  }

  button {
    min-height: 44px;
    padding: 10px 16px;
    border: 0;
    border-radius: 12px;
    background: rgb(255 255 255 / 16%);
    color: inherit;
    font: inherit;
  }

  button:disabled {
    opacity: 0.5;
  }

  .switch {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    text-align: left;
  }

  .track {
    flex: none;
    width: 44px;
    height: 26px;
    border-radius: 13px;
    background: rgb(255 255 255 / 30%);
  }

  .thumb {
    display: block;
    width: 22px;
    height: 22px;
    margin: 2px;
    border-radius: 50%;
    background: #fff;
  }

  .switch[aria-checked='true'] .track {
    background: #4caf50;
  }

  .switch[aria-checked='true'] .thumb {
    margin-left: 20px;
  }

  .link {
    align-self: flex-start;
    background: none;
    text-decoration: underline;
  }
</style>
