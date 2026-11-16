// The scene-motion chunk's root (lane SH7, D1): the face animator, which the scene controller import()s after the
// session's first applied step; nothing reaches it statically from outside this directory (arch rule `scene-lazy`).
import { createFaceAnimator, TALK_MAX_MS } from './animator.ts';
import type { MotionKit } from './animator.ts';

export const motionKit: MotionKit = { face: createFaceAnimator, talkMaxMs: TALK_MAX_MS };
