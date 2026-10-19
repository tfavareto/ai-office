// World units: 1 unit = 1 metre. The floor plan is in tiles (see ../layout); one tile is 0.75 m, which makes a 4-tile
// workstation 3 m wide, a 5-tile corridor 3.75 m and a 3-seat sofa 2.25 m. Tile (x, y) maps to world (x, z); y is up.

export const TILE_M = 0.75;
/** Height of full walls and partitions. */
export const WALL_H = 2.9;
/** Height of the low cut-away walls on the camera side. */
export const LEDGE_H = 0.45;
export const SLAB_H = 0.4;
export const DESK_H = 0.74;
export const SEAT_H = 0.47;
export const EYE_H = 1.58;

export const toWorld = (tiles: number): number => tiles * TILE_M;
export const toTiles = (metres: number): number => metres / TILE_M;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
