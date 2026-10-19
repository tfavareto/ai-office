import { Mesh, type Group } from 'three';
import type { AreaLayout } from '../../layout/types';
import { type PartCollector } from '../util/parts';
import type { Materials } from './materials';
import { CanvasScreen, DecorAtlas } from './screens';
export interface ElevatorRig {
    left: Mesh;
    right: Mesh;
    /** Distance each leaf slides when fully open. */
    travel: number;
    index: number;
    leftX: number;
    rightX: number;
}
export interface WallScreens {
    board?: CanvasScreen;
    meetingTv?: CanvasScreen;
    loungeTv?: CanvasScreen;
    elevators: ElevatorRig[];
    /** All screens created for this area (disposed with it). */
    all: CanvasScreen[];
    /** Static decor (signs, posters, menu) shares this atlas; null until an item needs it. */
    decor: DecorAtlas | null;
}
export declare function buildWallItems(c: PartCollector, area: AreaLayout, m: Materials, dynamic: Group, out: WallScreens, accent: string, projectName: string): void;
export declare function disposeScreens(screens: WallScreens): void;
