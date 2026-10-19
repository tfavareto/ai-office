export type HairStyle = 0 | 1 | 2 | 3 | 4 | 5;
export interface Look {
    key: string;
    gender: 'f' | 'm';
    skin: string;
    skinShade: string;
    hairStyle: HairStyle;
    hair: string;
    hairShade: string;
    hairLight: string;
    /** Outer garment (suit jacket / blazer), or null for shirt-sleeves. */
    jacket: string | null;
    shirt: string;
    tie: string | null;
    bottom: string;
    /** Skirt instead of trousers. */
    skirt: boolean;
    /** Bare skin legs below a skirt. */
    bareLegs: boolean;
    shoes: string;
    glasses: boolean;
    beard: boolean;
    /** Small ID badge on the chest (subagents). */
    badge: boolean;
}
/** Deterministic appearance from the agent seed and look (f/m). */
export declare function lookFor(seed: number, gender: 'f' | 'm', badge: boolean): Look;
