// Drives a MakeHuman skeleton from a PoseVec. Bones have arbitrary rest orientations (Blender roll), so a pose rotation
// R given in model axes is applied as  local = Wp⁻¹ · R · Wp · Lrest  (Wp = the parent's rest world rotation); with the
// parent at rest the bone's world rotation is simply R · Wrest.
import { Euler, Quaternion, Vector3, type Bone, type Object3D } from 'three';
import { BONES, readCurl, readPelvisOffset, readReach, type BoneName, type PoseVec } from './poseVec';

const DEG = Math.PI / 180;
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const;
const SEGMENTS = ['01', '02', '03'] as const;

interface DrivenBone {
  name: BoneName;
  bone: Bone;
  restLocal: Quaternion;
  parentRest: Quaternion;
  parentRestInv: Quaternion;
}

interface FingerBone {
  bone: Bone;
  restLocal: Quaternion;
  side: 0 | 1;
  weight: number;
}

interface Arm {
  upper: DrivenBone;
  lower: DrivenBone;
  hand: Bone;
  /** Rest world rotations of the upper and lower arm bones (model space). */
  upperRestW: Quaternion;
  lowerRestW: Quaternion;
  /** Rest directions upper->lower and lower->hand (model space). */
  upperDir: Vector3;
  lowerDir: Vector3;
  l1: number;
  l2: number;
}

const scratchEuler = new Euler();
const scratchQ = new Quaternion();
const scratchV = new Vector3();
const [v0, v1, v2, v3, v4, v5] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const [qa, qb, qc] = [new Quaternion(), new Quaternion(), new Quaternion()];

export class Rig {
  private readonly driven: DrivenBone[] = [];
  private readonly fingers: FingerBone[] = [];
  private readonly arms: [Arm, Arm];
  private readonly root: Object3D;
  private readonly pelvis: Bone;
  private readonly pelvisRestPos = new Vector3();
  private readonly rootInv = new Quaternion();
  /** Height of the pelvis in the rest pose (metres). */
  readonly pelvisRestY: number;

  constructor(root: Object3D) {
    root.updateMatrixWorld(true);
    for (const name of BONES) {
      const bone = root.getObjectByName(name) as Bone | undefined;
      if (!bone || !bone.parent) throw new Error(`rig: missing bone ${name}`);
      const parentRest = bone.parent.getWorldQuaternion(new Quaternion());
      this.driven.push({ name, bone, restLocal: bone.quaternion.clone(), parentRest, parentRestInv: parentRest.clone().invert() });
    }
    for (const side of ['l', 'r'] as const) {
      for (const finger of FINGERS) {
        SEGMENTS.forEach((seg, i) => {
          const bone = root.getObjectByName(`${finger}_${seg}_${side}`) as Bone | undefined;
          if (!bone) return;
          const base = finger === 'thumb' ? 0.35 : 1;
          this.fingers.push({ bone, restLocal: bone.quaternion.clone(), side: side === 'l' ? 0 : 1, weight: base * (i === 0 ? 0.8 : 1) });
        });
      }
    }
    this.root = root;
    this.arms = [this.makeArm(root, 'l'), this.makeArm(root, 'r')];
    const pelvis = this.driven[0].bone;
    this.pelvis = pelvis;
    this.pelvisRestPos.copy(pelvis.position);
    pelvis.parent!.getWorldQuaternion(this.rootInv).invert();
    this.pelvisRestY = pelvis.getWorldPosition(scratchV).y;
  }

