import type { AreaLayout, BuildingLayout, FurnitureItem, RoomSpec, Spot } from './types';
/**
 * Assemble the whole building for the given project rooms: core areas, rooms in their slots, the corridor, terraces and
 * the walkable grid. Pure and deterministic: the same input gives the same layout.
 */
export declare function computeBuilding(rooms: readonly RoomSpec[]): BuildingLayout;
export declare function allSpots(building: BuildingLayout): Spot[];
export declare function allFurniture(building: BuildingLayout): FurnitureItem[];
export declare function areaById(building: BuildingLayout, id: string): AreaLayout | undefined;
