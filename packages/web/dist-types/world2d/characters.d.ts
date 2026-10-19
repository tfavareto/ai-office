import type { Rect } from '../layout/types';
import type { AreaCanvas } from './layers/areaLayer';
import { type Ctx } from './paint/ctx';
import type { FrameState, Renderer } from './renderer';
/** People sorted by depth, each followed by a redraw of the tall furniture standing in front of them. */
export declare function drawCharacters(ctx: Ctx, renderer: Renderer, s: FrameState, ordered: AreaCanvas[], vis: Rect): void;
