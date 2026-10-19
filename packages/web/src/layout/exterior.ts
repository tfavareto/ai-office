import { BUILDING_H } from './constants';
import { hash32 } from './rng';
import type { Rect } from './types';

export interface Tree {
  x: number;
  y: number;
  variant: number;
}

export interface Lamp {
  x: number;
  y: number;
}

export interface Rooftop {
  rect: Rect;
  variant: number;
}

export interface Lane {
  /** Centre line of the lane in tiles, orientation, direction (+1 east/south, -1 west/north). */
  pos: number;
  axis: 'h' | 'v';
  dir: 1 | -1;
  from: number;
  to: number;
}

export interface ExteriorLayout {
  /** Whole drawable world in tiles (building at 0,0). */
  bounds: Rect;
  sidewalks: Rect[];
  streets: Rect[];
  crosswalks: Rect[];
  lanes: Lane[];
  trees: Tree[];
  lamps: Lamp[];
  rooftops: Rooftop[];
  /** Park/plaza east of the building. */
  grass: Rect[];
}

/**
 * City margin around the building, in tiles. The camera may never show anything outside the drawn world, so the
 * margin has to be large enough that the world still covers a wide or tall window at the zoom of the overview: three
 * rows of neighbouring blocks to the north and south, two columns to the west and a wide park to the east.
 */
export const EXTERIOR_MARGIN_X = 34;
export const EXTERIOR_MARGIN_Y = 46;
const MARGIN_X = EXTERIOR_MARGIN_X;
const MARGIN_Y = EXTERIOR_MARGIN_Y;
const SIDEWALK = 3;
const STREET = 6;
const BLOCK_H = 10;
const BLOCK_ROWS = 3;
const BLOCK_COLS = 2;
const ALLEY = 2;
const BLOCK_STRIDE = 14;

/**
 * Street frame around the building: sidewalks, a street along the north and south sides and the west entrance,
 * trees, lamp posts and neighbour rooftops. Objects are hashed per 8-tile cell so growing the building only appends.
 */
