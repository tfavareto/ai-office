import { describe, expect, it } from 'vitest';
import { ALL_POSES, solvePose, isSeatedPose, type PoseContext } from './poses';
import {
  BONE_INDEX,
  createPose,
  lerpPose,
  blendFactor,
  POSE_SIZE,
  readCurl,
  readPelvisOffset,
  readReach,
} from './poseVec';

const ctx = (over: Partial<PoseContext> = {}): PoseContext => ({
  t: 1.3,
  walk: 0.3,
  phase: 0.2,
  pelvisRest: 0.95,
  seated: false,
  seatHeight: 0.47,
  shellStage: 0,
  ...over,
});

describe('pose solvers', () => {
  it('produces finite values for every pose, seated or not', () => {
    for (const pose of ALL_POSES) {
      for (const seated of [false, true]) {
        const v = solvePose(createPose(), pose, ctx({ seated }));
        expect(v).toHaveLength(POSE_SIZE);
        expect([...v].every((n) => Number.isFinite(n))).toBe(true);
      }
    }
  });

  it('lowers the pelvis and bends the knees when seated', () => {
    const standing = solvePose(createPose(), 'stand', ctx());
    const sitting = solvePose(createPose(), 'sit', ctx({ seated: true }));
    expect(readPelvisOffset(sitting)[1]).toBeLessThan(readPelvisOffset(standing)[1] - 0.3);
    expect(sitting[BONE_INDEX.thigh_l * 3]).toBeLessThan(-50);
    expect(sitting[BONE_INDEX.calf_l * 3]).toBeGreaterThan(50);
  });

  it('keeps feet on the floor for tall seats by straightening the knees', () => {
    const low = solvePose(createPose(), 'sit', ctx({ seated: true, seatHeight: 0.45 }));
    const stool = solvePose(createPose(), 'sit', ctx({ seated: true, seatHeight: 0.65 }));
    expect(Math.abs(stool[BONE_INDEX.thigh_l * 3])).toBeLessThan(Math.abs(low[BONE_INDEX.thigh_l * 3]));
  });

  it('swings legs against each other and arms against their own-side leg', () => {
    const v = solvePose(createPose(), 'walk', ctx({ walk: 0.25, phase: 0 }));
    expect(v[BONE_INDEX.thigh_l * 3] * v[BONE_INDEX.thigh_r * 3]).toBeLessThan(0);
    expect(v[BONE_INDEX.upperarm_l * 3] * v[BONE_INDEX.thigh_l * 3]).toBeLessThan(0);
  });

  it('is periodic in the walk phase', () => {
    const a = solvePose(createPose(), 'walk', ctx({ walk: 0.37, phase: 0 }));
    const b = solvePose(createPose(), 'walk', ctx({ walk: 1.37, phase: 0 }));
    for (let i = 0; i < POSE_SIZE; i++) expect(a[i]).toBeCloseTo(b[i], 3);
  });

  it('reaches the keyboard while typing and curls the fingers', () => {
    const v = solvePose(createPose(), 'type', ctx({ seated: true }));
    expect(readReach(v, 0).w).toBe(1);
    expect(readReach(v, 1).w).toBe(1);
    expect(readReach(v, 0).y).toBeGreaterThan(0.7);
    expect(readCurl(v)[0]).toBeGreaterThan(0.3);
  });

  it('classifies seated poses', () => {
    expect(isSeatedPose('type')).toBe(true);
    expect(isSeatedPose('walk')).toBe(false);
  });
});

describe('pose blending', () => {
  it('moves from a pose toward the target without overshooting', () => {
    const a = createPose();
    const b = solvePose(createPose(), 'celebrate', ctx());
    const out = createPose();
    lerpPose(out, a, b, 0.5);
    const i = BONE_INDEX.upperarm_l * 3 + 2;
    expect(out[i]).toBeCloseTo(b[i] / 2, 4);
    lerpPose(out, a, b, 1);
    expect(out[i]).toBeCloseTo(b[i], 4);
  });

  it('is frame-rate independent', () => {
    const slow = 1 - Math.pow(1 - blendFactor(8, 1 / 30), 2);
    expect(blendFactor(8, 1 / 15)).toBeCloseTo(slow, 6);
    expect(blendFactor(8, 0)).toBe(0);
  });
});
