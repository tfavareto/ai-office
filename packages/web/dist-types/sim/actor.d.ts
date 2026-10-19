import type { Agent, AgentKind, AgentStatus } from '@ai-office/shared';
import type { Dir, Spot, TilePos } from '../layout/types';
import { Rng } from '../layout/rng';
import type { Vec } from './path';
import type { Character, Pose, SeatKind } from './types';
export type Phase = 'arriving' | 'toHome' | 'waitRoom' | 'atHome' | 'toActivity' | 'doing' | 'toExit' | 'exiting';
export interface ActivityStep {
    spot: Spot;
    pose: Pose;
    /** Seconds to stay (pair activities share the end time). */
    dur: number;
    carry?: 'cup';
}
export interface ActivityPlan {
    steps: ActivityStep[];
    index: number;
    /** Pair activity (chat / ping-pong): the other participant. */
    partnerId?: string;
    /** Sim time at which `doing` ends; null until the step starts (pairs: until both are ready). */
    endsAt: number | null;
    ready: boolean;
}
/** Mutable character used by the simulation; renderers see it through the readonly `Character` interface. */
export declare class Actor implements Character {
    readonly id: string;
    readonly agentId: string;
    readonly rng: Rng;
    agent: Agent;
    x: number;
    y: number;
    dir: Dir;
    pose: Pose;
    poseT: number;
    walkPhase: number;
    alpha: number;
    seat: SeatKind;
    moving: boolean;
    areaId: string | null;
    shellStage: number;
    carrying: 'cup' | null;
    alert: boolean;
    phase: Phase;
    path: Vec[];
    pathIndex: number;
    pathTarget: TilePos | null;
    home: Spot | null;
    activity: ActivityPlan | null;
    /** Walkable tile to step to first when the current tile is a seat / elevator door. */
    leaveTile: TilePos | null;
    idleDue: number;
    celebrateUntil: number;
    arriveAt: number;
    elevator: number;
    stageTimer: number;
    leaving: boolean;
    leaveAt: number;
    exitT: number;
    remove: boolean;
    prevStatus: AgentStatus;
    /** Time spent waiting for a room to be built (re-check throttle). */
    waitCheck: number;
    constructor(agent: Agent, seed: number);
    get name(): string;
    get kind(): AgentKind;
    get look(): 'f' | 'm';
    get seed(): number;
    get accountId(): string;
    get projectId(): string;
    get status(): AgentStatus;
    setPose(pose: Pose): void;
    tile(): TilePos;
}
export declare function dirFromVector(dx: number, dy: number, fallback: Dir): Dir;
/** Moves toward a point at `speed` tiles/s; returns true when it got there. */
export declare function approach(actor: Actor, tx: number, ty: number, speed: number, dt: number): boolean;
