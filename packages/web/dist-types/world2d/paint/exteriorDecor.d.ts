import type { ExteriorLayout, Lamp, Tree } from '../../layout/exterior';
import type { Rect } from '../../layout/types';
import { type Ctx } from './ctx';
export declare function paintTree(ctx: Ctx, t: Tree): void;
export declare function paintLamp(ctx: Ctx, l: Lamp): void;
export declare function paintBench(ctx: Ctx, x: number, y: number): void;
export declare function paintPlanter(ctx: Ctx, x: number, y: number): void;
/** Entrance plaza in front of the reception: warm stone paving, brass inlay, door mat, planters and a name plate. */
export declare function paintPlaza(ctx: Ctx, plaza: Rect): void;
/** Cars parked along the curbs of the three streets (the driving traffic runs in the lanes between them). */
export declare function paintParkedCars(ctx: Ctx, layout: ExteriorLayout, crossings: {
    horizontal: readonly Rect[];
    vertical: readonly Rect[];
}, keepClear: readonly Rect[]): void;
/** Trees along the far sidewalks and the sidewalk props that fit between them. Positions are deterministic. */
export declare function extraTrees(layout: ExteriorLayout): Tree[];
/** Benches and planters on the near sidewalks, skipping anything that would land on a tree, lamp or the plaza. */
export declare function paintSidewalkProps(ctx: Ctx, layout: ExteriorLayout, trees: readonly Tree[], keepClear: readonly Rect[]): void;
