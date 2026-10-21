// Account and project colors (pure, deterministic).

export const ACCOUNT_COLORS: readonly string[] = [
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
];

/** Color of the n-th account (wraps around the palette). */
export function accountColor(index: number): string {
  const size = ACCOUNT_COLORS.length;
  return ACCOUNT_COLORS[((index % size) + size) % size] as string;
}

function channel(n: number, h: number, s: number, l: number): number {
  const k = (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
}

/** Converts HSL (h in degrees, s and l in 0..1) to "#rrggbb". */
export function hslToHex(h: number, s: number, l: number): string {
  const toHex = (value: number): string =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  const hue = ((h % 360) + 360) % 360;
  return `#${toHex(channel(0, hue, s, l))}${toHex(channel(8, hue, s, l))}${toHex(channel(4, hue, s, l))}`;
}

/** Accent color of a project room, from its seed: always a calm, mid-saturation color. */
export function projectAccent(seed: number): string {
  const hue = (seed >>> 0) % 360;
  const saturation = 0.42 + ((seed >>> 9) % 20) / 100;
  return hslToHex(hue, saturation, 0.5);
}
