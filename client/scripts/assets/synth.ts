// Placeholder audio (PROTOTYPE-PLAN K23, "Audio"): a sine tone synthesized to WAV by our own code, since no AAC
// encoder exists without ffmpeg (the real-audio lane adds it, PP "Later"). 22.05 kHz mono 16-bit PCM: a BGM loop is
// 8 s (352,844 B, inside K23's 400 KB WAV cap), an SFX 0.6 s. Pure: the same tone gives the same bytes.
import type { AudioPlaceholder } from '../../src/story/catalog.ts';

export const SAMPLE_RATE = 22_050;
/** Per role, the clip length; both give a whole number of samples at SAMPLE_RATE. */
export const DURATION_MS: Readonly<Record<'bgm' | 'sfx', number>> = { bgm: 8_000, sfx: 600 };
const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
/** A linear fade at both ends, so a looping BGM does not click at the seam. */
const FADE_MS = 50;
/** 0.4 of full scale: audible, never clipping. */
const AMPLITUDE = 0.4 * 32_767;

/** One placeholder clip as a RIFF/WAVE file, and its duration. */
export function synthWav(role: 'bgm' | 'sfx', p: AudioPlaceholder): { wav: Uint8Array; durationMs: number } {
  const durationMs = DURATION_MS[role];
  const samples = (SAMPLE_RATE * durationMs) / 1000;
  if (!Number.isInteger(samples)) {
    throw new Error(`invariant: ${durationMs} ms is a whole number of samples at ${SAMPLE_RATE} Hz`);
  }
  const dataLen = samples * BYTES_PER_SAMPLE;
  const wav = new Uint8Array(HEADER_BYTES + dataLen);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataLen, true);
  const fade = Math.floor((SAMPLE_RATE * FADE_MS) / 1000);
  const step = (2 * Math.PI * p.hz) / SAMPLE_RATE;
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / fade, (samples - 1 - i) / fade);
    view.setInt16(HEADER_BYTES + BYTES_PER_SAMPLE * i, Math.round(AMPLITUDE * envelope * Math.sin(step * i)), true);
  }
  return { wav, durationMs };
}
