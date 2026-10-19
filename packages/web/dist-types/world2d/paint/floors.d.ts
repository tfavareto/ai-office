import type { AreaTheme } from '../../layout/types';
import { type Ctx } from './ctx';
/** Paint the floor of one 16x16 tile at pixel (x, y); (tx, ty) are absolute tile coordinates. */
export declare function paintFloorTile(ctx: Ctx, theme: AreaTheme, tx: number, ty: number, x: number, y: number, areaId: string): void;
