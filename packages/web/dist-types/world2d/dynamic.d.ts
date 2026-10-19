import type { Rect } from '../layout/types';
import type { OfficeSim } from '../sim/sim';
import type { Ctx } from './paint/ctx';
/** Elevator doors on the reception wall: two stainless panels that slide apart, with a lit cabin behind. */
export declare function drawElevators(ctx: Ctx, sim: OfficeSim, vis: Rect): void;
