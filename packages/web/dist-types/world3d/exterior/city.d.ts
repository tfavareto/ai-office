import { Group } from 'three';
import { type Materials } from '../scene/materials';
import type { CityModels } from './cityModels';
/** Distance from the office floor down to street level (about 11 storeys). */
export declare const TOWER_H = 34;
export declare class CityScene {
    private readonly m;
    private readonly models;
    readonly group: Group<import("three").Object3DEventMap>;
    private readonly tower;
    private readonly towerTex;
    private readonly towerMat;
    private readonly cars;
    private builtFor;
    private lampMaterial;
    constructor(m: Materials, models: CityModels);
    /** Rebuilds the parts that depend on the building width. */
    setBuildingWidth(widthTiles: number): void;
    private buildTower;
    private buildGround;
    private addBuildings;
    private addTrees;
    private addCars;
    /** Moves the cars; `night` lights the tower windows. */
    update(time: number, night: number): void;
    dispose(): void;
}
