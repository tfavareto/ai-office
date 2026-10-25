import { HAIR_COLORS } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { lookFor } from '../../world2d/chars/looks';
import { choiceKey, chooseLook, FEMALE_MODELS, MALE_MODELS, OUTFIT_COLORS } from './outfits';

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

describe('chooseLook with the choices of a person', () => {
  it('is the seeded look when nothing is chosen', () => {
    expect(chooseLook('m', 99, {})).toEqual(chooseLook('m', 99));
    expect(chooseLook('f', 99, undefined)).toEqual(chooseLook('f', 99));
  });

  it('turns the hair style into the model that has that hair, by look', () => {
    for (let style = 0 as 0 | 1 | 2 | 3; style < 4; style++) {
      expect(chooseLook('f', 5, { hairStyle: style }).model).toBe(FEMALE_MODELS[style]);
      expect(chooseLook('m', 5, { hairStyle: style }).model).toBe(MALE_MODELS[style]);
    }
  });

  it('gives the hair the color the 2D sprites give the same seed, from the shared palette', () => {
    const palette = HAIR_COLORS.map((swatch) => swatch.hex);
    for (let seed = 0; seed < 40; seed++) {
      for (const look of ['f', 'm'] as const) {
        const { hair } = chooseLook(look, seed);
        expect(hair).toBe(lookFor(seed, look, false).hair);
        expect(palette).toContain(hair);
      }
    }
  });

  it('takes the outfit, skin and hair colors from the palettes', () => {
    const choice = chooseLook('f', 5, { outfit: 'teal', skin: 'deep', hairColor: 'blond' });
    expect(choice).toMatchObject({ outfit: '#1f8a8a', skin: '#6a3d28', hair: '#c9a14e' });
  });

  it('keeps the size and the walking phase of the seed', () => {
    const base = chooseLook('m', 31);
    const chosen = chooseLook('m', 31, { outfit: 'wine', hairStyle: 2, skin: 'tan' });
    expect([chosen.scale, chosen.phase]).toEqual([base.scale, base.phase]);
  });

  it('wears an accessory only when one is chosen, and a cap in the color of the outfit', () => {
    expect(chooseLook('m', 3).accessory).toBeUndefined();
    expect(chooseLook('m', 3, { accessory: 'none' }).accessory).toBeUndefined();
    expect(chooseLook('m', 3, { accessory: 'glasses' }).accessory).toBe('glasses');
    expect(chooseLook('m', 3, { accessory: 'cap', outfit: 'crimson' })).toMatchObject({
      accessory: 'cap',
      capColor: '#b3282d',
    });
  });

  it('keys a portrait on what is drawn, not on who is drawn', () => {
    const plain = choiceKey(chooseLook('m', 8));
    expect(choiceKey(chooseLook('m', 8, { accessory: 'cap' }))).not.toBe(plain);
    expect(choiceKey(chooseLook('m', 8, { skin: 'fair' }))).not.toBe(plain);
    expect(choiceKey(chooseLook('m', 8))).toBe(plain);
  });
});
