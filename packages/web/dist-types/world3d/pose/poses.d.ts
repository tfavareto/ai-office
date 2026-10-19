import type { Pose } from '../../sim/types';
import { type PoseVec } from './poseVec';
export interface PoseContext {
    /** Seconds in the current pose. */
    t: number;
    /** Walk cycle phase in cycles (the sim's walkPhase). */
    walk: number;
    /** Per-agent phase offset so people never move in unison. */
    phase: number;
    /** Rest height of the pelvis in this model (metres). */
    pelvisRest: number;
    seated: boolean;
    /** Height of the seat surface (metres) when seated. */
    seatHeight: number;
    /** Shell wait stage 0-3. */
    shellStage: number;
}
/** Fills `out` with the target pose for a named pose. */
export declare function solvePose(out: PoseVec, pose: Pose, c: PoseContext): PoseVec;
export declare const ALL_POSES: Pose[];
export declare function newTargetPose(): PoseVec;
/** Poses in which the lower body is seated (no walking blend, hips lowered). */
export declare function isSeatedPose(pose: Pose): boolean;
