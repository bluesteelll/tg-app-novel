// Placeholder art (PROTOTYPE-PLAN K23, RULINGS 4): one deterministic SVG per catalog image, at its namespace's
// canonical size, in its hue, labelled with its asset id. Characters get a silhouette and props a disc, both on a
// transparent canvas, so they composite like real sprites. The SVG then takes the path real art takes (encode.ts).
// Pure: no clock, no randomness; the same entry always gives the same string.
import { ASSET_ID_RE } from '../../src/story/catalog.ts';
import type { CatalogImage } from '../../src/story/catalog.ts';
import type { AssetId } from '../../src/story/staging.ts';

/** The image namespaces; an asset id's first segment. */
export type ImageKind = 'bg' | 'cg' | 'char' | 'prop' | 'cover';

/** PP "Budgets" (bg/cg exactly 1080×2048, sprites 768×1536), PUZZLES-PLAN X11 (props), STORIES-PLAN Y15 (covers). */
export const CANONICAL_SIZE: Readonly<Record<ImageKind, { readonly w: number; readonly h: number }>> = {
  bg: { w: 1080, h: 2048 },
  cg: { w: 1080, h: 2048 },
  char: { w: 768, h: 1536 },
  prop: { w: 512, h: 512 },
  cover: { w: 360, h: 640 },
};

/** The image namespace of an asset id, or null for audio (`bgm/`, `sfx/`). */
export function imageKind(id: AssetId): ImageKind | null {
  const ns = id.slice(0, id.indexOf('/'));
  return ns === 'bg' || ns === 'cg' || ns === 'char' || ns === 'prop' || ns === 'cover' ? ns : null;
}

function hsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

/** The label: the asset id itself, so no free text is drawn (nothing to escape, nothing to localize). */
function label(id: AssetId, x: number, y: number, size: number, fill: string): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="${size}" fill="${fill}">${id}</text>`;
}

/** Shapes per namespace, in integer coordinates of the canonical canvas. */
function shapes(kind: ImageKind, id: AssetId, hue: number, w: number, h: number): string[] {
  const cx = Math.round(w / 2);
  const font = Math.round(w / 14);
  switch (kind) {
    case 'bg':
    case 'cover': {
      const floor = Math.round(h * 0.62);
      return [
        `<rect x="0" y="0" width="${w}" height="${h}" fill="${hsl(hue, 40, 32)}"/>`,
        `<rect x="0" y="${floor}" width="${w}" height="${h - floor}" fill="${hsl(hue, 35, 22)}"/>`,
        label(id, cx, Math.round(h / 2), font, hsl(hue, 30, 92)),
      ];
    }
    case 'cg': {
      const inset = Math.round(w / 40);
      return [
        `<rect x="0" y="0" width="${w}" height="${h}" fill="${hsl(hue, 45, 28)}"/>`,
        `<rect x="${inset}" y="${inset}" width="${w - 2 * inset}" height="${h - 2 * inset}" fill="none" stroke="${hsl(hue, 40, 70)}" stroke-width="${Math.round(inset / 2)}"/>`,
        label(id, cx, Math.round(h / 2), font, hsl(hue, 30, 92)),
      ];
    }
    case 'char': {
      const headY = Math.round(h * 0.18);
      const headR = Math.round(w * 0.17);
      const shoulder = Math.round(h * 0.31);
      const left = Math.round(w * 0.2);
      const right = w - left;
      const chest = Math.round(h * 0.42);
      return [
        `<circle cx="${cx}" cy="${headY}" r="${headR}" fill="${hsl(hue, 45, 55)}"/>`,
        `<path d="M ${left} ${h} L ${left} ${chest} Q ${left} ${shoulder} ${cx} ${shoulder} Q ${right} ${shoulder} ${right} ${chest} L ${right} ${h} Z" fill="${hsl(hue, 45, 45)}"/>`,
        label(id, cx, Math.round(h * 0.62), font, hsl(hue, 30, 94)),
      ];
    }
    case 'prop': {
      const r = Math.round(w * 0.47);
      return [
        `<circle cx="${cx}" cy="${cx}" r="${r}" fill="${hsl(hue, 55, 50)}" stroke="${hsl(hue, 50, 25)}" stroke-width="${Math.round(w / 64)}"/>`,
        label(id, cx, cx + Math.round(font / 3), font, hsl(hue, 30, 95)),
      ];
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** The placeholder SVG of one catalog image, and its pixel size (the root's width/height, 72 dpi in sharp). */
export function renderPlaceholder(id: AssetId, entry: CatalogImage): { svg: string; w: number; h: number } {
  const kind = imageKind(id);
  if (kind === null || !ASSET_ID_RE.test(id)) {
    throw new Error(`invariant: ${id} is an image asset id before it is drawn`);
  }
  const { w, h } = CANONICAL_SIZE[kind];
  const body = shapes(kind, id, entry.placeholder.hue, w, h).join('');
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`, w, h };
}
