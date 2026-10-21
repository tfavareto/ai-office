import type { AreaTheme } from '../../layout/types';
import { mix, noise2, shade } from '../color';
import { BRASS, MARBLE, OAK, WALNUT } from '../palette';
import { type Ctx, hline, rect, vline } from './ctx';

const T = 16;

function marble(ctx: Ctx, x: number, y: number, tx: number, ty: number): void {
  const checker = (tx + ty) % 2 === 0;
  rect(ctx, x, y, T, T, checker ? MARBLE.base : MARBLE.light);
  hline(ctx, x, y, T, MARBLE.shade);
  vline(ctx, x, y, T, MARBLE.shade);
  hline(ctx, x + 1, y + 1, T - 1, checker ? MARBLE.light : MARBLE.base);
  // veins: short diagonal runs
  const n = noise2(tx, ty, 11);
  const sx = 2 + Math.floor(noise2(tx, ty, 12) * 8);
  const sy = 2 + Math.floor(noise2(tx, ty, 13) * 6);
  const len = 4 + Math.floor(n * 6);
  ctx.fillStyle = MARBLE.vein;
  for (let i = 0; i < len; i++) ctx.fillRect(x + sx + i, y + sy + Math.floor(i * 0.7 + (i % 3 === 0 ? 1 : 0)), 1, 1);
  if (n > 0.55) {
    ctx.fillStyle = mix(MARBLE.vein, MARBLE.base, 0.5);
    for (let i = 0; i < 5; i++) ctx.fillRect(x + 9 + i, y + 9 + Math.floor(i * 0.5), 1, 1);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 12, y + 3, 1, 1);
  // brass inlay on every 4th tile edge
  if (tx % 4 === 0 && ty % 4 === 0) rect(ctx, x, y, 2, 2, BRASS.base);
}

function porcelain(ctx: Ctx, x: number, y: number, tx: number, ty: number, warm: boolean): void {
  const base = warm ? '#e7e1d6' : '#e9edec';
  const alt = warm ? '#ded7ca' : '#dfe5e4';
  rect(ctx, x, y, T, T, (tx + ty) % 2 === 0 ? base : alt);
  rect(ctx, x + T - 1, y, 1, T, shade(alt, -0.1));
  rect(ctx, x, y + T - 1, T, 1, shade(alt, -0.1));
  hline(ctx, x + 1, y + 1, 6, '#ffffff66');
  if (noise2(tx, ty, 3) > 0.7) rect(ctx, x + 6, y + 6, 2, 1, shade(base, -0.05));
}

function smallTile(ctx: Ctx, x: number, y: number, tx: number, ty: number, a: string, b: string): void {
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const c = (tx * 2 + i + ty * 2 + j) % 2 === 0 ? a : b;
      rect(ctx, x + i * 8, y + j * 8, 8, 8, c);
      hline(ctx, x + i * 8, y + j * 8 + 7, 8, shade(c, -0.14));
      vline(ctx, x + i * 8 + 7, y + j * 8, 8, shade(c, -0.14));
    }
  }
}

function planks(
  ctx: Ctx,
  x: number,
  y: number,
  tx: number,
  ty: number,
  wood: { base: string; dark: string; light: string; mid: string },
): void {
  for (let row = 0; row < 4; row++) {
    const py = y + row * 4;
    const lane = ty * 4 + row;
    const offset = Math.floor(noise2(lane, 5, 21) * 16);
    const cut = (tx * 16 + offset) % 32 < 16 ? 0 : 1;
    const tone = noise2(Math.floor((tx * 16 + offset) / 24), lane, 7);
    const color = tone < 0.33 ? wood.base : tone < 0.66 ? wood.mid : mix(wood.base, wood.light, 0.5);
    rect(ctx, x, py, T, 3, color);
    hline(ctx, x, py + 3, T, wood.dark);
    hline(ctx, x, py, T, mix(color, wood.light, 0.35));
    if (cut === 0 && noise2(tx, lane, 9) > 0.5) vline(ctx, x + (offset % 16), py, 4, wood.dark);
    if (noise2(tx, lane, 15) > 0.6) hline(ctx, x + 3 + (lane % 5), py + 1, 5, shade(color, -0.08));
  }
}

