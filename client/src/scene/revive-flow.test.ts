import { expect, test } from 'vitest';

import type { ReviveEnd } from './registry.ts';
import { createReviveFlow } from './revive-flow.ts';

// The flow over a fake revive whose passes the test settles (MEMORY-PLAN M2 commit 3b); `reacquire` and `resume`
// write to one log, so their order is asserted.

type Passes = { readonly gen: number; readonly signal: AbortSignal; visible(e: ReviveEnd): void; all(e: ReviveEnd): void };

function harness() {
  const calls: Passes[] = [];
  const log: string[] = [];
  const flow = createReviveFlow({
    revive(gen, signal) {
      let visible: (e: ReviveEnd) => void = () => {};
      let all: (e: ReviveEnd) => void = () => {};
      const passes = {
        visible: new Promise<ReviveEnd>((resolve) => {
          visible = resolve;
        }),
        all: new Promise<ReviveEnd>((resolve) => {
          all = resolve;
        }),
      };
      calls.push({ gen, signal, visible, all });
      return passes;
    },
    reacquire: () => log.push('reacquire'),
    resume: () => log.push('resume'),
  });
  /** The revive started `n`-th (0-based). */
  const nth = (n: number): Passes => {
    const p = calls[n];
    if (p === undefined) {
      throw new Error(`invariant: revive ${n} was started`);
    }
    return p;
  };
  return { flow, calls, log, nth };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};
const count = (log: readonly string[], what: string): number => log.filter((x) => x === what).length;

test('revive-flow: frames resume when the visible pass is done, before all settles', async () => {
  const h = harness();
  expect(h.flow.suspended()).toBe(false);
  expect(h.flow.reviving()).toBe(false);
  h.flow.start(2);
  expect(h.nth(0).gen).toBe(2);
  expect(h.flow.suspended()).toBe(true);
  expect(h.flow.reviving()).toBe(true);
  h.nth(0).visible('done');
  await flush();
  expect(h.log).toEqual(['reacquire', 'resume']);
  expect(h.flow.suspended()).toBe(false);
  expect(h.flow.reviving()).toBe(true);
  h.nth(0).all('done');
  await flush();
  expect(h.log).toEqual(['reacquire', 'resume', 'reacquire']);
  expect(h.flow.reviving()).toBe(false);
});

test('revive-flow: every settled pass reacquires', async () => {
  const h = harness();
  h.flow.start(2);
  h.nth(0).visible('done');
  h.nth(0).all('done');
  await flush();
  expect(count(h.log, 'reacquire')).toBe(2);
  // Aborted passes reacquire too: a record that ended before the abort leaves the stage before any later frame.
  h.flow.start(3);
  h.flow.abort();
  expect(h.nth(1).signal.aborted).toBe(true);
  h.nth(1).visible('aborted');
  h.nth(1).all('aborted');
  await flush();
  expect(count(h.log, 'reacquire')).toBe(4);
  expect(count(h.log, 'resume')).toBe(1);
});

test('revive-flow: a superseded revive never resumes frames', async () => {
  const h = harness();
  h.flow.start(2);
  h.flow.start(3);
  expect(h.nth(0).signal.aborted).toBe(true);
  expect(h.nth(1).signal.aborted).toBe(false);
  // Revive 2's visible pass settles late, 'done', ignoring its abort, while revive 3 is still stale.
  h.nth(0).visible('done');
  await flush();
  expect(count(h.log, 'resume')).toBe(0);
  expect(h.flow.suspended()).toBe(true);
  h.nth(1).visible('done');
  await flush();
  expect(count(h.log, 'resume')).toBe(1);
  expect(h.log.at(-1)).toBe('resume');
  h.nth(0).all('done');
  h.nth(1).all('done');
  await flush();
  expect(count(h.log, 'resume')).toBe(1);
  expect(h.flow.reviving()).toBe(false);
});

test('revive-flow: an aborted revive leaves frames suspended', async () => {
  // `deactivated` during a revive: the suspension is unchanged until a later revive's visible pass is done.
  const h = harness();
  h.flow.start(2);
  h.flow.abort();
  expect(h.nth(0).signal.aborted).toBe(true);
  h.nth(0).visible('aborted');
  h.nth(0).all('aborted');
  await flush();
  expect(h.flow.suspended()).toBe(true);
  expect(count(h.log, 'resume')).toBe(0);
  // `activated`: a new revive under the same generation.
  h.flow.start(2);
  h.nth(1).visible('done');
  await flush();
  expect(count(h.log, 'resume')).toBe(1);
  expect(h.flow.suspended()).toBe(false);
});

test('revive-flow: lost aborts the current revive', async () => {
  // A second loss during a revive (MEMORY-PLAN section 9).
  const h = harness();
  h.flow.start(2);
  h.flow.lost();
  expect(h.nth(0).signal.aborted).toBe(true);
  expect(h.flow.suspended()).toBe(true);
  // Its visible pass settles 'done' anyway, during the second loss: frames stay suspended.
  h.nth(0).visible('done');
  h.nth(0).all('done');
  await flush();
  expect(count(h.log, 'resume')).toBe(0);
  expect(h.flow.suspended()).toBe(true);
  // destroy() aborts; later calls are no-ops.
  h.flow.start(3);
  h.flow.destroy();
  expect(h.nth(1).signal.aborted).toBe(true);
  h.flow.start(4);
  expect(h.calls.length).toBe(2);
});
