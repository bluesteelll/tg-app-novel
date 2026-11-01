// The UI string table in English, the second language. Typed by ru.ts's keys: a key missing here is TS2741 and an
// extra one TS2353, so the two tables cannot drift (the placeholders are checked by a test).
import type { UiKey } from './index.ts';

/** Every UI string of the overlay, in English. */
export const en: Record<UiKey, string> = {
  'tap.continue_story': 'Continue: {story}',
  'quick.advance': 'Next',
  'quick.choose': 'Choose an option',
  'quick.auto': 'Auto',
  'quick.skip': 'Skip',
  'quick.backlog': 'History',
  'quick.menu': 'Menu',
  'toast.resume_checkpoint': 'The story was updated: resuming from the start of the scene',
  'toast.resume_chapter_start': 'The story was updated: resuming from the start of the chapter',
  'toast.save_conflict': 'Progress was saved on another device',
  'toast.save_conflict_load': 'Load it',
  'toast.save_conflict_keep': 'Keep playing here',
  'toast.sound_resume': 'Tap to resume sound',
  'toast.purchase_failed': 'Payment failed',
  'toast.purchase_refunded': 'The purchase was refunded',
  'toast.close': 'Close',
};
