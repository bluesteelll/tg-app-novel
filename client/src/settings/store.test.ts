// The settings store (PROTOTYPE-PLAN K13): the player's settings and the read-sets, cached in CloudStorage. A cache
// only (principle 1): a forged value can change a preference or let skip pass a line, never unlock anything.
import { expect, test } from 'vitest';

import type { Result } from '../story/catalog.ts';
import type { ChapterId, LineId } from '../story/staging.ts';
import type { TgError } from '../telegram/index.ts';
import {
  CLOUD_VALUE_MAX,
  createSettingsStore,
  decodeSettings,
  DEFAULT_SETTINGS,
  fnv1a32,
  READ_CHUNK_CHARS,
  READ_CHUNKS_MAX,
  readKey,
  SETTINGS_KEY,
  type CloudPort,
  type Settings,
} from './store.ts';
import storeSource from './store.ts?raw';

/**
 * CloudStorage as the facade shows it (telegram/webapp.ts): '' reads as null, and a value over 4096 characters is
 * refused with `invalid` before the call. Every `set` attempt is recorded, refused ones too. `hold()` makes the calls
 * that start before its release wait, as a slow round trip does.
 */
class FakeCloud implements CloudPort {
  readonly data = new Map<string, string>();
  readonly sets: Array<readonly [string, string]> = [];
  /** Keys whose `get` answers a storage error. */
  readonly failGet = new Set<string>();
  failSet = false;
  unsupported = false;
  #held: Promise<void> | null = null;

  hold(): () => void {
    let open: () => void = () => {};
    this.#held = new Promise<void>((resolve) => {
      open = resolve;
    });
    return () => {
      this.#held = null;
      open();
    };
  }

  async get(k: string): Promise<Result<string | null, TgError>> {
    if (this.unsupported) {
      return { ok: false, error: { kind: 'unsupported', method: 'cloud.get' } };
    }
    await this.#wait();
    if (this.failGet.has(k)) {
      return { ok: false, error: { kind: 'storage', detail: 'fake get error' } };
    }
    const v = this.data.get(k);
    return { ok: true, value: v === undefined || v === '' ? null : v };
  }

  async set(k: string, v: string): Promise<Result<void, TgError>> {
    if (this.unsupported) {
      return { ok: false, error: { kind: 'unsupported', method: 'cloud.set' } };
    }
    this.sets.push([k, v]);
    if (v.length > CLOUD_VALUE_MAX) {
      return { ok: false, error: { kind: 'invalid', method: 'cloud.set', detail: `value over ${CLOUD_VALUE_MAX} characters` } };
    }
    await this.#wait();
    if (this.failSet) {
      return { ok: false, error: { kind: 'storage', detail: 'fake set error' } };
    }
    this.data.set(k, v);
    return { ok: true, value: undefined };
  }

  async #wait(): Promise<void> {
    if (this.#held !== null) {
      await this.#held;
    }
  }
}

const ch = (id: string): ChapterId => id as ChapterId;
/** A valid line ID (STAGING-DSL §4) per index: `ch1.big.0000`, `ch1.big.0001`, … in base 36. */
const bigLine = (i: number): LineId => `ch1.big.${i.toString(36).padStart(4, '0')}` as LineId;
const keysOf = (v: unknown): string[] => (typeof v === 'object' && v !== null ? Object.keys(v).sort() : []);
const settingsWrites = (cloud: FakeCloud): unknown[] =>
  cloud.sets.filter(([k]) => k === SETTINGS_KEY).map(([, v]): unknown => JSON.parse(v));

