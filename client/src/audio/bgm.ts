// BGM (PROTOTYPE-PLAN "Audio", K24): two looping HTMLAudioElement decks, each routed once through a
// MediaElementAudioSourceNode and its own gain into the bgm bus. Music stays compressed in the element (a decoded 3 MB
// track would be about 60 MiB of float32), and every level change is a gain ramp: iOS ignores the element's volume.
// Imported only by manager.ts, which also takes the gain helpers from here.
import type { AssetEntry } from '../story/catalog.ts';
import type { TrackId } from '../story/staging.ts';

/** A manifest entry of the audio kind. */
export type AudioEntry = Extract<AssetEntry, { kind: 'audio' }>;

// The public tier: a static file of the client build, streamed by URL. Every other URL is gated.
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

type DeckState = 'idle' | 'playing' | 'fading-out';

type Deck = {
  readonly el: HTMLAudioElement;
  readonly gain: GainRamp;
  state: DeckState;
  track: TrackId | null;
  /** The manifest URL the deck holds: `el.src` is never read back (browsers make it absolute). */
  url: string | null;
  timer: ReturnType<typeof setTimeout> | null;
};

/** The two-deck player the manager drives; track ids arrive resolved to their manifest entries. */
export type Bgm = {
  /** Crossfades to `track` over `fadeMs`, at `vol` percent of the bus. */
  play(track: TrackId, entry: AudioEntry, vol: number, fadeMs: number): void;
  /** Fades the playing track out over `fadeMs`. */
  stop(fadeMs: number): void;
};

function createDeck(ctx: AudioContext, out: AudioNode): Deck {
  const el = new Audio();
  el.loop = true;
  const node = ctx.createGain();
  // Once per element: the element's output is re-routed into the graph, and a second source node for it throws.
  ctx.createMediaElementSource(el).connect(node);
  node.connect(out);
  return { el, gain: new GainRamp(ctx, node.gain, 0), state: 'idle', track: null, url: null, timer: null };
}

/** Creates both decks into `out` (the bgm bus); elements, source nodes and deck gains live as long as the app. */
export function createBgm(ctx: AudioContext, out: AudioNode): Bgm {
  const decks: readonly [Deck, Deck] = [createDeck(ctx, out), createDeck(ctx, out)];

  const release = (d: Deck): void => {
    if (d.timer !== null) {
      clearTimeout(d.timer);
      d.timer = null;
    }
    d.el.pause();
    // Without a source, load() ends the element's download and frees its media buffers.
    d.el.removeAttribute('src');
    d.el.load();
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

  return {
    play(track, entry, vol, fadeMs) {
      const url = entry.file.url;
      if (!url.startsWith(PUBLIC_PREFIX)) {
        return; // a gated file is never set on a bare element: the element cannot carry the session
      }
      const old = decks.find((d) => d.state === 'playing');
      const next = freeDeck(old);
      next.state = 'playing';
      next.track = track;
      next.url = url;
      next.el.src = url;
      next.gain.to(toGain(vol), fadeMs, 0);
      // A refused play() leaves the deck silent with its state kept.
      void next.el.play().catch(() => undefined);
      if (old !== undefined) {
        fadeOut(old, fadeMs);
      }
    },
    stop(fadeMs) {
      const playing = decks.find((d) => d.state === 'playing');
      if (playing !== undefined) {
        fadeOut(playing, fadeMs);
      }
    },
  };
}
