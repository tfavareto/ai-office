import type { Rect } from '../layout/types';
import { intersects } from './blit';
import type { AreaCanvas } from './layers/areaLayer';
import type { Ctx } from './paint/ctx';

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Build-in (progress 0 -> 1) and dismantle (1 -> 0) animation of a room: a blueprint outline, the floor and walls
 * revealed by a scan line, then the furniture dropping in one piece at a time. Uses only cached canvases/sprites.
 */
export function drawAreaAnimated(ctx: Ctx, ac: AreaCanvas, progress: number, time: number, vis: Rect): void {
  if (!intersects(ac.x, ac.y, ac.w, ac.h, vis)) return;
  const reveal = easeOut(clamp01(progress / 0.55));
  const sliceH = Math.round(ac.h * reveal);
  if (progress < 0.7) {
    ctx.fillStyle = 'rgba(30,70,130,0.22)';
    ctx.fillRect(ac.x, ac.y, ac.w, ac.h);
    ctx.strokeStyle = 'rgba(120,200,255,0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.lineDashOffset = -Math.floor(time * 12);
    ctx.strokeRect(ac.x + 0.5, ac.y + 0.5, ac.w - 1, ac.h - 1);
    ctx.setLineDash([]);
  }
  if (sliceH > 0) ctx.drawImage(ac.ground, 0, 0, ac.w, sliceH, ac.x, ac.y, ac.w, sliceH);
  if (reveal < 1 && sliceH > 0) {
    ctx.fillStyle = 'rgba(160,225,255,0.9)';
    ctx.fillRect(ac.x, ac.y + sliceH - 1, ac.w, 1);
  }
  const count = ac.items.length;
  ac.items.forEach((p, i) => {
    const start = 0.45 + 0.4 * (i / Math.max(1, count));
    const t = easeOut(clamp01((progress - start) / 0.14));
    if (t <= 0) return;
    ctx.globalAlpha = t;
    ctx.drawImage(p.sprite, p.x, Math.round(p.y - (1 - t) * 10));
    ctx.globalAlpha = 1;
  });
}
