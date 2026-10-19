import { CanvasTexture, Texture } from 'three';
export declare const ASSET_BASE = "/assets/3d";
export interface LoadOptions {
    srgb?: boolean;
    repeat?: boolean;
}
/** Loads image files into three.js textures. Bitmaps are decoded by the browser off the main thread. */
export declare class TextureLoader {
    private readonly loader;
    private readonly cache;
    anisotropy: number;
    load(path: string, options?: LoadOptions): Promise<Texture>;
}
export declare function canvas2d(w: number, h: number): {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
};
/** Warm walnut with long vertical grain (one repeat covers 1 m). */
export declare function walnutTexture(seed?: number, base?: string): CanvasTexture;
/** Vertical slats (one repeat = 0.72 m, 8 slats) separated by dark gaps. */
export declare function slatTexture(base?: string): CanvasTexture;
/** Planks for outdoor decks (repeat = 1 m). */
export declare function deckTexture(): CanvasTexture;
/** Rug / carpet pattern: 0 solid, 1 stripes, 2 checker, 3 diamond. One texture covers the whole rug (clamped). */
export declare function rugTexture(pattern: number, a: string, b: string, accent: string): CanvasTexture;
/** Soft white radial gradient used for floor light pools and lamp halos. */
export declare function glowTexture(): CanvasTexture;
export interface TowerTextures {
    map: CanvasTexture;
    emissive: CanvasTexture;
}
/** Glass curtain-wall facade: one repeat = 6 m wide by 13.6 m tall (4 storeys of 8 panes), lit windows are random. */
export declare function towerTextures(): TowerTextures;
