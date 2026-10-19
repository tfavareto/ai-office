import type { WallItem } from '../../layout/types';
import { type Ctx } from './ctx';
export interface WallItemFrame {
    /** Pixel rect of the dynamic screen area inside the item, relative to the item's top-left corner (null when static). */
    screen: {
        x: number;
        y: number;
        w: number;
        h: number;
    } | null;
}
/** y (px from the wall top) where wall items hang. */
export declare const ITEM_Y = 12;
/** Paint a static wall decoration. Returns the dynamic screen rect, if any. */
export declare function paintWallItem(ctx: Ctx, item: WallItem, localX: number, label: string, accent: string): WallItemFrame;
