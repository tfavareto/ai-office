import { describe, expect, it } from 'vitest';
import { daylight, usesBloom } from './daylight';

describe('daylight', () => {
  it('has no bloom or interior glow in full day', () => {
    const d = daylight(0);
    expect(d.bloomStrength).toBe(0);
    expect(d.glow).toBe(0);
    expect(usesBloom(0)).toBe(false);
  });

  it('glows and blooms at night, subtly', () => {
    const n = daylight(1);
    expect(n.glow).toBe(1);
    expect(n.bloomStrength).toBeGreaterThan(0.2);
    expect(n.bloomStrength).toBeLessThan(0.8);
    expect(usesBloom(1)).toBe(true);
  });

  it('dims the sun and the sky monotonically', () => {
    let previous = daylight(0);
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const d = daylight(t);
      expect(d.sunIntensity).toBeLessThanOrEqual(previous.sunIntensity);
      expect(d.skyTop[2]).toBeLessThanOrEqual(previous.skyTop[2] + 1e-9);
      expect(d.glow).toBeGreaterThanOrEqual(previous.glow);
      previous = d;
    }
  });

  it('clamps out-of-range input', () => {
    expect(daylight(-3)).toEqual(daylight(0));
    expect(daylight(7)).toEqual(daylight(1));
  });
});
