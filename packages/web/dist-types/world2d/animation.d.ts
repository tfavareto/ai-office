import type { Rect } from '../layout/types';
import type { AreaCanvas } from './layers/areaLayer';
import type { Ctx } from './paint/ctx';
/**
 * Build-in (progress 0 -> 1) and dismantle (1 -> 0) animation of a room: a blueprint outline, the floor and walls
 * revealed by a scan line, then the furniture dropping in one piece at a time. Uses only cached canvases/sprites.
 */
export declare function drawAreaAnimated(ctx: Ctx, ac: AreaCanvas, progress: number, time: number, vis: Rect): void;
