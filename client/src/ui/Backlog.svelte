<script module lang="ts">
  import type { LineId } from '../story/staging.ts';

  /**
   * One backlog line, oldest first. The speaker, the text and the chosen option are already in the UI language (the
   * caller maps PROTOTYPE-PLAN's `BacklogEntry` through the line tables); `chosen` marks the option picked there.
   */
  export type BacklogLine = { lineId: LineId; speaker: string | null; text: string; chosen: string | null };
</script>

<script lang="ts">
  // The backlog overlay: the lines read so far, as plain text (story text is never markup). Rows are keyed by
  // position, since a loop shows the same line ID again. It opens at the newest line: the panel scrolls to its end
  // when it mounts, synchronously in the effect (no frame callback that could outlive it).
  import { t, type Lang } from '../i18n/index.ts';

  type Props = { lines: readonly BacklogLine[]; lang: Lang };

  let { lines, lang }: Props = $props();

  const uid = $props.id();
  let panel: HTMLElement | undefined = $state();

  $effect(() => {
    if (panel !== undefined && lines.length > 0) {
      panel.scrollTop = panel.scrollHeight;
    }
  });
</script>

<section class="panel" aria-labelledby="{uid}-title" bind:this={panel}>
  <h2 id="{uid}-title">{t(lang, 'backlog.title')}</h2>
  {#if lines.length === 0}
    <p class="empty">{t(lang, 'backlog.empty')}</p>
  {:else}
    <ol>
      {#each lines as line, i (i)}
        <li data-line-id={line.lineId}>
          {#if line.speaker !== null}
            <span class="speaker">{line.speaker}</span>
          {/if}
          <span class="text">{line.text}</span>
          {#if line.chosen !== null}
            <span class="chosen">{t(lang, 'backlog.chosen', { choice: line.chosen })}</span>
          {/if}
        </li>
      {/each}
    </ol>
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
  p,
  ol {
    margin: 0;
  }

  h2 {
    font-size: 20px;
  }

  ol {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-wrap: anywhere;
  }

  .speaker {
    font-weight: 600;
  }

  .chosen,
  .empty {
    color: var(--tg-theme-hint-color, #9a9aa6);
  }
</style>
