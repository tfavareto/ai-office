import type { Rect } from '../../layout/types';
import { type Ctx } from './ctx';
/** Entrance plaza in tiles, in front of the reception's glass doors (west side of the building). */
export declare const PLAZA: Rect;
/** Tile rect to pixel rect. */
export declare function tileRect(r: Rect): Rect;
/** Sparse lighter/darker pixels over a pixel rect: cheap texture for gravel, asphalt, grass. */
export declare function speckle(ctx: Ctx, p: Rect, base: string, seed: number, amount?: number): void;
/** Integer in [0, n) from a coordinate pair and a salt. */
export declare function pick(x: number, y: number, salt: number, n: number): number;
export declare function overlaps(a: Rect, b: Rect): boolean;
