// The boot list's summary lookup, in its own module (RULINGS 158, L1): boot reads summaries on the entry (Home's
// Continue, a card's Continue), while the save service and its pending cache are created only by the engine and load
// with its chunk. Type imports only, so the entry carries this one function and nothing of the service.
import type { SaveListResponse, SaveSlot, SaveSummary } from '../api/generated/api.ts';
import type { StoryId } from '../story/catalog.ts';

/** The summary of (story, slot) in the boot list: a lookup by key, never by position (the order is the collation's). */
export function summaryOf(list: SaveListResponse, story: StoryId, slot: SaveSlot): SaveSummary | null {
  return list.slots.find((s) => s.storyId === story && s.slot === slot) ?? null;
}
