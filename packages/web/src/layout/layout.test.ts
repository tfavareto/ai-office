import { describe, expect, it } from 'vitest';
import { allSpots, computeBuilding } from './building';
import { BUILDING_H, CORRIDOR_Y, NORTH_PROJECT_X, ROOM_W, SOUTH_PROJECT_X } from './constants';
import { isWalkable } from './grid';
import { layoutProjectRoom } from './project';
import { rowEnds, slotPosition } from './slots';
import type { BuildingLayout, FurnitureItem, Rect, RoomSpec } from './types';

function rooms(count: number, seedBase = 1000): RoomSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    seed: seedBase + i * 7919,
    name: `proj-${i}`,
    slot: i,
  }));
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function reachable(building: BuildingLayout): Set<number> {
  const { grid } = building;
  const start = building.elevators[0].front[0];
  const seen = new Set<number>([start.y * grid.width + start.x]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = cur.x + dx;
      const y = cur.y + dy;
      const key = y * grid.width + x;
      if (!isWalkable(grid, x, y) || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return seen;
}

describe('slots', () => {
  it('starts in the south row after the Lounge, then alternates to keep rows aligned', () => {
    expect(slotPosition(0)).toMatchObject({ row: 'south', x: SOUTH_PROJECT_X });
    expect(slotPosition(1)).toMatchObject({ row: 'south', x: SOUTH_PROJECT_X + ROOM_W });
    expect(slotPosition(2)).toMatchObject({ row: 'north', x: NORTH_PROJECT_X });
  });

  it('keeps both row ends within one room width of each other', () => {
    for (let n = 2; n <= 24; n++) {
      const ends = rowEnds(n);
      expect(Math.abs(ends.north - ends.south)).toBeLessThanOrEqual(ROOM_W);
    }
  });

  it('never gives two slots the same position', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const s = slotPosition(i);
      keys.add(`${s.row}:${s.x}`);
    }
    expect(keys.size).toBe(40);
  });
});

describe.each([0, 1, 4, 8, 12, 20])('building with %i rooms', (count) => {
  const building = computeBuilding(rooms(count));

  it('places every area inside the building footprint without overlapping others', () => {
    const all = building.areas;
    for (const a of all) {
      expect(a.rect.x + a.rect.w).toBeLessThanOrEqual(building.width);
      expect(a.rect.y + a.rect.h).toBeLessThanOrEqual(BUILDING_H);
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i].rect, all[j].rect)).toBe(false);
    }
    for (const t of building.terraces) for (const a of all) expect(overlaps(t.rect, a.rect)).toBe(false);
  });

  it('keeps furniture inside its floor and never overlaps blocking furniture', () => {
    for (const area of [...building.areas, building.corridor, ...building.terraces]) {
      const solid: FurnitureItem[] = [];
      for (const item of area.furniture) {
        for (const b of item.blocks) {
          expect(b.x).toBeGreaterThanOrEqual(area.floor.x);
          expect(b.y).toBeGreaterThanOrEqual(area.floor.y);
          expect(b.x + b.w).toBeLessThanOrEqual(area.floor.x + area.floor.w);
          expect(b.y + b.h).toBeLessThanOrEqual(area.floor.y + area.floor.h);
        }
        if (item.blocks.length === 0) continue;
        for (const other of solid) {
          for (const a of item.blocks) {
            for (const b of other.blocks) expect(overlaps(a, b), `${item.id} overlaps ${other.id}`).toBe(false);
          }
        }
        solid.push(item);
      }
    }
  });

  it('makes every spot approach tile and door reachable from the elevators', () => {
    const seen = reachable(building);
    const key = (x: number, y: number): number => y * building.grid.width + x;
    for (const spot of allSpots(building)) {
      expect(seen.has(key(spot.approach.x, spot.approach.y)), `${spot.id} approach`).toBe(true);
    }
    for (const area of building.areas) {
      for (const door of area.doors) {
        expect(seen.has(key(door.inside.x, door.inside.y)), `${door.id} inside`).toBe(true);
        expect(seen.has(key(door.outside.x, door.outside.y)), `${door.id} outside`).toBe(true);
      }
    }
  });

  it('keeps spots on tiles that belong to the floor and away from walls', () => {
    for (const spot of allSpots(building)) {
      expect(isWalkable(building.grid, Math.floor(spot.x), Math.floor(spot.y)) || spot.seat, spot.id).toBe(true);
    }
  });

  it('has two elevators with walkable front tiles on the reception wall', () => {
    expect(building.elevators).toHaveLength(2);
    for (const e of building.elevators) for (const f of e.front) expect(isWalkable(building.grid, f.x, f.y)).toBe(true);
  });

  it('keeps the corridor walkable along its whole length', () => {
    for (let x = 1; x < building.width - 1; x++) expect(isWalkable(building.grid, x, CORRIDOR_Y + 2)).toBe(true);
  });
});

describe('project rooms', () => {
  it('has six desk spots with distinct indices and an approach tile on the aisle side', () => {
    const room = layoutProjectRoom({ id: 'x', seed: 42, name: 'x', slot: 0 });
    const desks = room.spots.filter((s) => s.kind === 'desk');
    expect(desks.map((s) => s.deskIndex).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const a = layoutProjectRoom({ id: 'x', seed: 5, name: 'x', slot: 3 });
    const b = layoutProjectRoom({ id: 'x', seed: 5, name: 'x', slot: 3 });
    const c = layoutProjectRoom({ id: 'x', seed: 99991, name: 'x', slot: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.furniture)).not.toBe(JSON.stringify(c.furniture));
    expect(a.theme.accent).not.toBe(c.theme.accent);
  });

  it('stays valid for many seeds (everything reachable, nothing blocking the aisle)', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const building = computeBuilding([{ id: 'r', seed: seed * 104729, name: 'r', slot: seed % 4 }]);
      const seen = reachable(building);
      const room = building.areas.find((a) => a.kind === 'project')!;
      for (const spot of room.spots) {
        expect(seen.has(spot.approach.y * building.grid.width + spot.approach.x), `${seed} ${spot.id}`).toBe(true);
      }
    }
  });
});
