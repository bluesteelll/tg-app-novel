// The reach report's edge (engine plan §7.1 round 5 W3; GM7r): chunk code, shared by every reach type UI and imported
// only by the type UIs (`rules-lazy`). Pure. A type UI runs `step` on each render of its `answer` prop (a `$effect`
// over `answer`, never a press handler) and reports `onreach(canonical(p, answer))` exactly when it answers true, so
// one reach posts once, however many strokes reach it.

/**
 * The edge: `step(reached)` is true exactly when `reached` turns true, and at the first call when the start answer is
 * already reached (a device seeded at a reached work), so an answer that turns reached again after a restart is
 * reported again. One per mount of a type UI: its owner and destroy point are the component's (no listener, no timer).
 */
export function reachEdge(): { step(reached: boolean): boolean } {
  let was = false; // false at the start: a reached start answer reports once
  return {
    step(reached: boolean): boolean {
      const turned = reached && !was;
      was = reached;
      return turned;
    },
  };
}
