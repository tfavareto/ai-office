import { Vector3 } from 'three';
import type { Part } from '../util/parts';
import { PartCollector } from '../util/parts';
export declare const MODEL_FILES: {
    readonly sofa: "furniture/sofa_03/sofa_03.gltf";
    readonly ottoman: "furniture/Ottoman_01/Ottoman_01.gltf";
    readonly diningChair: "furniture/dining_chair_02/dining_chair_02.gltf";
    readonly loungeChair: "furniture/mid_century_lounge_chair/mid_century_lounge_chair.gltf";
    readonly coffeeTable: "furniture/modern_coffee_table_01/modern_coffee_table_01.gltf";
    readonly cabinet: "furniture/modern_wooden_cabinet/modern_wooden_cabinet.gltf";
    readonly roundTable: "furniture/round_wooden_table_01/round_wooden_table_01.gltf";
    readonly sideTable: "furniture/side_table_01/side_table_01.gltf";
    readonly shelves: "furniture/wooden_display_shelves_01/wooden_display_shelves_01.gltf";
    readonly calathea: "plants/calathea_orbifolia_01/calathea_orbifolia_01.gltf";
    readonly fern: "plants/fern_02/fern_02.gltf";
    readonly pachira: "plants/pachira_aquatica_01/pachira_aquatica_01.gltf";
    readonly pottedPlant: "plants/potted_plant_04/potted_plant_04.gltf";
};
export type ModelName = keyof typeof MODEL_FILES;
export interface Model {
    parts: Part[];
    /** Size in metres of the normalised model. */
    size: Vector3;
}
export type Models = Record<ModelName, Model>;
export declare function loadModels(): Promise<Models>;
export interface PlaceOptions {
    /** Target width/depth/height in metres; unspecified axes keep the uniform scale. */
    width?: number;
    depth?: number;
    height?: number;
    /** Uniform scale used for axes without a target. */
    scale?: number;
    yaw?: number;
    y?: number;
}
/** Adds a model into a collector, scaled to the requested size. */
export declare function placeModel(c: PartCollector, model: Model, x: number, z: number, o?: PlaceOptions): void;
