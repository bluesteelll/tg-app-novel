<script lang="ts">
  // The invite prompt (META-PLAN M10 revision 1, C1; F19): it names nobody, and says that the person who shared the
  // link will see the player's first name and that a friendship forms only if that person accepts. Not now does
  // nothing (the prompt returns on a later launch from the same link). The prompt is pushed at boot, possibly under a
  // tap in progress, so Send follows rule (b) of Choices.svelte: a pointer click counts only after a pointerdown on it
  // while the prompt is shown; a keyboard click (detail 0) counts (critique W5).
  import { mt } from '../../i18n/meta.ts';
  import type { InviteProps } from './index.ts';

  let { lang, busy = false, onsend, onlater }: InviteProps = $props();

  const uid = $props.id();
  /** A pointer went down on Send while the prompt is shown. */
  let armed = false;

  function send(e: MouseEvent): void {
    if (e.detail > 0 && !armed) {
      return;
    }
    armed = false;
    onsend();
  }
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{mt(lang, 'meta.invite_title')}</h2>
  <p>{mt(lang, 'meta.invite_body')}</p>
  <div class="actions">
    <button type="button" class="primary" disabled={busy} onpointerdown={() => (armed = true)} onclick={send}>
      {mt(lang, 'meta.invite_send')}
    </button>
    <button type="button" onclick={() => onlater()}>{mt(lang, 'meta.invite_later')}</button>
  </div>
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

  .actions {
    display: flex;
    gap: 8px;
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

  .primary {
    background: rgb(250 248 255 / 94%);
    color: #111;
  }
</style>
