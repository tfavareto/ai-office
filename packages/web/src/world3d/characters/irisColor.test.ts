import { describe, expect, it } from 'vitest';
import { BROWN_IRIS, HAZEL_IRIS, toneIris } from './irisColor';

const pixel = (r: number, g: number, b: number, a = 255): Uint8ClampedArray => new Uint8ClampedArray([r, g, b, a]);

/** 8-bit rounding of the channels. */
const ROUNDING = 0.01;

/** Hue (degrees), saturation and value of an RGB color. */
function hsv(rgb: ArrayLike<number>): { h: number; s: number; v: number } {
  const [r, g, b] = [rgb[0], rgb[1], rgb[2]];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max / 255 };
}

describe('toneIris', () => {
  it('turns the saturated red of the brown iris into a dark natural brown', () => {
    const { h, s, v } = hsv(toneIris(pixel(150, 40, 20), BROWN_IRIS));

    expect(h).toBeGreaterThanOrEqual(25);
    expect(h).toBeLessThanOrEqual(35);
    expect(s).toBeLessThanOrEqual(0.45 + ROUNDING);
    expect(v).toBeLessThanOrEqual(0.4 + ROUNDING);
  });

  it('turns the gold of the light brown iris into a hazel that is not brighter than its ceiling', () => {
    const { h, s, v } = hsv(toneIris(pixel(190, 140, 40), HAZEL_IRIS));

    expect(h).toBeGreaterThanOrEqual(28);
    expect(h).toBeLessThanOrEqual(42);
    expect(s).toBeLessThanOrEqual(HAZEL_IRIS.maxSaturation + ROUNDING);
    expect(v).toBeLessThanOrEqual(HAZEL_IRIS.maxValue + ROUNDING);
  });

  it('keeps the limbal ring darker than the body of the iris', () => {
    const body = hsv(toneIris(pixel(150, 40, 20), BROWN_IRIS));
    const ring = hsv(toneIris(pixel(60, 12, 6), BROWN_IRIS));

    expect(ring.v).toBeLessThan(body.v * 0.6);
  });

  it('keeps the pupil, the whites, the blues and the greens of the eye', () => {
    for (const rgb of [
      [0, 0, 0],
      [215, 212, 208],
      [60, 120, 190],
      [70, 140, 90],
    ] as const)
      expect(Array.from(toneIris(pixel(rgb[0], rgb[1], rgb[2]), BROWN_IRIS))).toEqual([...rgb, 255]);
  });

  it('keeps the alpha and does not change the pixels it was given', () => {
    const source = pixel(150, 40, 20, 77);

    const result = toneIris(source, BROWN_IRIS);

    expect(result[3]).toBe(77);
    expect(Array.from(source)).toEqual([150, 40, 20, 77]);
  });
});
