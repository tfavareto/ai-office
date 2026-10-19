import type { AreaLayout, FurnitureItem, Rect } from '../../layout/types';
/** Furniture item with its sprite placement in world pixels. */
export interface PlacedItem {
    item: FurnitureItem;
    sprite: HTMLCanvasElement;
    /** Top-left of the sprite in world px. */
    x: number;
    y: number;
    /** Bottom edge of the footprint in world px (depth sort key). */
    bottom: number;
}
export interface ScreenRect extends Rect {
    kind: 'board' | 'tv';
    itemId: string;
    big: boolean;
}
export interface AreaCanvas {
    area: AreaLayout;
    key: string;
    /** World px of the canvas top-left. */
    x: number;
    y: number;
    w: number;
    h: number;
    ground: HTMLCanvasElement;
    furn: HTMLCanvasElement;
    /** Extra pixels above the area rect that the furniture canvas covers (corridor overhang). */
    furnMargin: number;
    items: PlacedItem[];
    /** Items that may stand in front of characters. */
    tall: PlacedItem[];
    panes: Rect[];
    screens: ScreenRect[];
}
export declare function areaKey(area: AreaLayout, extra?: string): string;
/** Pre-render an area into a ground canvas (floor, walls, decoration) and a furniture canvas. */
export declare function buildAreaCanvas(area: AreaLayout, key: string, corridorTheme: AreaLayout['theme'], furnMargin?: number): AreaCanvas;
export declare const WALL_PIXELS: number;
/** The corridor (and its two glass façades) as one strip spanning the whole building width. */
export declare function buildCorridorCanvas(corridor: AreaLayout, buildingWidth: number, key: string): AreaCanvas;
/** East end wall of the building (one tile column, full height). */
export declare function buildEndCap(height: number): HTMLCanvasElement;
