// The audio engine (PROTOTYPE-PLAN "Audio", K24): a bgm and an sfx bus into a master gain, the only node that reaches
// the destination. GameSession creates it with the context unlockAudio() made inside the Start tap and calls apply()
// once per batch, beside the scene (F2). Only this file and unlock.ts are imported from outside audio/.
import type { AssetManifest, FetchAsset } from '../story/catalog.ts';
import type { AssetId, StagingCommand } from '../story/staging.ts';
import { createBgm, GainRamp, toGain, type AudioEntry } from './bgm.ts';

/** The staging commands audio plays (STAGING-DSL §6). */
export type AudioCommand = Extract<StagingCommand, { kind: 'bgm' | 'sfx' }>;
/** The bus volumes of the settings, 0-100 each. */
export type Volumes = { master: number; bgm: number; sfx: number };

/** A bus volume change ramps this long, so a moving slider does not click. */
export const VOLUME_RAMP_MS = 50;

/** The audio side of the staging pipeline. */
export interface AudioManager {
  /** One batch: `bgm` first, then `sfx` (STAGING-DSL §7); `instant` (skip mode) turns every fade into a cut. */
  apply(cmds: readonly AudioCommand[], o: { instant: boolean }): void;
  /** The chapter whose manifest resolves track and sfx ids. */
  setChapter(m: AssetManifest | null): void;
  /** The settings' bus volumes, each change ramped. */
  setVolumes(v: Volumes): void;
}

/** The `audio` entry of `role` under `id` in `m`, or null; an own-property lookup, like the catalog's. */
function audioEntry(m: AssetManifest | null, id: string, role: AudioEntry['role']): AudioEntry | null {
  if (m === null || !Object.hasOwn(m.assets, id)) {
    return null;
  }
  const entry = m.assets[id as AssetId]; // the brand: an own key of a decoded manifest, checked above
  return entry !== undefined && entry.kind === 'audio' && entry.role === role ? entry : null;
}

/** Builds the graph on `ctx` (the context unlockAudio() returned); the manager lives as long as the app. */
export function createAudioManager(ctx: AudioContext, _deps: { fetchAsset: FetchAsset }): AudioManager {
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
  const bgm = createBgm(ctx, bgmBus);
  let manifest: AssetManifest | null = null;

  return {
    apply(cmds, o) {
      for (const c of cmds) {
        if (c.kind !== 'bgm') {
          continue;
        }
        const fadeMs = o.instant ? 0 : c.fadeMs;
        if (c.track === null) {
          bgm.stop(fadeMs);
          continue;
        }
        const entry = audioEntry(manifest, `bgm/${c.track}`, 'bgm');
        if (entry !== null) {
          bgm.play(c.track, entry, c.vol, fadeMs);
        }
      }
    },
    setChapter(m) {
      manifest = m;
    },
    setVolumes(v) {
      levels.master.to(toGain(v.master), VOLUME_RAMP_MS);
      levels.bgm.to(toGain(v.bgm), VOLUME_RAMP_MS);
      levels.sfx.to(toGain(v.sfx), VOLUME_RAMP_MS);
    },
  };
}
