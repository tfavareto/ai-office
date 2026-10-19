import type { AgentStatus } from '@ai-office/shared';
export interface TagItem {
    id: string;
    sx: number;
    sy: number;
    name: string;
    accent: string;
    status: AgentStatus;
    sub: boolean;
    emphasis: boolean;
    alert: boolean;
    bubble: {
        text: string;
        icon: string;
        sticky: boolean;
    } | null;
}
export declare class LabelOverlay {
    readonly canvas: HTMLCanvasElement;
    private readonly ctx;
    private dpr;
    private readonly cache;
    constructor();
    resize(width: number, height: number, dpr: number): void;
    private sprite;
    private measure;
    private tag;
    private bubble;
    draw(items: readonly TagItem[], showNames: boolean, hint: string | null): void;
    private drawHint;
    /** Draws the first-person minimap (floor plan with people) in the corner. */
    drawMinimap(paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): void;
}
