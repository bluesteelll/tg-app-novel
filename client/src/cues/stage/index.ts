// The cue stage's chunk (engine plan §8.1, §8.5; GM3s): the one stage-level layer App mounts above the frame layer.
// It subscribes as the bus's overlay role, captures each cue inside the emit and plays it after the emitting block's
// flush through GM3m's player, with the DOM-facing deps here: the §8.5 "Cue targets" resolver, the `edge` and
// `centre` landings, ghosts and the haptic map. It also owns the family roots' entrance and exit (RULINGS 195: Svelte's
// transition runtime measured past §3.5's entry line, so no root carries a transition directive): a root enters from
// its birth and leaves on its ghost, with `LAYER_MOTIONS`. Plain TS, so the component stays presentational; every
// Animation, ghost, listener and observer created here ends at its motion's end or at the stage's cleanup.
import { tick } from 'svelte';

import type { Box } from '../../geom/cover.ts';
import type { CueStageProps } from '../../ui/state.svelte.ts';
import type { Cue, CueEvent, Haptic } from '../types.ts';
import { LAYER_MOTIONS } from '../visible.ts';
import type { LayerMotion } from '../visible.ts';
import { CUE_TARGET_ATTRS, cueKey } from './motions.ts';
import type { CueTarget } from './motions.ts';
import { createCuePlayer, waapiAnimate } from './player.ts';
import type { CuePlan, Resolved } from './player.ts';

export { default as CueStage } from './CueStage.svelte';

/** The `edge` landing's side: where a gift flies in from and a gift whose rooms leave flies out to (§8.5, CLAIM). */
const EDGE_PX = 56;
/** The `centre` landing's side, the player's own stage-centre box (its constant is private to the frozen player). */
const CENTRE_PX = 72;
/** Keys `data-cues-played` keeps (§8.6). */
const PLAYED_MAX = 32;

/** `el`'s box in the stage layer's px. */
export function boxIn(el: Element, layer: Element): Box {
  const r = el.getBoundingClientRect();
  const l = layer.getBoundingClientRect();
  return { x: r.left - l.left, y: r.top - l.top, w: r.width, h: r.height };
}

/** A designed landing on the stage layer: `edge` centred on its bottom edge, `centre` on its middle. */
export function landing(layer: Element, at: 'edge' | 'centre'): Box {
  const { width: w, height: h } = layer.getBoundingClientRect();
  const s = at === 'edge' ? EDGE_PX : CENTRE_PX;
  return { x: (w - s) / 2, y: at === 'edge' ? h - s / 2 : (h - s) / 2, w: s, h: s };
}

/** The first match outside the stage layer (F8: the layer's ghosts are clones, never a live target). */
function live(sel: string, inside: ParentNode = document): Element | null {
  for (const el of inside.querySelectorAll(sel)) {
    if (el.closest('[data-cue-stage]') === null) {
      return el;
    }
  }
  return null;
}

/** A target's selector by `CUE_TARGET_ATTRS`, with its value when it names one. */
function sel(t: keyof typeof CUE_TARGET_ATTRS, value?: string | number): string {
  return `[${CUE_TARGET_ATTRS[t]}${value === undefined ? '' : `="${value}"`}]`;
}

/** The item a cue names: a fact's id, or the item a module, control or panel cue carries. */
function itemOf(c: Cue): string | null {
  return c.kind === 'fact' ? c.fact.id : 'item' in c ? c.item : null;
}

const elOf = (el: Element | null): Resolved => (el === null ? null : { el });

/**
 * The live target now (§8.5 "Cue targets"; every fallback the table names, the rest null: the player plays a null at
 * the stage centre and counts it). `e`'s box and point are in the layer's px already (D5).
 */
