import { Box3, Group, Mesh } from 'three';
import type { AreaLayout, BuildingLayout } from '../../layout/types';
import { type Materials } from './materials';
import type { Models } from './models';
import { type BoardInfo, type DeskState } from './screens';
export interface SceneDeps {
    m: Materials;
    models: Models;
}
export interface AreaFrame {
    time: number;
    /** 0 day .. 1 night. */
    night: number;
    /** 0..1 how lit the area is at night (occupied rooms and core areas). */
    lit: number;
    info: BoardInfo;
    names: readonly string[];
    desks: readonly DeskState[];
    /** Elevator openness by building elevator index. */
    elevatorOpen: (index: number) => number;
    /** Whether monitor atlases should be redrawn this frame. */
    refreshScreens: boolean;
    /** Whether the area is inside the camera view (off-screen areas skip texture updates). */
    visible: boolean;
}
export declare class AreaScene {
    readonly area: AreaLayout;
    private readonly deps;
    readonly group: Group<import("three").Object3DEventMap>;
    readonly bounds: Box3;
    private readonly shell;
    private readonly props;
    private readonly dynamic;
    private readonly screens;
    private atlas;
    private glowMesh;
    private glowMaterial;
    private lastInfoKey;
    private lastNamesKey;
    private build;
    constructor(area: AreaLayout, building: BuildingLayout, deps: SceneDeps);
    private addMonitors;
    private addGlow;
    /** 0 = nothing built, 1 = complete. Walls rise first, then the furniture pops in. */
    setBuild(progress: number): void;
    /** Merged static meshes (shell + props); they sit in world space with an identity transform. */
    staticMeshes(): Mesh[];
    get isBuilt(): boolean;
    update(f: AreaFrame): void;
    dispose(): void;
}
