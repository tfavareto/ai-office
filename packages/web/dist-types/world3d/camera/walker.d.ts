export interface WalkerState {
    x: number;
    z: number;
    /** 0 looks south (+z); positive turns towards east (+x). */
    yaw: number;
    /** Radians, positive looks up. */
    pitch: number;
}
export interface WalkInput {
    /** -1..1 */
    forward: number;
    strafe: number;
}
export declare const WALK_SPEED = 2.3;
export declare const RUN_FACTOR = 1.8;
export declare const BODY_RADIUS = 0.24;
export type BlockedFn = (tileX: number, tileZ: number) => boolean;
export declare function clampPitch(pitch: number): number;
export declare function stepWalker(state: WalkerState, input: WalkInput, dt: number, blocked: BlockedFn, speed?: number, radius?: number): WalkerState;
