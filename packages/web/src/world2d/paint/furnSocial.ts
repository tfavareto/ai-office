import type { FurnitureItem } from '../../layout/types';
import { noise2, shade } from '../color';
import { drawPixelText, textWidth } from '../font';
import { BRASS, EBONY, GRAPHITE, LED, MARBLE, OAK, PLANT, WALNUT } from '../palette';
import { type Ctx, bevel, disc, ellipse, hline, pixel, rect, vline } from './ctx';

const UPHOLSTERY = ['#27406b', '#b07a4a', '#2c6b72', '#6b6f78', '#8a3f4a', '#4a5a3a'];

export function receptionDesk(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  const h = it.h * 16;
  rect(ctx, 0, 8, w, h - 8, WALNUT.base);
  for (let x = 2; x < w - 2; x += 4) {
    vline(ctx, x, 12, h - 14, WALNUT.mid);
    vline(ctx, x + 1, 12, h - 14, WALNUT.dark);
  }
  rect(ctx, 0, 0, w, 11, MARBLE.light);
  hline(ctx, 0, 0, w, '#ffffff');
  hline(ctx, 0, 10, w, MARBLE.vein);
  rect(ctx, 0, 11, w, 2, BRASS.base);
  hline(ctx, 0, 11, w, BRASS.hi);
  rect(ctx, 0, h - 3, w, 3, WALNUT.dark);
  rect(ctx, 0, h - 4, w, 1, 'rgba(39,198,204,0.7)');
  const cx = Math.floor(w / 2);
  rect(ctx, cx - 12, 17, 24, 9, EBONY.base);
  hline(ctx, cx - 12, 17, 24, BRASS.base);
  drawPixelText(ctx, 'AI OFFICE', cx - Math.floor(textWidth('AI OFFICE') / 2), 19, BRASS.hi);
  // monitor + bell on the marble
  bevel(ctx, 6, -6, 11, 8, GRAPHITE.deep, GRAPHITE.mid, '#0b0d11');
  rect(ctx, 7, -5, 9, 5, '#27406b');
  rect(ctx, w - 18, 1, 5, 3, BRASS.light);
  disc(ctx, w - 15, 0, 1, BRASS.hi);
  rect(ctx, w - 34, 2, 7, 5, '#f4efe2');
}

export function sofa(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  const base = UPHOLSTERY[it.variant % UPHOLSTERY.length];
  const dark = shade(base, -0.28);
  const light = shade(base, 0.22);
  const facingNorth = it.facing === 'n';
  rect(ctx, 2, 14, 2, 2, BRASS.dark);
  rect(ctx, w - 4, 14, 2, 2, BRASS.dark);
  if (!facingNorth) {
    bevel(ctx, 0, -6, w, 9, dark, base, shade(dark, -0.2));
    bevel(ctx, 0, 0, 4, 14, base, light, dark);
    bevel(ctx, w - 4, 0, 4, 14, base, light, dark);
    const seats = Math.max(1, Math.round((w - 8) / 16));
    for (let i = 0; i < seats; i++) {
      const sx = 4 + (i * (w - 8)) / seats;
      bevel(ctx, Math.round(sx), 3, Math.round((w - 8) / seats), 11, base, light, dark);
    }
  } else {
    bevel(ctx, 0, -6, 4, 20, base, light, dark);
    bevel(ctx, w - 4, -6, 4, 20, base, light, dark);
    bevel(ctx, 4, -6, w - 8, 3, base, light, dark);
    bevel(ctx, 4, -3, w - 8, 18, base, light, dark);
    for (let x = 16; x < w - 4; x += 16) vline(ctx, x, -2, 16, dark);
    hline(ctx, 5, 12, w - 10, dark);
  }
}

export function coffeeTable(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  rect(ctx, 1, 8, w - 2, 7, GRAPHITE.deep);
  bevel(ctx, 0, 2, w, 8, OAK.base, OAK.hi, OAK.dark);
  rect(ctx, 3, 4, w - 6, 4, 'rgba(210,235,245,0.55)');
  rect(ctx, 5, 3, 7, 3, '#e0795a');
  rect(ctx, 6, 2, 5, 1, '#f4efe2');
  disc(ctx, w - 8, 5, 2, '#f4efe2');
  pixel(ctx, w - 8, 4, '#6b4429');
}

