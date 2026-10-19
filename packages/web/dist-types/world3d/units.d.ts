export declare const TILE_M = 0.75;
/** Height of full walls and partitions. */
export declare const WALL_H = 2.9;
/** Height of the low cut-away walls on the camera side. */
export declare const LEDGE_H = 0.45;
export declare const SLAB_H = 0.4;
export declare const DESK_H = 0.74;
export declare const SEAT_H = 0.47;
export declare const EYE_H = 1.58;
export declare const toWorld: (tiles: number) => number;
export declare const toTiles: (metres: number) => number;
export interface Vec3Like {
    x: number;
    y: number;
    z: number;
}
