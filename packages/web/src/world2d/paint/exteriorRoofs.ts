import type { Rooftop } from '../../layout/exterior';
import type { Rect } from '../../layout/types';
import { noise2, rgba, shade } from '../color';
import { GRAPHITE, PLANT } from '../palette';
import { type Ctx, disc, ellipse, hline, rect, vline } from './ctx';
import { pick, speckle, tileRect } from './exteriorUtil';

type RoofKind = 'gravel' | 'membrane' | 'green' | 'deck';
const KINDS: readonly { kind: RoofKind; base: string }[] = [
  { kind: 'gravel', base: '#8a867d' },
  { kind: 'membrane', base: '#69727c' },
  { kind: 'green', base: '#62874f' },
  { kind: 'deck', base: '#a58d68' },
];
const COPING = '#e3ded2';
const COPING_DARK = '#a9a496';
const CELL_W = 28;
const CELL_H = 22;
const ROOF_INSET = 7;

/** Ground the neighbouring buildings stand on between each other: dark gravel, so alleys do not read as empty patches. */
export const ALLEY_COLOR = '#5b5a57';

function hvac(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x + 2, y + 13, 22, 3, 'rgba(8,10,18,0.28)');
  rect(ctx, x, y + 3, 22, 11, '#8e949e');
  rect(ctx, x, y, 22, 4, '#c9ced6');
  hline(ctx, x, y, 22, '#eef1f5');
  rect(ctx, x, y + 12, 22, 2, '#646b76');
  disc(ctx, x + 7, y + 8, 3, '#3d434d');
  disc(ctx, x + 7, y + 8, 1, '#7b8391');
  for (let k = 0; k < 4; k++) hline(ctx, x + 13, y + 5 + k * 2, 7, '#6f7682');
}

function skylight(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x + 1, y + 11, 20, 3, 'rgba(8,10,18,0.25)');
  rect(ctx, x, y, 20, 12, '#d7dce2');
  rect(ctx, x + 2, y + 2, 16, 8, '#8cc0d8');
  rect(ctx, x + 2, y + 2, 16, 3, '#b9e0ee');
  for (let k = 6; k < 18; k += 5) vline(ctx, x + k, y + 2, 8, '#d7dce2');
  hline(ctx, x + 2, y + 6, 16, '#d7dce2');
  hline(ctx, x, y, 20, '#f6f8fa');
}

function tank(ctx: Ctx, x: number, y: number): void {
  ellipse(ctx, x + 11, y + 15, 9, 3, 'rgba(8,10,18,0.28)');
  rect(ctx, x + 3, y + 5, 16, 10, '#9c7b57');
  for (let k = 7; k < 15; k += 3) hline(ctx, x + 3, y + k, 16, '#6e5138');
  ellipse(ctx, x + 11, y + 5, 8, 3, '#b8946b');
  ellipse(ctx, x + 11, y + 4, 6, 2, '#6e5138');
}

function stairHut(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x + 2, y + 13, 16, 3, 'rgba(8,10,18,0.28)');
  rect(ctx, x, y + 3, 16, 11, '#b6b1a5');
  rect(ctx, x, y, 16, 4, '#d9d4c8');
  hline(ctx, x, y, 16, '#f2eee4');
  rect(ctx, x + 6, y + 7, 5, 7, '#4f565f');
  rect(ctx, x + 7, y + 8, 3, 6, '#7c8794');
}

function solar(ctx: Ctx, x: number, y: number): void {
  for (let row = 0; row < 2; row++) {
    const py = y + 2 + row * 9;
    rect(ctx, x + 1, py + 7, 24, 2, 'rgba(8,10,18,0.25)');
    rect(ctx, x, py, 24, 7, '#25395b');
    rect(ctx, x, py, 24, 1, '#7d95bd');
    for (let k = 6; k < 24; k += 6) vline(ctx, x + k, py, 7, '#4a628c');
    hline(ctx, x, py + 3, 24, '#3a5078');
  }
}

