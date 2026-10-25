// Tiny pixel icons drawn from ASCII bitmaps, cached as canvases: code glyphs, the globe, the question mark, the arrow.
import { context2d, makeCanvas } from '../paint/ctx';

type Bitmap = readonly string[];

const GLYPHS: Record<string, Bitmap> = {
  open: ['.X.', 'X..', 'X..', 'X..', '.X.'],
  close: ['.X.', '..X', '..X', '..X', '.X.'],
  semi: ['...', '.X.', '...', '.X.', 'X..'],
  lt: ['..X', '.X.', 'X..', '.X.', '..X'],
  gt: ['X..', '.X.', '..X', '.X.', 'X..'],
  slash: ['..X', '..X', '.X.', 'X..', 'X..'],
  eq: ['...', 'XXX', '...', 'XXX', '...'],
  hash: ['X.X', 'XXX', 'X.X', 'XXX', 'X.X'],
  globe: ['..XXX..', '.X.X.X.', 'X..X..X', 'XXXXXXX', 'X..X..X', '.X.X.X.', '..XXX..'],
  question: ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.....', '..X..'],
  arrow: ['...X..', '....X.', 'XXXXXX', '....X.', '...X..'],
  spark: ['.X.', 'XXX', '.X.'],
  star: ['..X..', '..X..', 'XXXXX', '.XXX.', 'X.X.X'],
};

export const CODE_GLYPHS = ['open', 'close', 'semi', 'lt', 'gt', 'slash', 'eq', 'hash'] as const;

const cache = new Map<string, HTMLCanvasElement>();

/** A glyph in one colour (cached per name and colour). */
export function glyph(name: string, color: string, scale = 1): HTMLCanvasElement {
  const key = `${name}|${color}|${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = GLYPHS[name] ?? GLYPHS.spark!;
  const canvas = makeCanvas((rows[0]?.length ?? 1) * scale, rows.length * scale);
  const ctx = context2d(canvas);
  ctx.fillStyle = color;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'X') ctx.fillRect(x * scale, y * scale, scale, scale);
  });
  cache.set(key, canvas);
  return canvas;
}

const cloudCache = new Map<number, HTMLCanvasElement>();

/** A thought bubble (cloud with a tail) showing `dots` of three dots. */
export function thoughtBubble(dots: number): HTMLCanvasElement {
  const hit = cloudCache.get(dots);
  if (hit) return hit;
  const canvas = makeCanvas(21, 15);
  const ctx = context2d(canvas);
  const fill = '#fbfcfe';
  const edge = '#8c97ad';
  const rect = (x: number, y: number, w: number, h: number, c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  rect(2, 0, 17, 10, edge);
  rect(0, 2, 21, 6, edge);
  rect(3, 1, 15, 8, fill);
  rect(1, 3, 19, 4, fill);
  rect(5, 10, 3, 2, edge);
  rect(5, 10, 2, 1, fill);
  rect(3, 13, 2, 2, edge);
  for (let d = 0; d < 3; d++) {
    rect(5 + d * 5, 4, 2, 2, d < dots ? '#3b475e' : '#cdd3e0');
  }
  cloudCache.set(dots, canvas);
  return canvas;
}
