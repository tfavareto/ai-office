// Day/night parameters as a pure function of the night amount (0 = bright day, 1 = full night).
export type Rgb = readonly [number, number, number];

export interface DaylightParams {
  skyTop: Rgb;
  skyBottom: Rgb;
  fog: Rgb;
  fogDensity: number;
  sunColor: Rgb;
  sunIntensity: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  envIntensity: number;
  exposure: number;
  /** Bloom is only used at night. */
  bloomStrength: number;
  /** 0..1 how strongly interior lights, screens and tower windows glow. */
  glow: number;
}

const DAY: DaylightParams = {
  skyTop: [0.36, 0.62, 0.9], skyBottom: [0.8, 0.9, 0.97], fog: [0.72, 0.83, 0.93], fogDensity: 0.0011,
  sunColor: [1, 0.95, 0.86], sunIntensity: 3.1, hemiSky: [0.78, 0.88, 1], hemiGround: [0.62, 0.55, 0.46], hemiIntensity: 1.05,
  envIntensity: 0.9, exposure: 1.0, bloomStrength: 0, glow: 0,
};

const NIGHT: DaylightParams = {
  skyTop: [0.015, 0.03, 0.09], skyBottom: [0.09, 0.12, 0.26], fog: [0.05, 0.07, 0.16], fogDensity: 0.0015,
  sunColor: [0.55, 0.65, 1], sunIntensity: 0.9, hemiSky: [0.3, 0.38, 0.62], hemiGround: [0.16, 0.13, 0.15], hemiIntensity: 0.8,
  envIntensity: 0.3, exposure: 1.0, bloomStrength: 0.42, glow: 1,
};

const mixN = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)];
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function daylight(night: number): DaylightParams {
  const t = clamp01(night);
  return {
    skyTop: mixRgb(DAY.skyTop, NIGHT.skyTop, t),
    skyBottom: mixRgb(DAY.skyBottom, NIGHT.skyBottom, t),
    fog: mixRgb(DAY.fog, NIGHT.fog, t),
    fogDensity: mixN(DAY.fogDensity, NIGHT.fogDensity, t),
    sunColor: mixRgb(DAY.sunColor, NIGHT.sunColor, t),
    sunIntensity: mixN(DAY.sunIntensity, NIGHT.sunIntensity, t),
    hemiSky: mixRgb(DAY.hemiSky, NIGHT.hemiSky, t),
    hemiGround: mixRgb(DAY.hemiGround, NIGHT.hemiGround, t),
    hemiIntensity: mixN(DAY.hemiIntensity, NIGHT.hemiIntensity, t),
    envIntensity: mixN(DAY.envIntensity, NIGHT.envIntensity, t),
    exposure: mixN(DAY.exposure, NIGHT.exposure, t),
    bloomStrength: t < 0.35 ? 0 : mixN(0, NIGHT.bloomStrength, (t - 0.35) / 0.65),
    glow: clamp01((t - 0.15) / 0.7),
  };
}

/** Whether the bloom pass should run (it is the costly part, so it is skipped by day). */
export const usesBloom = (night: number): boolean => night >= 0.35;
