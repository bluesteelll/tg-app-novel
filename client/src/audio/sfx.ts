// SFX (PROTOTYPE-PLAN "Audio", SFX): one-shots fetched through the injected fetchAsset, decoded into AudioBuffers and
// cached under a byte cap, each tagged with the chapters it serves so a chapter change keeps only the next chapter's.
// Every play is a voice (buffer source + gain into the sfx bus) that disconnects itself when it ends. Imported only by
// manager.ts.
import type { FetchAsset } from '../story/catalog.ts';
import type { AssetId, ChapterId } from '../story/staging.ts';
import { toGain } from './bgm.ts';

/** The decoded bytes the cache holds at most: the 8 MiB line of the steady memory total (PROTOTYPE-PLAN "Budgets"). */
export const SFX_CACHE_CAP_BYTES = 8_388_608;
/** Live one-shots at most; one more stops the oldest. */
export const MAX_SFX_VOICES = 8;

type Entry = {
  readonly url: string;
  /** The chapters it was played or preloaded for; a chapter change keeps it only if it names the new one. */
  chapters: Set<ChapterId>;
  /** Null while it loads. */
  buffer: AudioBuffer | null;
  bytes: number;
  abort: AbortController | null;
  /** The least recently used ready entry is evicted first. */
  used: number;
  /** Plays asked for while it loads, honoured only within the batch that asked (`batch`). */
  waiting: number[];
  batch: number;
};

type Voice = { readonly src: AudioBufferSourceNode; readonly gain: GainNode; done: boolean };

/** The SFX cache and voices the manager drives; ids arrive resolved to their manifest URL and chapter. */
export type Sfx = {
  /** Loads `id` for `chapter` unless it is cached (or loading) from the same URL, which only gains the tag. */
  preload(id: AssetId, url: string, chapter: ChapterId): void;
  /** Plays `id` at `vol` percent of the bus now, or on arrival if it is still loading and no newer batch began. */
  play(id: AssetId, url: string, chapter: ChapterId, vol: number): void;
  /** A new batch began: one-shots still loading for an earlier one never play. */
  nextBatch(): void;
  /** Releases every entry not tagged `chapter` (all of them for null); the kept ones keep only that tag. */
  keepOnly(chapter: ChapterId | null): void;
  /** Decoded bytes held. */
  bytes(): number;
};

/** Creates the cache and the voices into `out` (the sfx bus). */
export function createSfx(ctx: AudioContext, out: AudioNode, deps: { fetchAsset: FetchAsset }): Sfx {
  const cache = new Map<AssetId, Entry>();
  const voices: Voice[] = [];
  let decoded = 0;
  let clock = 0;
  let batch = 0;

  const drop = (id: AssetId, e: Entry): void => {
    e.abort?.abort();
    cache.delete(id);
    decoded -= e.bytes;
  };

  /** Admits nothing over the cap: least recently used ready entries go first, never the one just decoded. */
  const evict = (keep: Entry): void => {
    while (decoded > SFX_CACHE_CAP_BYTES) {
      let oldest: [AssetId, Entry] | null = null;
      for (const [id, e] of cache) {
        if (e !== keep && e.buffer !== null && (oldest === null || e.used < oldest[1].used)) {
          oldest = [id, e];
        }
      }
      if (oldest === null) {
        return;
      }
      drop(oldest[0], oldest[1]);
    }
  };

  const end = (v: Voice): void => {
    if (v.done) {
      return;
    }
    v.done = true;
    v.src.onended = null;
    v.src.disconnect();
    v.gain.disconnect();
    const i = voices.indexOf(v);
    if (i >= 0) {
      voices.splice(i, 1);
    }
  };

  const voice = (buffer: AudioBuffer, vol: number): void => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = toGain(vol);
    src.connect(gain);
    gain.connect(out);
    const v: Voice = { src, gain, done: false };
    src.onended = () => end(v);
    voices.push(v);
    src.start();
    while (voices.length > MAX_SFX_VOICES) {
      const oldest = voices[0];
      if (oldest === undefined) {
        break;
      }
      oldest.src.stop();
      end(oldest);
    }
  };

  const fill = async (id: AssetId, e: Entry, signal: AbortSignal): Promise<void> => {
    const r = await deps.fetchAsset(e.url, signal);
    if (cache.get(id) !== e) {
      return; // released or replaced meanwhile
    }
    if (!r.ok) {
      cache.delete(id); // silent this time; a later play or preload tries again
      return;
    }
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(await r.value.arrayBuffer());
    } catch {
      if (cache.get(id) === e) {
        cache.delete(id); // a file the browser cannot decode stays silent
      }
      return;
    }
    if (cache.get(id) !== e) {
      return;
    }
    e.abort = null;
    e.buffer = buffer;
    // Admitted at decode end: the decoded size depends on the context's rate, which the manifest does not carry.
    e.bytes = buffer.length * buffer.numberOfChannels * 4; // float32 samples
    decoded += e.bytes;
    evict(e);
    if (e.batch === batch) {
      for (const vol of e.waiting) {
        voice(buffer, vol);
      }
    }
    e.waiting = [];
  };

  const load = (id: AssetId, url: string, chapter: ChapterId): Entry => {
    const request = new AbortController();
    clock += 1;
    const e: Entry = { url, chapters: new Set([chapter]), buffer: null, bytes: 0, abort: request, used: clock, waiting: [], batch };
    cache.set(id, e);
    // FetchAsset reports failures as values and a decode failure is caught inside: nothing rejects here.
    void fill(id, e, request.signal);
    return e;
  };

  /** The entry for `id` from `url`, tagged `chapter`; a cached one from another URL (other bytes) is replaced. */
  const entry = (id: AssetId, url: string, chapter: ChapterId): Entry => {
    const e = cache.get(id);
    if (e !== undefined && e.url === url) {
      e.chapters.add(chapter);
      clock += 1;
      e.used = clock;
      return e;
    }
    if (e !== undefined) {
      drop(id, e);
    }
    return load(id, url, chapter);
  };

  return {
    preload(id, url, chapter) {
      entry(id, url, chapter);
    },
    play(id, url, chapter, vol) {
      const e = entry(id, url, chapter);
      if (e.buffer !== null) {
        voice(e.buffer, vol);
        return;
      }
      if (e.batch !== batch) {
        e.batch = batch;
        e.waiting = [];
      }
      e.waiting.push(vol);
    },
    nextBatch() {
      batch += 1;
    },
    keepOnly(chapter) {
      for (const [id, e] of cache) {
        if (chapter !== null && e.chapters.has(chapter)) {
          e.chapters = new Set([chapter]);
        } else {
          drop(id, e);
        }
      }
    },
    bytes: () => decoded,
  };
}
