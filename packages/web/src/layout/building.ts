import { AreaBuilder } from './builder';
import { BUILDING_H, CORE_W, WALL_ROWS } from './constants';
import { layoutCorridor } from './corridor';
import { layoutBathrooms, layoutCopa, layoutLounge, layoutMeeting, layoutReception } from './core';
import { createGrid, fillRect } from './grid';
import { layoutProjectRoom } from './project';
import { rowEnds } from './slots';
import type { AreaLayout, AreaTheme, BuildingLayout, Door, Elevator, FurnitureItem, RoomSpec, Spot } from './types';

const TERRACE_THEME: AreaTheme = { floor: 'deck', hue: 30, accent: '#c8a45a', carpet: '#8a6a45', carpetAlt: '#745638', pattern: 0, wood: 0 };

/** Outdoor deck closing the shorter row at the east end of the building. */
function layoutTerrace(row: 'north' | 'south', x: number, width: number): AreaLayout {
  const b = new AreaBuilder({ id: `terrace:${row}`, kind: 'terrace', label: 'Terraço', row, x, width, theme: TERRACE_THEME });
  const fw = b.floorWidth;
  const tableFx = (fw - 2) >> 1;
  b.put('deckTable', tableFx, 3, 2, 2);
  if (tableFx >= 1) b.put('deckChair', tableFx - 1, 3, 1, 1, { facing: 'e' });
  if (tableFx + 2 < fw) b.put('deckChair', tableFx + 2, 3, 1, 1, { facing: 'w' });
  b.put('plantTall', 0, 0, 1, 1, { variant: 0 });
  b.put('plantTall', fw - 1, 0, 1, 1, { variant: 1 });
  b.put('plant', 0, 8, 1, 1, { variant: 2 });
  b.put('plant', fw - 1, 8, 1, 1, { variant: 3 });
  return b.build();
}

function markArea(grid: ReturnType<typeof createGrid>, area: AreaLayout): void {
  if (area.kind === 'terrace') return;
  fillRect(grid, area.floor, 1);
  for (const door of area.doors) fillRect(grid, door.rect, 1);
  for (const item of area.furniture) for (const block of item.blocks) fillRect(grid, block, 0);
}

function elevatorsOf(reception: AreaLayout): Elevator[] {
  return reception.wallItems
    .filter((w) => w.kind === 'elevator')
    .map((w, i) => {
      const y = reception.wall.y + WALL_ROWS - 1;
      return {
        id: `elevator${i}`,
        rect: { x: w.x, y, w: w.w, h: 1 },
        front: Array.from({ length: w.w }, (_, k) => ({ x: w.x + k, y: y + 1 })),
      };
    });
}

/**
 * Assemble the whole building for the given project rooms: core areas, rooms in their slots, the corridor, terraces and
 * the walkable grid. Pure and deterministic: the same input gives the same layout.
 */
export function computeBuilding(rooms: readonly RoomSpec[]): BuildingLayout {
  const slotCount = rooms.reduce((n, r) => Math.max(n, r.slot + 1), 0);
  const ends = rowEnds(slotCount);
  const endX = Math.max(ends.north, ends.south);

  const core: AreaLayout[] = [
    layoutReception(),
    layoutCopa(CORE_W),
    layoutMeeting(CORE_W * 2),
    layoutBathrooms(),
    layoutLounge(CORE_W),
  ];
  const projectAreas = [...rooms].sort((a, b) => a.slot - b.slot).map(layoutProjectRoom);
  const terraces: AreaLayout[] = [];
  if (endX - ends.north > 1) terraces.push(layoutTerrace('north', ends.north, endX - ends.north));
  if (endX - ends.south > 1) terraces.push(layoutTerrace('south', ends.south, endX - ends.south));

  const areas = [...core, ...projectAreas];
  const allDoors: Door[] = areas.flatMap((a) => a.doors);
  const corridor = layoutCorridor(endX, allDoors);

  const width = endX + 1;
  const grid = createGrid(width, BUILDING_H);
  fillRect(grid, corridor.floor, 1);
  for (const item of corridor.furniture) for (const block of item.blocks) fillRect(grid, block, 0);
  for (const area of areas) markArea(grid, area);

  return { width, height: BUILDING_H, endNorth: ends.north, endSouth: ends.south, areas, corridor, terraces, elevators: elevatorsOf(core[0]), grid };
}

export function allSpots(building: BuildingLayout): Spot[] {
  return [...building.areas, building.corridor].flatMap((a) => a.spots);
}

export function allFurniture(building: BuildingLayout): FurnitureItem[] {
  return [...building.areas, building.corridor, ...building.terraces].flatMap((a) => a.furniture);
}

export function areaById(building: BuildingLayout, id: string): AreaLayout | undefined {
  return building.areas.find((a) => a.id === id) ?? (id === 'corridor' ? building.corridor : undefined);
}

