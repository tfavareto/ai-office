import type { ExteriorLayout, Lamp, Rooftop, Tree } from '../../layout/exterior';
import type { Rect } from '../../layout/types';
import { TILE } from '../../layout/constants';
import { mix, noise2, shade } from '../color';
import { GRAPHITE, PLANT } from '../palette';
import { type Ctx, disc, ellipse, hline, rect, vline } from './ctx';

const ASPHALT = '#3b3f48';
const SIDEWALK = '#cdc8bc';

function tileRect(r: Rect): Rect {
  return { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE };
}

function fill(ctx: Ctx, r: Rect, color: string): void {
  const p = tileRect(r);
  rect(ctx, p.x, p.y, p.w, p.h, color);
}

function speckle(ctx: Ctx, r: Rect, base: string, seed: number): void {
  const p = tileRect(r);
  for (let y = p.y; y < p.y + p.h; y += 2) {
    for (let x = p.x; x < p.x + p.w; x += 2) {
      const n = noise2(x, y, seed);
      if (n > 0.9) rect(ctx, x, y, 1, 1, shade(base, 0.08));
      else if (n < 0.08) rect(ctx, x, y, 1, 1, shade(base, -0.08));
    }
  }
}

function asphalt(ctx: Ctx, street: Rect, horizontal: boolean): void {
  fill(ctx, street, ASPHALT);
  speckle(ctx, street, ASPHALT, 5);
  const p = tileRect(street);
  if (horizontal) {
    const mid = p.y + Math.floor(p.h / 2);
    for (let x = p.x; x < p.x + p.w; x += 24) rect(ctx, x, mid - 1, 14, 2, '#e6c75a');
    hline(ctx, p.x, p.y + 1, p.w, '#d8d8d8');
    hline(ctx, p.x, p.y + p.h - 2, p.w, '#d8d8d8');
  } else {
    const mid = p.x + Math.floor(p.w / 2);
    for (let y = p.y; y < p.y + p.h; y += 24) rect(ctx, mid - 1, y, 2, 14, '#e6c75a');
    vline(ctx, p.x + 1, p.y, p.h, '#d8d8d8');
    vline(ctx, p.x + p.w - 2, p.y, p.h, '#d8d8d8');
  }
}

function sidewalk(ctx: Ctx, r: Rect): void {
  const p = tileRect(r);
  rect(ctx, p.x, p.y, p.w, p.h, SIDEWALK);
  for (let y = p.y; y < p.y + p.h; y += TILE) {
    for (let x = p.x; x < p.x + p.w; x += TILE) {
      const n = noise2(x, y, 9);
      if (n > 0.7) rect(ctx, x + 1, y + 1, TILE - 1, TILE - 1, shade(SIDEWALK, 0.04));
      else if (n < 0.2) rect(ctx, x + 1, y + 1, TILE - 1, TILE - 1, shade(SIDEWALK, -0.04));
      hline(ctx, x, y, TILE, '#b9b3a6');
      vline(ctx, x, y, TILE, '#b9b3a6');
    }
  }
}

function crosswalk(ctx: Ctx, r: Rect, horizontal: boolean): void {
  const p = tileRect(r);
  if (horizontal) {
    for (let y = p.y + 2; y < p.y + p.h - 2; y += 5) rect(ctx, p.x, y, p.w, 3, '#ececec');
  } else {
    for (let x = p.x + 2; x < p.x + p.w - 2; x += 5) rect(ctx, x, p.y, 3, p.h, '#ececec');
  }
}

function rooftop(ctx: Ctx, roof: Rooftop): void {
  const p = tileRect(roof.rect);
  const tones = ['#6b717c', '#7a6e66', '#5d6a73', '#76706a'];
  const base = tones[roof.variant % tones.length];
  rect(ctx, p.x, p.y, p.w, p.h, '#2a2e36');
  rect(ctx, p.x + 2, p.y + 2, p.w - 4, p.h - 4, '#d9d4c8');
  rect(ctx, p.x + 5, p.y + 5, p.w - 10, p.h - 10, base);
  speckle(ctx, { x: (p.x + 5) / TILE, y: (p.y + 5) / TILE, w: (p.w - 10) / TILE, h: (p.h - 10) / TILE }, base, 12);
  hline(ctx, p.x + 2, p.y + 2, p.w - 4, '#f0ece2');
  rect(ctx, p.x, p.y + p.h - 6, p.w, 6, 'rgba(8,10,18,0.35)');
  const n = 2 + (roof.variant % 3);
  for (let i = 0; i < n; i++) {
    const bx = p.x + 10 + Math.floor(noise2(i, roof.rect.x, 3) * (p.w - 44));
    const by = p.y + 10 + Math.floor(noise2(i, roof.rect.y, 4) * (p.h - 40));
    if (i % 2 === 0) {
      rect(ctx, bx, by, 22, 14, '#aeb4bd');
      rect(ctx, bx, by, 22, 3, '#d8dce2');
      rect(ctx, bx + 3, by + 5, 16, 7, '#8a919c');
      disc(ctx, bx + 11, by + 8, 3, '#4c525c');
    } else {
      rect(ctx, bx, by, 18, 12, 'rgba(150,200,225,0.8)');
      rect(ctx, bx, by, 18, 2, '#e8f3f8');
      for (let k = 6; k < 18; k += 6) vline(ctx, bx + k, by, 12, GRAPHITE.mid);
    }
  }
}

