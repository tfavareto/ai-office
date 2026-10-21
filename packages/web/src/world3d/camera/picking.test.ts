import { describe, expect, it } from 'vitest';
import { pickCapsule, targetInSight, type ScreenCapsule } from './picking';
import { clampPitch, stepWalker, type WalkerState } from './walker';

const cap = (id: string, x: number, depth: number): ScreenCapsule => ({
  id,
  ax: x,
  ay: 100,
  bx: x,
  by: 60,
  radius: 14,
  depth,
});

describe('pickCapsule', () => {
  it('hits within the radius of the feet-to-head segment', () => {
    expect(pickCapsule([cap('a', 50, 10)], 60, 80)).toBe('a');
    expect(pickCapsule([cap('a', 50, 10)], 70, 80)).toBeNull();
    expect(pickCapsule([cap('a', 50, 10)], 50, 45)).toBeNull();
  });

  it('prefers the nearest of overlapping people', () => {
    expect(pickCapsule([cap('far', 50, 30), cap('near', 56, 12)], 53, 80)).toBe('near');
  });
});

describe('targetInSight', () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  const dir = { x: 0, y: 0, z: 1 };
  it('finds the person in front within range', () => {
    expect(
      targetInSight(eye, dir, [
        { id: 'a', x: 0.2, y: 1.4, z: 4 },
        { id: 'b', x: 3, y: 1.4, z: 3 },
      ]),
    ).toBe('a');
  });
  it('ignores people behind, too far or outside the cone', () => {
    expect(
      targetInSight(eye, dir, [
        { id: 'back', x: 0, y: 1.4, z: -3 },
        { id: 'far', x: 0, y: 1.4, z: 30 },
        { id: 'side', x: 5, y: 1.4, z: 2 },
      ]),
    ).toBeNull();
  });
});

describe('stepWalker', () => {
  const start: WalkerState = { x: 3, z: 3, yaw: 0, pitch: 0 };
  const open = (): boolean => false;
  it('walks forward along the yaw direction', () => {
    const next = stepWalker(start, { forward: 1, strafe: 0 }, 1, open, 2, 0.2);
    expect(next.z).toBeCloseTo(5);
    expect(next.x).toBeCloseTo(3);
  });
  it('strafes to the right of the view', () => {
    const next = stepWalker({ ...start, yaw: 0 }, { forward: 0, strafe: 1 }, 1, open, 2, 0.2);
    expect(next.x).toBeCloseTo(5);
  });
  it('does not move faster diagonally', () => {
    const next = stepWalker(start, { forward: 1, strafe: 1 }, 1, open, 2, 0.2);
    expect(Math.hypot(next.x - 3, next.z - 3)).toBeCloseTo(2);
  });
  it('slides along blocked tiles', () => {
    const wallAtZ = (_tx: number, tz: number): boolean => tz >= 7;
    const next = stepWalker(
      { x: 1, z: 4.7, yaw: Math.PI / 4, pitch: 0 },
      { forward: 1, strafe: 0 },
      1,
      wallAtZ,
      2,
      0.2,
    );
    expect(next.z).toBeLessThan(5.05);
    expect(next.x).toBeGreaterThan(1.5);
  });
  it('limits pitch', () => {
    expect(clampPitch(3)).toBeLessThan(1.2);
    expect(clampPitch(-3)).toBeGreaterThan(-1.2);
  });
});
