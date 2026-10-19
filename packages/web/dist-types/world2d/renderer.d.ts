import type { Agent } from '@ai-office/shared';
import type { OfficeSim } from '../sim/sim';
import type { Selection, WorldOptions } from '../world/api';
import { Camera } from './camera';
import { type Look } from './chars/looks';
import { LayerCache } from './layers/cache';
import { type RoomInfo } from './runtime/boards';
import { Traffic } from './runtime/cars';
import { type TickerStrip } from './runtime/ticker';
export interface FrameState {
    sim: OfficeSim;
    cam: Camera;
    night: number;
    /** Real seconds since start (animation clock). */
    time: number;
    dt: number;
    selection: Selection;
    hover: {
        agentId: string | null;
        roomId: string | null;
    };
    options: WorldOptions;
    roomInfo: ReadonlyMap<string, RoomInfo>;
    agents: ReadonlyMap<string, Agent>;
    accountColor: (accountId: string) => string;
    ticker: TickerStrip | null;
}
/** Draws one frame of the 2D world from the cached layers and the simulation. */
export declare class Renderer {
    readonly layers: LayerCache;
    readonly traffic: Traffic;
    private cars;
    private lit;
    private boards;
    private desks;
    private skyDay;
    private skyNight;
    private seenVersion;
    private trafficKey;
    private lookCache;
    constructor();
    private makeSky;
    lookOf(agent: Agent): Look;
    /** Make sure static layers match the simulation's layout. */
    sync(sim: OfficeSim): void;
    private refreshDynamic;
    lightOf(areaId: string): number;
    draw(ctx: CanvasRenderingContext2D, s: FrameState): void;
    private updateLights;
    private drawExterior;
    private drawGrounds;
    private drawPanes;
    private drawFurniture;
    private roomInfoOf;
    private boardFor;
    private drawDynamic;
    /** The meeting-room glass wall frosts over while people are inside. */
    private drawFrost;
    private drawDesks;
    private drawWallScreen;
    private drawTicker;
}
