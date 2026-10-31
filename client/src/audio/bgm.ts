// BGM (PROTOTYPE-PLAN "Audio", K24): two looping HTMLAudioElement decks, each routed once through a
// MediaElementAudioSourceNode and its own gain into the bgm bus. Music stays compressed in the element (a decoded 3 MB
// track would be about 60 MiB of float32), and every level change is a gain ramp: iOS ignores the element's volume.
// A gated track arrives through the injected fetchAsset (an element cannot carry the session) and plays from an object
// URL that the deck revokes when it lets the track go. Imported only by manager.ts, which also takes the gain helpers.
import type { AssetEntry, FetchAsset } from '../story/catalog.ts';
import type { StagingSnapshot, TrackId } from '../story/staging.ts';

/** A manifest entry of the audio kind. */
export type AudioEntry = Extract<AssetEntry, { kind: 'audio' }>;

// The public tier: a static file of the client build, streamed by URL. Every other URL goes through fetchAsset, so a
// gated file misread as public would be a refused request on a bare element, never a leak.
const PUBLIC_PREFIX = '/assets/';

/** 0-100 (a bus volume or a tag's `vol`) to a linear gain: out of range clamps, NaN is silence. */
export function toGain(percent: number): number {
  return Number.isNaN(percent) ? 0 : Math.min(100, Math.max(0, percent)) / 100;
}

/**
 * One AudioParam's automation, kept by its owner. The value at a moment is interpolated from the last ramp, never
 * read back from `AudioParam.value`, which browsers report differently while automation runs.
 */
export class GainRamp {
  readonly #ctx: BaseAudioContext;
  readonly #param: AudioParam;
  #from: number;
  #to: number;
  #t0 = 0;
  #t1 = 0;

  constructor(ctx: BaseAudioContext, param: AudioParam, initial: number) {
    this.#ctx = ctx;
    this.#param = param;
    this.#from = initial;
    this.#to = initial;
    param.value = initial;
  }

  /** The value the automation ends at. */
  get target(): number {
    return this.#to;
  }

  /** The value now. */
  held(): number {
    const t = this.#ctx.currentTime;
    if (t >= this.#t1) {
      return this.#to;
    }
    if (t <= this.#t0) {
      return this.#from;
    }
    return this.#from + ((this.#to - this.#from) * (t - this.#t0)) / (this.#t1 - this.#t0);
  }

  /** Ramps from `from` (default: the value now) to `target` over `ms`; 0 ms sets it now. */
  to(target: number, ms: number, from: number = this.held()): void {
    const now = this.#ctx.currentTime;
    const end = ms > 0 ? now + ms / 1000 : now;
    this.#param.cancelScheduledValues(now);
    if (ms > 0) {
      this.#param.setValueAtTime(from, now);
      this.#param.linearRampToValueAtTime(target, end);
    } else {
      this.#param.setValueAtTime(target, now);
    }
    this.#from = ms > 0 ? from : target;
    this.#to = target;
    this.#t0 = now;
    this.#t1 = end;
  }
}

/**
 * At most one deck is the target: `loading` (a gated track downloading, no src yet, silent) or `playing`. The other is
 * `idle`, `waiting` (the previous track at its level until the loading target has its bytes, so a 3 MB download is no
 * silent gap; only beside a loading target) or `fading-out` (ramping to 0, released by its timer).
 */
type DeckState = 'idle' | 'loading' | 'playing' | 'waiting' | 'fading-out';

type Deck = {
  readonly el: HTMLAudioElement;
  readonly gain: GainRamp;
  state: DeckState;
  track: TrackId | null;
  /** The manifest URL the deck holds: `el.src` is never read back (browsers make it absolute). */
  url: string | null;
  /** The object URL of a gated track's bytes, revoked at release. */
  blobUrl: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** The gated request in flight; a result for any other controller is stale. */
  abort: AbortController | null;
  /** The level and fade the deck starts with once its src is set. */
  landing: { vol: number; fadeMs: number };
};

/** The two-deck player the manager drives; track ids arrive resolved to their manifest entries. */
export type Bgm = {
  /** Crossfades to `track` over `fadeMs` at `vol` percent of the bus; the track already playing only changes level. */
  play(track: TrackId, entry: AudioEntry, vol: number, fadeMs: number): void;
  /** Fades the music out over `fadeMs`. */
  stop(fadeMs: number): void;
  /** A snapshot's bgm, at once: no fade outlives it, and the track already sounding is never restarted. */
  restore(s: { track: TrackId; entry: AudioEntry; vol: number } | null): void;
  /** The logical bgm: set when a command is applied, also while its bytes load (STAGING-DSL §7). */
  current(): StagingSnapshot['bgm'];
};

function createDeck(ctx: AudioContext, out: AudioNode): Deck {
  const el = new Audio();
  el.loop = true;
  const node = ctx.createGain();
  // Once per element: the element's output is re-routed into the graph, and a second source node for it throws.
  ctx.createMediaElementSource(el).connect(node);
  node.connect(out);
  return {
    el,
    gain: new GainRamp(ctx, node.gain, 0),
    state: 'idle',
    track: null,
    url: null,
    blobUrl: null,
    timer: null,
    abort: null,
    landing: { vol: 0, fadeMs: 0 },
  };
}

