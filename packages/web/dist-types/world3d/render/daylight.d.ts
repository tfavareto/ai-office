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
export declare function daylight(night: number): DaylightParams;
/** Whether the bloom pass should run (it is the costly part, so it is skipped by day). */
export declare const usesBloom: (night: number) => boolean;
