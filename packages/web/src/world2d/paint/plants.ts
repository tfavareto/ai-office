// Indoor potted plants. Every plant shares one baseline (the pot's bottom row sits on the last pixel row of its tile), is
// centred on pixel column 8, and is drawn foliage first and pot last, so the rim always covers the stems: nothing floats.
import type { FurnitureItem } from '../../layout/types';
import { shade } from '../color';
import { BRASS, PLANT, WALNUT } from '../palette';
import { type Ctx, disc, ellipse, hline, pixel, rect, vline } from './ctx';

/** Centre column of every plant sprite (the tile is 16 px wide, so columns 0..15). */
export const PLANT_CX = 8;
/** Last pixel row of the tile: the pot stands on it. */
export const PLANT_BASE = 15;

const SOIL = '#3a2a1c';
const POTS = [PLANT.pot, '#2d3139', '#b98557', '#e8e2d2'] as const;
const STEM = '#2f6b3a';

/** 1px line (Bresenham), used for stems and fronds. */
function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pixel(ctx, x, y, color);
    if (x === x1 && y === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function leaf(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, base: string, light: string): void {
  ellipse(ctx, cx, cy, rx, ry, base);
  ellipse(ctx, cx - 1, cy - 1, Math.max(1, rx - 2), Math.max(1, ry - 2), light);
}

/**
 * Tapered pot with a rim, centred on column 8. `w` is odd, the bottom row is PLANT_BASE.
 * `band` adds a brass ring (tall planters).
 */
function pot(ctx: Ctx, w: number, h: number, color: string, band = false): void {
  const x0 = PLANT_CX - (w - 1) / 2;
  const y0 = PLANT_BASE - h + 1;
  const bodyTop = y0 + 2;
  hline(ctx, x0 + 1, y0 - 1, w - 2, SOIL);
  rect(ctx, x0, y0, w, 2, color);
  hline(ctx, x0, y0, w, shade(color, 0.3));
  hline(ctx, x0 + 1, y0 + 1, w - 2, shade(color, -0.22));
  rect(ctx, x0 + 1, bodyTop, w - 2, h - 2, color);
  vline(ctx, x0 + 1, bodyTop, h - 2, shade(color, 0.2));
  vline(ctx, x0 + w - 2, bodyTop, h - 2, shade(color, -0.22));
  hline(ctx, x0 + 1, PLANT_BASE, w - 2, shade(color, -0.38));
  if (band) {
    hline(ctx, x0 + 1, bodyTop + 2, w - 2, BRASS.base);
    hline(ctx, x0 + 1, bodyTop + 3, w - 2, BRASS.dark);
  }
}

function bush(ctx: Ctx): void {
  disc(ctx, 8, 4, 6, PLANT.dark);
  disc(ctx, 7, 3, 5, PLANT.base);
  disc(ctx, 6, 2, 3, PLANT.mid);
  disc(ctx, 11, 5, 2, PLANT.mid);
  for (const [x, y] of [[5, 0], [6, -1], [9, 1], [4, 3]] as const) pixel(ctx, x, y, PLANT.light);
  pixel(ctx, 5, 0, PLANT.hi);
  for (const [x, y] of [[9, 6], [7, 7], [11, 3], [5, 6]] as const) pixel(ctx, x, y, PLANT.dark);
}

function snake(ctx: Ctx): void {
  const blades = [[4, 8], [6, 11], [8, 13], [10, 9]] as const;
  blades.forEach(([x, h], i) => {
    const top = 11 - h;
    vline(ctx, x, top + 1, h - 1, i % 2 ? PLANT.mid : PLANT.base);
    vline(ctx, x + 1, top + 2, h - 2, PLANT.dark);
    pixel(ctx, x, top, PLANT.light);
  });
  pixel(ctx, 8, -2, PLANT.hi);
  for (const [x, y] of [[8, 3], [6, 5], [4, 7]] as const) pixel(ctx, x, y, PLANT.light);
}

function broadleaf(ctx: Ctx): void {
  const leaves = [[5, 7, PLANT.base, PLANT.light], [11, 6, PLANT.mid, PLANT.hi], [8, 2, PLANT.dark, PLANT.mid]] as const;
  for (const [x, y] of leaves) line(ctx, 8, 10, x, y, STEM);
  for (const [x, y, base, light] of leaves) {
    leaf(ctx, x, y, 4, 3, base, light);
    hline(ctx, x - 1, y, 3, shade(base, -0.25));
  }
}

function cactus(ctx: Ctx): void {
  const spine = PLANT.hi;
  rect(ctx, 7, 1, 3, 10, PLANT.base);
  hline(ctx, 7, 0, 3, PLANT.base);
  vline(ctx, 7, 1, 10, PLANT.mid);
  vline(ctx, 9, 1, 10, PLANT.dark);
  hline(ctx, 5, 6, 3, PLANT.base);
  vline(ctx, 5, 3, 4, PLANT.base);
  vline(ctx, 5, 3, 4, PLANT.mid);
  pixel(ctx, 5, 2, PLANT.mid);
  hline(ctx, 9, 5, 3, PLANT.base);
  vline(ctx, 11, 2, 4, PLANT.dark);
  pixel(ctx, 11, 1, PLANT.dark);
  for (const [x, y] of [[8, 3], [8, 7], [5, 4], [11, 3]] as const) pixel(ctx, x, y, spine);
  pixel(ctx, 8, -1, '#e58aa0');
  pixel(ctx, 8, -2, '#f7c1cf');
}

const SMALL: readonly ((ctx: Ctx) => void)[] = [bush, snake, broadleaf, cactus];
const SMALL_POT_W = 9;
const SMALL_POT_H = 6;

export function plant(ctx: Ctx, it: FurnitureItem): void {
  const kind = it.variant % SMALL.length;
  SMALL[kind](ctx);
  pot(ctx, SMALL_POT_W, SMALL_POT_H, POTS[(kind + 1) % POTS.length]);
}

const TALL_POT_W = 11;
const TALL_POT_H = 8;
const TALL_POT = '#e8e2d2';

/** Rubber tree: a trunk with a round canopy and two low side branches. */
function tree(ctx: Ctx): void {
  vline(ctx, 8, -3, 11, WALNUT.base);
  vline(ctx, 9, -3, 11, WALNUT.dark);
  line(ctx, 8, 0, 4, -4, STEM);
  line(ctx, 8, 2, 12, -3, STEM);
  disc(ctx, 8, -10, 7, PLANT.dark);
  disc(ctx, 7, -11, 6, PLANT.base);
  disc(ctx, 6, -13, 3, PLANT.mid);
  disc(ctx, 11, -8, 3, PLANT.mid);
  leaf(ctx, 4, -4, 3, 2, PLANT.dark, PLANT.base);
  leaf(ctx, 12, -3, 3, 2, PLANT.mid, PLANT.light);
  for (const [x, y] of [[5, -15], [6, -16], [10, -12], [3, -9]] as const) pixel(ctx, x, y, PLANT.light);
  pixel(ctx, 6, -16, PLANT.hi);
  for (const [x, y] of [[9, -6], [7, -8], [12, -11], [4, -10]] as const) pixel(ctx, x, y, PLANT.dark);
}

const FRONDS: readonly (readonly [number, number])[] = [
  [2, -4], [3, -11], [5, -15], [8, -17], [11, -15], [13, -11], [14, -4], [6, -8], [10, -8],
];

/** Dracaena: a fan of blades that converge behind the pot rim. */
function fan(ctx: Ctx): void {
  FRONDS.forEach(([tx, ty], i) => {
    const bx = Math.round(8 + (tx - 8) * 0.25);
    const tone = [PLANT.base, PLANT.mid, PLANT.base][i % 3];
    line(ctx, bx, 9, tx, ty, tone);
    line(ctx, bx + 1, 9, Math.min(tx + 1, 15), ty + 1, PLANT.dark);
    pixel(ctx, tx, ty, i % 2 ? PLANT.light : PLANT.hi);
  });
}

export function plantTall(ctx: Ctx, it: FurnitureItem): void {
  if (it.variant % 2 === 0) tree(ctx);
  else fan(ctx);
  pot(ctx, TALL_POT_W, TALL_POT_H, TALL_POT, true);
}