test('settings: forged owned flag ignored', async () => {
  const cloud = new FakeCloud();
  cloud.data.set(
    SETTINGS_KEY,
    JSON.stringify({ v: 1, speed: 'fast', owned: true, entitlements: ['chapter:ch2'], unlocked: ['chapter:ch2'] }),
  );
  const store = createSettingsStore({ cloud });
  const loaded = await store.load();
  expect(loaded.speed).toBe('fast');
  expect(Object.keys(store.current()).sort()).toEqual(['lang', 'skipUnread', 'speed', 'volume']);
  // @ts-expect-error: a Settings value has no owned flag to read
  expect(store.current().owned).toBeUndefined();

  await store.update({ ...store.current(), skipUnread: true });
  const written = settingsWrites(cloud);
  expect(written).toHaveLength(1);
  // Only the four settings go back: the forged fields are not written over the cloud copy.
  expect(keysOf(written[0])).toEqual(['lang', 'skipUnread', 'speed', 'v', 'volume']);
  expect(written[0]).toStrictEqual({
    v: 1,
    lang: null,
    speed: 'fast',
    volume: { master: 100, bgm: 100, sfx: 100 },
    skipUnread: true,
  });

  // A forged field handed to update is dropped the same way.
  const forged = { ...store.current(), owned: true, entitlements: ['chapter:ch2'] };
  await store.update(forged);
  expect(Object.keys(store.current()).sort()).toEqual(['lang', 'skipUnread', 'speed', 'volume']);
  expect(keysOf(settingsWrites(cloud).at(-1))).toEqual(['lang', 'skipUnread', 'speed', 'v', 'volume']);

  // The module holds no entitlement state and no unlock function: its runtime exports are exactly these.
  expect(Object.keys(await import('./store.ts')).sort()).toEqual([
    'CLOUD_VALUE_MAX',
    'DEFAULT_SETTINGS',
    'READ_CHUNKS_MAX',
    'READ_CHUNK_CHARS',
    'SETTINGS_KEY',
    'createSettingsStore',
    'decodeSettings',
    'fnv1a32',
    'readKey',
  ]);
});

test('settings: cloud value over 4096 chunks', async () => {
  const ch1 = ch('ch1');
  // The FNV-1a 32 reference vectors (isthe.com/chongo/tech/comp/fnv): the empty string and "a".
  expect(fnv1a32('')).toBe(0x811c9dc5);
  expect(fnv1a32('a')).toBe(0xe40c292c);
  expect(readKey(ch1, 0)).toBe('read_ch1');
  expect(readKey(ch1, 1)).toBe('read_ch1_1');
  expect(readKey(ch('ch12'), 7)).toBe('read_ch12_7');

  const lines = Array.from({ length: 6001 }, (_, i) => bigLine(i));
  const unmarked = 'ch1.big.zzzz' as LineId;
  // Fixture property: every line has its own hash, and the unmarked line shares none of them.
  const hashes = new Set(lines.map(fnv1a32));
  expect(hashes.size).toBe(6001);
  expect(hashes.has(fnv1a32(unmarked))).toBe(false);

  /** A fresh store over `cloud` that loaded ch1, marked the first `n` lines and flushed. */
  const marked = async (cloud: FakeCloud, n: number) => {
    const store = createSettingsStore({ cloud });
    await store.loadRead(ch1);
    for (const line of lines.slice(0, n)) {
      store.markRead(ch1, line);
    }
    await store.flush();
    return store;
  };

  // 750 lines: one value, the head and exactly 4000 base64 characters (750 hashes, 3000 bytes, no padding).
  const at750 = new FakeCloud();
  await marked(at750, 750);
  expect(at750.sets.map(([k]) => k)).toEqual(['read_ch1']);
  expect(at750.data.get('read_ch1')?.slice(0, 4)).toBe('1.1.');
  expect(at750.data.get('read_ch1')?.length).toBe(4 + READ_CHUNK_CHARS);

  // 751 lines: two values.
  const at751 = new FakeCloud();
  await marked(at751, 751);
  expect(at751.sets.map(([k]) => k)).toEqual(['read_ch1_1', 'read_ch1']);
  expect(at751.data.get('read_ch1')?.slice(0, 4)).toBe('1.2.');
  expect(at751.data.get('read_ch1_1')?.length).toBe(8);

  // 1000 lines: chunk 0 holds the head and 750 hashes, chunk 1 the other 250 (1000 bytes = 1336 characters).
  const at1000 = new FakeCloud();
  await marked(at1000, 1000);
  for (const [k, v] of at1000.sets) {
    expect(v.length, k).toBeLessThanOrEqual(CLOUD_VALUE_MAX);
  }
  // Chunk 0 goes last, so an interrupted write leaves the old head over chunks it already knew.
  expect(at1000.sets.map(([k]) => k)).toEqual(['read_ch1_1', 'read_ch1']);
  expect(at1000.data.get('read_ch1')?.slice(0, 4)).toBe('1.2.');
  expect(at1000.data.get('read_ch1')?.length).toBe(4 + READ_CHUNK_CHARS);
  expect(at1000.data.get('read_ch1_1')?.length).toBe(1336);
  const reloaded = createSettingsStore({ cloud: at1000 });
  await reloaded.loadRead(ch1);
  expect(lines.slice(0, 1000).filter((line) => reloaded.isRead(ch1, line)).length).toBe(1000);
  expect(reloaded.isRead(ch1, unmarked)).toBe(false);
  expect(reloaded.isRead(ch1, lines[1000] ?? unmarked)).toBe(false);

  // Past READ_CHUNKS_MAX × 750 lines a mark stays in memory: eight keys, the longest value 4 + 4000 characters.
  const atCap = new FakeCloud();
  const full = await marked(atCap, 6001);
  expect(READ_CHUNKS_MAX).toBe(8);
  expect([...atCap.data.keys()].sort()).toEqual(
    ['read_ch1', ...Array.from({ length: 7 }, (_, i) => `read_ch1_${i + 1}`)].sort(),
  );
  expect(atCap.data.get('read_ch1')?.slice(0, 4)).toBe('1.8.');
  expect(Math.max(...atCap.sets.map(([, v]) => v.length))).toBe(4 + READ_CHUNK_CHARS);
  expect(full.isRead(ch1, lines[6000] ?? unmarked)).toBe(true);
  const capped = createSettingsStore({ cloud: atCap });
  await capped.loadRead(ch1);
  expect(lines.filter((line) => capped.isRead(ch1, line)).length).toBe(6000);
  expect(capped.isRead(ch1, lines[6000] ?? unmarked)).toBe(false);

  // The 6000th mark is the last one the eight keys hold: a session whose only new mark it is still writes it. Every
  // batch above also carries earlier new marks, so only this step sees the cap's boundary (test_r1 F1).
  const atLast = new FakeCloud();
  await marked(atLast, 5999);
  await marked(atLast, 6000);
  const last = createSettingsStore({ cloud: atLast });
  await last.loadRead(ch1);
  expect(last.isRead(ch1, lines[5999] ?? unmarked)).toBe(true);
});

