<script module lang="ts">
  import type { ChapterId } from '../story/staging.ts';

  /** One chapter of the story being shown; `locked` = paid and not owned, from the server's entitlements. */
  export type ChapterRow = { id: ChapterId; title: string; locked: boolean };
</script>

<script lang="ts">
  // One story's chapters (STORIES-PLAN Y14): the caller passes that story's chapters only, in play order. A tap calls
  // back inside the click, since starting a chapter is the audio gesture; a locked chapter's tap leads to the
  // paywall, which is the caller's.
  import { t, type Lang } from '../i18n/index.ts';

  type Props = { story: string; chapters: readonly ChapterRow[]; lang: Lang; onchapter: (id: ChapterId) => void };

  let { story, chapters, lang, onchapter }: Props = $props();

  const uid = $props.id();
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{t(lang, 'chapters.title', { story })}</h2>
  <ul>
    {#each chapters as chapter (chapter.id)}
      <li>
        <button type="button" onclick={() => onchapter(chapter.id)}>
          <span class="title">{chapter.title}</span>
          {#if chapter.locked}
            <span class="locked">{t(lang, 'chapters.locked')}</span>
          {/if}
        </button>
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
  ul {
    margin: 0;
  }

  h2 {
    font-size: 20px;
    overflow-wrap: anywhere;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    list-style: none;
  }

  button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    min-height: 44px;
    padding: 10px 16px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
    text-align: left;
  }

  .title {
    overflow-wrap: anywhere;
  }

  .locked {
    color: var(--tg-theme-hint-color, #9a9aa6);
    font-size: 14px;
  }
</style>
