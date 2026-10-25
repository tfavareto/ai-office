import { describe, expect, it } from 'vitest';
import { warmRedIris } from './irisColor';

const pixel = (r: number, g: number, b: number, a = 255): Uint8ClampedArray => new Uint8ClampedArray([r, g, b, a]);

describe('warmRedIris', () => {
  it('turns the deep red of the iris into a brown: red leading, green over blue, lighter', () => {
    const [r, g, b] = warmRedIris(pixel(150, 40, 20));

    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(g / r).toBeGreaterThan(0.35);
    expect(r).toBeGreaterThan(150 * 0.6);
  });

  it('keeps the pupil, the whites, the blues and the greens of the eye', () => {
    for (const rgb of [
      [0, 0, 0],
      [215, 212, 208],
      [60, 120, 190],
      [70, 140, 90],
    ] as const)
      expect(Array.from(warmRedIris(pixel(rgb[0], rgb[1], rgb[2])))).toEqual([...rgb, 255]);
  });

  it('keeps the alpha and does not change the pixels it was given', () => {
    const source = pixel(150, 40, 20, 77);

    const result = warmRedIris(source);

    expect(result[3]).toBe(77);
    expect(Array.from(source)).toEqual([150, 40, 20, 77]);
  });
});
