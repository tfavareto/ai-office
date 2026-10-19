import { type ExteriorLayout } from '../../layout/exterior';
import type { BuildingLayout } from '../../layout/types';
import { type AreaCanvas } from './areaLayer';
export interface ExteriorCanvas {
    canvas: HTMLCanvasElement;
    layout: ExteriorLayout;
    /** World px of the canvas top-left. */
    x: number;
    y: number;
    key: string;
}
/** Pre-rendered static layers; rebuilt only for the pieces whose layout actually changed. */
export declare class LayerCache {
    readonly areas: Map<string, AreaCanvas>;
    corridor: AreaCanvas | null;
    endCap: HTMLCanvasElement | null;
    exterior: ExteriorCanvas | null;
    /** Bumped whenever any layer was (re)built, so renderers can refresh dependent data. */
    version: number;
    /** Returns the built areas in drawing order (north row, corridor, south row) after syncing. */
    sync(building: BuildingLayout): void;
    /** Area canvases sorted for drawing: by row then x. */
    ordered(): AreaCanvas[];
}
