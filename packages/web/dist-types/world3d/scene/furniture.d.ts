import { Matrix4, Vector3 } from 'three';
import type { AreaLayout } from '../../layout/types';
import { PartCollector } from '../util/parts';
import type { Materials } from './materials';
import type { Models } from './models';
export interface ScreenQuad {
    desk: number;
    slot: number;
    matrix: Matrix4;
    w: number;
    h: number;
}
export interface GlowPoint {
    position: Vector3;
    warm: boolean;
}
export interface FurnitureOutput {
    screens: ScreenQuad[];
    glows: GlowPoint[];
}
export declare function buildFurniture(c: PartCollector, area: AreaLayout, m: Materials, models: Models): FurnitureOutput;
