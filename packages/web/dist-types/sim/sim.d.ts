import type { OfficeSnapshot } from '@ai-office/shared';
import type { BuildingLayout } from '../layout/types';
import { BubbleManager, type Bubble } from './bubbles';
import { RoomManager, type RoomState } from './rooms';
import { SpotBook } from './spots';
import { type Character, type SimOptions } from './types';
export interface SimStats {
    actors: number;
    walking: number;
}
/** Deterministic office simulation: people derived from snapshot agents, rooms, bubbles. No DOM, fixed 30 Hz tick. */
export declare class OfficeSim {
    readonly rooms: RoomManager;
    readonly spots: SpotBook;
    readonly bubbleManager: BubbleManager;
    building: BuildingLayout;
    layoutVersion: number;
    /** Simulation time in seconds. */
    time: number;
    options: SimOptions;
    private readonly seed;
    private actors;
    private list;
    private areaIndex;
    private areaIds;
    private elevators;
    private accumulator;
    private firstSnapshot;
    private serverBase;
    private serverBaseTime;
    private bubbleList;
    private tickCount;
    constructor(seed?: number);
    get characters(): readonly Character[];
    get bubbles(): readonly Bubble[];
    stats(): SimStats;
    character(id: string): Character | undefined;
    /** Estimated server clock (ms). */
    serverNow(): number;
    elevatorOpenness(index: number): number;
    setOptions(options: Partial<SimOptions>): void;
    /** Area id containing a tile position, or null outside the building. */
    areaAt(x: number, y: number): string | null;
    setSnapshot(snapshot: OfficeSnapshot, serverNow: number): void;
    /** Advance by wall-clock seconds, running fixed 30 Hz ticks. */
    advance(dtSeconds: number): void;
    /** Run exactly `seconds` of simulation (tests, fast-forward). */
    runFor(seconds: number): void;
    private relayout;
    private buildAreaIndex;
    private onLayoutChanged;
    private spawn;
    private updateAgent;
    private offerBubble;
    private roomReady;
    private assignHome;
    private tick;
    private onRoomMoved;
    private walkSpeed;
    private updateActor;
    private openElevator;
    private tickArriving;
    private startWalk;
    private teleport;
    private tickWalking;
    /** Returns true when the path is finished. */
    private stepPath;
    private goHome;
    private tickAtHome;
    private assignBetterHome;
    private hasForegroundShell;
    private shellStage;
    private tickLeavingAtHome;
    private tryWander;
    private beginPlan;
    private startPlan;
    private walkToStep;
    private arriveAtStep;
    private tickDoing;
    private nextStep;
    private finishActivity;
    private cancelActivity;
    private beginLeave;
    private walkToExit;
    private tickExiting;
    /** Rooms (including those animating) for renderers. */
    get roomStates(): readonly RoomState[];
}
