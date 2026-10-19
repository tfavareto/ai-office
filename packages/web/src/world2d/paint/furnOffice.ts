import type { FurnitureItem } from '../../layout/types';
import { mix, noise2, shade } from '../color';
import { BRASS, EBONY, GRAPHITE, LED, OAK, PLANT, WALNUT, WOODS } from '../palette';
import { type Ctx, bevel, ellipse, hline, pixel, rect, vline } from './ctx';

/** Position of the 4 screens of a desk, relative to the desk footprint's top-left (px). */
export const DESK_SCREENS = [0, 1, 2, 3].map((i) => ({ x: 2 + i * 15, y: -8, w: 12, h: 7 }));

const wood = (i: number): (typeof WOODS)[number] => WOODS[i % WOODS.length];

export function desk(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  const top = wood(it.variant % 2 === 0 ? 0 : 1);
  // monitors
  for (let i = 0; i < 4; i++) {
    const x = 1 + i * 15;
    rect(ctx, x + 5, 0, 4, 3, GRAPHITE.mid);
    rect(ctx, x + 3, 2, 8, 1, GRAPHITE.dark);
    bevel(ctx, x, -9, 14, 10, GRAPHITE.deep, GRAPHITE.mid, '#0b0d11');
    rect(ctx, x + 1, -8, 12, 7, '#10151f');
    pixel(ctx, x + 12, 0, LED.teal);
  }
  // desk top and front panel
  rect(ctx, 0, 2, w, 10, top.mid);
  hline(ctx, 0, 2, w, top.hi);
  hline(ctx, 0, 3, w, top.light);
  for (let x = 2; x < w - 2; x += 7) hline(ctx, x + (noise2(x, it.variant, 4) > 0.5 ? 1 : 0), 6 + (x % 3) * 2, 5, shade(top.mid, -0.08));
  rect(ctx, 0, 12, w, 4, top.dark);
  hline(ctx, 0, 12, w, shade(top.dark, 0.25));
  rect(ctx, 1, 13, 3, 3, EBONY.dark);
  rect(ctx, w - 4, 13, 3, 3, EBONY.dark);
  rect(ctx, w - 22, 13, 18, 3, shade(top.dark, -0.12));
  hline(ctx, w - 22, 14, 18, shade(top.dark, 0.18));
  hline(ctx, w - 14, 13, 4, BRASS.base);
  // accessories vary per workstation
  rect(ctx, 22, 7, 14, 3, '#cfd3da');
  hline(ctx, 22, 7, 14, '#eef0f4');
  for (let k = 0; k < 4; k++) vline(ctx, 24 + k * 3, 8, 1, '#9aa1ad');
  rect(ctx, 38, 8, 2, 2, '#e5e8ee');
  const cups = ['#e0795a', '#4f86f7', '#e8e2d2', '#3b8a52'];
  rect(ctx, 50, 5, 4, 4, cups[it.variant % 4]);
  pixel(ctx, 54, 6, cups[it.variant % 4]);
  hline(ctx, 50, 5, 4, shade(cups[it.variant % 4], 0.35));
  rect(ctx, 4, 6, 8, 5, '#efe6cf');
  hline(ctx, 4, 6, 8, '#fffaf0');
  for (let k = 0; k < 3; k++) hline(ctx, 5, 7 + k * 1, 5 - (k % 2), '#9a8f78');
  if (it.variant % 3 === 1) {
    rect(ctx, 41, 4, 4, 4, PLANT.pot);
    rect(ctx, 41, 2, 4, 3, PLANT.base);
    pixel(ctx, 42, 1, PLANT.light);
  }
}

export function chair(ctx: Ctx, it: FurnitureItem): void {
  const cx = it.w * 8;
  const tone = ['#2d3139', '#23406b', '#5a4030'][it.variant % 3];
  ellipse(ctx, cx, 13, 6, 2, '#15171c');
  rect(ctx, cx - 1, 11, 2, 3, GRAPHITE.mid);
  rect(ctx, cx - 5, 12, 2, 2, GRAPHITE.dark);
  rect(ctx, cx + 3, 12, 2, 2, GRAPHITE.dark);
  bevel(ctx, cx - 6, 5, 12, 7, tone, shade(tone, 0.25), shade(tone, -0.3));
  bevel(ctx, cx - 5, -6, 10, 12, tone, shade(tone, 0.28), shade(tone, -0.3));
  rect(ctx, cx - 3, -4, 6, 6, shade(tone, 0.08));
  rect(ctx, cx - 8, 3, 2, 5, GRAPHITE.dark);
  rect(ctx, cx + 6, 3, 2, 5, GRAPHITE.dark);
}

