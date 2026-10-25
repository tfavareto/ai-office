import { describe, expect, it } from 'vitest';
import { jumpLift, MAX_LIFE, MIN_LIFE, PALETTE_SIZE, planBurst } from './confettiPlan';

describe('confetti plan', () => {
  it('is deterministic for a seed and different for another', () => {
    expect(planBurst(1, false, 4)).toEqual(planBurst(1, false, 4));
    expect(planBurst(1, false, 4)).not.toEqual(planBurst(1, false, 5));
  });

  it('shoots from two cannons at the sides, inward and up, plus a fountain straight up', () => {
    const specs = planBurst(1, false, 1);
    const left = specs.filter((s) => s.origin === 'left');
    const right = specs.filter((s) => s.origin === 'right');
    const fountain = specs.filter((s) => s.origin === 'fountain');
    expect(left.length).toBe(right.length);
    expect(left.length).toBeGreaterThan(30);
    expect(fountain.length).toBeGreaterThan(30);
    expect(left.every((s) => s.angle > 0 && s.angle < Math.PI / 2)).toBe(true);
    expect(right.every((s) => s.angle > Math.PI / 2 && s.angle < Math.PI)).toBe(true);
    expect(fountain.every((s) => Math.abs(s.angle - Math.PI / 2) <= 0.28 + 1e-9)).toBe(true);
  });

  it('is much denser than a few specks and scales with the level and the milestone', () => {
    const count = (scale: number, big: boolean): number => planBurst(scale, big, 2).length;
    expect(count(1, false)).toBeGreaterThan(140);
    expect(count(1, true)).toBeGreaterThan(count(1, false));
    expect(count(0.6, false)).toBeLessThan(count(1, false));
    expect(count(1.4, false)).toBeGreaterThan(count(1, false));
  });

  it('mixes pieces, streamers and stars with valid parameters', () => {
    const specs = planBurst(1.4, true, 9);
    const kinds = new Set(specs.map((s) => s.kind));
    expect(kinds).toEqual(new Set(['piece', 'ribbon', 'star']));
    for (const s of specs) {
      expect(s.life).toBeGreaterThanOrEqual(MIN_LIFE);
      expect(s.life).toBeLessThanOrEqual(MAX_LIFE + 0.2);
      expect(s.color).toBeGreaterThanOrEqual(0);
      expect(s.color).toBeLessThan(PALETTE_SIZE);
      expect(s.size).toBeGreaterThanOrEqual(1);
      expect(s.size).toBeLessThanOrEqual(3);
      expect(s.delay).toBeGreaterThanOrEqual(0);
      expect(s.delay).toBeLessThanOrEqual(0.5);
    }
  });

  it('lets the fountain run for a short while, in order', () => {
    const specs = planBurst(1, false, 3);
    for (let i = 1; i < specs.length; i++) expect(specs[i]!.delay).toBeGreaterThanOrEqual(specs[i - 1]!.delay);
    expect(Math.max(...specs.map((s) => s.delay))).toBeGreaterThan(0.3);
  });
});

describe('jump', () => {
  it('goes from the floor up to the given height and back, twice a second', () => {
    expect(jumpLift(0, 6)).toBe(0);
    let max = 0;
    for (let t = 0; t < 1; t += 0.01) max = Math.max(max, jumpLift(t, 6));
    expect(max).toBeGreaterThan(5.8);
    expect(max).toBeLessThanOrEqual(6);
    expect(jumpLift(1 / 2.2, 6)).toBeCloseTo(0, 5);
  });
});
