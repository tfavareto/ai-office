import { CanvasTexture, MeshBasicMaterial } from 'three';
import type { AgentStatus } from '@ai-office/shared';
export declare const FONT = "600 {s}px \"Inter\", \"SF Pro Text\", system-ui, sans-serif";
export declare const font: (size: number, weight?: number) => string;
export declare function fitText(ctx: CanvasRenderingContext2D, text: string, maxPx: number): string;
export interface DeskState {
    status: AgentStatus | 'empty';
    seed: number;
}
/** One texture holding every monitor of a room (24 cells); drawn at a low rate and uploaded as a single texture. */
export declare class WorkstationAtlas {
    readonly texture: CanvasTexture;
    readonly material: MeshBasicMaterial;
    private readonly ctx;
    private static strips;
    constructor();
    /** UV rectangle of a cell: [u0, v0, u1, v1] (canvas row 0 is at the top; textures here are not flipped). */
    static uv(desk: number, slot: number): [number, number, number, number];
    update(time: number, desks: readonly DeskState[], brightness: number): void;
    private drawCell;
    dispose(): void;
}
export declare class CanvasScreen {
    readonly width: number;
    readonly height: number;
    readonly texture: CanvasTexture;
    readonly material: MeshBasicMaterial;
    readonly ctx: CanvasRenderingContext2D;
    private key;
    constructor(width: number, height: number);
    /** Redraws when `key` changed. */
    draw(key: string, painter: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void;
    dispose(): void;
}
export interface BoardInfo {
    agents: number;
    working: number;
    waiting: number;
    tasksTotal: number;
    tasksDone: number;
    current: string | null;
}
export declare function paintBoard(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, info: BoardInfo, accent: string): void;
export declare function paintMeetingTv(ctx: CanvasRenderingContext2D, w: number, h: number, names: readonly string[]): void;
export declare function paintMenu(ctx: CanvasRenderingContext2D, w: number, h: number): void;
export declare function paintWhiteboard(ctx: CanvasRenderingContext2D, w: number, h: number): void;
export declare function paintLoungeTv(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
export declare function paintSign(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, accent: string, dark: boolean): void;
export declare function paintPoster(ctx: CanvasRenderingContext2D, w: number, h: number, variant: number): void;
/** Scrolling LED marquee along the corridor: a long strip texture with one text period, scrolled via UV offset. */
export declare class TickerStrip {
    readonly texture: CanvasTexture;
    readonly material: MeshBasicMaterial;
    periodMeters: number;
    private text;
    constructor();
    setText(text: string): void;
    scroll(time: number, lengthMeters: number): void;
    dispose(): void;
}
export declare const DECOR_PX_PER_M = 256;
export interface DecorSlot {
    /** UV rectangle [u0, vTop0, u1, vTop1] (canvas rows from the top). */
    uv: [number, number, number, number];
}
export declare class DecorAtlas {
    readonly texture: CanvasTexture;
    readonly material: MeshBasicMaterial;
    private readonly ctx;
    private x;
    private y;
    private rowH;
    constructor();
    /** Reserves a w x h metre region, paints it and returns its UVs. */
    add(wMeters: number, hMeters: number, painter: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): DecorSlot;
    dispose(): void;
}
