import { ACCESSORIES, HAIR_COLORS, HAIR_STYLE_COUNT, OUTFITS, SKIN_TONES } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { chooseLook } from '../../world3d/characters/outfits';
import { SPRITE_HAIR_STYLES, lookFor } from './looks';

describe('lookFor with the choices of a person', () => {
  const base = lookFor(4242, 'f', false);

  it('is the seeded look when nothing is chosen, and keeps the cache key apart when something is', () => {
    expect(lookFor(4242, 'f', false, {})).toEqual({ ...base, key: lookFor(4242, 'f', false, {}).key });
    expect(lookFor(4242, 'f', false, { skin: 'deep' }).key).not.toBe(base.key);
  });

  it('applies the skin, hair and outfit colors of the palettes', () => {
    const look = lookFor(4242, 'm', false, { skin: 'deep', hairColor: 'blond', outfit: 'crimson' });
    expect(look.skin).toBe('#6a3d28');
    expect(look.hair).toBe('#c9a14e');
    expect(look.jacket).toBe('#b3282d');
    expect(look.hairShade).not.toBe(look.hair);
  });

  it('keeps what was not chosen as the seed drew it', () => {
    const look = lookFor(4242, 'f', false, { outfit: 'teal' });
    expect(look.skin).toBe(base.skin);
    expect(look.hair).toBe(base.hair);
    expect(look.hairStyle).toBe(base.hairStyle);
    expect(look.shirt).toBe(base.shirt);
  });

  it('turns each hair style into a cut that exists for that look, and the four differ', () => {
    for (const gender of ['f', 'm'] as const) {
      const cuts = Array.from(
        { length: HAIR_STYLE_COUNT },
        (_, i) => lookFor(7, gender, false, { hairStyle: i as 0 | 1 | 2 | 3 }).hairStyle,
      );
      expect(cuts).toEqual([...SPRITE_HAIR_STYLES[gender]]);
      expect(new Set(cuts).size).toBe(HAIR_STYLE_COUNT);
    }
  });

  it('wears one accessory at a time, and none removes the glasses the seed gave', () => {
    const glassesSeed = Array.from({ length: 200 }, (_, i) => i * 7717 + 1).find(
      (seed) => lookFor(seed, 'm', false).glasses,
    ) as number;
    expect(lookFor(glassesSeed, 'm', false, { accessory: 'none' })).toMatchObject({
      glasses: false,
      headphones: false,
      cap: false,
    });
    expect(lookFor(glassesSeed, 'm', false, { accessory: 'headphones' })).toMatchObject({
      glasses: false,
      headphones: true,
      cap: false,
    });
    expect(lookFor(glassesSeed, 'm', false, { accessory: 'cap', outfit: 'azure' })).toMatchObject({
      cap: true,
      capColor: '#2f6fed',
    });
    expect(lookFor(glassesSeed, 'm', false, {}).glasses).toBe(true);
  });
});

describe('the same choice in 2D and 3D', () => {
  it('uses the same palette colors in both worlds', () => {
    for (const tone of SKIN_TONES) {
      expect(lookFor(1, 'f', false, { skin: tone.id }).skin).toBe(tone.hex);
      expect(chooseLook('f', 1, { skin: tone.id }).skin).toBe(tone.hex);
    }
    for (const color of HAIR_COLORS) {
      expect(lookFor(1, 'm', false, { hairColor: color.id }).hair).toBe(color.hex);
      expect(chooseLook('m', 1, { hairColor: color.id }).hair).toBe(color.hex);
    }
    for (const outfit of OUTFITS) {
      expect(lookFor(1, 'm', false, { outfit: outfit.id }).jacket).toBe(outfit.hex);
      expect(chooseLook('m', 1, { outfit: outfit.id }).outfit).toBe(outfit.hex);
    }
  });

  it('puts the same accessory on the person in both worlds', () => {
    for (const accessory of ACCESSORIES) {
      const flat = lookFor(1, 'f', false, { accessory });
      const model = chooseLook('f', 1, { accessory });
      const sprite = flat.glasses ? 'glasses' : flat.headphones ? 'headphones' : flat.cap ? 'cap' : 'none';
      expect(sprite).toBe(accessory);
      expect(model.accessory ?? 'none').toBe(accessory);
    }
  });
});
