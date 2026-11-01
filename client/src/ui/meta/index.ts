// The meta overlays' chunk entry (META-PLAN M27): LMI's `app/meta.ts` imports this module dynamically, so the seven
// components and their table (i18n/meta.ts) ship in one lazy chunk. Props in, callbacks out: the data types mirror
// META-PLAN's views field for field, so LMI passes its views without an adapter. Everything that reaches outside the
// chunk is `import type` (erased: zero bytes, and no module of the entry joins the chunk's graph).
import type { Lang } from '../../i18n/index.ts';
import type { EndingName, StoryId } from '../../story/catalog.ts';
import type { ChapterId } from '../../story/staging.ts';

/** A completion card (= META-PLAN `CardView`): own counts only; titles and names in the UI language. */
export type CardData = {
  storyId: StoryId;
  runs: number;
  chaptersCompleted: readonly ChapterId[];
  endings: ReadonlyArray<{ name: EndingName; title: string; firstReachedAt: number }>;
  achievements: ReadonlyArray<{ id: string; name: string; description: string; unlockedAt: number; isNew: boolean }>;
};

/** The completion card; `storyTitle` is the public catalog title in the UI language. */
export type CardProps = { card: CardData; storyTitle: string; lang: Lang; onshare: () => void };

export { default as CompletionCard } from './CompletionCard.svelte';