export function resolveTarget(t: CueTarget, e: CueEvent, layer: Element): Resolved {
  const c = e.cue;
  const frame = (): Element | null => live(sel('frame'));
  const ladder = (): Element | null => live(sel('ladder', 'hints'));
  /** A marker inside the frame (or the ladder), else the frame (the ladder) itself. */
  const inside = (scope: Element | null, s: string): Resolved => elOf(scope === null ? null : (live(s, scope) ?? scope));
  switch (t) {
    case 'control':
      // A control outside every cue root emits with no element (App's Retry): found by its name.
      return c.kind === 'ui' ? elOf(live(`[data-cue="${c.control}"]`)) : null;
    case 'box': {
      if (e.box !== null) {
        return { box: e.box };
      }
      if (c.kind !== 'ui-state') {
        return null;
      }
      if (c.panel === null) {
        return { box: landing(layer, 'centre') };
      }
      // A box-less hold of a panel: the notice it shows (the panel itself when it carries both markers), else the
      // panel; a `puzzle` hold with no notice breathes at `centre`, never on the wrapper `checking` moves.
      const panels = [...document.querySelectorAll(sel('panel', c.panel))].filter((p) => p.closest('[data-cue-stage]') === null);
      for (const p of panels) {
        const notice = p.matches(sel('notice')) ? p : p.querySelector(sel('notice'));
        if (notice !== null) {
          return { el: notice };
        }
      }
      return c.panel === 'puzzle' ? { box: landing(layer, 'centre') } : elOf(panels[0] ?? null);
    }
    case 'point':
      return e.point === null
        ? null
        : { box: { x: e.point.x - CENTRE_PX / 2, y: e.point.y - CENTRE_PX / 2, w: CENTRE_PX, h: CENTRE_PX } };
    case 'stage': {
      const r = layer.getBoundingClientRect();
      return { box: { x: 0, y: 0, w: r.width, h: r.height } };
    }
    case 'edge':
      return { box: landing(layer, 'edge') };
    case 'ribbon': {
      // No live ribbon: the dispatch hid the rooms, or none exists yet (a designed landing, never counted).
      const ribbon = live('[data-cue-ribbon]');
      const item = itemOf(c);
      return ribbon === null ? { box: landing(layer, 'edge') } : elOf(item === null ? null : live(sel('ribbon', item), ribbon));
    }
    case 'inventory':
      return elOf(live(sel('inventory', 'bar-inventory'))) ?? { box: landing(layer, 'edge') };
    case 'frame':
      return elOf(frame());
    case 'panel':
      return c.kind === 'ui-state' && c.panel !== null ? elOf(live(sel('panel', c.panel))) : null;
    case 'status':
      return inside(frame(), sel('status'));
    case 'attempts': {
      // Only `with` motions name it: with nothing to roll, the motion is skipped (no frame fallback).
      const f = frame();
      return elOf(f === null ? null : live(sel('attempts'), f));
    }
    case 'part':
      return c.kind === 'puzzle' && c.index !== null ? inside(frame(), sel('part', c.index)) : elOf(frame());
    case 'tier':
      // `index` null: every row, which the ladder carries.
      return c.kind === 'puzzle' && c.index !== null ? inside(ladder(), sel('tier', c.index)) : elOf(ladder());
    case 'ladder':
      return elOf(ladder());
    case 'alert':
      return inside(ladder(), sel('alert'));
    case 'notice':
      return elOf(live(sel('notice')) ?? frame());
    default: {
      const never: never = t;
      return never;
    }
  }
}

/** A ghost on the stage layer at `box`: a clone of `of` (ids and `data-cue*` stripped over its subtree, so no resolver
 *  and no root scan ever finds one), or a plain box; inert and passing taps either way. A plain box (`cue-plain`) and a
 *  hit area's clone (`cue-hit`) paint nothing of their own while a preset moves only transform and opacity, so each
 *  carries the class CueStage paints (RULINGS 203). */
export function ghostOf(box: Box, of: Element | null, layer: Element): HTMLElement {
  // A clone of an element is an element; an SVG one has the same `style` and attributes.
  const g = (of?.cloneNode(true) ?? document.createElement('div')) as HTMLElement;
  for (const n of [g, ...g.querySelectorAll('*')]) {
    for (const a of [...n.attributes]) {
      if (a.name === 'id' || a.name.startsWith('data-cue')) {
        n.removeAttribute(a.name);
      }
    }
  }
  g.classList.add('cue-ghost');
  if (of === null) {
    g.classList.add('cue-plain');
  } else if (of.closest('[data-cue-hit]') !== null) {
    g.classList.add('cue-hit');
  }
  g.setAttribute('inert', '');
  // Inline, so no rule the clone keeps from its original moves it (a width and a height leave `right` and `bottom` unused).
  g.style.cssText += `;position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;margin:0;pointer-events:none`;
  layer.append(g);
  return g;
}

