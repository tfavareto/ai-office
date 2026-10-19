import type { Rect } from '../layout/types';
import type { Ctx } from './paint/ctx';

export function intersects(x: number, y: number, w: number, h: number, vis: Rect): boolean {
  return x < vis.x + vis.w && x + w > vis.x && y < vis.y + vis.h && y + h > vis.y;
}

/** Draw the part of a canvas that falls inside the visible world rect. */
export function blit(ctx: Ctx, canvas: HTMLCanvasElement, ox: number, oy: number, vis: Rect): void {
  if (vis.w === 0 || vis.h === 0) return;
  const x0 = Math.max(ox, Math.floor(vis.x));
  const y0 = Math.max(oy, Math.floor(vis.y));
  const x1 = Math.min(ox + canvas.width, Math.ceil(vis.x + vis.w));
  const y1 = Math.min(oy + canvas.height, Math.ceil(vis.y + vis.h));
  if (x1 <= x0 || y1 <= y0) return;
  ctx.drawImage(canvas, x0 - ox, y0 - oy, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
}

