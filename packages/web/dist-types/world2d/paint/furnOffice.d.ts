import type { FurnitureItem } from '../../layout/types';
import { type Ctx } from './ctx';
/** Position of the 4 screens of a desk, relative to the desk footprint's top-left (px). */
export declare const DESK_SCREENS: {
    x: number;
    y: number;
    w: number;
    h: number;
}[];
export declare function desk(ctx: Ctx, it: FurnitureItem): void;
export declare function chair(ctx: Ctx, it: FurnitureItem): void;
export declare function shelf(ctx: Ctx, it: FurnitureItem): void;
export declare function copier(ctx: Ctx): void;
export declare function bin(ctx: Ctx): void;
export declare function plant(ctx: Ctx, it: FurnitureItem): void;
export declare function plantTall(ctx: Ctx, it: FurnitureItem): void;
export declare function lamp(ctx: Ctx): void;
export declare function sideTable(ctx: Ctx, it: FurnitureItem): void;
export declare function bench(ctx: Ctx, it: FurnitureItem): void;
export declare function waterCooler(ctx: Ctx): void;
export declare function rugFill(ctx: Ctx, it: FurnitureItem, accent: string, carpet: string): void;
