// A pose is a flat vector: Euler angles (degrees, model axes X/Y/Z) for every driven bone, a pelvis offset in metres and
// a finger curl per hand. Pure data, so blending and the solvers are testable without a skeleton.

export const BONES = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r',
] as const;

export type BoneName = (typeof BONES)[number];

export const BONE_INDEX: Readonly<Record<BoneName, number>> = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

const PELVIS_OFFSET = BONES.length * 3;
const CURL_OFFSET = PELVIS_OFFSET + 3;
const REACH_OFFSET = CURL_OFFSET + 2;
/** Per hand: weight, x, y, z of an optional reach target (model space, metres). */
export const POSE_SIZE = REACH_OFFSET + 8;

export type PoseVec = Float32Array;

export const createPose = (): PoseVec => new Float32Array(POSE_SIZE);

/** Additive writer used by the pose solvers (all angles in degrees). */
export class PoseWriter {
  constructor(readonly v: PoseVec) {}

  rot(bone: BoneName, x = 0, y = 0, z = 0): this {
    const i = BONE_INDEX[bone] * 3;
    this.v[i] += x;
    this.v[i + 1] += y;
    this.v[i + 2] += z;
    return this;
  }

  /** Mirrored application on both sides: x/y/z are for the left bone, y and z flip for the right one. */
  pair(base: 'clavicle' | 'upperarm' | 'lowerarm' | 'hand' | 'thigh' | 'calf' | 'foot', x = 0, y = 0, z = 0): this {
    return this.rot(`${base}_l` as BoneName, x, y, z).rot(`${base}_r` as BoneName, x, -y, -z);
  }

  /** Pelvis offset in metres (model axes: +x left, +y up, +z forward). */
  offset(x = 0, y = 0, z = 0): this {
    this.v[PELVIS_OFFSET] += x;
    this.v[PELVIS_OFFSET + 1] += y;
    this.v[PELVIS_OFFSET + 2] += z;
    return this;
  }

  /** Two-bone IK target for a hand (model space, metres). */
  reach(side: 'l' | 'r', x: number, y: number, z: number, weight = 1): this {
    const i = REACH_OFFSET + (side === 'l' ? 0 : 4);
    this.v[i] = weight;
    this.v[i + 1] = x;
    this.v[i + 2] = y;
    this.v[i + 3] = z;
    return this;
  }

  curl(left: number, right = left): this {
    this.v[CURL_OFFSET] += left;
    this.v[CURL_OFFSET + 1] += right;
    return this;
  }
}

export function readPelvisOffset(v: PoseVec): [number, number, number] {
  return [v[PELVIS_OFFSET], v[PELVIS_OFFSET + 1], v[PELVIS_OFFSET + 2]];
}

export function readReach(v: PoseVec, side: 0 | 1): { w: number; x: number; y: number; z: number } {
  const i = REACH_OFFSET + side * 4;
  return { w: v[i], x: v[i + 1], y: v[i + 2], z: v[i + 3] };
}

export function readCurl(v: PoseVec): [number, number] {
  return [v[CURL_OFFSET], v[CURL_OFFSET + 1]];
}

/** out = a + (b - a) * k */
export function lerpPose(out: PoseVec, a: PoseVec, b: PoseVec, k: number): PoseVec {
  for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}

/** Frame-rate independent blend factor (rate in 1/s). */
export const blendFactor = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
