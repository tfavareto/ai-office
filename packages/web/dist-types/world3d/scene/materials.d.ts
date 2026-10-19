import { MeshBasicMaterial, MeshStandardMaterial, type Material, type Texture } from 'three';
import type { AreaTheme } from '../../layout/types';
import { type TextureLoader } from './textures';
export type FloorKind = AreaTheme['floor'];
export interface TextureSet {
    diff: Texture;
    nor?: Texture;
    rough?: Texture;
}
declare const SETS: readonly ["marble_01", "large_grey_tiles", "herringbone_parquet", "rectangular_paving", "fabric_pattern_07", "concrete_wall_008", "leather_white", "asphalt_02", "grass_ground"];
export type SetName = (typeof SETS)[number];
/** Real-world size in metres of one texture repeat. */
export declare const TEXTURE_M: Record<SetName, number>;
export type TextureSets = Record<SetName, TextureSet>;
export declare function loadTextureSets(loader: TextureLoader): Promise<TextureSets>;
export interface ShadowMeta {
    cast: boolean;
    receive: boolean;
}
export declare const shadowOf: (material: Material) => ShadowMeta;
export declare class Materials {
    readonly sets: TextureSets;
    readonly plaster: MeshStandardMaterial;
    readonly plasterWarm: MeshStandardMaterial;
    readonly graphite: MeshStandardMaterial;
    readonly steel: MeshStandardMaterial;
    readonly brass: MeshStandardMaterial;
    readonly black: MeshStandardMaterial;
    readonly whiteGloss: MeshStandardMaterial;
    readonly ceramic: MeshStandardMaterial;
    readonly rubber: MeshStandardMaterial;
    readonly felt: MeshStandardMaterial;
    readonly walnut: MeshStandardMaterial;
    readonly walnutDark: MeshStandardMaterial;
    readonly slats: MeshStandardMaterial;
    readonly marbleWall: MeshStandardMaterial;
    readonly tileWhite: MeshStandardMaterial;
    readonly screenOff: MeshStandardMaterial;
    readonly glass: MeshStandardMaterial;
    readonly frost: MeshStandardMaterial;
    /** Frosting of a glass wall that changes with occupancy (meeting room). */
    readonly frostLive: MeshStandardMaterial;
    readonly mirror: MeshStandardMaterial;
    readonly glow: MeshBasicMaterial;
    private readonly floors;
    private readonly leds;
    private readonly fabrics;
    private readonly rugs;
    private readonly extra;
    constructor(sets: TextureSets);
    private canvasWood;
    textured(set: SetName, tint: string, normalScale?: number, roughMul?: number): MeshStandardMaterial;
    floor(kind: FloorKind, carpetTint?: string): MeshStandardMaterial;
    led(hex: string): MeshBasicMaterial;
    fabric(hex: string, rough?: number): MeshStandardMaterial;
    leather(hex: string): MeshStandardMaterial;
    /** Rug with a procedural pattern; its UVs span the rug (0..1). */
    rug(pattern: number, a: string, b: string, accent: string): MeshStandardMaterial;
    /** Plain coloured standard material, cached by its parameters. */
    solid(hex: string, rough?: number, metal?: number): MeshStandardMaterial;
    all(): Material[];
    dispose(): void;
}
export {};
