<script lang="ts">
  // A friend's profile (META-PLAN M13, F22). Without the friend's consent: the name and "progress hidden" only, even
  // if stories arrive (the server sends none then). With it, per story the friend's own counts and the titles both
  // found, never a total. Gift and Remove are there in both states: a gift and a removal need the friendship, not the
  // consent (M22, F20; critique W2). Remove asks once more in place and says it is final (MT5). The confirm follows
  // rule (b) of Choices.svelte: a pointer click counts only after a pointerdown on it during this step, so the tap
  // that revealed it removes nobody (critique W5); a keyboard click (detail 0) counts.
  import { mt } from '../../i18n/meta.ts';
  import type { FriendProfileProps } from './index.ts';

  let { profile, lang, busy = false, ongift, onremove }: FriendProfileProps = $props();

  const uid = $props.id();
  /** The second step of Remove is shown. */
  let confirming = $state(false);
  /** A pointer went down on the confirm button during this step. */
  let armed = false;

  function ask(): void {
    armed = false;
    confirming = true;
  }

  function confirmRemove(e: MouseEvent): void {
    if (e.detail > 0 && !armed) {
      return;
    }
    armed = false;
    confirming = false;
    onremove(profile.handle);
  }
</script>

<section class="panel" aria-labelledby="{uid}-name">
  <h2 id="{uid}-name">{profile.firstName}</h2>
  {#if profile.visible}
    {#each profile.stories as story (story.storyId)}
      <section class="story">
        <h3>{story.storyTitle}</h3>
        <p>{mt(lang, 'meta.friend_endings', { n: story.endingsFound })}</p>
        <p>{mt(lang, 'meta.friend_achievements', { n: story.achievementsUnlocked })}</p>
        {#if story.sharedEndings.length > 0 || story.sharedAchievements.length > 0}
          <h4>{mt(lang, 'meta.friend_shared')}</h4>
          <ul>
            {#each story.sharedEndings as ending (ending.name)}
              <li>{ending.title}</li>
            {/each}
            {#each story.sharedAchievements as achievement (achievement.id)}
              <li>{achievement.name}</li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  {:else}
    <p>{mt(lang, 'meta.friend_hidden')}</p>
  {/if}
  <button type="button" class="primary" disabled={busy} onclick={() => ongift(profile.handle)}>
    {mt(lang, 'meta.friend_gift')}
  </button>
  {#if confirming}
    <p class="note">{mt(lang, 'meta.friend_remove_note')}</p>
    <div class="actions">
      <button type="button" onclick={() => (confirming = false)}>{mt(lang, 'meta.cancel')}</button>
      <button
        type="button"
        class="danger"
        disabled={busy}
        onpointerdown={() => (armed = true)}
        onclick={confirmRemove}>{mt(lang, 'meta.friend_remove_confirm')}</button
      >
    </div>
  {:else}
    <button type="button" class="danger" disabled={busy} onclick={ask}>{mt(lang, 'meta.friend_remove')}</button>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
  h3,
  h4,
  p,
  ul {
    margin: 0;
  }

  h2 {
    font-size: 20px;
  }

  h3 {
    font-size: 16px;
  }

  h4 {
    font-size: 14px;
    opacity: 0.75;
  }

  .story {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 0;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    list-style: none;
  }

  .note {
    opacity: 0.75;
    font-size: 14px;
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

  .danger {
    color: #ff8a80;
  }
</style>