export function layoutExterior(buildingWidth: number): ExteriorLayout {
  const w = buildingWidth;
  const h = BUILDING_H;
  const bounds: Rect = { x: -MARGIN_X, y: -MARGIN_Y, w: w + MARGIN_X * 2, h: h + MARGIN_Y * 2 };
  const northWalk: Rect = { x: -SIDEWALK, y: -SIDEWALK, w: w + SIDEWALK * 2 + 4, h: SIDEWALK };
  const southWalk: Rect = { x: -SIDEWALK, y: h, w: w + SIDEWALK * 2 + 4, h: SIDEWALK };
  const westWalk: Rect = { x: -SIDEWALK, y: 0, w: SIDEWALK, h };
  const eastWalk: Rect = { x: w, y: 0, w: SIDEWALK + 4, h };
  const northStreet: Rect = { x: bounds.x, y: northWalk.y - STREET, w: bounds.w, h: STREET };
  const southStreet: Rect = { x: bounds.x, y: southWalk.y + SIDEWALK, w: bounds.w, h: STREET };
  const westStreet: Rect = { x: -SIDEWALK - STREET, y: northStreet.y + STREET, w: STREET, h: southStreet.y - (northStreet.y + STREET) };
  const sidewalks = [northWalk, southWalk, westWalk, eastWalk];

  // sidewalk on the far side of each street, so the frame reads as a city block
  const farNorth: Rect = { x: bounds.x, y: northStreet.y - SIDEWALK, w: bounds.w, h: SIDEWALK };
  const farSouth: Rect = { x: bounds.x, y: southStreet.y + STREET, w: bounds.w, h: SIDEWALK };
  const farWest: Rect = { x: westStreet.x - SIDEWALK, y: northStreet.y + STREET, w: SIDEWALK, h: westStreet.h };
  sidewalks.push(farNorth, farSouth, farWest);

  const crossX = Math.max(8, Math.round(w * 0.3));
  const crosswalks: Rect[] = [
    { x: crossX, y: northStreet.y, w: 3, h: STREET },
    { x: crossX + Math.round(w * 0.35), y: southStreet.y, w: 3, h: STREET },
    { x: westStreet.x, y: Math.round(h * 0.55), w: STREET, h: 3 },
  ];

  const lanes: Lane[] = [
    { pos: northStreet.y + 1.5, axis: 'h', dir: 1, from: bounds.x, to: bounds.x + bounds.w },
    { pos: northStreet.y + STREET - 1.5, axis: 'h', dir: -1, from: bounds.x, to: bounds.x + bounds.w },
    { pos: southStreet.y + 1.5, axis: 'h', dir: 1, from: bounds.x, to: bounds.x + bounds.w },
    { pos: southStreet.y + STREET - 1.5, axis: 'h', dir: -1, from: bounds.x, to: bounds.x + bounds.w },
    { pos: westStreet.x + 1.5, axis: 'v', dir: 1, from: northStreet.y, to: southStreet.y + STREET },
    { pos: westStreet.x + STREET - 1.5, axis: 'v', dir: -1, from: northStreet.y, to: southStreet.y + STREET },
  ];

  const trees: Tree[] = [];
  const lamps: Lamp[] = [];
  for (let cell = -3; cell * 8 < w + 8; cell++) {
    const hh = hash32(cell + 1000, 77);
    const x = cell * 8 + 2 + (hh % 4);
    if (x > -SIDEWALK && x < w + SIDEWALK + 3) {
      if (hh & 0x10) trees.push({ x, y: -2, variant: hh % 3 });
      if (hh & 0x20) trees.push({ x: x + 3, y: h + 1, variant: (hh >>> 3) % 3 });
    }
    lamps.push({ x: cell * 8 + 6, y: -1 }, { x: cell * 8 + 2, y: h + 1 });
  }
  for (let i = 0; i < 4; i++) trees.push({ x: -2, y: 6 + i * 8, variant: i % 3 });
  const lampsFiltered = lamps.filter((l) => l.x > -SIDEWALK && l.x < w + SIDEWALK + 3);

  const rooftops: Rooftop[] = [];
  for (let row = 0; row < BLOCK_ROWS; row++) {
    const lift = row * (BLOCK_H + ALLEY);
    for (let cell = -4; cell * BLOCK_STRIDE < w + MARGIN_X; cell++) {
      const hh = hash32(cell + 2000 + row * 500, 91 + row);
      const width = 9 + (hh % 5);
      const x = cell * BLOCK_STRIDE + (hh % 3) + row * 7;
      if (x + width < bounds.x || x > bounds.x + bounds.w) continue;
      rooftops.push({ rect: { x, y: farNorth.y - BLOCK_H - lift, w: width, h: BLOCK_H }, variant: hh % 4 });
      rooftops.push({ rect: { x: x + (hh % 2), y: farSouth.y + SIDEWALK + lift, w: width, h: BLOCK_H }, variant: (hh >>> 4) % 4 });
    }
  }
  for (let col = 0; col < BLOCK_COLS; col++) {
    for (let i = 0; i < 3; i++) {
      const hh = hash32(i + 3000 + col * 500, 13 + col);
      const width = 10 + (hh % 3);
      const right = farWest.x - col * (12 + ALLEY);
      rooftops.push({ rect: { x: right - width, y: farWest.y + i * 12, w: width, h: 10 }, variant: hh % 4 });
    }
  }

  const grass: Rect[] = [{ x: w + SIDEWALK + 4, y: farWest.y, w: bounds.x + bounds.w - (w + SIDEWALK + 4), h: farWest.h }];
  return { bounds, sidewalks, streets: [northStreet, southStreet, westStreet], crosswalks, lanes, trees, lamps: lampsFiltered, rooftops, grass };
}
