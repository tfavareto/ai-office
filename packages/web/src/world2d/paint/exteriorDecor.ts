import type { ExteriorLayout, Lamp, Tree } from '../../layout/exterior';
import { TILE } from '../../layout/constants';
import type { Rect } from '../../layout/types';
import { mix, noise2, shade } from '../color';
import { BRASS, GRAPHITE, PLANT } from '../palette';
import { CAR_COLORS, carSprite } from '../runtime/cars';
import { type Ctx, disc, ellipse, hline, rect, vline } from './ctx';
import { overlaps, pick, tileRect } from './exteriorUtil';

const TREE_SPACING = 6;
const PROP_SPACING = 9;
const CAR_SLOT = 34;
const CAR_CHANCE = 0.42;
const LAMP_FOOTPRINT = 6;
const TREE_FOOTPRINT = 12;

export function paintTree(ctx: Ctx, t: Tree): void {
  const cx = t.x * TILE + 8;
  const cy = t.y * TILE + 8;
  // tree pit with a brick edge, then trunk, shadow and canopy
  rect(ctx, cx - 7, cy + 2, 14, 11, '#a39d90');
  rect(ctx, cx - 6, cy + 3, 12, 9, '#5a4533');
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

export function paintLamp(ctx: Ctx, l: Lamp): void {
  const x = l.x * TILE + 7;
  const y = l.y * TILE;
  ellipse(ctx, x + 1, y + 13, 3, 1, 'rgba(8,10,18,0.3)');
  rect(ctx, x, y - 10, 2, 22, GRAPHITE.mid);
  vline(ctx, x, y - 10, 22, GRAPHITE.light);
  rect(ctx, x - 3, y - 12, 8, 3, GRAPHITE.dark);
  hline(ctx, x - 3, y - 12, 8, GRAPHITE.mid);
  rect(ctx, x - 2, y - 9, 6, 1, '#f3e4c1');
  rect(ctx, x - 2, y + 8, 6, 2, GRAPHITE.mid);
  rect(ctx, x - 1, y + 10, 4, 3, GRAPHITE.dark);
}

export function paintBench(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x + 1, y + 6, 20, 2, 'rgba(8,10,18,0.22)');
  rect(ctx, x, y, 20, 3, '#8a6a45');
  rect(ctx, x, y - 4, 20, 3, '#7a5a38');
  rect(ctx, x + 1, y + 3, 2, 3, GRAPHITE.mid);
  rect(ctx, x + 17, y + 3, 2, 3, GRAPHITE.mid);
  hline(ctx, x, y, 20, '#b08658');
}

export function paintPlanter(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x + 1, y + 7, 14, 2, 'rgba(8,10,18,0.22)');
  rect(ctx, x, y, 14, 7, '#8c8578');
  hline(ctx, x, y, 14, '#b9b2a4');
  disc(ctx, x + 4, y - 1, 3, PLANT.base);
  disc(ctx, x + 10, y - 2, 3, PLANT.mid);
  disc(ctx, x + 7, y - 4, 3, PLANT.light);
}

/** Entrance plaza in front of the reception: warm stone paving, brass inlay, door mat, planters and a name plate. */
export function paintPlaza(ctx: Ctx, plaza: Rect): void {
  const p = tileRect(plaza);
  rect(ctx, p.x, p.y, p.w, p.h, '#e6dfcf');
  for (let y = p.y; y < p.y + p.h; y += 8) {
    for (let x = p.x; x < p.x + p.w; x += 16) {
      const off = (y / 8) % 2 ? 8 : 0;
      vline(ctx, x + off, y, 8, '#d3c9b4');
    }
    hline(ctx, p.x, y, p.w, '#d3c9b4');
  }
  rect(ctx, p.x, p.y, p.w, 2, '#bfb59f');
  rect(ctx, p.x, p.y + p.h - 2, p.w, 2, '#bfb59f');
  const midY = p.y + p.h / 2;
  rect(ctx, p.x + 6, midY - 34, 26, 68, BRASS.base);
  rect(ctx, p.x + 7, midY - 33, 24, 66, '#8a7b66');
  for (let y = midY - 32; y < midY + 32; y += 3) hline(ctx, p.x + 7, y, 24, '#7a6c58');
  rect(ctx, p.x + 38, midY - 30, 3, 60, BRASS.base);
  rect(ctx, p.x + 38, midY - 30, 1, 60, BRASS.hi);
  paintPlanter(ctx, p.x + 18, p.y + 10);
  paintPlanter(ctx, p.x + 18, p.y + p.h - 18);
  rect(ctx, p.x + 8, p.y + 4, 24, 5, BRASS.dark);
  rect(ctx, p.x + 9, p.y + 5, 22, 3, BRASS.light);
  rect(ctx, p.x + 11, p.y + 6, 18, 1, BRASS.dark);
}

function inStreetGap(v: number, crossings: readonly [number, number][]): boolean {
  return crossings.some(([a, b]) => v > a - 18 && v < b + 18);
}

