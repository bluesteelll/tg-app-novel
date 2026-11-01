// The values carried between chapters (PROTOTYPE-PLAN K8): the g_ globals every chapter declares through the one shared
// globals.ink. A chapter's `next` stays on its story's chain (STORIES-PLAN Y3), so nothing here checks the story; a
// story's first chapter is started with `{}` by its caller. Pure: no inkjs (the runner owns the Story).
import type { ChapterMeta, InkScalar } from './catalog.ts';
import type { VarName } from './staging.ts';

/** The carry into a chapter: only the globals it declares, so a global a story update removed never reaches a write. */
export function carryInto(carry: Readonly<Record<VarName, InkScalar>>, meta: ChapterMeta): Record<VarName, InkScalar> {
  const out: Record<VarName, InkScalar> = {};
  for (const name of meta.globals) {
    if (Object.hasOwn(carry, name)) {
      const v = carry[name];
      if (v !== undefined) {
        out[name] = v;
      }
    }
  }
  return out;
}
