// Floors, walls and glass partitions of one area. Layout rows: the 2-tile "wall rows" at the top of every area are
// rendered as a thin wall standing on their south edge (the face people see) with the strip behind it left as outside
// floor; the 1-tile ledge at the bottom becomes a low wall + glass partition.
import { LEDGE_ROWS, WALL_ROWS } from '../../layout/constants';
import type { AreaLayout, BuildingLayout, Door, WallItem } from '../../layout/types';
import { groundQuad, PartCollector } from '../util/parts';
import { LEDGE_H, TILE_M as T, WALL_H } from '../units';
import type { Materials } from './materials';

const WALL_T = 0.22;
const GLASS_TOP = 2.72;
const MULLION = 0.05;
const FLOOR_Y = 0;

export interface Gap {
  /** Start and end along the wall, in metres. */
  a: number;
  b: number;
  kind: 'elevator' | 'door' | 'glassDoor';
  door?: Door;
  item?: WallItem;
}

/** Splits [from, to] into solid ranges around sorted gaps. */
export function solidRanges(from: number, to: number, gaps: readonly Gap[]): [number, number][] {
  const out: [number, number][] = [];
  let cursor = from;
  for (const g of [...gaps].sort((p, q) => p.a - q.a)) {
    if (g.a > cursor) out.push([cursor, Math.min(g.a, to)]);
    cursor = Math.max(cursor, g.b);
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}

export function northGaps(area: AreaLayout): Gap[] {
  const gaps: Gap[] = [];
  for (const item of area.wallItems) {
    if (item.side === 'north' && item.kind === 'elevator')
      gaps.push({ a: item.x * T, b: (item.x + item.w) * T, kind: 'elevator', item });
  }
  if (area.row === 'south')
    for (const d of area.doors) gaps.push({ a: d.rect.x * T, b: (d.rect.x + d.rect.w) * T, kind: 'door', door: d });
  return gaps;
}

export function westGaps(area: AreaLayout): Gap[] {
  return area.wallItems
    .filter((w) => w.side === 'west' && w.kind === 'glassDoor')
    .map((item) => ({ a: item.x * T, b: (item.x + item.w) * T, kind: 'glassDoor' as const, item }));
}

export function ledgeGaps(area: AreaLayout): Gap[] {
  return area.row === 'north'
    ? area.doors.map((d) => ({ a: d.rect.x * T, b: (d.rect.x + d.rect.w) * T, kind: 'door' as const, door: d }))
    : [];
}

/** Door frame: two posts and a header, no leaf. */
function doorFrame(
  c: PartCollector,
  m: Materials,
  a: number,
  b: number,
  z: number,
  alongX: boolean,
  height = 2.25,
): void {
  const mid = (a + b) / 2;
  const w = b - a;
  if (alongX) {
    c.boxOn(m.steel, a, 0, z, 0.06, height, 0.12);
    c.boxOn(m.steel, b, 0, z, 0.06, height, 0.12);
    c.boxOn(m.steel, mid, height, z, w + 0.06, 0.06, 0.12);
  } else {
    c.boxOn(m.steel, z, 0, a, 0.12, height, 0.06);
    c.boxOn(m.steel, z, 0, b, 0.12, height, 0.06);
    c.boxOn(m.steel, z, height, mid, 0.12, 0.06, w + 0.06);
  }
}

function floorFor(area: AreaLayout, m: Materials) {
  return m.floor(area.theme.floor, area.theme.carpet);
}

/** Floor of an area plus the outside strip behind its wall. */
function buildFloors(c: PartCollector, area: AreaLayout, m: Materials): void {
  const r = area.rect;
  const x0 = r.x * T;
  const x1 = (r.x + r.w) * T;
  if (area.kind === 'terrace') {
    c.add(groundQuad(x0, r.y * T, x1, (r.y + r.h) * T, FLOOR_Y, 1), m.floor('deck'));
    return;
  }
  if (area.kind === 'corridor') {
    c.add(groundQuad(x0, r.y * T, x1, (r.y + r.h) * T, FLOOR_Y, 1), m.floor('stone'));
    return;
  }
  c.add(groundQuad(x0, (r.y + WALL_ROWS) * T, x1, (r.y + r.h) * T, FLOOR_Y, 1), floorFor(area, m));
  c.add(groundQuad(x0, r.y * T, x1, (r.y + WALL_ROWS) * T, FLOOR_Y, 1), m.floor('stone'));
}

interface WallLook {
  main: 'plaster' | 'marble' | 'tile' | 'warm';
  slats: boolean;
}

function lookOf(area: AreaLayout): WallLook {
  switch (area.kind) {
    case 'reception':
      return { main: 'marble', slats: false };
    case 'copa':
    case 'bathrooms':
      return { main: 'tile', slats: false };
    case 'lounge':
      return { main: 'warm', slats: true };
    case 'meeting':
      return { main: 'plaster', slats: true };
    default:
      return { main: 'plaster', slats: true };
  }
}

function wallMaterial(m: Materials, look: WallLook) {
  return look.main === 'marble'
    ? m.marbleWall
    : look.main === 'tile'
      ? m.tileWhite
      : look.main === 'warm'
        ? m.plasterWarm
        : m.plaster;
}

/** The back wall (north) of an area, with openings for elevators / doors. */
function buildNorthWall(c: PartCollector, area: AreaLayout, m: Materials): void {
  const r = area.rect;
  const zFace = (r.y + WALL_ROWS) * T;
  const look = lookOf(area);
  const mat = wallMaterial(m, look);
  const gaps = northGaps(area);
  for (const [a, b] of solidRanges(r.x * T, (r.x + r.w) * T, gaps)) {
    const w = b - a;
    c.boxOn(mat, (a + b) / 2, 0, zFace - WALL_T / 2, w, WALL_H, WALL_T, 0, 2);
    c.boxOn(m.graphite, (a + b) / 2, 0, zFace + 0.012, w, 0.11, 0.025);
    c.boxOn(m.steel, (a + b) / 2, WALL_H, zFace - WALL_T / 2, w, 0.03, WALL_T + 0.02);
  }
  for (const g of gaps) {
    const w = g.b - g.a;
    const mid = (g.a + g.b) / 2;
    if (g.kind === 'door') {
      c.boxOn(mat, mid, 2.25, zFace - WALL_T / 2, w, WALL_H - 2.25, WALL_T);
      doorFrame(c, m, g.a, g.b, zFace - WALL_T / 2, true);
    } else {
      c.boxOn(mat, mid, 2.45, zFace - WALL_T / 2, w, WALL_H - 2.45, WALL_T);
      c.boxOn(m.steel, g.a, 0, zFace + 0.02, 0.08, 2.45, 0.1);
      c.boxOn(m.steel, g.b, 0, zFace + 0.02, 0.08, 2.45, 0.1);
      c.boxOn(m.steel, mid, 2.45, zFace + 0.02, w + 0.08, 0.08, 0.1);
    }
  }
}

/** Walnut slat accent panel + LED strip on the north wall of rooms that have one. */
function buildAccent(c: PartCollector, area: AreaLayout, m: Materials): void {
  const look = lookOf(area);
  if (!look.slats) return;
  const r = area.rect;
  const zFace = (r.y + WALL_ROWS) * T;
  const gaps = northGaps(area);
  const x0 = (r.x + 1) * T;
  const x1 = (r.x + r.w) * T;
  const inset = area.kind === 'project' ? 0.6 : 1.5;
  const a = x0 + inset;
  const b = x1 - inset;
  for (const [s, e] of solidRanges(a, b, gaps)) {
    if (e - s < 0.5) continue;
    c.boxOn(m.slats, (s + e) / 2, 0.2, zFace + 0.02, e - s, WALL_H - 0.4, 0.04, 0, 0.72);
    c.boxOn(m.brass, (s + e) / 2, 0.17, zFace + 0.045, e - s, 0.03, 0.03);
    c.boxOn(m.brass, (s + e) / 2, WALL_H - 0.2, zFace + 0.045, e - s, 0.03, 0.03);
    c.boxOn(m.led(area.theme.accent), (s + e) / 2, 0.12, zFace + 0.04, e - s, 0.02, 0.012);
  }
}

/** Glass partition along x (a wall running east-west) with gaps for doors. */
function glassAlongX(
  c: PartCollector,
  m: Materials,
  z: number,
  x0: number,
  x1: number,
  gaps: readonly Gap[],
  solidBase: number,
  frostLive = false,
): void {
  const runs = solidRanges(x0, x1, gaps);
  for (const [a, b] of runs) {
    const w = b - a;
    const mid = (a + b) / 2;
    c.boxOn(m.plaster, mid, 0, z, w, solidBase, 0.12);
    c.boxOn(m.steel, mid, solidBase, z, w, 0.04, 0.14);
    c.box(m.glass, mid, solidBase + (GLASS_TOP - solidBase) / 2, z, w, GLASS_TOP - solidBase, 0.02);
    c.boxOn(m.frost, mid, 1.15, z, w, 0.3, 0.026);
    if (frostLive) c.boxOn(m.frostLive, mid, solidBase, z, w, GLASS_TOP - solidBase, 0.03);
    c.boxOn(m.steel, mid, GLASS_TOP, z, w, 0.05, 0.12);
    const posts = Math.max(1, Math.round(w / 1.5));
    for (let i = 0; i <= posts; i++)
      c.boxOn(m.steel, a + (w * i) / posts, solidBase, z, MULLION, GLASS_TOP - solidBase, 0.09);
  }
  for (const g of gaps) {
    c.boxOn(m.glass, (g.a + g.b) / 2, 2.25, z, g.b - g.a, GLASS_TOP - 2.25, 0.02);
    c.boxOn(m.steel, (g.a + g.b) / 2, GLASS_TOP, z, g.b - g.a, 0.05, 0.12);
    doorFrame(c, m, g.a, g.b, z, true);
  }
}

/** Glass partition along z (a north-south wall) with gaps. */
function glassAlongZ(
  c: PartCollector,
  m: Materials,
  x: number,
  z0: number,
  z1: number,
  gaps: readonly Gap[],
  solidBase: number,
  frost = true,
): void {
  for (const [a, b] of solidRanges(z0, z1, gaps)) {
    const w = b - a;
    const mid = (a + b) / 2;
    c.boxOn(m.plaster, x, 0, mid, 0.12, solidBase, w);
    c.boxOn(m.steel, x, solidBase, mid, 0.14, 0.04, w);
    c.box(m.glass, x, solidBase + (GLASS_TOP - solidBase) / 2, mid, 0.02, GLASS_TOP - solidBase, w);
    if (frost) c.boxOn(m.frost, x, 1.15, mid, 0.026, 0.3, w);
    c.boxOn(m.steel, x, GLASS_TOP, mid, 0.12, 0.05, w);
    const posts = Math.max(1, Math.round(w / 1.5));
    for (let i = 0; i <= posts; i++)
      c.boxOn(m.steel, x, solidBase, a + (w * i) / posts, 0.09, GLASS_TOP - solidBase, MULLION);
  }
  for (const g of gaps) {
    c.boxOn(m.glass, x, 2.25, (g.a + g.b) / 2, 0.02, GLASS_TOP - 2.25, g.b - g.a);
    c.boxOn(m.steel, x, GLASS_TOP, (g.a + g.b) / 2, 0.12, 0.05, g.b - g.a);
    doorFrame(c, m, g.a, g.b, x, false);
  }
}

/** Shell (floor + walls + partitions) of one area, merged by the caller. */
export function buildAreaShell(c: PartCollector, area: AreaLayout, building: BuildingLayout, m: Materials): void {
  buildFloors(c, area, m);
  if (area.kind === 'terrace') return buildTerraceEdges(c, area, building, m);
  if (area.kind === 'corridor') return;
  const r = area.rect;
  const x0 = r.x * T;
  const x1 = (r.x + r.w) * T;
  const zFace = (r.y + WALL_ROWS) * T;
  const zEnd = (r.y + r.h) * T;
  buildNorthWall(c, area, m);
  buildAccent(c, area, m);
  // west wall: building facade for the first column, glass partition between rooms
  glassAlongZ(c, m, x0 + 0.375, zFace, zEnd, westGaps(area), 0.0, area.kind !== 'reception');
  // ledge row: corridor partition for the north row, low balustrade on the south edge
  const ledgeZ = (r.y + r.h - LEDGE_ROWS / 2) * T;
  if (area.row === 'north') {
    glassAlongX(c, m, ledgeZ, x0, x1, ledgeGaps(area), LEDGE_H, area.kind === 'meeting');
  } else {
    glassAlongX(c, m, ledgeZ + 0.3, x0, x1, [], LEDGE_H);
  }
  void building;
}

function buildTerraceEdges(c: PartCollector, area: AreaLayout, building: BuildingLayout, m: Materials): void {
  const r = area.rect;
  const x0 = r.x * T;
  const x1 = (r.x + r.w) * T;
  const zN = r.y * T;
  const zS = (r.y + r.h) * T;
  const rail = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    if (alongX) {
      c.boxOn(m.glass, mx, 0.2, mz, len, 0.9, 0.02);
      c.boxOn(m.brass, mx, 1.1, mz, len, 0.04, 0.06);
      c.boxOn(m.steel, mx, 0, mz, len, 0.2, 0.08);
    } else {
      c.boxOn(m.glass, mx, 0.2, mz, 0.02, 0.9, len);
      c.boxOn(m.brass, mx, 1.1, mz, 0.06, 0.04, len);
      c.boxOn(m.steel, mx, 0, mz, 0.08, 0.2, len);
    }
  };
  const lastColumn = x1 >= building.width * T - 0.01;
  rail(x0, zN + 0.05, x1, zN + 0.05);
  rail(x0, zS - 0.05, x1, zS - 0.05);
  if (lastColumn) rail(x1 - 0.05, zN, x1 - 0.05, zS);
  glassAlongZ(c, m, x0 + 0.375, zN, zS, [], 0, false);
}

/** Outer faces of the building: east facade and the corridor's west and east ends (glass). */
export function buildOuterFacades(c: PartCollector, building: BuildingLayout, m: Materials): void {
  const corridor = building.corridor;
  const z0 = corridor.rect.y * T;
  const z1 = (corridor.rect.y + corridor.rect.h) * T;
  glassAlongZ(c, m, 0.375, z0, z1, [], 0, false);
  const eastX = (building.width - 1) * T + 0.375;
  glassAlongZ(c, m, eastX, 0, building.height * T, [], 0, false);
  c.add(groundQuad(0, z0, T, z1, FLOOR_Y, 1.6), m.floor('stone'));
  c.add(
    groundQuad((building.width - 1) * T, 0, building.width * T, building.height * T, FLOOR_Y, 1.6),
    m.floor('stone'),
  );
}