export function shelf(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  const body = wood(it.variant === 1 ? 1 : 0);
  rect(ctx, 0, -10, w, 26, body.dark);
  rect(ctx, 1, -9, w - 2, 24, shade(body.dark, -0.25));
  const colors = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2', '#f79646', '#4bacc6', '#d9d9d9', '#3b3b3b'];
  for (let row = 0; row < 3; row++) {
    const y = -9 + row * 8;
    let x = 2;
    while (x < w - 3) {
      const bw = 2 + Math.floor(noise2(x, row + it.x, 5) * 2);
      const bh = 5 + Math.floor(noise2(x, row, 6) * 2);
      rect(ctx, x, y + 7 - bh, bw, bh, colors[Math.floor(noise2(x, row, 7) * colors.length)]);
      x += bw;
    }
    rect(ctx, 1, y + 7, w - 2, 1, body.light);
  }
  hline(ctx, 0, -10, w, body.hi);
  rect(ctx, 0, 15, w, 1, '#0a0806');
}

export function copier(ctx: Ctx): void {
  rect(ctx, 1, 4, 14, 12, '#d8dce2');
  hline(ctx, 1, 4, 14, '#f5f7fa');
  rect(ctx, 2, 0, 12, 4, '#b7bdc7');
  rect(ctx, 3, 8, 10, 3, GRAPHITE.mid);
  rect(ctx, 11, 6, 3, 1, LED.teal);
  rect(ctx, 2, 12, 12, 3, '#aab0ba');
  hline(ctx, 2, 15, 12, '#6e7683');
}

export function bin(ctx: Ctx): void {
  rect(ctx, 4, 6, 8, 9, GRAPHITE.mid);
  hline(ctx, 4, 6, 8, GRAPHITE.hi);
  rect(ctx, 5, 7, 6, 1, GRAPHITE.deep);
  vline(ctx, 4, 7, 8, GRAPHITE.light);
  vline(ctx, 11, 7, 8, GRAPHITE.dark);
}

function leaf(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, base: string, light: string): void {
  ellipse(ctx, cx, cy, rx, ry, base);
  ellipse(ctx, cx - 1, cy - 1, Math.max(1, rx - 2), Math.max(1, ry - 2), light);
}

export function plant(ctx: Ctx, it: FurnitureItem): void {
  const kind = it.variant % 4;
  const pots = [PLANT.pot, '#2d3139', '#b98557', '#e8e2d2'];
  const pot = pots[(it.variant + 1) % 4];
  rect(ctx, 4, 10, 8, 6, pot);
  hline(ctx, 3, 9, 10, shade(pot, 0.2));
  hline(ctx, 4, 15, 8, shade(pot, -0.35));
  rect(ctx, 5, 10, 6, 1, '#3a2a1c');
  if (kind === 0) {
    leaf(ctx, 8, 3, 6, 6, PLANT.base, PLANT.mid);
    leaf(ctx, 5, 5, 3, 3, PLANT.dark, PLANT.base);
    leaf(ctx, 11, 1, 3, 3, PLANT.mid, PLANT.light);
  } else if (kind === 1) {
    for (let i = 0; i < 5; i++) {
      vline(ctx, 4 + i * 2, 1 - (i % 2) * 2, 9 + (i % 2) * 2, i % 2 ? PLANT.mid : PLANT.base);
      vline(ctx, 5 + i * 2, 2 - (i % 2) * 2, 8, PLANT.dark);
    }
  } else if (kind === 2) {
    leaf(ctx, 5, 4, 4, 3, PLANT.base, PLANT.light);
    leaf(ctx, 11, 3, 4, 4, PLANT.mid, PLANT.hi);
    leaf(ctx, 8, -1, 4, 3, PLANT.dark, PLANT.mid);
  } else {
    vline(ctx, 8, -2, 11, WALNUT.base);
    for (let i = 0; i < 4; i++) {
      hline(ctx, 8 - 5 + i, -2 + i, 5 - i, PLANT.mid);
      hline(ctx, 9, -2 + i, 5 - i, PLANT.base);
    }
    pixel(ctx, 4, 3, PLANT.light);
    pixel(ctx, 12, 3, PLANT.light);
  }
}

