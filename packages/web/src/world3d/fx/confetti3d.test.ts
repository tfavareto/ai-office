import { describe, expect, it } from 'vitest';
import { Confetti3D } from './confetti3d';

describe('3D confetti', () => {
  it('flashes a ring on the floor under the person for half a second', () => {
    const confetti = new Confetti3D();
    confetti.burst(0, 0, 0.1, false, 1);
    const rings = (): number =>
      confetti.group.children.filter((c) => (c as { geometry?: { type: string } }).geometry?.type === 'RingGeometry')
        .length;
    expect(rings()).toBe(1);
    for (let t = 0; t < 0.7; t += 1 / 60) confetti.update(1 / 60);
    expect(rings()).toBe(0);
  });

  it('bursts, falls to the floor and disappears within a few seconds', () => {
    const confetti = new Confetti3D();
    confetti.burst(3, 4, 1, false, 11);
    for (let t = 0; t < 0.6; t += 1 / 60) confetti.update(1 / 60);
    expect(confetti.count).toBeGreaterThan(140);
    for (let t = 0; t < 3.5; t += 1 / 60) confetti.update(1 / 60);
    expect(confetti.count).toBe(0);
    expect(confetti.busy).toBe(false);
  });

  it('scales with the animation level and stays inside its pool', () => {
    const count = (scale: number): number => {
      const c = new Confetti3D();
      c.burst(0, 0, scale, false, 1);
      for (let t = 0; t < 0.6; t += 1 / 60) c.update(1 / 60);
      return c.count;
    };
    expect(count(0.6)).toBeLessThan(count(1));
    expect(count(1.4)).toBeGreaterThan(count(1));
    const pool = new Confetti3D();
    for (let i = 0; i < 40; i++) pool.burst(0, 0, 1.4, true, i);
    for (let t = 0; t < 0.6; t += 1 / 60) pool.update(1 / 60);
    expect(pool.count).toBeLessThanOrEqual(1700 + 500 + 260);
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
