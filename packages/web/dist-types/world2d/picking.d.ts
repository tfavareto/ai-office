import type { BuildingLayout } from '../layout/types';
import type { RoomState } from '../sim/rooms';
import type { Character } from '../sim/types';
/** Pixels from the character's feet y to the sprite anchor (feet are drawn slightly below the tile centre). */
export declare const FOOT_OFFSET = 4;
/** World-px rectangle covered by a character's visible body (generous for easy clicking). */
export declare function characterBox(c: Character): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** The character under a world point (the one drawn in front wins), or null. */
export declare function pickCharacter(characters: readonly Character[], wx: number, wy: number): Character | null;
/** Project id of the room under a world point, or null (core areas, corridor and outdoors have no selection). */
export declare function pickRoom(building: BuildingLayout, rooms: readonly RoomState[], wx: number, wy: number): string | null;
