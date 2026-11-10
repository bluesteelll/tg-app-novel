// The Pixi stage adapter (controller.ts) under happy-dom, on a bare Container stage (no renderer): an anchor's four
// Containers nest, its art follows each of them, and a drop destroys them with the art but never the texture
// (per-player GM6a 4, §6.1). Bounds come from Pixi's own transform math (getBounds), not from the executor's model.
// The app's Pixi options skip Pixi's environment imports (RULINGS 201 lever X).
import { Container, Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';
import { expect, test } from 'vitest';

import type { AnchorKey } from '../mechanics/contract.ts';
import type { ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, PropId, Rect } from '../story/staging.ts';
import { appOptions, createLayers, pixiAdapter } from './controller.ts';
import { createExecutor } from './executor.ts';
import { propPlacement } from './layout.ts';
import { createAssetRegistry } from './registry.ts';
import type { AssetError, Decoded, LoadImage, TextureHandle } from './registry.ts';
import { createRenderLoop } from './render-loop.ts';

const SCREEN = { w: 390, h: 844 };
const LAMP: Rect = [500, 900, 100, 100];
const LAMP_ENTRY: ImageEntry = {
  kind: 'image',
  w: 512,
  h: 512,
  decodedBytes: 512 * 512 * 4,
  avif: { url: '/assets/prop_lamp.avif', bytes: 100 },
  webp: { url: '/assets/prop_lamp.webp', bytes: 120 },
};

const texture = (w: number, h: number): Texture => new Texture({ source: new TextureSource({ width: w, height: h }) });

/** Layers on a bare stage and the adapter over them. */
function pixiStage() {
  const stage = new Container();
  const layers = createLayers({ stage });
  const adapter = pixiAdapter({ screen: new Rectangle(0, 0, SCREEN.w, SCREEN.h) }, layers);
  return { stage, layers, adapter };
}

/** The real executor over the Pixi adapter: the real registry, a loader that decodes at once, no frames. */
function pixiExecutor() {
  const s = pixiStage();
  const load: LoadImage<Texture> = (ref) => {
    if (ref.url !== LAMP_ENTRY.avif.url) {
      return Promise.resolve({ ok: false, error: { kind: 'decode', detail: 'no such fixture' } });
    }
    const d: Decoded<Texture> = {
      texture: texture(LAMP_ENTRY.w, LAMP_ENTRY.h),
      w: LAMP_ENTRY.w,
      h: LAMP_ENTRY.h,
      keptBytes: ref.bytes,
      gen: 1,
      open: () => false,
      revive: () => Promise.resolve({ ok: true, value: undefined }),
      release: () => {},
    };
    return Promise.resolve({ ok: true, value: d });
  };
  const resolve = (id: AssetId): Result<ImageEntry, AssetError> =>
    id === 'prop/lamp' ? { ok: true, value: LAMP_ENTRY } : { ok: false, error: { kind: 'missing-id', id } };
  const ex = createExecutor<Texture>({
    adapter: s.adapter,
    registry: createAssetRegistry<Texture>({ load, variant: 'avif', tier: 'full' }),
    resolve,
    loop: createRenderLoop({ ticker: { add: () => {}, remove: () => {} }, render: () => {} }),
    resolution: 2,
    onSkip: () => {},
  });
  return { ...s, ex };
}

/** The lamp at its hotspot anchor, applied instantly. */
const lampAt = (ex: ReturnType<typeof pixiExecutor>['ex']): Promise<void> =>
  ex.apply([{ kind: 'props', props: [{ prop: 'lamp' as PropId, rect: LAMP, at: 'room.lamp' as AnchorKey }] }], { instant: true });

/** A container's only child. */
function only(c: Container): Container {
  const [x] = c.children;
  if (x === undefined || c.children.length !== 1) {
    throw new Error(`expected one child, got ${c.children.length}`);
  }
  return x;
}
/** Every node below a container, depth first. */
const below = (c: Container): Container[] => c.children.flatMap((x) => [x, ...below(x)]);
/** The art sprite somewhere in an anchor's subtree. */
function artOf(anchor: Container): Sprite {
  const s = below(anchor).find((x): x is Sprite => x instanceof Sprite);
  if (s === undefined) {
    throw new Error('expected a sprite in the anchor');
  }
  return s;
}
const boxOf = (s: Sprite): [number, number, number, number] => {
  const b = s.getBounds();
  return [b.x, b.y, b.width, b.height];
};
const expectBox = (s: Sprite, x: number, y: number, w: number, h: number): void => {
  const [bx, by, bw, bh] = boxOf(s);
  expect(bx).toBeCloseTo(x, 6);
  expect(by).toBeCloseTo(y, 6);
  expect(bw).toBeCloseTo(w, 6);
  expect(bh).toBeCloseTo(h, 6);
};

test("scene: an anchor's children share its transform", () => {
  const { stage, layers, adapter } = pixiStage();
  const node = adapter.anchor('props', 'room.lamp');
  const tex = texture(64, 32);
  const handle: TextureHandle<Texture> = { id: 'prop/lamp' as AssetId, texture: tex, w: 64, h: 32 };
  adapter.set(adapter.sprite('props', handle, node.content), { x: 5, y: 6, w: 64, h: 32 });
  const outer = only(layers.props);
  const sprite = artOf(outer);
  expectBox(sprite, 5, 6, 64, 32);
  // The anchor Container moves and scales everything nested in it.
  outer.position.set(100, 200);
  outer.scale.set(2);
  expectBox(sprite, 110, 212, 128, 64);
  stage.destroy({ children: true });
});

test("scene: a prop sprite sits at the anchor's origin", async () => {
  const { stage, layers, ex } = pixiExecutor();
  await lampAt(ex);
  const box = propPlacement(SCREEN, LAMP);
  const outer = only(layers.props);
  expect([outer.x, outer.y]).toEqual([box.x, box.y]);
  // Drawn at its box, not at twice its origin.
  expectBox(artOf(outer), box.x, box.y, box.w, box.h);
  expect(ex.propRects()).toEqual([{ prop: 'lamp', ...box }]);
  ex.destroy();
  stage.destroy({ children: true });
});

test('scene: content follows the anchor, depth and motion nodes', async () => {
  const { stage, layers, ex } = pixiExecutor();
  await lampAt(ex);
  const box = propPlacement(SCREEN, LAMP);
  const outer = only(layers.props);
  const [depth] = outer.children;
  const [motion] = depth?.children ?? [];
  const sprite = artOf(outer);
  if (depth === undefined || motion === undefined) {
    throw new Error('expected the depth and motion nodes');
  }
  outer.x += 10;
  expectBox(sprite, box.x + 10, box.y, box.w, box.h);
  depth.y += 20;
  expectBox(sprite, box.x + 10, box.y + 20, box.w, box.h);
  motion.x += 30;
  motion.y += 40;
  expectBox(sprite, box.x + 40, box.y + 60, box.w, box.h);
  ex.destroy();
  stage.destroy({ children: true });
});

test('scene: dropping an anchor destroys its four nodes and its art, never the texture', () => {
  const { stage, layers, adapter } = pixiStage();
  const node = adapter.anchor('props', 'room.lamp');
  const tex = texture(64, 32);
  adapter.sprite('props', { id: 'prop/lamp' as AssetId, texture: tex, w: 64, h: 32 }, node.content);
  const outer = only(layers.props);
  const nodes = [outer, ...below(outer)];
  expect(nodes.map((x) => (x instanceof Sprite ? 'sprite' : 'container'))).toEqual(['container', 'container', 'container', 'container', 'sprite']);
  adapter.dropGroup(node.anchor);
  expect(nodes.map((x) => x.destroyed)).toEqual([true, true, true, true, true]);
  expect(layers.props.children).toEqual([]);
  expect([tex.destroyed, tex.source.destroyed]).toEqual([false, false]);
  // Its inner ids went with it: a write to one is a no-op, never a write to a destroyed Container.
  expect(() => {
    adapter.set(node.depth, { x: 1, alpha: 0.5 });
    adapter.set(node.content, { z: 1 });
  }).not.toThrow();
  stage.destroy({ children: true });
});

test("scene: the app skips Pixi's environment imports", () => {
  // Rule pixi-env keeps scene code off the systems the skip drops; a literal here, not SKIP_PIXI_ENV, so turning the
  // flag off reds this pin (lane X, RULINGS 201).
  expect(appOptions(document.createElement('div'), 1).skipExtensionImports).toBe(true);
});
