import { type Bone, type Object3D } from 'three';
import { type BoneName, type PoseVec } from './poseVec';
export declare class Rig {
    private readonly driven;
    private readonly fingers;
    private readonly arms;
    private readonly root;
    private readonly pelvis;
    private readonly pelvisRestPos;
    private readonly rootInv;
    /** Height of the pelvis in the rest pose (metres). */
    readonly pelvisRestY: number;
    constructor(root: Object3D);
    private makeArm;
    /** Two-bone reach of an arm towards a model-space target; returns false when no reach is requested. */
    private reach;
    /** World position of a bone (after the last apply + updateMatrixWorld). */
    bone(name: BoneName): Bone;
    apply(pose: PoseVec): void;
}
