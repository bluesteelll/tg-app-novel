// The pending autosave of one story (PROTOTYPE-PLAN K13 and F3 steps 3 and 5; STORIES-PLAN Y7): DeviceStorage key
// `pending_<storyId>` through the facade, written while the newest body is not acknowledged. A cache, never a source of
// truth: on reload it is uploaded only when the server's copy is the one it was based on or one of our own writes, and
// otherwise discarded, so the server wins (principle 1). No DeviceStorage (below Bot API 9.0) or a failed set means no
// cache, never an error. The per-value limit is undocumented ("up to 5 MB per user"); a story's body is at most 256 KiB.
import type { SaveSummary } from '../api/generated/api.ts';
import type { StoryId } from '../story/catalog.ts';
import type { ChapterId, LineId, StoryVersion } from '../story/staging.ts';
import type { TelegramClient } from '../telegram/index.ts';
import type { SaveWrite } from './service.ts';

/** The facade's DeviceStorage (9.0+). */
export type DeviceStore = NonNullable<TelegramClient['device']>;

/** F3 step 3: the newest unacknowledged body, the rev it was based on and the writeIds sent since that rev. */
export type PendingEntry = { v: 1; baseRev: number | null; sentIds: readonly string[]; writeId: string; write: SaveWrite };

export function pendingKey(story: StoryId): string {
  return `pending_${story}`;
}

export function encodePending(e: PendingEntry): string {
  const { chapterId, storyVersion, lineId, body } = e.write;
  return JSON.stringify({ v: 1, baseRev: e.baseRev, sentIds: e.sentIds, writeId: e.writeId, write: { chapterId, storyVersion, lineId, body } });
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The entry, or `null` for anything this version did not write (the caller clears it). */
export function decodePending(raw: string): PendingEntry | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(v) || v['v'] !== 1 || !isRecord(v['write'])) {
    return null;
  }
  const { baseRev, sentIds, writeId } = v;
  const { chapterId, storyVersion, lineId, body } = v['write'];
  const revOk = baseRev === null || (typeof baseRev === 'number' && Number.isSafeInteger(baseRev));
  const idsOk = Array.isArray(sentIds) && sentIds.every((id) => typeof id === 'string');
  if (
    !revOk ||
    !idsOk ||
    typeof writeId !== 'string' ||
    typeof chapterId !== 'string' ||
    typeof storyVersion !== 'string' ||
    (lineId !== null && typeof lineId !== 'string') ||
    typeof body !== 'string'
  ) {
    return null;
  }
  return {
    v: 1,
    baseRev,
    sentIds,
    writeId,
    // Our own encoder wrote these from branded values; the server validates the chapter and line again on upload.
    write: { chapterId: chapterId as ChapterId, storyVersion: storyVersion as StoryVersion, lineId: lineId as LineId | null, body },
  };
}

/**
 * F3 step 5: upload the entry only if the server still holds what it was based on, or one of our own writes; with no
 * server copy, only an entry that was based on none.
 */
export function shouldUpload(p: PendingEntry, server: SaveSummary | null): boolean {
  return server === null ? p.baseRev === null : p.baseRev === server.rev || p.sentIds.includes(server.writeId);
}

/** The story's entry. Operations run one after another, so a `clear()` issued after a `write()` lands after it. */
export interface PendingStore {
  read(): Promise<PendingEntry | null>;
  write(e: PendingEntry): Promise<void>;
  clear(): Promise<void>;
}

export function createPendingStore(device: DeviceStore | null, story: StoryId): PendingStore {
  if (device === null) {
    return { read: async () => null, write: async () => {}, clear: async () => {} };
  }
  const key = pendingKey(story);
  let tail: Promise<void> = Promise.resolve();
  let busy = 0;
  /**
   * Runs `op` after the operations before it. With none running it starts now, synchronously: on `pagehide` the
   * device call is issued before the handler returns, not one native round trip later.
   */
  const queue = <T>(op: () => Promise<T>): Promise<T> => {
    const run = busy === 0 ? op() : tail.then(op);
    busy += 1;
    tail = run.then(
      () => {
        busy -= 1;
      },
      () => {
        busy -= 1;
      },
    );
    return run;
  };
  return {
    read: () =>
      queue(async () => {
        const r = await device.get(key);
        if (!r.ok || r.value === null) {
          return null;
        }
        const entry = decodePending(r.value);
        if (entry === null) {
          await device.set(key, null);
        }
        return entry;
      }),
    // A refused set leaves no cache, which K13 accepts: the result is not an error for the caller.
    write: (e) =>
      queue(async () => {
        await device.set(key, encodePending(e));
      }),
    clear: () =>
      queue(async () => {
        await device.set(key, null);
      }),
  };
}
