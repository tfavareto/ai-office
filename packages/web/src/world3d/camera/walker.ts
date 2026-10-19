// First-person walking with sliding collision against the layout's walkable grid.
import { TILE_M } from '../units';

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

export const WALK_SPEED = 2.3;
export const RUN_FACTOR = 1.8;
export const BODY_RADIUS = 0.24;
const MAX_PITCH = (65 * Math.PI) / 180;

export type BlockedFn = (tileX: number, tileZ: number) => boolean;

function collides(x: number, z: number, blocked: BlockedFn, radius: number): boolean {
  for (const [dx, dz] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]] as const) {
    if (blocked(Math.floor((x + dx) / TILE_M), Math.floor((z + dz) / TILE_M))) return true;
  }
  return false;
}

export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
}

export function stepWalker(state: WalkerState, input: WalkInput, dt: number, blocked: BlockedFn, speed = WALK_SPEED, radius = BODY_RADIUS): WalkerState {
  const len = Math.hypot(input.forward, input.strafe);
  if (len === 0) return state;
  const f = input.forward / Math.max(1, len);
  const s = input.strafe / Math.max(1, len);
  const sin = Math.sin(state.yaw);
  const cos = Math.cos(state.yaw);
  // forward is (sin, cos) in (x, z); strafe right is (cos, -sin)
  const mx = (sin * f + cos * s) * speed * dt;
  const mz = (cos * f - sin * s) * speed * dt;
  let { x, z } = state;
  if (!collides(x + mx, z, blocked, radius)) x += mx;
  if (!collides(x, z + mz, blocked, radius)) z += mz;
  return { ...state, x, z };
}
