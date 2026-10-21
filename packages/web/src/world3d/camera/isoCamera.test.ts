import { describe, expect, it } from 'vitest';
import {
  approachState,
  boxCorners,
  fitPoints,
  frustumFor,
  groundFromView,
  isoBasis,
  panBy,
  screenToGround,
  worldToScreen,
  zoomAt,
  type IsoState,
  type View,
} from './isoCamera';

const view: View = { width: 1440, height: 900, insets: { top: 56, right: 380, bottom: 0, left: 320 } };
const basis = isoBasis();
const state: IsoState = { target: { x: 20, z: 10 }, zoom: 30 };

describe('iso camera basis', () => {
  it('is orthonormal', () => {
    const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(basis.right, basis.right)).toBeCloseTo(1);
    expect(dot(basis.up, basis.up)).toBeCloseTo(1);
    expect(dot(basis.back, basis.back)).toBeCloseTo(1);
    expect(dot(basis.right, basis.up)).toBeCloseTo(0);
    expect(dot(basis.right, basis.back)).toBeCloseTo(0);
    expect(dot(basis.up, basis.back)).toBeCloseTo(0);
  });

  it('looks from the south-east: north is up on screen and east is right', () => {
    expect(basis.back[2]).toBeGreaterThan(0);
    expect(basis.up[2]).toBeLessThan(0);
    expect(basis.right[0]).toBeGreaterThan(0);
  });
});

describe('ground picking', () => {
  it('maps the target to the centre of the free rectangle', () => {
    const s = worldToScreen(state, basis, view, { x: 20, y: 0, z: 10 });
    expect(s.x).toBeCloseTo(320 + (1440 - 320 - 380) / 2);
    expect(s.y).toBeCloseTo(56 + (900 - 56) / 2);
  });

  it('round-trips ground points', () => {
    const s = worldToScreen(state, basis, view, { x: 33, y: 0, z: 4 });
    const g = screenToGround(state, basis, view, s.x, s.y);
    expect(g.x).toBeCloseTo(33);
    expect(g.z).toBeCloseTo(4);
  });

  it('solves ground displacements from view axes', () => {
    const d = groundFromView(basis, 2, 3);
    const u = d.x * basis.right[0] + d.z * basis.right[2];
    const v = d.x * basis.up[0] + d.z * basis.up[2];
    expect(u).toBeCloseTo(2);
    expect(v).toBeCloseTo(3);
  });
});

describe('pan and zoom', () => {
  it('drags the scene with the pointer', () => {
    const before = worldToScreen(state, basis, view, { x: 25, y: 0, z: 12 });
    const next = panBy(state, basis, 40, -25);
    const after = worldToScreen(next, basis, view, { x: 25, y: 0, z: 12 });
    expect(after.x - before.x).toBeCloseTo(40);
    expect(after.y - before.y).toBeCloseTo(-25);
  });

  it('keeps the point under the cursor fixed when zooming', () => {
    const p = screenToGround(state, basis, view, 900, 300);
    const next = zoomAt(state, basis, view, 1.5, 900, 300);
    expect(next.zoom).toBeCloseTo(45);
    const s = worldToScreen(next, basis, view, { x: p.x, y: 0, z: p.z });
    expect(s.x).toBeCloseTo(900);
    expect(s.y).toBeCloseTo(300);
  });

  it('clamps zoom to the limits', () => {
    expect(zoomAt({ ...state, zoom: 190 }, basis, view, 2, 0, 0).zoom).toBe(190);
    expect(zoomAt({ ...state, zoom: 5 }, basis, view, 0.1, 0, 0).zoom).toBe(5);
  });
});

describe('fit', () => {
  const box = { min: { x: 0, y: -1, z: 0 }, max: { x: 60, y: 3, z: 22 } };
  it('keeps every corner inside the free rectangle', () => {
    const fit = fitPoints(boxCorners(box), basis, view, 20);
    for (const c of boxCorners(box)) {
      const s = worldToScreen(fit, basis, view, c);
      expect(s.x).toBeGreaterThanOrEqual(320 + 19);
      expect(s.x).toBeLessThanOrEqual(1440 - 380 - 19);
      expect(s.y).toBeGreaterThanOrEqual(56 + 19);
      expect(s.y).toBeLessThanOrEqual(900 - 19);
    }
  });

  it('is limited by the tighter axis and zooms out for a bigger building', () => {
    const small = fitPoints(boxCorners(box), basis, view);
    const big = fitPoints(boxCorners({ ...box, max: { x: 120, y: 3, z: 22 } }), basis, view);
    expect(big.zoom).toBeLessThan(small.zoom);
  });
});

describe('frustum and smoothing', () => {
  it('is symmetric when there are no insets', () => {
    const f = frustumFor(state, { width: 1000, height: 600, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(f.left).toBeCloseTo(-f.right);
    expect(f.top).toBeCloseTo(-f.bottom);
  });

  it('shifts the frustum for asymmetric insets', () => {
    const f = frustumFor(state, view);
    expect(f.right + f.left).toBeCloseTo((380 - 320) / state.zoom);
  });

  it('converges to the goal', () => {
    let cur: IsoState = { target: { x: 0, z: 0 }, zoom: 10 };
    const goal: IsoState = { target: { x: 30, z: -10 }, zoom: 60 };
    for (let i = 0; i < 240; i++) cur = approachState(cur, goal, 8, 1 / 60);
    expect(cur.zoom).toBeCloseTo(60, 1);
    expect(cur.target.x).toBeCloseTo(30, 1);
  });
});
