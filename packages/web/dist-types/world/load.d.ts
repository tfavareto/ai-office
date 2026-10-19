import type { WorldApi, WorldFactoryOptions } from './api';
export type WorldKind = '2d' | '3d';
export interface WorldLoadResult {
    world: WorldApi | null;
    kind: WorldKind;
    /** Friendly pt-BR explanation when the requested visual could not be used. */
    notice?: string;
}
/** Creates the requested world; falls back to 2D when 3D is unavailable. */
export declare function createWorld(kind: WorldKind, container: HTMLElement, opts: WorldFactoryOptions): Promise<WorldLoadResult>;
