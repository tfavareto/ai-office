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

/** City margin around the building, in tiles, on each side. */
export interface ExteriorMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Smallest margin that still holds the street frame: the far sidewalk of the streets is 12 tiles from the building,
 * and a few tiles of neighbouring rooftops behind it keep the block reading as a city.
 */
export const MIN_EXTERIOR_MARGIN = 16;

/**
 * Margins of the 3D city, which has its own camera and keeps a wide surround (three rows of blocks north and south,
 * two columns west, a wide park east). The 2D world sizes its city from the zoom rule instead (`world2d/cityMargins`).
 */
export const WIDE_EXTERIOR_MARGINS: ExteriorMargins = { left: 34, right: 34, top: 46, bottom: 46 };
const SIDEWALK = 3;
const STREET = 6;
const BLOCK_H = 10;
const BLOCK_W = 12;
const ALLEY = 2;
const BLOCK_STRIDE = 14;
/** Sidewalk, street and far sidewalk: how far the first block of neighbours stands from the building. */
const FRAME = SIDEWALK + STREET + SIDEWALK;

/** Rows (or columns) of neighbouring blocks that reach `margin` tiles, behind the street frame `FRAME` tiles from the building. */
function blocksFor(margin: number, size: number, stride: number): number {
  return Math.max(1, Math.ceil((margin - FRAME - size) / stride) + 1);
}

/** Adds a rooftop unless it lies wholly outside the world, where nothing could ever show it. */
function addRooftop(list: Rooftop[], bounds: Rect, rect: Rect, variant: number): void {
  const outside =
    rect.x >= bounds.x + bounds.w ||
    rect.x + rect.w <= bounds.x ||
    rect.y >= bounds.y + bounds.h ||
    rect.y + rect.h <= bounds.y;
  if (!outside) list.push({ rect, variant });
}

/**
 * Street frame around the building: sidewalks, a street along the north and south sides and the west entrance,
 * trees, lamp posts and neighbour rooftops. Objects are hashed per 8-tile cell so growing the building only appends.
 */
export function layoutExterior(
  buildingWidth: number,
  margins: ExteriorMargins = WIDE_EXTERIOR_MARGINS,
): ExteriorLayout {
  const w = buildingWidth;
  const h = BUILDING_H;
  const bounds: Rect = {
    x: -margins.left,
    y: -margins.top,
    w: w + margins.left + margins.right,
    h: h + margins.top + margins.bottom,
  };
  const northWalk: Rect = { x: -SIDEWALK, y: -SIDEWALK, w: w + SIDEWALK * 2 + 4, h: SIDEWALK };
  const southWalk: Rect = { x: -SIDEWALK, y: h, w: w + SIDEWALK * 2 + 4, h: SIDEWALK };
  const westWalk: Rect = { x: -SIDEWALK, y: 0, w: SIDEWALK, h };
  const eastWalk: Rect = { x: w, y: 0, w: SIDEWALK + 4, h };
  const northStreet: Rect = { x: bounds.x, y: northWalk.y - STREET, w: bounds.w, h: STREET };
  const southStreet: Rect = { x: bounds.x, y: southWalk.y + SIDEWALK, w: bounds.w, h: STREET };
  const westStreet: Rect = {
    x: -SIDEWALK - STREET,
    y: northStreet.y + STREET,
    w: STREET,
    h: southStreet.y - (northStreet.y + STREET),
  };
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
  const rows = blocksFor(Math.max(margins.top, margins.bottom), BLOCK_H, BLOCK_H + ALLEY);
  const firstCell = -Math.ceil(margins.left / BLOCK_STRIDE) - 1;
  for (let row = 0; row < rows; row++) {
    const lift = row * (BLOCK_H + ALLEY);
    for (let cell = firstCell; cell * BLOCK_STRIDE < w + margins.right; cell++) {
      const hh = hash32(cell + 2000 + row * 500, 91 + row);
      const width = 9 + (hh % 5);
      const x = cell * BLOCK_STRIDE + (hh % 3) + row * 7;
      if (x + width < bounds.x || x > bounds.x + bounds.w) continue;
      addRooftop(rooftops, bounds, { x, y: farNorth.y - BLOCK_H - lift, w: width, h: BLOCK_H }, hh % 4);
      addRooftop(
        rooftops,
        bounds,
        { x: x + (hh % 2), y: farSouth.y + SIDEWALK + lift, w: width, h: BLOCK_H },
        (hh >>> 4) % 4,
      );
    }
  }
  const cols = blocksFor(margins.left, BLOCK_W, BLOCK_W + ALLEY);
  for (let col = 0; col < cols; col++) {
    for (let i = 0; i < 3; i++) {
      const hh = hash32(i + 3000 + col * 500, 13 + col);
      const width = 10 + (hh % 3);
      const right = farWest.x - col * (BLOCK_W + ALLEY);
      addRooftop(rooftops, bounds, { x: right - width, y: farWest.y + i * 12, w: width, h: 10 }, hh % 4);
    }
  }

  const grass: Rect[] = [
    { x: w + SIDEWALK + 4, y: farWest.y, w: bounds.x + bounds.w - (w + SIDEWALK + 4), h: farWest.h },
  ];
  return {
    bounds,
    sidewalks,
    streets: [northStreet, southStreet, westStreet],
    crosswalks,
    lanes,
    trees,
    lamps: lampsFiltered,
    rooftops,
    grass,
  };
}
