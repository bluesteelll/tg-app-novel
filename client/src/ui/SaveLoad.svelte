<script module lang="ts">
  import type { SaveSlot } from '../api/generated/api.ts';

  /** One occupied slot as the save screen shows it: `savedAt` in unix seconds, `chapter` its title in the UI language. */
  export type SlotView = { slot: SaveSlot; savedAt: number; chapter: string };
</script>

<script lang="ts">
  // Save and load (F3): four fixed rows, `auto` (load only) and s1-s3, each found by its slot in `slots`, never by
  // position. Saving over an occupied row asks first, in place; the server's 409 on a manual slot (`conflict`) asks
  // whether to overwrite. One write per tap (L10 review M3, critique W1): every control that writes (Save, both Yes
  // and the conflict's No) is disabled while `saving` names a slot, and a latch set on the tap blocks a second tap
  // that lands before the caller's answer; the next change of `saving`, `conflict`, `failed` or `slots` releases it.
  // A failed save shows on its row (`failed`, critique W2). The overwrite ask keeps Yes out of Save's place (triage
  // I1): the question and No fill the block that held Save, and Yes gets a block of its own below it. The upper block
  // holds a button and no button label wraps, so it is at least as tall as the actions row was, and Yes starts below
  // Save's former rectangle: the second tap of a double tap on an occupied row's Save meets the question or No, never
  // Yes. Loading once per tap is the caller's, as Start is.
  import { t, type Lang } from '../i18n/index.ts';
  import type { ManualSlot } from '../saves/service.ts';

  type Props = {
    slots: readonly SlotView[];
    lang: Lang;
    saving: ManualSlot | null;
    conflict: ManualSlot | null;
    failed: ManualSlot | null;
    onsave: (slot: ManualSlot) => void;
    onoverwrite: (slot: ManualSlot) => void;
    oncancel: () => void;
    onload: (slot: SaveSlot) => void;
  };

  let { slots, lang, saving, conflict, failed, onsave, onoverwrite, oncancel, onload }: Props = $props();

  const MANUAL: readonly ManualSlot[] = ['s1', 's2', 's3'];

  const uid = $props.id();
  /** The occupied row whose Save asked "Overwrite?". */
  let asking: ManualSlot | null = $state(null);
  /** A write was sent from this screen and the caller has not answered yet. */
  let latched = $state(false);
  const busy = $derived(latched || saving !== null);
  const time = $derived(new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }));

  $effect(() => {
    // Any new answer from the caller (a save started or settled, a conflict, a failure, new slots) ends the latch.
    void [saving, conflict, failed, slots];
    latched = false;
  });

  function viewOf(slot: SaveSlot): SlotView | undefined {
    return slots.find((s) => s.slot === slot);
  }

  function info(slot: SaveSlot): string {
    const v = viewOf(slot);
    return v === undefined
      ? t(lang, 'saves.empty')
      : t(lang, 'saves.info', { chapter: v.chapter, time: time.format(new Date(v.savedAt * 1000)) });
  }

  function write(run: () => void): void {
    if (latched || saving !== null) {
      return;
    }
    latched = true;
    asking = null;
    run();
  }

  function save(slot: ManualSlot): void {
    if (latched || saving !== null) {
      return;
    }
    if (viewOf(slot) !== undefined) {
      asking = slot;
      return;
    }
    write(() => onsave(slot));
  }
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{t(lang, 'saves.title')}</h2>
  <ul>
    <li data-slot="auto">
      <div class="label">
        <span class="name">{t(lang, 'saves.auto')}</span>
        <span class="info">{info('auto')}</span>
      </div>
      {#if viewOf('auto') !== undefined}
        <div class="actions">
          <button type="button" onclick={() => onload('auto')}>{t(lang, 'saves.load')}</button>
        </div>
      {/if}
    </li>
    {#each MANUAL as slot, i (slot)}
      <li data-slot={slot}>
        <div class="label">
          <span class="name">{t(lang, 'saves.slot', { n: i + 1 })}</span>
          <span class="info">{info(slot)}</span>
          {#if saving === slot}
            <span class="status">{t(lang, 'saves.saving')}</span>
          {:else if failed === slot}
            <span class="status failed" role="alert">{t(lang, 'saves.failed')}</span>
          {/if}
        </div>
        {#if conflict === slot}
          <p class="ask" role="alert">{t(lang, 'saves.conflict_ask')}</p>
          <div class="actions">
            <button type="button" class="primary" disabled={busy} onclick={() => write(() => onoverwrite(slot))}
              >{t(lang, 'saves.yes')}</button
            >
            <button type="button" disabled={busy} onclick={() => write(() => oncancel())}>{t(lang, 'saves.no')}</button>
          </div>
        {:else if asking === slot}
          <div class="actions">
            <p class="ask">{t(lang, 'saves.overwrite_ask')}</p>
            <button type="button" onclick={() => (asking = null)}>{t(lang, 'saves.no')}</button>
          </div>
          <div class="actions">
            <button type="button" class="primary" disabled={busy} onclick={() => write(() => onsave(slot))}
              >{t(lang, 'saves.yes')}</button
            >
          </div>
        {:else}
          <div class="actions">
            {#if viewOf(slot) !== undefined}
              <button type="button" onclick={() => onload(slot)}>{t(lang, 'saves.load')}</button>
            {/if}
            <button type="button" class="primary" disabled={busy} onclick={() => save(slot)}>{t(lang, 'saves.save')}</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
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
  ul,
  p {
    margin: 0;
  }

  h2 {
    font-size: 20px;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
  }

  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-wrap: anywhere;
  }

  .name {
    font-weight: 600;
  }

  .info,
  .status {
    color: var(--tg-theme-hint-color, #9a9aa6);
    font-size: 14px;
  }

  .failed {
    color: var(--tg-theme-destructive-text-color, #ff8a80);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .actions > .ask {
    flex: 1 1 auto;
    align-self: center;
  }

  button {
    min-width: 44px;
    min-height: 44px;
    padding: 10px 16px;
    border: 0;
    border-radius: 12px;
    background: rgb(127 127 127 / 20%);
    color: inherit;
    font: inherit;
    /* One line per label, so every button of a row is one height: the overwrite ask relies on it (see the script). */
    white-space: nowrap;
  }

  button:disabled {
    opacity: 0.5;
  }

  .primary {
    background: var(--tg-theme-button-color, #6c5ce7);
    color: var(--tg-theme-button-text-color, #fff);
  }
</style>
