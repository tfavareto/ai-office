/** mulberry32: tiny seeded PRNG returning floats in [0, 1). */
export declare class Rng {
    private state;
    constructor(seed: number);
    next(): number;
    /** Integer in [0, n). */
    int(n: number): number;
    range(min: number, max: number): number;
    chance(p: number): boolean;
    pick<T>(items: readonly T[]): T;
    /** Fork a child generator so a consumer cannot disturb the parent sequence. */
    fork(salt: number): Rng;
}
/** 32-bit integer hash of two numbers. */
export declare function hash32(a: number, b?: number): number;
/** Hash of a string (FNV-1a), for ids that have no numeric seed. */
export declare function hashString(text: string): number;
export declare function clamp(value: number, min: number, max: number): number;
export declare function lerp(a: number, b: number, t: number): number;
