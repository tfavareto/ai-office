import type { Rect } from '../layout/types';
import { type Ctx } from './paint/ctx';
import type { AreaCanvas } from './layers/areaLayer';
import type { CarDraw } from './runtime/cars';
import type { FrameState, Renderer } from './renderer';
/**
 * Night pass: multiply-darken the outdoors and rooms (lit rooms stay warm), then add warm light pools, monitor glow,
 * lamp posts and car headlights with additive blending.
 */
export declare function drawLighting(ctx: Ctx, renderer: Renderer, s: FrameState, ordered: AreaCanvas[], vis: Rect, cars: readonly CarDraw[]): void;
