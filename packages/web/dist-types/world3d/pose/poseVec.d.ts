export declare const BONES: readonly ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r"];
export type BoneName = (typeof BONES)[number];
export declare const BONE_INDEX: Readonly<Record<BoneName, number>>;
/** Per hand: weight, x, y, z of an optional reach target (model space, metres). */
export declare const POSE_SIZE: number;
export type PoseVec = Float32Array;
export declare const createPose: () => PoseVec;
/** Additive writer used by the pose solvers (all angles in degrees). */
export declare class PoseWriter {
    readonly v: PoseVec;
    constructor(v: PoseVec);
    rot(bone: BoneName, x?: number, y?: number, z?: number): this;
    /** Mirrored application on both sides: x/y/z are for the left bone, y and z flip for the right one. */
    pair(base: 'clavicle' | 'upperarm' | 'lowerarm' | 'hand' | 'thigh' | 'calf' | 'foot', x?: number, y?: number, z?: number): this;
    /** Pelvis offset in metres (model axes: +x left, +y up, +z forward). */
    offset(x?: number, y?: number, z?: number): this;
    /** Two-bone IK target for a hand (model space, metres). */
    reach(side: 'l' | 'r', x: number, y: number, z: number, weight?: number): this;
    curl(left: number, right?: number): this;
}
export declare function readPelvisOffset(v: PoseVec): [number, number, number];
export declare function readReach(v: PoseVec, side: 0 | 1): {
    w: number;
    x: number;
    y: number;
    z: number;
};
export declare function readCurl(v: PoseVec): [number, number];
/** out = a + (b - a) * k */
export declare function lerpPose(out: PoseVec, a: PoseVec, b: PoseVec, k: number): PoseVec;
/** Frame-rate independent blend factor (rate in 1/s). */
export declare const blendFactor: (rate: number, dt: number) => number;
