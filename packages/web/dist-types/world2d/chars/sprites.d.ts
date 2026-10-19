import type { Dir } from '../../layout/types';
import type { Pose } from '../../sim/types';
import type { Look } from './looks';
export declare const SPRITE_W = 24;
export declare const SPRITE_H = 34;
/** Feet anchor inside the cell. */
export declare const ANCHOR_X = 12;
export declare const ANCHOR_Y = 32;
export declare function poseFrames(pose: Pose): number;
export declare function frameFor(pose: Pose, poseT: number, walkPhase: number): number;
/** Draw one frame of a person into a fresh sprite canvas (24x34, feet anchored at (12, 32)). */
export declare function drawPerson(look: Look, pose: Pose, dir: Dir, frame: number): HTMLCanvasElement;
