// The overlay stack and the one owner of Telegram's BackButton (PROTOTYPE-PLAN K26; PUZZLES-PLAN X12; STORIES-PLAN
// Y14; META-PLAN M27). There is no router and no `history` (principle 5): a root view (Home, the game, a Notice) with
// overlays above it. The button is visible iff an overlay is open or, at the game root, a root-back is set (the room
// path); a press pops the top overlay, else runs the root-back. The button is reached through the facade's own
// `backButton` type, so there is no second definition to drift.
import type { StoryId } from '../story/catalog.ts';
import type { TelegramClient, Unsubscribe } from '../telegram/index.ts';

/** An overlay; every one closes with BackButton. */
export type Screen =
  | { kind: 'menu' }
  | { kind: 'backlog' }
  | { kind: 'settings' }
  | { kind: 'saves' }
  | { kind: 'chapters'; story: StoryId }
  | { kind: 'paywall' }
  | { kind: 'terms' }
  | { kind: 'inventory' }
  | { kind: 'document' }
  | { kind: 'lock' }
  | { kind: 'puzzle' }
  | { kind: 'hints' }
  | { kind: 'card'; story: StoryId }
  | { kind: 'friends' }
  | { kind: 'friend'; handle: string }
  | { kind: 'wallet' }
  | { kind: 'gift'; to: string }
  | { kind: 'consent' }
  | { kind: 'invite'; code: string };

/** An overlay's kind; at most one overlay of each kind is open. */
export type ScreenKind = Screen['kind'];

/** What lies under the overlays; none of them shows a BackButton by itself. Which Notice it is lives elsewhere. */
export type RootView = { kind: 'home' } | { kind: 'game' } | { kind: 'notice' };

/** One frozen state of the stack, handed out on every change. */
export type ScreensView = { readonly root: RootView; readonly overlays: readonly Screen[]; readonly backVisible: boolean };

/** The facade's BackButton. */
export type BackButtonPort = TelegramClient['backButton'];

/** The stack; every method is a no-op after `dispose()`. */
export interface Screens {
  /** Opens `s` on top; a kind already open is truncated to and replaced, so the depth stays bounded by the kinds. */
  push(s: Screen): void;
  /** Closes that kind and everything above it; an absent kind is a no-op. */
  close(kind: ScreenKind): void;
  /** What a press does: pops the top overlay, else runs the root-back; an overlay's own close button calls it too. */
  back(): void;
  /** Changes the root: every overlay closes and the root-back is cleared. */
  setRoot(r: RootView): void;
  /** The game root's back action (the room path, X12), or none; ignored at any other root. */
  setRootBack(fn: (() => void) | null): void;
  view(): ScreensView;
  /** Unsubscribes the press and hides the button; idempotent. */
  dispose(): void;
}

const HOME: RootView = Object.freeze({ kind: 'home' });

function snapshot(root: RootView, overlays: readonly Screen[], rootBack: (() => void) | null): ScreensView {
  const backVisible = overlays.length > 0 || (root.kind === 'game' && rootBack !== null);
  return Object.freeze({ root, overlays: Object.freeze(overlays), backVisible });
}

/**
 * The stack over `deps.back`, starting at `deps.root` (Home by default) with the button hidden. `onView` receives the
 * new snapshot synchronously on every change; `setVisible` is called once here and then only when visibility flips.
 */
export function createScreens(deps: { back: BackButtonPort; onView: (v: ScreensView) => void; root?: RootView }): Screens {
  let overlays: readonly Screen[] = [];
  let rootBack: (() => void) | null = null;
  let current = snapshot(Object.freeze({ ...(deps.root ?? HOME) }), overlays, rootBack);
  let disposed = false;

  const update = (root: RootView): void => {
    const next = snapshot(root, overlays, rootBack);
    const flipped = next.backVisible !== current.backVisible;
    current = next;
    if (flipped) {
      deps.back.setVisible(next.backVisible);
    }
    deps.onView(next);
  };

  const back = (): void => {
    if (disposed) {
      return;
    }
    if (overlays.length > 0) {
      overlays = overlays.slice(0, -1);
      update(current.root);
    } else if (current.root.kind === 'game' && rootBack !== null) {
      rootBack();
    }
  };

  deps.back.setVisible(false);
  const offPress: Unsubscribe = deps.back.onPress(back);

  return {
    push: (s) => {
      if (disposed) {
        return;
      }
      const open = overlays.findIndex((o) => o.kind === s.kind);
      overlays = [...(open === -1 ? overlays : overlays.slice(0, open)), Object.freeze({ ...s })];
      update(current.root);
    },
    close: (kind) => {
      const open = overlays.findIndex((o) => o.kind === kind);
      if (disposed || open === -1) {
        return;
      }
      overlays = overlays.slice(0, open);
      update(current.root);
    },
    back,
    setRoot: (r) => {
      if (disposed) {
        return;
      }
      overlays = [];
      rootBack = null;
      update(Object.freeze({ ...r }));
    },
    setRootBack: (fn) => {
      const next = current.root.kind === 'game' ? fn : null;
      if (disposed || next === rootBack) {
        return;
      }
      rootBack = next;
      update(current.root);
    },
    view: () => current,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      offPress();
      deps.back.setVisible(false);
    },
  };
}
