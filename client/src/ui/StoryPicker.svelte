<script module lang="ts">
  import type { StoryId } from '../story/catalog.ts';

  /**
   * One story card on Home (STORIES-PLAN Y14, Y15; META M9). The caller computes every flag: `continue` (a save of
   * this story exists), `eager` (one of the first three covers), `card` (an ending was reached). The title and the
   * teaser are in the UI language; the cover URLs are the public asset tool's, or null for no cover.
   */
  export type StoryCardView = {
    id: StoryId;
    title: string;
    teaser: string;
    cover: { avif: string; webp: string } | null;
    continue: boolean;
    eager: boolean;
    card: boolean;
  };
</script>

<script lang="ts">
  // Home's story cards, rendered inside TapToStart's frame. Each callback runs first and synchronously in the tap, so
  // the caller's unlockAudio() is inside the gesture (principle 5); making Start and Continue single-shot is the
  // caller's (F1 step 5). Covers are DOM images, decoded off the main thread; all but the eager ones load lazily
  // (0.88 MiB decoded each). `loading` comes before `src`, so a lazy image is never fetched before it is near.
  import { t, type Lang } from '../i18n/index.ts';

  type Props = {
    cards: readonly StoryCardView[];
    lang: Lang;
    onstart: (id: StoryId) => void;
    oncontinue: (id: StoryId) => void;
    onchapters: (id: StoryId) => void;
    oncard: (id: StoryId) => void;
    onfriends?: () => void;
    onwallet?: () => void;
  };

  let { cards, lang, onstart, oncontinue, onchapters, oncard, onfriends, onwallet }: Props = $props();
</script>

<div class="picker">
  <ul class="cards">
    {#each cards as c (c.id)}
      <li class="card" data-story={c.id}>
        {#if c.cover !== null}
          <picture>
            <source type="image/avif" srcset={c.cover.avif} />
            <img loading={c.eager ? undefined : 'lazy'} decoding="async" width="360" height="640" alt="" src={c.cover.webp} />
          </picture>
        {/if}
        <h2>{c.title}</h2>
        <p>{c.teaser}</p>
        <div class="actions">
          {#if c.continue}
            <button type="button" class="primary" onclick={() => oncontinue(c.id)}>{t(lang, 'stories.continue')}</button>
          {:else}
            <button type="button" class="primary" onclick={() => onstart(c.id)}>{t(lang, 'stories.start')}</button>
          {/if}
          <button type="button" onclick={() => onchapters(c.id)}>{t(lang, 'stories.chapters')}</button>
          {#if c.card}
            <button type="button" onclick={() => oncard(c.id)}>{t(lang, 'stories.card')}</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
  {#if onfriends !== undefined || onwallet !== undefined}
    <nav class="footer">
      {#if onfriends !== undefined}
        <button type="button" onclick={() => onfriends?.()}>{t(lang, 'stories.friends')}</button>
      {/if}
      {#if onwallet !== undefined}
        <button type="button" onclick={() => onwallet?.()}>{t(lang, 'stories.wallet')}</button>
      {/if}
    </nav>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 16px;
    color: #fff;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  picture,
  img {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 9 / 16;
    border-radius: 14px;
    object-fit: cover;
    background: rgb(255 255 255 / 8%);
  }

  h2,
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  h2 {
    font-size: 20px;
  }

  p {
    color: rgb(255 255 255 / 72%);
  }

  .actions,
  .footer {
    display: flex;
    flex-wrap: wrap;
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

  .primary {
    background: #fff;
    color: #000;
  }
</style>
