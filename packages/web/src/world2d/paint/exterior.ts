import type { ExteriorLayout } from '../../layout/exterior';
import { TILE } from '../../layout/constants';
import type { Rect } from '../../layout/types';
import { noise2, shade } from '../color';
import { type Ctx, disc, hline, rect, vline } from './ctx';
import {
  extraTrees,
  paintLamp,
  paintParkedCars,
  paintPlaza,
  paintSidewalkProps,
  paintTree,
} from './exteriorDecor';
import { paintPark } from './exteriorPark';
import { ALLEY_COLOR, paintRooftop } from './exteriorRoofs';
import { PLAZA, speckle, tileRect } from './exteriorUtil';

const ASPHALT = '#3b3f48';
const SIDEWALK = '#cdc8bc';
const SIDEWALK_JOINT = '#b9b3a6';
const CURB = '#a39d90';
const ZEBRA = '#ececec';
const MANHOLE_SPACING = 19;

/** Extra zebra crossing (2D only) across the west street, aligned with the plaza. */
const ENTRANCE_CROSSING: Rect = { x: -9, y: 3, w: 6, h: 3 };

function asphalt(ctx: Ctx, street: Rect, horizontal: boolean): void {
  const p = tileRect(street);
  rect(ctx, p.x, p.y, p.w, p.h, ASPHALT);
  speckle(ctx, p, ASPHALT, 5);
  if (horizontal) {
    const mid = p.y + Math.floor(p.h / 2);
    for (let x = p.x; x < p.x + p.w; x += 24) rect(ctx, x, mid - 1, 14, 2, '#e6c75a');
    hline(ctx, p.x, p.y + 1, p.w, '#d8d8d8');
    hline(ctx, p.x, p.y + p.h - 2, p.w, '#d8d8d8');
    for (let x = p.x + MANHOLE_SPACING * 9; x < p.x + p.w; x += MANHOLE_SPACING * 41) {
      disc(ctx, x, mid + 14, 3, '#2b2e35');
      disc(ctx, x, mid + 14, 2, '#4a4e57');
    }
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
      hline(ctx, x, y, TILE, SIDEWALK_JOINT);
      vline(ctx, x, y, TILE, SIDEWALK_JOINT);
    }
  }
}

/** Zebra crossing with stop lines and yellow tactile paving where the sidewalks meet it. */
function crosswalk(ctx: Ctx, r: Rect, horizontal: boolean): void {
  const p = tileRect(r);
  if (horizontal) {
    for (let y = p.y + 2; y < p.y + p.h - 2; y += 5) rect(ctx, p.x, y, p.w, 3, ZEBRA);
    rect(ctx, p.x - 6, p.y + 3, 2, p.h / 2 - 3, ZEBRA);
    rect(ctx, p.x + p.w + 4, p.y + p.h / 2, 2, p.h / 2 - 3, ZEBRA);
    for (let x = p.x + 2; x < p.x + p.w - 2; x += 4) {
      rect(ctx, x, p.y - 3, 2, 2, '#d9b84a');
      rect(ctx, x, p.y + p.h + 1, 2, 2, '#d9b84a');
    }
  } else {
    for (let x = p.x + 2; x < p.x + p.w - 2; x += 5) rect(ctx, x, p.y, 3, p.h, ZEBRA);
    rect(ctx, p.x + 3, p.y - 6, p.w / 2 - 3, 2, ZEBRA);
    rect(ctx, p.x + p.w / 2, p.y + p.h + 4, p.w / 2 - 3, 2, ZEBRA);
    for (let y = p.y + 2; y < p.y + p.h - 2; y += 4) {
      rect(ctx, p.x - 3, y, 2, 2, '#d9b84a');
      rect(ctx, p.x + p.w + 1, y, 2, 2, '#d9b84a');
    }
  }
}

function curbs(ctx: Ctx, streets: readonly Rect[]): void {
  for (const s of streets) {
    const p = tileRect(s);
    rect(ctx, p.x, p.y - 1, p.w, 1, CURB);
    rect(ctx, p.x, p.y + p.h, p.w, 1, CURB);
  }
}

function alleyGround(ctx: Ctx, bounds: Rect): void {
  const p = tileRect(bounds);
  rect(ctx, p.x, p.y, p.w, p.h, ALLEY_COLOR);
  speckle(ctx, p, ALLEY_COLOR, 12, 0.1);
}

/**
 * Paint the static city frame into `ctx` (origin shifted by the layout bounds): neighbouring rooftops, tree-lined
 * sidewalks, streets with crosswalks and parked cars, the entrance plaza and a pocket park. Everything lives in one
 * cached canvas; only the driving cars are drawn per frame.
 */
export function paintExterior(ctx: Ctx, layout: ExteriorLayout): void {
  alleyGround(ctx, layout.bounds);
  for (const g of layout.grass) paintPark(ctx, g);
  layout.sidewalks.forEach((s) => sidewalk(ctx, s));
  layout.streets.forEach((s, i) => asphalt(ctx, s, i < 2));
  layout.crosswalks.forEach((c, i) => crosswalk(ctx, c, i < 2));
  crosswalk(ctx, ENTRANCE_CROSSING, false);
  curbs(ctx, layout.streets);
  layout.rooftops.forEach((r) => paintRooftop(ctx, r));

  const horizontal = layout.crosswalks.slice(0, 2);
  const vertical = [...layout.crosswalks.slice(2), ENTRANCE_CROSSING];
  paintParkedCars(ctx, layout, { horizontal, vertical }, []);
  paintPlaza(ctx, PLAZA);
  layout.lamps.forEach((l) => paintLamp(ctx, l));
  const trees = [...layout.trees, ...extraTrees(layout)].filter((t) => !intersectsTile(PLAZA, t.x, t.y));
  paintSidewalkProps(ctx, layout, trees, [PLAZA]);
  [...trees].sort((a, b) => a.y - b.y).forEach((t) => paintTree(ctx, t));
}

function intersectsTile(r: Rect, x: number, y: number): boolean {
  return x >= r.x - 1 && x < r.x + r.w + 1 && y >= r.y - 1 && y < r.y + r.h + 1;
}