test('settings: defaults when the cloud has none', async () => {
  for (const raw of [null, '', 'not json', '{"v":2,"speed":"fast"}', '{"speed":"fast"}', '[1]', '"x"', 'null', '1']) {
    expect(decodeSettings(raw), String(raw)).toStrictEqual(DEFAULT_SETTINGS);
  }
  expect(DEFAULT_SETTINGS).toStrictEqual({
    lang: null,
    speed: 'normal',
    volume: { master: 100, bgm: 100, sfx: 100 },
    skipUnread: false,
  });

  // An unsupported client (below 6.9), a storage error and an empty cloud each give the defaults; `lang` stays null
  // (the account's language is the caller's, K29).
  const stored = JSON.stringify({ v: 1, lang: 'en', speed: 'fast', volume: { master: 10, bgm: 20, sfx: 30 }, skipUnread: true });
  const unsupported = new FakeCloud();
  unsupported.unsupported = true;
  unsupported.data.set(SETTINGS_KEY, stored);
  const failing = new FakeCloud();
  failing.failGet.add(SETTINGS_KEY);
  failing.data.set(SETTINGS_KEY, stored);
  for (const cloud of [unsupported, failing, new FakeCloud()]) {
    const store = createSettingsStore({ cloud });
    expect(await store.load()).toStrictEqual(DEFAULT_SETTINGS);
    expect(store.current().lang).toBeNull();
  }

  // Field by field: an invalid field takes its default, a volume is rounded and clamped to 0-100.
  expect(
    decodeSettings(
      JSON.stringify({ v: 1, lang: 'de', speed: 'warp', volume: { master: 150, bgm: -5, sfx: 'x' }, skipUnread: 'yes' }),
    ),
  ).toStrictEqual({ ...DEFAULT_SETTINGS, volume: { master: 100, bgm: 0, sfx: 100 } });
  expect(
    decodeSettings(JSON.stringify({ v: 1, lang: 'en', speed: 'instant', volume: { master: 33.6, bgm: 0, sfx: 99.4 } })),
  ).toStrictEqual({ lang: 'en', speed: 'instant', volume: { master: 34, bgm: 0, sfx: 99 }, skipUnread: false });
  expect(decodeSettings(JSON.stringify({ v: 1, volume: 'loud' })).volume).toStrictEqual(DEFAULT_SETTINGS.volume);
  expect(decodeSettings(stored)).toStrictEqual({
    lang: 'en',
    speed: 'fast',
    volume: { master: 10, bgm: 20, sfx: 30 },
    skipUnread: true,
  });
});

