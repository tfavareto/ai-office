import type { AreaLayout, Rect } from '../../layout/types';
import { type Ctx } from './ctx';
export declare const WALL_H = 32;
/** Paint the north-wall face (2 tiles tall). Returns the clerestory pane rects in canvas pixels. */
export declare function paintWall(ctx: Ctx, area: AreaLayout): Rect[];
/** Thin top cap + shadow of the west wall column, drawn over the floor rows. */
export declare function paintSideWall(ctx: Ctx, area: AreaLayout): void;
/** The low south ledge (cut-away wall) of a room. */
export declare function paintLedge(ctx: Ctx, area: AreaLayout): void;
/** Door openings: cut through the ledge (north row) or the wall face (south row) and frame them. */
export declare function paintDoors(ctx: Ctx, area: AreaLayout, corridorFloor: AreaLayout['theme']): void;
