import type { Rect } from '../../layout/types';
import { TILE } from '../../layout/constants';
import { noise2, shade } from '../color';
import { type Ctx, rect } from './ctx';

/** Entrance plaza in tiles, in front of the reception's glass doors (west side of the building). */
export const PLAZA: Rect = { x: -3, y: 1, w: 3, h: 9 };

/** Tile rect to pixel rect. */
export function tileRect(r: Rect): Rect {
  return { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE };
}

/** Sparse lighter/darker pixels over a pixel rect: cheap texture for gravel, asphalt, grass. */
export function speckle(ctx: Ctx, p: Rect, base: string, seed: number, amount = 0.08): void {
  for (let y = Math.floor(p.y); y < p.y + p.h; y += 2) {
    for (let x = Math.floor(p.x); x < p.x + p.w; x += 2) {
      const n = noise2(x, y, seed);
      if (n > 0.9) rect(ctx, x, y, 1, 1, shade(base, amount));
      else if (n < 0.08) rect(ctx, x, y, 1, 1, shade(base, -amount));
    }
  }
}

/** Integer in [0, n) from a coordinate pair and a salt. */
export function pick(x: number, y: number, salt: number, n: number): number {
  return Math.floor(noise2(x, y, salt) * n) % n;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