/** A row's touch feedback on the Telegram client: the engine carries no table for it (D4). */
export function hapticOf(tg: CueStageProps['haptic'], h: Haptic): void {
  if (h === 'light' || h === 'medium') {
    tg.impact(h);
  } else if (h === 'selection') {
    tg.selection();
  } else {
    tg.notify(h);
  }
}

/** The node at `of`'s child-index path from `root`, inside `copy` (a clone of `root`); null when the path breaks. */
function twin(copy: Element, root: Element, of: Element): Element | null {
  const path: number[] = [];
  for (let n = of; n !== root; ) {
    const up = n.parentElement;
    if (up === null) {
      return null;
    }
    path.unshift([...up.children].indexOf(n));
    n = up;
  }
  return path.reduce<Element | null>((at, i) => at?.children[i] ?? null, copy);
}

/** A family root the stage tracks: its last box (layer px) and its running entrance. */
type Root = { box: Box; enter: Animation | null };
/** A leaving root's ghost and its exit. */
type RootGhost = { readonly el: HTMLElement; readonly anim: Animation; readonly ms: number };

/**
 * Mounts the stage on `layer`; returns its cleanup. The roots: a `MutationObserver` reports a root arriving (F2) and
 * a tracked root leaving; a root enters from its `data-cue-born` stamp (F4) and leaves on its ghost at its last box
 * (F3, F5), where an end motion caught on the leaving wrapper continues on the wrapper's clone (F6), padded to the
 * root ghost's end (F7).
 */
