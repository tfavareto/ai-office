// Procedural poses for the MakeHuman rig. Angles are degrees about model axes (+x = the person's left, +y up, +z the
// way the person faces). Rotating a hanging limb about x by a negative angle swings it forward; about z by a positive
// angle moves a left limb outward. The skeleton applies them relative to each bone's rest orientation (see rig.ts).
import type { Pose } from '../../sim/types';
import { createPose, PoseWriter, type PoseVec } from './poseVec';

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
  /** Shell wait stage 0-3. */
  shellStage: number;
}

const TAU = Math.PI * 2;
const s = (t: number, hz: number, phase = 0): number => Math.sin(t * hz * TAU + phase);
const SEAT_PELVIS = 0.52;
const STAND_ARM_Z = 30;

function sitBase(w: PoseWriter, c: PoseContext): void {
  w.offset(0, SEAT_PELVIS - c.pelvisRest, -0.1);
  w.pair('thigh', -88, 4, 0).pair('calf', 88).pair('foot', 2);
}

function breathe(w: PoseWriter, c: PoseContext): void {
  const b = s(c.t, 0.22, c.phase);
  w.rot('spine_02', b * 0.9).rot('spine_03', b * 0.7).rot('head', -b * 0.5);
}

function armsRelaxed(w: PoseWriter, forward = 0): void {
  w.pair('upperarm', -forward, 0, -STAND_ARM_Z).pair('lowerarm', -10);
}

