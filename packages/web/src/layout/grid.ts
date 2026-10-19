import type { Grid, Rect, TilePos } from './types';

export function createGrid(width: number, height: number): Grid {
  return { width, height, walkable: new Uint8Array(width * height) };
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function isWalkable(grid: Grid, x: number, y: number): boolean {
  return inBounds(grid, x, y) && grid.walkable[y * grid.width + x] === 1;
}

export function fillRect(grid: Grid, rect: Rect, value: 0 | 1): void {
  const x1 = Math.min(grid.width, rect.x + rect.w);
  const y1 = Math.min(grid.height, rect.y + rect.h);
  for (let y = Math.max(0, rect.y); y < y1; y++) {
    for (let x = Math.max(0, rect.x); x < x1; x++) grid.walkable[y * grid.width + x] = value;
  }
}

export function cloneGrid(grid: Grid): Grid {
  return { width: grid.width, height: grid.height, walkable: grid.walkable.slice() };
}

/** Walkable tile closest (Manhattan) to `from` within `radius`, or null. */
export function nearestWalkable(grid: Grid, from: TilePos, radius = 6): TilePos | null {
  if (isWalkable(grid, from.x, from.y)) return { x: from.x, y: from.y };
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWalkable(grid, from.x + dx, from.y + dy)) return { x: from.x + dx, y: from.y + dy };
      }
    }
  }
  return null;
}
