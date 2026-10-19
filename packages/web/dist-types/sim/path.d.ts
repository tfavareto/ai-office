import type { Grid, TilePos } from '../layout/types';
export interface Vec {
    x: number;
    y: number;
}
/**
 * A* over walkable tiles, 8 directions with corner rules (a diagonal step needs both orthogonal neighbours free).
 * The start and goal tiles are always allowed even when blocked (characters leave seats and reach stools).
 * Returns tiles from start to goal inclusive, or null when unreachable.
 */
export declare function findPath(grid: Grid, start: TilePos, goal: TilePos): TilePos[] | null;
/** True when a character of radius CLEARANCE can walk the straight segment without touching a blocked tile. */
export declare function segmentClear(grid: Grid, a: Vec, b: Vec): boolean;
/** String-pulls a tile path into the fewest straight, collision-free waypoints (tile centres). */
export declare function smoothPath(grid: Grid, tiles: readonly TilePos[], from?: Vec): Vec[];
export declare function pathLength(points: readonly Vec[], from: Vec): number;
