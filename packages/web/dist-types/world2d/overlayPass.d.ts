import type { OverlaySprites } from './overlay';
import type { FrameState } from './renderer';
/**
 * Screen-space pass: room pills, name tags, status badges and speech bubbles. Labels are laid out each frame so that
 * none overlap or get cut off: pills are fixed, everything else is placed by priority (waiting > selected/hovered >
 * bubbles > names) and fades in/out instead of popping.
 */
export declare class OverlayPass {
    private readonly shown;
    private kept;
    draw(ctx: CanvasRenderingContext2D, sprites: OverlaySprites, s: FrameState): void;
    private paint;
    private buildItems;
    /** Draws room outlines and pills; returns the pill boxes (obstacles for the other labels). */
    private drawRooms;
}
