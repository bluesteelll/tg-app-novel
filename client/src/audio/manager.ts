// The audio engine (PROTOTYPE-PLAN "Audio", K24): a bgm and an sfx bus into a master gain, the only node that reaches
// the destination. GameSession creates it with the context unlockAudio() made inside the Start tap and calls apply()
// once per batch, beside the scene (F2). Only this file and unlock.ts are imported from outside audio/.
import type { AssetManifest, FetchAsset } from '../story/catalog.ts';
import type { AssetId, StagingCommand, StagingSnapshot } from '../story/staging.ts';
import { createBgm, GainRamp, toGain, type AudioEntry } from './bgm.ts';
import { createSfx } from './sfx.ts';

/** The staging commands audio plays (STAGING-DSL §6). */
export type AudioCommand = Extract<StagingCommand, { kind: 'bgm' | 'sfx' }>;
/** The bus volumes of the settings, 0-100 each. */
export type Volumes = { master: number; bgm: number; sfx: number };

/** A bus volume change ramps this long, so a moving slider does not click. */
export const VOLUME_RAMP_MS = 50;
/** The music of a chapter fades out over the DSL's default fade when the chapter changes (F4). */
export const CHAPTER_FADE_MS = 1000;
/** How long a context may take to run before sound is reported as needing a tap (PROTOTYPE-PLAN "Audio"). */
export const RESUME_GRACE_MS = 500;

/** The audio side of the staging pipeline. */
export interface AudioManager {
  /**
   * One batch: `bgm` first, then `sfx` (STAGING-DSL §7); `instant` (skip mode) turns every fade into a cut. While
   * suspended the music changes deck without playing and one-shots are dropped.
   */
  apply(cmds: readonly AudioCommand[], o: { instant: boolean }): void;
  /** A snapshot's bgm, at once; the track already sounding is never restarted. An id the manifest lacks stops it. */
  restore(bgm: StagingSnapshot['bgm']): void;
  /** The logical bgm a save records: set when the command is applied, also while a gated track loads. */
  currentBgm(): StagingSnapshot['bgm'];
  /**
   * The chapter whose manifest resolves ids (null: none, as on Home). Its music fades out, and every SFX not tagged
   * with the new chapter is released; those preloaded from `m` stay.
   */
  setChapter(m: AssetManifest | null): void;
  /** Fetches and decodes the sfx among `ids`, resolved in `from` (the next chapter's manifest, F5) or the current one. */
  preload(ids: readonly AssetId[], from?: AssetManifest): void;
  /** The settings' bus volumes, each change ramped. */
  setVolumes(v: Volumes): void;
  /** The panel is hidden (`deactivated`): fades complete, the decks pause, one-shots stop, the context suspends. */
  suspend(): void;
  /**
   * Resumes the context and plays the decks, both before the first await so the caller's tap covers them; then
   * 'running', or 'needs-gesture' if the context does not run within 500 ms or a deck's play() is refused.
   */
  resume(): Promise<'running' | 'needs-gesture'>;
  /**
   * `fn(true)` when sound needs a user gesture (a play() refused for want of one, or a context still not running 500 ms
   * after a command wanted sound), `fn(false)` when that ends (the context runs, by itself or by resume(), and no
   * sounding deck stays refused). Returns the unsubscribe.
   */
  onNeedsGesture(fn: (needed: boolean) => void): () => void;
  /** Decoded SFX bytes held and the context state. */
  stats(): { decodedBytes: number; state: AudioContextState };
}

/** The `audio` entry of `role` under `id` in `m`, or null; an own-property lookup, like the catalog's. */
function audioEntry(m: AssetManifest | null, id: AssetId, role: AudioEntry['role']): AudioEntry | null {
  if (m === null || !Object.hasOwn(m.assets, id)) {
    return null;
  }
  const entry = m.assets[id];
  return entry !== undefined && entry.kind === 'audio' && entry.role === role ? entry : null;
}

// STAGING-DSL §8 asset ids; the brand holds once the id resolves in a decoded manifest, which every caller checks.
const trackAsset = (track: string): AssetId => `bgm/${track}` as AssetId;
const sfxAsset = (sfx: string): AssetId => `sfx/${sfx}` as AssetId;

/**
 * Builds the graph on `ctx` (the context unlockAudio() returned). The manager, its nodes and its `statechange`
 * listener on the context live as long as the app.
 */
