export type Ctx = CanvasRenderingContext2D;
export declare function makeCanvas(w: number, h: number): HTMLCanvasElement;
export declare function context2d(canvas: HTMLCanvasElement): Ctx;
export declare function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void;
export declare function pixel(ctx: Ctx, x: number, y: number, color: string): void;
/** Horizontal line of 1px height. */
export declare function hline(ctx: Ctx, x: number, y: number, w: number, color: string): void;
export declare function vline(ctx: Ctx, x: number, y: number, h: number, color: string): void;
/** Filled rect with a 1px lighter top/left and darker bottom/right edge (pixel-art bevel). */
export declare function bevel(ctx: Ctx, x: number, y: number, w: number, h: number, base: string, light: string, dark: string): void;
/** Ellipse-ish filled blob drawn with rects (pixel-art friendly, no anti-aliasing). */
export declare function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void;
export declare function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void;