export function counter(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  rect(ctx, 0, -6, w, 7, '#f1f3f0');
  for (let x = 0; x < w; x += 8) vline(ctx, x, -6, 7, '#cdd7d1');
  hline(ctx, 0, -2, w, '#cdd7d1');
  rect(ctx, 0, 1, w, 8, MARBLE.light);
  hline(ctx, 0, 1, w, '#ffffff');
  hline(ctx, 0, 8, w, MARBLE.vein);
  rect(ctx, 0, 9, w, 7, WALNUT.base);
  for (let x = 0; x < w; x += 16) {
    vline(ctx, x, 9, 7, WALNUT.dark);
    rect(ctx, x + 6, 11, 4, 1, BRASS.light);
  }
  hline(ctx, 0, 9, w, WALNUT.hi);
  rect(ctx, 0, 15, w, 1, '#0c0908');
  // sink and fruit bowl
  rect(ctx, w - 44, 2, 12, 5, GRAPHITE.light);
  rect(ctx, w - 43, 3, 10, 3, GRAPHITE.dark);
  vline(ctx, w - 38, -2, 4, BRASS.light);
  disc(ctx, 12, 4, 3, '#f4efe2');
  pixel(ctx, 11, 3, '#e0795a');
  pixel(ctx, 13, 3, '#9bbb59');
}

export function coffeeMachine(ctx: Ctx): void {
  bevel(ctx, 2, -8, 12, 10, GRAPHITE.base, GRAPHITE.light, GRAPHITE.deep);
  rect(ctx, 4, -6, 8, 3, '#0b1322');
  pixel(ctx, 5, -5, LED.teal);
  rect(ctx, 6, -2, 4, 1, BRASS.light);
  rect(ctx, 6, -1, 4, 3, '#f4efe2');
  rect(ctx, 3, 1, 10, 1, BRASS.base);
}

export function fridge(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  rect(ctx, 0, -14, w, 30, '#c3cad3');
  hline(ctx, 0, -14, w, '#eef1f5');
  vline(ctx, 0, -14, 30, '#e1e6ec');
  vline(ctx, w - 1, -14, 30, '#8e97a4');
  hline(ctx, 1, -2, w - 2, '#8e97a4');
  vline(ctx, Math.floor(w / 2), -13, 28, '#8e97a4');
  rect(ctx, Math.floor(w / 2) - 3, -9, 1, 6, GRAPHITE.mid);
  rect(ctx, Math.floor(w / 2) + 2, -9, 1, 6, GRAPHITE.mid);
  rect(ctx, 4, -11, 5, 5, '#f4efe2');
  rect(ctx, 5, -10, 3, 1, '#e0795a');
  rect(ctx, 0, 15, w, 1, '#6e7683');
}

export function vending(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  rect(ctx, 0, -14, w, 30, '#1f2a44');
  bevel(ctx, 0, -14, w, 30, '#1f2a44', '#3a4a72', '#0f1626');
  rect(ctx, 3, -11, w - 12, 20, '#0b1020');
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const col = ['#e0795a', '#f2c46d', '#4f9559', '#4f86f7', '#ffffff'][Math.floor(noise2(c, r, it.x) * 5)];
      rect(ctx, 4 + c * 5, -10 + r * 5, 4, 3, col);
    }
  }
  rect(ctx, w - 8, -11, 5, 8, GRAPHITE.mid);
  rect(ctx, w - 7, -10, 3, 2, LED.teal);
  rect(ctx, w - 7, -6, 3, 1, BRASS.light);
  rect(ctx, 3, 11, w - 12, 3, '#05070d');
  hline(ctx, 3, 11, w - 12, GRAPHITE.mid);
}