  private makeArm(root: Object3D, side: 'l' | 'r'): Arm {
    const upper = this.driven[BONES.indexOf(`upperarm_${side}` as BoneName)];
    const lower = this.driven[BONES.indexOf(`lowerarm_${side}` as BoneName)];
    const hand = this.driven[BONES.indexOf(`hand_${side}` as BoneName)].bone;
    const p0 = upper.bone.getWorldPosition(new Vector3());
    const p1 = lower.bone.getWorldPosition(new Vector3());
    const p2 = hand.getWorldPosition(new Vector3());
    const upperRestW = upper.parentRest.clone().multiply(upper.restLocal);
    const lowerRestW = lower.parentRest.clone().multiply(lower.restLocal);
    void root;
    return {
      upper, lower, hand, upperRestW, lowerRestW,
      upperDir: p1.clone().sub(p0).normalize(), lowerDir: p2.clone().sub(p1).normalize(),
      l1: p0.distanceTo(p1), l2: p1.distanceTo(p2),
    };
  }

  /** Two-bone reach of an arm towards a model-space target; returns false when no reach is requested. */
  private reach(arm: Arm, side: 0 | 1, pose: PoseVec): boolean {
    const r = readReach(pose, side);
    if (r.w <= 0.001) return false;
    const rootQ = this.root.getWorldQuaternion(qa);
    const rootInv = qb.copy(rootQ).invert();
    const shoulder = arm.upper.bone.getWorldPosition(v0);
    this.root.worldToLocal(shoulder);
    const target = v1.set(r.x, r.y, r.z).sub(shoulder);
    const dist = Math.min(Math.max(target.length(), 0.05), arm.l1 + arm.l2 - 0.01);
    const dir = target.normalize();
    const cosA = (arm.l1 * arm.l1 + dist * dist - arm.l2 * arm.l2) / (2 * arm.l1 * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = v2.set(side === 0 ? 0.35 : -0.35, -1, -0.15);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = v3.copy(dir).multiplyScalar(arm.l1 * cosA).addScaledVector(pole, arm.l1 * sinA).add(shoulder);
    const upperNow = v4.copy(elbow).sub(shoulder).normalize();
    const lowerNow = v5.set(r.x, r.y, r.z).sub(elbow);
    if (lowerNow.lengthSq() < 1e-6) return false;
    lowerNow.normalize();
    const wUpper = scratchQ.setFromUnitVectors(arm.upperDir, upperNow).multiply(arm.upperRestW).clone();
    const wLower = qc.setFromUnitVectors(arm.lowerDir, lowerNow).multiply(arm.lowerRestW).clone();
    const parentW = arm.upper.bone.parent!.getWorldQuaternion(qa);
    parentW.premultiply(rootInv);
    const targetUpper = new Quaternion().copy(parentW).invert().multiply(wUpper);
    arm.upper.bone.quaternion.slerp(targetUpper, Math.min(1, r.w));
    const localLower = new Quaternion().copy(wUpper).invert().multiply(wLower);
    arm.lower.bone.quaternion.slerp(localLower, Math.min(1, r.w));
    return true;
  }

  /** World position of a bone (after the last apply + updateMatrixWorld). */
  bone(name: BoneName): Bone {
    return this.driven[BONES.indexOf(name)].bone;
  }

  apply(pose: PoseVec): void {
    for (let i = 0; i < this.driven.length; i++) {
      const d = this.driven[i];
      scratchEuler.set(pose[i * 3] * DEG, pose[i * 3 + 1] * DEG, pose[i * 3 + 2] * DEG, 'XYZ');
      scratchQ.setFromEuler(scratchEuler);
      d.bone.quaternion.copy(d.parentRestInv).multiply(scratchQ).multiply(d.parentRest).multiply(d.restLocal);
    }
    const [ox, oy, oz] = readPelvisOffset(pose);
    scratchV.set(ox, oy, oz).applyQuaternion(this.rootInv);
    this.pelvis.position.copy(this.pelvisRestPos).add(scratchV);
    this.root.updateMatrixWorld(true);
    this.reach(this.arms[0], 0, pose);
    this.reach(this.arms[1], 1, pose);
    const curl = readCurl(pose);
    for (const f of this.fingers) {
      scratchEuler.set(curl[f.side] * f.weight * 55 * DEG, 0, 0);
      f.bone.quaternion.copy(f.restLocal).multiply(scratchQ.setFromEuler(scratchEuler));
    }
  }
}
