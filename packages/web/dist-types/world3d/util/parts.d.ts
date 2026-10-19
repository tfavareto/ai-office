import { BoxGeometry, BufferGeometry, CylinderGeometry, Matrix4, Object3D, SphereGeometry, type Material } from 'three';
export interface Part {
    geometry: BufferGeometry;
    material: Material;
    matrix: Matrix4;
}
export interface ShadowFlags {
    cast: boolean;
    receive: boolean;
}
/** Box with texture coordinates in metres divided by `texM`, so tiled materials keep their real-world scale. */
export declare function boxGeometry(sx: number, sy: number, sz: number, texM?: number): BoxGeometry;
export declare function cylinderGeometry(rTop: number, rBottom: number, h: number, segments?: number): CylinderGeometry;
export declare function sphereGeometry(r: number, w?: number, h?: number): SphereGeometry;
/** A horizontal quad (y up) between two corners, with world-scale UVs. */
export declare function groundQuad(x0: number, z0: number, x1: number, z1: number, y: number, texM: number): BufferGeometry;
/** A vertical quad facing +z in local space (width w along x, height h along y), origin at its bottom centre. */
export declare function wallQuad(w: number, h: number): BufferGeometry;
export declare function transform(x: number, y: number, z: number, ry?: number, rx?: number, rz?: number, sx?: number, sy?: number, sz?: number): Matrix4;
export declare class PartCollector {
    readonly parts: Part[];
    add(geometry: BufferGeometry, material: Material, matrix?: Matrix4): this;
    box(material: Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry?: number, texM?: number): this;
    /** Box whose bottom face sits at y. */
    boxOn(material: Material, cx: number, y: number, cz: number, sx: number, sy: number, sz: number, ry?: number, texM?: number): this;
    cylinder(material: Material, cx: number, y: number, cz: number, r: number, h: number, segments?: number, rTop?: number): this;
    sphere(material: Material, cx: number, cy: number, cz: number, r: number, sx?: number, sy?: number, sz?: number): this;
    /** Adds all parts of another collector under a transform. */
    addAll(other: PartCollector, matrix: Matrix4): this;
    get vertexCount(): number;
    /** Merges the parts per material (one mesh per batch). The result is static: matrixAutoUpdate is off. */
    build(shadowOf: (material: Material) => ShadowFlags): Object3D;
}
export declare function disposeObject(root: Object3D): void;
