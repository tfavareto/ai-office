import { describe, expect, it } from 'vitest';
import { Confetti3D } from './confetti3d';

describe('3D confetti', () => {
  it('bursts, falls to the floor and disappears within a few seconds', () => {
    const confetti = new Confetti3D();
    confetti.burst(3, 4, 1, false, 11);
    expect(confetti.count).toBeGreaterThan(60);
    confetti.update(1 / 60);
    for (let t = 0; t < 3; t += 1 / 60) confetti.update(1 / 60);
    expect(confetti.count).toBe(0);
    expect(confetti.busy).toBe(false);
  });

  it('scales with the animation level and stays inside its pool', () => {
    const count = (scale: number): number => {
      const c = new Confetti3D();
      c.burst(0, 0, scale, false, 1);
      return c.count;
    };
    expect(count(0.6)).toBeLessThan(count(1));
    expect(count(1.4)).toBeGreaterThan(count(1));
    const pool = new Confetti3D();
    for (let i = 0; i < 40; i++) pool.burst(0, 0, 1.4, true, i);
    expect(pool.count).toBeLessThanOrEqual(1500);
  });

  it('showers over a room and stops', () => {
    const confetti = new Confetti3D();
    confetti.shower({ x: 0, y: 0, w: 15, h: 9 }, 1, 3);
    for (let i = 0; i < 60; i++) confetti.update(1 / 60);
    expect(confetti.count).toBeGreaterThan(100);
    for (let i = 0; i < 60 * 9; i++) confetti.update(1 / 60);
    expect(confetti.busy).toBe(false);
  });
});