export function plantTall(ctx: Ctx, it: FurnitureItem): void {
  rect(ctx, 3, 9, 10, 7, '#e8e2d2');
  hline(ctx, 2, 8, 12, '#fffaf0');
  hline(ctx, 3, 15, 10, '#aaa294');
  rect(ctx, 3, 12, 10, 1, BRASS.base);
  rect(ctx, 4, 8, 8, 1, '#3a2a1c');
  if (it.variant % 2 === 0) {
    vline(ctx, 8, -8, 17, WALNUT.base);
    leaf(ctx, 8, -12, 7, 5, PLANT.base, PLANT.mid);
    leaf(ctx, 4, -6, 4, 4, PLANT.dark, PLANT.base);
    leaf(ctx, 12, -6, 4, 4, PLANT.mid, PLANT.light);
    leaf(ctx, 8, -2, 5, 3, PLANT.base, PLANT.light);
  } else {
    for (let i = 0; i < 7; i++) {
      const x = 3 + i * 2;
      const top = -14 + Math.abs(3 - i) * 3;
      vline(ctx, x, top, 22 - (top + 14) - 6, i % 2 ? PLANT.base : PLANT.mid);
      vline(ctx, x + 1, top + 1, 14 - (top + 14), PLANT.dark);
    }
    pixel(ctx, 8, -15, PLANT.hi);
  }
}

export function lamp(ctx: Ctx): void {
  ellipse(ctx, 8, 14, 4, 1, BRASS.dark);
  vline(ctx, 8, -6, 20, BRASS.base);
  vline(ctx, 9, -4, 18, BRASS.dark);
  rect(ctx, 4, -12, 9, 7, '#f3e4c1');
  hline(ctx, 4, -12, 9, '#fff6dc');
  rect(ctx, 3, -6, 11, 1, BRASS.base);
  vline(ctx, 12, -11, 5, '#d8c79c');
}

export function sideTable(ctx: Ctx, it: FurnitureItem): void {
  const top = wood(it.variant);
  ellipse(ctx, 8, 7, 6, 3, top.mid);
  ellipse(ctx, 8, 6, 6, 3, top.light);
  rect(ctx, 7, 9, 2, 6, BRASS.dark);
  rect(ctx, 5, 15, 6, 1, BRASS.base);
  rect(ctx, 7, 1, 3, 4, '#9ec5d1');
  pixel(ctx, 8, 0, PLANT.base);
  pixel(ctx, 9, -1, PLANT.light);
}

export function bench(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  rect(ctx, 2, 4, 2, 11, BRASS.dark);
  rect(ctx, w - 4, 4, 2, 11, BRASS.dark);
  bevel(ctx, 0, 2, w, 7, OAK.base, OAK.hi, OAK.dark);
  for (let x = 4; x < w - 2; x += 5) vline(ctx, x, 3, 5, OAK.dark);
  rect(ctx, 0, -3, w, 5, WALNUT.base);
  hline(ctx, 0, -3, w, WALNUT.hi);
  rect(ctx, 0, 9, w, 2, 'rgba(0,0,0,0.25)');
}

export function waterCooler(ctx: Ctx): void {
  rect(ctx, 3, 4, 10, 12, '#dfe4ea');
  hline(ctx, 3, 4, 10, '#ffffff');
  rect(ctx, 3, 12, 10, 4, '#b8c0cc');
  rect(ctx, 6, 8, 2, 2, LED.teal);
  rect(ctx, 9, 8, 2, 2, '#ff8a6a');
  rect(ctx, 4, -9, 8, 13, 'rgba(120,190,235,0.85)');
  hline(ctx, 4, -9, 8, '#d7efff');
  rect(ctx, 5, -5, 6, 8, 'rgba(70,150,215,0.9)');
  rect(ctx, 6, -11, 4, 2, '#e8f4fb');
  vline(ctx, 5, -8, 10, 'rgba(255,255,255,0.5)');
}

export function rugFill(ctx: Ctx, it: FurnitureItem, accent: string, carpet: string): void {
  const w = it.w * 16;
  const h = it.h * 16;
  const base = mix(carpet, accent, 0.1);
  ctx.globalAlpha = 0.55;
  rect(ctx, 3, 3, w - 6, h - 6, shade(base, -0.12));
  rect(ctx, 5, 5, w - 10, h - 10, base);
  ctx.globalAlpha = 1;
  for (let x = 6; x < w - 6; x += 4) {
    pixel(ctx, x, 4, BRASS.dark);
    pixel(ctx, x, h - 5, BRASS.dark);
  }
  for (let y = 6; y < h - 6; y += 4) {
    pixel(ctx, 4, y, BRASS.dark);
    pixel(ctx, w - 5, y, BRASS.dark);
  }
  hline(ctx, 7, 7, w - 14, shade(base, 0.12));
}
