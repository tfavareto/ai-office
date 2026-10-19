import type { AreaLayout, BuildingLayout, Door, WallItem } from '../../layout/types';
import { PartCollector } from '../util/parts';
import type { Materials } from './materials';
export interface Gap {
    /** Start and end along the wall, in metres. */
    a: number;
    b: number;
    kind: 'elevator' | 'door' | 'glassDoor';
    door?: Door;
    item?: WallItem;
}
/** Splits [from, to] into solid ranges around sorted gaps. */
export declare function solidRanges(from: number, to: number, gaps: readonly Gap[]): [number, number][];
export declare function northGaps(area: AreaLayout): Gap[];
export declare function westGaps(area: AreaLayout): Gap[];
export declare function ledgeGaps(area: AreaLayout): Gap[];
/** Shell (floor + walls + partitions) of one area, merged by the caller. */
export declare function buildAreaShell(c: PartCollector, area: AreaLayout, building: BuildingLayout, m: Materials): void;
/** Outer faces of the building: east facade and the corridor's west and east ends (glass). */
export declare function buildOuterFacades(c: PartCollector, building: BuildingLayout, m: Materials): void;