export function mountStage(layer: HTMLElement, p: CueStageProps): () => void {
  const reduced = (): boolean => p.reduced;
  const roots = new Map<HTMLElement, Root>();
  const ghosts = new Map<Element, RootGhost>();
  const pending = new Set<CuePlan>();
  const played: string[] = [];
  /** Whether the current run animated anything: a haptic plays only on top of a motion (triage M1). */
  let moved = false;

  const boxOf = (el: Element): Box => boxIn(el, layer);
  const motion = (m: LayerMotion): LayerMotion['reduced'] => (reduced() ? m.reduced : m);
  /** F3: a root's box, re-read only while no layer motion scales it. */
  const measure = (): void => {
    for (const [root, r] of roots) {
      if (r.enter === null && root.isConnected) {
        r.box = boxOf(root);
      }
    }
  };
  const see = (root: HTMLElement): void => {
    // The family roots only: a root nested in another (a device host in a room) enters and leaves with its family.
    if (roots.has(root) || !root.isConnected || (root.parentElement?.closest('[data-cue-root]') ?? null) !== null) {
      return;
    }
    const r: Root = { box: boxOf(root), enter: null };
    roots.set(root, r);
    const m = motion(LAYER_MOTIONS.in);
    // F4: a root mounted in the stage's own flush is reported late; one older than its entrance gets none.
    const age = performance.now() - Number(root.dataset.cueBorn);
    if (age < m.ms) {
      const a = waapiAnimate(root, [...m.keyframes], m.ms, 'none');
      a.currentTime = Math.max(0, age);
      a.onfinish = () => {
        r.enter = null;
      };
      r.enter = a;
    }
  };
  const scan = (n: Node): void => {
    if (n instanceof HTMLElement && n.closest('[data-cue-stage]') === null) {
      for (const root of [...(n.matches('[data-cue-root]') ? [n] : []), ...n.querySelectorAll<HTMLElement>('[data-cue-root]')]) {
        see(root);
      }
    }
  };
  /** F5: every tracked root no longer in the document leaves on its ghost. */
  const sweep = (): void => {
    for (const [root, r] of roots) {
      if (!root.isConnected) {
        roots.delete(root);
        r.enter?.cancel();
        const m = motion(root.dataset.cueRoot === 'frame' ? LAYER_MOTIONS.frameOut : LAYER_MOTIONS.out);
        const el = ghostOf(r.box, root, layer);
        el.classList.add('cue-root-ghost');
        const anim = waapiAnimate(el, [...m.keyframes], m.ms, 'forwards');
        ghosts.set(root, { el, anim, ms: m.ms });
        anim.onfinish = () => {
          ghosts.delete(root);
          el.remove();
        };
      }
    }
  };

  /** F6: an element of a leaving root plays on its clone inside the root's ghost; a hit area keeps its own painted
   *  ghost (§8.5 "Hit areas"). */
  const twinOf = (of: Element | null): Element | null => {
    const root = of === null || of.isConnected || of.closest('[data-cue-hit]') !== null ? null : of.closest('[data-cue-root]');
    const g = root === null || root === of ? undefined : ghosts.get(root);
    return g === undefined || root === null || of === null ? null : twin(g.el, root, of);
  };

  const player = createCuePlayer({
    animate(el, kf, ms, fill) {
      moved = true;
      const anim = waapiAnimate(el, kf, ms, fill);
      // A hold's fallback is counted in its timer, after the run that started it.
      debug();
      // F7: a clone inside a leaving root's ghost holds until that ghost ends, so the player's removal at this
      // motion's end never cuts a hole into a ghost still fading.
      const g = [...ghosts.values()].find((x) => x.el !== el && x.el.contains(el));
      if (g !== undefined) {
        anim.effect?.updateTiming({ endDelay: g.ms - (Number(g.anim.currentTime) || 0) });
      }
      return anim;
    },
    resolve: (t, e) => resolveTarget(t, e, layer),
    boxOf,
    ghost: (box, of) => twinOf(of) ?? ghostOf(box, of, layer),
    reduced,
    haptic(h) {
      if (moved) {
        hapticOf(p.haptic, h);
      }
    },
  });

  const debug = (): void => {
    if (__TG_MOCK__) {
      layer.setAttribute('data-cues-played', played.join(' '));
      layer.setAttribute('data-cue-orphans', String(p.orphans()));
      layer.setAttribute('data-cue-fallbacks', String(player.fallbacks()));
    }
  };

  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach(scan);
    }
    sweep();
  });
  observer.observe(document, { childList: true, subtree: true });
  scan(document.body);
  window.addEventListener('resize', measure);
  debug();

  const unsubscribe = p.subscribe('overlay', (raw) => {
    // D5: the bus carries stage-host px; the layer may sit offset from the host (a pillar-boxed stage).
    const host = p.host();
    let e = raw;
    if (host !== null && (raw.box !== null || raw.point !== null)) {
      const h = host.getBoundingClientRect();
      const l = layer.getBoundingClientRect();
      const dx = h.left - l.left;
      const dy = h.top - l.top;
      e = {
        ...raw,
        box: raw.box && { ...raw.box, x: raw.box.x + dx, y: raw.box.y + dy },
        point: raw.point && { x: raw.point.x + dx, y: raw.point.y + dy },
      };
    }
    measure();
    const plan = player.capture(e);
    pending.add(plan);
    void tick().then(() => {
      if (!pending.delete(plan)) {
        return;
      }
      sweep();
      moved = false;
      player.run(plan);
      if (__TG_MOCK__) {
        const c = plan.e.cue;
        played.push(c.kind === 'ui-state' && c.panel !== null ? `${cueKey(c)}@${c.panel}` : cueKey(c));
        played.splice(0, played.length - PLAYED_MAX);
        debug();
      }
    });
  });

  // F10: after this, no callback acts: the observer and the listener are gone, no plan is pending, every animation
  // with an `onfinish` of the stage's is cancelled.
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', measure);
    unsubscribe();
    // §10: a plan captured but not yet run is an orphan the bus cannot see.
    pending.forEach(() => p.dropped());
    pending.clear();
    player.dispose();
    for (const r of roots.values()) {
      r.enter?.cancel();
    }
    roots.clear();
    for (const g of ghosts.values()) {
      g.anim.cancel();
      g.el.remove();
    }
    ghosts.clear();
  };
}
