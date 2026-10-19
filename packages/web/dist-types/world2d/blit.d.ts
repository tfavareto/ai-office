import type { Rect } from '../layout/types';
import type { Ctx } from './paint/ctx';
export declare function intersects(x: number, y: number, w: number, h: number, vis: Rect): boolean;
/** Draw the part of a canvas that falls inside the visible world rect. */
export declare function blit(ctx: Ctx, canvas: HTMLCanvasElement, ox: number, oy: number, vis: Rect): void;
