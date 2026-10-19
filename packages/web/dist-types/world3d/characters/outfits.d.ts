export declare const MALE_MODELS: readonly ["humans/m1_lod", "humans/m2_lod", "humans/m3", "humans/m4_lod"];
export declare const FEMALE_MODELS: readonly ["humans/f1", "humans/f2", "humans/f3", "humans/f4"];
/** Tints multiplied on a neutral-grey suit texture. */
export declare const OUTFIT_COLORS: readonly ["#1f2a44", "#2b2f37", "#4a3b34", "#304a3f", "#5a2f3a", "#3c4f6e", "#6b6358", "#2f3f4a", "#7a5a3c", "#3d3a52", "#8a8f98", "#243a58"];
export interface LookChoice {
    model: string;
    outfit: string;
    /** Height multiplier around 1. */
    scale: number;
    /** Per-agent animation phase offset in [0, 1). */
    phase: number;
}
export declare function chooseLook(look: 'f' | 'm', seed: number): LookChoice;
