// Colour helpers for the procedural painter. Colours are #rrggbb strings; results are cached.

const cache = new Map<string, string>();

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix two colours: t=0 gives a, t=1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const key = `m${a}${b}${t.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const out = rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
  cache.set(key, out);
  return out;
}

/** Lighten (amount > 0, toward white) or darken (amount < 0, toward black). */
export function shade(hex: string, amount: number): string {
  return amount >= 0 ? mix(hex, '#ffffff', amount) : mix(hex, '#000000', -amount);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Perceived luminance 0-1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Deterministic pseudo-random float in [0,1) for a tile/pixel coordinate. */
export function noise2(x: number, y: number, salt = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