function bed(ctx: Ctx, x: number, y: number, seed: number): void {
  rect(ctx, x, y + 2, 22, 11, '#7a7468');
  rect(ctx, x + 1, y + 3, 20, 9, '#4d3a2a');
  for (let k = 0; k < 6; k++) {
    const px = x + 3 + k * 3 + (k % 2);
    const py = y + 5 + ((k * 5) % 5);
    disc(ctx, px, py, 2, k % 2 ? PLANT.mid : PLANT.light);
    if (noise2(k, seed, 7) > 0.6) rect(ctx, px, py - 1, 2, 2, ['#e0795a', '#f2c46d', '#e7e2f5'][k % 3]);
  }
}

const GEAR = [hvac, skylight, tank, stairHut, solar] as const;

function equipment(ctx: Ctx, roof: Rect, seed: number, kind: RoofKind): void {
  const x0 = roof.x + ROOF_INSET + 3;
  const y0 = roof.y + ROOF_INSET + 3;
  const cols = Math.floor((roof.w - ROOF_INSET * 2 - 6) / CELL_W);
  const rows = Math.floor((roof.h - ROOF_INSET * 2 - 6) / CELL_H);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const n = noise2(cx + seed, cy, 31);
      const x = x0 + cx * CELL_W + pick(cx, cy, seed, 4);
      const y = y0 + cy * CELL_H + pick(cy, cx, seed + 5, 3);
      if (n < 0.36) GEAR[Math.floor(n * 14) % GEAR.length](ctx, x, y);
      else if (n < 0.46 && (kind === 'green' || kind === 'deck')) bed(ctx, x, y, seed);
    }
  }
}

function surface(ctx: Ctx, roof: Rect, base: string, kind: RoofKind, seed: number): void {
  rect(ctx, roof.x, roof.y, roof.w, roof.h, base);
  speckle(ctx, roof, base, seed, kind === 'gravel' ? 0.1 : 0.05);
  if (kind === 'membrane') {
    for (let x = roof.x + 12; x < roof.x + roof.w; x += 14) vline(ctx, x, roof.y, roof.h, shade(base, -0.1));
  } else if (kind === 'deck') {
    for (let y = roof.y + 3; y < roof.y + roof.h; y += 4) hline(ctx, roof.x, y, roof.w, shade(base, -0.12));
  } else if (kind === 'green') {
    for (let k = 0; k < roof.w * roof.h / 90; k++) {
      const x = roof.x + Math.floor(noise2(k, seed, 3) * roof.w);
      const y = roof.y + Math.floor(noise2(k, seed, 4) * roof.h);
      rect(ctx, x, y, 2, 2, k % 3 ? shade(base, 0.1) : shade(base, -0.12));
    }
  }
}

/** A neighbouring building seen from above: parapet, roof surface by kind, rooftop equipment, height shown by tone and shadow. */
export function paintRooftop(ctx: Ctx, roof: Rooftop): void {
  const p = tileRect(roof.rect);
  const seed = roof.rect.x * 7 + roof.rect.y * 13;
  const level = pick(roof.rect.x, roof.rect.y, 5, 3);
  const { kind, base: baseTone } = KINDS[roof.variant % KINDS.length];
  const base = shade(baseTone, level * 0.05 - 0.04);

  const lift = 4 + level * 3;
  rect(ctx, p.x + 5, p.y + p.h, p.w, lift, rgba('#080a12', 0.24));
  rect(ctx, p.x + p.w, p.y + 5, lift, p.h, rgba('#080a12', 0.18));

  rect(ctx, p.x, p.y, p.w, p.h, '#2b2f37');
  rect(ctx, p.x + 1, p.y + 1, p.w - 2, p.h - 2, COPING);
  rect(ctx, p.x + 3, p.y + 3, p.w - 6, p.h - 6, COPING_DARK);
  const inner: Rect = { x: p.x + 4, y: p.y + 4, w: p.w - 8, h: p.h - 8 };
  surface(ctx, inner, base, kind, seed);
  rect(ctx, inner.x, inner.y, inner.w, 3, rgba('#080a12', 0.18));
  rect(ctx, inner.x, inner.y, 3, inner.h, rgba('#080a12', 0.1));
  equipment(ctx, p, seed, kind);
  rect(ctx, p.x, p.y + p.h - 4, p.w, 4, rgba('#080a12', 0.3));
  hline(ctx, p.x + 1, p.y + 1, p.w - 2, '#fbf9f3');
  vline(ctx, p.x + p.w - 2, p.y + 2, p.h - 4, GRAPHITE.mid);
}
