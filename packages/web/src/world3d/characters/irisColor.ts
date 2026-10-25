// The MakeHuman "brown" eye textures paint the iris a saturated red or gold that reads as a rust-colored, glowing eye in
// the office. This tones those pixels to a natural dark brown or hazel (a hue between orange and amber, low saturation
// and value) and keeps the iris' own variation, so the streaks stay and the limbal ring stays darker. Pixels that are
// not a saturated warm color (the pupil, the whites, blues and greens) are left as they are.

/** The color an iris is brought to; `maxSaturation` and `maxValue` are the HSV ceilings of its brightest pixels. */
export interface IrisTone {
  /** Hue in degrees. */
  hue: number;
  maxSaturation: number;
  maxValue: number;
}

export const BROWN_IRIS: IrisTone = { hue: 29, maxSaturation: 0.44, maxValue: 0.4 };
export const HAZEL_IRIS: IrisTone = { hue: 34, maxSaturation: 0.52, maxValue: 0.54 };

/** Warm hues (degrees, wrapping through red) of an iris that is toned. */
const WARM_HUE_MIN = -40;
const WARM_HUE_MAX = 65;
const MIN_SATURATION = 0.35;
/** The saturation and value of the source iris that reach the ceilings of the tone. */
const SOURCE_SATURATION = 0.9;
const SOURCE_VALUE = 0.58;
/** How much of the source hue's distance from the middle of the warm range is kept (the hazel streaks). */
const HUE_SPREAD = 0.25;
const HUE_CENTER = 25;

/** Hue in degrees (-180, 180], saturation and value in [0, 1]. */
function toHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return [0, 0, max / 255];
  const h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const degrees = h * 60;
  return [degrees > 180 ? degrees - 360 : degrees, d / max, max / 255];
}

function toRgb(hue: number, s: number, v: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const channel = (n: number): number => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [channel(5), channel(3), channel(1)];
}

/** A copy of RGBA `pixels` whose saturated warm pixels have the `tone`. Alpha is untouched. */
export function toneIris(pixels: Uint8ClampedArray, tone: IrisTone): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels);
  for (let i = 0; i < out.length; i += 4) {
    const [h, s, v] = toHsv(out[i], out[i + 1], out[i + 2]);
    if (s < MIN_SATURATION || h < WARM_HUE_MIN || h > WARM_HUE_MAX) continue;
    const hue = tone.hue + (h - HUE_CENTER) * HUE_SPREAD;
    const [r, g, b] = toRgb(
      hue,
      tone.maxSaturation * Math.min(1, s / SOURCE_SATURATION),
      tone.maxValue * Math.min(1, v / SOURCE_VALUE),
    );
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  }
  return out;
}