function tree(ctx: Ctx, t: Tree): void {
  const cx = t.x * TILE + 8;
  const cy = t.y * TILE + 8;
  ellipse(ctx, cx + 3, cy + 9, 12, 5, 'rgba(8,10,18,0.28)');
  const greens = [PLANT.base, '#4a8a52', '#5b9a4a'];
  const main = greens[t.variant % 3];
  disc(ctx, cx, cy - 4, 12, shade(main, -0.35));
  disc(ctx, cx - 1, cy - 5, 11, shade(main, -0.12));
  disc(ctx, cx - 4, cy - 8, 6, main);
  disc(ctx, cx + 5, cy - 3, 5, shade(main, 0.08));
  for (let i = 0; i < 9; i++) {
    const a = noise2(t.x, i, 2) * Math.PI * 2;
    const r = 3 + noise2(t.x, i, 3) * 7;
    rect(ctx, Math.round(cx - 3 + Math.cos(a) * r), Math.round(cy - 6 + Math.sin(a) * r), 2, 2, mix(main, PLANT.hi, 0.55));
  }
  rect(ctx, cx - 1, cy + 5, 3, 4, '#4a3320');
}

function lamp(ctx: Ctx, l: Lamp): void {
  const x = l.x * TILE + 7;
  const y = l.y * TILE;
  ellipse(ctx, x + 1, y + 13, 3, 1, 'rgba(8,10,18,0.3)');
  rect(ctx, x, y - 10, 2, 22, GRAPHITE.mid);
  rect(ctx, x - 3, y - 12, 8, 3, GRAPHITE.dark);
  rect(ctx, x - 2, y - 9, 6, 1, '#f3e4c1');
  rect(ctx, x - 1, y + 10, 4, 3, GRAPHITE.dark);
}

function bench(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x, y, 20, 3, '#8a6a45');
  rect(ctx, x, y - 4, 20, 3, '#7a5a38');
  rect(ctx, x + 1, y + 3, 2, 3, GRAPHITE.mid);
  rect(ctx, x + 17, y + 3, 2, 3, GRAPHITE.mid);
  hline(ctx, x, y, 20, '#b08658');
}

function planter(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x, y, 14, 7, '#8c8578');
  hline(ctx, x, y, 14, '#b9b2a4');
  disc(ctx, x + 4, y - 1, 3, PLANT.base);
  disc(ctx, x + 10, y - 2, 3, PLANT.mid);
  disc(ctx, x + 7, y - 4, 3, PLANT.light);
}

function grass(ctx: Ctx, r: Rect): void {
  const p = tileRect(r);
  rect(ctx, p.x, p.y, p.w, p.h, '#6b9a55');
  for (let y = p.y; y < p.y + p.h; y += 2) {
    for (let x = p.x; x < p.x + p.w; x += 2) {
      const n = noise2(x, y, 21);
      if (n > 0.82) rect(ctx, x, y, 1, 2, '#7fae66');
      else if (n < 0.1) rect(ctx, x, y, 1, 1, '#587f45');
    }
  }
}

/** Paint the static street frame into `ctx`, whose origin is the world (0,0) tile origin shifted by (-offsetX, -offsetY) px. */
export function paintExterior(ctx: Ctx, layout: ExteriorLayout): void {
  const b = layout.bounds;
  fill(ctx, b, '#8d8a80');
  for (const g of layout.grass) grass(ctx, g);
  layout.sidewalks.forEach((s) => sidewalk(ctx, s));
  layout.streets.forEach((s, i) => asphalt(ctx, s, i < 2));
  layout.crosswalks.forEach((c, i) => crosswalk(ctx, c, i < 2));
  layout.rooftops.forEach((r) => rooftop(ctx, r));
  // curbs
  for (const s of layout.streets) {
    const p = tileRect(s);
    rect(ctx, p.x, p.y - 1, p.w, 1, '#a39d90');
    rect(ctx, p.x, p.y + p.h, p.w, 1, '#a39d90');
  }
  for (const l of layout.lamps) lamp(ctx, l);
  const sw = layout.sidewalks[0];
  for (let i = 0; i < 5; i++) {
    const x = sw.x * TILE + 70 + i * 230;
    bench(ctx, x, (sw.y + 1) * TILE + 2);
    planter(ctx, x + 90, (sw.y + 1) * TILE + 4);
  }
  for (const t of layout.trees) tree(ctx, t);
}