/** Cars parked along the curbs of the three streets (the driving traffic runs in the lanes between them). */
export function paintParkedCars(ctx: Ctx, layout: ExteriorLayout, crossings: { horizontal: readonly Rect[]; vertical: readonly Rect[] }, keepClear: readonly Rect[]): void {
  const [north, south, west] = layout.streets.map(tileRect);
  const hX = crossings.horizontal.map(tileRect).map((c): [number, number] => [c.x, c.x + c.w]);
  const vY = crossings.vertical.map(tileRect).map((c): [number, number] => [c.y, c.y + c.h]);
  const clear = keepClear.map(tileRect);
  const rows: { street: Rect; curbY: number; forward: boolean }[] = [
    { street: north, curbY: north.y + 3, forward: true },
    { street: north, curbY: north.y + north.h - 15, forward: false },
    { street: south, curbY: south.y + 3, forward: true },
    { street: south, curbY: south.y + south.h - 15, forward: false },
  ];
  rows.forEach((row, r) => {
    for (let x = row.street.x + 20; x < row.street.x + row.street.w - 40; x += CAR_SLOT) {
      if (noise2(x, r, 61) > CAR_CHANCE || inStreetGap(x, hX)) continue;
      const color = CAR_COLORS[pick(x, r, 62, CAR_COLORS.length)];
      const sprite = carSprite(color, true, row.forward);
      if (clear.some((c) => overlaps(c, { x, y: row.curbY, w: sprite.width, h: sprite.height }))) continue;
      ctx.drawImage(sprite, x, row.curbY);
    }
    for (let x = row.street.x + 20; x < row.street.x + row.street.w - 20; x += CAR_SLOT) {
      if (noise2(x, r, 63) > 0.7 || inStreetGap(x, hX)) continue;
      vline(ctx, x - 3, row.curbY - 1, 14, 'rgba(236,236,236,0.55)');
    }
  });
  for (const [side, curbX] of [[true, west.x + 3], [false, west.x + west.w - 15]] as const) {
    for (let y = west.y + 20; y < west.y + west.h - 40; y += CAR_SLOT) {
      if (noise2(y, side ? 1 : 2, 64) > CAR_CHANCE || inStreetGap(y, vY)) continue;
      const sprite = carSprite(CAR_COLORS[pick(y, side ? 3 : 4, 65, CAR_COLORS.length)], false, side);
      if (clear.some((c) => overlaps(c, { x: curbX, y, w: sprite.width, h: sprite.height }))) continue;
      ctx.drawImage(sprite, curbX, y);
    }
  }
}

/** Trees along the far sidewalks and the sidewalk props that fit between them. Positions are deterministic. */
export function extraTrees(layout: ExteriorLayout): Tree[] {
  const trees: Tree[] = [];
  const [, , , , farNorth, farSouth, farWest] = layout.sidewalks;
  for (const walk of [farNorth, farSouth]) {
    for (let x = Math.ceil(walk.x / TREE_SPACING) * TREE_SPACING + 3; x < walk.x + walk.w - 2; x += TREE_SPACING) {
      trees.push({ x, y: walk.y + 1, variant: pick(x, walk.y, 41, 3) });
    }
  }
  for (let y = Math.ceil(farWest.y / TREE_SPACING) * TREE_SPACING + 2; y < farWest.y + farWest.h - 2; y += TREE_SPACING) {
    trees.push({ x: farWest.x + 1, y, variant: pick(y, farWest.x, 42, 3) });
  }
  return trees;
}

/** Benches and planters on the near sidewalks, skipping anything that would land on a tree, lamp or the plaza. */
export function paintSidewalkProps(ctx: Ctx, layout: ExteriorLayout, trees: readonly Tree[], keepClear: readonly Rect[]): void {
  const taken: Rect[] = [
    ...trees.map((t) => ({ x: t.x * TILE + 8 - TREE_FOOTPRINT, y: t.y * TILE - 8, w: TREE_FOOTPRINT * 2, h: 30 })),
    ...layout.lamps.map((l) => ({ x: l.x * TILE + 7 - LAMP_FOOTPRINT, y: l.y * TILE - 12, w: LAMP_FOOTPRINT * 2 + 2, h: 26 })),
    ...keepClear.map(tileRect),
  ];
  const [north, south] = layout.sidewalks;
  const strips = [
    { walk: north, y: (north.y + 1) * TILE + 3 },
    { walk: south, y: (south.y + 1) * TILE + 1 },
  ];
  strips.forEach(({ walk, y }, s) => {
    for (let tile = Math.ceil(walk.x) + 4; tile < walk.x + walk.w - 6; tile += PROP_SPACING) {
      const kind = pick(tile, s, 51, 2);
      const x = tile * TILE;
      const box = { x, y: y - 6, w: 20, h: 16 };
      if (taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      if (kind === 0) paintBench(ctx, x, y);
      else paintPlanter(ctx, x, y + 1);
    }
  });
}
