// The page reload's shared rules (LBI D5-D6, Q60 D3-D4): the latch parameter, the poll, the meta holds and the chunk
// latch. In the entry closure: boot's lazy-load recovery reads them while no Game exists, the Game's reload blocker
// with one, so each rule has one definition. Type-only imports: the meta controller and the purchase flow are lazy
// chunks of their own, and a value import would pull them into the entry. LBI's skew latch (`reloadedFor`,
// `withReloadedFor`) stays in game.ts.
import type { PurchaseState } from '../purchase/flow.ts';
import type { MetaView } from './meta.ts';

/** LBI D6: the fragment parameter recording what this tab reloaded for (outside Telegram's `tgWebApp*`). */
export const RELOADED_FOR = 'novelReloadedFor';
/** LBI D5: how often a recovery that waits for its safe point looks again. */
export const RELOAD_POLL_MS = 500;
/** LBI D5: the purchase states of an invoice being created, open or confirmed; a reload would cut the hand-off. */
export const PURCHASE_OPEN: ReadonlySet<PurchaseState['kind']> = new Set(['requesting', 'sheet', 'confirming', 'delayed']);

/**
 * LRB: the reload holds that the meta overlays own, in the Game's order: a wallet pack purchase the player is on (an
 * open invoice state, unless the player left the flow), then a gift being sent. Read by the Game's reload blocker and
 * by boot's recovery when no Game exists; every other hold is the engine's.
 */
export function metaHold(view: MetaView | null): 'purchase' | 'gift' | null {
  if (PURCHASE_OPEN.has(view?.purchase.kind ?? 'idle') && view?.purchaseLeft !== true) {
    return 'purchase';
  }
  if (view?.gift?.busy === true) {
    return 'gift';
  }
  return null;
}

/** Q60: the latch value of a chunk restart for build `own`; never a build id (those are hex). */
export function chunkLatch(own: string): string {
  return `chunk:${own}`;
}

/** `href`'s part before the fragment and the fragment's `&`-separated params, byte for byte. */
function fragmentParams(href: string): { base: string; params: string[] } {
  const at = href.indexOf('#');
  const fragment = at < 0 ? '' : href.slice(at + 1);
  return { base: at < 0 ? href : href.slice(0, at), params: fragment === '' ? [] : fragment.split('&') };
}

const isLatch = (param: string): boolean => param === RELOADED_FOR || param.startsWith(`${RELOADED_FOR}=`);

/** A latch param's value, decoded; as it stands when it does not decode. */
function latchValue(param: string): string {
  const value = param.slice(RELOADED_FOR.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Q60 D4: whether any latch param of `href`'s fragment holds `value`, wherever it sits. */
export function latched(href: string, value: string): boolean {
  return fragmentParams(href).params.some((p) => isLatch(p) && latchValue(p) === value);
}

/**
 * Q60 D4: `href` with the latch `value` appended as a fragment param, every other param byte for byte. With `only`,
 * every existing latch param is dropped first: a skew reload without a Game, so that LBI's `reloadedFor`, which reads
 * the first latch param, finds it in the next document.
 */
export function withLatch(href: string, value: string, only = false): string {
  const { base, params } = fragmentParams(href);
  const kept = only ? params.filter((p) => !isLatch(p)) : params;
  return `${base}#${[...kept, `${RELOADED_FOR}=${encodeURIComponent(value)}`].join('&')}`;
}
