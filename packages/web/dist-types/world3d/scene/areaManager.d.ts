import { Group, type Box3 } from 'three';
import type { AreaLayout } from '../../layout/types';
import type { OfficeSim } from '../../sim/sim';
import { AreaScene, type SceneDeps } from './areaScene';
import { StaticBatcher } from './staticBatcher';
import { type BoardInfo, type DeskState } from './screens';
export interface AreaInputs {
    time: number;
    dt: number;
    night: number;
    refreshScreens: boolean;
    info: (projectId: string) => BoardInfo;
    namesIn: (areaId: string) => readonly string[];
    desksIn: (area: AreaLayout) => readonly DeskState[];
    occupied: (areaId: string) => boolean;
    tickerText: string;
    isVisible: (box: Box3) => boolean;
}
export declare class AreaManager {
    private readonly deps;
    private readonly sim;
    readonly group: Group<import("three").Object3DEventMap>;
    readonly batcher: StaticBatcher;
    private stableFrames;
    private readonly entries;
    private readonly queue;
    private outer;
    private readonly ticker;
    private tickerMesh;
    private tickerWidth;
    private builtVersion;
    private lastBuilding;
    constructor(deps: SceneDeps, sim: OfficeSim);
    get pending(): number;
    private desired;
    /** Reconciles with the current layout; builds queued areas within a time budget (`all` ignores the budget). */
    sync(all?: boolean): void;
    private build;
    private syncOuter;
    private syncTicker;
    /** Bounds of the areas that can be picked as rooms, with their project ids. */
    projectBoxes(): {
        projectId: string;
        areaId: string;
        box: Box3;
    }[];
    areaScene(areaId: string): AreaScene | undefined;
    update(inputs: AreaInputs): void;
    /** Merges settled areas once nothing has changed for a while; any animation or layout change un-merges. */
    private updateBatching;
    /** Lit areas with their centre, for the point-light pool. */
    litCentres(): {
        x: number;
        z: number;
        lit: number;
        width: number;
    }[];
    dispose(): void;
}
