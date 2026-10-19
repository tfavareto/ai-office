import type { Rect } from '../../layout/types';
import { TILE } from '../../layout/constants';
import { noise2, shade } from '../color';
import { GRAPHITE, PLANT } from '../palette';
import { type Ctx, disc, ellipse, hline, rect, vline } from './ctx';
import { paintBench, paintTree } from './exteriorDecor';
import { speckle, tileRect } from './exteriorUtil';

const LAWN = '#6f9c58';
const PATH = '#ddd6c6';
const PATH_EDGE = '#b9b19f';
const PATH_W = 24;
const FLOWERS = ['#e0795a', '#f2c46d', '#e7e2f5', '#d77fb0'];

function lawn(ctx: Ctx, p: Rect): void {
  rect(ctx, p.x, p.y, p.w, p.h, LAWN);
  for (let y = p.y; y < p.y + p.h; y += TILE * 2) rect(ctx, p.x, y, p.w, TILE, shade(LAWN, 0.035));
  speckle(ctx, p, LAWN, 21, 0.1);
  for (let y = p.y; y < p.y + p.h; y += 3) {
    for (let x = p.x; x < p.x + p.w; x += 3) {
      if (noise2(x, y, 23) > 0.985) rect(ctx, x, y, 1, 2, '#9bc47f');
    }
  }
}

function pathStrip(ctx: Ctx, p: Rect): void {
  rect(ctx, p.x, p.y, p.w, p.h, PATH);
  const vertical = p.h > p.w;
  if (vertical) {
    vline(ctx, p.x, p.y, p.h, PATH_EDGE);
    vline(ctx, p.x + p.w - 1, p.y, p.h, PATH_EDGE);
    for (let y = p.y; y < p.y + p.h; y += 8) hline(ctx, p.x + 1, y, p.w - 2, shade(PATH, -0.05));
  } else {
    hline(ctx, p.x, p.y, p.w, PATH_EDGE);
    hline(ctx, p.x, p.y + p.h - 1, p.w, PATH_EDGE);
    for (let x = p.x; x < p.x + p.w; x += 8) vline(ctx, x, p.y + 1, p.h - 2, shade(PATH, -0.05));
  }
}

function fountain(ctx: Ctx, cx: number, cy: number): void {
  disc(ctx, cx, cy, 30, PATH_EDGE);
  disc(ctx, cx, cy, 29, PATH);
  disc(ctx, cx, cy, 20, '#9a9382');
  disc(ctx, cx, cy, 18, '#cfc8b6');
  disc(ctx, cx, cy, 16, '#5ea7c6');
  disc(ctx, cx - 3, cy - 4, 9, '#7fc2dc');
  ellipse(ctx, cx - 6, cy - 7, 4, 2, 'rgba(255,255,255,0.45)');
  disc(ctx, cx, cy, 4, '#cfc8b6');
  disc(ctx, cx, cy, 2, '#eaf6fb');
}

function flowerBed(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  rect(ctx, x, y, w, h, '#7d766a');
  rect(ctx, x + 1, y + 1, w - 2, h - 2, '#4d3a2a');
  for (let py = y + 3; py < y + h - 2; py += 3) {
    for (let px = x + 3; px < x + w - 2; px += 3) {
      const n = noise2(px, py, seed);
      if (n > 0.35) disc(ctx, px, py, 1, n > 0.75 ? FLOWERS[Math.floor(n * 10) % FLOWERS.length] : PLANT.mid);
    }
  }
}

function hedge(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  rect(ctx, x + 1, y + 2, w, h, 'rgba(8,10,18,0.2)');
  rect(ctx, x, y, w, h, PLANT.dark);
  rect(ctx, x + 1, y + 1, w - 2, h - 3, PLANT.base);
  for (let k = 0; k < w * h / 14; k++) {
    rect(ctx, x + 1 + Math.floor(noise2(k, x, 71) * (w - 3)), y + 1 + Math.floor(noise2(k, y, 72) * (h - 4)), 2, 1, PLANT.light);
  }
}

/** A small pocket park at the east end: crossing paths with a fountain, flower beds, hedges, benches and trees. */
export function paintPark(ctx: Ctx, park: Rect): void {
  const p = tileRect(park);
  lawn(ctx, p);
  const cx = p.x + Math.round(p.w / 2);
  const cy = p.y + Math.round(p.h / 2);
  pathStrip(ctx, { x: cx - PATH_W / 2, y: p.y, w: PATH_W, h: p.h });
  pathStrip(ctx, { x: p.x, y: cy - PATH_W / 2, w: p.w, h: PATH_W });
  fountain(ctx, cx, cy);
  hedge(ctx, p.x + 4, p.y + 6, 10, p.h - 12);
  for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const bx = cx + qx * 52 - 18;
    const by = cy + qy * 120 - 8;
    flowerBed(ctx, bx, by, 36, 16, 73 + qx + qy * 2);
    paintBench(ctx, bx + 8, by + (qy < 0 ? 24 : -14));
  }
  const treeSpots: [number, number][] = [];
  for (let ty = park.y + 3; ty < park.y + park.h - 2; ty += 5) {
    treeSpots.push([park.x + park.w - 3, ty], [park.x + 4, ty + 2]);
  }
  for (const [tx, ty] of treeSpots) {
    if (Math.abs(ty * TILE - cy) < 48) continue;
    paintTree(ctx, { x: tx, y: ty, variant: Math.floor(noise2(tx, ty, 74) * 3) });
  }
  for (const gy of [-1, 1]) {
    for (const gx of [-1, 1]) paintTree(ctx, { x: Math.round((cx + gx * 70) / TILE) - 1, y: Math.round((cy + gy * 60) / TILE) - 1, variant: (gx + gy + 4) % 3 });
  }
  rect(ctx, p.x, p.y, 2, p.h, GRAPHITE.light);
}
