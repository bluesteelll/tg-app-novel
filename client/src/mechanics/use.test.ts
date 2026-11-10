// Module `use` (engine plan §6.1): item-first use, tools that stay, the refusal chain, its data's round trip, its
// edges on the build's proof path (the soft-lock check; the seeded playthrough's is in scripts/story/world.test.ts, whose
// program has the node types the story tool's modules need) and its texts. Fixture worlds are written in the source
// format and decoded with the real registries; a proof world carries the decoded `mods`, as the explore controller's and
// the story gate's do.
import { expect, test } from 'vitest';

import { checkWorld } from '../../scripts/story/softlock.ts';
import { reconcile } from '../explore/reconcile.ts';
import { RESUME_STATE_CAP, sectionScope } from '../explore/reduce.ts';
import type { ExploreAction, ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { KnotName, SectionId } from '../story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toPublic } from '../world/decode.ts';
import type { WorldIssue } from '../world/decode.ts';
import type { HotspotKey, ItemId, RoomId, WorldSource } from '../world/types.ts';
import type { KernelWorld, SectionAction } from './contract.ts';
import { MECHANIC_DATA } from './data/index.ts';
import { reduce } from './rules/core.ts';
import { ownScope, searchSection, sectionEntry, sectionKey, successors } from './rules/search.ts';
import { useActions } from './rules/use.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture worlds (one section `s`), in the source format

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (owner = 'w'): Json => ({ id: `ch1.${owner}.${(lineCounter++).toString(36).padStart(4, '0')}`, ru: owner });
const RECT = [100, 200, 200, 200];
const exit = (id: string, to: string | { story: string }, lock: Json | null = null): Json => ({
  id,
  kind: 'exit',
  rect: RECT,
  label: txt(),
  to: typeof to === 'string' ? { room: to } : to,
  lock,
  sfx: null,
});
const take = (id: string, item: string): Json => ({ id, kind: 'take', rect: RECT, label: txt(), gives: { item }, prop: null, then: [] });
const object = (id: string, extra: Json = {}): Json => ({ id, kind: 'object', rect: RECT, label: txt(), lock: null, then: [], look: null, prop: null, ...extra });
/** A lock without a puzzle over `slots` (an item id, or `[item, keep]`). */
const lock = (slots: ReadonlyArray<string | readonly [string, boolean]>): Json => ({
  slots: slots.map((s) => (typeof s === 'string' ? { accepts: s } : { accepts: s[0], keep: s[1] })),
  puzzle: null,
  locked: txt(),
  onOpen: [],
  onFail: [],
});
const room = (hotspots: readonly Json[], extra: Json = {}): Json => ({ bg: 'room', title: txt(), onEnter: [], hotspots, ...extra });

/** The source world of one section `s` starting in `hall`; `items` maps each item id to its extra keys. */
function rawWorld(rooms: Readonly<Record<string, Json>>, items: Readonly<Record<string, Json>>): Json {
  return {
    format: 1,
    items: Object.fromEntries(Object.entries(items).map(([id, extra]) => [id, { name: txt(id), desc: txt(id), glyph: 'key', ...extra }])),
    docs: {},
    puzzles: {},
    sections: { s: { start: 'hall', bgm: null, rooms } },
  };
}

function source(raw: Json): WorldSource {
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** The proof world: the public body with the decoded `mods`. */
const kernel = (src: WorldSource): KernelWorld => ({ ...toPublic(src), mods: src.mods });

const S = 's' as SectionId;
const k = (s: string) => s as HotspotKey;
const it = (s: string) => s as ItemId;
const rm = (s: string) => s as RoomId;
const use = (item: string, target: string): SectionAction => ({ kind: 'use', item: it(item), target: k(target) });
const insert = (hotspot: string, item: string): ExploreAction => ({ kind: 'insert', hotspot: k(hotspot), item: it(item) });
const DIRTY: ExploreEffect = { kind: 'dirty' };
/** The kernel's effects of a list, in order: every effect but the writer's `cue` effects. */
const kernelEffects = <E extends { readonly kind: string }>(effects: readonly E[]): E[] => effects.filter((e) => e.kind !== 'cue');

/** A state in `roomId` of section `s`. */
function at(roomId: string, extra: Partial<WorldState> = {}): WorldState {
  return { ...structuredClone(EMPTY_WORLD_STATE), section: S, room: rm(roomId), lastRoom: { [S]: rm(roomId) }, visited: [rm(roomId)], ...extra };
}

/** The hall's box with three rules for the key (the first gated on the map) and the map's refusal text. */
function boxWorld(): { src: WorldSource; w: KernelWorld } {
  const src = source(
    rawWorld(
      {
        hall: room([
          object('box', {
            uses: [
              { item: 'key', when: { held: 'map' }, do: [{ give: 'coin' }], say: txt('first') },
              { item: 'key', do: [{ give: 'gem' }], say: txt('second') },
              { item: 'key', do: [{ give: 'ring' }] },
            ],
          }),
          object('chest', { lock: lock(['gem']) }),
          exit('out', { story: 'end' }),
        ]),
      },
      { key: {}, map: { refuse: txt('map_refuse') }, coin: {}, gem: {}, ring: {} },
    ),
  );
  return { src, w: kernel(src) };
}

// ---------------------------------------------------------------------------------------------------------------
// §6.1 "Action": the rule, the lock fit, the refusal chain

test('use: an item used on a target runs its first matching rule', () => {
  const { src, w } = boxWorld();
  const box = src.mods.use.uses[k('hall.box')] ?? [];
  // The first rule's `when` does not hold, so the second runs: the key is consumed, its gift given once, its text shown.
  const r = reduce(w, at('hall', { held: [it('key')] }), use('key', 'hall.box'));
  expect([r.state.held, r.state.used, r.state.fired]).toEqual([['gem'], ['key'], ['use:hall.box#1']]);
  expect(kernelEffects(r.effects)).toEqual([{ kind: 'got', gift: { item: 'gem' }, at: 'hall.box' }, { kind: 'look', text: box[1]?.say, at: 'hall.box' }, DIRTY]);
  // With the map held the first rule holds and runs instead.
  const first = reduce(w, at('hall', { held: [it('map'), it('key')] }), use('key', 'hall.box'));
  expect([first.state.held, first.state.fired]).toEqual([['map', 'coin'], ['use:hall.box#0']]);
  // An item no longer held uses nothing.
  const again = reduce(w, r.state, use('key', 'hall.box'));
  expect([again.state, kernelEffects(again.effects)]).toEqual([r.state, []]);
});

test('use: a refusal names its target and item', () => {
  const { src, w } = boxWorld();
  const mapRefuse = src.mods.use.refuse.items[it('map')];
  // No rule for the map on the box, which is no lock.
  const s = at('hall', { held: [it('map'), it('key')] });
  const noRule = reduce(w, s, use('map', 'hall.box'));
  expect(noRule.state).toBe(s);
  expect(kernelEffects(noRule.effects)).toEqual([{ kind: 'refused', at: 'hall.box', item: 'map', reason: 'no-rule' }, { kind: 'look', text: mapRefuse, at: 'hall.box' }]);
  // No rule on the chest, a lock whose one slot takes the gem only: the fit fails and the same chain runs.
  const noFit = reduce(w, s, use('map', 'hall.chest'));
  expect(noFit.state).toBe(s);
  expect(kernelEffects(noFit.effects)).toEqual([{ kind: 'refused', at: 'hall.chest', item: 'map', reason: 'no-fit' }, { kind: 'look', text: mapRefuse, at: 'hall.chest' }]);
  // The positive control: the gem fits the chest through the fallback, which opens it.
  const fits = reduce(w, at('hall', { held: [it('gem')] }), use('gem', 'hall.chest'));
  expect([fits.state.slots, fits.state.open, fits.state.held, fits.state.used]).toEqual([{ 'hall.chest': ['gem'] }, ['hall.chest'], [], ['gem']]);
  expect(kernelEffects(fits.effects)).toEqual([DIRTY]);
});

test('use: a keep slot leaves the item held', () => {
  const src = source(
    rawWorld({ hall: room([object('scope', { lock: lock([['lens', true], 'cap']) }), object('jar', { lock: lock(['lens']) }), exit('out', { story: 'end' })]) }, { lens: {}, cap: {} }),
  );
  const w = kernel(src);
  expect(src.mods.use.keep).toEqual(['hall.scope#0']);
  // The keeping slot records the lens and leaves it held: no `used`.
  const kept = reduce(w, at('hall', { held: [it('lens')] }), insert('hall.scope', 'lens'));
  expect([kept.state.slots, kept.state.held, kept.state.used]).toEqual([{ 'hall.scope': ['lens', null] }, ['lens'], []]);
  // The use fallback fills it the same way, and the lens still goes into the jar's plain slot, which consumes it.
  const used = reduce(w, at('hall', { held: [it('lens')] }), use('lens', 'hall.scope'));
  expect(used.state).toEqual(kept.state);
  const jar = reduce(w, kept.state, insert('hall.jar', 'lens'));
  expect([jar.state.held, jar.state.used, jar.state.open]).toEqual([[], ['lens'], ['hall.jar']]);
});

test('use: a run plays said, a refusal plays refused', () => {
  const { w } = boxWorld();
  const cues = (effects: readonly ExploreEffect[]): string[] =>
    effects.flatMap((e) => {
      if (e.kind !== 'cue') {
        return [];
      }
      const c = e.cue;
      return [c.kind === 'module' ? `module:${c.module}:${c.name} ${String(c.at)} ${String(c.item)}` : `fact:${c.fact.kind}:${c.fact.id}:${c.change} ${c.cause.verb}@${String(c.cause.at)} via ${String(c.cause.via)}`];
    });
  // A rule's run: its writes as fact cues with the use's cause (`via` its key for what its `do` wrote), then `said`.
  const run = reduce(w, at('hall', { held: [it('key')] }), use('key', 'hall.box'));
  expect(cues(run.effects)).toEqual([
    'fact:held:key:removed use@hall.box via null',
    'fact:used:key:added use@hall.box via null',
    'fact:fired:use:hall.box#1:added use@hall.box via use:hall.box#1',
    'fact:held:gem:added use@hall.box via use:hall.box#1',
    'module:use:said hall.box key',
  ]);
  // A refusal: the same state object, the kernel's effects, then `refused` alone.
  const s = at('hall', { held: [it('map')] });
  const refused = reduce(w, s, use('map', 'hall.box'));
  expect(refused.state).toBe(s);
  expect([refused.effects.map((e) => e.kind), cues(refused.effects)]).toEqual([['refused', 'look', 'cue'], ['module:use:refused hall.box map']]);
});

test('use: the fallback chain ends at the room default', () => {
  const src = source(
    rawWorld(
      { hall: room([object('box', { uses: [{ item: 'key' }] }), exit('out', { story: 'end' })], { refuse: txt('hall_refuse') }), den: room([object('crate')]) },
      { key: {}, map: { refuse: txt('map_refuse') }, pin: {} },
    ),
  );
  const w = kernel(src);
  const roomRefuse = src.mods.use.refuse.rooms[rm('hall')];
  // The pin has no text of its own: the room's.
  const s = at('hall', { held: [it('pin'), it('map')] });
  expect(kernelEffects(reduce(w, s, use('pin', 'hall.box')).effects)).toEqual([{ kind: 'refused', at: 'hall.box', item: 'pin', reason: 'no-rule' }, { kind: 'look', text: roomRefuse, at: 'hall.box' }]);
  // The item's text comes first.
  expect(kernelEffects(reduce(w, s, use('map', 'hall.box')).effects)[1]).toEqual({ kind: 'look', text: src.mods.use.refuse.items[it('map')], at: 'hall.box' });
  // A room without a text: the refusal alone (the UI's default text is GM3u's).
  const den = { ...at('den', { held: [it('pin')] }) };
  expect(kernelEffects(reduce(w, den, use('pin', 'den.crate')).effects)).toEqual([{ kind: 'refused', at: 'den.crate', item: 'pin', reason: 'no-rule' }]);
});

test('use: a use while an event knot is pending changes nothing', () => {
  const { w } = boxWorld();
  // The positive control: idle in the hall, the key's second rule holds on the box, so the search lists the edge and
  // the use runs it.
  const idle = at('hall', { held: [it('key')] });
  expect(useActions(w, idle)).toEqual([use('key', 'hall.box')]);
  expect(reduce(w, idle, use('key', 'hall.box')).state.fired).toEqual(['use:hall.box#1']);
  // The same state while an event knot pends (core's `here` guard): no edge for the search, and the use acts not at all
  // (the same state object, no effect: no refusal, no cue, no story replayed).
  const pending: WorldState = { ...idle, pendingStory: ['hall_voice' as KnotName] }; // a fixture knot name
  expect(useActions(w, pending)).toEqual([]);
  const r = reduce(w, pending, use('key', 'hall.box'));
  expect(r.state).toBe(pending);
  expect(r.effects).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// `visible()`'s clauses (GM3's carry: test r3 F1 / V1, r4 N5): the explore UI dispatches `use` from GM3u on, so a
// hand-built action reaches each clause; each pin holds here and is seen red on its own mutation of `rules/use.ts`

test('use: a use on a target of another room changes nothing', () => {
  const w = kernel(
    source(rawWorld({ hall: room([object('box', { uses: [{ item: 'key', do: [{ give: 'coin' }] }] }), exit('to_den', 'den')]), den: room([exit('to_hall', 'hall')]) }, { key: {}, coin: {} })),
  );
  // The positive control: in the hall the box's rule runs.
  expect(reduce(w, at('hall', { held: [it('key')] }), use('key', 'hall.box')).state.fired).toEqual(['use:hall.box#0']);
  // From the den the hall's box is not on screen: the same state object, no effect.
  const den = at('den', { held: [it('key')] });
  const r = reduce(w, den, use('key', 'hall.box'));
  expect(r.state).toBe(den);
  expect(r.effects).toEqual([]);
});

test('use: a use outside a section changes nothing', () => {
  const { w } = boxWorld();
  // The positive control: in the section the gem fits the chest's slot through the use's lock fit.
  const inside = at('hall', { held: [it('gem')] });
  expect(reduce(w, inside, use('gem', 'hall.chest')).state.slots).toEqual({ 'hall.chest': ['gem'] });
  // The same room and hand with no current section (a hand-built state: the kernel never leaves one so): nothing.
  const outside: WorldState = { ...inside, section: null };
  const r = reduce(w, outside, use('gem', 'hall.chest'));
  expect(r.state).toBe(outside);
  expect(r.effects).toEqual([]);
});

test('use: a use on an unknown target changes nothing', () => {
  const { w } = boxWorld();
  // No hotspot has the key: no rule, no lock, no refusal.
  const s = at('hall', { held: [it('key')] });
  const r = reduce(w, s, use('key', 'hall.nowhere'));
  expect(r.state).toBe(s);
  expect(r.effects).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// The data half

test('use: decode and encode round-trip', () => {
  const effects = [{ give: 'coin' }, { unlock: 'hall.chest' }, { story: 'chest_voice' }];
  const raw = rawWorld(
    {
      hall: room(
        [
          object('box', { uses: [{ item: 'key', keep: true, when: { all: [{ held: 'key' }, { not: { used: 'coin' } }] }, do: effects, say: txt('say') }, { item: 'map' }] }),
          object('chest', { lock: lock([['coin', true], ['gem', false]]) }),
          exit('out', { story: 'end' }),
        ],
        { refuse: txt('hall_refuse'), onEnter: effects },
      ),
    },
    { key: { refuse: txt('key_refuse') }, map: {}, coin: {}, gem: {} },
  );
  const src = source(raw);
  const d = src.mods.use;
  const [first, second] = d.uses[k('hall.box')] ?? [];
  expect(second).toEqual({ item: 'map', keep: false, when: null, do: [], say: null });
  expect([first?.keep, first?.when]).toEqual([true, { all: [{ held: 'key' }, { not: { used: 'coin' } }] }]);
  // A rule's `do` decodes to the value the kernel decodes for the same list in an `onEnter`.
  expect(first?.do).toEqual(src.sections[S]?.rooms[rm('hall')]?.onEnter);
  // A slot's `keep: false` is the default: only the keeping slot is listed.
  expect(d.keep).toEqual(['hall.chest#0']);
  // Through the public body and back: the same data, and the keys back in their places.
  const pub = toPublic(src);
  const back = decodeWorldPublic({ ...pub, version: '0123456789abcdef' });
  expect(back.ok ? back.value.mods?.use : back.error).toEqual(d);
  expect(JSON.stringify(pub.sections[S]?.rooms[rm('hall')]?.hotspots[0])).toContain('"uses":[{"item":"key","keep":true');
  // The emitted rules, as the public JSON carries them: a rule of defaults only is its item alone (no `keep`, `when`,
  // `do` or `say` bytes on every chapter load).
  const emitted = JSON.parse(JSON.stringify(pub.sections[S]?.rooms[rm('hall')]?.hotspots[0])) as { uses?: unknown[] }; // the body's JSON, `uses` untyped there
  expect(emitted.uses?.[1]).toEqual({ item: 'map' });
  // A world without `use` keys encodes nothing, so its emitted body is the kernel's.
  const plain = source(rawWorld({ hall: room([exit('out', { story: 'end' })]) }, {}));
  expect(MECHANIC_DATA[1].encode(plain.mods.use)).toEqual([]);
  // Strict keys, each issue at its source path.
  const bad = structuredClone(raw);
  const hotspot = ((bad['sections'] as Json)['s'] as Json)['rooms'] as Json;
  ((hotspot['hall'] as Json)['hotspots'] as Json[])[0] = object('box', { uses: [{ item: 'key', with: 1 }, { keep: 'yes', do: [{ open: 'x' }] }] });
  const issues = decodeWorldSource(bad);
  const path = 'sections.s.rooms.hall.hotspots.0.uses';
  expect(issues.ok ? [] : issues.error.map((e: WorldIssue) => e.path)).toEqual([`${path}.0.with`, `${path}.1.item`, `${path}.1.keep`, `${path}.1.do.0`]);
});

// ---------------------------------------------------------------------------------------------------------------
// The proof path

test("use: a lock fit with no rule stays insert's edge", () => {
  const raw = (uses: readonly Json[] | null): KernelWorld =>
    kernel(source(rawWorld({ hall: room([object('chest', { lock: lock(['gem']), ...(uses === null ? {} : { uses }) }), exit('out', { story: 'end' })]) }, { gem: {}, coin: {} })));
  const steps = (w: KernelWorld): string[] => successors(w, at('hall', { held: [it('gem')] })).map((x) => JSON.stringify(x.step));
  // The fit alone: one `insert` edge and no `use` edge for the same pair.
  const plain = steps(raw(null));
  expect(plain).toContain(JSON.stringify(insert('hall.chest', 'gem')));
  expect(plain.filter((x) => x.includes('"use"'))).toEqual([]);
  // A rule on the lock adds the `use` edge.
  expect(steps(raw([{ item: 'gem', do: [{ give: 'coin' }] }])).filter((x) => x.includes('"use"'))).toEqual([JSON.stringify(use('gem', 'hall.chest'))]);
});

/** The hall's door is a zero-slot lock that only the statue's rule unlocks: the key, used on the statue, opens it. */
function statueWorld(): WorldSource {
  return source(
    rawWorld(
      {
        hall: room([
          take('key', 'key'),
          object('statue', { uses: [{ item: 'key', do: [{ unlock: 'hall.door' }, { story: 'statue_voice' }] }] }),
          exit('door', { story: 'after' }, lock([])),
        ]),
      },
      { key: {} },
    ),
  );
}

test('use: the soft-lock proof takes a use edge', () => {
  const src = statueWorld();
  const file = 'story/ch1/world.json';
  // With the decoded `mods` the proof takes the use, so every state reaches the door.
  expect(checkWorld(kernel(src), file).flatMap((c) => c.findings)).toEqual([]);
  // Without them nothing opens the door: the guard on the proof path (GM3c W1).
  // @ts-expect-error -- the public body alone is no proof world (KernelWorld.mods); kept as the runtime guard
  expect(checkWorld(toPublic(src), file).flatMap((c) => c.findings.map((f) => f.code))).toEqual(['world/softlock']);
});

test('use: a soft-lock path names its use step', () => {
  // The only use consumes the key the door's lock needs.
  const src = source(
    rawWorld({ hall: room([take('key', 'key'), object('well', { uses: [{ item: 'key' }] }), exit('door', { story: 'after' }, lock(['key']))]) }, { key: {} }),
  );
  expect(checkWorld(kernel(src), 'story/ch1/world.json').flatMap((c) => c.findings.map((f) => f.message))).toEqual([
    'section s: a reachable state cannot reach a leave (stuck in hall): tap hall.key → use key on hall.well',
  ]);
});

/** The hall's drawer is a take that also carries a rule: the key, used on it before it is taken, opens the door. */
function drawerWorld(): WorldSource {
  return source(
    rawWorld(
      {
        hall: room([
          take('key', 'key'),
          { ...take('drawer', 'map'), uses: [{ item: 'key', do: [{ unlock: 'hall.door' }] }] },
          exit('door', { story: 'after' }, lock([])),
        ]),
      },
      { key: {}, map: {} },
    ),
  );
}

test('use: a taken take is no use target', () => {
  const w = kernel(drawerWorld());
  // The positive control: the drawer not yet taken, the search lists the edge and the use runs the rule.
  const before = at('hall', { held: [it('key')] });
  expect(useActions(w, before)).toEqual([use('key', 'hall.drawer')]);
  expect(reduce(w, before, use('key', 'hall.drawer')).state.open).toEqual(['hall.door']);
  // The drawer taken (a taken take is gone, as core's taps have it): no edge for the search, and the use acts not at
  // all (the same state object, no effect).
  const gone: WorldState = { ...before, held: [it('key'), it('map')], taken: [k('hall.drawer')] };
  expect(useActions(w, gone)).toEqual([]);
  const r = reduce(w, gone, use('key', 'hall.drawer'));
  expect(r.state).toBe(gone);
  expect(r.effects).toEqual([]);
  // On the proof path: a player who takes the drawer first can never open the door, and the soft-lock proof says so.
  expect(checkWorld(w, 'story/ch1/world.json').flatMap((c) => c.findings.map((f) => f.code))).toEqual(['world/softlock']);
});

test('use: a section reset clears what its rules read', () => {
  // The desk's rule gives the note and fires its own key, both outside the kernel's scan of S's triggers.
  const src = source(
    rawWorld({ hall: room([take('pen', 'pen'), object('desk', { uses: [{ item: 'pen', do: [{ give: 'note' }] }] }), exit('out', { story: 'end' })]) }, { pen: {}, note: {} }),
  );
  const w = kernel(src);
  const start = sectionEntry(w, EMPTY_WORLD_STATE, S);
  const reached = [start];
  const r = searchSection(w, start, S, RESUME_STATE_CAP, {
    onEdge: (_from, succ, to, isNew) => {
      if (isNew && to !== null) {
        reached.push(succ.state);
      }
    },
  });
  expect(r.result).toBe('exhausted');
  // The positive control: the search reaches the rule's run.
  expect(reached.some((s) => s.fired.includes('use:hall.desk#0') && s.held.includes(it('note')))).toBe(true);
  // X9's start premise (the rules golden's, explore.test.ts): re-entering S from any state play reaches gives the state
  // the build started from.
  const key = sectionKey(w, start, S);
  expect(reached.map((s) => sectionKey(w, sectionEntry(w, s, S), S)).filter((x) => x !== key)).toEqual([]);
  // The key reads the same share (use's `reads` compose `useScope`): the use's state differs from the one before it in
  // the gift and the rule's key, so the search never merges the two.
  const before = reached.find((s) => s.held.includes(it('pen')) && s.fired.length === 0);
  const after = reached.find((s) => s.fired.includes('use:hall.desk#0'));
  expect([before, after].map((s) => (s === undefined ? null : sectionKey(w, s, S)))).toEqual(['hall||hall.pen|||||pen||', 'hall||hall.pen|||use:hall.desk#0||note|pen|']);
  // S's own facts: the kernel's scope plus the rule's gift and key; a world without rules adds nothing (the kernel's
  // scope object itself, so the reset of every world without `uses` is unchanged).
  const own = ownScope(w, S);
  expect([own.items.has(it('note')), own.fired.has('use:hall.desk#0'), sectionScope(w, S).items.has(it('note'))]).toEqual([true, true, false]);
  const plain = kernel(source(rawWorld({ hall: room([take('pen', 'pen'), exit('out', { story: 'end' })]) }, { pen: {} })));
  expect(ownScope(plain, S)).toBe(sectionScope(plain, S));
});

test('use: a keep slot and its held item survive reconcile', () => {
  const w = kernel(source(rawWorld({ hall: room([object('scope', { lock: lock([['lens', true], 'cap']) }), exit('out', { story: 'end' })]) }, { lens: {}, cap: {} })));
  const s = at('hall', { held: [it('lens')], slots: { [k('hall.scope')]: [it('lens'), null] } });
  const r = reconcile({ ...w, version: '2222222222222222' }, s, new Set(['end' as KnotName]), '1111111111111111');
  expect(r.dropped).toEqual([]);
  expect({ ...r.state, unproved: s.unproved }).toEqual(s);
});
