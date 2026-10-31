// The Android client appends `Telegram-Android/<v> (<maker> <model>; Android <v>; SDK <n>; <class>)` to the user
// agent (R1 §6). The model may contain spaces, so the class is the last `;` token inside the parentheses. The user
// agent is client-controlled: the class only picks render quality, never anything security-relevant.
import type { PerfClass } from './index.ts';

const ANDROID_CLIENT = /Telegram-Android\/\S+ \(([^)]*)\)/;

/** The Android performance class; absent or unknown (iOS, desktop, web, a malformed token) is 'AVERAGE'. */
export function perfClassFromUa(ua: string): PerfClass {
  const inner = ANDROID_CLIENT.exec(ua)?.[1];
  const token = inner?.split(';').at(-1)?.trim();
  return token === 'LOW' || token === 'HIGH' ? token : 'AVERAGE';
}