export function highTable(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  rect(ctx, w / 2 - 1, 5, 2, 10, BRASS.dark);
  rect(ctx, w / 2 - 5, 14, 10, 2, BRASS.base);
  ellipse(ctx, w / 2, 6, w / 2 - 2, 5, MARBLE.shade);
  ellipse(ctx, w / 2, 4, w / 2 - 2, 5, MARBLE.light);
  hline(ctx, 6, 2, 6, '#ffffff');
  rect(ctx, w / 2 - 2, 0, 4, 3, '#e0795a');
  rect(ctx, w / 2 - 1, -1, 2, 1, '#f4efe2');
}

export function stool(ctx: Ctx, it: FurnitureItem): void {
  const tone = it.variant % 2 ? '#2c6b72' : '#b07a4a';
  vline(ctx, 4, 9, 7, BRASS.dark);
  vline(ctx, 11, 9, 7, BRASS.dark);
  hline(ctx, 4, 13, 8, BRASS.base);
  ellipse(ctx, 8, 8, 5, 3, shade(tone, -0.25));
  ellipse(ctx, 8, 7, 5, 3, tone);
  hline(ctx, 6, 5, 4, shade(tone, 0.3));
}

export function roundTable(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  const h = it.h * 16;
  ellipse(ctx, w / 2, h - 5, 5, 2, 'rgba(0,0,0,0.3)');
  rect(ctx, w / 2 - 1, h / 2, 3, h / 2 - 4, BRASS.dark);
  ellipse(ctx, w / 2, h / 2 + 3, w / 2 - 2, h / 2 - 3, MARBLE.shade);
  ellipse(ctx, w / 2, h / 2 + 1, w / 2 - 2, h / 2 - 3, MARBLE.light);
  hline(ctx, 8, 7, 8, '#ffffff');
  rect(ctx, w / 2 - 3, h / 2 - 4, 6, 4, '#f4efe2');
  rect(ctx, w / 2 - 2, h / 2 - 3, 4, 1, '#9a6a40');
}

export function cafeChair(ctx: Ctx, it: FurnitureItem): void {
  const tone = ['#2c6b72', '#b07a4a', '#8a3f4a', '#27406b'][it.variant % 4];
  const side = it.facing === 'e' || it.facing === 'w';
  rect(ctx, 4, 10, 2, 6, BRASS.dark);
  rect(ctx, 10, 10, 2, 6, BRASS.dark);
  bevel(ctx, 3, 6, 10, 6, tone, shade(tone, 0.3), shade(tone, -0.3));
  if (side) {
    const x = it.facing === 'e' ? 2 : 12;
    bevel(ctx, x, -3, 2, 12, tone, shade(tone, 0.3), shade(tone, -0.3));
  } else if (it.facing === 'n') {
    bevel(ctx, 3, 8, 10, 6, tone, shade(tone, 0.3), shade(tone, -0.3));
    bevel(ctx, 3, -3, 10, 6, shade(tone, -0.1), shade(tone, 0.3), shade(tone, -0.3));
  } else {
    bevel(ctx, 3, -3, 10, 6, tone, shade(tone, 0.3), shade(tone, -0.3));
  }
}

export function meetingTable(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  const h = it.h * 16;
  rect(ctx, 6, h - 2, 4, 5, EBONY.base);
  rect(ctx, w - 10, h - 2, 4, 5, EBONY.base);
  bevel(ctx, 0, 2, w, h - 2, WALNUT.mid, WALNUT.hi, WALNUT.dark);
  for (let y = 5; y < h - 1; y += 5) hline(ctx, 2, y, w - 4, shade(WALNUT.mid, -0.08));
  rect(ctx, 0, h - 5, w, 3, WALNUT.base);
  hline(ctx, 0, 2, w, BRASS.base);
  hline(ctx, 0, h - 1, w, BRASS.dark);
  // laptops, notepads and a centre-piece
  for (let i = 0; i < 7; i++) {
    const x = 16 + i * 16 + 2;
    rect(ctx, x, 6, 10, 4, '#d6dae0');
    hline(ctx, x, 6, 10, '#f4f6f9');
    rect(ctx, x + 1, 10, 8, 3, '#e8ebf0');
    rect(ctx, x, h - 11, 9, 5, i % 2 ? '#efe6cf' : '#d8e4ee');
  }
  disc(ctx, w / 2, 7, 3, '#2d3139');
  pixel(ctx, w / 2, 7, LED.teal);
  rect(ctx, w / 2 - 28, 3, 6, 6, PLANT.pot);
  disc(ctx, w / 2 - 25, 2, 3, PLANT.base);
  rect(ctx, w / 2 + 22, 3, 6, 6, PLANT.pot);
  disc(ctx, w / 2 + 25, 2, 3, PLANT.mid);
}

