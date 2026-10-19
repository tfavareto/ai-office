import type { Grid, Rect, TilePos } from './types';
export declare function createGrid(width: number, height: number): Grid;
export declare function inBounds(grid: Grid, x: number, y: number): boolean;
export declare function isWalkable(grid: Grid, x: number, y: number): boolean;
export declare function fillRect(grid: Grid, rect: Rect, value: 0 | 1): void;
export declare function cloneGrid(grid: Grid): Grid;
/** Walkable tile closest (Manhattan) to `from` within `radius`, or null. */
export declare function nearestWalkable(grid: Grid, from: TilePos, radius?: number): TilePos | null;
