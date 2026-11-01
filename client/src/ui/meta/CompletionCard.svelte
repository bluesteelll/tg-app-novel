<script lang="ts">
  // The completion card (META-PLAN M9, MT2): own counts only, never "X of Y" and no locked slot; the found endings by
  // their server titles and the unlocked achievements, the new ones marked. Server text renders as text.
  import { mt } from '../../i18n/meta.ts';
  import type { CardProps } from './index.ts';

  let { card, storyTitle, lang, onshare }: CardProps = $props();

  const uid = $props.id();
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{mt(lang, 'meta.card_title', { story: storyTitle })}</h2>
  <p>{mt(lang, 'meta.card_runs', { n: card.runs })}</p>
  <p>{mt(lang, 'meta.card_chapters', { n: card.chaptersCompleted.length })}</p>
  {#if card.endings.length > 0}
    <h3 id="{uid}-endings">{mt(lang, 'meta.card_endings')}</h3>
    <ul aria-labelledby="{uid}-endings">
      {#each card.endings as ending (ending.name)}
        <li>{ending.title}</li>
      {/each}
    </ul>
  {/if}
  {#if card.achievements.length > 0}
    <h3 id="{uid}-achievements">{mt(lang, 'meta.card_achievements')}</h3>
    <ul aria-labelledby="{uid}-achievements">
      {#each card.achievements as achievement (achievement.id)}
        <li>
          <span class="name">{achievement.name}</span>
          {#if achievement.isNew}
            <span class="new">{mt(lang, 'meta.card_new')}</span>
          {/if}
          <span class="description">{achievement.description}</span>
        </li>
      {/each}
    </ul>
  {/if}
  <button type="button" onclick={() => onshare()}>{mt(lang, 'meta.card_share')}</button>
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
  p,
  ul {
    margin: 0;
  }

  h2 {
    font-size: 20px;
  }

  h3 {
    margin-top: 8px;
    font-size: 16px;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
  }

  .new {
    padding: 2px 8px;
    border-radius: 8px;
    background: #f2c14e;
    color: #111;
    font-size: 12px;
  }

  .description {
    flex-basis: 100%;
    opacity: 0.75;
    font-size: 14px;
  }

  button {
    min-height: 44px;
    margin-top: 8px;
    padding: 10px 16px;
    border: 0;
    border-radius: 12px;
    background: rgb(250 248 255 / 94%);
    color: #111;
    font: inherit;
  }
</style>
