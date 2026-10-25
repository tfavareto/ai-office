// The MakeHuman "brown" eye texture paints the iris a deep red that reads as a red eye in the office. This warms those
// red pixels to a natural brown (a hue between red and orange, a little paler, lighter); blues, greens, ambers and the
// whites of the eye are left as they are.

const RED_BAND = 28;
const BROWN_HUE = 22;
const MIN_SATURATION = 0.4;
const SATURATION_GAIN = 0.68;
const LIGHTNESS_GAIN = 1.55;
const MAX_LIGHTNESS = 0.35;

/** Hue in degrees [0, 360), saturation and lightness in [0, 1]. */
function toHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const rn = r / 255;
  const gn = g / 255;
  const h = max === rn ? ((gn - b / 255) / d + 6) % 6 : max === gn ? (b / 255 - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function toRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function isRed(hue: number): boolean {
  return hue <= RED_BAND || hue >= 360 - RED_BAND;
}

/** A copy of RGBA `pixels` whose saturated red pixels are brown. Alpha is untouched. */
export function warmRedIris(pixels: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels);
  for (let i = 0; i < out.length; i += 4) {
    const [h, s, l] = toHsl(out[i], out[i + 1], out[i + 2]);
    if (s < MIN_SATURATION || !isRed(h)) continue;
    const [r, g, b] = toRgb(BROWN_HUE, s * SATURATION_GAIN, Math.min(MAX_LIGHTNESS, l * LIGHTNESS_GAIN));
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  }
  return out;
}
