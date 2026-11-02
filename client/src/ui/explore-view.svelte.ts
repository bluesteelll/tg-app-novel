// The exploration overlay's view store (docs/PUZZLES-PLAN.md X10, X14, X16; LX cut D1): what the explore-ui chunk's
// layer renders. One writer per field: GameSession (app/yields.ts, L15) writes `layer` and `panel`, in step with the
// screens stack; the explore controller writes every other field. It holds views and the loaded layer component,
// never a controller, a world or a Pixi object (principle 7). Every field is `$state.raw` and is replaced, never
// mutated. Statically importable: the lazy component appears here as a type only (the `lazy-ui` arch rule).
import type { Component } from 'svelte';

import type { Box } from '../geom/cover.ts';
import type { Lang } from '../i18n/index.ts';
import type { DocId, Glyph, Hotspot, HotspotKey, ItemId } from '../world/types.ts';

/** One hotspot button: `css` is its box in stage-host px, already cover-mapped and grown to the minimum target. */
export type HotspotView = {
  key: HotspotKey;
  kind: Hotspot['kind'];
  label: string;
  css: Box;
  /** A `look` already examined. */
  done: boolean;
  /** An `exit` or `object` whose lock is not open yet. */
  locked: boolean;
};

/** A held item, in the UI language. */
export type ItemView = { id: ItemId; name: string; desc: string; glyph: Glyph };

/** A found document, in the UI language: one string per paragraph. */
export type DocView = { id: DocId; title: string; body: readonly string[] };

/** The lock panel of one locked hotspot: a filled slot shows its item, an empty one is null. */
export type LockView = {
  key: HotspotKey;
  title: string;
  locked: string;
  slots: ReadonlyArray<ItemView | null>;
  /** The last insert on this lock was refused ("doesn't fit"). */
  refused: boolean;
};

/** The panel open over the rooms; `doc` names the document the reader shows. */
export type ExplorePanel = { kind: 'inventory' } | { kind: 'doc'; doc: DocId } | { kind: 'lock' } | null;

/** The props of the explore-ui chunk's root component (`ui/explore/ExploreView.svelte`). */
export type ExploreLayerProps = {
  lang: Lang;
  hotspots: readonly HotspotView[];
  reveal: boolean;
  items: readonly ItemView[];
  docs: readonly DocView[];
  lock: LockView | null;
  panel: ExplorePanel;
  ontap: (key: HotspotKey) => void;
  oninventory: () => void;
  onreveal: () => void;
  onread: (doc: DocId) => void;
  oninsert: (key: HotspotKey, item: ItemId) => void;
  onclose: () => void;
};

/** The store; App.svelte renders `layer` with these fields once `yields.ts` has loaded it. */
export interface ExploreViewStore {
  /** The explore-ui chunk's root component once `yields.ts` has loaded it. */
  layer: Component<ExploreLayerProps> | null;
  panel: ExplorePanel;
  hotspots: readonly HotspotView[];
  /** The "show spots" outline is on. */
  reveal: boolean;
  items: readonly ItemView[];
  docs: readonly DocView[];
  lock: LockView | null;
}

class ExploreViewState implements ExploreViewStore {
  layer: Component<ExploreLayerProps> | null = $state.raw(null);
  panel: ExplorePanel = $state.raw(null);
  hotspots: readonly HotspotView[] = $state.raw([]);
  reveal: boolean = $state.raw(false);
  items: readonly ItemView[] = $state.raw([]);
  docs: readonly DocView[] = $state.raw([]);
  lock: LockView | null = $state.raw(null);
}

/** An empty store: no layer loaded, no panel, no views. */
export function createExploreView(): ExploreViewStore {
  return new ExploreViewState();
}