const solvers: Record<Pose, (w: PoseWriter, c: PoseContext) => void> = {
  stand(w, c) {
    armsRelaxed(w);
    breathe(w, c);
    w.rot('head', 0, s(c.t, 0.07, c.phase) * 8);
    w.curl(0.35);
  },

  walk(w, c) {
    const p = (c.walk + c.phase * 0.1) * TAU;
    const sw = Math.sin(p);
    const cs = Math.cos(p);
    const stride = 30;
    w.rot('thigh_l', -sw * stride).rot('thigh_r', sw * stride);
    w.rot('calf_l', Math.max(0, cs) * 36 + 4 + Math.max(0, -sw) * 0).rot('calf_r', Math.max(0, -cs) * 36 + 4);
    w.rot('foot_l', sw * 10).rot('foot_r', -sw * 10);
    w.rot('upperarm_l', sw * 24, 0, -STAND_ARM_Z).rot('upperarm_r', -sw * 24, 0, STAND_ARM_Z);
    w.pair('lowerarm', -22);
    w.rot('spine_02', 0, -sw * 6).rot('spine_03', 3, -sw * 4).rot('pelvis', 0, sw * 6);
    w.rot('head', 0, sw * 3);
    w.offset(Math.sin(p) * 0.012, -Math.abs(Math.cos(p)) * 0.035 + 0.01, 0);
    w.curl(0.4);
  },

  sit(w, c) {
    sitBase(w, c);
    armsRelaxed(w, 12);
    w.pair('lowerarm', -40);
    breathe(w, c);
    w.curl(0.5);
  },

  type(w, c) {
    sitBase(w, c);
    const k = s(c.t, 3.2, c.phase);
    const k2 = s(c.t, 2.3, c.phase + 1.7);
    w.rot('spine_01', 3).rot('spine_02', 4).rot('spine_03', 3);
    w.reach('l', 0.13 + k * 0.01, 0.79 + k * 0.006, 0.36).reach('r', -0.13 - k2 * 0.01, 0.79 + k2 * 0.006, 0.36);
    w.rot('hand_l', 10, 0, 0).rot('hand_r', 10, 0, 0);
    w.rot('head', 8 + s(c.t, 0.18, c.phase) * 2, s(c.t, 0.11, c.phase) * 9);
    w.curl(0.55 + k * 0.1, 0.55 + k2 * 0.1);
  },

  hand(w, c) {
    armsRelaxed(w);
    breathe(w, c);
    const wave = s(c.t, 1.5, c.phase);
    w.rot('upperarm_l', -20, 0, 150 - STAND_ARM_Z * 0).rot('lowerarm_l', -35 + wave * 14, 0, 0);
    w.rot('hand_l', 0, 0, wave * 22);
    w.rot('head', 0, -10, 0);
    w.curl(0.05, 0.4);
  },

  coffee(w, c) {
    armsRelaxed(w);
    breathe(w, c);
    const sip = Math.max(0, s(c.t, 0.18, c.phase)) ;
    w.rot('upperarm_r', -30 - sip * 25, 0, STAND_ARM_Z * 0 + 18).rot('lowerarm_r', -85 - sip * 35, 0, 0);
    w.rot('head', -sip * 8, 0, 0);
    w.curl(0.4, 0.7);
  },

  celebrate(w, c) {
    const b = Math.abs(s(c.t, 1.8, c.phase));
    w.offset(0, b * 0.07, 0);
    w.pair('upperarm', -20, 0, 160).pair('lowerarm', -18);
    w.pair('thigh', 0, 0, 0);
    w.rot('head', -10);
    w.rot('spine_03', -4);
    w.curl(0.2);
  },

  sleep(w, c) {
    sitBase(w, c);
    const b = s(c.t, 0.2, c.phase);
    w.rot('spine_01', 14).rot('spine_02', 16).rot('spine_03', 12).rot('head', 20 + b * 1.5);
    w.pair('upperarm', -55, 0, -14).pair('lowerarm', -80);
    w.curl(0.2);
  },

  lean(w, c) {
    sitBase(w, c);
    breathe(w, c);
    w.rot('spine_01', -8).rot('spine_02', -8).rot('head', 6);
    w.pair('upperarm', 10, 55, -40).pair('lowerarm', -95);
    w.curl(0.3);
  },

  stretch(w, c) {
    sitBase(w, c);
    const b = s(c.t, 0.25, c.phase);
    w.rot('spine_02', -8 - b * 3).rot('spine_03', -6).rot('head', 8);
    w.pair('upperarm', -10, 0, 165).pair('lowerarm', -10);
    w.curl(0.1);
  },

  popcorn(w, c) {
    sitBase(w, c);
    const eat = Math.max(0, s(c.t, 0.45, c.phase));
    w.rot('spine_02', 8).rot('head', -6);
    w.pair('upperarm', -45, 0, -14).pair('lowerarm', -80);
    w.rot('upperarm_r', -eat * 22).rot('lowerarm_r', -eat * 40);
    w.curl(0.5);
  },

  talk(w, c) {
    armsRelaxed(w);
    breathe(w, c);
    const g1 = s(c.t, 1.1, c.phase);
    const g2 = s(c.t, 0.7, c.phase + 2);
    w.rot('upperarm_r', -38 + g1 * 10, 0, 22).rot('lowerarm_r', -60 + g2 * 18, 0, 0).rot('hand_r', g1 * 14, 0, 0);
    w.rot('upperarm_l', -12 + g2 * 8, 0, 0).rot('lowerarm_l', -18);
    w.rot('head', s(c.t, 0.9, c.phase) * 3, s(c.t, 0.3, c.phase) * 5);
    w.curl(0.3, 0.2);
  },

  listen(w, c) {
    armsRelaxed(w, 4);
    breathe(w, c);
    w.rot('head', 3 + Math.max(0, s(c.t, 0.55, c.phase)) * 8, s(c.t, 0.2, c.phase) * 3);
    w.pair('lowerarm', -22);
    w.curl(0.4);
  },

  play(w, c) {
    breathe(w, c);
    const sw = s(c.t, 1.3, c.phase);
    w.rot('spine_02', 6, sw * 10).rot('pelvis', 0, 0);
    w.rot('upperarm_r', -45 + sw * 25, sw * 20, 14).rot('lowerarm_r', -60);
    w.rot('upperarm_l', -15, 0, -22).rot('lowerarm_l', -20);
    w.pair('thigh', -8).pair('calf', 12);
    w.offset(0, -0.03, 0);
    w.curl(0.6, 0.8);
  },

  arcade(w, c) {
    breathe(w, c);
    const j = s(c.t, 2.2, c.phase);
    w.rot('spine_02', 6).rot('head', 5, 0);
    w.rot('upperarm_l', -50, 0, -10).rot('lowerarm_l', -50).rot('hand_l', j * 8, 0, 0);
    w.rot('upperarm_r', -50, 0, 10).rot('lowerarm_r', -40 + j * 6);
    w.curl(0.7, 0.4);
  },

  read(w, c) {
    breathe(w, c);
    w.rot('spine_03', 4).rot('head', 16, s(c.t, 0.12, c.phase) * 6);
    w.pair('upperarm', -40, 0, -12).pair('lowerarm', -78);
    w.curl(0.55);
  },

  wash(w, c) {
    breathe(w, c);
    const rub = s(c.t, 2.4, c.phase);
    w.rot('spine_02', 8).rot('head', 14);
    w.pair('upperarm', -36, 0, -14).pair('lowerarm', -68 + rub * 5);
    w.rot('hand_l', 0, rub * 10, 0).rot('hand_r', 0, -rub * 10, 0);
    w.curl(0.4);
  },
};

/** Fills `out` with the target pose for a named pose. */
export function solvePose(out: PoseVec, pose: Pose, c: PoseContext): PoseVec {
  out.fill(0);
  solvers[pose](new PoseWriter(out), c);
  return out;
}

export const ALL_POSES = Object.keys(solvers) as Pose[];

export function newTargetPose(): PoseVec {
  return createPose();
}

/** Poses in which the lower body is seated (no walking blend, hips lowered). */
export function isSeatedPose(pose: Pose): boolean {
  return pose === 'sit' || pose === 'type' || pose === 'sleep' || pose === 'lean' || pose === 'stretch' || pose === 'popcorn';
}