test('settings: writes coalesce and failures stay local', async () => {
  const s = (speed: Settings['speed']): Settings => ({ ...DEFAULT_SETTINGS, speed });
  const speeds = (cloud: FakeCloud): unknown[] =>
    settingsWrites(cloud).map((w) => (typeof w === 'object' && w !== null && 'speed' in w ? w.speed : null));

  // One write in flight; the updates made meanwhile coalesce into one more write of the latest.
  const cloud = new FakeCloud();
  const store = createSettingsStore({ cloud });
  await store.load();
  const release = cloud.hold();
  const updates = [store.update(s('fast')), store.update(s('slow')), store.update(s('instant'))];
  expect(store.current().speed).toBe('instant');
  release();
  await Promise.all(updates);
  expect(cloud.sets.length).toBe(2);
  expect(speeds(cloud)).toEqual(['fast', 'instant']);

  // A failed write neither throws nor reverts the setting.
  cloud.failSet = true;
  await expect(store.update(s('slow'))).resolves.toBeUndefined();
  expect(store.current().speed).toBe('slow');
  cloud.failSet = false;

  // An update while the load is in flight is kept, and written once the load succeeded.
  const slow = new FakeCloud();
  slow.data.set(SETTINGS_KEY, JSON.stringify({ v: 1, speed: 'fast' }));
  const early = createSettingsStore({ cloud: slow });
  const open = slow.hold();
  const loading = early.load();
  const updated = early.update(s('slow'));
  expect(early.current().speed).toBe('slow');
  expect(settingsWrites(slow)).toEqual([]);
  open();
  await updated;
  expect((await loading).speed).toBe('slow');
  expect(early.current().speed).toBe('slow');
  expect(speeds(slow)).toEqual(['slow']);

  // After a failed load nothing is written over the synced copy this session.
  const flaky = new FakeCloud();
  flaky.failGet.add(SETTINGS_KEY);
  const offline = createSettingsStore({ cloud: flaky });
  await offline.load();
  await offline.update(s('fast'));
  expect(offline.current().speed).toBe('fast');
  expect(settingsWrites(flaky)).toEqual([]);

  // Read-sets: a chapter is written only after its loadRead succeeded; a null value is a successful read of nothing.
  const reads = new FakeCloud();
  reads.failGet.add('read_ch2');
  const rs = createSettingsStore({ cloud: reads });
  const line = (c: string, i: number): LineId => `${c}.x.${String(i).padStart(4, '0')}` as LineId;
  await rs.loadRead(ch('ch2'));
  rs.markRead(ch('ch2'), line('ch2', 1));
  await rs.loadRead(ch('ch3'));
  rs.markRead(ch('ch3'), line('ch3', 1));
  rs.markRead(ch('ch4'), line('ch4', 1)); // never loaded
  await rs.flush();
  expect(rs.isRead(ch('ch2'), line('ch2', 1))).toBe(true);
  expect(rs.isRead(ch('ch4'), line('ch4', 1))).toBe(true);
  expect(reads.sets.map(([k]) => k)).toEqual(['read_ch3']);

  // Two overlapping flushes give one write per dirty chapter; a clean chapter is not written again.
  rs.markRead(ch('ch3'), line('ch3', 2));
  const held = reads.hold();
  const flushes = [rs.flush(), rs.flush()];
  held();
  await Promise.all(flushes);
  expect(reads.sets.map(([k]) => k)).toEqual(['read_ch3', 'read_ch3']);
  await rs.flush();
  expect(reads.sets).toHaveLength(2);

  // A load merges the cloud copy first, then the marks made meanwhile, in that order.
  const merged = new FakeCloud();
  const before = createSettingsStore({ cloud: merged });
  await before.loadRead(ch('ch5'));
  before.markRead(ch('ch5'), line('ch5', 1));
  before.markRead(ch('ch5'), line('ch5', 2));
  await before.flush();
  const after = createSettingsStore({ cloud: merged });
  after.markRead(ch('ch5'), line('ch5', 3));
  await after.loadRead(ch('ch5'));
  await after.flush();
  const expected = new FakeCloud();
  const inOrder = createSettingsStore({ cloud: expected });
  await inOrder.loadRead(ch('ch5'));
  for (const i of [1, 2, 3]) {
    inOrder.markRead(ch('ch5'), line('ch5', i));
  }
  await inOrder.flush();
  expect(merged.data.get('read_ch5')).toBe(expected.data.get('read_ch5'));

  // No timers: the caller flushes (L15: autosave points, `deactivated`, a chapter's END).
  expect(storeSource).not.toMatch(/\bset(?:Timeout|Interval)\b/);
});
