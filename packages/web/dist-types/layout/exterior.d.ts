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
 * Street frame around the building: sidewalks, a street along the north and south sides and the west entrance,
 * trees, lamp posts and neighbour rooftops. Objects are hashed per 8-tile cell so growing the building only appends.
 */
export declare function layoutExterior(buildingWidth: number): ExteriorLayout;
