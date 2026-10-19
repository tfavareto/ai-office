// Drives a MakeHuman skeleton from a PoseVec. Bones have arbitrary rest orientations (Blender roll), so a pose rotation
// R given in model axes is applied as  local = Wp⁻¹ · R · Wp · Lrest  (Wp = the parent's rest world rotation); with the
// parent at rest the bone's world rotation is simply R · Wrest.
import { Euler, Quaternion, Vector3, type Bone, type Object3D } from 'three';
import { BONES, readCurl, readPelvisOffset, type BoneName, type PoseVec } from './poseVec';

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

const scratchEuler = new Euler();
const scratchQ = new Quaternion();
const scratchV = new Vector3();

export class Rig {
  private readonly driven: DrivenBone[] = [];
  private readonly fingers: FingerBone[] = [];
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
    const pelvis = this.driven[0].bone;
    this.pelvis = pelvis;
    this.pelvisRestPos.copy(pelvis.position);
    pelvis.parent!.getWorldQuaternion(this.rootInv).invert();
    this.pelvisRestY = pelvis.getWorldPosition(scratchV).y;
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
    const curl = readCurl(pose);
    for (const f of this.fingers) {
      scratchEuler.set(curl[f.side] * f.weight * 55 * DEG, 0, 0);
      f.bone.quaternion.copy(f.restLocal).multiply(scratchQ.setFromEuler(scratchEuler));
    }
  }
}
