import { TILE } from '../layout/constants';
import type { Rect } from '../layout/types';
import { type Ctx, context2d, makeCanvas } from './paint/ctx';
import { mix } from './color';
import { NIGHT_COLORS } from './lighting';
import { intersects } from './blit';
import { PLAZA, tileRect } from './paint/exteriorUtil';
import type { AreaCanvas } from './layers/areaLayer';
import type { CarDraw } from './runtime/cars';
import type { FrameState, Renderer } from './renderer';

let warm: HTMLCanvasElement | null = null;

function glowSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const size = 96;
  const canvas = makeCanvas(size, size);
  const ctx = context2d(canvas);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function pool(ctx: Ctx, sprite: HTMLCanvasElement, cx: number, cy: number, radius: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, cx - radius, cy - radius, radius * 2, radius * 2);
}

/**
 * Night pass: multiply-darken the outdoors and rooms (lit rooms stay warm), then add warm light pools, monitor glow,
 * lamp posts and car headlights with additive blending.
 */
export function drawLighting(ctx: Ctx, renderer: Renderer, s: FrameState, ordered: AreaCanvas[], vis: Rect, cars: readonly CarDraw[]): void {
  warm ??= glowSprite(255, 196, 120);
  const night = s.night;
  const b = s.sim.building;
  const bw = b.width * TILE;
  const bh = b.height * TILE;

  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = night;
  ctx.fillStyle = NIGHT_COLORS.exterior;
  const ex = renderer.layers.exterior;
  const wx0 = ex ? ex.x : vis.x;
  const wy0 = ex ? ex.y : vis.y;
  const wx1 = ex ? ex.x + ex.canvas.width : vis.x + vis.w;
  const wy1 = ex ? ex.y + ex.canvas.height : vis.y + vis.h;
  ctx.fillRect(wx0, wy0, wx1 - wx0, -wy0);
  ctx.fillRect(wx0, bh, wx1 - wx0, wy1 - bh);
  ctx.fillRect(wx0, 0, -wx0, bh);
  ctx.fillRect(bw, 0, wx1 - bw, bh);
  for (const ac of ordered) {
    if (!intersects(ac.x, ac.y, ac.w, ac.h, vis)) continue;
    const lit = ac.area.kind === 'corridor' ? 1 : ac.area.kind === 'terrace' ? 0 : renderer.lightOf(ac.area.id);
    ctx.fillStyle = mix(NIGHT_COLORS.dark, NIGHT_COLORS.lit, lit);
    ctx.fillRect(ac.x, ac.y, ac.w, ac.h);
  }
  ctx.fillStyle = NIGHT_COLORS.dark;
  ctx.fillRect(bw - TILE, 0, TILE, bh);

  ctx.globalCompositeOperation = 'lighter';
  for (const ac of ordered) {
    if (!intersects(ac.x, ac.y, ac.w, ac.h, vis)) continue;
    const lit = ac.area.kind === 'corridor' ? 1 : renderer.lightOf(ac.area.id);
    if (lit < 0.02 || ac.area.kind === 'terrace') continue;
    drawAreaPools(ctx, ac, lit * night);
  }
  const layout = renderer.layers.exterior?.layout;
  if (layout) {
    for (const lamp of layout.lamps) {
      const x = lamp.x * TILE + 8;
      const y = lamp.y * TILE - 8;
      if (x < vis.x - 60 || x > vis.x + vis.w + 60 || y < vis.y - 60 || y > vis.y + vis.h + 60) continue;
      pool(ctx, warm, x, y + 6, 34, night * 0.8);
      ctx.globalAlpha = night;
      ctx.fillStyle = '#ffe9b0';
      ctx.fillRect(x - 2, y + 2, 4, 1);
    }
  }
  const plaza = tileRect(PLAZA);
  pool(ctx, warm, plaza.x + plaza.w / 2, plaza.y + plaza.h / 2, 46, night * 0.55);
  for (const car of cars) {
    if (car.x < vis.x - 60 || car.x > vis.x + vis.w + 60 || car.y < vis.y - 60 || car.y > vis.y + vis.h + 60) continue;
    pool(ctx, warm, car.light.x + car.light.dx * 9, car.light.y + car.light.dy * 9, 18, night * 0.7);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawAreaPools(ctx: Ctx, ac: AreaCanvas, strength: number): void {
  const area = ac.area;
  const radius = area.kind === 'corridor' ? 44 : 40;
  if (area.kind === 'corridor') {
    for (let x = 6 * TILE; x < ac.w; x += 8 * TILE) pool(ctx, warm!, ac.x + x, ac.y + 40, radius * 1.2, strength * 0.38);
    return;
  }
  if (area.kind === 'project') {
    for (const f of area.furniture) {
      if (f.kind !== 'desk') continue;
      pool(ctx, warm!, f.x * TILE + 32, f.y * TILE + 10, radius, strength * 0.36);
      pool(ctx, warm!, f.x * TILE + 32, f.y * TILE + 4, 22, strength * 0.2);
    }
  } else {
    const cx = ac.x + ac.w / 2;
    const cy = ac.y + 72;
    for (const off of [-4, 0, 4]) pool(ctx, warm!, cx + off * 20, cy, 56, strength * 0.34);
  }
  for (const f of area.furniture) {
    if (f.kind === 'lamp') pool(ctx, warm!, f.x * TILE + 8, f.y * TILE - 2, 26, strength * 0.7);
  }
}
