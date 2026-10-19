import type { FurnitureItem, FurnitureKind } from '../../layout/types';
export interface FurnitureSprite {
    canvas: HTMLCanvasElement;
    /** Pixels above the footprint top-left that the canvas extends. */
    rise: number;
}
export declare function hasSprite(kind: FurnitureKind): boolean;
export declare function spriteRise(kind: FurnitureKind): number;
/** Cached sprite for an item (shared by every identical item in every room). */
export declare function furnitureSprite(item: FurnitureItem): FurnitureSprite | null;
export declare function clearSpriteCache(): void;
