// Pure math of the isometric orthographic camera: view basis, ground picking, fit, pan and zoom. No three.js here so it
// is trivially testable. Screen coordinates are CSS pixels with y growing down; the world is x east, z south, y up.

export interface View {
  width: number;
  height: number;
  insets: { top: number; right: number; bottom: number; left: number };
}

export interface Basis {
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  /** Unit vector from the target towards the camera. */
  back: readonly [number, number, number];
}

export const ISO_AZIMUTH = (28 * Math.PI) / 180;
export const ISO_PITCH = (57 * Math.PI) / 180;
export const MIN_ZOOM = 5;
export const MAX_ZOOM = 190;

/** Orthonormal camera basis for an azimuth (0 = looking north from the south) and a pitch above the horizon. */
export function isoBasis(azimuth = ISO_AZIMUTH, pitch = ISO_PITCH): Basis {
  const sa = Math.sin(azimuth);
  const ca = Math.cos(azimuth);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  return {
    right: [ca, 0, -sa],
    up: [-sa * sp, cp, -ca * sp],
    back: [sa * cp, sp, ca * cp],
  };
}

export interface GroundPoint {
  x: number;
  z: number;
}

/** The free rectangle (CSS px) not covered by panels. */
export function freeRect(view: View): { x: number; y: number; w: number; h: number } {
  const { insets } = view;
  return {
    x: insets.left,
    y: insets.top,
    w: Math.max(1, view.width - insets.left - insets.right),
    h: Math.max(1, view.height - insets.top - insets.bottom),
  };
}

/** Ground displacement (y = 0) whose projection on the view axes is (u, v) metres. */
export function groundFromView(basis: Basis, u: number, v: number): GroundPoint {
  const [rx, , rz] = basis.right;
  const [ux, , uz] = basis.up;
  const det = rx * uz - rz * ux;
  return { x: (u * uz - rz * v) / det, z: (rx * v - u * ux) / det };
}

export interface IsoState {
  /** Ground point (y = 0) shown at the centre of the free rectangle. */
  target: GroundPoint;
  /** Pixels per metre. */
  zoom: number;
}

/** Ground point under a screen position. */
export function screenToGround(state: IsoState, basis: Basis, view: View, sx: number, sy: number): GroundPoint {
  const free = freeRect(view);
  const u = (sx - (free.x + free.w / 2)) / state.zoom;
  const v = -(sy - (free.y + free.h / 2)) / state.zoom;
  const d = groundFromView(basis, u, v);
  return { x: state.target.x + d.x, z: state.target.z + d.z };
}

/** Screen position (CSS px) of a world point. */
export function worldToScreen(
  state: IsoState,
  basis: Basis,
  view: View,
  p: { x: number; y: number; z: number },
): { x: number; y: number } {
  const free = freeRect(view);
  const dx = p.x - state.target.x;
  const dy = p.y;
  const dz = p.z - state.target.z;
  const u = dx * basis.right[0] + dy * basis.right[1] + dz * basis.right[2];
  const v = dx * basis.up[0] + dy * basis.up[1] + dz * basis.up[2];
  return { x: free.x + free.w / 2 + u * state.zoom, y: free.y + free.h / 2 - v * state.zoom };
}

/** Moves the target so the scene follows a pointer drag of (dx, dy) pixels. */
export function panBy(state: IsoState, basis: Basis, dx: number, dy: number): IsoState {
  const d = groundFromView(basis, dx / state.zoom, -dy / state.zoom);
  return { ...state, target: { x: state.target.x - d.x, z: state.target.z - d.z } };
}

export const clampZoom = (zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number => Math.min(max, Math.max(min, zoom));

/** Zooms by a factor keeping the ground point under (sx, sy) fixed. */
export function zoomAt(
  state: IsoState,
  basis: Basis,
  view: View,
  factor: number,
  sx: number,
  sy: number,
  min = MIN_ZOOM,
  max = MAX_ZOOM,
): IsoState {
  const zoom = clampZoom(state.zoom * factor, min, max);
  if (zoom === state.zoom) return state;
  const anchor = screenToGround(state, basis, view, sx, sy);
  const next: IsoState = { ...state, zoom };
  const moved = screenToGround(next, basis, view, sx, sy);
  return { zoom, target: { x: state.target.x + anchor.x - moved.x, z: state.target.z + anchor.z - moved.z } };
}

export interface Box3Like {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export function boxCorners(box: Box3Like): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push({ x, y, z });
  return out;
}

/** Zoom and target that fit the points inside the free rectangle (with a margin in pixels). */
export function fitPoints(
  points: readonly { x: number; y: number; z: number }[],
  basis: Basis,
  view: View,
  marginPx = 24,
  min = MIN_ZOOM,
  max = MAX_ZOOM,
): IsoState {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const u = p.x * basis.right[0] + p.y * basis.right[1] + p.z * basis.right[2];
    const v = p.x * basis.up[0] + p.y * basis.up[1] + p.z * basis.up[2];
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const free = freeRect(view);
  const spanU = Math.max(1e-3, maxU - minU);
  const spanV = Math.max(1e-3, maxV - minV);
  const zoom = clampZoom(Math.min((free.w - marginPx * 2) / spanU, (free.h - marginPx * 2) / spanV), min, max);
  // the target must project to the centre of the points' bounds; its own height is 0
  const g = groundFromView(basis, (minU + maxU) / 2, (minV + maxV) / 2);
  return { zoom, target: { x: g.x, z: g.z } };
}

/** Frustum extents (metres, relative to the camera) so that the target lands in the centre of the free rectangle. */
export function frustumFor(state: IsoState, view: View): { left: number; right: number; top: number; bottom: number } {
  const free = freeRect(view);
  const cx = free.x + free.w / 2;
  const cy = free.y + free.h / 2;
  return {
    left: -cx / state.zoom,
    right: (view.width - cx) / state.zoom,
    top: cy / state.zoom,
    bottom: -(view.height - cy) / state.zoom,
  };
}

/** Exponential smoothing factor for a frame (rate in 1/s). */
export const smoothing = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export function approachState(current: IsoState, goal: IsoState, rate: number, dt: number): IsoState {
  const k = smoothing(rate, dt);
  const close =
    Math.abs(goal.zoom - current.zoom) < 0.01 &&
    Math.hypot(goal.target.x - current.target.x, goal.target.z - current.target.z) < 0.01;
  if (close) return goal;
  return {
    zoom: current.zoom * Math.pow(goal.zoom / current.zoom, k),
    target: {
      x: current.target.x + (goal.target.x - current.target.x) * k,
      z: current.target.z + (goal.target.z - current.target.z) * k,
    },
  };
}
