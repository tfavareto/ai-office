import type { BuildingLayout, Spot, SpotKind } from '../layout/types';
/** Index of every spot in the building plus who has claimed it. */
export declare class SpotBook {
    private byId;
    private claims;
    private list;
    rebuild(building: BuildingLayout): void;
    get(id: string): Spot | undefined;
    claimant(spotId: string): string | undefined;
    isFree(spotId: string, by?: string): boolean;
    claim(spotId: string, charId: string): boolean;
    release(spotId: string, charId: string): void;
    releaseAll(charId: string): void;
    /** Free spots of a kind (optionally restricted to an area), in layout order. */
    free(kind: SpotKind, areaId?: string, by?: string): Spot[];
    inGroup(group: string): Spot[];
    inArea(areaId: string): Spot[];
    all(): readonly Spot[];
}
