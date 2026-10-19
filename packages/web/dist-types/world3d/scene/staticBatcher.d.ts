import { Group, Mesh } from 'three';
export interface Batchable {
    /** Merged static meshes of an area (world-space geometry, identity transform). */
    staticMeshes(): Mesh[];
}
export declare class StaticBatcher {
    readonly group: Group<import("three").Object3DEventMap>;
    private pending;
    private hidden;
    private active;
    get isActive(): boolean;
    get inProgress(): boolean;
    /** Restores every per-area mesh and frees the merged ones. */
    reset(): void;
    /** One incremental step; returns true while work remains. */
    step(areas: readonly Batchable[]): boolean;
}
