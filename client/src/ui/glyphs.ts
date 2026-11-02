// The inline-SVG icons of the closed glyph set (PUZZLES-PLAN X16) and the exit marker: path data on one 24×24 grid,
// filled with `fill-rule="evenodd"` so the inner shapes are holes. Data only: each component draws its own
// `<svg><path d={…} /></svg>`, never `{@html}`. Outside the lazy directories and the world layer, so the explore UI
// and (an L15 carry) the order puzzle may both import it statically.
import type { Glyph } from '../world/types.ts';

export const GLYPH_VIEWBOX = '0 0 24 24';

/** One path per glyph; the type makes the record exhaustive over `GLYPHS` (world/types.ts). */
export const GLYPH_PATHS: Readonly<Record<Glyph, string>> = Object.freeze({
  sun: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10ZM11 1h2v4h-2ZM11 19h2v4h-2ZM1 11h4v2H1ZM19 11h4v2h-4Z',
  moon: 'M15 3a9 9 0 1 0 6 15A7 7 0 0 1 15 3Z',
  star: 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7L12 17.5l-6.2 3.7 1.6-7L2 9.5l7.1-.6Z',
  key: 'M8 7a5 5 0 1 0 4.9 6H16v3h3v-3h2v-2h-8.1A5 5 0 0 0 8 7Zm0 3a2 2 0 1 1 0 4a2 2 0 1 1 0-4Z',
  letter: 'M2 5h20v14H2ZM4 7.5V17h16V7.5l-8 6Z',
  book: 'M4 3h6a2 2 0 0 1 2 1.5A2 2 0 0 1 14 3h6v16h-6a2 2 0 0 0-2 1.5A2 2 0 0 0 10 19H4Z',
  gear: 'M10 2h4l.6 2.8 2.1 1.2 2.7-1 2 3.5-2.2 1.9v2.4l2.2 1.9-2 3.5-2.7-1-2.1 1.2L14 22h-4l-.6-2.8-2.1-1.2-2.7 1-2-3.5 2.2-1.9v-2.4L2.6 9.3l2-3.5 2.7 1 2.1-1.2ZM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z',
  coin: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20Zm0 4a6 6 0 1 1 0 12a6 6 0 1 1 0-12Z',
});

/** The exit marker, an arrow: exits are never told by colour alone (principle 5). */
export const EXIT_PATH = 'M4 11h11.2l-4.6-4.6L12 5l7 7-7 7-1.4-1.4 4.6-4.6H4Z';