export function meetChair(ctx: Ctx, it: FurnitureItem): void {
  const tone = ['#1f2a44', '#3a2a22', '#2d3139'][it.variant % 3];
  rect(ctx, 7, 12, 2, 4, GRAPHITE.mid);
  rect(ctx, 4, 15, 8, 1, GRAPHITE.dark);
  if (it.facing === 's') {
    bevel(ctx, 3, -4, 10, 9, tone, shade(tone, 0.3), shade(tone, -0.3));
    bevel(ctx, 3, 5, 10, 7, shade(tone, 0.05), shade(tone, 0.3), shade(tone, -0.3));
  } else {
    bevel(ctx, 3, 5, 10, 7, shade(tone, 0.05), shade(tone, 0.3), shade(tone, -0.3));
    bevel(ctx, 3, 6, 10, 9, tone, shade(tone, 0.3), shade(tone, -0.3));
    rect(ctx, 5, -2, 6, 9, shade(tone, 0.12));
  }
}

export function stall(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  const h = it.h * 16;
  const tone = ['#cfe3e6', '#d9e6df', '#e0e4ea'][it.variant % 3];
  rect(ctx, 0, -10, w, h + 10, tone);
  hline(ctx, 0, -10, w, '#ffffff');
  vline(ctx, 0, -10, h + 10, shade(tone, 0.25));
  vline(ctx, w - 1, -10, h + 10, shade(tone, -0.2));
  rect(ctx, 3, -4, w - 6, h - 4, shade(tone, -0.08));
  rect(ctx, 4, -3, w - 8, h - 6, '#4aa3c8');
  hline(ctx, 4, -3, w - 8, '#8fd0e8');
  rect(ctx, w - 8, h / 2 - 3, 2, 2, BRASS.light);
  rect(ctx, 0, h - 2, w, 2, GRAPHITE.light);
  hline(ctx, 0, -10, w, GRAPHITE.light);
}

export function sink(ctx: Ctx): void {
  rect(ctx, 1, 3, 14, 6, MARBLE.light);
  hline(ctx, 1, 3, 14, '#ffffff');
  rect(ctx, 3, 4, 10, 4, '#cfe3ea');
  rect(ctx, 4, 5, 8, 2, '#a9c9d3');
  vline(ctx, 8, -2, 5, BRASS.light);
  rect(ctx, 7, -3, 3, 1, BRASS.light);
  rect(ctx, 1, 9, 14, 7, WALNUT.base);
  hline(ctx, 1, 9, 14, WALNUT.hi);
  rect(ctx, 6, 12, 4, 1, BRASS.light);
}

export function pingpong(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  const h = it.h * 16;
  rect(ctx, 4, h - 4, 4, 7, GRAPHITE.dark);
  rect(ctx, w - 8, h - 4, 4, 7, GRAPHITE.dark);
  bevel(ctx, 0, 2, w, h - 3, '#1d4f8f', '#3a74c0', '#0f2c52');
  rect(ctx, 3, 5, w - 6, h - 9, '#245c9e');
  hline(ctx, 3, 5, w - 6, '#f4f8ff');
  hline(ctx, 3, h - 5, w - 6, '#f4f8ff');
  vline(ctx, 3, 5, h - 9, '#f4f8ff');
  vline(ctx, w - 4, 5, h - 9, '#f4f8ff');
  hline(ctx, 3, Math.floor(h / 2) + 1, w - 6, 'rgba(244,248,255,0.5)');
  rect(ctx, w / 2 - 1, 0, 2, h - 2, 'rgba(235,240,250,0.9)');
  vline(ctx, w / 2, 0, h - 2, GRAPHITE.light);
  rect(ctx, w / 2 - 1, -2, 2, 2, GRAPHITE.mid);
}

