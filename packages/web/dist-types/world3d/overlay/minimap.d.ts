import type { BuildingLayout } from '../../layout/types';
import type { Character } from '../../sim/types';
export interface MinimapState {
    building: BuildingLayout;
    characters: readonly Character[];
    player: {
        x: number;
        z: number;
        yaw: number;
    };
    accent: (character: Character) => string;
}
export declare function paintMinimap(ctx: CanvasRenderingContext2D, _w: number, h: number, s: MinimapState): void;
