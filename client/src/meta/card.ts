// The completion card (META-PLAN M9, "Module API"): one `POST /api/stories/{storyId}/card` per open, its texts picked
// in the UI language. Stateless: nothing outlives the promise, so a card is never cached and every open shows the
// server's answer (principle 1).
import type { CardResponse } from '../api/generated/api.ts';
import { metaError } from '../api/meta.ts';
import type { MetaEndpoints, MetaError } from '../api/meta.ts';
import type { Lang } from '../i18n/index.ts';
import type { EndingName, Result, StoryId } from '../story/catalog.ts';
import type { ChapterId } from '../story/staging.ts';

/** An achievement id, unique in its story (META M7). A local brand: staging.ts names none. */
export type AchievementId = string & { readonly __brand: 'AchievementId' };

/** META-PLAN `CardView`: the user's own counts and found items only, texts in one language. */
export type CardView = {
  storyId: StoryId;
  runs: number;
  chaptersCompleted: readonly ChapterId[];
  endings: ReadonlyArray<{ name: EndingName; title: string; firstReachedAt: number }>;
  achievements: ReadonlyArray<{ id: AchievementId; name: string; description: string; unlockedAt: number; isNew: boolean }>;
};

export interface CardService {
  /** One request per call; the view is the caller's, and the service keeps no copy. */
  load(story: StoryId, lang: Lang): Promise<Result<CardView, MetaError>>;
}

export function createCardService(api: Pick<MetaEndpoints, 'postCard'>): CardService {
  return {
    async load(story, lang) {
      const r = await api.postCard(story);
      return r.ok ? { ok: true, value: cardView(story, r.value, lang) } : { ok: false, error: metaError(r.error) };
    },
  };
}

function cardView(story: StoryId, card: CardResponse, lang: Lang): CardView {
  // The ids are the server's own, read back only as keys and names: the brands are asserted here, at the edge.
  return {
    storyId: story,
    runs: card.runs,
    chaptersCompleted: card.chaptersCompleted.map((id) => id as ChapterId),
    endings: card.endings.map((e) => ({ name: e.name as EndingName, title: e.title[lang], firstReachedAt: e.firstReachedAt })),
    achievements: card.achievements.map((a) => ({
      id: a.id as AchievementId,
      name: a.name[lang],
      description: a.description[lang],
      unlockedAt: a.unlockedAt,
      isNew: a.new,
    })),
  };
}
