import { type Mesh, type Object3D, type Texture } from 'three';
export interface HumanInstance {
    root: Object3D;
    /** Eyes, eyebrows and lashes (only the full-detail models have them). */
    detail: Mesh[];
    meshes: Mesh[];
}
export declare class HumanLibrary {
    private readonly templates;
    private readonly neutral;
    private readonly suits;
    static load(): Promise<HumanLibrary>;
    private suitMaterial;
    /** Skinned clone of a model with the outfit tint applied. */
    create(modelName: string, outfit: string): HumanInstance;
    /** Every texture the models use (for progressive GPU upload). */
    textures(): Texture[];
    dispose(): void;
}
