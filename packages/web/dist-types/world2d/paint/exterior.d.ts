import type { ExteriorLayout } from '../../layout/exterior';
import { type Ctx } from './ctx';
/**
 * Paint the static city frame into `ctx` (origin shifted by the layout bounds): neighbouring rooftops, tree-lined
 * sidewalks, streets with crosswalks and parked cars, the entrance plaza and a pocket park. Everything lives in one
 * cached canvas; only the driving cars are drawn per frame.
 */
export declare function paintExterior(ctx: Ctx, layout: ExteriorLayout): void;
