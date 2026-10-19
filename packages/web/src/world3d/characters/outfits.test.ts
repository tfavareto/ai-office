import { describe, expect, it } from 'vitest';
import { chooseLook, FEMALE_MODELS, MALE_MODELS, OUTFIT_COLORS } from './outfits';

describe('chooseLook', () => {
  it('is deterministic per seed and look', () => {
    expect(chooseLook('f', 1234)).toEqual(chooseLook('f', 1234));
  });

  it('picks a model of the right gender', () => {
    for (let seed = 0; seed < 60; seed++) {
      expect(FEMALE_MODELS).toContain(chooseLook('f', seed).model);
      expect(MALE_MODELS).toContain(chooseLook('m', seed).model);
    }
  });

  it('spreads outfits and keeps sizes and phases in range', () => {
    const outfits = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const l = chooseLook('m', seed * 7717);
      outfits.add(l.outfit);
      expect(l.scale).toBeGreaterThanOrEqual(0.97);
      expect(l.scale).toBeLessThanOrEqual(1.03);
      expect(l.phase).toBeGreaterThanOrEqual(0);
      expect(l.phase).toBeLessThan(1);
    }
    expect(outfits.size).toBeGreaterThan(OUTFIT_COLORS.length / 2);
  });
});
