import { expect, test, vi } from 'vitest';

import { decodeCardResponse } from '../api/decode.ts';
import type { Decoder } from '../api/decode.ts';
import type { MetaEndpoints, MetaError } from '../api/endpoints.ts';
import samplesText from '../api/fixtures/dto-samples.json?raw';
import type { HintPortError } from '../puzzles/session.ts';
import type { Result, StoryId } from '../story/catalog.ts';
// Types only: the module value-exports the overlay components, which the node project cannot load.
import type { CardData, ShownError } from '../ui/meta/index.ts';
import { createCardService } from './card.ts';

const SAMPLES: unknown = JSON.parse(samplesText);

/**
 * A decoded sample of `name`. Every fake answers one, edited by spreads and never written as a DTO literal, so a field
 * the server adds reaches these tests through the samples and their decoder only.
 */
function sample<T>(name: string, i: number, decode: Decoder<T>): T {
  const all = typeof SAMPLES === 'object' && SAMPLES !== null ? (SAMPLES as Record<string, unknown>) : {};
  const list = Object.hasOwn(all, name) ? all[name] : undefined;
  const r = decode(Array.isArray(list) ? list[i] : undefined);
  if (!r.ok) {
    throw new Error(`dto-samples.json ${name}[${i}]: ${r.error}`);
  }
  return r.value;
}

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

function value<T, E>(r: Result<T, E>): T {
  if (!r.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

const MANOR = 'manor' as StoryId;

test('card: loads once per open and keeps no copy', async () => {
  const full = sample('CardResponse', 0, decodeCardResponse);
  const empty = sample('CardResponse', 1, decodeCardResponse);
  const postCard = vi.fn<MetaEndpoints['postCard']>().mockResolvedValueOnce(ok(full)).mockResolvedValueOnce(ok(empty));
  const cards = createCardService({ postCard });

  const first = value(await cards.load(MANOR, 'ru'));
  const second = value(await cards.load(MANOR, 'ru'));
  // M9: one request per open; the second open shows the second answer, not a kept copy of the first.
  expect(postCard).toHaveBeenCalledTimes(2);
  expect(postCard.mock.calls).toEqual([[MANOR], [MANOR]]);
  expect(first).toEqual({
    storyId: MANOR,
    runs: 3,
    chaptersCompleted: ['ch1', 'ch2'],
    endings: [
      { name: 'ashes', title: 'Образец: пепел', firstReachedAt: 1799999400 },
      { name: 'truth', title: 'Образец: правда', firstReachedAt: 1799999940 },
    ],
    achievements: [
      { id: 'first_steps', name: 'Образец: первые шаги', description: 'Образец: дойти до концовки', unlockedAt: 1799999400, isNew: false },
      { id: 'both_roads', name: 'Образец: обе дороги', description: 'Образец: найти обе концовки', unlockedAt: 1800000000, isNew: true },
    ],
  });
  // The view's story is the one asked for.
  expect(second).toEqual({ storyId: MANOR, runs: 0, chaptersCompleted: [], endings: [], achievements: [] });
  expect(second).not.toBe(first);

  postCard.mockResolvedValueOnce(ok(full));
  const en = value(await cards.load(MANOR, 'en'));
  expect(en.endings.map((e) => e.title)).toEqual(['Sample: ashes', 'Sample: the truth']);
  expect(en.achievements.map((a) => [a.id, a.name, a.description, a.isNew])).toEqual([
    ['first_steps', 'Sample: first steps', 'Sample: reach an ending', false],
    ['both_roads', 'Sample: both roads', 'Sample: find both endings', true],
  ]);

  postCard.mockResolvedValueOnce({ ok: false, error: { kind: 'http', status: 404, code: 'not_found', body: null, retryAfter: null } });
  expect(await cards.load(MANOR, 'en')).toStrictEqual({ ok: false, error: { kind: 'not-found' } });
  expect(postCard).toHaveBeenCalledTimes(4);
});

test('meta: views are assignable to the overlay and port types', async () => {
  // Typed values, never literals: a view that drifts from the overlay's data type fails `check` here (carry a, c).
  const card = value(await createCardService({ postCard: () => Promise.resolve(ok(sample('CardResponse', 0, decodeCardResponse))) }).load(MANOR, 'en'));
  void (card satisfies CardData);
  expect(card.storyId).toBe(MANOR);

  const failed: MetaError = { kind: 'rate-limited', retryAfter: 30 };
  void (failed satisfies ShownError);
  void (failed satisfies HintPortError);
  // @ts-expect-error: a kind outside the union is no MetaError.
  const unknownKind: MetaError = { kind: 'teapot' };
  void unknownKind;
});
