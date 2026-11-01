<script module lang="ts">
  /**
   * A full-screen notice (F1-F4, STORIES-PLAN F4′): the root view's `notice`. The callbacks live in the view, as a
   * toast's `run` does; each new object is a new presentation. `open_in_telegram` and `reopen` have no action (the
   * facade has no close; the body says what to do). `the_end` shows the card action iff `oncard` is given (META M9).
   */
  export type NoticeView =
    | { kind: 'open_in_telegram' | 'reopen' }
    | { kind: 'error' | 'story_error' | 'to_be_continued'; onaction: () => void }
    | { kind: 'the_end'; onaction: () => void; oncard?: () => void };
</script>

<script lang="ts">
  // The notices can mount under a finger already pressed (auto mode reaching The End, an async failure), so both
  // actions follow rule (b) of Choices.svelte: a pointer click counts only after a pointerdown on that button while
  // this notice is shown; a keyboard or assistive-technology click (detail 0) counts. The main action runs once per
  // notice object, so a double tap cannot retry or resume twice; the card action is a retry (M9) and is not latched.
  import { t, type Lang, type UiKey } from '../i18n/index.ts';

  type Props = { notice: NoticeView; lang: Lang };

  let { notice, lang }: Props = $props();

  type Copy = { title: UiKey; body: UiKey | null; action: UiKey | null };
  type Button = 'action' | 'card';

  const uid = $props.id();
  const copy = $derived(copyOf(notice.kind));
  const oncard = $derived(notice.kind === 'the_end' ? notice.oncard : undefined);

  /** The button a pointer went down on, and in which presentation. */
  let armed: { notice: NoticeView; button: Button } | null = null;
  /** The presentation whose main action already ran. */
  let acted: NoticeView | null = null;

  function copyOf(kind: NoticeView['kind']): Copy {
    switch (kind) {
      case 'open_in_telegram':
        return { title: 'notice.open_in_telegram_title', body: 'notice.open_in_telegram_body', action: null };
      case 'reopen':
        return { title: 'notice.reopen_title', body: 'notice.reopen_body', action: null };
      case 'error':
        return { title: 'notice.error_title', body: 'notice.error_body', action: 'notice.error_action' };
      case 'story_error':
        return { title: 'notice.story_error_title', body: 'notice.story_error_body', action: 'notice.story_error_action' };
      case 'to_be_continued':
        return { title: 'notice.to_be_continued_title', body: null, action: 'notice.to_be_continued_action' };
      case 'the_end':
        return { title: 'notice.the_end_title', body: null, action: 'notice.the_end_action' };
      default: {
        const unhandled: never = kind;
        throw new Error(`invariant: unhandled notice ${String(unhandled)}`);
      }
    }
  }

  function press(button: Button): void {
    armed = { notice, button };
  }

  function counts(e: MouseEvent, button: Button): boolean {
    return e.detail === 0 || (armed !== null && armed.notice === notice && armed.button === button);
  }

  function act(e: MouseEvent): void {
    if (!('onaction' in notice) || acted === notice || !counts(e, 'action')) {
      return;
    }
    acted = notice;
    armed = null;
    notice.onaction();
  }

  function card(e: MouseEvent): void {
    if (notice.kind !== 'the_end' || notice.oncard === undefined || !counts(e, 'card')) {
      return;
    }
    armed = null;
    notice.oncard();
  }
</script>

<section class="notice" aria-labelledby="{uid}-title">
  <h1 id="{uid}-title">{t(lang, copy.title)}</h1>
  {#if copy.body !== null}
    <p>{t(lang, copy.body)}</p>
  {/if}
  {#if copy.action !== null}
    <div class="actions">
      <button type="button" class="primary" onpointerdown={() => press('action')} onclick={act}
        >{t(lang, copy.action)}</button
      >
      {#if oncard !== undefined}
        <button type="button" onpointerdown={() => press('card')} onclick={card}>{t(lang, 'notice.the_end_card')}</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: calc(var(--app-inset-top, 0px) + 24px) calc(var(--app-inset-right, 0px) + 24px)
      calc(var(--app-inset-bottom, 0px) + 24px) calc(var(--app-inset-left, 0px) + 24px);
    overflow-y: auto;
    overscroll-behavior: contain;
    background: #000;
    color: #fff;
    text-align: center;
    user-select: none;
  }

  h1,
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  h1 {
    font-size: 24px;
  }

  p {
    max-width: 32ch;
    color: rgb(255 255 255 / 72%);
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    width: 100%;
    max-width: 320px;
  }

  button {
    min-height: 44px;
    padding: 14px 16px;
    border: 0;
    border-radius: 14px;
    background: rgb(255 255 255 / 16%);
    color: inherit;
    font: inherit;
    font-size: 16px;
  }

  .primary {
    background: #fff;
    color: #000;
  }
</style>
