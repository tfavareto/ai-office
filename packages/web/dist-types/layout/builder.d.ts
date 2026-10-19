import type { AreaKind, AreaLayout, AreaTheme, Dir, Door, DoorKind, FurnitureItem, FurnitureKind, Rect, RowSide, Spot, SpotKind, TilePos, WallItem, WallKind, WallSide } from './types';
export interface PutOptions {
    variant?: number;
    facing?: Dir;
    /** Does not block walking (rugs, floor decoration). */
    walk?: boolean;
    tall?: boolean;
    /** Custom blocking rects in floor-local tile coordinates (default: the whole footprint). */
    blocks?: Rect[];
}
export interface SpotOptions {
    seat?: boolean;
    /** Approach tile in floor-local integer coordinates (default: the tile under the spot). */
    approach?: TilePos;
    itemId?: string;
    deskIndex?: number;
    group?: string;
}
export interface AreaSpec {
    id: string;
    kind: AreaKind;
    label: string;
    row: RowSide;
    /** West edge (wall column) of the area. */
    x: number;
    width: number;
    theme: AreaTheme;
    projectId?: string;
    slot?: number;
}
/** Builds an AreaLayout using floor-local coordinates (fx, fy) so area recipes read like floor plans. */
export declare class AreaBuilder {
    readonly area: AreaLayout;
    private counter;
    constructor(spec: AreaSpec);
    get floorWidth(): number;
    ax(fx: number): number;
    ay(fy: number): number;
    put(kind: FurnitureKind, fx: number, fy: number, w: number, h: number, opts?: PutOptions): FurnitureItem;
    wallItem(kind: WallKind, fx: number, w: number, variant?: number, side?: WallSide): WallItem;
    spot(kind: SpotKind, fx: number, fy: number, dir: Dir, opts?: SpotOptions): Spot;
    /**
     * Door to the corridor: through the ledge for the north row, through the wall face for the south row.
     * `fx` is the first floor column of the door.
     */
    door(fx: number, w: number, kind?: DoorKind): Door;
    build(): AreaLayout;
}
