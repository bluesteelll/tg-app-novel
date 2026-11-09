// The family root action (engine plan §8.3; GM3s): one capture listener per `CUE_TRIGGERS` kind on a family root (the
// explore layer's root; GM3p's frame root), which emits a `ui` cue for a `[data-cue]` control on its declared trigger,
// before the control's own handler, from the control's innermost root only. The root's entrance and exit are the cue
// stage's motions (RULINGS 195: Svelte's transition runtime measured past §3.5's entry line), so the action also stamps
// the root's birth, from which the stage plays an entrance it sees late. Also the explore sheets' panel markers. DOM
// code, in each family root's chunk (`rules-lazy`).
import type { ScreenKind } from '../ui/screens.ts';
import type { ItemId } from '../world/types.ts';
import type { ControlCue, CUE_TRIGGERS, CueEvent } from './types.ts';

/** The root's emit: the session's bus; none until a session gives one. */
export type CueEmit = ((e: CueEvent) => void) | undefined;

/** `never` when the two tuples drift apart (order included), which fails `check` at `ROOT_TRIGGERS`. */
type SameTuple<A, B> = [A] extends [B] ? ([B] extends [A] ? A : never) : never;
const TRIGGERS = ['click', 'pointerdown', 'input', 'change', 'keydown'] as const;
/**
 * The root's own copy of `CUE_TRIGGERS` (RULINGS 201 E2): a value import of `cues/types.ts` here and in the cue stage
 * would give the two lazy chunks a shared chunk and the player one request more. Tied to it by type and by a test.
 */
export const ROOT_TRIGGERS: SameTuple<typeof TRIGGERS, typeof CUE_TRIGGERS> = TRIGGERS;

/**
 * The explore sheets' `data-cue-panel` values, each a screen kind (§8.5 "Cue targets", `panel`). Named here, not
 * written in ExploreView, whose source the explore components' I/O scan reads for the word the reader's kind is.
 */
export const SHEET_PANELS = { inventory: 'inventory', reader: 'document', lock: 'lock' } as const satisfies Record<string, ScreenKind>;

export function cueRoot(node: HTMLElement, emit: CueEmit): { update(next: CueEmit): void; destroy(): void } {
  let current = emit;
  const on = (ev: Event): void => {
    const el = ev.target instanceof Element ? ev.target.closest<HTMLElement>('[data-cue]') : null;
    // The control's innermost root is this one (a nested root emits its own), and the event is its declared trigger.
    if (el === null || el.closest('[data-cue-root]') !== node || ev.type !== (el.dataset.cueOn ?? 'click')) {
      return;
    }
    const r = node.getBoundingClientRect();
    const index = el.dataset.cueIndex;
    current?.({
      cue: {
        kind: 'ui',
        // The controls gate (§8.3) holds every `data-cue` / `data-cue-item` value to its type.
        control: el.dataset.cue as ControlCue,
        item: (el.dataset.cueItem ?? null) as ItemId | null,
        index: index === undefined ? null : Number(index),
      },
      box: null,
      point: ev instanceof MouseEvent ? { x: ev.clientX - r.left, y: ev.clientY - r.top } : null,
      diff: [],
      el,
    });
  };
  for (const t of ROOT_TRIGGERS) {
    node.addEventListener(t, on, true);
  }
  // F4: the stage may first see this root a flush late (both mount in one flush); it enters from this time.
  node.dataset.cueBorn = String(performance.now());
  return {
    update(next) {
      current = next;
    },
    destroy() {
      for (const t of ROOT_TRIGGERS) {
        node.removeEventListener(t, on, true);
      }
    },
  };
}