function herringbone(ctx: Ctx, x: number, y: number, tx: number, ty: number): void {
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const cx = x + i * 8;
      const cy = y + j * 8;
      const horizontal = (tx * 2 + i + ty * 2 + j) % 2 === 0;
      for (let k = 0; k < 2; k++) {
        const tone = noise2(tx * 2 + i, ty * 4 + j * 2 + k, 31);
        const base = tone < 0.5 ? OAK.base : mix(OAK.base, WALNUT.light, 0.45);
        const c = mix(base, OAK.mid, tone * 0.4);
        if (horizontal) {
          rect(ctx, cx, cy + k * 4, 8, 3, c);
          hline(ctx, cx, cy + k * 4 + 3, 8, WALNUT.base);
          hline(ctx, cx, cy + k * 4, 8, mix(c, OAK.hi, 0.35));
        } else {
          rect(ctx, cx + k * 4, cy, 3, 8, c);
          vline(ctx, cx + k * 4 + 3, cy, 8, WALNUT.base);
          vline(ctx, cx + k * 4, cy, 8, mix(c, OAK.hi, 0.35));
        }
      }
    }
  }
}

function stone(ctx: Ctx, x: number, y: number, tx: number, ty: number): void {
  const tone = noise2(tx, ty, 41);
  rect(ctx, x, y, T, T, tone < 0.5 ? '#d9d3c7' : '#d3ccbf');
  hline(ctx, x, y, T, '#bdb5a6');
  vline(ctx, x, y, T, '#bdb5a6');
  hline(ctx, x + 1, y + 1, T - 1, '#e8e3d9');
  for (let i = 0; i < 4; i++) {
    const nx = Math.floor(noise2(tx, ty, 50 + i) * 14) + 1;
    const ny = Math.floor(noise2(tx, ty, 60 + i) * 14) + 1;
    rect(ctx, x + nx, y + ny, 1, 1, noise2(tx, ty, 70 + i) > 0.5 ? '#c3bbac' : '#e6e0d4');
  }
}

function carpetAlt(pattern: number, gx: number, gy: number): boolean {
  switch (pattern) {
    case 1:
      return Math.floor(gx / 4) % 2 === 0;
    case 2:
      return (Math.floor(gx / 8) + Math.floor(gy / 8)) % 2 === 0;
    case 3:
      return (Math.abs((gx % 16) - 8) + Math.abs((gy % 16) - 8)) % 16 < 5;
    default:
      return false;
  }
}

function carpet(ctx: Ctx, x: number, y: number, tx: number, ty: number, theme: AreaTheme): void {
  const a = theme.carpet;
  const b = theme.carpetAlt;
  rect(ctx, x, y, T, T, a);
  const px = tx * T;
  const py = ty * T;
  for (let j = 0; j < T; j++) {
    for (let i = 0; i < T; i++) {
      const gx = px + i;
      const gy = py + j;
      const alt = carpetAlt(theme.pattern, gx, gy);
      if (alt) rect(ctx, x + i, y + j, 1, 1, b);
      else if (noise2(gx, gy, 5) > 0.86) rect(ctx, x + i, y + j, 1, 1, shade(a, 0.07));
      else if (noise2(gx, gy, 6) > 0.9) rect(ctx, x + i, y + j, 1, 1, shade(a, -0.08));
    }
  }
}

function deck(ctx: Ctx, x: number, y: number, tx: number, ty: number): void {
  for (let row = 0; row < 5; row++) {
    const py = y + row * 3 + (row === 4 ? 0 : 0);
    if (py >= y + T) break;
    const tone = noise2(tx, ty * 5 + row, 91);
    const c = tone < 0.5 ? '#9a7048' : '#8c6540';
    rect(ctx, x, py, T, 2, c);
    hline(ctx, x, py + 2, T, '#5e4128');
    hline(ctx, x, py, T, '#b08658');
  }
}

function slate(ctx: Ctx, x: number, y: number, tx: number, ty: number): void {
  rect(ctx, x, y, T, T, noise2(tx, ty, 17) > 0.5 ? '#3a3f49' : '#363b44');
  hline(ctx, x, y, T, '#2a2e36');
  vline(ctx, x, y, T, '#2a2e36');
}

/** Paint the floor of one 16x16 tile at pixel (x, y); (tx, ty) are absolute tile coordinates. */
export function paintFloorTile(
  ctx: Ctx,
  theme: AreaTheme,
  tx: number,
  ty: number,
  x: number,
  y: number,
  areaId: string,
): void {
  switch (theme.floor) {
    case 'marble':
      return marble(ctx, x, y, tx, ty);
    case 'tile':
      return areaId === 'bathrooms'
        ? smallTile(ctx, x, y, tx, ty, '#e4eef0', '#bfd9de')
        : porcelain(ctx, x, y, tx, ty, areaId === 'copa');
    case 'wood':
      return planks(ctx, x, y, tx, ty, WALNUT);
    case 'parquet':
      return herringbone(ctx, x, y, tx, ty);
    case 'stone':
      return stone(ctx, x, y, tx, ty);
    case 'carpet':
      return carpet(ctx, x, y, tx, ty, theme);
    case 'deck':
      return deck(ctx, x, y, tx, ty);
    case 'slate':
      return slate(ctx, x, y, tx, ty);
  }
}
