export declare function hexToRgb(hex: string): [number, number, number];
export declare function rgbToHex(r: number, g: number, b: number): string;
/** Mix two colours: t=0 gives a, t=1 gives b. */
export declare function mix(a: string, b: string, t: number): string;
/** Lighten (amount > 0, toward white) or darken (amount < 0, toward black). */
export declare function shade(hex: string, amount: number): string;
export declare function rgba(hex: string, alpha: number): string;
/** Perceived luminance 0-1. */
export declare function luminance(hex: string): number;
/** Deterministic pseudo-random float in [0,1) for a tile/pixel coordinate. */
export declare function noise2(x: number, y: number, salt?: number): number;
