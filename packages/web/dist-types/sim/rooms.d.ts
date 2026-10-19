import type { Project } from '@ai-office/shared';
import type { RoomSpec } from '../layout/types';
export type RoomPhase = 'building' | 'open' | 'dismantling';
export declare const BUILD_SECONDS = 2.8;
export declare const DISMANTLE_SECONDS = 2.2;
export interface RoomState {
    /** Layout area id: `room:<projectId>` for live rooms, `ghost:<projectId>:<slot>` for rooms being dismantled. */
    areaId: string;
    projectId: string;
    name: string;
    seed: number;
    slot: number;
    phase: RoomPhase;
    /** Seconds spent in the current phase. */
    t: number;
    ghost: boolean;
    /** 0 = nothing built, 1 = complete; drives the build-in / dismantle animation. */
    progress: number;
}
export interface RoomMove {
    projectId: string;
    fromAreaId: string;
    toAreaId: string;
    fromSlot: number;
    toSlot: number;
}
export interface RoomUpdate {
    /** The set of areas or their positions changed: recompute the layout. */
    layoutChanged: boolean;
    moves: RoomMove[];
    removed: string[];
}
/** Owns the project rooms: slot assignment, build/dismantle lifecycle and compaction into freed slots. */
export declare class RoomManager {
    private rooms;
    private seenFirst;
    private ghostCounter;
    get all(): readonly RoomState[];
    live(projectId: string): RoomState | undefined;
    byArea(areaId: string): RoomState | undefined;
    specs(): RoomSpec[];
    /** Sync with the snapshot's projects. Returns true when anything changed. */
    sync(projects: readonly Project[]): boolean;
    /** Advance animations; `occupied(areaId)` tells whether people are still inside a room being dismantled. */
    advance(dt: number, occupied: (areaId: string) => boolean): RoomUpdate;
    private close;
    private lowestFreeSlot;
    /** The farthest open room moves into the lowest freed slot (one move at a time). */
    private compact;
}