export function createAudioManager(ctx: AudioContext, deps: { fetchAsset: FetchAsset }): AudioManager {
  let suspended = false; // by suspend(), as opposed to a context the browser has not started
  let stuck = false; // the context stayed off past the grace while sound was wanted
  let needed = false;
  let soundGrace: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(needed: boolean) => void>();

  const master = ctx.createGain();
  master.connect(ctx.destination);
  const bgmBus = ctx.createGain();
  bgmBus.connect(master);
  const sfxBus = ctx.createGain();
  sfxBus.connect(master);
  const levels = {
    master: new GainRamp(ctx, master.gain, 1),
    bgm: new GainRamp(ctx, bgmBus.gain, 1),
    sfx: new GainRamp(ctx, sfxBus.gain, 1),
  };
  const bgm = createBgm(ctx, bgmBus, { fetchAsset: deps.fetchAsset, changed: () => notify() });
  const sfx = createSfx(ctx, sfxBus, deps);
  let manifest: AssetManifest | null = null;

  function notify(): void {
    const now = stuck || bgm.blocked();
    if (now !== needed) {
      needed = now;
      for (const fn of [...listeners]) {
        fn(now);
      }
    }
  }

  function clearSoundGrace(): void {
    if (soundGrace !== null) {
      clearTimeout(soundGrace);
      soundGrace = null;
    }
  }

  // The need follows the context itself: a resume in flight (the Start tap's) or an interruption the browser lifts
  // ends it without a resume() call.
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'running') {
      clearSoundGrace();
      stuck = false;
      notify();
    }
  });

  /** A command wants sound: a context that is off without our suspend() gets the grace before it counts as stuck. */
  function wantSound(): void {
    if (suspended || stuck || soundGrace !== null || ctx.state === 'running') {
      return;
    }
    soundGrace = setTimeout(() => {
      soundGrace = null;
      if (!suspended && ctx.state !== 'running') {
        stuck = true;
        notify();
      }
    }, RESUME_GRACE_MS);
  }

  return {
    apply(cmds, o) {
      sfx.nextBatch(); // every apply is a batch, an empty one included
      const m = manifest;
      if (m === null) {
        return; // no chapter: nothing resolves
      }
      let sound = false;
      for (const c of cmds) {
        if (c.kind !== 'bgm') {
          continue;
        }
        const fadeMs = o.instant ? 0 : c.fadeMs;
        if (c.track === null) {
          bgm.stop(fadeMs);
          continue;
        }
        const entry = audioEntry(m, trackAsset(c.track), 'bgm');
        if (entry !== null) {
          bgm.play(c.track, entry, c.vol, fadeMs);
          sound = true;
        }
      }
      for (const c of cmds) {
        if (c.kind !== 'sfx' || suspended) {
          continue;
        }
        const id = sfxAsset(c.sfx);
        const entry = audioEntry(m, id, 'sfx');
        if (entry !== null) {
          sfx.play(id, entry.file.url, m.chapterId, c.vol);
          sound = true;
        }
      }
      if (sound) {
        wantSound();
      }
    },
    restore(s) {
      const entry = s === null ? null : audioEntry(manifest, trackAsset(s.track), 'bgm');
      bgm.restore(s !== null && entry !== null ? { track: s.track, entry, vol: s.vol } : null);
    },
    currentBgm: () => bgm.current(),
    setChapter(m) {
      sfx.keepOnly(m === null ? null : m.chapterId);
      bgm.stop(CHAPTER_FADE_MS);
      manifest = m;
    },
    preload(ids, from) {
      const m = from ?? manifest;
      if (m === null) {
        return;
      }
      for (const id of ids) {
        // Only sfx are fetched ahead: music streams on demand, and a gated track's head would be its whole file.
        const entry = audioEntry(m, id, 'sfx');
        if (entry !== null) {
          sfx.preload(id, entry.file.url, m.chapterId);
        }
      }
    },
    setVolumes(v) {
      levels.master.to(toGain(v.master), VOLUME_RAMP_MS);
      levels.bgm.to(toGain(v.bgm), VOLUME_RAMP_MS);
      levels.sfx.to(toGain(v.sfx), VOLUME_RAMP_MS);
    },
    suspend() {
      suspended = true;
      clearSoundGrace();
      bgm.suspend();
      sfx.stopAll();
      // Only a closed context refuses; it has nothing left to suspend.
      void ctx.suspend().catch(() => undefined);
    },
    async resume() {
      suspended = false;
      // Both within the caller's turn, before the first await: WebKit lets a tap start a context and an element only
      // inside its own handler.
      const resumed = ctx.resume();
      const plays = bgm.resume();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grace = new Promise<void>((done) => {
        timer = setTimeout(done, RESUME_GRACE_MS);
      });
      await Promise.race([Promise.allSettled([resumed, ...plays]), grace]);
      clearTimeout(timer);
      const running = ctx.state === 'running';
      if (running) {
        clearSoundGrace();
      }
      stuck = !running && !suspended;
      notify();
      return running && !bgm.blocked() ? 'running' : 'needs-gesture';
    },
    onNeedsGesture(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    stats: () => ({ decodedBytes: sfx.bytes(), state: ctx.state }),
  };
}