export function arcade(ctx: Ctx, it: FurnitureItem): void {
  const neon = it.variant % 2 ? '#e0409a' : '#27c6cc';
  rect(ctx, 1, -14, 14, 30, GRAPHITE.deep);
  vline(ctx, 1, -14, 30, GRAPHITE.mid);
  vline(ctx, 14, -14, 30, '#0a0b0e');
  rect(ctx, 2, -13, 12, 4, neon);
  drawPixelText(ctx, 'GO', 5, -12, '#0b1020');
  bevel(ctx, 3, -8, 10, 9, '#0b1322', '#2a3a5a', '#05080f');
  rect(ctx, 4, -7, 8, 7, '#102b5a');
  rect(ctx, 5, -5, 2, 2, '#ffd86b');
  rect(ctx, 9, -3, 2, 2, neon);
  rect(ctx, 2, 3, 12, 3, GRAPHITE.mid);
  disc(ctx, 5, 4, 1, '#ff4a4a');
  disc(ctx, 11, 4, 1, '#ffd86b');
  rect(ctx, 2, 7, 12, 9, shade(neon, -0.55));
  vline(ctx, 2, 7, 9, neon);
}

export function beanbag(ctx: Ctx, it: FurnitureItem): void {
  const tone = ['#e0795a', '#2c6b72', '#b07a4a', '#6b5bd6'][it.variant % 4];
  ellipse(ctx, 8, 11, 7, 5, shade(tone, -0.3));
  ellipse(ctx, 8, 9, 7, 5, tone);
  ellipse(ctx, 6, 7, 3, 2, shade(tone, 0.25));
  pixel(ctx, 5, 6, shade(tone, 0.5));
}

export function bookshelf(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  rect(ctx, 0, -12, w, 28, OAK.dark);
  rect(ctx, 2, -10, w - 4, 24, '#2b1f16');
  const colors = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2', '#f79646', '#4bacc6', '#ece6d6', '#3a5a40'];
  for (let row = 0; row < 3; row++) {
    const y = -10 + row * 8;
    let x = 3;
    while (x < w - 5) {
      const bw = 2 + Math.floor(noise2(x, row, 3) * 2);
      const bh = 5 + Math.floor(noise2(x, row, 4) * 3);
      rect(ctx, x, y + 7 - bh, bw, bh, colors[Math.floor(noise2(x, row, 5) * colors.length)]);
      x += bw;
      if (noise2(x, row, 6) > 0.93) x += 3;
    }
    rect(ctx, 2, y + 7, w - 4, 1, OAK.light);
  }
  hline(ctx, 0, -12, w, OAK.hi);
  disc(ctx, 10, -9, 1, BRASS.light);
  rect(ctx, 0, 15, w, 1, '#0a0806');
}

export function deckChair(ctx: Ctx, it: FurnitureItem): void {
  const side = it.facing === 'e';
  bevel(ctx, 3, 6, 10, 7, '#e8e2d2', '#ffffff', '#b8b09c');
  bevel(ctx, side ? 1 : 11, -3, 4, 12, '#e8e2d2', '#ffffff', '#b8b09c');
  rect(ctx, 4, 13, 2, 3, BRASS.dark);
  rect(ctx, 10, 13, 2, 3, BRASS.dark);
}

export function deckTable(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  const h = it.h * 16;
  ellipse(ctx, w / 2, h / 2 + 4, w / 2 - 3, h / 2 - 5, '#7a5a38');
  ellipse(ctx, w / 2, h / 2 + 1, w / 2 - 3, h / 2 - 5, '#d9d2c0');
  rect(ctx, w / 2 - 3, h / 2 - 3, 6, 4, '#e0795a');
  rect(ctx, w / 2 - 2, h / 2 - 5, 4, 2, '#f4efe2');
}

export function railing(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * 16;
  rect(ctx, 0, 0, w, 3, GRAPHITE.light);
  for (let x = 0; x < w; x += 6) rect(ctx, x, 3, 1, 12, GRAPHITE.mid);
}
