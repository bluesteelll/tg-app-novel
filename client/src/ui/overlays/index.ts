// The in-play overlays' chunk entry (lever O5, RULINGS 201): app/game.ts imports this module dynamically after the
// first line's reveal and at a Menu or Backlog tap before it, so the Menu, the Backlog, the Settings and the Saves
// screen ship in one lazy chunk rather than the engine's. Everything that reaches outside the chunk is `import type`
// (erased: zero bytes) except the UI tables' `t`, which the entry already holds.
export { default as Menu } from './Menu.svelte';
export { default as Backlog } from './Backlog.svelte';
export { default as Settings } from './Settings.svelte';
export { default as SaveLoad } from './SaveLoad.svelte';
export type { BacklogLine } from './Backlog.svelte';
export type { SlotView } from './SaveLoad.svelte';