/** Creates both decks into `out` (the bgm bus); elements, source nodes and deck gains live as long as the app. */
export function createBgm(ctx: AudioContext, out: AudioNode, deps: { fetchAsset: FetchAsset }): Bgm {
  const decks: readonly [Deck, Deck] = [createDeck(ctx, out), createDeck(ctx, out)];
  let logical: { track: TrackId; vol: number } | null = null;

  const release = (d: Deck): void => {
    if (d.timer !== null) {
      clearTimeout(d.timer);
      d.timer = null;
    }
    if (d.abort !== null) {
      d.abort.abort();
      d.abort = null;
    }
    if (d.state !== 'idle' && d.state !== 'loading') {
      d.el.pause();
      // Without a source, load() ends the element's download and frees its media buffers.
      d.el.removeAttribute('src');
      d.el.load();
    }
    // Only after the element let go of it: it may range-read the blob while it holds it.
    if (d.blobUrl !== null) {
      URL.revokeObjectURL(d.blobUrl);
      d.blobUrl = null;
    }
    d.state = 'idle';
    d.track = null;
    d.url = null;
  };

  const fadeOut = (d: Deck, ms: number): void => {
    if (ms <= 0) {
      release(d);
      return;
    }
    d.state = 'fading-out';
    d.gain.to(0, ms);
    if (d.timer !== null) {
      clearTimeout(d.timer);
    }
    d.timer = setTimeout(() => {
      d.timer = null;
      release(d);
    }, ms);
  };

  const fadeOutWaiting = (ms: number): void => {
    for (const d of decks) {
      if (d.state === 'waiting') {
        fadeOut(d, ms);
      }
    }
  };

  const target = (): Deck | undefined => decks.find((d) => d.state === 'loading' || d.state === 'playing');

  /** The deck a new track goes to, never `keep`: an idle one first, else the quieter one, released at once. */
  const freeDeck = (keep: Deck | undefined): Deck => {
    const [a, b] = decks;
    let d: Deck;
    if (keep === a) {
      d = b;
    } else if (keep === b || a.state === 'idle') {
      d = a;
    } else if (b.state === 'idle') {
      d = b;
    } else {
      d = a.gain.held() <= b.gain.held() ? a : b;
    }
    if (d.state !== 'idle') {
      release(d);
    }
    return d;
  };

  /** The deck has its src: it fades in, and the deck that waited for it fades out. */
  const land = (d: Deck, src: string): void => {
    d.state = 'playing';
    d.el.src = src;
    d.gain.to(toGain(d.landing.vol), d.landing.fadeMs, 0);
    // A refused play() leaves the deck silent with its state kept.
    void d.el.play().catch(() => undefined);
    fadeOutWaiting(d.landing.fadeMs);
  };

  const take = (d: Deck, track: TrackId, url: string, vol: number, fadeMs: number): void => {
    d.track = track;
    d.url = url;
    d.landing = { vol, fadeMs };
    if (url.startsWith(PUBLIC_PREFIX)) {
      land(d, url);
      return;
    }
    d.state = 'loading';
    const request = new AbortController();
    d.abort = request;
    // FetchAsset reports every failure as a value, so the chain has no rejection to handle.
    void deps.fetchAsset(url, request.signal).then((r) => {
      if (d.abort !== request) {
        return; // superseded or released meanwhile: a stale result creates no URL
      }
      d.abort = null;
      if (!r.ok) {
        // The track stays silent (fetchAsset already re-authed and retried); the logical state keeps it for a save.
        const ms = d.landing.fadeMs;
        release(d);
        fadeOutWaiting(ms);
        return;
      }
      d.blobUrl = URL.createObjectURL(r.value);
      land(d, d.blobUrl);
    });
  };

  const play = (track: TrackId, entry: AudioEntry, vol: number, fadeMs: number): void => {
    logical = { track, vol };
    const url = entry.file.url;
    const holds = (d: Deck): boolean => d.track === track && d.url === url;
    const t = target();
    if (t !== undefined && holds(t)) {
      // Re-issuing the track does not restart it: only its level moves (STAGING-DSL `bgm`).
      if (t.state === 'playing') {
        t.gain.to(toGain(vol), fadeMs);
      } else {
        t.landing = { vol, fadeMs };
      }
      return;
    }
    const back = decks.find((d) => d !== t && (d.state === 'waiting' || d.state === 'fading-out') && holds(d));
    if (back !== undefined) {
      // Back to a track that still sounds: revived from its level, with no new src and no new download.
      if (back.timer !== null) {
        clearTimeout(back.timer);
        back.timer = null;
      }
      back.state = 'playing';
      back.gain.to(toGain(vol), fadeMs);
      if (t?.state === 'loading') {
        release(t);
      } else if (t !== undefined) {
        fadeOut(t, fadeMs);
      }
      return;
    }
    if (t?.state === 'loading') {
      // The target is still silent: the new track takes its place, and whatever sounds keeps waiting.
      release(t);
      take(t, track, url, vol, fadeMs);
      return;
    }
    if (t !== undefined) {
      t.state = 'waiting';
    }
    take(freeDeck(t), track, url, vol, fadeMs);
  };

  const stop = (fadeMs: number): void => {
    logical = null;
    const t = target();
    if (t?.state === 'loading') {
      release(t);
      fadeOutWaiting(fadeMs);
    } else if (t !== undefined) {
      fadeOut(t, fadeMs);
    }
  };

  return {
    play,
    stop,
    restore(s) {
      if (s === null) {
        stop(0);
      } else {
        play(s.track, s.entry, s.vol, 0);
      }
      for (const d of decks) {
        if (d.state === 'fading-out') {
          release(d);
        }
      }
    },
    current: () => (logical === null ? null : { ...logical }),
  };
}
