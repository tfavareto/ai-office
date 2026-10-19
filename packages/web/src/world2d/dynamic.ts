import { TILE } from '../layout/constants';
import type { Rect } from '../layout/types';
import type { OfficeSim } from '../sim/sim';
import { intersects } from './blit';
import type { Ctx } from './paint/ctx';

/** Elevator doors on the reception wall: two stainless panels that slide apart, with a lit cabin behind. */
export function drawElevators(ctx: Ctx, sim: OfficeSim, vis: Rect): void {
  sim.building.elevators.forEach((e, i) => {
    const x = e.rect.x * TILE;
    const w = e.rect.w * TILE;
    const y = (e.rect.y - 1) * TILE + 8;
    const h = 24;
    if (!intersects(x, y, w, h, vis)) return;
    const open = sim.elevatorOpenness(i);
    if (open > 0.02) {
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#f3e6c4');
      grad.addColorStop(1, '#bfa877');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(40,30,16,0.35)';
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x + 2, y + 2, 1, h - 2);
      ctx.fillRect(x + w - 3, y + 2, 1, h - 2);
    }
    const half = w / 2;
    const slide = Math.round((half - 2) * open);
    for (const side of [0, 1]) {
      const px = side === 0 ? x - slide : x + half + slide;
      const pw = half;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = '#aeb6c2';
      ctx.fillRect(px, y, pw, h);
      ctx.fillStyle = '#d6dce6';
      ctx.fillRect(px, y, 1, h);
      ctx.fillStyle = '#8a929f';
      ctx.fillRect(px + pw - 1, y, 1, h);
      for (let k = 3; k < pw - 2; k += 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(px + k, y + 1, 1, h - 2);
      }
      ctx.fillStyle = '#6e7683';
      ctx.fillRect(px, y + h - 2, pw, 2);
      ctx.restore();
    }
    ctx.fillStyle = open > 0.3 ? '#27c6cc' : '#14565a';
    ctx.fillRect(x + Math.floor(w / 2) - 4, y - 3, 2, 1);
  });
}
